import { sql } from "@/lib/db";

export const USER_ID = "demo"; // single demo user; add auth later

export type Meal = { id: number; name: string; details: string; flags: string[]; createdAt: string };
export type Reaction = {
  id: number; symptoms: string; severity: number; duration: string; food: string;
  occurredAt: string; createdAt: string;
};
export type Profile = { allergens: string[]; contact_name: string; contact_phone: string };

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : "");

export const toMeal = (r: any): Meal => ({
  id: r.id, name: r.name, details: r.details ?? "", flags: r.flags ?? [], createdAt: iso(r.created_at),
});

export const toReaction = (r: any): Reaction => ({
  id: r.id,
  symptoms: r.symptoms || r.suspected_trigger || "Reaction",
  severity: r.severity ?? 0,
  duration: r.duration || "Not recorded",
  food: r.meal_name || "No related meal added",
  occurredAt: iso(r.occurred_at ?? r.created_at),
  createdAt: iso(r.created_at),
});

export async function listMeals() {
  const rows = await sql`select * from meals where user_id = ${USER_ID} order by created_at desc limit 200`;
  return rows.map(toMeal);
}

export async function listReactions() {
  const rows = await sql`select * from reactions where user_id = ${USER_ID} order by coalesce(occurred_at, created_at) desc limit 200`;
  return rows.map(toReaction);
}

export async function getProfile(): Promise<Profile> {
  const rows = await sql`select * from profiles where id = ${USER_ID}`;
  const p = rows[0];
  return { allergens: p?.allergens ?? [], contact_name: p?.contact_name ?? "", contact_phone: p?.contact_phone ?? "" };
}
