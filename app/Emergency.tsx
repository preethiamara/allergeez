"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Step = { title: string; body: string; say: string; needsChoice?: boolean };

const STEPS: Step[] = [
  {
    title: "Use your epinephrine now",
    body: "Pull off the blue safety cap. Press the orange tip firmly into your outer thigh, through clothing is fine, and hold for 3 seconds.",
    say: "Stay calm. I'll guide you. If you have an epinephrine auto-injector, use it now. Pull off the blue safety cap, press the orange tip firmly into your outer thigh, and hold for three seconds. Tap, I used it, when you're done.",
    needsChoice: true,
  },
  {
    title: "Call 911",
    body: "Call even if you feel better after the injection. Symptoms can come back.",
    say: "Call nine one one right now, even if you feel better. Symptoms can come back. Tap the red call button at the top of the screen.",
  },
  {
    title: "Lie down, legs raised",
    body: "If breathing is hard, sit up instead. If you're vomiting, lie on your side. Don't stand or walk suddenly.",
    say: "Lie down and raise your legs. If it's hard to breathe, sit up instead. If you feel sick, lie on your side. Don't stand up or walk suddenly.",
  },
  {
    title: "Get someone with you",
    body: "Tell a person nearby what is happening. Unlock the door so responders can get in. Use the announce button if you can't talk.",
    say: "Get someone to stay with you. Tell them you're having an allergic reaction. If you can, unlock the door for the paramedics.",
  },
  {
    title: "Watch the timer",
    body: "If symptoms don't improve 5 minutes after the first dose, use a second auto-injector if you have one. Stay lying down until help arrives.",
    say: "Keep watching the timer. If you are not getting better five minutes after the first dose, use a second auto-injector if you have one. Stay lying down until help arrives. You're doing the right things.",
  },
];

const EPI_SECONDS = 5 * 60;

// ---------- audio plumbing ----------
let audioEl: HTMLAudioElement | null = null;
const ttsCache = new Map<string, Promise<string | null>>();

function silentWavUrl() {
  const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/** Call synchronously inside the click that opens emergency mode, so mobile browsers allow later playback. */
export function unlockEmergencyAudio() {
  try {
    audioEl ??= new Audio();
    audioEl.src = silentWavUrl();
    audioEl.play().catch(() => {});
  } catch {}
  try { speechSynthesis.speak(new SpeechSynthesisUtterance(" ")); } catch {}
  STEPS.forEach(s => fetchTts(s.say)); // start generating voice for every step immediately
}

// ElevenLabs free tier rejects too many concurrent requests, so run at most 2 at a time.
let active = 0;
const waiting: (() => void)[] = [];
async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 2) await new Promise<void>(r => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

function fetchTts(text: string) {
  if (!ttsCache.has(text)) {
    ttsCache.set(text, throttled(() => fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }))
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.size > 0 ? URL.createObjectURL(b) : null))
      .catch(() => null)
      .then(url => { if (!url) ttsCache.delete(text); return url; }));
  }
  return ttsCache.get(text)!;
}

const timeout = <T,>(ms: number, v: T) => new Promise<T>(r => setTimeout(() => r(v), ms));
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;

// ---------- component ----------
export default function Emergency({ contact, trigger, onExit }: {
  contact: { name: string; phone: string };
  trigger?: string;
  onExit: () => void;
}) {
  const [step, setStep] = useState(0);
  const [muted, setMuted] = useState(false);
  const [auto, setAuto] = useState(true);
  const [voice, setVoice] = useState<"idle" | "loading" | "elevenlabs" | "device">("idle");
  const [epiAt, setEpiAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const seq = useRef(0);
  const alerted = useRef(false);
  const mutedRef = useRef(muted); mutedRef.current = muted;

  const stop = useCallback(() => {
    seq.current++;
    if (audioEl) { audioEl.onended = null; audioEl.pause(); }
    try { speechSynthesis.cancel(); } catch {}
    setVoice("idle");
  }, []);

  /** Speaks text; resolves true if it finished without being interrupted. */
  const speak = useCallback(async (text: string): Promise<boolean> => {
    stop();
    if (mutedRef.current) return true;
    const id = seq.current;
    setVoice("loading");
    // Don't make someone in distress wait: fall back to the device voice after 3.5s.
    const url = await Promise.race([fetchTts(text), timeout(3500, null)]);
    if (id !== seq.current) return false;

    if (url) {
      audioEl ??= new Audio();
      const el = audioEl;
      el.src = url;
      try {
        const done = new Promise<void>(res => { el.onended = () => res(); });
        await el.play();
        setVoice("elevenlabs");
        await done;
        if (id !== seq.current) return false;
        setVoice("idle");
        return true;
      } catch { /* autoplay blocked or bad audio: fall through to device voice */ }
    }
    if (id !== seq.current) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      setVoice("device");
      await new Promise<void>(res => { u.onend = () => res(); u.onerror = () => res(); speechSynthesis.speak(u); });
    } catch {}
    if (id !== seq.current) return false;
    setVoice("idle");
    return true;
  }, [stop]);

  // Speak each step when it becomes current; auto-advance hands-free.
  useEffect(() => {
    let cancelled = false;
    speak(STEPS[step].say).then(finished => {
      if (cancelled || !finished || !auto || STEPS[step].needsChoice || step >= STEPS.length - 1) return;
      setTimeout(() => !cancelled && setStep(s => (s === step ? s + 1 : s)), 1500);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Epinephrine timer + spoken alert at 5 minutes.
  useEffect(() => {
    if (!epiAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [epiAt]);
  const elapsed = epiAt ? Math.floor((now - epiAt) / 1000) : 0;
  const remaining = EPI_SECONDS - elapsed;
  useEffect(() => {
    if (epiAt && remaining <= 0 && !alerted.current) {
      alerted.current = true;
      speak("It has been five minutes since your first epinephrine dose. If you are not getting better, use a second auto-injector now if you have one, and make sure nine one one is on the way.");
    }
  }, [epiAt, remaining, speak]);

  // Keep the screen awake while in emergency mode.
  useEffect(() => {
    let lock: any;
    (navigator as any).wakeLock?.request("screen").then((l: any) => (lock = l)).catch(() => {});
    return () => { lock?.release?.(); stop(); };
  }, [stop]);

  // Keyboard: space repeat, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") { e.preventDefault(); speak(STEPS[step].say); }
      if (e.key === "ArrowRight") setStep(s => Math.min(STEPS.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep(s => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, speak]);

  const usedEpi = () => { if (!epiAt) { setEpiAt(Date.now()); setNow(Date.now()); } setStep(1); };
  const announcement = `Excuse me! I'm having a severe allergic reaction${trigger ? ` to ${trigger}` : ""}. Please call nine one one${epiAt ? "" : " and help me use my EpiPen"}. Please stay with me.`;
  const announce = () => speak(announcement);

  const s = STEPS[step];
  const red = "#b00020";
  const big = { display: "block", width: "100%", boxSizing: "border-box", textAlign: "center", textDecoration: "none", border: 0, borderRadius: 14, padding: "16px 18px", fontSize: 18, fontWeight: 600, cursor: "pointer", marginBottom: 10 } as const;
  const ghost = { ...big, background: "#fff", color: "#222", border: "2px solid #ddd", marginBottom: 0, padding: "12px 10px", fontSize: 16 } as const;
  const voiceLabel = muted ? "Voice off" : { idle: "Voice ready", loading: "Preparing voice…", elevenlabs: "Speaking", device: "Speaking (device voice)" }[voice];

  return (
    <main style={{ minHeight: "100vh", background: "#fff5f5", padding: 16, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h1 style={{ color: red, margin: 0, fontSize: 26 }}>Emergency</h1>
          <span aria-live="polite" style={{ fontSize: 14, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: voice === "elevenlabs" || voice === "device" ? red : "#bbb", animation: voice === "elevenlabs" || voice === "device" ? "pulse 1s infinite" : "none" }} />
            {voiceLabel}
          </span>
        </div>

        <a href="tel:911" style={{ ...big, background: red, color: "#fff", fontSize: 28, padding: 24 }}>Call 911</a>

        {epiAt && (
          <div role="timer" style={{ background: remaining <= 0 ? red : "#fff", color: remaining <= 0 ? "#fff" : "#222", border: `2px solid ${red}`, borderRadius: 14, padding: 14, marginBottom: 10, textAlign: "center" }}>
            <div style={{ fontSize: 14 }}>{remaining > 0 ? "Second dose may be needed in" : "5 minutes passed since first dose"}</div>
            <div style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{remaining > 0 ? fmt(remaining) : `+${fmt(-remaining)}`}</div>
            {remaining <= 0 && <div style={{ fontSize: 15 }}>Not improving? Use a second auto-injector if you have one.</div>}
          </div>
        )}

        <section aria-live="assertive" style={{ background: "#fff", border: `3px solid ${red}`, borderRadius: 16, padding: 20, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {STEPS.map((_, i) => (
              <button key={i} aria-label={`Step ${i + 1}`} onClick={() => setStep(i)}
                style={{ flex: 1, height: 8, border: 0, borderRadius: 4, cursor: "pointer", background: i <= step ? red : "#eee" }} />
            ))}
          </div>
          <div style={{ fontSize: 14, color: "#777" }}>Step {step + 1} of {STEPS.length}</div>
          <h2 style={{ fontSize: 28, margin: "4px 0 8px", lineHeight: 1.2 }}>{s.title}</h2>
          <p style={{ fontSize: 20, lineHeight: 1.45, margin: 0 }}>{s.body}</p>

          {s.needsChoice && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
              <button style={{ ...big, background: red, color: "#fff", marginBottom: 0 }} onClick={usedEpi}>I used it</button>
              <button style={{ ...big, background: "#444", color: "#fff", marginBottom: 0 }} onClick={() => setStep(1)}>I don't have one</button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: 8, marginTop: 16 }}>
            <button style={ghost} disabled={step === 0} onClick={() => setStep(step - 1)}>‹ Back</button>
            <button style={{ ...ghost, borderColor: red, color: red }} onClick={() => speak(s.say)}>🔊 Repeat</button>
            <button style={ghost} disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>Next ›</button>
          </div>
        </section>

        <button style={{ ...big, background: "#222", color: "#fff" }} onClick={announce}>📢 Announce to people nearby</button>
        {!epiAt && <button style={{ ...big, background: "#fff", color: red, border: `2px solid ${red}` }} onClick={() => { setEpiAt(Date.now()); setNow(Date.now()); }}>Start 5-minute epinephrine timer</button>}
        {contact.phone && (
          <a style={{ ...big, background: "#fff", color: "#222", border: "2px solid #ddd" }}
            href={`sms:${contact.phone}?&body=${encodeURIComponent(`I'm having an allergic reaction${trigger ? ` (possibly ${trigger})` : ""}. Please call me or come help.`)}`}>
            Text {contact.name || "emergency contact"}
          </a>
        )}
        <a href="tel:18002221222" style={{ ...big, background: "#fff", color: "#222", border: "2px solid #ddd" }}>Poison Control 1-800-222-1222</a>

        <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", margin: "8px 0" }}>
          <label style={{ fontSize: 15 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Hands-free (auto-advance)</label>
          <label style={{ fontSize: 15 }}><input type="checkbox" checked={muted} onChange={e => { setMuted(e.target.checked); if (e.target.checked) stop(); }} /> Mute voice</label>
          <button onClick={() => { stop(); onExit(); }} style={{ background: "none", border: 0, color: "#666", textDecoration: "underline", cursor: "pointer", fontSize: 15 }}>Exit</button>
        </div>
        <p style={{ fontSize: 12, color: "#666" }}>Informational only. Not medical advice. Always follow 911 dispatcher instructions.</p>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}} button:disabled{opacity:.4;cursor:default}`}</style>
    </main>
  );
}
