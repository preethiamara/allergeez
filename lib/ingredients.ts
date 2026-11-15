// Ingredient hygiene shared by the browser, the API and the Gee agent.
// Meals should list INGREDIENTS (oats, chia seeds, walnuts), never whole products
// ("Pure Organic Fruit Layered Bars Variety Pack") or the dish itself.

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** "Protein blend (likely pea or whey)" → "Protein blend"; "Possible emulsifiers" → "emulsifiers". */
export function cleanIngredientName(raw: string) {
  return raw
    .replace(/\((?:likely|possibly|probably|maybe|may be|e\.g\.|such as|or similar)[^)]*\)/gi, "")
    .replace(/^\s*(?:possibl[ey]|likely|probably|maybe|some)\s+/i, "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\s.,;:]+$/, "")
    .trim();
}

/** True when this looks like a product / dish name rather than an ingredient. */
export function isProductName(raw: string, mealName = "") {
  const name = raw.trim();
  if (!name) return true;
  if (/variety pack|multi ?pack|\bpack\b|\d+\s*(?:ct|count|oz|g|ml|pk)\b|®|™|\s[-–—|]\s/i.test(name)) return true;
  const core = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (core.split(" ").length > 6 || core.length > 48) return true;
  // The meal's own name ("Chia Love Overnight Oats") isn't one of its ingredients
  const n = norm(core), m = norm(mealName);
  return !!m && n.split(" ").length >= 3 && (n === m || m.includes(n) || n.includes(m));
}

/** Clean a meal's ingredient names, drop product names, and dedupe. */
export function ingredientsOnly<T extends { name: string }>(list: T[], mealName = ""): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of list) {
    const name = cleanIngredientName(it.name);
    const key = norm(name);
    if (!key || seen.has(key) || isProductName(name, mealName)) continue;
    seen.add(key);
    out.push({ ...it, name });
  }
  return out;
}

/** "Oats, chia seeds, sugars (cane sugar, tapioca syrup), natural flavors." → top-level ingredients */
export function splitIngredients(text: string) {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of text.replace(/^\s*ingredients?\s*:\s*/i, "")) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";") && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.replace(/[.*]+$/g, "").replace(/\*/g, "").trim()).filter(x => x && x.length < 120).slice(0, 40);
}
