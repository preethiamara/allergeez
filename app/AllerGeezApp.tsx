"use client";
import { useMemo, useRef, useState } from "react";
import type { Meal, Profile, Reaction } from "@/lib/records";
import { AppHeader, Buddy, Icon } from "./ui";
import Emergency, { unlockEmergencyAudio } from "./Emergency";

type Screen =
  | "home" | "record" | "describe" | "review" | "history" | "allergens"
  | "gee-voice" | "reaction-form" | "reaction-review" | "reaction-history" | "emergency-guide";

type ScanResult = {
  name?: string; ingredients?: string[]; flags?: { ingredient: string; allergen: string; reason: string }[];
  common_allergens?: string[]; safe?: boolean; note?: string;
};

const SYMPTOMS = ["Itching", "Hives", "Swelling", "Stomach pain", "Nausea"];
const DURATIONS = ["Less than 15 minutes", "15–30 minutes", "30–60 minutes", "1–3 hours", "More than 3 hours", "Still happening"];

const jsonFetch = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body?.error) throw new Error(body?.error || `Request failed (${r.status})`);
  return body;
};

const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const sevClass = (s: number) => `severity-badge severity-${s >= 8 ? "high" : s >= 5 ? "medium" : "low"}`;

function timeAgo(iso: string) {
  const d = new Date(iso); const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (isNaN(mins)) return "";
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  return d.toLocaleString([], sameDay ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
const dayLabel = (iso: string, prev?: string) => {
  const d = new Date(iso).toDateString();
  if (prev && new Date(prev).toDateString() === d) return "";
  if (d === new Date().toDateString()) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  return d === y.toDateString() ? "Yesterday" : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};

// Phone photos are often 4-12 MB; shrink to a JPEG Gemini reads quickly.
async function prepareImage(file: File): Promise<{ data: string; mimeType: string }> {
  const toB64 = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(b); });
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", 0.85));
    return { data: await toB64(blob), mimeType: "image/jpeg" };
  } catch {
    return { data: await toB64(file), mimeType: file.type || "image/jpeg" };
  }
}

export default function AllerGeezApp({ initialMeals, initialReactions, initialProfile, loadError }: {
  initialMeals: Meal[]; initialReactions: Reaction[]; initialProfile: Profile; loadError?: string;
}) {
  const [screen, setScreen] = useState<Screen>("home");
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(loadError ?? "");

  // data
  const [meals, setMeals] = useState(initialMeals);
  const [reactions, setReactions] = useState(initialReactions);
  const [mealImages, setMealImages] = useState<Record<number, string>>({});
  const [reactionImages, setReactionImages] = useState<Record<number, string>>({});

  // profile
  const [allergens, setAllergens] = useState<string[]>(initialProfile.allergens);
  const [newAllergen, setNewAllergen] = useState("");
  const [contact, setContact] = useState({ name: initialProfile.contact_name, phone: initialProfile.contact_phone });
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileMsg, setProfileMsg] = useState("");

  // meal flow
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [scan, setScan] = useState<{ loading: boolean; result?: ScanResult; error?: string }>({ loading: false });
  const scanSeq = useRef(0);
  const libraryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // reaction flow
  const [symptoms, setSymptoms] = useState("");
  const [severity, setSeverity] = useState(4);
  const [occurredAt, setOccurredAt] = useState("");
  const [duration, setDuration] = useState("");
  const [mealName, setMealName] = useState("");
  const [reactionPhoto, setReactionPhoto] = useState<string>();
  const reactionInput = useRef<HTMLInputElement>(null);

  // voice
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");
  const recognizer = useRef<any>(null);

  const go = (s: Screen) => { setSaved(false); setSaveError(""); setScreen(s); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const openEmergency = () => setEmergencyOpen(true);

  // ---------- meals ----------
  async function runScan(input: { image?: { data: string; mimeType: string }; text?: string }) {
    const id = ++scanSeq.current;
    setScan({ loading: true });
    try {
      const result: ScanResult = await jsonFetch("/api/scan", {
        method: "POST",
        body: JSON.stringify({ image: input.image?.data, mimeType: input.image?.mimeType, text: input.text, allergens }),
      });
      if (id !== scanSeq.current) return;
      setScan({ loading: false, result });
      if (input.image && !desc.trim() && result.ingredients?.length) setDesc(result.ingredients.join(", "));
    } catch (e: any) {
      if (id === scanSeq.current) setScan({ loading: false, error: e?.message ?? "Gee couldn't read that" });
    }
  }
  const lastScanInput = useRef<Parameters<typeof runScan>[0]>({});

  async function onMealPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    setDesc(""); setScan({ loading: true }); go("review");
    const image = await prepareImage(file);
    setPhoto(`data:${image.mimeType};base64,${image.data}`);
    lastScanInput.current = { image };
    runScan({ image });
  }

  function reviewDescription() {
    setPhoto(undefined);
    lastScanInput.current = { text: desc };
    go("review");
    runScan({ text: desc });
  }

  const mealFlags = useMemo(() => {
    const r = scan.result;
    const mine = [...new Set((r?.flags ?? []).map(f => f.allergen.toLowerCase()))];
    const common = [...new Set((r?.common_allergens ?? []).map(a => a.toLowerCase()))].filter(a => !mine.includes(a));
    return { mine, common };
  }, [scan.result]);

  async function saveMeal() {
    setSaveError("");
    const details = desc.trim() || "Food photo";
    const fallback = details.split(/[,.\n]/)[0].trim();
    try {
      const meal: Meal = await jsonFetch("/api/meals", {
        method: "POST",
        body: JSON.stringify({ name: scan.result?.name || (fallback.length > 34 ? "New meal" : fallback), details, flags: [...mealFlags.mine, ...mealFlags.common] }),
      });
      setMeals(m => [meal, ...m]);
      if (photo) setMealImages(m => ({ ...m, [meal.id]: photo }));
      setSaved(true);
    } catch (e: any) { setSaveError(e.message); }
  }

  const resetMeal = () => { setDesc(""); setPhoto(undefined); setScan({ loading: false }); go("home"); };

  async function deleteMeal(id: number) {
    try { await jsonFetch(`/api/meals?id=${id}`, { method: "DELETE" }); setMeals(m => m.filter(x => x.id !== id)); }
    catch (e: any) { setSaveError(e.message); }
  }

  // ---------- reactions ----------
  const startReaction = () => {
    setSymptoms(""); setSeverity(4); setOccurredAt(localNow()); setDuration(""); setMealName(""); setReactionPhoto(undefined); setVoiceMsg("");
    go("reaction-form");
  };

  function onReactionPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (!file) return;
    const r = new FileReader(); r.onload = () => setReactionPhoto(String(r.result)); r.readAsDataURL(file);
  }

  async function saveReaction() {
    setSaveError("");
    try {
      const reaction: Reaction = await jsonFetch("/api/reactions", {
        method: "POST",
        body: JSON.stringify({ symptoms, severity, duration, mealName, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined }),
      });
      setReactions(r => [reaction, ...r]);
      if (reactionPhoto) setReactionImages(m => ({ ...m, [reaction.id]: reactionPhoto }));
      setSaved(true);
    } catch (e: any) { setSaveError(e.message); }
  }

  async function deleteReaction(id: number) {
    try { await jsonFetch(`/api/reactions?id=${id}`, { method: "DELETE" }); setReactions(r => r.filter(x => x.id !== id)); }
    catch (e: any) { setSaveError(e.message); }
  }

  // ---------- voice (browser speech recognition) ----------
  function startVoice(target: Screen = "reaction-form") {
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { setVoiceMsg("Voice typing isn’t available in this browser. You can still type below."); go(target); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = true; rec.lang = "en-US";
    rec.onresult = (e: any) => {
      setSymptoms(Array.from(e.results).map((r: any) => r[0]?.transcript ?? "").join(" ").trim());
      setVoiceMsg("Got it. You can edit what I heard below.");
    };
    rec.onerror = () => setVoiceMsg("I couldn’t hear that clearly. You can try again or type instead.");
    rec.onend = () => setListening(false);
    recognizer.current = rec;
    setVoiceMsg("Listening… describe what you’re feeling.");
    setListening(true);
    go(target);
    rec.start();
  }
  const toggleVoice = () => { if (listening) { recognizer.current?.stop(); setListening(false); } else startVoice(screen === "gee-voice" ? "gee-voice" : "reaction-form"); };
  const stopVoice = () => { recognizer.current?.stop(); setListening(false); };

  const voiceNotes = useMemo(() => {
    const t = symptoms.trim();
    const timing = t.match(/\b(after|before|about|around|minutes?|hours?|today|tonight|morning|evening)\b[^.!?]*/i)?.[0];
    const intensity = t.match(/\b(mild|moderate|severe|intense|bad|painful)\b/i)?.[0];
    const food = t.match(/\b(?:ate|eating|had)\s+([^,.!?]+)/i)?.[1];
    return [
      { label: "Symptoms", value: t ? t.split(/[.!?]/)[0] : "Listening for what you’re feeling…" },
      { label: "Timing", value: timing || "Not mentioned yet" },
      { label: "Intensity", value: intensity || "Not mentioned yet" },
      { label: "Food context", value: food || "Not mentioned yet" },
    ];
  }, [symptoms]);

  // ---------- profile & patterns ----------
  async function saveProfile(nextAllergens = allergens) {
    setProfileState("saving"); setProfileMsg("");
    try {
      const out = await jsonFetch("/api/profile", { method: "PUT", body: JSON.stringify({ allergens: nextAllergens, contact_name: contact.name, contact_phone: contact.phone }) });
      setAllergens(out.allergens ?? nextAllergens);
      setProfileState("saved");
    } catch (e: any) { setProfileState("error"); setProfileMsg(e.message); }
  }
  const addAllergen = () => {
    const items = newAllergen.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!items.length) return;
    const next = [...new Set([...allergens, ...items])];
    setNewAllergen(""); setAllergens(next); saveProfile(next);
  };
  const removeAllergen = (a: string) => { const next = allergens.filter(x => x !== a); setAllergens(next); saveProfile(next); };

  // Allergens that appeared in meals logged right before a reaction.
  const patterns = useMemo(() => {
    const byName = new Map(meals.map(m => [m.name, m.flags]));
    const counts = new Map<string, number>();
    for (const r of reactions) for (const f of byName.get(r.food) ?? []) counts.set(f, (counts.get(f) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [meals, reactions]);

  const linkedMealFlags = meals.find(m => m.name === mealName)?.flags ?? [];
  const lastTrigger = reactions[0]?.food && reactions[0].food !== "No related meal added" ? reactions[0].food : allergens[0];

  const openGuide = () => {
    unlockEmergencyAudio(); // must run inside the click so the browser allows audio
    setEmergencyOpen(false);
    go("emergency-guide");
  };

  // ---------- render ----------
  return (
    <div className="site-shell">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <main className="app-frame">
        {screen === "home" && (
          <div className="screen home-screen">
            <header className="home-topbar">
              <div className="brand"><Buddy small /><span>AllerGeez</span></div>
              <button className="avatar" aria-label="Open profile" onClick={() => go("allergens")}>ME</button>
            </header>
            <section className="welcome">
              <div className="welcome__copy">
                <p className="eyebrow welcome__eyebrow">Your food &amp; reaction buddy</p>
                <h1 className="welcome__title">Hey there, how can I help today?</h1>
              </div>
              <Buddy />
            </section>
            <section className="action-grid" aria-label="Main actions">
              <button className="action-card action-card--primary" style={{ height: 80 }} onClick={() => go("record")}>
                <span className="action-card__icon"><Icon name="plus" size={27} strokeWidth={2.2} /></span>
                <span><strong>Record meal</strong><small>Log what you ate</small></span>
                <Icon name="arrow" />
              </button>
              <button className="action-card" style={{ height: 80 }} onClick={startReaction}>
                <span className="action-card__icon action-card__icon--cream"><Icon name="spark" size={25} /></span>
                <span><strong>Record reaction</strong><small>Tell me what happened</small></span>
                <Icon name="arrow" />
              </button>
            </section>
            <button className="emergency-button emergency-button--home" style={{ height: 80 }} onClick={openEmergency}>
              <span><Icon name="alert" size={21} /> Emergency help</span>
              <small>For trouble breathing or severe symptoms</small>
            </button>
            {saveError && <p className="save-error">{saveError}</p>}
            <nav className="bottom-nav" aria-label="App navigation">
              <button className="is-active" onClick={() => go("home")}><Icon name="home" /><span>Home</span></button>
              <button onClick={() => go("history")}><Icon name="history" /><span>Meal history</span></button>
              <button onClick={() => go("reaction-history")}><Icon name="spark" /><span>Reaction history</span></button>
              <button onClick={() => go("allergens")}><Icon name="shield" /><span>Allergens</span></button>
            </nav>
          </div>
        )}

        {screen === "record" && (
          <div className="screen">
            <AppHeader title="Record meal" onBack={() => go("home")} onEmergency={openEmergency} />
            <section className="page-intro">
              <p className="eyebrow">Food log</p>
              <h2>What did you eat?</h2>
              <p>No need to remember every detail. Start with whatever feels easiest.</p>
            </section>
            <div className="record-options">
              <button onClick={() => libraryInput.current?.click()}>
                <span className="option-icon option-icon--rose"><Icon name="image" size={27} /></span>
                <span><strong>Choose a photo</strong><small>Pick one from your library</small></span>
                <Icon name="chevron" size={20} />
              </button>
              <button onClick={() => cameraInput.current?.click()}>
                <span className="option-icon option-icon--peach"><Icon name="camera" size={27} /></span>
                <span><strong>Take a photo</strong><small>Snap your meal or a label now</small></span>
                <Icon name="chevron" size={20} />
              </button>
              <button onClick={() => go("describe")}>
                <span className="option-icon option-icon--sage"><Icon name="pen" size={27} /></span>
                <span><strong>Type it in</strong><small>Describe your food in your own words</small></span>
                <Icon name="chevron" size={20} />
              </button>
            </div>
            <input ref={libraryInput} hidden type="file" accept="image/*" onChange={onMealPhoto} />
            <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={onMealPhoto} />
            <button className="history-link" onClick={() => go("history")}>
              <span><Icon name="history" size={20} /> View food history</span>
              <Icon name="arrow" size={20} />
            </button>
            <div className="privacy-note">
              <Icon name="shield" size={19} />
              <span>Your food notes stay private and are only used to help spot your patterns.</span>
            </div>
          </div>
        )}

        {screen === "describe" && (
          <div className="screen">
            <AppHeader title="Describe your food" onBack={() => go("record")} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact">
              <p className="eyebrow">Use your own words</p>
              <h2>Tell me what was on your plate</h2>
              <p>Ingredients, sauces, brand names—anything you remember can help.</p>
            </section>
            <div className="text-card">
              <label htmlFor="food-description">What did you have?</label>
              <textarea id="food-description" value={desc} onChange={e => setDesc(e.target.value)} autoFocus
                placeholder="For example: I had a chicken wrap with hummus, lettuce, pickles and a creamy sauce..." />
              <span className="text-card__hint">{desc.length} characters</span>
            </div>
            <div className="prompt-card">
              <Buddy small />
              <p><strong>Not sure what to include?</strong><br />Think about toppings, drinks, snacks, and sauces too.</p>
            </div>
            <button className="primary-button" disabled={!desc.trim()} onClick={reviewDescription}>
              Review with my AI buddy <Icon name="arrow" size={20} />
            </button>
          </div>
        )}

        {screen === "review" && (
          <div className="screen">
            <AppHeader title="Quick review" onBack={() => go(photo ? "record" : "describe")} onEmergency={openEmergency} />
            {saved ? (
              <section className="success-state">
                <div className="success-state__mark"><Icon name="check" size={35} strokeWidth={2.4} /></div>
                <p className="eyebrow">All saved</p>
                <h2>Nice job checking in.</h2>
                <p>That’s one more clue to help us understand what makes you feel your best.</p>
                <Buddy />
                <button className="primary-button" onClick={resetMeal}>Back to home</button>
                <button className="text-button" onClick={() => go("history")}>View food history</button>
              </section>
            ) : (
              <>
                <section className="page-intro page-intro--compact">
                  <p className="eyebrow">You’re almost done</p>
                  <h2>{scan.loading ? "Gee is taking a look…" : "Here’s what I picked up"}</h2>
                  <p>You can make changes before adding this to your food history.</p>
                </section>
                {photo && <img className="meal-preview" src={photo} alt="The meal you selected" />}
                {mealFlags.mine.length > 0 && (
                  <div className="severity-alert allergen-warning" role="alert">
                    <Icon name="alert" size={20} />
                    <p><strong>Heads up:</strong> this may contain {mealFlags.mine.join(", ")}, which {mealFlags.mine.length > 1 ? "are" : "is"} on your allergen list.</p>
                  </div>
                )}
                <div className="ai-card">
                  <div className="ai-card__heading">
                    <span><Icon name="spark" size={19} /></span>
                    <strong>AI food notes</strong>
                    <small>{scan.loading ? "Reading…" : "Preview"}</small>
                  </div>
                  <textarea aria-label="Food notes" value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder={photo ? "I can see your photo. Add any details you remember, like sauces or ingredients." : ""} />
                  <div className="possible-tags">
                    {scan.loading && <span className="tag-loading">Checking ingredients…</span>}
                    {mealFlags.mine.map(a => <span key={a} className="tag-alert">Your allergen: {a}</span>)}
                    {mealFlags.common.map(a => <span key={a}>Possible: {a}</span>)}
                    {scan.result && !mealFlags.mine.length && !mealFlags.common.length && <span>No common allergens spotted</span>}
                    {scan.result && !allergens.length && <span>Add your allergens for alerts</span>}
                  </div>
                  {scan.result?.note && <p className="ai-card__note">{scan.result.note}</p>}
                  {scan.error && (
                    <p className="save-error">{scan.error} <button className="inline-link" onClick={() => runScan(lastScanInput.current)}>Try again</button></p>
                  )}
                </div>
                <p className="disclaimer">These are clues, not a diagnosis. A healthcare professional can help confirm allergies.</p>
                {saveError && <p className="save-error">{saveError}</p>}
                <button className="primary-button" onClick={saveMeal} disabled={scan.loading && !desc.trim()}>
                  <Icon name="check" size={20} /> Save to food history
                </button>
              </>
            )}
          </div>
        )}

        {screen === "history" && (
          <div className="screen">
            <AppHeader title="Food history" onBack={() => go("home")} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact history-heading">
              <div><p className="eyebrow">Your recent meals</p><h2>Little clues add up</h2></div>
              <button className="circle-add" onClick={() => go("record")} aria-label="Record new food"><Icon name="plus" /></button>
            </section>
            {saveError && <p className="save-error">{saveError}</p>}
            <div className="timeline">
              {meals.map((m, i) => (
                <article className="log-entry" key={m.id}>
                  <div className="timeline__rail"><span>{dayLabel(m.createdAt, meals[i - 1]?.createdAt)}</span><i /></div>
                  <div className="log-card">
                    {mealImages[m.id]
                      ? <img src={mealImages[m.id]} alt="" />
                      : <div className={`food-thumb food-thumb--${i % 2}`}><Icon name={m.flags.some(f => allergens.includes(f)) ? "alert" : i % 2 ? "spark" : "check"} /></div>}
                    <div className="log-card__copy">
                      <strong>{m.name}</strong>
                      <p>{m.details}</p>
                      <small><Icon name="clock" size={14} /> {timeAgo(m.createdAt)}{m.flags.length > 0 && ` · ${m.flags.slice(0, 3).join(", ")}`}</small>
                    </div>
                    <button onClick={() => deleteMeal(m.id)} aria-label={`Delete ${m.name}`}><Icon name="trash" size={18} /></button>
                  </div>
                </article>
              ))}
            </div>
            {meals.length === 0 && (
              <div className="empty-state"><Buddy /><h3>Your log is ready</h3><p>Add a meal whenever you feel ready.</p></div>
            )}
          </div>
        )}

        {screen === "allergens" && (
          <div className="screen">
            <AppHeader title="Allergens" onBack={() => go("home")} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact">
              <p className="eyebrow">Your allergy profile</p>
              <h2>Allergen clues</h2>
              <p>Tell Gee what you’re allergic to so meals and labels get checked for you. Possible patterns from your logs appear below.</p>
            </section>

            <section className="profile-card" aria-label="My allergens">
              <strong>My allergens</strong>
              <div className="allergen-chips">
                {allergens.length === 0 && <small>None added yet</small>}
                {allergens.map(a => (
                  <span key={a}>{a}<button onClick={() => removeAllergen(a)} aria-label={`Remove ${a}`}><Icon name="close" size={13} strokeWidth={2.2} /></button></span>
                ))}
              </div>
              <form className="inline-add" onSubmit={e => { e.preventDefault(); addAllergen(); }}>
                <input value={newAllergen} onChange={e => setNewAllergen(e.target.value)} placeholder="Add an allergen, e.g. peanuts" aria-label="Add an allergen" />
                <button type="submit" disabled={!newAllergen.trim()} aria-label="Add allergen"><Icon name="plus" size={18} strokeWidth={2.2} /></button>
              </form>

              <strong className="profile-card__sub">Emergency contact</strong>
              <form onSubmit={e => { e.preventDefault(); saveProfile(); }}>
                <div className="reaction-field-grid">
                  <label className="reaction-field"><span>Name</span>
                    <input value={contact.name} onChange={e => { setContact({ ...contact, name: e.target.value }); setProfileState("idle"); }} placeholder="Mom" />
                  </label>
                  <label className="reaction-field"><span>Phone</span>
                    <input type="tel" value={contact.phone} onChange={e => { setContact({ ...contact, phone: e.target.value }); setProfileState("idle"); }} placeholder="555-123-4567" />
                  </label>
                </div>
                <div className="profile-card__actions">
                  <button type="submit" className="secondary-button" disabled={profileState === "saving"}>
                    {profileState === "saving" ? "Saving…" : "Save contact"}
                  </button>
                  <span role="status" className={profileState === "error" ? "is-error" : ""}>
                    {profileState === "saved" ? "✓ Saved" : profileState === "error" ? profileMsg : ""}
                  </span>
                </div>
              </form>
            </section>

            <div className="allergen-list">
              {patterns.length === 0 ? (
                <article>
                  <span className="option-icon option-icon--rose"><Icon name="spark" size={24} /></span>
                  <div><strong>No strong patterns yet</strong><p>Keep logging meals and reactions so your clues can become more useful.</p></div>
                </article>
              ) : patterns.map(([a, n]) => (
                <article key={a}>
                  <span className="option-icon option-icon--rose"><Icon name={allergens.includes(a) ? "alert" : "spark"} size={24} /></span>
                  <div><strong>Possible: {a}</strong><p>Showed up in meals before {n} reaction{n > 1 ? "s" : ""}.{allergens.includes(a) ? " Already on your list." : ""}</p></div>
                </article>
              ))}
            </div>
            <div className="privacy-note allergen-note">
              <Icon name="shield" size={19} />
              <span>AllerGeez helps you notice patterns, but it cannot diagnose an allergy. Always confirm concerns with a qualified healthcare professional.</span>
            </div>
            <button className="primary-button" onClick={() => go("record")}>Record a meal <Icon name="arrow" size={20} /></button>
          </div>
        )}

        {screen === "gee-voice" && (
          <div className="screen gee-voice-screen">
            <AppHeader title="Talk to Gee" onBack={() => { stopVoice(); go("reaction-form"); }} onEmergency={openEmergency} />
            <section className="gee-voice-hero">
              <button className={`gee-voice-orb ${listening ? "is-listening" : ""}`} onClick={toggleVoice} aria-label={listening ? "Stop voice input" : "Start voice input"}>
                <Buddy />
                <span className="gee-microphone"><Icon name="microphone" size={25} strokeWidth={2.1} /></span>
              </button>
              <p className="eyebrow">{listening ? "Gee is listening" : "Gee is here"}</p>
              <h2>{listening ? "Tell me what you’re feeling." : "Want to keep talking?"}</h2>
              <p className="gee-voice-hero__hint">{listening ? "Speak naturally. You can pause whenever you need." : "Tap Gee to start, or edit your words below."}</p>
              <span className={`voice-wave ${listening ? "is-active" : ""}`} aria-hidden="true"><i /><i /><i /><i /><i /></span>
            </section>
            <section className="voice-insights" aria-live="polite">
              <div className="voice-insights__heading">
                <span><Icon name="spark" size={17} /> AI notes from what you said</span>
                <small>Live preview</small>
              </div>
              <ul>
                {voiceNotes.map(n => (
                  <li key={n.label}><i><Icon name="check" size={13} /></i><p><strong>{n.label}</strong><span>{n.value}</span></p></li>
                ))}
              </ul>
            </section>
            <label className="voice-transcript">
              <span>What Gee heard</span>
              <textarea value={symptoms} onChange={e => setSymptoms(e.target.value)} placeholder="Your words will appear here as you speak..." />
            </label>
            {voiceMsg && <p className="gee-voice-message">{voiceMsg}</p>}
            <button className="primary-button" disabled={!symptoms.trim()} onClick={() => { stopVoice(); go("reaction-form"); }}>
              Continue with these details <Icon name="arrow" size={20} />
            </button>
            <button className="text-button" onClick={toggleVoice}>{listening ? "Stop listening" : "Try voice again"}</button>
          </div>
        )}

        {screen === "reaction-form" && (
          <div className="screen">
            <AppHeader title="Reaction details" onBack={() => go("home")} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact reaction-form-intro">
              <div>
                <p className="eyebrow">Take your time</p>
                <h2>What are you feeling?</h2>
                <p>Share what you notice. You don’t need to use medical words.</p>
              </div>
              <button className="talk-to-gee" onClick={() => startVoice("gee-voice")} aria-label="Open voice input with Gee">
                <Buddy small /><span>Talk to Gee</span>
              </button>
            </section>
            {voiceMsg && (
              <div className={`voice-status ${listening ? "is-listening" : ""}`}>
                <span className="voice-status__pulse"><Icon name="microphone" size={18} /></span>
                <p>{voiceMsg}</p>
                <button onClick={toggleVoice}>{listening ? "Stop" : "Try again"}</button>
              </div>
            )}
            <div className="reaction-form">
              <label className="reaction-field reaction-field--full">
                <span>Describe your symptoms</span>
                <textarea value={symptoms} onChange={e => setSymptoms(e.target.value)} placeholder="For example: My lips feel tingly and I have itchy red spots on my arms..." />
              </label>
              <div className="symptom-suggestions" aria-label="Common symptom suggestions">
                {SYMPTOMS.map(s => (
                  <button type="button" key={s} onClick={() => setSymptoms(cur => cur.toLowerCase().includes(s.toLowerCase()) ? cur : [cur.trim(), s].filter(Boolean).join(", "))}>+ {s}</button>
                ))}
              </div>
              <fieldset className="severity-field">
                <legend>How intense is it? <strong>{severity}/10</strong></legend>
                <input type="range" min="1" max="10" value={severity} onChange={e => setSeverity(Number(e.target.value))}
                  style={{ "--severity": `${(severity - 1) * 11.11}%` } as React.CSSProperties} />
                <div><span>Mild</span><span>Moderate</span><span>Severe</span></div>
              </fieldset>
              {severity >= 8 && (
                <div className="severity-alert">
                  <Icon name="alert" size={20} />
                  <p>A severe reaction can become an emergency. If you have trouble breathing, throat tightness, faintness, or rapidly worsening symptoms, get emergency help now.</p>
                  <button onClick={openEmergency}>Get help</button>
                </div>
              )}
              <div className="reaction-field-grid">
                <label className="reaction-field"><span>When did it start?</span>
                  <input type="datetime-local" value={occurredAt} onChange={e => setOccurredAt(e.target.value)} />
                </label>
                <label className="reaction-field"><span>How long did it last?</span>
                  <select value={duration} onChange={e => setDuration(e.target.value)}>
                    <option value="">Choose</option>
                    {DURATIONS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </label>
              </div>
              <label className="reaction-field reaction-field--full">
                <span>What did you eat beforehand? <small>Optional</small></span>
                <select value={mealName} onChange={e => setMealName(e.target.value)}>
                  <option value="">Select a meal</option>
                  {meals.map(m => <option key={m.id} value={m.name}>{m.name} · {timeAgo(m.createdAt)}</option>)}
                </select>
              </label>
              <div className="reaction-photo-field">
                {reactionPhoto ? (
                  <div className="reaction-photo-preview">
                    <img src={reactionPhoto} alt="Visible reaction selected for this entry" />
                    <button onClick={() => setReactionPhoto(undefined)} aria-label="Remove photo"><Icon name="close" size={18} /></button>
                  </div>
                ) : (
                  <button onClick={() => reactionInput.current?.click()}><Icon name="image" size={21} /> Add a symptom photo</button>
                )}
                <input ref={reactionInput} hidden type="file" accept="image/*" onChange={onReactionPhoto} />
              </div>
            </div>
            <button className="primary-button reaction-continue" disabled={!symptoms.trim()} onClick={() => go("reaction-review")}>
              Review my check-in <Icon name="arrow" size={20} />
            </button>
          </div>
        )}

        {screen === "reaction-review" && (
          <div className="screen">
            <AppHeader title="Review reaction" onBack={() => go("reaction-form")} onEmergency={openEmergency} />
            {saved ? (
              <section className="success-state">
                <div className="success-state__mark"><Icon name="check" size={35} strokeWidth={2.4} /></div>
                <p className="eyebrow">Reaction saved</p>
                <h2>You captured something important.</h2>
                <p>Your details are safely in your history and ready to help reveal patterns.</p>
                <Buddy />
                <button className="primary-button" onClick={() => go("reaction-history")}>View reaction history</button>
                <button className="text-button" onClick={() => go("home")}>Back to home</button>
              </section>
            ) : (
              <>
                <section className="page-intro page-intro--compact">
                  <p className="eyebrow">Your AI buddy’s summary</p>
                  <h2>Does this look right?</h2>
                  <p>Check the details before adding this reaction to your private history.</p>
                </section>
                <div className="reaction-summary-card">
                  <div className="reaction-summary-card__top">
                    {reactionPhoto ? <img src={reactionPhoto} alt="" /> : <span className="reaction-summary-card__icon"><Icon name="spark" size={24} /></span>}
                    <div><small>Symptoms</small><strong>{symptoms}</strong></div>
                    <b className={sevClass(severity)}>{severity}/10</b>
                  </div>
                  <dl>
                    <div><dt>Started</dt><dd>{occurredAt ? new Date(occurredAt).toLocaleString() : "Not added"}</dd></div>
                    <div><dt>Duration</dt><dd>{duration || "Not added"}</dd></div>
                    <div><dt>Food beforehand</dt><dd>{mealName || "Not added"}</dd></div>
                  </dl>
                </div>
                <div className="ai-clue-card">
                  <div><Icon name="spark" size={18} /><strong>Pattern check</strong><small>AI preview</small></div>
                  <p>{linkedMealFlags.length
                    ? `${mealName} may have contained ${linkedMealFlags.join(", ")}. This will be compared with your other check-ins to look for patterns.`
                    : "This reaction will be compared with your meal history. More check-ins are needed before meaningful ingredient patterns can appear."}</p>
                  <span>{linkedMealFlags.length ? `Clue to review: ${linkedMealFlags[0]}` : "Clue to review: timing after food"}</span>
                </div>
                <p className="disclaimer">AI-generated clues can be incomplete or wrong and are not a diagnosis. Confirm allergy concerns with a qualified healthcare professional.</p>
                {saveError && <p className="save-error">{saveError}</p>}
                <button className="primary-button" onClick={saveReaction}><Icon name="check" size={20} /> Save reaction</button>
              </>
            )}
          </div>
        )}

        {screen === "reaction-history" && (
          <div className="screen">
            <AppHeader title="Reaction history" onBack={() => go("home")} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact history-heading">
              <div><p className="eyebrow">Your check-ins</p><h2>Reaction history</h2></div>
              <button className="circle-add" onClick={startReaction} aria-label="Record a new reaction"><Icon name="plus" /></button>
            </section>
            {saveError && <p className="save-error">{saveError}</p>}
            {reactions.length > 0 ? (
              <div className="reaction-history-list">
                {reactions.map(r => {
                  const flags = meals.find(m => m.name === r.food)?.flags ?? [];
                  return (
                    <article className="reaction-log-card" key={r.id}>
                      <div className="reaction-log-card__top">
                        {reactionImages[r.id] ? <img src={reactionImages[r.id]} alt="" /> : <span className="reaction-summary-card__icon"><Icon name="spark" size={22} /></span>}
                        <div>
                          <small><Icon name="clock" size={13} />{new Date(r.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                          <strong>{r.symptoms}</strong>
                        </div>
                        {r.severity > 0 && <b className={sevClass(r.severity)}>{r.severity}/10</b>}
                      </div>
                      <details>
                        <summary>View details</summary>
                        <dl>
                          <div><dt>Duration</dt><dd>{r.duration}</dd></div>
                          <div><dt>Food beforehand</dt><dd>{r.food}</dd></div>
                          <div><dt>Potential allergens</dt><dd>{flags.length ? flags.join(", ") : "Not enough information yet"}</dd></div>
                        </dl>
                      </details>
                      <button className="reaction-delete" onClick={() => deleteReaction(r.id)} aria-label="Delete reaction entry"><Icon name="trash" size={17} /></button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state reaction-empty-state">
                <Buddy />
                <h3>No reactions recorded yet</h3>
                <p>That’s okay. Your reaction history will be ready when you need it.</p>
                <button className="primary-button" onClick={startReaction}>Record a reaction</button>
              </div>
            )}
            <div className="privacy-note allergen-note">
              <Icon name="shield" size={19} />
              <span>If symptoms are severe or getting worse quickly, use the emergency help button instead of recording them here.</span>
            </div>
          </div>
        )}

        {screen === "emergency-guide" && (
          <Emergency contact={contact} trigger={lastTrigger} onExit={() => go("home")} />
        )}

        {emergencyOpen && (
          <div className="modal-backdrop" role="presentation" onMouseDown={() => setEmergencyOpen(false)}>
            <section className="emergency-modal" role="dialog" aria-modal="true" aria-labelledby="emergency-title" onMouseDown={e => e.stopPropagation()}>
              <button className="modal-close" onClick={() => setEmergencyOpen(false)} aria-label="Close emergency help"><Icon name="close" /></button>
              <div className="emergency-modal__icon"><Icon name="alert" size={32} /></div>
              <p className="eyebrow">Emergency help</p>
              <h2 id="emergency-title">Are you having trouble breathing?</h2>
              <p>If symptoms are severe or getting worse quickly, use your prescribed epinephrine if available and call emergency services now.</p>
              <a className="call-button" href="tel:911"><Icon name="phone" /> Call 911</a>
              <button className="guide-button" onClick={openGuide}><Icon name="speaker" size={20} /> Talk me through it</button>
              <button className="secondary-button" onClick={() => setEmergencyOpen(false)}>My symptoms are not severe</button>
              <small>AllerGeez does not replace emergency or medical care.</small>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
