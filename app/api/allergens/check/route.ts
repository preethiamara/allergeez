import { GoogleGenAI } from "@google/genai";
import { allergenTypo, knownAllergen } from "@/lib/allergens";

// Is what the user typed actually a food allergen? Known list first, then Gemini (also fixes typos).
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-3.5-flash"].filter(Boolean) as string[];
// Same word apart from case, spacing, punctuation, or a plural "s"
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(es|s)$/, "");
const same = (a: string, b: string) => norm(a) === norm(b);

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({ text: "" }));
  const input = String(text ?? "").trim().slice(0, 60);
  if (!input) return Response.json({ valid: false, reason: "Type an allergen first." });
  if (!/[a-z]/i.test(input)) return Response.json({ valid: false, name: input, reason: `“${input}” isn’t a food allergen.` });

  const known = knownAllergen(input);
  if (known) return Response.json({ valid: true, name: known, source: "list" });
  const typo = allergenTypo(input);
  if (typo) return Response.json({ valid: false, name: input, suggestion: typo, reason: `Did you mean “${typo}”?`, source: "list" });

  const key = process.env.GEMINI_API_KEY;
  if (key) {
    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `A user of a food-allergy app typed this into their list of allergens: """${input}"""
Is it a food, drink, or food ingredient/additive that a person can be allergic or intolerant to? Fix obvious typos.
Return JSON only: {"valid": boolean, "name": string, "suggestion": string, "reason": string}
- valid: true only for real foods/ingredients/additives (e.g. "peanuts", "shellfish", "kiwi", "red dye 40", "sesame"). false for non-foods (objects, animals as pets, feelings, places, gibberish) and for non-food allergies like pollen, dust, pet dander, latex, or medicines.
- name: the cleaned-up lowercase allergen name if valid (e.g. "penuts" → "peanuts"), else "".
- suggestion: if not valid but it looks like a misspelled food allergen, the corrected name, else "".
- reason: if not valid, one short friendly sentence explaining why (e.g. "Pollen is an environmental allergy, not a food.").`;
    for (const model of MODELS) {
      try {
        const res = await withTimeout(ai.models.generateContent({
          model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { responseMimeType: "application/json" },
        }), 12_000);
        const out = JSON.parse((res.text ?? "{}").replace(/^```(?:json)?\s*|```$/g, "").trim());
        if (out.valid) {
          const name = String(out.name || input).toLowerCase().slice(0, 40);
          // Never silently swap the user's word: if the AI "corrected" it (e.g. "app" → "apple"), ask first
          if (same(name, input)) return Response.json({ valid: true, name: input.toLowerCase(), source: "gemini" });
          return Response.json({ valid: false, name: input, suggestion: name, reason: `Did you mean “${name}”?`, source: "gemini" });
        }
        return Response.json({
          valid: false, name: input, suggestion: String(out.suggestion ?? "").toLowerCase().slice(0, 40),
          reason: String(out.reason || `“${input}” doesn’t look like a food allergen.`).slice(0, 160), source: "gemini",
        });
      } catch (e: any) {
        console.warn(`[allergen-check] ${model} failed: ${String(e?.message ?? e).slice(0, 100)}`);
      }
    }
  }
  // AI unavailable and not on the known list: don't silently accept it
  return Response.json({ valid: false, unsure: true, name: input, reason: `Gee couldn’t confirm “${input}” is a food allergen right now. Check the spelling or try again.` });
}
