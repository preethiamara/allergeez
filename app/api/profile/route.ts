import { sql } from "@/lib/db";
import { getActor } from "@/lib/session";

const fail = (e: any, what: string) => {
  console.error(`[profile] ${what}`, e);
  return Response.json({ error: `${what} failed: ${e?.message ?? "database error"}` }, { status: 500 });
};

export async function GET() {
  try {
    const { userId: ID } = await getActor();
    const rows = await sql`select * from profiles where id = ${ID}`;
    return Response.json(rows[0] ?? { allergens: [], contact_name: "", contact_phone: "" });
  } catch (e) { return fail(e, "Loading profile"); }
}

export async function PUT(req: Request) {
  try {
    const { userId: ID } = await getActor();
    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.allergens)) return Response.json({ error: "allergens must be a list" }, { status: 400 });
    const allergens = [...new Set(
      (body.allergens as unknown[]).map(a => String(a).trim().toLowerCase()).filter(Boolean)
    )];
    const contact_name = String(body.contact_name ?? "").trim();
    const contact_phone = String(body.contact_phone ?? "").trim();
    await sql`insert into profiles (id, allergens, contact_name, contact_phone)
              values (${ID}, ${allergens}, ${contact_name}, ${contact_phone})
              on conflict (id) do update set allergens = excluded.allergens, contact_name = excluded.contact_name, contact_phone = excluded.contact_phone`;
    return Response.json({ ok: true, allergens, contact_name, contact_phone });
  } catch (e) { return fail(e, "Saving profile"); }
}

