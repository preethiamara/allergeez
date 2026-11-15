// Menus for nearby places and for "Check a restaurant" (menu link or photo).
import { GoogleGenAI } from "@google/genai";
import { brightDataFetch } from "@/lib/nutrition";
import { placeCache, type Place } from "@/lib/nearby";
import type { MenuDish } from "@/lib/taste";

// A nearby place's rating and menu, gathered through Bright Data and read by Gemini:
// 1) a Google search for "<place> <address/city> menu": its results page carries the Google rating,
//    price range and often menu items; 2) the place's own website menu page when OpenStreetMap lists one.
// Cached in Neon for a week per place, so each place costs Bright Data requests only once.

export type PlaceMenu = {
  found: boolean;
  rating?: number; reviews?: number; price?: string; cuisine?: string;
  dishes: MenuDish[];
  sources: string[];
};

const MODELS = [process.env.GEMINI_MODEL, "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"].filter(Boolean) as string[];
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const pageText = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, " ")
  .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Find the menu page on a restaurant's site (a link whose text or URL says "menu"). */
function menuLink(html: string, base: string) {
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    const href = m[1], text = m[2].replace(/<[^>]+>/g, "");
    if (/menu/i.test(href) || /\bmenu\b/i.test(text)) {
      try { const u = new URL(href, base); if (/^https?:$/.test(u.protocol) && !/\.(pdf|jpg|png)$/i.test(u.pathname)) return u.toString(); } catch {}
    }
  }
  return "";
}

async function websiteMenu(website: string) {
  const home = await brightDataFetch(website, 25_000);
  if (!home?.ok) return "";
  const link = menuLink(home.text, website);
  if (link && link !== website) {
    const page = await brightDataFetch(link, 25_000);
    if (page?.ok) return `MENU PAGE (${link}):\n${pageText(page.text).slice(0, 6000)}`;
  }
  return `WEBSITE (${website}):\n${pageText(home.text).slice(0, 4000)}`;
}

async function readMenu(place: Pick<Place, "name" | "address" | "cuisine">, text: string, image?: { data: string; mimeType: string }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const ai = new GoogleGenAI({ apiKey: key });
  const prompt = `Restaurant: "${place.name || "unknown (read it from the menu)"}"${place.address ? `, ${place.address}` : ""}${place.cuisine ? ` (${place.cuisine})` : ""}.
${image ? "The image is a photo of its menu or allergen chart." : "Below is text from a Google results page about it and possibly its website."} Extract:
- its Google rating (e.g. "4.4" next to "Google reviews") and number of reviews, and price range (e.g. "$10–20")
- up to 25 dishes from ITS menu (only dishes this restaurant sells; skip drinks unless it's a cafe). For each: name as written, price if shown, a short description if shown, the major allergens it likely contains ("contains", lowercase: dairy, wheat, egg, soy, peanut, tree nut, sesame, fish, shellfish, mustard, celery), cross-contact risks like shared fryers ("may_contain"), and tags from: spicy, vegetarian, vegan, gluten-free, fried, grilled, healthy, sweet, noodles, rice, salad, soup, sandwich, burger, pizza, pasta, chicken, beef, pork, seafood, breakfast, dessert.
If no menu items are visible, use typical signature dishes for this exact restaurant only if the text clearly names them; otherwise "dishes": [].
Return JSON only: {"name": string (the restaurant's name if shown, else ""), "rating": number|null, "reviews": number|null, "price": string, "cuisine": string, "dishes": [{"dish": string, "price": string, "description": string, "contains": string[], "may_contain": string[], "tags": string[]}]}

${text.slice(0, 14000)}`;
  for (const model of MODELS) {
    try {
      const res = await Promise.race([
        ai.models.generateContent({
          model, config: { responseMimeType: "application/json", temperature: 0 },
          contents: image ? [{ role: "user", parts: [{ inlineData: { data: image.data, mimeType: image.mimeType } }, { text: prompt }] }] : prompt,
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), 25_000)),
      ]);
      return JSON.parse((res.text ?? "").replace(/^```(?:json)?|```$/g, "").trim());
    } catch (e: any) { console.warn(`[menus] ${model}:`, String(e?.message).slice(0, 120)); }
  }
  return null;
}

const list = (a: unknown, n = 10) => (Array.isArray(a) ? a : []).map(x => String(x).trim().toLowerCase()).filter(Boolean).slice(0, n);

function toPlaceMenu(out: any, sources: string[]): PlaceMenu & { name?: string } {
  const dishes: MenuDish[] = (Array.isArray(out?.dishes) ? out.dishes : []).slice(0, 25).map((d: any) => ({
    dish: String(d?.dish ?? "").trim().slice(0, 80), price: String(d?.price ?? "").trim().slice(0, 20) || undefined,
    description: String(d?.description ?? "").trim().slice(0, 160) || undefined,
    contains: list(d?.contains), may_contain: list(d?.may_contain), tags: list(d?.tags, 8),
  })).filter((d: MenuDish) => d.dish);
  const rating = Number(out?.rating);
  return {
    found: dishes.length > 0, name: String(out?.name ?? "").trim().slice(0, 80) || undefined,
    rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : undefined,
    reviews: Number(out?.reviews) > 0 ? Math.round(Number(out.reviews)) : undefined,
    price: String(out?.price ?? "").trim() || undefined, cuisine: String(out?.cuisine ?? "").trim() || undefined,
    dishes, sources,
  };
}

/** "Check a restaurant": a menu page URL, read through Bright Data. Cached a week per URL. */
export async function menuFromUrl(rawUrl: string) {
  const url = new URL(rawUrl).toString();
  return placeCache(`menu-url:${url}`, 24 * 7, async () => {
    const page = await brightDataFetch(url, 30_000);
    if (!page?.ok) return { found: false, dishes: [], sources: [] } as PlaceMenu & { name?: string };
    let text = `PAGE (${url}):\n${pageText(page.text).slice(0, 9000)}`;
    // A restaurant home page: follow its "Menu" link
    const link = /menu/i.test(url) ? "" : menuLink(page.text, url);
    if (link) {
      const m = await brightDataFetch(link, 30_000);
      if (m?.ok) text = `MENU PAGE (${link}):\n${pageText(m.text).slice(0, 9000)}`;
    }
    const title = page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const out = await readMenu({ name: title.split(/[|\-–]/)[0].trim(), address: undefined, cuisine: "" }, text);
    return toPlaceMenu(out, [`${new URL(url).hostname.replace(/^www\./, "")} (via Bright Data)`]);
  }, m => m.found);
}

/** "Check a restaurant": a photo of a menu or allergen chart, read by Gemini. */
export async function menuFromImage(image: { data: string; mimeType: string }) {
  const out = await readMenu({ name: "", address: undefined, cuisine: "" }, "", image);
  return toPlaceMenu(out, ["your menu photo"]);
}

export async function placeMenu(place: Place, city: string): Promise<PlaceMenu> {
  return placeCache(`menu:${place.id}`, 24 * 7, async () => {
    const where = place.address || city;
    const q = encodeURIComponent(`${place.name} ${where} menu`);
    const [serp, site] = await Promise.all([
      brightDataFetch(`https://www.google.com/search?q=${q}&hl=en&gl=us`, 30_000),
      place.website ? websiteMenu(place.website).catch(() => "") : Promise.resolve(""),
    ]);
    const google = serp?.ok ? pageText(serp.text) : "";
    const start = Math.max(0, google.search(/Web results|Search Results/i));
    const text = [google ? `GOOGLE RESULTS:\n${google.slice(start, start + 7000)}` : "", site].filter(Boolean).join("\n\n");
    if (!text) return { found: false, dishes: [], sources: [] };
    const out = await readMenu(place, text);
    if (!out) return { found: false, dishes: [], sources: [] };
    const dishes: MenuDish[] = (Array.isArray(out.dishes) ? out.dishes : []).slice(0, 25).map((d: any) => ({
      dish: String(d?.dish ?? "").trim().slice(0, 80), price: String(d?.price ?? "").trim().slice(0, 20) || undefined,
      description: String(d?.description ?? "").trim().slice(0, 160) || undefined,
      contains: list(d?.contains), may_contain: list(d?.may_contain), tags: list(d?.tags, 8),
    })).filter((d: MenuDish) => d.dish);
    const rating = Number(out.rating);
    return {
      found: dishes.length > 0,
      rating: rating > 0 && rating <= 5 ? Math.round(rating * 10) / 10 : undefined,
      reviews: Number(out.reviews) > 0 ? Math.round(Number(out.reviews)) : undefined,
      price: String(out.price ?? "").trim() || undefined, cuisine: String(out.cuisine ?? "").trim() || undefined,
      dishes, sources: ["Google (via Bright Data)", ...(place.website ? [new URL(place.website).hostname.replace(/^www\./, "")] : [])],
    };
  }, m => m.found || m.rating !== undefined);
}
