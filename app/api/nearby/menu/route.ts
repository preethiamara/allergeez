import { getActor } from "@/lib/session";
import { placeMenu } from "@/lib/menus";
import { matchDishes } from "@/lib/taste";
import { tasteProfileFor } from "@/lib/tasteStore";
import type { Place } from "@/lib/nearby";

export const maxDuration = 90;

/** POST { place, city }: that place's rating + menu, with every dish scored for this user. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const pl = b?.place;
  if (!pl || typeof pl.id !== "string" || !/^(node|way|relation)\/\d+$/.test(pl.id) || typeof pl.name !== "string")
    return Response.json({ error: "Missing place" }, { status: 400 });
  const website = typeof pl.website === "string" && /^https?:\/\//.test(pl.website) ? pl.website : undefined;
  const place: Place = {
    id: pl.id, name: pl.name.slice(0, 80), lat: Number(pl.lat), lng: Number(pl.lng), miles: Number(pl.miles) || 0, ring: pl.ring,
    cuisine: String(pl.cuisine ?? "").slice(0, 60), kind: String(pl.kind ?? ""), website, address: pl.address ? String(pl.address).slice(0, 120) : undefined,
  };
  try {
    const { userId } = await getActor();
    const [menu, profileT] = await Promise.all([placeMenu(place, String(b?.city ?? "").slice(0, 80)), tasteProfileFor(userId)]);
    const matches = matchDishes(menu.dishes, profileT);
    const great = matches.filter(m => m.verdict === "great").length, safe = matches.filter(m => m.verdict === "great" || m.verdict === "ok").length;
    return Response.json({ ...menu, matches, avoid: profileT.avoid, summary: { great, safe, total: matches.length, best: matches.find(m => m.verdict !== "avoid")?.dish } });
  } catch (e: any) {
    console.error("[nearby/menu]", e);
    return Response.json({ error: "Couldn’t get this menu right now." }, { status: 502 });
  }
}
