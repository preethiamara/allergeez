import { sql } from "@/lib/db";

export type Ingredient = { name: string; flagged: boolean };
export type Meal = { id: number; name: string; details: string; flags: string[]; ingredients: Ingredient[]; createdAt: string };
export type Reaction = {
  id: number; title: string; symptoms: string; symptomTags: string[]; severity: number; duration: string; food: string;
  occurredAt: string; createdAt: string;
};
export type Profile = { allergens: string[]; contact_name: string; contact_phone: string };

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : "");

export function cleanIngredients(list: unknown): Ingredient[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Ingredient[] = [];
  for (const item of list) {
    const name = String((item as any)?.name ?? item ?? "").trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, flagged: !!(item as any)?.flagged });
    if (out.length >= 40) break;
  }
  return out;
}

export const toMeal = (r: any): Meal => ({
  id: r.id, name: r.name, details: r.details ?? "", flags: r.flags ?? [],
  ingredients: cleanIngredients(r.ingredients), createdAt: iso(r.created_at),
});

export const toReaction = (r: any): Reaction => ({
  id: r.id,
  title: r.title || "",
  symptoms: r.symptoms || r.suspected_trigger || "Reaction",
  symptomTags: r.symptom_tags ?? [],
  severity: r.severity ?? 0,
  duration: r.duration || "Not recorded",
  food: r.meal_name || "No related meal added",
  occurredAt: iso(r.occurred_at ?? r.created_at),
  createdAt: iso(r.created_at),
});

export async function listMeals(userId: string) {
  const rows = await sql`select * from meals where user_id = ${userId} order by created_at desc limit 200`;
  return rows.map(toMeal);
}

export async function listReactions(userId: string) {
  const rows = await sql`select * from reactions where user_id = ${userId} order by coalesce(occurred_at, created_at) desc limit 200`;
  return rows.map(toReaction);
}

export async function getProfile(userId: string): Promise<Profile> {
  const rows = await sql`select * from profiles where id = ${userId}`;
  const p = rows[0];
  return { allergens: p?.allergens ?? [], contact_name: p?.contact_name ?? "", contact_phone: p?.contact_phone ?? "" };
}
