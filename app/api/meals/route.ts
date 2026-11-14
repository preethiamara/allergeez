import { sql } from "@/lib/db";
import { USER_ID, listMeals, toMeal } from "@/lib/records";

const fail = (e: any, what: string) => {
  console.error(`[meals] ${what}`, e);
  return Response.json({ error: `${what} failed: ${e?.message ?? "database error"}` }, { status: 500 });
};

export async function GET() {
  try { return Response.json(await listMeals()); } catch (e) { return fail(e, "Loading meals"); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const details = String(body?.details ?? "").trim().slice(0, 4000);
    const name = String(body?.name ?? "").trim().slice(0, 80) || "New meal";
    const flags = Array.isArray(body?.flags) ? body.flags.map((f: unknown) => String(f).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
    const [row] = await sql`insert into meals (user_id, name, details, flags) values (${USER_ID}, ${name}, ${details}, ${flags}) returning *`;
    return Response.json(toMeal(row));
  } catch (e) { return fail(e, "Saving meal"); }
}

export async function DELETE(req: Request) {
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Missing id" }, { status: 400 });
    await sql`delete from meals where id = ${id} and user_id = ${USER_ID}`;
    return Response.json({ ok: true });
  } catch (e) { return fail(e, "Deleting meal"); }
}
