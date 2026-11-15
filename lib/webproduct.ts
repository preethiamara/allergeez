import { GoogleGenAI } from "@google/genai";
import { sql } from "@/lib/db";
import { brightDataFetch, ensureTable, type FoodProduct } from "@/lib/nutrition";

// When a packaged food isn't in Open Food Facts, find its label on the open web:
// 1) a Bing search through Bright Data, 2) open the best-matching page (brand site or retailer) through Bright Data,
// 3) Gemini reads the ingredient list and "Contains" allergen statement off that page.
// Costs 2 Bright Data requests per new product; hits and misses are cached in Neon.

const CACHE_DAYS = 14;
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"].filter(Boolean) as string[];

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const stripTags = (h: string) => decode(h.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => norm(t).split(" ").filter(w => w.length > 2 && !["the", "and", "with", "protein"].includes(w));

type Result = { url: string; title: string; snippet: string };

/** Bing wraps result links as /ck/a?...&u=a1<base64url>; unwrap to the real URL. */
function unwrapBing(href: string) {
  const h = decode(href);
  const u = h.match(/[?&]u=a1([^&]+)/)?.[1];
  if (!u) return h.startsWith("http") ? h : "";
  try { return Buffer.from(u.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch { return ""; }
}

function parseBing(html: string): Result[] {
  const out: Result[] = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/g)) {
    const url = unwrapBing(m[1]);
    if (url.startsWith("http")) out.push({ url, title: stripTags(m[2]), snippet: stripTags(m[3]).slice(0, 400) });
  }
  return out;
}

// Recipe blogs and video sites never have the product's real label
const SKIP = /pinterest|youtube|tiktok|facebook|instagram|reddit|allrecipes|recipe|blog|wikipedia/i;

function pickResult(results: Result[], brand: string, name: string) {
  const bw = words(brand), nw = words(name).filter(w => !bw.includes(w));
  const scored = results.filter(r => !SKIP.test(r.url)).map(r => {
    const hay = norm(`${r.title} ${r.url} ${r.snippet}`).replace(/ /g, " ");
    const squashed = hay.replace(/ /g, "");
    const brandHit = bw.length > 0 && bw.every(w => hay.includes(w)) || squashed.includes(bw.join(""));
    const nameHit = nw.length ? nw.filter(w => hay.includes(w)).length / nw.length : 0;
    const label = /ingredient|contains|allergen/i.test(r.snippet) ? 0.3 : 0;
    return { r, brandHit, score: (brandHit ? 1 : 0) + nameHit + label };
  }).filter(x => x.brandHit).sort((a, b) => b.score - a.score);
  return scored[0]?.r;
}

/** The parts of a product page that matter: title, structured data, and text around "ingredients"/"contains". */
function pageExcerpt(html: string) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join(" ").slice(0, 2500);
  const text = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " "));
  const windows: string[] = [];
  for (const m of text.matchAll(/ingredients?|contains|allergen|may contain|nutrition facts/gi)) {
    const i = m.index ?? 0;
    if (windows.length >= 6) break;
    windows.push(text.slice(Math.max(0, i - 80), i + 900));
  }
  return `PAGE TITLE: ${title}\nSTRUCTURED DATA: ${ld}\nPAGE TEXT:\n${(windows.length ? windows.join("\n…\n") : text.slice(0, 4000)).slice(0, 7000)}`;
}

/** Google results page as plain text: fast through Bright Data, and its snippets often quote the label. */
function googleText(html: string) {
  const t = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  const i = t.search(/Web results|Search Results/i);
  return t.slice(i > 0 ? i : 0, (i > 0 ? i : 0) + 5000);
}

async function readLabel(brand: string, name: string, pageUrl: string, page: string, snippets: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = `Find the food label for this packaged product: brand "${brand}", product "${name}".
Below is text from a web page (${pageUrl}) and search-result snippets. Copy the product's ingredient list and allergen statement exactly as written. Do not guess or add anything that isn't in the text.
If the page is about a different product or flavor, use the snippets only if they clearly describe this exact product; otherwise set found=false.
Return JSON only:
{"found": boolean, "complete": boolean (true only if the full ingredient list is shown, not cut off with "..." or "…"), "name": "product name as shown", "brand": "brand", "ingredients": "full ingredient list text, or ''", "allergens": ["from 'Contains:' or bolded allergens, plain words like milk, soy, tree nuts"], "traces": ["from 'May contain' / 'made in a facility with'"], "servingSize": "or ''"}

${page}

SEARCH SNIPPETS:
${snippets}`;
  for (const model of MODELS) {
    try {
      const res = await Promise.race([
        ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json", temperature: 0 } }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 20_000)),
      ]);
      const j = JSON.parse((res.text ?? "").replace(/^```(?:json)?|```$/g, "").trim());
      return j;
    } catch (e: any) { console.warn(`[webproduct] ${model}:`, String(e?.message).slice(0, 120)); }
  }
  return null;
}

export async function findProductOnWeb(brand: string, name: string): Promise<FoodProduct | null> {
  const query = `web:${norm(`${brand} ${name}`)}`.slice(0, 160);
  await ensureTable();
  const cached = await sql`select results from food_lookups where query = ${query} and created_at > now() - make_interval(days => ${CACHE_DAYS})`;
  if (cached[0]) return (cached[0].results as FoodProduct[])[0] ?? null;

  const save = async (p: FoodProduct | null) => {
    await sql`insert into food_lookups (query, results, source) values (${query}, ${JSON.stringify(p ? [p] : [])}::jsonb, 'brightdata-web')
              on conflict (query) do update set results = excluded.results, source = excluded.source, created_at = now()`;
    return p;
  };

  const q = encodeURIComponent(`${brand} ${name} ingredients`);
  // Google answers in a few seconds but hides result links; Bing is slower but gives links to open. Start both.
  const googleP = brightDataFetch(`https://www.google.com/search?q=${q}&hl=en&gl=us`, 20_000);
  const bingP = brightDataFetch(`https://www.bing.com/search?q=${q}`, 50_000);

  // 1) Often a snippet already quotes the full label
  const google = await googleP;
  const gText = google?.ok ? googleText(google.text) : "";
  let label: any = null, sourceUrl = "", site = "";
  if (gText) {
    const quick = await readLabel(brand, name, "google.com search results", "(no page; use the snippets)", gText);
    if (quick?.found && quick.complete && String(quick.ingredients ?? "").trim()) {
      label = quick;
      sourceUrl = `https://www.google.com/search?q=${q}`; site = "Google search";
    }
  }

  // 2) Otherwise open the best-matching product page from Bing's results
  if (!label) {
    const bing = await bingP;
    const results = bing?.ok ? parseBing(bing.text) : [];
    const best = pickResult(results, brand, name);
    if (best) {
      const page = await brightDataFetch(best.url, 30_000);
      const excerpt = page?.ok ? pageExcerpt(page.text) : "(page could not be loaded)";
      const snippets = [gText, ...results.slice(0, 6).map(r => `- ${r.title} (${new URL(r.url).hostname}): ${r.snippet}`)].join("\n");
      label = await readLabel(brand, name, best.url, excerpt, snippets);
      sourceUrl = best.url; site = new URL(best.url).hostname.replace(/^www\./, "");
    } else if (!bing?.ok && !gText) return null; // both searches failed: don't cache, try again next time
  }
  if (!label?.found || !String(label.ingredients ?? "").trim()) return save(null);

  const list = (a: unknown) => Array.isArray(a) ? [...new Set(a.map(x => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 15) : [];
  // "May contain" items belong in traces only, unless they're actually in the ingredient list
  const ingredients = String(label.ingredients).slice(0, 1200), ingLower = ingredients.toLowerCase();
  const traces = list(label.traces);
  const allergens = list(label.allergens).filter(a => !traces.includes(a) || ingLower.includes(a.replace(/s$/, "")));
  return save({
    code: `web:${site}`, name: String(label.name || name).slice(0, 120), brand: String(label.brand || brand).slice(0, 80),
    servingSize: label.servingSize || undefined, per100g: {},
    allergens, traces: traces.filter(t => !allergens.includes(t)), ingredients,
    sourceUrl, sourceSite: site,
  });
}
