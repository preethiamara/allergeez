import { GoogleGenAI } from "@google/genai";

// gemini-2.5-flash is no longer available to new API keys, so try current models in order.
// Override with GEMINI_MODEL in .env.local if needed.
const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
].filter(Boolean) as string[];
const ATTEMPT_TIMEOUT_MS = 20_000;
export const maxDuration = 120;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

// Errors worth retrying on another model: unavailable model, overload, rate limit, timeout, empty/bad JSON.
const RETRYABLE = /404|NOT_FOUND|no longer available|not found|503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED|500|INTERNAL|timed out|fetch failed|JSON/i;

function parseJson(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

export async function POST(req: Request) {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return Response.json({ error: "GEMINI_API_KEY is missing in .env.local" }, { status: 500 });
    const ai = new GoogleGenAI({ apiKey: key });

    const { image, mimeType, allergens } = await req.json();
    if (!image) return Response.json({ error: "No image received" }, { status: 400 });
    const list: string[] = Array.isArray(allergens) ? allergens : [];

    const prompt = `You read food ingredient labels and menus. The user is allergic to: ${list.join(", ") || "nothing listed"}.
Extract all ingredients. Flag any matching the user's allergens, INCLUDING hidden names (casein, whey, albumin, tahini, lecithin, etc.) and "may contain" / cross-contact warnings.
Return JSON only: {"ingredients": string[], "flags": [{"ingredient": string, "allergen": string, "reason": string}], "safe": boolean, "note": string}.
If the image is not a food label or menu, or is unreadable, return empty ingredients, safe false, and explain in note.
If unsure, set safe to false. Informational only, not medical advice.`;

    let lastErr: any;
    for (const model of MODELS) {
      try {
        const res = await withTimeout(ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: mimeType || "image/jpeg", data: image } }, { text: prompt }] }],
          config: { responseMimeType: "application/json" },
        }), ATTEMPT_TIMEOUT_MS);
        const out = parseJson(res.text ?? "{}");
        return Response.json({ ingredients: [], flags: [], safe: false, note: "", ...out, model });
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        if (!RETRYABLE.test(msg)) throw e;
        console.warn(`[scan] ${model} failed (${msg.slice(0, 120)}), trying next model`);
      }
    }
    throw new Error(`Gemini is busy or unavailable right now. Please try again in a moment. (${String(lastErr?.message ?? lastErr).slice(0, 160)})`);
  } catch (e: any) {
    console.error("[scan]", e);
    return Response.json({ error: e?.message ?? "scan failed" }, { status: 502 });
  }
}
