import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getProfile } from "@/lib/records";
import { tasteProfileFor } from "@/lib/tasteStore";
import { matchDishes, type MenuDish } from "@/lib/taste";
import { detectAdditives, detectNaturalTriggers, matchesUserList } from "@/lib/additives";
import { geocode, placesNear, type Place } from "@/lib/nearby";
import { placeMenu } from "@/lib/menus";

// Gee's app tools: the same features people use in the app (Food Checker, Food Near Me, the emergency
// contact), callable by the Mastra agent mid-conversation. Each returns small, speakable facts plus a
// `card` the app renders under Gee's reply.

const userOf = (context: any): string => context?.requestContext?.get("userId") ?? "guest-unknown";

/** "Is pad thai safe for me?" Same matching as Food Checker: allergens (with spelling fixes), hidden ingredients, diet, triggers. */
export const checkFoodSafety = createTool({
  id: "check-food-safety",
  description: "Check whether a food or dish is safe for this person: their allergens (including hidden ingredients like peanuts in pad thai or avocado in guacamole), their diet, likely triggers from past reactions, additives and natural triggers. Use when they ask if they can eat something.",
  inputSchema: z.object({ food: z.string().min(1).describe("The food or dish, as they said it, e.g. 'pad thai' or 'Chipotle chicken bowl with guac'") }),
  execute: async ({ food }, context) => {
    const taste = await tasteProfileFor(userOf(context));
    const dish: MenuDish = { dish: food, description: food, contains: [], may_contain: [], tags: [] };
    const [m] = matchDishes([dish], taste);
    const additives = detectAdditives([food]).filter(a => matchesUserList(taste.avoid, a)).map(a => a.name);
    const triggers = detectNaturalTriggers([food]).filter(t => matchesUserList(taste.avoid, { trigger: t.trigger })).map(t => t.trigger);
    const verdict = m.verdict === "avoid" || additives.length || triggers.length ? "avoid" : m.verdict;
    const reasons = [...m.reasons, ...additives.map(a => `has ${a}`), ...triggers.map(t => `high in ${t}`)];
    return {
      food, verdict, reasons, checkedAgainst: taste.avoid,
      note: taste.avoid.length ? "Estimated from the dish name; recipes vary, so check the label or ask the restaurant." : "They have no allergens saved yet.",
      card: { type: "food_check" as const, food, verdict, reasons, checkedAgainst: taste.avoid },
    };
  },
});

/** "Where can I eat near Edison that's safe?" Same data as Food Near Me: OpenStreetMap places + Bright Data menus/ratings. */
export const findSafeFoodNearby = createTool({
  id: "find-safe-food-nearby",
  description: "Find nearby restaurants with dishes that are safe for this person (screened against their allergens, diet and triggers), using real menus and Google ratings. Use when they ask where they can eat, or want safe options near a place. Needs a city, ZIP or address.",
  inputSchema: z.object({
    place: z.string().min(2).describe("City, ZIP or address, e.g. 'Edison, NJ'"),
    craving: z.string().optional().describe("What they feel like, e.g. 'tacos' or 'something spicy'"),
  }),
  execute: async ({ place, craving }, context) => {
    const spot = await geocode(place);
    if (!spot) return { found: false, message: `Couldn't find "${place}". Ask for a city and state or a ZIP code.`, card: null };
    const [{ places, city }, taste] = await Promise.all([placesNear(spot.lat, spot.lng), tasteProfileFor(userOf(context))]);
    if (craving) taste.likes = [...taste.likes, craving];
    // Check the nearest few menus at once; stop waiting after ~20s so Gee can still answer
    const nearest = places.filter(p => p.miles <= 5).slice(0, 5);
    const settled = await Promise.race([
      Promise.allSettled(nearest.map(async (p: Place) => ({ p, menu: await placeMenu(p, city) }))),
      new Promise<PromiseSettledResult<{ p: Place; menu: Awaited<ReturnType<typeof placeMenu>> }>[]>(r => setTimeout(() => r([]), 20_000)),
    ]);
    const results = settled.flatMap(s => (s.status === "fulfilled" ? [s.value] : []))
      .map(({ p, menu }) => {
        const picks = matchDishes(menu.dishes, taste).filter(d => d.verdict === "great" || d.verdict === "ok").slice(0, 2);
        return { name: p.name, miles: p.miles, rating: menu.rating, reviews: menu.reviews, cuisine: p.cuisine, picks: picks.map(d => ({ dish: d.dish, why: d.reasons[0] ?? "no allergens of yours listed" })) };
      })
      .filter(r => r.picks.length)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.miles - b.miles)
      .slice(0, 3);
    return {
      found: results.length > 0, area: spot.label, places: results, checkedAgainst: taste.avoid,
      message: results.length ? "" : "No menus with safe picks came back yet. Suggest opening Food Checker → Find food near me for the full map.",
      card: { type: "safe_nearby" as const, area: spot.label, places: results, checkedAgainst: taste.avoid },
    };
  },
});

/** "Text my mom that I'm having a reaction." Prepares the message; the person taps to send it from their phone. */
export const prepareContactMessage = createTool({
  id: "prepare-contact-message",
  description: "Prepare a text message to the person's saved emergency contact (the app shows a button they tap to send it from their phone; Gee can't send it by itself). Use when they ask you to tell, text or notify someone, or when a reaction is serious and they want help.",
  inputSchema: z.object({ message: z.string().min(1).max(320).describe("Short first-person text, e.g. \"I'm having an allergic reaction (hives after shrimp). Can you call me?\"") }),
  execute: async ({ message }, context) => {
    const profile = await getProfile(userOf(context));
    const name = profile.contact_name?.trim(), phone = profile.contact_phone?.replace(/[^0-9+]/g, "");
    if (!phone) return { ready: false, message: "They haven't saved an emergency contact's number. Tell them they can add one in Profile.", card: { type: "contact" as const, ready: false } };
    return {
      ready: true, contactName: name || "your emergency contact",
      card: { type: "contact" as const, ready: true, name: name || "Emergency contact", href: `sms:${phone}?&body=${encodeURIComponent(message)}`, message },
    };
  },
});

export const appTools = { checkFoodSafety, findSafeFoodNearby, prepareContactMessage };
export type GeeCard =
  | { type: "food_check"; food: string; verdict: string; reasons: string[]; checkedAgainst: string[] }
  | { type: "safe_nearby"; area: string; places: { name: string; miles: number; rating?: number; reviews?: number; cuisine: string; picks: { dish: string; why: string }[] }[]; checkedAgainst: string[] }
  | { type: "contact"; ready: boolean; name?: string; href?: string; message?: string };
