import { sql } from "@/lib/db";

// Packaged-food nutrition and allergen data from Open Food Facts (open, nonprofit food database),
// fetched through Bright Data's Web Unlocker when BRIGHTDATA_API_KEY + BRIGHTDATA_ZONE are set.
// Every query is cached in Neon so repeat searches don't spend Bright Data requests.

export type Nutrients = {
  kcal?: number; fat?: number; satFat?: number; carbs?: number; sugars?: number;
  fiber?: number; protein?: number; salt?: number; sodiumMg?: number;
};
export type FoodProduct = {
  code: string; name: string; brand: string; image?: string; servingSize?: string;
  per100g: Nutrients; perServing?: Nutrients;
  allergens: string[]; traces: string[]; ingredients?: string;
};
export type FoodSearch = { query: string; products: FoodProduct[]; source: "brightdata" | "openfoodfacts" | "cache" };

const CACHE_DAYS = 14;
const FIELDS = "code,product_name,brands,image_front_small_url,serving_size,ingredients_text,allergens_tags,traces_tags,nutriments";

// Open Food Facts allergen tags -> plain words people use
const ALLERGEN_NAMES: Record<string, string> = {
  "en:milk": "milk", "en:gluten": "gluten", "en:nuts": "tree nuts", "en:peanuts": "peanuts",
  "en:soybeans": "soy", "en:eggs": "eggs", "en:sesame-seeds": "sesame", "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish", "en:fish": "fish", "en:mustard": "mustard", "en:celery": "celery",
  "en:lupin": "lupin", "en:sulphur-dioxide-and-sulphites": "sulphites",
};
const tagName = (t: string) => ALLERGEN_NAMES[t] ?? t.replace(/^[a-z]{2}:/, "").replace(/-/g, " ");
const uniq = (a: string[]) => [...new Set(a)];

const round = (n: unknown, d = 1) => (typeof n === "number" && isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : undefined);
function nutrients(n: any, suffix: "_100g" | "_serving"): Nutrients {
  const sodium = n?.[`sodium${suffix}`];
  return {
    kcal: round(n?.[`energy-kcal${suffix}`], 0), fat: round(n?.[`fat${suffix}`]), satFat: round(n?.[`saturated-fat${suffix}`]),
    carbs: round(n?.[`carbohydrates${suffix}`]), sugars: round(n?.[`sugars${suffix}`]), fiber: round(n?.[`fiber${suffix}`]),
    protein: round(n?.[`proteins${suffix}`]), salt: round(n?.[`salt${suffix}`], 2),
    sodiumMg: typeof sodium === "number" ? Math.round(sodium * 1000) : undefined,
  };
}
const hasAny = (n: Nutrients) => Object.values(n).some(v => v !== undefined);

function toProduct(h: any): FoodProduct | null {
  const name = String(h?.product_name ?? "").trim();
  if (!name) return null;
  const brand = Array.isArray(h.brands) ? h.brands.join(", ") : String(h.brands ?? "");
  const perServing = nutrients(h.nutriments, "_serving");
  return {
    code: String(h.code ?? ""), name, brand,
    image: h.image_front_small_url || undefined,
    servingSize: h.serving_size || undefined,
    per100g: nutrients(h.nutriments, "_100g"),
    perServing: hasAny(perServing) ? perServing : undefined,
    allergens: uniq((h.allergens_tags ?? []).map(tagName)),
    traces: uniq((h.traces_tags ?? []).map(tagName)),
    ingredients: typeof h.ingredients_text === "string" ? h.ingredients_text.slice(0, 1200) : undefined,
  };
}

let brightDataRequests = 0;

async function fetchJson(url: string): Promise<{ body: any; source: FoodSearch["source"] }> {
  const key = process.env.BRIGHTDATA_API_KEY, zone = process.env.BRIGHTDATA_ZONE;
  if (key && zone) {
    try {
      const r = await fetch("https://api.brightdata.com/request", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ zone, url, format: "raw" }),
        signal: AbortSignal.timeout(20_000),
      });
      brightDataRequests++;
      console.log(`[nutrition] Bright Data request #${brightDataRequests} this server session (HTTP ${r.status})`);
      const text = await r.text();
      // Bright Data reports some failures as HTTP 200 with a plain-text message instead of the page
      if (r.ok && /^\s*[{[]/.test(text)) return { body: JSON.parse(text), source: "brightdata" };
      console.warn(`[nutrition] Bright Data ${r.ok ? "couldn't fetch the page" : `failed (HTTP ${r.status})`}, falling back to Open Food Facts:`, text.slice(0, 160));
    } catch (e: any) {
      console.warn("[nutrition] Bright Data error, falling back to Open Food Facts:", e?.message);
    }
  }
  const r = await fetch(url, { headers: { "User-Agent": "AllerGeez/0.1 (allergy safety hackathon app)" }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Food database returned ${r.status}`);
  return { body: await r.json(), source: "openfoodfacts" };
}

let tableReady: Promise<unknown> | null = null;
const ensureTable = () => (tableReady ??= sql`create table if not exists food_lookups (
  query text primary key, results jsonb not null, source text not null, created_at timestamptz default now())`);

export async function searchFoods(raw: string): Promise<FoodSearch> {
  const query = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
  if (query.length < 2) return { query, products: [], source: "cache" };

  await ensureTable();
  const cached = await sql`select results from food_lookups where query = ${query} and created_at > now() - make_interval(days => ${CACHE_DAYS})`;
  if (cached[0]) return { query, products: cached[0].results as FoodProduct[], source: "cache" };

  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=16&fields=${FIELDS}`;
  const { body, source } = await fetchJson(url);
  const seen = new Set<string>();
  const products = ((body?.hits ?? []).map(toProduct).filter(Boolean) as FoodProduct[])
    .sort((a, b) => Number(hasAny(b.per100g)) - Number(hasAny(a.per100g))) // ones with nutrition facts first
    .filter(p => { const k = `${p.name}|${p.brand}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 8);

  await sql`insert into food_lookups (query, results, source) values (${query}, ${JSON.stringify(products)}::jsonb, ${source})
            on conflict (query) do update set results = excluded.results, source = excluded.source, created_at = now()`;
  return { query, products, source };
}

/** Exact product by barcode (EAN/UPC), via Bright Data → Open Food Facts. Cached like searches. */
export async function lookupBarcode(raw: string): Promise<FoodSearch> {
  const code = raw.replace(/\D/g, "");
  const query = `barcode:${code}`;
  if (code.length < 8 || code.length > 14) return { query, products: [], source: "cache" };

  await ensureTable();
  const cached = await sql`select results from food_lookups where query = ${query} and created_at > now() - make_interval(days => ${CACHE_DAYS})`;
  if (cached[0]) return { query, products: cached[0].results as FoodProduct[], source: "cache" };

  // Uses the search endpoint (code:...) because Bright Data's no-KYC mode can't reach the /api/v2 product path (robots.txt).
  const { body, source } = await fetchJson(`https://search.openfoodfacts.org/search?q=code:${code}&page_size=1&fields=${FIELDS}`);
  const products = ((body?.hits ?? []).map(toProduct).filter(Boolean) as FoodProduct[]).slice(0, 1);
  await sql`insert into food_lookups (query, results, source) values (${query}, ${JSON.stringify(products)}::jsonb, ${source})
            on conflict (query) do update set results = excluded.results, source = excluded.source, created_at = now()`;
  return { query, products, source };
}

export type ProductMatch = FoodSearch & {
  /** true when products are the same brand as the photo; false means `products` are only similar suggestions */
  exact: boolean;
};

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const FILLER = new Set(["the", "and", "with", "of", "pack", "count", "ct", "oz", "g", "box", "bag", "family", "size", "value"]);
const words = (t: string) => norm(t).split(" ").filter(w => w.length > 1 && !FILLER.has(w) && !/^\d+$/.test(w));

function sameBrand(brand: string, p: FoodProduct) {
  const b = norm(brand), pb = norm(p.brand);
  if (!b) return true;
  // Every brand word appears in the product's brand/name ("Pure Organic" ⊂ "Pure Organic Layered Bars"),
  // or the product's whole brand appears in what was read ("Ferrero Nutella" ⊃ "Nutella")
  const bw = words(brand), have = new Set(words(`${p.brand} ${p.name}`));
  return (bw.length > 0 && bw.every(w => have.has(w))) || (pb.length >= 4 && b.includes(pb));
}

/** How well a product name matches what was read off the package (share of words in common). */
function nameScore(target: string, p: FoodProduct) {
  const want = new Set(words(target)), have = new Set(words(`${p.name} ${p.brand}`));
  if (!want.size) return 0;
  let hit = 0; want.forEach(w => { if (have.has(w) || [...have].some(h => h.startsWith(w) || w.startsWith(h))) hit++; });
  return hit / want.size;
}

/** Find a packaged product from what Gemini read off the photo: barcode first, then brand + name. */
export async function identifyProduct(opts: { barcode?: string; brand?: string; name?: string }): Promise<ProductMatch> {
  if (opts.barcode) {
    const byCode = await lookupBarcode(opts.barcode);
    if (byCode.products.length) return { ...byCode, exact: true };
  }
  const brand = (opts.brand ?? "").trim(), name = (opts.name ?? "").trim();
  const nameOnly = words(name).filter(w => !words(brand).includes(w)).join(" ");
  const target = `${brand} ${name}`;
  const completeness = (p: FoodProduct) => (hasAny(p.per100g) ? 0.15 : 0) + (p.allergens.length ? 0.1 : 0);
  const rank = (list: FoodProduct[]) => [...list].sort((a, b) => (nameScore(target, b) + completeness(b)) - (nameScore(target, a) + completeness(a)));

  // 1) Search within the brand (Open Food Facts supports brands:"..." filters), 2) plain search as a fallback
  const attempts = brand ? [`brands:"${brand}" ${nameOnly}`.trim(), `${brand} ${nameOnly}`.trim()] : [name];
  let suggestions: FoodSearch | null = null;
  for (const q of attempts) {
    const found = await searchFoods(q);
    const matches = brand ? found.products.filter(p => sameBrand(brand, p)) : found.products.filter(p => nameScore(name, p) >= 0.5);
    if (matches.length) return { ...found, products: rank(matches), exact: true };
    suggestions ??= found;
  }
  // Nothing from the same brand: return similar items as suggestions only (never auto-selected)
  return { ...(suggestions ?? { query: target, source: "cache" as const, products: [] }), products: rank(suggestions?.products ?? []), exact: false };
}
