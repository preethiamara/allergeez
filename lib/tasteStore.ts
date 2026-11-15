// Taste profile storage (likes, diet) and the full per-user taste profile.
import { sql } from "@/lib/db";

const DIETS = ["", "vegetarian", "vegan", "pescatarian", "gluten-free", "dairy-free", "halal", "kosher"];

export async function getTaste(userId: string): Promise<{ likes: string[]; diet: string }> {
  const [row] = await sql`select taste_likes, diet from profiles where id = ${userId}`;
  return { likes: row?.taste_likes ?? [], diet: row?.diet ?? "" };
}

export async function saveTaste(userId: string, likes: unknown, diet: unknown) {
  const clean = (Array.isArray(likes) ? likes : []).map(x => String(x).trim().toLowerCase().slice(0, 30)).filter(Boolean);
  const l = [...new Set(clean)].slice(0, 12);
  const d = DIETS.includes(String(diet ?? "")) ? String(diet ?? "") : "";
  await sql`insert into profiles (id, taste_likes, diet) values (${userId}, ${l}, ${d})
            on conflict (id) do update set taste_likes = excluded.taste_likes, diet = excluded.diet`;
  return { likes: l, diet: d };
}

/** This user's full taste profile (likes, diet, inferred favorites, allergens, likely irritants). */
export async function tasteProfileFor(userId: string) {
  const [{ listMeals, listReactions, getProfile }, { buildTasteProfile }] = await Promise.all([import("@/lib/records"), import("@/lib/taste")]);
  const [meals, reactions, profile, taste] = await Promise.all([listMeals(userId), listReactions(userId), getProfile(userId), getTaste(userId)]);
  return buildTasteProfile({
    meals, reactions: reactions.map(r => ({ id: r.id, food: r.food, severity: r.severity, occurredAt: r.occurredAt })),
    allergens: profile.allergens, likes: taste.likes, diet: taste.diet,
  });
}
