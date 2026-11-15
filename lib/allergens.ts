// Shared by server and browser: no database imports here.

/** Does a profile allergen ("dairy", "tree nuts", "wheat") match a product allergen ("milk", "tree nuts", "gluten")? */
const SYNONYMS: Record<string, string[]> = {
  dairy: ["milk"], milk: ["dairy"], wheat: ["gluten"], gluten: ["wheat"], soy: ["soybeans", "soya"],
  "tree nut": ["nuts", "tree nuts", "hazelnut", "almond", "cashew", "walnut"], egg: ["eggs"], shellfish: ["crustaceans", "molluscs"],
};
const stem = (s: string) => s.toLowerCase().trim().replace(/s$/, "");
export function allergenMatches(profileItem: string, productAllergen: string) {
  const a = stem(profileItem), b = stem(productAllergen);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  return (SYNONYMS[a] ?? []).some(s => stem(s) === b) || (SYNONYMS[b] ?? []).some(s => stem(s) === a);
}

// Common allergy groups, so "milk", "whey", "casein" all show as "Dairy", etc.
const GROUPS: [string, RegExp][] = [
  ["Eggs", /\b(eggs?|albumin|mayonnaise)\b/i],
  ["Peanuts", /\b(peanuts?|groundnuts?)\b/i],
  ["Tree nuts", /\b(tree ?nuts?|nuts|almonds?|hazelnuts?|cashews?|walnuts?|pecans?|pistachios?|macadamia|brazil nuts?)\b/i],
  // Dairy after the nut groups, so "peanut butter" / "almond milk" count as nuts, not dairy
  ["Dairy", /\b(dairy|milk|whey|casein|lactose|cheese|butter|cream|yogurt|ghee)\b/i],
  ["Wheat / gluten", /\b(wheat|gluten|barley|rye|spelt|semolina)\b/i],
  ["Soy", /\b(soy|soya|soybeans?|tofu|edamame)\b/i],
  ["Fish", /\b(fish|salmon|tuna|cod|anchov(y|ies))\b/i],
  ["Shellfish", /\b(shellfish|crustaceans?|molluscs?|shrimp|prawns?|crab|lobster|clams?|mussels?|oysters?|scallops?)\b/i],
  ["Sesame", /\b(sesame|tahini)\b/i],
  ["Mustard", /\bmustard\b/i],
  ["Sulphites", /\b(sulph|sulf)ites?\b/i],
];
/** Map an allergen word to its common group name ("hazelnut" → "Tree nuts"); unknown words are title-cased. */
export function allergyGroup(word: string): string {
  const w = word.trim();
  for (const [name, re] of GROUPS) if (re.test(w)) return name;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

// Other foods people commonly react to (beyond the major groups above)
const OTHER_FOOD_ALLERGENS = /\b(corn|maize|kiwi|banana|strawberr(y|ies)|tomato(es)?|celery|lupin|gelatin|chickpeas?|lentils?|peas|legumes?|oats?|buckwheat|coconut|avocado|garlic|onions?|chocolate|cocoa|citrus|oranges?|lemons?|apples?|peach(es)?|cherr(y|ies)|mango(es)?|pineapple|berries|grapes?|melon|beef|pork|chicken|red meat|alpha-?gal|msg|monosodium glutamate|food dyes?|red dye( 40)?|yellow dye|nightshades?|potato(es)?|rice|quinoa|mushrooms?|cinnamon|spices?|seeds?|sunflower( seeds?)?|poppy( seeds?)?|flax( ?seeds?)?|pine nuts?|caffeine|yeast|carrots?|latex fruits?)\b/i;

/** Instant check against known food allergens; null means "not sure, ask the AI". */
export function knownAllergen(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (GROUPS.some(([, re]) => re.test(t)) || OTHER_FOOD_ALLERGENS.test(t)) return t;
  return null;
}

const KNOWN_WORDS = ["dairy", "milk", "eggs", "peanuts", "tree nuts", "almonds", "hazelnuts", "cashews", "walnuts", "pecans", "pistachios",
  "macadamia", "wheat", "gluten", "barley", "rye", "soy", "tofu", "fish", "salmon", "tuna", "cod", "shellfish", "shrimp", "crab", "lobster",
  "sesame", "mustard", "sulphites", "corn", "kiwi", "banana", "strawberries", "tomatoes", "celery", "lupin", "gelatin", "chickpeas", "lentils",
  "oats", "buckwheat", "coconut", "avocado", "garlic", "onion", "chocolate", "cocoa", "citrus", "orange", "apple", "peach", "cherry", "mango",
  "pineapple", "beef", "pork", "chicken", "potato", "rice", "mushroom", "cinnamon", "sunflower seeds", "poppy seeds", "flaxseed", "pine nuts",
  "yeast", "carrot", "lactose", "casein", "whey"];

function editDistance(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Likely misspelling of a known allergen ("penuts" → "peanuts"), or null. */
export function allergenTypo(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return null;
  let best: string | null = null, bestD = Infinity;
  for (const w of KNOWN_WORDS) {
    const dist = editDistance(t, w);
    if (dist < bestD) { bestD = dist; best = w; }
  }
  const limit = t.length <= 5 ? 1 : 2;
  return best && bestD > 0 && bestD <= limit ? best : null;
}
