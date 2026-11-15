import { RequestContext } from "@mastra/core/request-context";
import { checkInSchema, geeAgent, type CheckIn } from "@/lib/gee/agent";
import { getActor } from "@/lib/session";
import { listMeals, listReactions, getProfile } from "@/lib/records";
import { findLikelyIrritants } from "@/lib/irritants";
import { detectSymptoms, isSerious, parseFood, parseIntensity, parseTiming } from "@/lib/symptoms";

export const maxDuration = 60;

type Msg = { role: "user" | "assistant"; content: string };

/** Rule-based fallback when the AI is unavailable: same order of questions, so the check-in still works. */
async function fallbackTurn(messages: Msg[], userId: string, reactionTime: string): Promise<CheckIn> {
  const said = messages.filter(m => m.role === "user").map(m => m.content).join(". ");
  const lastQ = [...messages].reverse().find(m => m.role === "assistant")?.content ?? "";
  const lastA = [...messages].reverse().find(m => m.role === "user")?.content ?? "";
  const symptoms = detectSymptoms(said).map(s => s.toLowerCase());
  let timing = parseTiming(said), food = parseFood(said), duration = "";
  const intensity = parseIntensity(said);
  let severity: number | null = /(\d{1,2})\s*(\/|out of)\s*10/.test(said) ? Number(said.match(/(\d{1,2})\s*(?:\/|out of)\s*10/)![1])
    : /severe|terrible|unbearable|really bad/i.test(said) ? 8 : /moderate|pretty bad/i.test(said) ? 5 : /mild|slight|a little/i.test(said) ? 3 : null;
  // Answers to the question we just asked count even without keywords
  if (/when/i.test(lastQ) && !timing && lastA) timing = lastA;
  if (/eat|food|drink/i.test(lastQ) && !food && lastA) food = lastA;
  if (/how long|still/i.test(lastQ) && lastA) duration = lastA;
  if (/scale|how bad|1 to 10|intense/i.test(lastQ) && severity === null && lastA) severity = Number(lastA.match(/\d+/)?.[0]) || (intensity ? 5 : null);
  if (isSerious(said)) {
    return { reply: "That could be serious. Use your epinephrine if you have it and call 911 now.", fields: { symptoms, timing, severity, food, duration }, asking: "none", done: false, emergency: true, likelyIrritants: [] };
  }
  const ask = (asking: CheckIn["asking"], reply: string): CheckIn => ({ reply, fields: { symptoms, timing, severity, food, duration }, asking, done: false, emergency: false, likelyIrritants: [] });
  if (!symptoms.length) return ask("symptoms", "What are you feeling right now, and where on your body?");
  if (!timing) return ask("timing", "Got it. When did it start? Was it soon after eating?");
  if (severity === null) return ask("severity", "On a scale of 1 to 10, how bad is it?");
  if (!food) return ask("food", "What did you eat or drink before it started?");
  if (!duration) return ask("duration", "Is it still happening, or how long did it last?");
  const [meals, reactions, profile] = await Promise.all([listMeals(userId), listReactions(userId), getProfile(userId)]);
  const ranked = findLikelyIrritants(meals, [...reactions, { id: -1, food, severity: severity ?? 5, occurredAt: reactionTime }], profile.allergens, 3);
  const top = ranked.slice(0, 2).map(r => `${r.name} (${r.confidence === "low" ? "early guess" : r.confidence + " confidence"})`);
  return {
    reply: `Thanks, I have everything. ${top.length ? `Possible irritants: ${top.join(" and ")}. ` : ""}You can review and save your check-in.`,
    fields: { symptoms, timing, severity, food, duration }, asking: "none", done: true, emergency: false,
    likelyIrritants: ranked.slice(0, 3).map(r => ({ name: r.name, confidence: r.confidence, evidence: r.why })),
  };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const messages: Msg[] = Array.isArray(body?.messages)
    ? body.messages.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string").slice(-20)
        .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 1500) }))
    : [];
  if (!messages.some(m => m.role === "user")) return Response.json({ error: "Say something first" }, { status: 400 });
  const reactionTime = body?.reactionTime && !isNaN(Date.parse(body.reactionTime)) ? new Date(body.reactionTime).toISOString() : new Date().toISOString();
  const { userId } = await getActor();

  // Safety check that never depends on the AI
  const lastUser = [...messages].reverse().find(m => m.role === "user")!.content;
  const seriousNow = isSerious(lastUser);

  const ctx = new RequestContext();
  ctx.set("userId", userId);
  ctx.set("reactionTime", reactionTime);
  const now = new Date(reactionTime).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

  try {
    // Brief the agent with the user's meals before the reaction and their profile (saves tool round-trips)
    const [meals, profile] = await Promise.all([listMeals(userId), getProfile(userId)]);
    const at = new Date(reactionTime).getTime();
    const recent = meals
      .filter(m => { const gap = at - new Date(m.createdAt).getTime(); return gap >= -30 * 60e3 && gap <= 8 * 3600e3; })
      .slice(0, 6)
      .map(m => `- ${m.name} (logged ${new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}; ingredients: ${m.ingredients.map(i => i.name).slice(0, 8).join(", ") || m.details}${m.flags.length ? `; allergy groups, additives & natural triggers: ${m.flags.join(", ")}` : ""})`);
    const briefing = [
      `The check-in started at ${now}.`,
      `Known allergens: ${profile.allergens.join(", ") || "none listed"}.`,
      recent.length ? `Meals logged in the 8 hours before:\n${recent.join("\n")}` : "No meals logged in the 8 hours before.",
      body?.known ? `Already filled in the app: ${JSON.stringify(body.known)}` : "",
    ].filter(Boolean).join("\n");

    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("agent timed out")), ms))]);

    // 1) Intake turn: Gee decides what to say next and what's been collected (fast, no tools)
    const res = await withTimeout(geeAgent.generate(
      [{ role: "system", content: briefing }, ...messages] as any,
      { requestContext: ctx, toolChoice: "none", structuredOutput: { schema: checkInSchema, jsonPromptInjection: "auto" } },
    ), 20_000);
    const r = res as any;
    const out = r.object as CheckIn | undefined;
    if (!out?.reply) throw new Error(`no structured reply (finish=${r.finishReason}; text=${String(r.text ?? "").slice(0, 160)})`);
    if (out.emergency || seriousNow) return Response.json({ ...out, emergency: true, done: false, source: "mastra" });

    // 2) Check-in complete: Gee runs the irritant-detection tool and explains the result
    if (out.done) {
      try {
        const f = out.fields;
        const final = await withTimeout(geeAgent.generate(
          [{ role: "system", content: briefing }, ...messages,
           { role: "user", content: `(App note: the check-in is complete: ${JSON.stringify(f)}. Call find-likely-irritants with currentFood="${f.food}", then reply in 1–2 short spoken sentences: a quick summary and the top one or two likely irritants with their confidence. End by saying they can review and save it.)` }] as any,
          { requestContext: ctx, maxSteps: 3, toolChoice: "auto" },
        ), 20_000);
        const fr = final as any;
        const toolOut = (fr.toolResults ?? []).map((t: any) => t.result ?? t.payload?.result).find((x: any) => x?.likelyIrritants);
        const irritants = (toolOut?.likelyIrritants ?? []).slice(0, 3).map((x: any) => ({ name: x.name, confidence: x.confidence, evidence: x.evidence }));
        return Response.json({ ...out, reply: String(fr.text || out.reply).trim(), likelyIrritants: irritants, toolUsed: !!toolOut, source: "mastra" });
      } catch (e: any) {
        console.warn("[gee] irritant step failed, using the algorithm directly:", String(e?.message ?? e).slice(0, 160));
        const [allMeals, reactions] = await Promise.all([listMeals(userId), listReactions(userId)]);
        const ranked = findLikelyIrritants(allMeals, [...reactions, { id: -1, food: out.fields.food, severity: out.fields.severity ?? 5, occurredAt: reactionTime }], profile.allergens, 3);
        return Response.json({ ...out, likelyIrritants: ranked.map(x => ({ name: x.name, confidence: x.confidence, evidence: x.why })), source: "mastra" });
      }
    }
    return Response.json({ ...out, source: "mastra" });
  } catch (e: any) {
    console.warn("[gee] agent failed, using rule-based fallback:", String(e?.message ?? e).slice(0, 200));
    const out = await fallbackTurn(messages, userId, reactionTime);
    return Response.json({ ...out, emergency: out.emergency || seriousNow, source: "fallback" });
  }
}
