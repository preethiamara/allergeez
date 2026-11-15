// Keyword-based symptom detection. Used as the instant fallback when Gemini is unavailable,
// and shared by the browser (history titles for older entries) and the server.

const SYMPTOMS: [string, RegExp][] = [
  ["Throat tightness", /\b(throat|swallow)\w*\b.*\b(tight|clos)|\b(tight|clos)\w*\b.*\bthroat/i],
  ["Throat swelling", /\b(throat|swallow)\w*\b.*\b(swell|swoll)|\b(swell|swoll)\w*\b.*\bthroat/i],
  ["Trouble breathing", /\b(can'?t breathe|trouble breathing|short(ness)? of breath|wheez\w*|breathless|hard to breathe|difficulty breathing)\b/i],
  ["Lip swelling", /\b(lips?|tongue|mouth)\b.*\b(swell|swoll|puff)|\b(swell|swoll|puff)\w*\b.*\b(lips?|tongue)\b/i],
  ["Tingling mouth", /\b(tingl\w*|itchy mouth|mouth itch\w*|lips? itch\w*)\b/i],
  ["Hives", /\b(hives?|welts?|urticaria)\b/i],
  ["Rash", /\b(rash|red spots?|red patches?|blotch\w*|bumps?)\b/i],
  ["Itching", /\b(itch\w*|scratch\w*)\b/i],
  ["Swelling", /\b(swell\w*|swoll\w*|puff\w*)\b/i],
  ["Vomiting", /\b(vomit\w*|throw(ing)? up|threw up)\b/i],
  ["Nausea", /\b(nause\w*|queasy|sick to my stomach|feel sick)\b/i],
  ["Stomach pain", /\b(stomach (ache|pain|cramps?)|stomachache|belly (ache|pain)|abdominal pain|cramp\w*)\b/i],
  ["Diarrhea", /\b(diarr?h(o)?ea|loose stools?)\b/i],
  ["Dizziness", /\b(dizz\w*|lightheaded|light-headed|faint\w*|passed out)\b/i],
  ["Runny nose", /\b(runny nose|sneez\w*|congest\w*|stuffy)\b/i],
  ["Watery eyes", /\b(watery eyes|itchy eyes|eyes? (water|itch)\w*)\b/i],
  ["Coughing", /\b(cough\w*)\b/i],
  ["Headache", /\b(headache|migraine)\b/i],
];
const SEVERE = new Set(["Throat tightness", "Throat swelling", "Trouble breathing", "Dizziness"]);

export function detectSymptoms(text: string): string[] {
  const t = text || "";
  const found = SYMPTOMS.filter(([, re]) => re.test(t)).map(([name]) => name);
  // Don't show generic "Swelling" when a specific swelling was found
  return found.some(s => s === "Throat swelling" || s === "Lip swelling" || s === "Throat tightness") ? found.filter(s => s !== "Swelling") : found;
}

/** Short title for a reaction: "Hives & itching", "Throat swelling", "Stomach pain & nausea". */
export function attackTag(symptoms: string[], fallbackText = ""): string {
  const ordered = [...symptoms].sort((a, b) => Number(SEVERE.has(b)) - Number(SEVERE.has(a)));
  if (ordered.length === 0) {
    const first = fallbackText.trim().split(/[.,;!?\n]/)[0].trim();
    return first ? (first.length > 32 ? first.slice(0, 30).trim() + "…" : first.charAt(0).toUpperCase() + first.slice(1)) : "Reaction";
  }
  const [a, b] = ordered;
  return b ? `${a} & ${b.toLowerCase()}` : a;
}

// ---- Fallback parsing of the other parts of a spoken/typed description ----
const NUM = "(?:\\d+|a few|few|a couple(?: of)?|couple(?: of)?|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|half an?)";

/** "20 minutes after lunch", "right after eating", "this morning" … */
export function parseTiming(text: string): string {
  const t = text || "";
  const patterns = [
    new RegExp(`\\b${NUM}\\s*(?:minutes?|mins?|hours?|hrs?)\\s+(?:after|later|ago|into)(?:\\s+(?:i\\s+ate|i\\s+had|eating|having|lunch|dinner|breakfast|that|it))?`, "i"),
    /\b(?:right|immediately|shortly|soon|just)\s+after\s+(?:i\s+)?(?:ate|eating|having|had|lunch|dinner|breakfast|that)\b/i,
    /\bafter\s+(?:lunch|dinner|breakfast|eating|i ate|i had)\b/i,
    /\b(?:this|last|yesterday)\s+(?:morning|afternoon|evening|night)\b|\btonight\b|\byesterday\b/i,
    /\bfor\s+(?:the\s+)?(?:last|past)\s+\S+\s+(?:minutes?|hours?)\b/i,
  ];
  for (const re of patterns) { const m = t.match(re); if (m) return m[0].trim(); }
  return "";
}

/** "mild", "really bad", "7/10" … */
export function parseIntensity(text: string): string {
  const t = text || "";
  const score = t.match(/\b(\d{1,2})\s*(?:\/|out of)\s*10\b/i);
  if (score) return `${score[1]}/10`;
  const m = t.match(/\b(very |really |super |pretty |kind of |a little |a bit |slightly |extremely )?(mild|slight|moderate|severe|intense|terrible|awful|bad|painful|unbearable|worse|worsening|getting worse)\b/i);
  return m ? m[0].trim().toLowerCase() : "";
}

/** "the shrimp pad thai" from "after I ate the shrimp pad thai" … */
export function parseFood(text: string): string {
  const t = text || "";
  const m = t.match(/\b(?:after\s+)?(?:i\s+)?(?:ate|eating|had|having|tried|drank)\s+(?:some\s+|a\s+|an\s+|the\s+|my\s+)?([a-z][a-z' -]{1,40}?)(?=\s+(?:and|then|but|about|around|at|for|now|my|i|it|so|which|that)\b|[,.!?;]|$)/i);
  if (!m) return "";
  const food = m[1].trim();
  return /^(a few|some|minutes?|hours?|lunch|dinner|breakfast)$/i.test(food) ? "" : food;
}
