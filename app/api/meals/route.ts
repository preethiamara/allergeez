import { sql } from "@/lib/db";
import { cleanIngredients, listMeals, toMeal } from "@/lib/records";
import { ingredientsOnly } from "@/lib/ingredients";
import { getActor } from "@/lib/session";

const fail = (e: any, what: string) => {
  console.error(`[meals] ${what}`, e);
  return Response.json({ error: `${what} failed: ${e?.message ?? "database error"}` }, { status: 500 });
};
const cleanFlags = (f: unknown) => Array.isArray(f) ? f.map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];

export async function GET() {
  try { const { userId } = await getActor(); return Response.json(await listMeals(userId)); }
  catch (e) { return fail(e, "Loading meals"); }
}

export async function POST(req: Request) {
  try {
    const { userId } = await getActor();
    const body = await req.json().catch(() => null);
    if (body?.kind === "not_food") return Response.json({ error: "That doesn’t look like food, so it can’t be saved. Try another photo." }, { status: 422 });
    const details = String(body?.details ?? "").trim().slice(0, 4000);
    const name = String(body?.name ?? "").trim().slice(0, 80) || "New meal";
    // Ingredients only (no product or dish names), so irritant detection compares real ingredients
    const ingredients = ingredientsOnly(cleanIngredients(body?.ingredients), name);
    // When it was eaten: any past time is fine; missing, invalid or future times mean "now"
    const t = body?.eatenAt ? new Date(String(body.eatenAt)) : null;
    const eatenAt = t && !isNaN(t.getTime()) && t.getTime() <= Date.now() + 5 * 60e3 ? t.toISOString() : new Date().toISOString();
    const [row] = await sql`insert into meals (user_id, name, details, flags, ingredients, created_at)
      values (${userId}, ${name}, ${details}, ${cleanFlags(body?.flags)}, ${JSON.stringify(ingredients)}::jsonb, ${eatenAt}) returning *`;
    return Response.json(toMeal(row));
  } catch (e) { return fail(e, "Saving meal"); }
}

/** Edit a meal's name/details, or replace its ingredient list (with flags). */
export async function PATCH(req: Request) {
  try {
    const { userId } = await getActor();
    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return Response.json({ error: "Missing id" }, { status: 400 });
    const [cur] = await sql`select * from meals where id = ${id} and user_id = ${userId}`;
    if (!cur) return Response.json({ error: "Meal not found" }, { status: 404 });
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) || cur.name : cur.name;
    const details = body.details !== undefined ? String(body.details).trim().slice(0, 4000) : cur.details;
    const ingredients = body.ingredients !== undefined ? cleanIngredients(body.ingredients) : cleanIngredients(cur.ingredients);
    const [row] = await sql`update meals set name = ${name}, details = ${details}, ingredients = ${JSON.stringify(ingredients)}::jsonb
      where id = ${id} and user_id = ${userId} returning *`;
    return Response.json(toMeal(row));
  } catch (e) { return fail(e, "Updating meal"); }
}

export async function DELETE(req: Request) {
  try {
    const { userId } = await getActor();
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Missing id" }, { status: 400 });
    await sql`delete from meals where id = ${id} and user_id = ${userId}`;
    return Response.json({ ok: true });
  } catch (e) { return fail(e, "Deleting meal"); }
}
