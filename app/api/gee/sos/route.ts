import { GoogleGenAI } from "@google/genai";
import { getActor } from "@/lib/session";
import { getProfile, listMeals, listReactions } from "@/lib/records";
import { foodAllergens } from "@/lib/allergens";
import { ingredientsOnly } from "@/lib/ingredients";
import { findLikelyIrritants } from "@/lib/irritants";

// Gee during an emergency: a short, calm, safety-first reply to whatever the person says or types,
// grounded in their allergens, what they logged eating recently, and their likely triggers.
// The guide handles the most urgent phrases instantly on the device; this answers everything else.

export const maxDuration = 30;
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"].filter(Boolean) as string[];

type Msg = { who: "gee" | "you"; text: string };
const ACTIONS = ["none", "serious", "epi_used", "no_epi", "better", "worse", "noise"] as const;

export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const said = String(b?.said ?? "").trim().slice(0, 1200);
  if (!said) return Response.json({ error: "Say something first" }, { status: 400 });
  const history: Msg[] = (Array.isArray(b?.history) ? b.history : []).slice(-10)
    .map((m: any) => ({ who: m?.who === "you" ? "you" : "gee", text: String(m?.text ?? "").slice(0, 400) }));
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: "AI unavailable" }, { status: 503 });

  try {
    const { userId } = await getActor();
    const [profile, meals, reactions] = await Promise.all([getProfile(userId), listMeals(userId), listReactions(userId)]);
    const allergens = foodAllergens(profile.allergens);
    const since = Date.now() - 12 * 3600e3;
    const recent = meals.filter(m => new Date(m.createdAt).getTime() >= since).slice(0, 6).map(m => {
      const mins = Math.round((Date.now() - new Date(m.createdAt).getTime()) / 60e3);
      const ago = mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
      return `- ${m.name} (${ago}): ${ingredientsOnly(m.ingredients, m.name).map(i => i.name).slice(0, 14).join(", ") || "ingredients not listed"}${m.flags.length ? `; flags: ${m.flags.join(", ")}` : ""}`;
    });
    const irritants = findLikelyIrritants(meals, reactions.map(r => ({ id: r.id, food: r.food, severity: r.severity, occurredAt: r.occurredAt })), profile.allergens, 4)
      .filter(i => i.confidence !== "low").map(i => `${i.name} (${i.confidence})`);

    const prompt = `You are Gee, a calm heart-shaped buddy in the AllerGeez food-allergy app. The person is using the EMERGENCY guide right now: they may be having a severe allergic reaction. They speak to you by voice (transcribed) or type.

SAFETY RULES (never break):
- Never tell them not to use epinephrine or not to call 911. Never diagnose. Never suggest any medicine except their own prescribed epinephrine (EpiPen).
- If THEY DESCRIBE having trouble breathing, throat/tongue swelling, wheezing, fainting, dizziness, or fast-spreading symptoms: tell them to use epinephrine now (if not used) and call 911. action "serious". A question (like "what caused this?") is not a symptom: answer it, action "none".
- Keep replies to 1–2 short sentences, spoken style, no lists, no emojis. Write "nine one one" instead of "911" (it will be read aloud).

UNDERSTAND WHAT THEY SAID:
- If the text is clearly NOT them talking to you (song lyrics, a TV/radio, other people's conversation, random words), reply that it sounded like background noise or music, and ask them to tell you how they feel. action "noise".
- If they ask a question (e.g. what could have caused this, is this normal, what should I do), ANSWER it directly and briefly using the facts below, then point back to the next safety step.
  For "what caused this": name the most likely culprit(s) from their recent meals that contain their allergens or likely triggers, and say it's a guess to tell the dispatcher/doctor. If nothing they logged matches, say so and suggest telling the dispatcher everything they ate.
  Don't repeat the full epinephrine instruction in every reply; mention it only if their symptoms sound dangerous or they haven't been told yet.
- If they say they used their EpiPen: action "epi_used". If they don't have one: "no_epi". Getting better: "better". Getting worse: "worse".

FACTS:
- Their allergens: ${allergens.join(", ") || "none listed"}
- Likely triggers from past reactions: ${irritants.join(", ") || "none found yet"}
- Logged in the last 12 hours:
${recent.join("\n") || "- nothing logged"}
- Current guide step: ${String(b?.step ?? "").slice(0, 80) || "unknown"}
- Epinephrine: ${b?.epiMinutes != null ? `used ${b.epiMinutes} min ago` : "not marked as used yet"}

RECENT CONVERSATION:
${history.map(m => `${m.who === "you" ? "Person" : "Gee"}: ${m.text}`).join("\n") || "(none)"}

THEY JUST SAID: """${said}"""

Return JSON only: {"reply": string, "action": ${ACTIONS.map(a => `"${a}"`).join(" | ")}}`;

    const ai = new GoogleGenAI({ apiKey: key });
    for (const model of MODELS) {
      try {
        const res = await Promise.race([
          ai.models.generateContent({ model, contents: prompt, config: { responseMimeType: "application/json", temperature: 0.2 } }),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 8000)),
        ]);
        const out = JSON.parse((res.text ?? "").replace(/^```(?:json)?|```$/g, "").trim());
        const reply = String(out?.reply ?? "").trim().slice(0, 400);
        if (!reply) throw new Error("empty reply");
        const action = (ACTIONS as readonly string[]).includes(out?.action) ? out.action : "none";
        return Response.json({ reply, action, model });
      } catch (e: any) { console.warn(`[gee/sos] ${model}:`, String(e?.message).slice(0, 120)); }
    }
    return Response.json({ error: "AI unavailable" }, { status: 503 });
  } catch (e: any) {
    console.error("[gee/sos]", e);
    return Response.json({ error: "Couldn’t answer right now" }, { status: 500 });
  }
}
