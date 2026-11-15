import { geocode, placesNear } from "@/lib/nearby";

export const maxDuration = 90;

// GET /api/nearby?lat=..&lng=..   → places in 1 / 5 / 10 mile rings
// GET /api/nearby?q=Edison, NJ    → same, for a typed city / ZIP / address
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  try {
    let lat = Number(p.get("lat")), lng = Number(p.get("lng")), label = "";
    const q = (p.get("q") ?? "").trim();
    if (q) {
      const g = await geocode(q.slice(0, 120));
      if (!g) return Response.json({ error: `Couldn’t find “${q}”. Try a city and state, or a ZIP code.` }, { status: 404 });
      ({ lat, lng, label } = g);
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
      return Response.json({ error: "Share your location or type a city" }, { status: 400 });
    const { places, city } = await placesNear(lat, lng);
    // Empty usually means the free map services were busy, not that there's nothing to eat nearby
    if (!places.length) return Response.json({ error: "The map service is busy right now, so Gee couldn’t load places. Try again in a minute." }, { status: 503 });
    return Response.json({ center: { lat, lng }, label: label || city, city, places });
  } catch (e: any) {
    console.error("[nearby]", e);
    return Response.json({ error: "Couldn’t load places nearby right now. Try again in a moment." }, { status: 502 });
  }
}
