"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, Icon } from "./ui";

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
  const speaking = voice === "elevenlabs" || voice === "device";
  const voiceLabel = muted ? "Voice off" : { idle: "Voice ready", loading: "Preparing voice…", elevenlabs: "Gee is speaking", device: "Speaking (device voice)" }[voice];

  return (
    <div className="screen guide-screen">
      <AppHeader title="Emergency guide" onBack={() => { stop(); onExit(); }}
        right={<a className="sos-mini" href="tel:911" aria-label="Call 911"><Icon name="phone" size={17} /></a>} />

      <div className="guide-status" aria-live="polite">
        <span className={`guide-status__dot ${speaking ? "is-speaking" : ""}`} />
        {voiceLabel}
        <label><input type="checkbox" checked={muted} onChange={e => { setMuted(e.target.checked); if (e.target.checked) stop(); }} /> Mute</label>
      </div>

      <a className="call-button guide-call" href="tel:911"><Icon name="phone" /> Call 911</a>

      {epiAt && (
        <div role="timer" className={`guide-timer ${remaining <= 0 ? "is-due" : ""}`}>
          <small>{remaining > 0 ? "Second dose may be needed in" : "5 minutes since first dose"}</small>
          <strong>{remaining > 0 ? fmt(remaining) : `+${fmt(-remaining)}`}</strong>
          {remaining <= 0 && <p>Not improving? Use a second auto-injector if you have one.</p>}
        </div>
      )}

      <section className="guide-step" aria-live="assertive">
        <div className="guide-step__progress">
          {STEPS.map((_, i) => (
            <button key={i} aria-label={`Step ${i + 1}`} onClick={() => setStep(i)} className={i <= step ? "is-done" : ""} />
          ))}
        </div>
        <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
        <h2>{s.title}</h2>
        <p className="guide-step__body">{s.body}</p>

        {s.needsChoice && (
          <div className="guide-step__choice">
            <button className="call-button" onClick={usedEpi}><Icon name="check" size={20} /> I used it</button>
            <button className="secondary-button" onClick={() => setStep(1)}>I don’t have one</button>
          </div>
        )}

        <div className="guide-step__nav">
          <button disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous step"><Icon name="back" size={20} /></button>
          <button className="is-repeat" onClick={() => speak(s.say)}><Icon name="speaker" size={20} /> Repeat</button>
          <button disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)} aria-label="Next step"><Icon name="arrow" size={20} /></button>
        </div>
      </section>

      <button className="primary-button guide-announce" onClick={announce}><Icon name="speaker" size={20} /> Announce to people nearby</button>
      {!epiAt && <button className="secondary-button" onClick={() => { setEpiAt(Date.now()); setNow(Date.now()); }}><Icon name="clock" size={19} /> Start 5-minute epinephrine timer</button>}
      {contact.phone && (
        <a className="secondary-button" href={`sms:${contact.phone}?&body=${encodeURIComponent(`I'm having an allergic reaction${trigger ? ` (possibly ${trigger})` : ""}. Please call me or come help.`)}`}>
          <Icon name="message" size={19} /> Text {contact.name || "emergency contact"}
        </a>
      )}
      <a className="secondary-button" href="tel:18002221222"><Icon name="phone" size={19} /> Poison Control 1-800-222-1222</a>

      <label className="guide-toggle"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Hands-free: move to the next step automatically</label>
      <p className="disclaimer">Informational only. Not medical advice. Always follow 911 dispatcher instructions.</p>
    </div>
  );
}
