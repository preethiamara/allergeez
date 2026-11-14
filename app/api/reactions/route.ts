import { sql } from "@/lib/db";
import { USER_ID, listReactions, toReaction } from "@/lib/records";

const fail = (e: any, what: string) => {
  console.error(`[reactions] ${what}`, e);
  return Response.json({ error: `${what} failed: ${e?.message ?? "database error"}` }, { status: 500 });
};

export async function GET() {
  try { return Response.json(await listReactions()); } catch (e) { return fail(e, "Loading reactions"); }
}

export async function POST(req: Request) {
  try {
    const b = await req.json().catch(() => null);
    const symptoms = String(b?.symptoms ?? "").trim().slice(0, 2000);
    if (!symptoms) return Response.json({ error: "Please describe your symptoms" }, { status: 400 });
    const severity = Math.min(10, Math.max(1, Math.round(Number(b?.severity) || 1)));
    const duration = String(b?.duration ?? "").trim() || null;
    const mealName = String(b?.mealName ?? "").trim() || null;
    const occurred = b?.occurredAt ? new Date(b.occurredAt) : new Date();
    const occurredAt = isNaN(occurred.getTime()) ? new Date() : occurred;
    const [row] = await sql`insert into reactions (user_id, suspected_trigger, symptoms, severity, duration, meal_name, occurred_at)
      values (${USER_ID}, ${b?.suspectedTrigger ?? mealName}, ${symptoms}, ${severity}, ${duration}, ${mealName}, ${occurredAt.toISOString()})
      returning *`;
    return Response.json(toReaction(row));
  } catch (e) { return fail(e, "Saving reaction"); }
}

export async function DELETE(req: Request) {
  try {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "Missing id" }, { status: 400 });
    await sql`delete from reactions where id = ${id} and user_id = ${USER_ID}`;
    return Response.json({ ok: true });
  } catch (e) { return fail(e, "Deleting reaction"); }
}
