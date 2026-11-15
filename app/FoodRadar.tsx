"use client";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import { AppHeader, Buddy, Icon } from "./ui";
import { prepareImage } from "./image";

// Food-O-Radar (from the Figma design), backed by real data:
// - FoodRadarMap: places near the user (OpenStreetMap) on a live map, each with its Google rating and menu
//   (via Bright Data), dishes ranked for the user's allergens and taste profile.
// - RestaurantScanner: a menu link (read via Bright Data) or a menu photo (read by Gemini), ranked the same way.
// - RecommendationModal: the shared "Recommended dishes" popup with "Log this meal".

type Place = { id: string; name: string; lat: number; lng: number; miles: number; ring: 1 | 5 | 10; cuisine: string; kind: string; website?: string; address?: string };
type Match = { dish: string; price?: string; description?: string; contains: string[]; tags: string[]; score: number; verdict: "great" | "ok" | "ask" | "avoid"; reasons: string[] };
export type MenuResult = { loading?: boolean; error?: string; found?: boolean; name?: string; rating?: number; reviews?: number; price?: string; cuisine?: string;
  matches?: Match[]; sources?: string[]; avoid?: string[]; summary?: { great: number; safe: number; total: number; best?: string } };
type Taste = { likes: string[]; inferredLikes: string[]; diet: string; avoid: string[]; irritants: string[] };
export type LogDish = (dish: { dish: string; description?: string; from: string }) => void;

const RADII = [0.5, 1, 2, 5, 10];
const DIETS = ["", "vegetarian", "vegan", "pescatarian", "gluten-free", "dairy-free", "halal", "kosher"];
const MILE_M = 1609.34;
const PARALLEL = 4;     // menus checked at once
const TARGET_SAFE = 6;  // keep checking nearby menus until this many places have safe picks (caps Bright Data use)

async function jsonFetch(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}

/** A place whose menu check finished with nothing for this user: no menu online, an error, or no safe dish. */
const nothingForYou = (m?: MenuResult) => !!m && !m.loading && (!!m.error || !m.found || safePicks(m).length === 0);
const safePicks = (m?: MenuResult) => (m?.matches ?? []).filter(x => x.verdict === "great" || x.verdict === "ok");
const badgeFor = (m?: MenuResult) => !m ? "Tap to check the menu" : m.loading ? "Checking the menu…" : m.error ? "Couldn’t get the menu"
  : !m.found ? "No menu found online" : safePicks(m).length ? `${safePicks(m).length} safe pick${safePicks(m).length > 1 ? "s" : ""} · best: ${safePicks(m)[0].dish}` : "Nothing fits you safely";

// ---------------------------------------------------------------- recommendations popup
export function RecommendationModal({ title, meta, result, onClose, onLog }: {
  title: string; meta: string[]; result: MenuResult; onClose: () => void; onLog: LogDish;
}) {
  const [showAvoid, setShowAvoid] = useState(false);
  const all = result.matches ?? [];
  const recommended = all.filter(m => m.verdict !== "avoid");
  const avoid = all.filter(m => m.verdict === "avoid");
  const badge = result.loading ? "Checking menu…" : result.found ? (safePicks(result).length ? `${safePicks(result).length} safe picks` : "Use caution") : "No menu found";
  return (
    <div className="recommendation-backdrop" role="presentation" onClick={onClose}>
      <section className="recommendation-modal" role="dialog" aria-modal="true" aria-labelledby="rec-modal-title" onClick={e => e.stopPropagation()}>
        <div className="recommendation-modal__header">
          <div>
            <span className="recommendation-modal__badge">{badge}</span>
            <h2 id="rec-modal-title">{result.name || title}</h2>
            <div className="recommendation-modal__meta">
              {result.rating ? <span className="rating-pill"><Icon name="star" size={13} /> {result.rating}{result.reviews ? ` (${result.reviews.toLocaleString()})` : ""}</span> : null}
              {[result.price, ...meta].filter(Boolean).map((x, i) => <span key={i}>{(i > 0 || result.rating) && <span className="dot-sep">· </span>}{x}</span>)}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close recommendations"><Icon name="close" /></button>
        </div>

        {result.loading ? (
          <div className="safety-checking"><Buddy /><p className="allergens-modal-desc">Reading the menu and checking every dish for you…</p></div>
        ) : result.error ? (
          <p className="save-error">{result.error}</p>
        ) : !result.found ? (
          <p className="allergens-modal-desc">Gee couldn’t find this menu online. Ask the restaurant about your allergens before you order.</p>
        ) : (<>
          <div className="recommendation-safety-banner">
            <span className="safe-shield-icon"><Icon name="shield" size={18} /></span>
            <p><strong>Safe options for you</strong><br />
              {result.avoid?.length ? `Screened against your profile allergens (${result.avoid.join(", ")}).` : "Add your allergens in Allergens so Gee can screen every dish for you."}</p>
          </div>
          <div className="recommendation-items-list">
            <h3>Recommended dishes ({recommended.length})</h3>
            {recommended.length === 0 && <p className="allergens-modal-desc">Nothing on this menu looks safe for you.</p>}
            {recommended.map((m, i) => (
              <div key={m.dish} className="recommendation-item-card">
                <div className="recommendation-item-top">
                  <div className="recommendation-item-title-row"><span className="item-num">{i + 1}</span><h4>{m.dish}</h4></div>
                </div>
                <div className="recommendation-item-tags">
                  <span className={`tag-chip ${m.verdict === "ask" ? "tag-chip--caution" : "tag-chip--safe"}`}>{m.verdict === "great" ? "Great for you" : m.verdict === "ok" ? "Allergen screened" : "Ask first"}</span>
                  {m.reasons.slice(0, 2).map(r => <span key={r} className={`tag-chip ${m.verdict === "ask" ? "tag-chip--caution" : "tag-chip--safe"}`}>{r}</span>)}
                </div>
                {m.description && <p className="item-desc">{m.description}</p>}
                {!m.description && m.contains.length > 0 && <p className="item-desc">Has {m.contains.join(", ")}</p>}
                <button className="log-this-food-btn" onClick={() => onLog({ dish: m.dish, description: m.description, from: result.name || title })}>
                  <Icon name="plus" size={15} /> Log this meal
                </button>
              </div>
            ))}
            {avoid.length > 0 && (
              <button className="text-button" onClick={() => setShowAvoid(s => !s)}>{showAvoid ? "Hide" : "Show"} {avoid.length} dish{avoid.length > 1 ? "es" : ""} to avoid</button>
            )}
            {showAvoid && avoid.map(m => (
              <div key={m.dish} className="recommendation-item-card recommendation-item-card--avoid">
                <div className="recommendation-item-top"><h4>{m.dish}</h4></div>
                <div className="recommendation-item-tags"><span className="tag-chip tag-chip--avoid">{m.reasons[0]}</span></div>
              </div>
            ))}
          </div>
          <p className="disclaimer">From {result.sources?.join(" and ")}. Allergens are estimated from the menu: always tell your server about your allergy.</p>
        </>)}
        <div className="recommendation-modal__footer"><button className="btn-done" onClick={onClose}>Done</button></div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Food Near Me (radar map)
export function FoodRadarMap({ onBack, onEmergency, onLog }: { onBack: () => void; onEmergency: () => void; onLog: LogDish }) {
  const [where, setWhere] = useState<{ center: { lat: number; lng: number }; label: string; city: string; places: Place[] } | null>(null);
  const [locating, setLocating] = useState<"" | "gps" | "search">("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(1);
  const [menus, setMenus] = useState<Record<string, MenuResult>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [taste, setTaste] = useState<Taste | null>(null);
  const [tasteOpen, setTasteOpen] = useState(false);
  const [likeDraft, setLikeDraft] = useState("");
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pins = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const inflight = useRef(new Set<string>());
  const results = useRef<Record<string, MenuResult>>({});
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => { jsonFetch("/api/taste").then(setTaste).catch(() => {}); }, []);

  const load = useCallback(async (url: string) => {
    setError(""); setMenus({}); setOpenId(null); inflight.current.clear(); results.current = {}; setShowHidden(false);
    try {
      const d = await jsonFetch(url);
      setWhere(d);
      setRadius(d.places.some((p: Place) => p.miles <= 1) ? 1 : d.places.some((p: Place) => p.miles <= 5) ? 5 : 10);
    } catch (e: any) { setError(e.message); }
    finally { setLocating(""); }
  }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setError("Your browser can’t share location. Type a city or ZIP instead."); return; }
    setLocating("gps"); setError("");
    navigator.geolocation.getCurrentPosition(
      pos => load(`/api/nearby?lat=${pos.coords.latitude.toFixed(5)}&lng=${pos.coords.longitude.toFixed(5)}`),
      err => { setLocating(""); setError(err.code === 1 ? "Location is blocked. Allow it in your browser settings, or type a city or ZIP." : "Couldn’t get your location. Type a city or ZIP instead."); },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  };

  const checkMenu = useCallback(async (p: Place, force = false): Promise<MenuResult | undefined> => {
    if (!where || (!force && inflight.current.has(p.id))) return results.current[p.id];
    inflight.current.add(p.id);
    setMenus(m => ({ ...m, [p.id]: { ...m[p.id], loading: true, error: undefined } }));
    let d: MenuResult;
    try { d = await jsonFetch("/api/nearby/menu", { method: "POST", body: JSON.stringify({ place: p, city: where.city }) }); }
    catch (e: any) { d = { error: e.message }; }
    results.current[p.id] = d;
    setMenus(m => ({ ...m, [p.id]: d }));
    return d;
  }, [where]);

  const inRadius = useMemo(() => (where?.places ?? []).filter(p => p.miles <= radius).sort((a, b) => a.miles - b.miles), [where, radius]);
  // Places with no menu online or nothing safe for you are left out (unless you ask to see them)
  const hiddenCount = inRadius.filter(p => nothingForYou(menus[p.id])).length;
  const visible = useMemo(() => showHidden ? inRadius : inRadius.filter(p => !nothingForYou(menus[p.id])), [inRadius, menus, showHidden]);
  const numberOf = useMemo(() => new Map(visible.map((p, i) => [p.id, i + 1])), [visible]);

  // Check menus nearest-first, four at a time, until enough places have safe picks
  useEffect(() => {
    if (!where) return;
    let stop = false;
    const queue = inRadius.filter(p => !inflight.current.has(p.id));
    const good = () => inRadius.filter(p => safePicks(results.current[p.id]).length > 0).length;
    const worker = async (): Promise<void> => {
      while (!stop && good() < TARGET_SAFE) {
        const p = queue.shift();
        if (!p) return;
        await checkMenu(p);
      }
    };
    for (let i = 0; i < PARALLEL; i++) worker();
    return () => { stop = true; };
  }, [inRadius, where, checkMenu]);

  const openPlace = useCallback((p: Place) => { setOpenId(p.id); if (!menus[p.id]) checkMenu(p); }, [menus, checkMenu]);

  // Live map styled like the design's radar: concentric rings, a "YOU" marker, numbered red pins with names
  useEffect(() => {
    if (!where || !mapEl.current) return;
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const lf = L.current ?? (L.current = (mod as any).default ?? mod);
      if (cancelled || !mapEl.current) return;
      if (!map.current) {
        map.current = lf.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView([where.center.lat, where.center.lng], 13);
        lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
        pins.current = lf.layerGroup().addTo(map.current);
      }
      const layer = pins.current!;
      layer.clearLayers();
      const c: [number, number] = [where.center.lat, where.center.lng];
      [radius * 0.33, radius * 0.66, radius].forEach((r, i) =>
        lf.circle(c, { radius: r * MILE_M, color: "#d94f4f", opacity: [0.22, 0.14, 0.3][i], weight: 1.5, fill: i === 2, fillOpacity: 0.04, dashArray: i < 2 ? "4 3" : undefined }).addTo(layer));
      lf.marker(c, { icon: lf.divIcon({ className: "radar-you", html: `<span class="radar-you__label">YOU</span><span class="radar-you__dot"></span>`, iconSize: [30, 30], iconAnchor: [15, 22] }), zIndexOffset: 1000 }).addTo(layer);
      for (const p of visible) {
        const n = numberOf.get(p.id)!, m = menus[p.id];
        const tone = m?.found ? (safePicks(m).length ? "safe" : "none") : "unknown";
        const active = hoverId === p.id || openId === p.id;
        lf.marker([p.lat, p.lng], {
          icon: lf.divIcon({ className: `radar-pin radar-pin--${tone}${active ? " is-active" : ""}`,
            // Name labels only on the nearest few (and the one you're looking at), so they don't pile up
            html: `${n <= 6 || active ? `<span class="radar-pin__name">${p.name.slice(0, 16).replace(/</g, "&lt;")}</span>` : ""}<span class="radar-pin__num">${n}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
          zIndexOffset: active ? 900 : 0,
        }).on("click", () => openPlace(p)).addTo(layer);
      }
      map.current?.fitBounds(lf.latLng(c[0], c[1]).toBounds(radius * MILE_M * 2.15), { animate: true });
    })();
    return () => { cancelled = true; };
  }, [where, radius, visible, numberOf, menus, hoverId, openId, openPlace]);
  useEffect(() => () => { map.current?.remove(); map.current = null; }, []);

  const saveTaste = async (likes: string[], diet: string) => {
    try {
      setTaste(await jsonFetch("/api/taste", { method: "PUT", body: JSON.stringify({ likes, diet }) }));
      for (const p of where?.places ?? []) if (menus[p.id]?.found) checkMenu(p, true); // menus are cached server-side: quick re-score
    } catch (e: any) { setError(e.message); }
  };

  const open = openId ? where?.places.find(p => p.id === openId) : undefined;

  return (
    <div className="screen food-radar-map-screen">
      <AppHeader title="Food-O-Radar" onBack={onBack} onEmergency={onEmergency} />
      <section className="page-intro page-intro--compact">
        <div className="map-intro-row">
          <div><p className="eyebrow">Nearby Safe Bites</p><h2>Food Near Me</h2></div>
          {where && (
            <div className="radius-selector-pill">
              <label htmlFor="radius-select">Radius:</label>
              <select id="radius-select" value={radius} onChange={e => setRadius(Number(e.target.value))}>
                {RADII.map(r => <option key={r} value={r}>within {r} mile{r > 1 ? "s" : ""}</option>)}
              </select>
            </div>
          )}
        </div>
      </section>

      {!where ? (
        <div className="nearby-locate">
          <Buddy variant="starry" />
          <button className="primary-button" onClick={useMyLocation} disabled={!!locating}>
            <Icon name="radar" size={18} /> {locating === "gps" ? "Finding places near you…" : "Use my location"}
          </button>
          <form className="packaged-search-row" onSubmit={e => { e.preventDefault(); if (query.trim().length < 2) return; setLocating("search"); load(`/api/nearby?q=${encodeURIComponent(query.trim())}`); }}>
            <input className="packaged-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Or type a city or ZIP" aria-label="City or ZIP" />
            <button type="submit" className="packaged-search-btn" disabled={!!locating || query.trim().length < 2} aria-label="Search this area"><Icon name="search" size={20} /></button>
          </form>
          {locating && <p className="food-lookup__status">Scanning the area…</p>}
          {error && <p className="save-error">{error}</p>}
        </div>
      ) : (<>
        <div className="radar-map-container" aria-label="Interactive map of nearby safe restaurants">
          <div className="radar-map-canvas"><div className="radar-live-map" ref={mapEl} /></div>
          <div className="radar-map-hint"><span>Tap any pin or restaurant to see safe food recommendations</span></div>
        </div>
        <div className="nearby-where">
          <span><Icon name="pin" size={15} /> {where.label || "Your area"}</span>
          <button className="inline-link" onClick={() => { setWhere(null); map.current?.remove(); map.current = null; }}>Change</button>
        </div>

        {taste && (
          <section className="taste-card">
            <button className="taste-card__head" onClick={() => setTasteOpen(o => !o)} aria-expanded={tasteOpen}>
              <span><Icon name="spark" size={17} /> Your taste profile</span>
              <small>{[...taste.likes, ...taste.inferredLikes].slice(0, 3).join(", ") || "Add what you like"}{taste.diet ? ` · ${taste.diet}` : ""}</small>
            </button>
            {tasteOpen && (
              <div className="taste-card__body">
                <p className="safety-section-title">You like</p>
                <div className="possible-tags">
                  {taste.likes.map(l => <span key={l} className="tag-manual">{l}<button onClick={() => saveTaste(taste.likes.filter(x => x !== l), taste.diet)} aria-label={`Remove ${l}`}><Icon name="close" size={11} strokeWidth={2.4} /></button></span>)}
                  <form className="tag-add-form" onSubmit={e => { e.preventDefault(); const v = likeDraft.trim(); if (v) { saveTaste([...taste.likes, v], taste.diet); setLikeDraft(""); } }}>
                    <input value={likeDraft} onChange={e => setLikeDraft(e.target.value)} placeholder="e.g. spicy, thai, noodles" aria-label="Add something you like" />
                  </form>
                </div>
                {taste.inferredLikes.length > 0 && (<><p className="safety-section-title">From your meal log</p>
                  <div className="possible-tags">{taste.inferredLikes.map(l => <span key={l}>{l}</span>)}</div></>)}
                <p className="safety-section-title">Diet</p>
                <select className="taste-diet" value={taste.diet} onChange={e => saveTaste(taste.likes, e.target.value)}>
                  {DIETS.map(d => <option key={d} value={d}>{d || "No preference"}</option>)}
                </select>
                {(taste.avoid.length > 0 || taste.irritants.length > 0) && (<><p className="safety-section-title">Always avoided</p>
                  <div className="possible-tags">{taste.avoid.map(a => <span key={a} className="tag-alert">{a}</span>)}{taste.irritants.map(a => <span key={a}>possible trigger: {a}</span>)}</div></>)}
              </div>
            )}
          </section>
        )}

        {error && <p className="save-error">{error}</p>}
        <div className="radar-restaurant-list" aria-label="Restaurant recommendations">
          <div className="radar-list-header"><h3>Safe spots near you ({visible.length})</h3><span className="radar-safe-badge">Allergen Screened</span></div>
          {visible.length === 0 && (
            <p className="food-lookup__status">{inRadius.length ? `None of the places within ${radius} mile${radius > 1 ? "s" : ""} have a menu online with something safe for you. Try a bigger radius.` : `Nothing within ${radius} mile${radius > 1 ? "s" : ""}. Try a bigger radius.`}</p>
          )}
          {visible.map(p => {
            const m = menus[p.id];
            return (
              <button key={p.id} className="radar-restaurant-card" onClick={() => openPlace(p)} onMouseEnter={() => setHoverId(p.id)} onMouseLeave={() => setHoverId(null)}>
                <div className="radar-card-left">
                  <span className="radar-card-num">{numberOf.get(p.id)}</span>
                  <div className="radar-card-info">
                    <h4>{p.name}</h4>
                    <div className="radar-card-meta">
                      {m?.rating ? <><span className="rating-pill"><Icon name="star" size={13} /> {m.rating}{m.reviews ? ` (${m.reviews.toLocaleString()})` : ""}</span><span className="dot-sep">·</span></> : null}
                      <span className="distance-text">{p.miles} mi{p.cuisine ? ` · ${p.cuisine}` : ""}</span>
                    </div>
                    <p className="radar-card-badge">{badgeFor(m)}</p>
                  </div>
                </div>
                <span className="radar-info-btn" aria-label="View recommended items"><Icon name="info" size={18} /></span>
              </button>
            );
          })}
          {hiddenCount > 0 && (
            <p className="radar-hidden-note">
              {showHidden ? "Showing" : "Hid"} {hiddenCount} place{hiddenCount > 1 ? "s" : ""} with no menu online or nothing safe for you ·{" "}
              <button className="inline-link" onClick={() => setShowHidden(v => !v)}>{showHidden ? "Hide them" : "Show them"}</button>
            </p>
          )}
        </div>
      </>)}

      {open && (
        <RecommendationModal title={open.name} result={menus[open.id] ?? { loading: true }} onClose={() => setOpenId(null)}
          meta={[`${open.miles} mi`, open.address || open.cuisine]} onLog={onLog} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Check a restaurant (menu link or photo)
export function RestaurantScanner({ onBack, onEmergency, onLog }: { onBack: () => void; onEmergency: () => void; onLog: LogDish }) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<MenuResult | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const scan = async () => {
    setError(""); setScanning(true);
    try {
      const body = file ? await prepareImage(file).then(img => ({ image: img.data, mimeType: img.mimeType })) : { url: url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}` };
      setResult(await jsonFetch("/api/menu-check", { method: "POST", body: JSON.stringify(body) }));
    } catch (e: any) { setError(e.message); }
    finally { setScanning(false); }
  };

  return (
    <div className="screen food-radar-restaurant-screen">
      <AppHeader title="Check a restaurant" onBack={onBack} onEmergency={onEmergency} />
      <section className="page-intro page-intro--compact">
        <p className="eyebrow">Restaurant Scanner</p>
        <h2>Check a restaurant</h2>
        <p>Enter a menu website URL or upload menu photos to get instant safe food recommendations.</p>
      </section>
      <div className="restaurant-checker-card">
        <div className="checker-field">
          <label htmlFor="restaurant-url-input"><Icon name="link" size={18} /> Enter restaurant or menu URL</label>
          <input id="restaurant-url-input" type="url" placeholder="https://restaurant.com/menu" value={url} disabled={!!file}
            onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && url.trim()) scan(); }} />
          <div className="sample-url-chips">
            <span>Quick samples:</span>
            <button type="button" onClick={() => { setFile(null); setUrl("https://joespizzaofnewyork.com"); }}>Joe’s Pizza NYC</button>
            <button type="button" onClick={() => { setFile(null); setUrl("https://www.chipotle.com/order"); }}>Chipotle</button>
          </div>
        </div>
        <div className="or-divider"><span>OR</span></div>
        <div className="checker-field">
          <label><Icon name="camera" size={18} /> Upload menu photo</label>
          <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setUrl(""); } }} />
          {file ? (
            <div className="menu-uploaded-badge">
              <span className="file-icon">📄</span><span className="file-name">{file.name}</span>
              <button type="button" className="file-remove" onClick={() => setFile(null)}>Remove</button>
            </div>
          ) : (
            <button type="button" className="menu-dropzone" onClick={() => fileInput.current?.click()}>
              <span className="dropzone-icon"><Icon name="image" size={28} /></span>
              <strong>Snap or upload menu photo</strong>
              <small>Take a photo of physical menu or allergen chart</small>
            </button>
          )}
        </div>
        {error && <p className="save-error">{error}</p>}
        <button className="btn-scan-restaurant" disabled={scanning || (!url.trim() && !file)} onClick={scan}>
          {scanning ? "Scanning menu for allergens..." : <><Icon name="spark" size={18} /> Scan menu for safe food</>}
        </button>
      </div>
      {result && (
        <RecommendationModal title={result.name || "This menu"} result={result} meta={result.cuisine ? [result.cuisine] : []}
          onClose={() => setResult(null)} onLog={d => { setResult(null); onLog(d); }} />
      )}
    </div>
  );
}
