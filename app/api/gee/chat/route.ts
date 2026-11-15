import { RequestContext } from "@mastra/core/request-context";
import { checkInSchema, geeAgent, type CheckIn } from "@/lib/gee/agent";
import { appTools, type GeeCard } from "@/lib/gee/tools";
import { getActor } from "@/lib/session";
import { listMeals, listReactions, getProfile } from "@/lib/records";
import { findLikelyIrritants } from "@/lib/irritants";
import { ingredientsOnly } from "@/lib/ingredients";
import { checkInTranscript, matchingCheckIns, pastCheckIns, recordTurn, type Turn } from "@/lib/gee/memory";
import { detectSymptoms, isSerious, parseFood, parseIntensity, parseTiming } from "@/lib/symptoms";

export const maxDuration = 90;
const NO_REQUEST: CheckIn["request"] = { type: "none", food: "", place: "", message: "" };

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
    return { reply: "That could be serious. Use your epinephrine if you have it and call 911 now.", fields: { symptoms, timing, severity, food, duration }, asking: "none", done: false, emergency: true, likelyIrritants: [], request: NO_REQUEST };
  }
  const ask = (asking: CheckIn["asking"], reply: string): CheckIn => ({ reply, fields: { symptoms, timing, severity, food, duration }, asking, done: false, emergency: false, likelyIrritants: [], request: NO_REQUEST });
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
    likelyIrritants: ranked.slice(0, 3).map(r => ({ name: r.name, confidence: r.confidence, evidence: r.why })), request: NO_REQUEST,
  };
}

/** GET /api/gee/chat?thread=ID: the saved conversation for one check-in (only the owner can read it). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("thread") ?? "";
  if (!/^[\w-]{8,80}$/.test(id)) return Response.json({ error: "Missing conversation id" }, { status: 400 });
  const { userId } = await getActor();
  try {
    const messages = await checkInTranscript(userId, id);
    if (!messages) return Response.json({ error: "Conversation not found" }, { status: 404 });
    return Response.json({ messages });
  } catch (e: any) {
    console.error("[gee] loading conversation failed", e);
    return Response.json({ error: "Couldn’t load the conversation" }, { status: 500 });
  }
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
  // One Mastra memory thread (stored in Neon) per check-in
  const threadId = typeof body?.threadId === "string" && /^[\w-]{8,80}$/.test(body.threadId) ? body.threadId : "";

  // Safety check that never depends on the AI
  const lastUser = [...messages].reverse().find(m => m.role === "user")!.content;
  const firstUser = messages.findIndex(m => m.role === "user");
  const opening: Turn[] = messages.slice(0, firstUser).filter(m => m.role === "assistant");
  /** Send the reply, after saving this exchange to Gee's memory (a memory failure never blocks the reply). */
  const respond = async (out: CheckIn & Record<string, unknown>) => {
    if (threadId) {
      try { await recordTurn({ userId, threadId, reactionTime, opening, user: lastUser, reply: String(out.reply ?? ""), checkIn: out }); }
      catch (e: any) { console.warn("[gee] couldn't save to memory:", String(e?.message ?? e).slice(0, 160)); }
    }
    return Response.json({ ...out, threadId: threadId || undefined });
  };
  const seriousNow = isSerious(lastUser);

  const ctx = new RequestContext();
  ctx.set("userId", userId);
  ctx.set("reactionTime", reactionTime);
  const now = new Date(reactionTime).toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" });

  try {
    // Brief the agent with the user's meals before the reaction and their profile (saves tool round-trips)
    const saidSoFar = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
    const noMemory = (e: any) => { console.warn("[gee] memory unavailable:", String(e?.message ?? e).slice(0, 120)); return [] as string[]; };
    const [meals, profile, memory, matches] = await Promise.all([
      listMeals(userId), getProfile(userId),
      pastCheckIns(userId, threadId).catch(noMemory),
      // Only point out a repeat pattern once: on the first user turn of this check-in
      messages.filter(m => m.role === "user").length === 1 ? matchingCheckIns(userId, saidSoFar, threadId).catch(e => { console.warn("[gee] memory match failed:", String(e?.message ?? e).slice(0, 160)); return []; }) : Promise.resolve([]),
    ]);
    const at = new Date(reactionTime).getTime();
    const recent = meals
      .filter(m => { const gap = at - new Date(m.createdAt).getTime(); return gap >= -30 * 60e3 && gap <= 8 * 3600e3; })
      .slice(0, 6)
      .map(m => `- ${m.name} (logged ${new Date(m.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}; ingredients: ${ingredientsOnly(m.ingredients, m.name).map(i => i.name).slice(0, 12).join(", ") || "not listed"}${m.flags.length ? `; allergy groups, additives & natural triggers: ${m.flags.join(", ")}` : ""})`);
    const briefing = [
      `The check-in started at ${now}.`,
      `Known allergens: ${profile.allergens.join(", ") || "none listed"}.`,
      recent.length ? `Meals logged in the 8 hours before:\n${recent.join("\n")}` : "No meals logged in the 8 hours before.",
      memory.length ? `Your memory of this person's earlier check-ins (newest first):\n${memory.join("\n")}` : "This is their first check-in with you.",
      matches.length ? `PATTERN FROM YOUR MEMORY (mention this once, briefly, in this reply, e.g. "You had hives after shrimp last time too."): ${matches.map(x => x.text).join(" | ")}` : "",
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
    if (out.emergency || seriousNow) return respond({ ...out, emergency: true, done: false, source: "mastra" });
    // Repeat pattern from memory: make sure Gee says it (the fast model sometimes skips it)
    if (matches.length && !/last time|remember|before|again|earlier|previous/i.test(out.reply)) out.reply = `${matches[0].spoken} ${out.reply}`;

    // 2) They asked for an app feature (food check, safe food nearby, text their contact): Gee calls that tool
    const req = out.request ?? NO_REQUEST;
    const TOOLS = { check_food: ["checkFoodSafety", "check-food-safety"], find_safe_food: ["findSafeFoodNearby", "find-safe-food-nearby"], text_contact: ["prepareContactMessage", "prepare-contact-message"] } as const;
    if (req.type !== "none" && !(req.type === "find_safe_food" && !req.place.trim()) && !(req.type === "check_food" && !req.food.trim())) {
      const [key, toolId] = TOOLS[req.type];
      const args: any = req.type === "check_food" ? { food: req.food } : req.type === "find_safe_food" ? { place: req.place, craving: req.food || undefined } : { message: req.message || "I'm having an allergic reaction. Can you call me?" };
      let result: any = null, reply = "", toolUsed = false;
      // Gee calls the tool right away (one fast agent step, tool call required); the reply is phrased from its result below
      try {
        const step = await withTimeout(geeAgent.generate(
          [{ role: "system", content: briefing }, ...messages,
           { role: "user", content: `(App note: call ${toolId} with ${JSON.stringify(args)}.)` }] as any,
          { requestContext: ctx, maxSteps: 1, toolChoice: { type: "tool", toolName: key } },
        ), req.type === "find_safe_food" ? 50_000 : 12_000) as any;
        result = (step.toolResults ?? []).map((t: any) => t.result ?? t.payload?.result).find((x: any) => x && "card" in x) ?? null;
        toolUsed = !!result;
      } catch (e: any) { console.warn("[gee] app tool step failed:", String(e?.message ?? e).slice(0, 160)); }
      // Still nothing (AI down / timed out): run the same tool directly so the person still gets an answer
      if (!result) {
        try { result = await (appTools[key].execute as any)(args, { requestContext: ctx }); } catch (e) { console.warn("[gee] direct tool call failed:", e); }
      }
      if (!reply && result) {
        reply = req.type === "check_food"
          ? (result.verdict === "avoid" ? `I'd avoid ${req.food}: ${result.reasons[0] ?? "it may contain something you react to"}.` : `${req.food} looks okay for you, but check the label or ask the restaurant to be sure.`)
          : req.type === "find_safe_food"
            ? (result.places?.length ? `Try ${result.places[0].name}: ${result.places[0].picks[0]?.dish} looks safe for you. I put a few options below.` : result.message)
            : (result.ready ? `I wrote a message to ${result.contactName}. Tap the button to send it.` : result.message);
      }
      // Then carry on with the check-in question Gee had planned
      const NEXT: Record<string, string> = {
        symptoms: "Now, what are you feeling, and where?", detail: "Can you tell me a bit more about what you're feeling?",
        timing: "When did it start?", severity: "How bad is it, from 1 to 10?", food: "What did you eat before it started?", duration: "Is it still happening?",
      };
      const nextQ = !out.done ? NEXT[out.asking] ?? "" : "";
      if (reply && nextQ && !reply.includes(nextQ)) reply = `${reply} ${nextQ}`;
      const cards: GeeCard[] = result?.card ? [result.card] : [];
      return respond({ ...out, reply: reply || out.reply, cards, toolUsed, source: "mastra" });
    }

    // 3) Check-in complete: Gee runs the irritant-detection tool and explains the result
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
        return respond({ ...out, reply: String(fr.text || out.reply).trim(), likelyIrritants: irritants, toolUsed: !!toolOut, source: "mastra" });
      } catch (e: any) {
        console.warn("[gee] irritant step failed, using the algorithm directly:", String(e?.message ?? e).slice(0, 160));
        const [allMeals, reactions] = await Promise.all([listMeals(userId), listReactions(userId)]);
        const ranked = findLikelyIrritants(allMeals, [...reactions, { id: -1, food: out.fields.food, severity: out.fields.severity ?? 5, occurredAt: reactionTime }], profile.allergens, 3);
        return respond({ ...out, likelyIrritants: ranked.map(x => ({ name: x.name, confidence: x.confidence, evidence: x.why })), source: "mastra" });
      }
    }
    return respond({ ...out, source: "mastra" });
  } catch (e: any) {
    console.warn("[gee] agent failed, using rule-based fallback:", String(e?.message ?? e).slice(0, 200));
    const out = await fallbackTurn(messages, userId, reactionTime);
    return respond({ ...out, emergency: out.emergency || seriousNow, source: "fallback" });
  }
}
