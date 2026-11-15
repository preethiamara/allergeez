// Likely-irritant detection. Plain, explainable scoring (no AI) shared by the browser and the Gee agent.
//
// For every reaction we find the meals eaten shortly before it (the linked meal, plus anything logged in the
// 6 hours before). Each ingredient / allergy group in those meals is an "exposure before a reaction".
// An item scores high when it shows up before MANY of your reactions (consistency) and when eating it is
// usually followed by a reaction (reaction rate), more so for severe and fast reactions. Ingredients you
// flagged yourself get a small boost. Confidence grows with the number of reactions behind it.
import { allergyGroup, allergenMatches } from "./allergens";
import { ingredientsOnly } from "./ingredients";

export type IrritantMeal = { id: number; name: string; flags: string[]; ingredients: { name: string; flagged: boolean }[]; createdAt: string };
export type IrritantReaction = { id: number; food: string; severity: number; occurredAt: string };
export type Irritant = {
  name: string;               // "Peanuts" (allergy group) or "sesame oil" (ingredient)
  kind: "group" | "ingredient";
  score: number;              // 0–1
  confidence: "low" | "medium" | "high";
  reactionsWith: number;      // reactions preceded by this item
  totalReactions: number;
  timesEaten: number;         // meals containing it
  timesFollowedByReaction: number;
  flagged: boolean;
  onYourList: boolean;
  why: string;
};

const WINDOW_MS = 6 * 60 * 60 * 1000;   // look back 6 hours before a reaction
const FAST_MS = 2 * 60 * 60 * 1000;     // reactions within 2 hours count more
const norm = (s: string) => s.trim().toLowerCase();
const GENERIC = new Set(["water", "salt", "sugar", "pepper", "oil", "vegetable oil", "spices", "mixed fresh ingredients", "food photo"]);

/** The items a meal exposes you to: its allergy groups, plus its specific ingredients. */
function itemsOf(meal: IrritantMeal): { key: string; name: string; kind: "group" | "ingredient"; flagged: boolean }[] {
  const out = new Map<string, { key: string; name: string; kind: "group" | "ingredient"; flagged: boolean }>();
  const addGroup = (word: string, flagged = false) => {
    const g = allergyGroup(word);
    const key = `g:${norm(g)}`;
    const cur = out.get(key);
    out.set(key, { key, name: g, kind: "group", flagged: flagged || !!cur?.flagged });
  };
  for (const f of meal.flags) addGroup(f);
  // Only real ingredients count; product / dish names saved by older versions are skipped
  for (const ing of ingredientsOnly(meal.ingredients, meal.name)) {
    const n = norm(ing.name);
    if (!n || GENERIC.has(n)) continue;
    out.set(`i:${n}`, { key: `i:${n}`, name: ing.name.trim(), kind: "ingredient", flagged: ing.flagged });
    // An ingredient that belongs to a known group also counts toward that group
    const g = allergyGroup(n);
    if (g.toLowerCase() !== n) addGroup(n, ing.flagged);
  }
  return [...out.values()];
}

/** Meals that plausibly caused this reaction: the linked meal and anything eaten in the hours before. */
export function mealsBefore(reaction: IrritantReaction, meals: IrritantMeal[]) {
  const at = new Date(reaction.occurredAt).getTime();
  return meals
    .map(m => ({ meal: m, gap: at - new Date(m.createdAt).getTime() }))
    .filter(({ meal, gap }) => (reaction.food && norm(meal.name) === norm(reaction.food)) || (gap >= -15 * 60 * 1000 && gap <= WINDOW_MS));
}

export function findLikelyIrritants(meals: IrritantMeal[], reactions: IrritantReaction[], allergens: string[] = [], limit = 6): Irritant[] {
  if (!reactions.length || !meals.length) return [];
  const stats = new Map<string, { name: string; kind: "group" | "ingredient"; flagged: boolean; weighted: number; reactionIds: Set<number>; mealIds: Set<number>; followedMealIds: Set<number> }>();
  const touch = (it: ReturnType<typeof itemsOf>[number]) => {
    let s = stats.get(it.key);
    if (!s) { s = { name: it.name, kind: it.kind, flagged: false, weighted: 0, reactionIds: new Set(), mealIds: new Set(), followedMealIds: new Set() }; stats.set(it.key, s); }
    s.flagged ||= it.flagged;
    return s;
  };

  // How often each item is eaten at all (the baseline)
  for (const m of meals) for (const it of itemsOf(m)) touch(it).mealIds.add(m.id);

  // Which items came before each reaction, weighted by severity and how fast the reaction followed
  for (const r of reactions) {
    const sev = r.severity > 0 ? Math.min(1, r.severity / 10) : 0.5;
    const seen = new Set<string>();
    for (const { meal, gap } of mealsBefore(r, meals)) {
      const speed = gap <= FAST_MS ? 1 : 0.6;
      for (const it of itemsOf(meal)) {
        const s = touch(it);
        s.followedMealIds.add(meal.id);
        if (seen.has(it.key)) continue;
        seen.add(it.key);
        s.reactionIds.add(r.id);
        s.weighted += sev * speed;
      }
    }
  }

  const total = reactions.length;
  const results: Irritant[] = [];
  for (const s of stats.values()) {
    const reactionsWith = s.reactionIds.size;
    if (!reactionsWith) continue;
    // With enough history, a single coincidence isn't a pattern (unless you flagged it yourself)
    if (total >= 3 && reactionsWith < 2 && s.kind === "ingredient" && !s.flagged) continue;
    const timesEaten = Math.max(s.mealIds.size, s.followedMealIds.size);
    const followed = s.followedMealIds.size;
    const consistency = reactionsWith / total;                 // shows up before most reactions?
    const rate = timesEaten ? followed / timesEaten : 0;        // usually followed by a reaction?
    const intensity = s.weighted / reactionsWith;               // severe / fast reactions
    const groupBonus = s.kind === "group" ? 0.05 : 0;          // groups aggregate evidence across ingredients
    const score = Math.min(1, 0.45 * consistency + 0.3 * rate + 0.15 * intensity + (s.flagged ? 0.1 : 0) + groupBonus);
    const confidence = reactionsWith >= 3 && rate >= 0.6 ? "high" : reactionsWith >= 2 && rate >= 0.4 ? "medium" : "low";
    const onYourList = allergens.some(a => allergenMatches(a, s.name) || allergyGroup(a) === s.name);
    const why = [
      `Before ${reactionsWith} of your ${total} reaction${total > 1 ? "s" : ""}`,
      timesEaten ? `eaten ${timesEaten} time${timesEaten > 1 ? "s" : ""}, ${followed} followed by a reaction (${Math.round(rate * 100)}%)` : "",
      s.flagged ? "you flagged it" : "",
    ].filter(Boolean).join("; ");
    results.push({ name: s.name, kind: s.kind, score: Math.round(score * 100) / 100, confidence, reactionsWith, totalReactions: total, timesEaten, timesFollowedByReaction: followed, flagged: s.flagged, onYourList, why });
  }

  // Prefer allergy groups over the individual ingredients they contain when both score the same
  return results
    .sort((a, b) => b.score - a.score || (a.kind === "group" ? -1 : 1))
    .filter((it, i, arr) => it.kind === "group" || !arr.slice(0, i).some(g => g.kind === "group" && g.name === allergyGroup(it.name) && g.score >= it.score))
    .slice(0, limit);
}
