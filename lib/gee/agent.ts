import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getProfile, listMeals, listReactions } from "@/lib/records";
import { findLikelyIrritants } from "@/lib/irritants";

// "Gee": a Mastra agent that runs the reaction check-in conversation. It asks for whatever is missing,
// looks up the user's meals and history with tools, and runs the likely-irritant algorithm.

// Mastra's model router reads Google's standard env var; reuse the app's existing Gemini key
process.env.GOOGLE_GENERATIVE_AI_API_KEY ||= process.env.GEMINI_API_KEY;

type Ctx = { userId: string; reactionTime: string };
const ctxOf = (context: any): Ctx => ({
  userId: context?.requestContext?.get("userId") ?? "demo",
  reactionTime: context?.requestContext?.get("reactionTime") ?? new Date().toISOString(),
});

const getMealsBeforeReaction = createTool({
  id: "get-meals-before-reaction",
  description: "List the meals the user logged in the hours before the reaction started, with ingredients. Use it to ask whether one of them is what they ate.",
  inputSchema: z.object({ hoursBefore: z.number().min(1).max(24).default(8) }),
  execute: async ({ hoursBefore }, context) => {
    const { userId, reactionTime } = ctxOf(context);
    const at = new Date(reactionTime).getTime();
    const meals = await listMeals(userId);
    return meals
      .filter(m => { const gap = at - new Date(m.createdAt).getTime(); return gap >= -30 * 60e3 && gap <= hoursBefore * 3600e3; })
      .slice(0, 8)
      .map(m => ({
        name: m.name,
        loggedAt: new Date(m.createdAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }),
        minutesBeforeReaction: Math.round((at - new Date(m.createdAt).getTime()) / 60e3),
        ingredients: m.ingredients.map(i => i.name).slice(0, 15),
        allergyGroups: m.flags,
      }));
  },
});

const getAllergyProfile = createTool({
  id: "get-allergy-profile",
  description: "The user's known allergens and how many reactions they have logged before.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const { userId } = ctxOf(context);
    const [profile, reactions] = await Promise.all([getProfile(userId), listReactions(userId)]);
    return { knownAllergens: profile.allergens, pastReactions: reactions.length };
  },
});

const findIrritants = createTool({
  id: "find-likely-irritants",
  description: "Run AllerGeez's irritant-detection algorithm over the user's whole meal and reaction history. Returns ranked ingredients/allergy groups that keep showing up before reactions, with confidence and evidence. Call it once you know what they ate.",
  inputSchema: z.object({ currentFood: z.string().optional().describe("What they ate before this reaction, if known") }),
  execute: async ({ currentFood }, context) => {
    const { userId, reactionTime } = ctxOf(context);
    const [meals, reactions, profile] = await Promise.all([listMeals(userId), listReactions(userId), getProfile(userId)]);
    // Include the reaction being recorded now, so today's meal counts as evidence too
    const current = { id: -1, food: currentFood ?? "", severity: 5, occurredAt: reactionTime };
    const ranked = findLikelyIrritants(meals, [...reactions, current], profile.allergens, 5);
    return {
      totalReactions: reactions.length + 1,
      likelyIrritants: ranked.map(r => ({ name: r.name, confidence: r.confidence, score: r.score, evidence: r.why, alreadyOnTheirList: r.onYourList })),
      note: reactions.length < 2 ? "Very little history yet; treat results as early guesses." : "",
    };
  },
});

export const geeAgent = new Agent({
  id: "gee",
  name: "Gee",
  description: "Friendly allergy check-in assistant for AllerGeez",
  instructions: `You are Gee, the warm, calm heart-shaped buddy in the AllerGeez food-allergy app. You are talking (by voice, so keep it short and natural) with someone who may be having an allergic reaction. You are not a doctor and never diagnose.

YOUR JOB: fill in a reaction check-in by having a short conversation.
Fields to collect:
- symptoms: what they feel and where (e.g. "hives on arms", "tingling lips")
- timing: when it started, ideally relative to eating (e.g. "20 minutes after lunch")
- severity: 1–10, or words like mild/moderate/severe you can map to a number
- food: what they ate or drank beforehand
- duration: how long it lasted, or "still happening"

HOW TO TALK:
1. SAFETY FIRST. If they mention trouble breathing, throat tightness or closing, tongue/lip swelling getting worse, wheezing, fainting, dizziness, or symptoms spreading fast, set emergency=true and tell them to use their epinephrine (EpiPen) if they have one and call 911 now. Do not ask other questions first.
2. Each turn, ask about ONE missing field at a time, in this order: symptoms → timing → severity → food → duration. Keep every reply to 1–2 short sentences. Acknowledge what they said in a few words first.
3. Ask for MORE DETAIL only when it matters: vague symptoms ("I feel weird") → ask what they notice and where; skin symptoms → ask if it is spreading; stomach symptoms → ask about vomiting; any mouth/face symptom → ask if their throat or breathing feels okay.
4. Food: the briefing lists meals they logged before the reaction. If there is one, ask if that's what they ate ("I see pad thai logged at 12:30. Was that it?").
5. When symptoms, timing, severity and food are known (duration is nice to have): call find-likely-irritants ONCE with the food, then reply with a one-sentence summary and at most two likely irritants with their confidence (say "early guess" when confidence is low), and tell them they can review and save it.
Do not call any tool more than once per turn. Never call a tool before you know what they ate.
6. If they say they don't know or don't want to answer, accept it, mark that field "unknown", and move on.
7. Never invent facts they didn't say. Never recommend medication other than their own prescribed epinephrine and calling 911.`,
  // Fast model first; fall back if it's rate-limited or slow
  model: [
    { model: `google/${process.env.GEMINI_MODEL || "gemini-3.1-flash-lite"}`, maxRetries: 1 },
    { model: "google/gemini-3.5-flash", maxRetries: 0 },
  ],
  // Meals and profile are put in the briefing by the server; the agent only needs the algorithm
  tools: { findIrritants },
});

export const checkInSchema = z.object({
  reply: z.string().describe("What Gee says next: 1–2 short spoken sentences, usually ending with one question"),
  fields: z.object({
    symptoms: z.array(z.string()).describe("Distinct symptoms so far, short phrases"),
    timing: z.string().describe("When it started, or '' if unknown, or 'unknown' if they don't know"),
    severity: z.number().nullable().describe("1–10, or null if not known yet"),
    food: z.string().describe("What they ate before, or ''"),
    duration: z.string().describe("How long it lasted / 'still happening', or ''"),
  }),
  asking: z.enum(["symptoms", "detail", "timing", "severity", "food", "duration", "none"]).describe("Which field the reply asks about"),
  done: z.boolean().describe("True when symptoms, timing, severity and food are known"),
  emergency: z.boolean().describe("True if symptoms sound like a severe reaction"),
  likelyIrritants: z.array(z.object({ name: z.string(), confidence: z.string(), evidence: z.string() })).describe("From find-likely-irritants, only when done; else []"),
});
export type CheckIn = z.infer<typeof checkInSchema>;
