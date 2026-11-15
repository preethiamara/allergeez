import { getActor } from "@/lib/session";
import { getProfile, listMeals, listReactions } from "@/lib/records";
import { buildTasteProfile } from "@/lib/taste";
import { getTaste, saveTaste } from "@/lib/tasteStore";

/** The user's taste profile: what they told us + what we learned from their meal log. */
async function profileFor(userId: string) {
  const [meals, reactions, profile, taste] = await Promise.all([listMeals(userId), listReactions(userId), getProfile(userId), getTaste(userId)]);
  return buildTasteProfile({
    meals, reactions: reactions.map(r => ({ id: r.id, food: r.food, severity: r.severity, occurredAt: r.occurredAt })),
    allergens: profile.allergens, likes: taste.likes, diet: taste.diet,
  });
}

export async function GET() {
  try { const { userId } = await getActor(); return Response.json(await profileFor(userId)); }
  catch (e) { console.error("[taste]", e); return Response.json({ error: "Couldn’t load your taste profile" }, { status: 500 }); }
}

export async function PUT(req: Request) {
  try {
    const { userId } = await getActor();
    const b = await req.json().catch(() => null);
    await saveTaste(userId, b?.likes, b?.diet);
    return Response.json(await profileFor(userId));
  } catch (e) { console.error("[taste]", e); return Response.json({ error: "Couldn’t save your taste profile" }, { status: 500 }); }
}
