"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Ingredient, Meal, Profile, Reaction } from "@/lib/records";
import type { SessionUser } from "@/lib/auth/server";
import { AppHeader, Buddy, BuddyInBowl, Icon } from "./ui";
import ProfileScreen, { initialsOf } from "./ProfileScreen";
import IngredientModal from "./IngredientModal";
import Emergency, { unlockEmergencyAudio } from "./Emergency";
import CameraCapture from "./CameraCapture";
import type { FoodProduct, Nutrients } from "@/lib/nutrition";
import { allergenMatches, allergyGroup } from "@/lib/allergens";
import { attackTag, detectSymptoms, parseFood, parseIntensity, parseTiming } from "@/lib/symptoms";

type Screen =
  | "home" | "record" | "describe" | "review" | "history" | "allergens"
  | "gee-voice" | "reaction-form" | "reaction-review" | "reaction-history" | "emergency-guide"
  | "profile" | "test-food";

type NutritionEstimate = { portion?: string; kcal?: number; protein?: number; carbs?: number; fat?: number; sugars?: number; fiber?: number; sodiumMg?: number };
type ScanResult = {
  kind?: "packaged" | "label" | "menu" | "homemade" | "restaurant" | "not_food";
  name?: string; ingredients?: string[]; flags?: { ingredient: string; allergen: string; reason: string }[];
  product?: { brand?: string; name?: string } | null; barcode?: string;
  nutrition_estimate?: NutritionEstimate | null;
  common_allergens?: string[]; safe?: boolean; note?: string;
};

function EstimateCard({ est, title }: { est: NutritionEstimate; title: string }) {
  const rows: [keyof NutritionEstimate, string, string][] = [
    ["kcal", "Calories", ""], ["protein", "Protein", "g"], ["carbs", "Carbohydrates", "g"], ["sugars", "Sugars", "g"],
    ["fat", "Fat", "g"], ["fiber", "Fiber", "g"], ["sodiumMg", "Sodium", "mg"],
  ];
  const shown = rows.filter(([k]) => typeof est[k] === "number");
  if (!shown.length) return null;
  return (
    <div className="food-review-card">
      <div className="food-review-card__top">
        <span className="food-results__thumb"><Icon name="spark" size={18} /></span>
        <div><strong>{title}</strong><small>Gee’s estimate{est.portion ? ` · ${est.portion}` : ""}</small></div>
      </div>
      <div className="nutrition">
        <div className="nutrition__head"><strong>Estimated nutrition</strong><small>approximate</small></div>
        <dl>{shown.map(([k, label, unit]) => <div key={k}><dt>{label}</dt><dd>{Math.round(est[k] as number)}{unit && ` ${unit}`}</dd></div>)}</dl>
      </div>
    </div>
  );
}

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

const NUTRIENT_ROWS: [keyof Nutrients, string, string][] = [
  ["kcal", "Calories", ""], ["fat", "Fat", "g"], ["satFat", "Saturated fat", "g"], ["carbs", "Carbohydrates", "g"],
  ["sugars", "Sugars", "g"], ["fiber", "Fiber", "g"], ["protein", "Protein", "g"], ["sodiumMg", "Sodium", "mg"],
];

function NutritionFacts({ food, allergens }: { food: FoodProduct; allergens: string[] }) {
  const useServing = !!food.perServing?.kcal;
  const n = (useServing ? food.perServing : food.per100g) ?? {};
  const rows = NUTRIENT_ROWS.filter(([k]) => n[k] !== undefined);
  const mine = food.allergens.filter(a => allergens.some(p => allergenMatches(p, a)));
  return (
    <div className="nutrition">
      {rows.length > 0 ? (
        <>
          <div className="nutrition__head"><strong>Nutrition facts</strong><small>{useServing ? `per serving${food.servingSize ? ` (${food.servingSize})` : ""}` : "per 100 g"}</small></div>
          <dl>{rows.map(([k, label, unit]) => <div key={k}><dt>{label}</dt><dd>{n[k]}{unit && ` ${unit}`}</dd></div>)}</dl>
        </>
      ) : <p className="nutrition__none">No nutrition facts listed for this product.</p>}
      {(food.allergens.length > 0 || food.traces.length > 0) && (
        <div className="possible-tags">
          {food.allergens.map(a => <span key={a} className={mine.includes(a) ? "tag-alert" : ""}>{mine.includes(a) ? "Your allergen: " : "Contains: "}{a}</span>)}
          {food.traces.map(a => <span key={`t-${a}`}>May contain: {a}</span>)}
        </div>
      )}
      {food.allergens.length === 0 && <p className="nutrition__none">No allergens listed by the database. Gee will still check the ingredients.</p>}
    </div>
  );
}

export default function AllerGeezApp({ user, initialMeals, initialReactions, initialProfile, loadError }: {
  user: SessionUser | null; initialMeals: Meal[]; initialReactions: Reaction[]; initialProfile: Profile; loadError?: string;
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
  const [editingMeal, setEditingMeal] = useState<{ id: number; name: string; details: string } | null>(null);
  const [ingredientMealId, setIngredientMealId] = useState<number | null>(null);

  // profile
  const [allergens, setAllergens] = useState<string[]>(initialProfile.allergens);
  const [newAllergen, setNewAllergen] = useState("");
  const [contact, setContact] = useState({ name: initialProfile.contact_name, phone: initialProfile.contact_phone });
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileMsg, setProfileMsg] = useState("");

  // meal flow
  const [desc, setDesc] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [cameraFor, setCameraFor] = useState<"meal" | "reaction" | "test" | null>(null);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodSearch, setFoodSearch] = useState<{ loading: boolean; products?: FoodProduct[]; error?: string; query?: string }>({ loading: false });
  const [openFood, setOpenFood] = useState<string>();
  const [selectedFoods, setSelectedFoods] = useState<FoodProduct[]>([]);
  // Allergy groups the user added by hand on the review screen (the "+" chip)
  const [extraGroups, setExtraGroups] = useState<string[]>([]);
  const [groupDraft, setGroupDraft] = useState<string | null>(null);
  // Product matched from a photo (Gemini reads brand/barcode → Bright Data looks it up)
  const [photoMatch, setPhotoMatch] = useState<{ loading: boolean; products?: FoodProduct[]; exact?: boolean; label?: string; error?: string } | null>(null);
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
  // AI "attack tag" for the reaction being recorded
  const [reactionAI, setReactionAI] = useState<{ loading: boolean; tag?: string; symptoms?: string[]; timing?: string; intensity?: string; food?: string; source?: string; forText?: string } | null>(null);
  const [reactionTag, setReactionTag] = useState("");
  const analyzeSeq = useRef(0);
  const testInput = useRef<HTMLInputElement>(null);

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
      if (input.image && (result.kind === "packaged" || result.kind === "label") && (result.barcode || result.product?.name || result.product?.brand)) {
        matchProductFromPhoto(result, id);
      }
    } catch (e: any) {
      if (id === scanSeq.current) setScan({ loading: false, error: e?.message ?? "Gee couldn't read that" });
    }
  }
  const lastScanInput = useRef<Parameters<typeof runScan>[0]>({});

  async function matchProductFromPhoto(result: ScanResult, scanId: number) {
    const brand = result.product?.brand ?? "", name = result.product?.name ?? result.name ?? "";
    const label = [brand, name].filter(Boolean).join(" ") || result.barcode || "this product";
    setPhotoMatch({ loading: true, label });
    try {
      const params = new URLSearchParams({ barcode: result.barcode ?? "", brand, name });
      const r = await jsonFetch(`/api/nutrition?${params}`);
      if (scanId !== scanSeq.current) return;
      const products: FoodProduct[] = r.products ?? [];
      const exact = r.exact !== false && products.length > 0;
      setPhotoMatch({ loading: false, products, exact, label });
      // Only auto-pick when it's the same brand; otherwise the user chooses from suggestions
      if (exact) setSelectedFoods([products[0]]);
    } catch (e: any) {
      if (scanId === scanSeq.current) setPhotoMatch({ loading: false, products: [], label, error: e.message });
    }
  }

  async function onMealPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (file) handleMealFile(file);
  }

  async function handleMealFile(file: File, target: Screen = "review") {
    setCameraFor(null);
    setDesc(""); setSelectedFoods([]); setPhotoMatch(null); setExtraGroups([]); setGroupDraft(null); setScan({ loading: true }); go(target);
    const image = await prepareImage(file);
    setPhoto(`data:${image.mimeType};base64,${image.data}`);
    lastScanInput.current = { image };
    runScan({ image });
  }

  // Searches only on submit (not per keystroke) to save Bright Data requests; results are cached server-side.
  async function lookUpFood() {
    const q = foodQuery.trim();
    if (q.length < 2) return;
    setFoodSearch({ loading: true, query: q }); setOpenFood(undefined);
    try {
      const r = await jsonFetch(`/api/nutrition?q=${encodeURIComponent(q)}`);
      setFoodSearch({ loading: false, products: r.products, query: q });
      if (r.products?.length) setOpenFood(r.products[0].code + r.products[0].name);
    } catch (e: any) { setFoodSearch({ loading: false, error: e.message, query: q }); }
  }
  const foodKey = (f: FoodProduct) => f.code + f.name;
  const toggleFood = (f: FoodProduct) =>
    setSelectedFoods(list => list.some(x => foodKey(x) === foodKey(f)) ? list.filter(x => foodKey(x) !== foodKey(f)) : [...list, f]);

  const describeForAI = () => [
    desc.trim(),
    ...selectedFoods.map(f => `Packaged food: ${f.name}${f.brand ? ` (${f.brand})` : ""}.` +
      (f.ingredients ? ` Ingredients: ${f.ingredients}` : "") +
      (f.allergens.length ? ` Listed allergens: ${f.allergens.join(", ")}.` : "") +
      (f.traces.length ? ` May contain: ${f.traces.join(", ")}.` : "")),
  ].filter(Boolean).join("\n");

  function reviewDescription() {
    setPhoto(undefined); setPhotoMatch(null); setExtraGroups([]); setGroupDraft(null);
    const text = describeForAI();
    lastScanInput.current = { text };
    go("review");
    runScan({ text });
  }

  const mealFlags = useMemo(() => {
    const r = scan.result;
    const fromFoods = selectedFoods.flatMap(f => [...f.allergens, ...f.traces]).map(a => a.toLowerCase());
    const mine = [...new Set([
      ...(r?.flags ?? []).map(f => f.allergen.toLowerCase()),
      ...fromFoods.filter(a => allergens.some(p => allergenMatches(p, a))),
    ])];
    // Merge near-duplicates from Gemini vs the food database ("tree nut"/"tree nuts", "dairy"/"milk")
    const dedupe = (list: string[], against: string[] = []) => list.reduce<string[]>(
      (out, a) => (out.some(b => allergenMatches(a, b)) || against.some(b => allergenMatches(a, b)) ? out : [...out, a]), []);
    // Show allergy groups ("Dairy", "Tree nuts") rather than raw ingredient words
    const groups = (list: string[]) => [...new Set(list.map(allergyGroup))];
    const mineUnique = groups(dedupe(mine));
    const common = groups(dedupe([...(r?.common_allergens ?? []).map(a => a.toLowerCase()), ...fromFoods, ...extraGroups], mine))
      .filter(g => !mineUnique.includes(g) && !allergens.some(p => allergyGroup(p) === g));
    const mineAll = [...new Set([...mineUnique, ...extraGroups.map(allergyGroup).filter(g => allergens.some(p => allergyGroup(p) === g))])];
    return { mine: mineAll, common };
  }, [scan.result, selectedFoods, allergens, extraGroups]);
  const addGroup = () => {
    const g = (groupDraft ?? "").trim();
    if (g) setExtraGroups(list => (list.some(x => allergyGroup(x) === allergyGroup(g)) ? list : [...list, g]));
    setGroupDraft(null);
  };

  async function saveMeal() {
    setSaveError("");
    const foodNames = selectedFoods.map(f => f.brand && !f.name.toLowerCase().includes(f.brand.split(",")[0].toLowerCase()) ? `${f.brand.split(",")[0]} ${f.name}` : f.name);
    const details = [desc.trim(), ...foodNames].filter(Boolean).join(", ") || "Food photo";
    const fallback = details.split(/[,.\n]/)[0].trim();
    try {
      const meal: Meal = await jsonFetch("/api/meals", {
        method: "POST",
        body: JSON.stringify({
          name: scan.result?.name || (fallback.length > 34 ? "New meal" : fallback), details,
          flags: [...mealFlags.mine, ...mealFlags.common],
          ingredients: [...foodNames, ...(scan.result?.ingredients ?? [])].slice(0, 40).map(name => ({ name, flagged: false })),
        }),
      });
      setMeals(m => [meal, ...m]);
      if (photo) setMealImages(m => ({ ...m, [meal.id]: photo }));
      setSaved(true);
    } catch (e: any) { setSaveError(e.message); }
  }

  const resetMeal = () => {
    setDesc(""); setPhoto(undefined); setScan({ loading: false });
    setSelectedFoods([]); setFoodQuery(""); setFoodSearch({ loading: false }); setPhotoMatch(null); setExtraGroups([]); setGroupDraft(null);
    go("home");
  };

  async function deleteMeal(id: number) {
    try { await jsonFetch(`/api/meals?id=${id}`, { method: "DELETE" }); setMeals(m => m.filter(x => x.id !== id)); }
    catch (e: any) { setSaveError(e.message); }
  }

  /** Save a name/details edit or a new ingredient list; returns an error message or null. */
  async function updateMeal(id: number, patch: { name?: string; details?: string; ingredients?: Ingredient[] }) {
    try {
      const meal: Meal = await jsonFetch("/api/meals", { method: "PATCH", body: JSON.stringify({ id, ...patch }) });
      setMeals(list => list.map(m => (m.id === id ? meal : m)));
      return null;
    } catch (e: any) { return e.message as string; }
  }

  // ---------- test a food (check without logging) ----------
  const resetTest = () => {
    scanSeq.current++;
    setDesc(""); setPhoto(undefined); setScan({ loading: false }); setSaved(false); setSaveError("");
    setSelectedFoods([]); setFoodQuery(""); setFoodSearch({ loading: false }); setPhotoMatch(null); setOpenFood(undefined);
  };
  const productText = (f: FoodProduct) => `Packaged food: ${f.name}${f.brand ? ` (${f.brand})` : ""}.` +
    (f.ingredients ? ` Ingredients: ${f.ingredients}` : "") + (f.allergens.length ? ` Listed allergens: ${f.allergens.join(", ")}.` : "") +
    (f.traces.length ? ` May contain: ${f.traces.join(", ")}.` : "");
  function testProduct(f: FoodProduct) {
    setPhoto(undefined); setPhotoMatch(null); setDesc(""); setSaved(false);
    setSelectedFoods([f]); setFoodSearch({ loading: false }); setOpenFood(undefined);
    lastScanInput.current = { text: productText(f) };
    runScan({ text: productText(f) });
  }
  const testHasResult = !!(photo || selectedFoods.length || scan.loading || scan.result || scan.error);

  // ---------- reactions ----------
  const startReaction = () => {
    setSymptoms(""); setSeverity(4); setOccurredAt(localNow()); setDuration(""); setMealName(""); setReactionPhoto(undefined); setVoiceMsg("");
    setReactionAI(null); setReactionTag("");
    go("reaction-form");
  };

  function onReactionPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = "";
    if (file) loadReactionPhoto(file);
  }
  function loadReactionPhoto(file: File) {
    setCameraFor(null);
    const r = new FileReader(); r.onload = () => setReactionPhoto(String(r.result)); r.readAsDataURL(file);
  }

  async function analyzeSymptoms(text: string) {
    const t = text.trim();
    if (!t) return;
    const id = ++analyzeSeq.current;
    // Show the instant keyword guess while Gemini works
    const quick = detectSymptoms(t);
    setReactionAI({ loading: true, tag: attackTag(quick, t), symptoms: quick });
    setReactionTag(attackTag(quick, t));
    try {
      const out = await jsonFetch("/api/reactions/analyze", { method: "POST", body: JSON.stringify({ text: t }) });
      if (id !== analyzeSeq.current) return;
      setReactionAI({ loading: false, tag: out.tag, symptoms: out.symptoms, timing: out.timing, intensity: out.intensity, food: out.food, source: out.source, forText: t });
      setReactionTag(out.tag);
    } catch {
      if (id === analyzeSeq.current) setReactionAI(a => ({ ...(a ?? {}), loading: false }));
    }
  }

  async function saveReaction() {
    setSaveError("");
    try {
      const food = mealName;
      const reaction: Reaction = await jsonFetch("/api/reactions", {
        method: "POST",
        body: JSON.stringify({
          symptoms, severity, duration, mealName: food, occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          title: reactionTag.trim() || attackTag(detectSymptoms(symptoms), symptoms),
          symptomTags: reactionAI?.symptoms ?? detectSymptoms(symptoms),
        }),
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
    // Use the AI read when it's for (roughly) the current transcript; fill gaps with local parsing
    const ai = reactionAI?.forText && t.startsWith(reactionAI.forText.slice(0, Math.max(0, reactionAI.forText.length - 12))) ? reactionAI : null;
    const syms = ai?.symptoms?.length ? ai.symptoms : detectSymptoms(t);
    return [
      { label: "Symptoms", value: !t ? "Listening for what you’re feeling…" : syms.length ? syms.join(", ") : "Not clear yet. Try naming what you feel" },
      { label: "Timing", value: ai?.timing || parseTiming(t) || "Not mentioned yet" },
      { label: "Intensity", value: ai?.intensity || parseIntensity(t) || "Not mentioned yet" },
      { label: "Food context", value: ai?.food || parseFood(t) || "Not mentioned yet" },
    ];
  }, [symptoms, reactionAI]);

  // On the Talk to Gee screen, have AI read the transcript as it grows (after a short pause) and when talking stops
  useEffect(() => {
    if (screen !== "gee-voice" || !symptoms.trim() || symptoms.trim() === reactionAI?.forText) return;
    const t = setTimeout(() => analyzeSymptoms(symptoms), listening ? 1500 : 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symptoms, listening, screen]);

  // Meals logged on the same day as the reaction
  const mealsThatDay = useMemo(() => {
    const day = occurredAt ? new Date(occurredAt).toDateString() : new Date().toDateString();
    return meals.filter(m => new Date(m.createdAt).toDateString() === day);
  }, [meals, occurredAt]);
  useEffect(() => {
    if (mealName && !mealsThatDay.some(m => m.name === mealName)) setMealName("");
  }, [mealsThatDay, mealName]);

  // ---------- profile & patterns ----------
  async function saveProfile(nextAllergens = allergens) {
    setProfileState("saving"); setProfileMsg("");
    try {
      const out = await jsonFetch("/api/profile", { method: "PUT", body: JSON.stringify({ allergens: nextAllergens, contact_name: contact.name, contact_phone: contact.phone }) });
      setAllergens(out.allergens ?? nextAllergens);
      setProfileState("saved");
    } catch (e: any) { setProfileState("error"); setProfileMsg(e.message); }
  }
  // Each typed allergen is checked first: known list, then AI (fixes typos, rejects non-foods)
  const [allergenCheck, setAllergenCheck] = useState<{ busy: boolean; problems: { name: string; reason: string; suggestion?: string; unsure?: boolean }[] }>({ busy: false, problems: [] });
  const commitAllergens = (names: string[]) => {
    if (!names.length) return;
    const next = [...new Set([...allergens, ...names.map(n => n.toLowerCase())])];
    setAllergens(next); saveProfile(next);
  };
  async function addAllergen(text = newAllergen) {
    const items = [...new Set(text.split(",").map(s => s.trim()).filter(Boolean))];
    if (!items.length) return;
    setAllergenCheck({ busy: true, problems: [] });
    const results: any[] = [];
    for (const text of items) { // one at a time, so several entries don't trip Gemini's per-minute limit
      results.push(await jsonFetch("/api/allergens/check", { method: "POST", body: JSON.stringify({ text }) })
        .catch(() => ({ valid: false, unsure: true, name: text, reason: `Couldn’t check “${text}” right now.` })));
    }
    commitAllergens(results.filter(r => r.valid).map(r => r.name));
    const problems = results.filter(r => !r.valid).map(r => ({ name: r.name, reason: r.reason, suggestion: r.suggestion || undefined, unsure: !!r.unsure }));
    setAllergenCheck({ busy: false, problems });
    setNewAllergen(problems.map(p => p.name).join(", "));
  }
  const resolveProblem = (name: string, add?: string) => {
    if (add) commitAllergens([add]);
    setAllergenCheck(c => ({ ...c, problems: c.problems.filter(p => p.name !== name) }));
    setNewAllergen(v => v.split(",").map(x => x.trim()).filter(x => x && x !== name).join(", "));
  };
  const removeAllergen = (a: string) => { const next = allergens.filter(x => x !== a); setAllergens(next); saveProfile(next); };
  async function saveContact(c: { name: string; phone: string }) {
    await jsonFetch("/api/profile", { method: "PUT", body: JSON.stringify({ allergens, contact_name: c.name, contact_phone: c.phone }) });
    setContact(c);
  }

  // Ingredients you flagged as suspected triggers, across all meals
  const flaggedIngredients = useMemo(() => {
    const counts = new Map<string, { name: string; meals: number }>();
    for (const m of meals) for (const i of m.ingredients) if (i.flagged) {
      const k = i.name.toLowerCase();
      counts.set(k, { name: i.name, meals: (counts.get(k)?.meals ?? 0) + 1 });
    }
    return [...counts.values()].sort((a, b) => b.meals - a.meals);
  }, [meals]);
  const ingredientMeal = meals.find(m => m.id === ingredientMealId);

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
              <div className="brand"><Buddy small /><span>allergeez</span></div>
              <button className="avatar" aria-label={user ? "Open your profile" : "Sign in or open profile"} onClick={() => go("profile")}>
                {user?.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" /> : user ? initialsOf(user) : <Icon name="user" size={20} />}
              </button>
            </header>
            <section className="welcome">
              <div className="welcome__copy">
                <p className="eyebrow welcome__eyebrow">Your food &amp; reaction buddy</p>
                <h1 className="welcome__title">
                  <span>{user?.name ? `Hi ${user.name.split(" ")[0]}, I’m Gee!` : "Hi, I’m Gee!"}</span>
                  <span className="welcome__subtitle">Let’s keep those allergies away</span>
                </h1>
              </div>
              <Buddy />
            </section>
            <button className="emergency-button emergency-button--home" style={{ height: 80 }} onClick={openEmergency}>
              <span className="emergency-button__icon"><Icon name="alert" size={24} /></span>
              <span className="emergency-button__copy"><strong>Emergency help</strong><small>For severe symptoms</small></span>
              <Icon name="arrow" />
            </button>
            <section className="action-grid" aria-label="Main actions">
              <button className="action-card" style={{ height: 80 }} onClick={() => go("record")}>
                <span className="action-card__icon action-card__icon--rose"><Icon name="food" size={25} strokeWidth={2} /></span>
                <span><strong>Record meal</strong><small>Log what you ate</small></span>
                <Icon name="arrow" />
              </button>
              <button className="action-card" style={{ height: 80 }} onClick={startReaction}>
                <span className="action-card__icon action-card__icon--cream"><Icon name="medical" size={24} /></span>
                <span><strong>Record reaction</strong><small>Tell me what happened</small></span>
                <Icon name="arrow" />
              </button>
            </section>
            <button className="action-card action-card--test-food" style={{ height: 76, marginTop: 12, width: "100%" }} onClick={() => { resetTest(); go("test-food"); }}>
              <span className="action-card__icon action-card__icon--peach"><Icon name="flask" size={25} /></span>
              <span><strong>Test a food!</strong><small>Check ingredients &amp; allergy risk</small></span>
              <Icon name="arrow" />
            </button>
            {saveError && <p className="save-error">{saveError}</p>}
            <nav className="bottom-nav" aria-label="App navigation">
              <button className="is-active" onClick={() => go("home")}><Icon name="home" /><span>Home</span></button>
              <button onClick={() => go("history")}><Icon name="history" /><span>Meal history</span></button>
              <button onClick={() => go("reaction-history")}><Icon name="medical" /><span>Reaction history</span></button>
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
              <button onClick={() => setCameraFor("meal")}>
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

            <section className="food-lookup" aria-label="Look up a packaged food">
              <div className="food-lookup__head">
                <strong>Had something packaged?</strong>
                <small>Look up a brand to get its nutrition facts and listed allergens.</small>
              </div>
              <form className="inline-add" onSubmit={e => { e.preventDefault(); lookUpFood(); }}>
                <input value={foodQuery} onChange={e => setFoodQuery(e.target.value)} placeholder="Brand or product name" aria-label="Brand or product name" />
                <button type="submit" disabled={foodQuery.trim().length < 2 || foodSearch.loading} aria-label="Look up">
                  <Icon name="search" size={18} strokeWidth={2.2} />
                </button>
              </form>

              {selectedFoods.length > 0 && (
                <div className="allergen-chips food-lookup__added">
                  {selectedFoods.map(f => (
                    <span key={foodKey(f)}>{f.name}<button onClick={() => toggleFood(f)} aria-label={`Remove ${f.name}`}><Icon name="close" size={13} strokeWidth={2.2} /></button></span>
                  ))}
                </div>
              )}

              {foodSearch.loading && <p className="food-lookup__status">Searching the food database…</p>}
              {foodSearch.error && <p className="save-error">{foodSearch.error}</p>}
              {foodSearch.products && foodSearch.products.length === 0 && <p className="food-lookup__status">No products found for “{foodSearch.query}”. Try the brand plus product, like “Kind almond bar”.</p>}
              {foodSearch.products && foodSearch.products.length > 0 && (
                <ul className="food-results">
                  {foodSearch.products.map(f => {
                    const k = foodKey(f), open = openFood === k, added = selectedFoods.some(x => foodKey(x) === k);
                    const risky = f.allergens.some(a => allergens.some(p => allergenMatches(p, a)));
                    return (
                      <li key={k} className={open ? "is-open" : ""}>
                        <button className="food-results__row" onClick={() => setOpenFood(open ? undefined : k)} aria-expanded={open}>
                          {f.image ? <img src={f.image} alt="" /> : <span className="food-results__thumb"><Icon name="image" size={18} /></span>}
                          <span className="food-results__copy"><strong>{f.name}</strong><small>{[f.brand, f.per100g.kcal !== undefined && `${f.per100g.kcal} kcal/100 g`].filter(Boolean).join(" · ")}</small></span>
                          {risky && <span className="food-results__warn" title="Contains one of your allergens"><Icon name="alert" size={16} /></span>}
                          <Icon name="chevron" size={18} />
                        </button>
                        {open && (
                          <div className="food-results__detail">
                            <NutritionFacts food={f} allergens={allergens} />
                            <button className={added ? "secondary-button" : "primary-button"} onClick={() => toggleFood(f)}>
                              {added ? "Remove from meal" : <><Icon name="plus" size={18} /> Add to my meal</>}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <small className="food-lookup__credit">Food data from Open Food Facts</small>
            </section>

            <div className="prompt-card">
              <Buddy small />
              <p><strong>Not sure what to include?</strong><br />Think about toppings, drinks, snacks, and sauces too.</p>
            </div>
            <button className="primary-button" disabled={!desc.trim() && selectedFoods.length === 0} onClick={reviewDescription}>
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
                <h2>Food logged. Delicious!</h2>
                <p>That’s one more clue to help us understand what makes you feel your best.</p>
                <BuddyInBowl />
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
                {photoMatch && (
                  <div className={`photo-match ${!photoMatch.loading && !photoMatch.exact ? "is-miss" : ""}`} aria-live="polite">
                    <Icon name={photoMatch.loading ? "search" : photoMatch.exact ? "check" : "alert"} size={18} />
                    <p>
                      {photoMatch.loading ? <>Looking up <strong>{photoMatch.label}</strong> in the food database…</>
                        : photoMatch.exact ? <>Matched <strong>{photoMatch.label}</strong> with the food database</>
                        : <>Couldn’t find <strong>{photoMatch.label}</strong> in the food database, so these notes come from the photo only.{photoMatch.products?.length ? " Tap a similar product below if it’s the same thing." : ""}</>}
                    </p>
                  </div>
                )}
                {selectedFoods.map(f => (
                  <div className="food-review-card" key={foodKey(f)}>
                    <div className="food-review-card__top">
                      {f.image ? <img src={f.image} alt="" /> : <span className="food-results__thumb"><Icon name="image" size={18} /></span>}
                      <div><strong>{f.name}</strong><small>{f.brand}</small></div>
                    </div>
                    <NutritionFacts food={f} allergens={allergens} />
                  </div>
                ))}
                {photoMatch?.products && (photoMatch.exact ? photoMatch.products.length > 1 : photoMatch.products.length > 0) && (
                  <div className="photo-match__alts">
                    <small>{photoMatch.exact ? "Not the right one? Pick a closer match:" : "Similar products:"}</small>
                    <div className="match-chips">
                      {photoMatch.products.slice(0, 4).map(f => (
                        <button key={foodKey(f)} className={selectedFoods.some(x => foodKey(x) === foodKey(f)) ? "is-on" : ""}
                          onClick={() => setSelectedFoods([f])}>{f.name}{f.brand ? ` · ${f.brand.split(",")[0]}` : ""}</button>
                      ))}
                    </div>
                  </div>
                )}
                {(scan.result?.kind === "homemade" || scan.result?.kind === "restaurant") && scan.result.nutrition_estimate && (
                  <EstimateCard est={scan.result.nutrition_estimate} title={scan.result.name || (scan.result.kind === "homemade" ? "Homemade dish" : "Restaurant dish")} />
                )}
                {mealFlags.mine.length > 0 && (
                  <div className="severity-alert allergen-warning" role="alert">
                    <Icon name="alert" size={20} />
                    <p><strong>Heads up:</strong> this may contain {mealFlags.mine.join(", ")}, which {mealFlags.mine.length > 1 ? "are" : "is"} on your allergen list.</p>
                  </div>
                )}
                <div className="ai-card">
                  <div className="ai-card__heading ai-card__heading--legacy">
                    <span><Icon name="spark" size={19} /></span>
                    <strong>AI food notes</strong>
                    <small>{scan.loading ? "Reading…" : "Preview"}</small>
                  </div>
                  <textarea aria-label="Food notes" value={desc} onChange={e => setDesc(e.target.value)}
                    placeholder={photo ? "I can see your photo. Add any details you remember, like sauces or ingredients." : ""} />
                  <p className="ai-card__groups-label">Possible allergy groups</p>
                  <div className="possible-tags">
                    {scan.loading && <span className="tag-loading">Checking ingredients…</span>}
                    {mealFlags.mine.map(a => <span key={a} className="tag-alert">Your allergen: {a}</span>)}
                    {mealFlags.common.map(a => {
                      const manual = extraGroups.some(x => allergyGroup(x) === a);
                      return (
                        <span key={a} className={manual ? "tag-manual" : ""}>{a}
                          {manual && <button onClick={() => setExtraGroups(l => l.filter(x => allergyGroup(x) !== a))} aria-label={`Remove ${a}`}><Icon name="close" size={11} strokeWidth={2.4} /></button>}
                        </span>
                      );
                    })}
                    {scan.result && !mealFlags.mine.length && !mealFlags.common.length && groupDraft === null && <span>None spotted</span>}
                    {groupDraft === null ? (
                      <button className="tag-add" onClick={() => setGroupDraft("")} aria-label="Add another possible allergen"><Icon name="plus" size={13} strokeWidth={2.4} /></button>
                    ) : (
                      <form className="tag-add-form" onSubmit={e => { e.preventDefault(); addGroup(); }}>
                        <input autoFocus value={groupDraft} onChange={e => setGroupDraft(e.target.value)} onBlur={addGroup}
                          placeholder="e.g. sesame" aria-label="Another possible allergen" />
                      </form>
                    )}
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
            {saveError && <p className="save-error history-save-error">{saveError}</p>}
            <div className="timeline">
              {meals.map((m, i) => (
                <article className="log-entry" key={m.id}>
                  <div className="timeline__rail"><span>{dayLabel(m.createdAt, meals[i - 1]?.createdAt)}</span><i /></div>
                  <div className="log-card">
                    {mealImages[m.id]
                      ? <img src={mealImages[m.id]} alt="" />
                      : <div className={`food-thumb food-thumb--${i % 2}`}><Icon name={m.flags.some(f => allergens.includes(f)) ? "alert" : i % 2 ? "spark" : "check"} /></div>}
                    <div className="log-card__copy">
                      {editingMeal?.id === m.id ? (
                        <div className="log-card__edit-fields">
                          <input value={editingMeal.name} onChange={e => setEditingMeal({ ...editingMeal, name: e.target.value })} aria-label="Meal name" />
                          <textarea value={editingMeal.details} onChange={e => setEditingMeal({ ...editingMeal, details: e.target.value })} aria-label="Meal details" />
                        </div>
                      ) : (
                        <>
                          <strong>{m.name}</strong>
                          <p>{m.details}</p>
                          <small><Icon name="clock" size={14} /> {timeAgo(m.createdAt)}{m.flags.length > 0 && ` · ${m.flags.slice(0, 3).join(", ")}`}</small>
                          {m.ingredients.some(x => x.flagged) && (
                            <span className="log-card__flagged"><Icon name="flag" size={12} strokeWidth={2.2} /> {m.ingredients.filter(x => x.flagged).map(x => x.name).join(", ")}</span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="log-card__actions">
                      {editingMeal?.id === m.id ? (
                        <>
                          <button className="log-card__save" aria-label={`Save changes to ${m.name}`} onClick={async () => {
                            const err = await updateMeal(m.id, { name: editingMeal.name, details: editingMeal.details });
                            if (err) setSaveError(err); else { setEditingMeal(null); setSaveError(""); }
                          }}><Icon name="check" size={18} /></button>
                          <button onClick={() => { setEditingMeal(null); setSaveError(""); }} aria-label="Cancel editing"><Icon name="close" size={18} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setIngredientMealId(m.id)} aria-label={`View ingredients for ${m.name}`}><Icon name="info" size={18} /></button>
                          <button onClick={() => { setEditingMeal({ id: m.id, name: m.name, details: m.details }); setSaveError(""); }} aria-label={`Edit ${m.name}`}><Icon name="pen" size={18} /></button>
                          <button onClick={() => deleteMeal(m.id)} aria-label={`Delete ${m.name}`}><Icon name="trash" size={18} /></button>
                        </>
                      )}
                    </div>
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

            <section className="allergy-card" aria-label="My allergens">
              <strong>My allergens</strong>
              <div className="allergen-chips">
                {allergens.length === 0 && <small>None added yet</small>}
                {allergens.map(a => (
                  <span key={a}>{a}<button onClick={() => removeAllergen(a)} aria-label={`Remove ${a}`}><Icon name="close" size={13} strokeWidth={2.2} /></button></span>
                ))}
              </div>
              <form className="inline-add" onSubmit={e => { e.preventDefault(); addAllergen(); }}>
                <input value={newAllergen} onChange={e => { setNewAllergen(e.target.value); if (allergenCheck.problems.length) setAllergenCheck({ busy: false, problems: [] }); }}
                  placeholder="Add an allergen" aria-label="Add an allergen" />
                <button type="submit" disabled={!newAllergen.trim() || allergenCheck.busy} aria-label="Add allergen">
                  {allergenCheck.busy ? <span className="mini-spinner" aria-hidden="true" /> : <Icon name="plus" size={18} strokeWidth={2.2} />}
                </button>
              </form>
              {allergenCheck.busy && <p className="allergen-check__status">Checking it’s a food allergen…</p>}
              {allergenCheck.problems.map(p => (
                <div className="allergen-check" role="alert" key={p.name}>
                  <Icon name="alert" size={16} />
                  <p>{p.reason}</p>
                  <div>
                    {p.suggestion && <button onClick={() => resolveProblem(p.name, p.suggestion)}>Yes, add “{p.suggestion}”</button>}
                    {p.unsure && <button className="is-quiet" onClick={() => addAllergen(p.name)}>Try again</button>}
                    <button className="is-quiet allergen-override" onClick={() => resolveProblem(p.name, p.name.toLowerCase())}>
                      {p.suggestion ? `No, keep “${p.name}”` : `Add “${p.name}” anyway`}
                    </button>
                    <button className="is-quiet" onClick={() => resolveProblem(p.name)} aria-label="Dismiss"><Icon name="close" size={13} strokeWidth={2.2} /></button>
                  </div>
                </div>
              ))}

            </section>

            {flaggedIngredients.length > 0 && (
              <section className="flagged-card" aria-label="Flagged ingredients">
                <div className="flagged-card__head"><Icon name="flag" size={17} strokeWidth={2} /><strong>Ingredients you flagged</strong></div>
                <ul>
                  {flaggedIngredients.map(f => (
                    <li key={f.name}>
                      <span>{f.name}</span>
                      <small>in {f.meals} meal{f.meals > 1 ? "s" : ""}</small>
                      {!allergens.some(a => allergenMatches(a, f.name)) && (
                        <button onClick={() => { const next = [...new Set([...allergens, f.name.toLowerCase()])]; setAllergens(next); saveProfile(next); }}>Add to my allergens</button>
                      )}
                    </li>
                  ))}
                </ul>
                <p>Flag ingredients from Meal history (tap ⓘ on a meal). These are your suspicions, not a diagnosis.</p>
              </section>
            )}

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
              <span>allergeez helps you notice patterns, but it cannot diagnose an allergy. Always confirm concerns with a qualified healthcare professional.</span>
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
                <small>{reactionAI?.loading ? "Gee is reading…" : reactionAI?.source === "gemini" ? "AI read" : "Live preview"}</small>
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
                  {mealsThatDay.length === 0 && <option disabled value="__none__">No meals logged that day</option>}
                  {mealsThatDay.map(m => (
                    <option key={m.id} value={m.name}>{m.name} · {new Date(m.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</option>
                  ))}
                </select>
              </label>
              <div className="reaction-photo-field">
                {reactionPhoto ? (
                  <div className="reaction-photo-preview">
                    <img src={reactionPhoto} alt="Visible reaction selected for this entry" />
                    <button onClick={() => setReactionPhoto(undefined)} aria-label="Remove photo"><Icon name="close" size={18} /></button>
                  </div>
                ) : (
                  <>
                    <span className="reaction-photo-field__label">Symptom photo <small>Optional</small></span>
                    <div className="photo-choice">
                      <button onClick={() => setCameraFor("reaction")}><Icon name="camera" size={21} /> Take a photo</button>
                      <button onClick={() => reactionInput.current?.click()}><Icon name="image" size={21} /> Add a photo</button>
                    </div>
                  </>
                )}
                <input ref={reactionInput} hidden type="file" accept="image/*" onChange={onReactionPhoto} />
              </div>
            </div>
            <button className="primary-button reaction-continue" disabled={!symptoms.trim()} onClick={() => { go("reaction-review"); analyzeSymptoms(symptoms); }}>
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
                    <div className="reaction-tag">
                      <small>{reactionAI?.loading ? "Gee is reading your symptoms…" : "Reaction tag"}</small>
                      <input value={reactionTag} onChange={e => setReactionTag(e.target.value)} aria-label="Reaction tag" maxLength={60} />
                    </div>
                    <b className={sevClass(severity)}>{severity}/10</b>
                  </div>
                  {!!reactionAI?.symptoms?.length && (
                    <div className="symptom-chips">{reactionAI.symptoms.map(x => <span key={x}>{x}</span>)}</div>
                  )}
                  <p className="reaction-said">“{symptoms}”</p>
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
                  const linked = meals.find(m => m.name === r.food);
                  const flags = [...new Set([...(linked?.ingredients.filter(i => i.flagged).map(i => `${i.name} (flagged)`) ?? []), ...(linked?.flags ?? [])])];
                  return (
                    <article className="reaction-log-card" key={r.id}>
                      <div className="reaction-log-card__top">
                        {reactionImages[r.id] ? <img src={reactionImages[r.id]} alt="" /> : <span className="reaction-summary-card__icon"><Icon name="medical" size={22} /></span>}
                        <div>
                          <small><Icon name="clock" size={13} />{new Date(r.occurredAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
                          <strong>{r.title || attackTag(detectSymptoms(r.symptoms), r.symptoms)}</strong>
                          {(() => { const tags = r.symptomTags.length ? r.symptomTags : detectSymptoms(r.symptoms);
                            return tags.length > 0 && <span className="symptom-chips symptom-chips--small">{tags.slice(0, 4).map(x => <span key={x}>{x}</span>)}</span>; })()}
                        </div>
                        {r.severity > 0 && <b className={sevClass(r.severity)}>{r.severity}/10</b>}
                      </div>
                      <details>
                        <summary>View details</summary>
                        <dl>
                          <div><dt>What you said</dt><dd>{r.symptoms}</dd></div>
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

        {screen === "profile" && (
          <ProfileScreen user={user} contact={contact} onSaveContact={saveContact} onBack={() => go("home")} />
        )}

        {screen === "test-food" && (
          <div className="screen">
            <AppHeader title="Test a food" onBack={() => { resetTest(); go("home"); }} onEmergency={openEmergency} />
            <section className="page-intro page-intro--compact">
              <p className="eyebrow">Before you eat</p>
              <h2>Is this safe for me?</h2>
              <p>Snap a package or meal, or search a brand. Gee checks it against your allergens. Nothing is saved unless you choose to.</p>
            </section>

            {allergens.length === 0 && (
              <div className="test-note">
                <Icon name="shield" size={18} />
                <p>Add your allergens first so Gee can give you a personal answer.</p>
                <button onClick={() => go("allergens")}>Add allergens</button>
              </div>
            )}

            {!testHasResult ? (
              <>
                <div className="record-options">
                  <button onClick={() => setCameraFor("test")}>
                    <span className="option-icon option-icon--peach"><Icon name="camera" size={27} /></span>
                    <span><strong>Take a photo</strong><small>A package, label, menu, or plate</small></span>
                    <Icon name="chevron" size={20} />
                  </button>
                  <button onClick={() => testInput.current?.click()}>
                    <span className="option-icon option-icon--rose"><Icon name="image" size={27} /></span>
                    <span><strong>Choose a photo</strong><small>Pick one from your library</small></span>
                    <Icon name="chevron" size={20} />
                  </button>
                </div>
                <input ref={testInput} hidden type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleMealFile(f, "test-food"); }} />
                <section className="food-lookup" aria-label="Search a packaged food">
                  <div className="food-lookup__head"><strong>Or search a brand</strong><small>Find the product to see its allergens and nutrition.</small></div>
                  <form className="inline-add" onSubmit={e => { e.preventDefault(); lookUpFood(); }}>
                    <input value={foodQuery} onChange={e => setFoodQuery(e.target.value)} placeholder="Brand or product name" aria-label="Brand or product name" />
                    <button type="submit" disabled={foodQuery.trim().length < 2 || foodSearch.loading} aria-label="Search"><Icon name="search" size={18} strokeWidth={2.2} /></button>
                  </form>
                  {foodSearch.loading && <p className="food-lookup__status">Searching the food database…</p>}
                  {foodSearch.error && <p className="save-error">{foodSearch.error}</p>}
                  {foodSearch.products && foodSearch.products.length === 0 && <p className="food-lookup__status">No products found for “{foodSearch.query}”.</p>}
                  {foodSearch.products && foodSearch.products.length > 0 && (
                    <ul className="food-results">
                      {foodSearch.products.map(f => (
                        <li key={foodKey(f)}>
                          <button className="food-results__row" onClick={() => testProduct(f)}>
                            {f.image ? <img src={f.image} alt="" /> : <span className="food-results__thumb"><Icon name="image" size={18} /></span>}
                            <span className="food-results__copy"><strong>{f.name}</strong><small>{f.brand}</small></span>
                            <Icon name="chevron" size={18} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : (
              <>
                {(() => {
                  const busy = scan.loading || photoMatch?.loading;
                  const verdict = busy ? "checking" : mealFlags.mine.length ? "danger" : !allergens.length ? "unknown" : scan.error ? "unknown" : "ok";
                  return (
                    <div className={`verdict verdict--${verdict}`} role="status">
                      <span className="verdict__icon"><Icon name={verdict === "danger" ? "alert" : verdict === "ok" ? "check" : verdict === "checking" ? "search" : "info"} size={26} strokeWidth={2.2} /></span>
                      <div>
                        <strong>{verdict === "checking" ? "Gee is checking…" : verdict === "danger" ? "Not safe for you" : verdict === "ok" ? "No match with your allergens" : "No personal check yet"}</strong>
                        <p>{verdict === "danger" ? `May contain ${mealFlags.mine.join(", ")}, which ${mealFlags.mine.length > 1 ? "are" : "is"} on your allergen list.`
                          : verdict === "ok" ? "Gee didn’t find any of your allergens. Still read the label: recipes change and cross-contact happens."
                          : verdict === "checking" ? "Reading the ingredients and looking up the product."
                          : scan.error ? "Gee couldn’t finish the check. Try again below." : "Add your allergens to get a safe / not safe answer."}</p>
                      </div>
                    </div>
                  );
                })()}

                {photo && <img className="meal-preview" src={photo} alt="The food you’re testing" />}
                {photoMatch && !photoMatch.loading && (
                  <div className={`photo-match ${!photoMatch.exact ? "is-miss" : ""}`}>
                    <Icon name={photoMatch.exact ? "check" : "alert"} size={18} />
                    <p>{photoMatch.exact ? <>Matched <strong>{photoMatch.label}</strong> with the food database</> : <>Couldn’t find <strong>{photoMatch.label}</strong> in the food database.</>}</p>
                  </div>
                )}
                {selectedFoods.map(f => (
                  <div className="food-review-card" key={foodKey(f)}>
                    <div className="food-review-card__top">
                      {f.image ? <img src={f.image} alt="" /> : <span className="food-results__thumb"><Icon name="image" size={18} /></span>}
                      <div><strong>{f.name}</strong><small>{f.brand}</small></div>
                    </div>
                    <NutritionFacts food={f} allergens={allergens} />
                  </div>
                ))}
                {(scan.result?.kind === "homemade" || scan.result?.kind === "restaurant") && scan.result.nutrition_estimate && (
                  <EstimateCard est={scan.result.nutrition_estimate} title={scan.result.name || "This dish"} />
                )}
                {(scan.result || scan.error) && (
                  <div className="ai-card">
                    <div className="ai-card__heading ai-card__heading--legacy"><span><Icon name="spark" size={19} /></span><strong>What Gee found</strong><small>AI check</small></div>
                    {!!scan.result?.ingredients?.length && <p className="test-ingredients">{scan.result.ingredients.slice(0, 18).join(", ")}</p>}
                    <div className="possible-tags">
                      {mealFlags.mine.map(a => <span key={a} className="tag-alert">Your allergen: {a}</span>)}
                      {mealFlags.common.map(a => <span key={a}>Possible: {a}</span>)}
                      {scan.result && !mealFlags.mine.length && !mealFlags.common.length && <span>No common allergens spotted</span>}
                    </div>
                    {scan.result?.note && <p className="ai-card__note">{scan.result.note}</p>}
                    {scan.error && <p className="save-error">{scan.error} <button className="inline-link" onClick={() => runScan(lastScanInput.current)}>Try again</button></p>}
                  </div>
                )}
                <p className="disclaimer">These are clues, not a diagnosis. When in doubt, don’t eat it, and ask a healthcare professional.</p>
                {saveError && <p className="save-error">{saveError}</p>}
                {saved ? (
                  <p className="profile-success-hint"><Icon name="check" size={16} /> Saved to your food history</p>
                ) : (
                  <button className="secondary-button" onClick={saveMeal} disabled={scan.loading || !(scan.result || selectedFoods.length)}>
                    <Icon name="plus" size={18} /> I ate this, save to food history
                  </button>
                )}
                <button className="primary-button" style={{ marginTop: 10 }} onClick={resetTest}>Test another food</button>
              </>
            )}
          </div>
        )}

        {screen === "emergency-guide" && (
          <Emergency contact={contact} trigger={lastTrigger} onExit={() => go("home")} />
        )}

        {cameraFor === "meal" && (
          <CameraCapture onCapture={handleMealFile} onClose={() => setCameraFor(null)}
            onFallback={() => { setCameraFor(null); cameraInput.current?.click(); }} />
        )}
        {cameraFor === "test" && (
          <CameraCapture hint="Snap the package, label, or plate" onCapture={f => handleMealFile(f, "test-food")} onClose={() => setCameraFor(null)}
            onFallback={() => { setCameraFor(null); testInput.current?.click(); }} />
        )}
        {cameraFor === "reaction" && (
          <CameraCapture hint="Photograph the hives, rash, or swelling" onCapture={loadReactionPhoto} onClose={() => setCameraFor(null)}
            onFallback={() => { setCameraFor(null); reactionInput.current?.click(); }} />
        )}

        {ingredientMeal && (
          <IngredientModal meal={ingredientMeal} allergens={allergens} onClose={() => setIngredientMealId(null)}
            onSave={ingredients => updateMeal(ingredientMeal.id, { ingredients })} />
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
              {contact.phone && (
                <a className="call-button call-button--contact" href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}>
                  <Icon name="phone" /> Call {contact.name || "emergency contact"} ({contact.phone})
                </a>
              )}
              <button className="guide-button" onClick={openGuide}><Icon name="speaker" size={20} /> Talk me through it</button>
              {!contact.phone && (
                <button className="text-button" onClick={() => { setEmergencyOpen(false); go("profile"); }}>Add an emergency contact</button>
              )}
              <button className="secondary-button" onClick={() => setEmergencyOpen(false)}>My symptoms are not severe</button>
              <small>allergeez does not replace emergency or medical care.</small>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
