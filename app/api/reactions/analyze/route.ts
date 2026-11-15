import { GoogleGenAI } from "@google/genai";
import { attackTag, detectSymptoms, parseFood, parseIntensity, parseTiming } from "@/lib/symptoms";

// Turns a free-text (or voice) symptom description into a short "attack tag" and a symptom list.
// Gemini first (fast models, short timeout); keyword detection if Gemini is busy or over quota.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-3.5-flash"].filter(Boolean) as string[];
const TIMEOUT_MS = 8_000;

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  const input = String(text ?? "").trim().slice(0, 2000);
  if (!input) return Response.json({ error: "Describe your symptoms first" }, { status: 400 });

  const local = detectSymptoms(input);
  const fallback = {
    tag: attackTag(local, input), symptoms: local,
    timing: parseTiming(input), intensity: parseIntensity(input), food: parseFood(input), source: "keywords" as const,
  };

  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json(fallback);
  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = `Someone with food allergies described a possible allergic reaction, often by voice, so the text may be run-on or have filler words.
Extract each part separately. Return JSON only:
{"tag": string, "symptoms": string[], "timing": string, "intensity": string, "food": string}
- "tag": a short title naming AT MOST TWO main symptoms joined with " & " (2–4 words total), capitalize only the first word (e.g. "Hives & itching", "Throat swelling", "Stomach pain & nausea"). Most serious symptom first (breathing/throat before skin). No commas, no sentences.
- "symptoms": each distinct physical symptom as a short noun phrase, max 6 (e.g. "hives on arms", "swollen lips", "tight throat"). Do not include foods, times, or feelings like "scared".
- "timing": only WHEN it started or how long it has lasted (e.g. "20 minutes after lunch", "right after eating", "for the past hour"). "" if not said.
- "intensity": how bad it is in a few words, or a number like "7/10" if they gave one (e.g. "mild", "getting worse", "really bad"). "" if not said.
- "food": only the food or drink they ate before it, as a short name (e.g. "shrimp pad thai", "peanut butter cookie"). "" if not said.
Never copy the whole sentence into one field.
Text: """${input}"""`;

  for (const model of MODELS) {
    try {
      const res = await withTimeout(ai.models.generateContent({
        model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { responseMimeType: "application/json" },
      }), TIMEOUT_MS);
      const out = JSON.parse((res.text ?? "{}").replace(/^```(?:json)?\s*|```$/g, "").trim());
      const tag = String(out.tag ?? "").trim().slice(0, 40);
      const symptoms = Array.isArray(out.symptoms) ? out.symptoms.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 6) : [];
      const str = (v: unknown, max = 60) => String(v ?? "").trim().slice(0, max);
      if (tag) return Response.json({
        tag, symptoms: symptoms.length ? symptoms : local,
        timing: str(out.timing) || fallback.timing, intensity: str(out.intensity, 30) || fallback.intensity, food: str(out.food) || fallback.food,
        source: "gemini",
      });
    } catch (e: any) {
      console.warn(`[analyze] ${model} failed: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }
  return Response.json(fallback);
}
