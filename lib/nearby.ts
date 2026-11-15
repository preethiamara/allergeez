import { sql } from "@/lib/db";

// Places to eat near the user, in 1 / 5 / 10 mile rings, from OpenStreetMap (free, no key).
// Ratings and menus come later, per place, through Bright Data (see lib/menus.ts).

export const RINGS = [1, 5, 10] as const;            // miles
export type Ring = (typeof RINGS)[number];
export const MILE_M = 1609.34;

export type Place = {
  id: string;            // "node/123" (OpenStreetMap)
  name: string;
  lat: number; lng: number;
  miles: number;
  ring: Ring;
  cuisine: string;       // "pizza;italian" → "pizza, italian"
  kind: string;          // restaurant | fast_food | cafe
  website?: string;
  address?: string;
};

const UA = "AllerGeez/0.1 (food-allergy hackathon app)";
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function cached<T>(key: string, maxAgeHours: number, load: () => Promise<T>, worthKeeping: (d: T) => boolean = () => true): Promise<T> {
  const rows = await sql`select data from place_cache where key = ${key} and created_at > now() - make_interval(hours => ${maxAgeHours})`;
  if (rows[0]) return rows[0].data as T;
  const data = await load();
  if (!worthKeeping(data)) return data; // don't cache empty / failed lookups
  await sql`insert into place_cache (key, data) values (${key}, ${JSON.stringify(data)}::jsonb)
            on conflict (key) do update set data = excluded.data, created_at = now()`;
  return data;
}

/** OpenStreetMap's Overpass API: rich and accurate, but the free servers are often busy (429/504) or slow. */
async function overpass(query: string) {
  let last: unknown;
  for (const [i, url] of OVERPASS.entries()) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query), signal: AbortSignal.timeout(i === 0 ? 45_000 : 25_000), cache: "no-store" });
      const text = await r.text();
      if (r.ok && text.trim().startsWith("{")) return JSON.parse(text);
      last = new Error(`Overpass ${r.status}`);
      console.warn(`[nearby] ${new URL(url).host} answered ${r.status}`);
      if (r.status === 429) await sleep(1500); // rate-limited: brief pause before the next server
    } catch (e: any) { last = e; console.warn(`[nearby] ${new URL(url).host} failed: ${e?.message}`); }
  }
  throw last ?? new Error("Map data unavailable");
}

/** Fast source: Nominatim (also OpenStreetMap), ~1s per request but keyword-based. Max one request per second (its policy). */
async function nominatimPlaces(lat: number, lng: number) {
  const box = (miles: number) => {
    const dLat = miles / 69, dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
    return `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`;
  };
  // Nearest ring first; together these cover all three rings in ~4 seconds
  const searches: [string, number][] = [["restaurant", 1], ["fast food", 2], ["restaurant", 5], ["restaurant", 10]];
  const out: any[] = [];
  let state = "";
  for (const [i, [q, miles]] of searches.entries()) {
    if (i) await sleep(1000);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${box(miles)}&bounded=1&limit=50&extratags=1&addressdetails=1`,
        { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (r.ok) for (const x of await r.json()) {
        if (!x?.name || !["restaurant", "fast_food", "cafe"].includes(x.type)) continue;
        const a = x.address ?? {}, t = x.extratags ?? {};
        state ||= a.state ?? "";
        out.push({ type: x.osm_type, id: x.osm_id, lat: Number(x.lat), lon: Number(x.lon),
          tags: { name: x.name, amenity: x.type, cuisine: t.cuisine, website: t.website || t["contact:website"],
            "addr:housenumber": a.house_number, "addr:street": a.road, "addr:city": a.city || a.town || a.village } });
      }
    } catch (e: any) { console.warn("[nearby] nominatim failed:", e?.message); }
  }
  return { elements: out, state };
}

const ringOf = (miles: number): Ring => (miles <= 1 ? 1 : miles <= 5 ? 5 : 10);

/** Merge raw OpenStreetMap elements into places, de-duplicated, up to 12 per ring (nearest first). */
function toPlaces(lat: number, lng: number, elements: any[]): Place[] {
  const seen = new Set<string>();
  const all: Place[] = [];
  const nameKey = (n: string, la: number, lo: number) => `${n.toLowerCase().replace(/[^a-z0-9]/g, "")}@${la.toFixed(3)},${lo.toFixed(3)}`;
  for (const e of elements) {
    const id = `${e.type}/${e.id}`;
    const plat = e.lat ?? e.center?.lat, plng = e.lon ?? e.center?.lon;
    if (seen.has(id) || plat == null || !e.tags?.name || seen.has(nameKey(e.tags.name, plat, plng))) continue;
    seen.add(id); seen.add(nameKey(e.tags.name, plat, plng));
    const miles = milesBetween({ lat, lng }, { lat: plat, lng: plng });
    if (miles > 10) continue;
    const t = e.tags;
    all.push({
      id, name: String(t.name).slice(0, 80), lat: plat, lng: plng, miles: Math.round(miles * 10) / 10, ring: ringOf(miles),
      cuisine: String(t.cuisine ?? "").replace(/_/g, " ").split(";").filter(Boolean).slice(0, 3).join(", "),
      kind: t.amenity, website: t.website || t["contact:website"] || undefined,
      address: [t["addr:housenumber"], t["addr:street"], t["addr:city"]].filter(Boolean).join(" ") || undefined,
    });
  }
  return RINGS.flatMap(r => all.filter(p => p.ring === r).sort((a, b) => a.miles - b.miles).slice(0, 12));
}

async function store(key: string, data: unknown) {
  await sql`insert into place_cache (key, data) values (${key}, ${JSON.stringify(data)}::jsonb)
            on conflict (key) do update set data = excluded.data, created_at = now()`;
}

const upgrading = new Set<string>();
/** Slow but complete: Overpass. Runs in the background and replaces the quick result in the cache when it lands. */
function upgradeInBackground(lat: number, lng: number, key: string, quick: { elements: any[] }, city: string) {
  if (upgrading.has(key)) return;
  upgrading.add(key);
  const filter = `["amenity"~"^(restaurant|fast_food|cafe)$"]["name"]`;
  const q = (m: number, n: number) => `nwr${filter}(around:${Math.round(m * MILE_M)},${lat},${lng});out center ${n};`;
  Promise.all([
    overpass(`[out:json][timeout:40];${q(1, 60)}`).catch(() => ({ elements: [] })),
    overpass(`[out:json][timeout:40];${q(10, 400)}`).catch(() => ({ elements: [] })),
  ]).then(async ([near, wide]) => {
    if (!near.elements?.length && !wide.elements?.length) return;
    const places = toPlaces(lat, lng, [...near.elements, ...wide.elements, ...quick.elements]);
    await store(key, { places, city, complete: true });
    console.log(`[nearby] full map data ready for ${key} (${places.length} places)`);
  }).catch(e => console.warn("[nearby] background upgrade failed:", e?.message))
    .finally(() => upgrading.delete(key));
}

/**
 * Named places to eat within 10 miles, a sample from each ring (nearest first).
 * Fast path: answer in a few seconds from Nominatim, and fetch the complete Overpass data in the
 * background so the next visit (cached for a day) has the full list.
 */
export async function placesNear(lat: number, lng: number): Promise<{ places: Place[]; city: string; complete?: boolean }> {
  const key = `places:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const [hit] = await sql`select data, created_at > now() - interval '24 hours' as fresh from place_cache where key = ${key}`;
  if (hit?.fresh && hit.data?.places?.length) {
    // A quick (partial) result: keep showing it, and make sure the full data is on its way
    if (!hit.data.complete) upgradeInBackground(lat, lng, key, { elements: [] }, hit.data.city);
    return hit.data;
  }
  const quick = await nominatimPlaces(lat, lng).catch(() => ({ elements: [] as any[], state: "" }));
  const firstCity = quick.elements.find(e => e.tags?.["addr:city"])?.tags["addr:city"];
  const city = firstCity ? [firstCity, quick.state].filter(Boolean).join(", ") : await reverseCity(lat, lng).catch(() => "");
  const places = toPlaces(lat, lng, quick.elements);
  if (places.length) {
    await store(key, { places, city, complete: false });
    upgradeInBackground(lat, lng, key, quick, city);
    return { places, city, complete: false };
  }
  // Nothing from the fast source (rural areas, or it's down): wait for the complete source
  const filter = `["amenity"~"^(restaurant|fast_food|cafe)$"]["name"]`;
  const wide = await overpass(`[out:json][timeout:40];nwr${filter}(around:${Math.round(10 * MILE_M)},${lat},${lng});out center 400;`).catch(() => ({ elements: [] }));
  const full = toPlaces(lat, lng, wide.elements ?? []);
  if (full.length) await store(key, { places: full, city, complete: true });
  return { places: full, city, complete: true };
}

/** "Brooklyn, New York" for a point (used to make place searches specific). */
export async function reverseCity(lat: number, lng: number) {
  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lng}`,
    { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const j = await r.json();
  const a = j?.address ?? {};
  return [a.city || a.town || a.village || a.suburb || a.county, a.state].filter(Boolean).join(", ");
}

/** City / ZIP / address → coordinates, for people who don't share their location. */
export async function geocode(q: string) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const [hit] = await r.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), label: String(hit.display_name).split(",").slice(0, 3).join(",") } : null;
}

export { cached as placeCache };
