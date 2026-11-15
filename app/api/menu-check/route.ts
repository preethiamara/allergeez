import { getActor } from "@/lib/session";
import { menuFromImage, menuFromUrl } from "@/lib/menus";
import { matchDishes } from "@/lib/taste";
import { tasteProfileFor } from "@/lib/tasteStore";

export const maxDuration = 90;

/** "Check a restaurant": POST { url } (menu page, read via Bright Data) or { image, mimeType } (menu photo, read by Gemini). */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const url = typeof b?.url === "string" ? b.url.trim() : "";
  const image = typeof b?.image === "string" && b.image.length > 100 ? { data: b.image, mimeType: String(b?.mimeType || "image/jpeg") } : null;
  if (!url && !image) return Response.json({ error: "Paste a menu link or add a menu photo" }, { status: 400 });
  if (url && !/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)) return Response.json({ error: "That doesn’t look like a web address. Try something like https://example.com/menu" }, { status: 400 });
  try {
    const { userId } = await getActor();
    const [menu, taste] = await Promise.all([image ? menuFromImage(image) : menuFromUrl(url), tasteProfileFor(userId)]);
    if (!menu.found) return Response.json({ error: image ? "Gee couldn’t read any dishes in that photo. Try a clearer, closer photo of the menu." : "Gee couldn’t find a menu on that page. Try the restaurant’s menu page link." }, { status: 422 });
    const matches = matchDishes(menu.dishes, taste);
    return Response.json({
      ...menu, name: menu.name || (url ? new URL(url).hostname.replace(/^www\./, "") : "Your menu"),
      matches, avoid: taste.avoid,
      summary: { great: matches.filter(m => m.verdict === "great").length, safe: matches.filter(m => m.verdict === "great" || m.verdict === "ok").length, total: matches.length },
    });
  } catch (e: any) {
    console.error("[menu-check]", e);
    return Response.json({ error: "Couldn’t check that menu right now. Try again in a moment."}, { status: 502 });
  }
}
