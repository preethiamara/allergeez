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
