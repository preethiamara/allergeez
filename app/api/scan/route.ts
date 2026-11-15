import { GoogleGenAI } from "@google/genai";
import { detectAdditives, detectNaturalTriggers, matchesUserList } from "@/lib/additives";
import { allergenMatches } from "@/lib/allergens";

// gemini-2.5-flash is no longer available to new API keys, so try current models in order.
// Override with GEMINI_MODEL in .env.local if needed.
const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite", // fast, separate quota: the best backup when 3.5 is rate-limited
  "gemini-3.8-flash",
  "gemini-flash-latest",
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

    const { image, mimeType, text, allergens } = await req.json();
    const description = typeof text === "string" ? text.trim().slice(0, 4000) : "";
    if (!image && !description) return Response.json({ error: "Add a photo or describe your food" }, { status: 400 });
    const list: string[] = Array.isArray(allergens) ? allergens : [];

    const prompt = `You help someone with food allergies. You are given ${image ? "a photo" : "a written description of what they ate"}${image && description ? " plus the user's notes" : ""}.
The user is allergic to: ${list.join(", ") || "nothing listed"}.

First decide what this is, as "kind":
- "packaged": a store-bought packaged product (box, bag, bottle, wrapper, can) where a brand or product name is visible or clearly identifiable
- "label": a close-up of an ingredient list or nutrition label
- "menu": a restaurant menu
- "homemade": a home-cooked or plated dish, snack, or drink without branded packaging
- "restaurant": a plated restaurant or takeout dish
- "not_food": anything else, including people, pets, rooms, furniture, screens or screenshots, documents, non-food objects, medicine/pills, cosmetics, or a photo too blurry or dark to tell. A food or drink must actually be visible (or clearly described) to count.
For "packaged", fill "product" with the brand and product name exactly as printed, and "barcode" with the digits only if a barcode number is clearly readable (else "").

List the likely ingredients (for dishes include typical hidden ingredients like sauces, butter, flour, nuts in pesto; for labels read them exactly).
Flag any that match the user's allergens, INCLUDING hidden names (casein, whey, albumin, tahini, lecithin, etc.) and "may contain" / cross-contact warnings.
List common major allergens it likely contains even if the user did not list them, as "common_allergens" (lowercase: "dairy", "wheat", "peanut", "egg", "soy", "sesame", "shellfish", "tree nut", "fish").
List every food additive separately in "additives" (preservatives, colorings, sweeteners, flavor enhancers, thickeners, emulsifiers), with the common name, the group, and the E-number if known. For labels, include every additive printed; for dishes, only ones very likely present (e.g. sulfites in wine, nitrites in bacon). Keep additives in "ingredients" too, exactly as printed.
List "natural_triggers": compounds the food is naturally high in that some people react to by eating ("histamine", "nickel", "salicylates", "tyramine"), with the foods responsible. Only include clear cases.
The user's allergens can include additives or natural compounds (e.g. "sulfites", "red dye 40", "msg", "histamine", "nickel"): flag those too, matching label names and E-numbers (e.g. sodium metabisulfite / E223 → sulfites, Allura Red / E129 → red dye 40, E621 → msg).
For "homemade" and "restaurant", estimate nutrition for the portion shown in "nutrition_estimate" (numbers only; null if you can't tell). For other kinds set "nutrition_estimate" to null.

Return JSON only:
{"kind": string, "name": string (short name, max 5 words),
 "product": {"brand": string, "name": string} | null, "barcode": string,
 "ingredients": string[], "flags": [{"ingredient": string, "allergen": string, "reason": string}],
 "common_allergens": string[],
 "additives": [{"name": string, "group": string, "e": string}],
 "natural_triggers": [{"trigger": string, "foods": string[]}],
 "nutrition_estimate": {"portion": string, "kcal": number, "protein": number, "carbs": number, "fat": number, "sugars": number, "fiber": number, "sodiumMg": number} | null,
 "safe": boolean, "note": string (one friendly sentence)}
If the input is not food or is unreadable, use kind "not_food", name "", empty lists, safe false, and in note say briefly what it is instead (for a photo: "This looks like a laptop keyboard."; for text: "Car keys aren’t food.").
If unsure, set safe to false. Informational only, not medical advice.${description ? `\n\nUser's description: """${description}"""` : ""}`;

    let lastErr: any;
    for (const model of MODELS) {
      try {
        const res = await withTimeout(ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: image ? [{ inlineData: { mimeType: mimeType || "image/jpeg", data: image } }, { text: prompt }] : [{ text: prompt }] }],
          config: { responseMimeType: "application/json" },
        }), ATTEMPT_TIMEOUT_MS);
        const out = parseJson(res.text ?? "{}");
        const result = { kind: "homemade", name: "", product: null, barcode: "", ingredients: [], flags: [], common_allergens: [], nutrition_estimate: null, safe: false, note: "", ...out, model };
        // Only keep "your allergen" flags that really match something on the user's list (the model sometimes over-flags)
        const NATURAL = ["histamine", "nickel", "salicylates", "tyramine"];
        const geminiTriggerFoods = (Array.isArray(out.natural_triggers) ? out.natural_triggers : []) as { trigger?: string; foods?: string[] }[];
        result.flags = (Array.isArray(result.flags) ? result.flags : []).filter((f: any) => {
          const a = String(f?.allergen ?? ""), ing = String(f?.ingredient ?? "");
          const onList = list.some(p => allergenMatches(p, a) || allergenMatches(p, ing)) || matchesUserList(list, { name: `${a} ${ing}` });
          if (!onList) return false;
          // Natural-compound flags need a real high source (e.g. aged cheese → histamine), not any ingredient
          const trig = NATURAL.find(t => a.toLowerCase().includes(t.replace(/s$/, "")));
          if (!trig) return true;
          const ingL = ing.toLowerCase();
          return detectNaturalTriggers([ing]).some(t => t.trigger === trig)
            || geminiTriggerFoods.some(t => String(t.trigger).toLowerCase() === trig && (t.foods ?? []).some(fd => ingL.includes(String(fd).toLowerCase()) || String(fd).toLowerCase().includes(ingL)));
        });
        // Not food: nothing to analyze or save; the app asks for another photo
        if (result.kind === "not_food") {
          return Response.json({ ...result, name: "", product: null, barcode: "", ingredients: [], flags: [], common_allergens: [],
            nutrition_estimate: null, additives: [], natural_triggers: [], safe: false });
        }
        // Double-check Gemini with the built-in additive / trigger lists, and merge
        const texts = [...(Array.isArray(result.ingredients) ? result.ingredients : []), result.name, description].filter(Boolean).map(String);
        const additives = new Map<string, { name: string; group: string; e?: string }>();
        const title = (g: string) => g.trim().replace(/\b\w/g, c => c.toUpperCase());
        // Built-in list first: its groups are reliable (e.g. sodium metabisulfite → Sulfites, not "Preservatives")
        for (const a of [...detectAdditives(texts), ...(Array.isArray(out.additives) ? out.additives : [])]) {
          const name = String(a?.name ?? "").trim();
          if (!name) continue;
          const key = (a.e ? String(a.e).toUpperCase().replace(/\s/g, "") : name.toLowerCase());
          if (![...additives.values()].some(x => (x.e && a.e && x.e.toUpperCase().replace(/\s/g, "") === key) || x.name.toLowerCase() === name.toLowerCase()))
            additives.set(key, { name, group: title(String(a.group || "Additives")), e: a.e ? String(a.e).toUpperCase().replace(/\s/g, "") : undefined });
        }
        const triggers = new Map<string, Set<string>>();
        for (const t of [...(Array.isArray(out.natural_triggers) ? out.natural_triggers : []), ...detectNaturalTriggers(texts)]) {
          const name = String(t?.trigger ?? "").toLowerCase().trim();
          if (!["histamine", "nickel", "salicylates", "tyramine"].includes(name)) continue;
          const set = triggers.get(name) ?? new Set<string>();
          (Array.isArray(t.foods) ? t.foods : []).forEach((f: unknown) => set.add(String(f).toLowerCase()));
          triggers.set(name, set);
        }
        return Response.json({
          ...result,
          additives: [...additives.values()].slice(0, 20),
          // Keep the most specific food names ("aged cheddar cheese", not also "cheddar")
          natural_triggers: [...triggers.entries()].map(([trigger, foods]) => {
            const list = [...foods];
            return { trigger, foods: list.filter(f => !list.some(o => o !== f && o.includes(f))).slice(0, 4) };
          }),
        });
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
