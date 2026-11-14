import { sql } from "@/lib/db";
const ID = "demo"; // single demo user; add auth later

export async function GET() {
  const rows = await sql`select * from profiles where id = ${ID}`;
  return Response.json(rows[0] ?? { allergens: [], contact_name: "", contact_phone: "" });
}
export async function PUT(req: Request) {
  const { allergens, contact_name, contact_phone } = await req.json();
  await sql`insert into profiles (id, allergens, contact_name, contact_phone)
            values (${ID}, ${allergens}, ${contact_name}, ${contact_phone})
            on conflict (id) do update set allergens = ${allergens}, contact_name = ${contact_name}, contact_phone = ${contact_phone}`;
  return Response.json({ ok: true });
}
export async function POST(req: Request) {
  const { suspected_trigger } = await req.json();
  await sql`insert into reactions (user_id, suspected_trigger) values (${ID}, ${suspected_trigger})`;
  return Response.json({ ok: true });
}
