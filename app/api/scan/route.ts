import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function POST(req: Request) {
  const { image, mimeType, allergens } = await req.json();
  const prompt = `You read food ingredient labels and menus. The user is allergic to: ${allergens.join(", ") || "nothing listed"}.
Extract all ingredients. Flag any matching the user's allergens, INCLUDING hidden names (casein, whey, albumin, tahini, lecithin, etc.) and "may contain" / cross-contact warnings.
Return JSON only: {"ingredients": string[], "flags": [{"ingredient": string, "allergen": string, "reason": string}], "safe": boolean, "note": string}.
If unsure, set safe to false. Informational only, not medical advice.`;
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ inlineData: { mimeType, data: image } }, { text: prompt }],
    config: { responseMimeType: "application/json" },
  });
  return Response.json(JSON.parse(res.text ?? "{}"));
}
