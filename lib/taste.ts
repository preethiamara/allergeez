// The user's taste profile, and how well a restaurant dish fits it.
// Built from what they actually log (foods they eat often and didn't react to), what they tell us
// (likes, diet), and what to avoid (their allergens + likely irritants). Scoring is plain and explainable.
import { allergenMatches, allergyGroup, editDistance, foodAllergens } from "./allergens";
import { ingredientsOnly } from "./ingredients";
import { findLikelyIrritants, mealsBefore, type IrritantMeal, type IrritantReaction } from "./irritants";

export type Diet = "" | "vegetarian" | "vegan" | "pescatarian" | "gluten-free" | "dairy-free" | "halal" | "kosher";
export type TasteProfile = {
  likes: string[];          // what they told us ("spicy", "thai", "noodles")
  inferredLikes: string[];  // foods / ingredients they log often without reacting
  diet: Diet;
  avoid: string[];          // their allergens
  irritants: string[];      // likely irritants found in their history (medium/high confidence)
};
export type MenuDish = { dish: string; price?: string; description?: string; contains: string[]; may_contain: string[]; tags: string[] };
export type DishMatch = MenuDish & { score: number; verdict: "great" | "ok" | "ask" | "avoid"; reasons: string[]; yours: string[]; yours_maybe: string[] };

const STOP = new Set(["with", "and", "the", "fresh", "served", "side", "sauce", "style", "house", "special", "of", "in", "on", "a", "or", "our",
  // label words that aren't tastes
  "blend", "natural", "flavor", "flavors", "flavour", "concentrate", "organic", "powder", "extract", "puree", "juice", "syrup", "oil", "salt", "sugar",
  "water", "free", "gluten", "mix", "new", "meal", "food", "ingredient", "dressing", "possibly", "likely", "seed", "protein", "overnight",
  "rolled", "whole", "grain", "fair", "trade", "date", "pack", "variety", "bar", "sea", "leaf", "cane", "flour"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w))
  .map(w => (w.endsWith("ies") && w.length > 4 ? `${w.slice(0, -3)}y` : w.length > 4 && !w.endsWith("ss") ? w.replace(/s$/, "") : w))
  .filter(w => !STOP.has(w));

export function buildTasteProfile(opts: {
  meals: IrritantMeal[]; reactions: IrritantReaction[]; allergens: string[]; likes?: string[]; diet?: string;
}): TasteProfile {
  const irritants = findLikelyIrritants(opts.meals, opts.reactions, opts.allergens, 8)
    .filter(i => i.confidence !== "low").map(i => i.name);
  // Meals that came shortly before a reaction don't count as "liked"
  const suspect = new Set(opts.reactions.flatMap(r => mealsBefore(r, opts.meals).map(x => x.meal.id)));
  const counts = new Map<string, number>();
  for (const m of opts.meals) {
    if (suspect.has(m.id)) continue;
    // Ingredients say what they like; product names mostly add brand words ("Chia Love", "Prana")
    const ings = ingredientsOnly(m.ingredients, m.name).map(i => i.name);
    const items = ings.length ? ings : [m.name];
    for (const w of new Set(items.flatMap(words))) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const inferredLikes = [...counts.entries()]
    .filter(([w, n]) => n >= 2 && !opts.allergens.some(a => allergenMatches(a, w)) && !irritants.some(i => allergenMatches(i, w)))
    .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
  return {
    likes: (opts.likes ?? []).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 12),
    inferredLikes, diet: (opts.diet ?? "") as Diet, avoid: foodAllergens(opts.allergens), irritants,
  };
}

// Ingredient words always beat AI tags: a "vegetarian" tag on a brisket bowl is wrong, not a reason to recommend it.
const MEAT = /\b(beef|pork|chicken|turkey|lamb|mutton|goat|venison|bison|bacon|ham|sausages?|pepperoni|steak|burgers?|meatballs?|meatloaf|duck|veal|chorizo|prosciutto|salami|pastrami|brisket|ribs?|wings?|carnitas|barbacoa|birria|al pastor|carne asada|asada|pollo|chicharr[oó]n|gyros?|shawarma|kebabs?|kabobs?|hot ?dogs?|jerky|lard|gelatin|bone broth|chicken broth|beef broth|oxtail|liver|tripe|nuggets?|tenders?|drumsticks?|cutlets?|pulled pork|pancetta|guanciale|mortadella|capicola|kielbasa|bratwurst|meat)\b/i;
const SEAFOOD = /\b(fish|salmon|tuna|cod|tilapia|halibut|trout|mahi|shrimp|prawns?|crab|lobster|clams?|mussels?|oysters?|scallops?|anchov(y|ies)|calamari|squid|octopus|eel|sushi|sashimi|poke|ceviche|fish sauce|oyster sauce|bonito|dashi|caviar|roe)\b/i;
const DAIRY = /\b(cheese|cheddar|monterey jack|cream|sour cream|butter|ghee|milk|yogurt|paneer|mozzarella|parmesan|ricotta|feta|alfredo|queso|crema|custard|whey)\b/i;
const EGG = /\b(eggs?|omelett?e|mayo|mayonnaise|aioli|meringue|custard|frittata)\b/i;
const PORK = /\b(pork|bacon|ham|pepperoni|prosciutto|salami|chorizo|carnitas|al pastor|pancetta|guanciale|lard|pulled pork|kielbasa|bratwurst|mortadella|capicola)\b/i;

/** Does a dish break the user's diet ("conflict"), or clearly fit it ("fits")? Unknown → neither. */
function dietCheck(diet: Diet, d: MenuDish): { conflict: string; fits: boolean } {
  const text = `${d.dish} ${d.description ?? ""}`, tags = d.tags.map(t => t.toLowerCase());
  const group = (g: string) => d.contains.some(c => allergyGroup(c) === g);
  const meat = MEAT.test(text), sea = SEAFOOD.test(text) || group("Fish") || group("Shellfish");
  const dairy = DAIRY.test(text) || group("Dairy"), egg = EGG.test(text) || group("Eggs");
  switch (diet) {
    case "vegetarian": return meat || sea ? { conflict: meat ? "has meat" : "has seafood", fits: false } : { conflict: "", fits: tags.includes("vegetarian") || tags.includes("vegan") };
    case "vegan": return meat || sea || dairy || egg || /\bhoney\b/i.test(text)
      ? { conflict: meat ? "has meat" : sea ? "has seafood" : dairy ? "has dairy" : egg ? "has egg" : "has honey", fits: false } : { conflict: "", fits: tags.includes("vegan") };
    case "pescatarian": return meat ? { conflict: "has meat", fits: false } : { conflict: "", fits: true };
    case "gluten-free": return group("Wheat / gluten") ? { conflict: "has gluten", fits: false } : { conflict: "", fits: tags.includes("gluten-free") };
    case "dairy-free": return dairy ? { conflict: "has dairy", fits: false } : { conflict: "", fits: !!d.contains.length };
    case "halal": case "kosher": return PORK.test(text) ? { conflict: "has pork", fits: false } : { conflict: "", fits: false };
    default: return { conflict: "", fits: false };
  }
}

// What common dishes are made of, when the menu doesn't say (so "Guacamole" is caught for an avocado allergy)
const HIDDEN: [RegExp, string][] = [
  [/\bguac(amole)?\b/i, "avocado lime onion cilantro"],
  [/\b(hummus|houmous)\b/i, "chickpea sesame tahini garlic"],
  [/\bfalafel\b/i, "chickpea sesame"],
  [/\bbaba ?gh?anoush\b/i, "eggplant sesame tahini"],
  [/\bpesto\b/i, "pine nut tree nut basil parmesan dairy garlic"],
  [/\b(aioli|mayo|mayonnaise|remoulade|tartar sauce)\b/i, "egg"],
  [/\b(tzatziki|raita)\b/i, "yogurt dairy cucumber"],
  [/\bmole\b/i, "chocolate peanut sesame chili"],
  [/\b(satay|sate)\b/i, "peanut"],
  [/\bpad thai\b/i, "peanut egg fish sauce rice noodle"],
  [/\b(caesar)\b/i, "anchovy fish egg parmesan dairy"],
  [/\b(carbonara)\b/i, "egg dairy pork"],
  [/\b(alfredo|bechamel|béchamel|mac (and|&|n) cheese|queso)\b/i, "dairy cheese"],
  [/\b(tikka masala|korma|butter chicken)\b/i, "dairy cream cashew tree nut"],
  [/\b(tempura)\b/i, "wheat egg"],
  [/\b(teriyaki|soy sauce|miso|edamame|tofu)\b/i, "soy"],
  [/\bseitan\b/i, "wheat gluten"],
  [/\branch\b/i, "dairy egg"],
  [/\b(nutella)\b/i, "hazelnut tree nut"],
  [/\b(marzipan|frangipane|amaretti|macarons?)\b/i, "almond tree nut"],
  [/\bbaklava\b/i, "walnut pistachio tree nut honey wheat"],
  [/\b(salsa|pico de gallo|marinara|ketchup|bruschetta)\b/i, "tomato onion"],
  [/\b(tortilla chips|chips (and|&) (salsa|guac)|nachos|tamales?|elote|polenta|grits)\b/i, "corn"],
  [/\b(gnocchi)\b/i, "potato wheat egg"],
  [/\b(curry)\b/i, "spices"],
];

/** Every word that describes what's in a dish: name, description, tags, listed allergens, plus hidden ingredients. */
function dishWords(d: MenuDish) {
  // "(no guac)", "without cheese", "hold the onions": those aren't in the dish
  const text = `${d.dish} ${d.description ?? ""}`.replace(/\b(no|without|hold the|minus|sans|free of|-free)\s+[a-z]+(\s+(and|or|&)\s+[a-z]+)*/gi, " ").replace(/\b[a-z]+-free\b/gi, " ");
  const hidden = HIDDEN.filter(([re]) => re.test(text)).map(([, w]) => w).join(" ");
  return `${text} ${d.tags.join(" ")} ${d.contains.join(" ")} ${hidden}`.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(w => w.length > 2);
}

/** Is this allergen in these words? Whole words, plurals, and small misspellings ("avacado", "peanutss"). */
function mentions(words: string[], allergen: string) {
  const parts = allergen.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!parts.length) return false;
  const close = (w: string, p: string) => {
    const a = w.replace(/(es|s)$/, ""), b = p.replace(/(es|s)$/, "");
    if (a === b) return true;
    const limit = b.length >= 8 ? 2 : b.length >= 5 ? 1 : 0;
    return limit > 0 && Math.abs(a.length - b.length) <= limit && editDistance(a, b) <= limit;
  };
  return parts.every(p => words.some(w => close(w, p)));
}

/** Score every dish for this person: allergens rule a dish out; taste and diet rank the rest. */
export function matchDishes(dishes: MenuDish[], t: TasteProfile): DishMatch[] {
  const hit = (a: string) => t.avoid.some(p => allergenMatches(p, a) || allergyGroup(p) === allergyGroup(a));
  const likeWords = new Set(t.likes.flatMap(words)), inferred = new Set(t.inferredLikes);
  return dishes.map(d => {
    // Listed allergens, plus anything on their list named in the dish itself or its usual ingredients
    const dWords = dishWords(d);
    const yours = [...new Set([...d.contains.filter(hit), ...t.avoid.filter(a => mentions(dWords, a))])];
    const yours_maybe = d.may_contain.filter(hit).filter(a => !yours.includes(a));
    const text = words(`${d.dish} ${d.description ?? ""} ${d.tags.join(" ")}`);
    const liked = [...new Set(text.filter(w => likeWords.has(w) || t.likes.some(l => l.length > 3 && w.startsWith(l.slice(0, 4)))))];
    const usual = [...new Set(text.filter(w => inferred.has(w)))];
    const irritant = t.irritants.filter(i => d.contains.some(c => allergenMatches(i, c) || allergyGroup(i) === allergyGroup(c)) || text.includes(i.toLowerCase()));
    const diet = t.diet ? dietCheck(t.diet, d) : { conflict: "", fits: false };
    const dietIssue = diet.conflict;
    const reasons: string[] = [];
    let score = 50;
    if (liked.length) { score += 18 * Math.min(2, liked.length); reasons.push(`you like ${liked.slice(0, 2).join(", ")}`); }
    if (usual.length) { score += 8 * Math.min(2, usual.length); reasons.push(`like what you usually eat (${usual.slice(0, 2).join(", ")})`); }
    if (diet.fits) { score += 6; reasons.push(`fits ${t.diet}`); }
    if (dietIssue) { score -= 40; reasons.push(`${dietIssue}, not ${t.diet}`); }
    if (irritant.length) { score -= 25; reasons.push(`has ${irritant.slice(0, 2).join(", ")}, a possible trigger for you`); }
    if (!d.contains.length) score -= 4; // less known about it
    const verdict: DishMatch["verdict"] = yours.length || dietIssue ? "avoid" : yours_maybe.length || irritant.length ? "ask" : score >= 70 ? "great" : "ok";
    if (yours.length) reasons.unshift(`contains ${yours.join(", ")}`);
    else if (dietIssue) reasons.unshift(reasons.splice(reasons.indexOf(`${dietIssue}, not ${t.diet}`), 1)[0]);
    else if (yours_maybe.length) reasons.unshift(`may contain ${yours_maybe.join(", ")}`);
    return { ...d, score: yours.length || dietIssue ? 0 : Math.max(1, Math.min(99, score)), verdict, reasons, yours, yours_maybe };
  }).sort((a, b) => b.score - a.score);
}
