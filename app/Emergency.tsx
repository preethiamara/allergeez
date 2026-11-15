"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, Buddy, Icon } from "./ui";
import { useGeeRecorder } from "./useGeeRecorder";
import { isSerious } from "@/lib/symptoms";

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
    body: "Tell a person nearby what is happening. Unlock the door so responders can get in. If you stop responding, Gee will sound an alarm so people nearby come to help.",
    say: "Get someone to stay with you. Tell them you're having an allergic reaction. If you can, unlock the door for the paramedics.",
  },
  {
    title: "Watch the timer",
    body: "If symptoms don't improve 5 minutes after the first dose, use a second auto-injector if you have one. Stay lying down until help arrives.",
    say: "Keep watching the timer. If you are not getting better five minutes after the first dose, use a second auto-injector if you have one. Stay lying down until help arrives. You're doing the right things.",
  },
];

const EPI_SECONDS = 5 * 60;
const CHECK_IN_AFTER = 60;   // seconds with no tap / typing / speaking before Gee asks "Are you okay?"
const ALARM_AFTER = 20;      // more seconds without an answer before the alarm sounds
const ALARM_MAX = 2 * 60;    // the siren turns itself off after this long (the help card stays on screen)

// ---------- alarm siren (Web Audio: loud, works without any audio file) ----------
// Kept on window (not module variables) so a live code reload can't leave an old siren running that
// the new code can't reach. Stopping pauses the whole audio context, which silences ANY siren on it.
type AlarmState = { ctxs: AudioContext[]; stops: Set<() => void>; vib?: ReturnType<typeof setInterval> };
const alarm = (): AlarmState => {
  const w = window as any;
  return (w.__allergeezAlarm ??= { ctxs: [], stops: new Set() });
};
function ctx(): AudioContext | null {
  try {
    const a = alarm();
    let ac = a.ctxs.find(c => c.state !== "closed");
    if (!ac) { ac = new (window.AudioContext || (window as any).webkitAudioContext)(); a.ctxs.push(ac); }
    return ac;
  } catch { return null; }
}
/** Silence every siren and the vibration, no matter which code started them. */
export function stopAllSirens() {
  if (typeof window === "undefined") return;
  const a = alarm();
  for (const s of [...a.stops]) { try { s(); } catch {} }
  a.stops.clear();
  if (a.vib) { clearInterval(a.vib); a.vib = undefined; }
  for (const c of a.ctxs) { try { if (c.state === "running") c.suspend(); } catch {} } // pauses all sound on the context
  try { navigator.vibrate?.(0); } catch {}
}

/** Start a two-tone siren (only one at a time); returns a function that stops it. */
function startSiren(): () => void {
  stopAllSirens();
  const a = alarm();
  a.vib = setInterval(() => { try { navigator.vibrate?.([600, 200, 600]); } catch {} }, 1500);
  const ac = ctx();
  if (!ac) return stopAllSirens;
  ac.resume().catch(() => {});
  const gain = ac.createGain();
  gain.gain.value = 0.9;
  gain.connect(ac.destination);
  const osc = ac.createOscillator();
  osc.type = "square";
  osc.connect(gain);
  let stopped = false;
  const sweep = () => {
    if (stopped) return;
    const t = ac.currentTime;
    for (let i = 0; i < 4; i++) {           // hi-lo siren, re-scheduled every 2 seconds
      osc.frequency.setValueAtTime(960, t + i * 0.5);
      osc.frequency.setValueAtTime(640, t + i * 0.5 + 0.25);
    }
  };
  sweep();
  const loop = setInterval(sweep, 2000);
  osc.start();
  const stopThis = () => {
    if (stopped) return;
    stopped = true; clearInterval(loop);
    a.stops.delete(stopThis);
    try { gain.gain.cancelScheduledValues(ac.currentTime); gain.gain.setValueAtTime(0, ac.currentTime); } catch {}
    try { osc.stop(); } catch {}
    try { osc.disconnect(); gain.disconnect(); } catch {}
  };
  a.stops.add(stopThis);
  return stopAllSirens;
}

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
  try { const ac = ctx(); ac?.resume().then(() => ac.suspend()).catch(() => {}); } catch {} // unlock Web Audio inside the tap, then stay quiet
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

  // ---------- the Gee chat: everything Gee says shows up as a bubble, everything they say/type too ----------
  type Msg = { id: number; who: "gee" | "you"; text: string };
  const [chat, setChat] = useState<Msg[]>([]);
  const msgId = useRef(0);
  const addMsg = useCallback((who: Msg["who"], text: string) => {
    setChat(c => (who === "gee" && c[c.length - 1]?.who === "gee" && c[c.length - 1].text === text ? c : [...c, { id: ++msgId.current, who, text }].slice(-30)));
  }, []);
  /** Gee says something: show it in the chat and speak it. */
  const geeSay = useCallback((text: string) => { addMsg("gee", text); return speak(text); }, [addMsg, speak]);

  // Speak each step when it becomes current; auto-advance hands-free.
  const skipStepSpeech = useRef(false);
  useEffect(() => {
    if (skipStepSpeech.current) { skipStepSpeech.current = false; return; } // Gee is answering what they said instead
    let cancelled = false;
    geeSay(STEPS[step].say).then(finished => {
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
      geeSay("It has been five minutes since your first epinephrine dose. If you are not getting better, use a second auto-injector now if you have one, and make sure nine one one is on the way.");
    }
  }, [epiAt, remaining, geeSay]);

  // Keep the screen awake while in emergency mode.
  useEffect(() => {
    let lock: any;
    (navigator as any).wakeLock?.request("screen").then((l: any) => (lock = l)).catch(() => {});
    return () => { lock?.release?.(); stop(); };
  }, [stop]);

  // Keyboard: space repeat, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack keys while they're typing to Gee (this used to swallow spaces)
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === " ") { e.preventDefault(); speak(STEPS[step].say); }
      if (e.key === "ArrowRight") setStep(s => Math.min(STEPS.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep(s => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, speak]);

  const usedEpi = () => { if (!epiAt) { setEpiAt(Date.now()); setNow(Date.now()); } setStep(1); };

  // ---------- inactivity watch: check in, then sound an alarm if they stop responding ----------
  const [watchOn, setWatchOn] = useState(true);
  const [phase, setPhase] = useState<"ok" | "checking" | "alarm">("ok");
  const [sirenOn, setSirenOn] = useState(false);
  const [alarmAt, setAlarmAt] = useState<number | null>(null);
  const [idle, setIdle] = useState(0);
  const lastActive = useRef(Date.now());
  const sirenStop = useRef<(() => void) | null>(null);
  const phaseRef = useRef(phase); phaseRef.current = phase;

  /** Any tap, key, typing or speaking means they're responsive. (During the alarm only the stop button counts.) */
  const markActive = useCallback(() => {
    if (phaseRef.current === "alarm") return;
    lastActive.current = Date.now();
    setIdle(0);
    if (phaseRef.current === "checking") setPhase("ok");
  }, []);

  useEffect(() => {
    const on = () => markActive();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
  }, [markActive]);

  useEffect(() => {
    const t = setInterval(() => {
      const secs = Math.floor((Date.now() - lastActive.current) / 1000);
      setIdle(secs);
      if (!watchOn || phaseRef.current === "alarm") return;
      if (phaseRef.current === "ok" && secs >= CHECK_IN_AFTER) {
        setPhase("checking");
        geeSay("Are you okay? Tap the screen, or say something, so I know you're all right.");
      } else if (phaseRef.current === "checking" && secs >= CHECK_IN_AFTER + ALARM_AFTER) {
        stop();
        setPhase("alarm");
        setAlarmAt(Date.now());
        sirenStop.current = startSiren();
        setSirenOn(true);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [watchOn, geeSay, stop]);

  const silence = useCallback(() => { stopAllSirens(); sirenStop.current = null; setSirenOn(false); }, []);
  const stopAlarm = () => {
    silence();
    setAlarmAt(null);
    lastActive.current = Date.now(); setIdle(0);
    setPhase("ok");
    geeSay("Okay, the alarm is off. If you can, call nine one one. I'm still here with you.");
  };
  // The siren turns itself off after ALARM_MAX; the help card stays up (silently) until someone taps "I'm OK"
  useEffect(() => {
    if (!sirenOn || !alarmAt) return;
    const t = setTimeout(silence, Math.max(0, alarmAt + ALARM_MAX * 1000 - Date.now()));
    return () => clearTimeout(t);
  }, [sirenOn, alarmAt, silence]);
  // Leaving the guide, hiding the tab or closing the page always silences it
  useEffect(() => {
    const off = () => stopAllSirens();
    window.addEventListener("pagehide", off);
    return () => { window.removeEventListener("pagehide", off); stopAllSirens(); };
  }, []);

  // ---------- "Tell Gee what's happening": they can say (or type) anything ----------
  const [typed, setTyped] = useState("");
  const [voiceErr, setVoiceErr] = useState("");
  const epiRef = useRef(epiAt); epiRef.current = epiAt;
  const stepRef = useRef(step); stepRef.current = step;
  const goStep = (n: number) => { if (n !== stepRef.current) { skipStepSpeech.current = true; setStep(n); } };

  const [geeThinking, setGeeThinking] = useState(false);
  const chatRef = useRef<Msg[]>([]); chatRef.current = chat;

  const applyAction = useCallback((action: string) => {
    const hadEpi = !!epiRef.current;
    if (action === "epi_used") { if (!hadEpi) { setEpiAt(Date.now()); setNow(Date.now()); } goStep(1); }
    else if (action === "no_epi") goStep(1);
    else if (action === "serious") goStep(hadEpi ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaid = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    markActive();
    setVoiceErr("");
    addMsg("you", text);
    const t = text.toLowerCase();
    const hadEpi = !!epiRef.current;
    // The most urgent phrases are answered instantly on the device (no waiting on the network)
    if (/\b(no|don'?t have|dont have|haven'?t got|without)\b.*\b(epi|epipen|pen|injector|auvi)/.test(t)) {
      applyAction("no_epi");
      geeSay("Okay. Call nine one one now and tell them you don't have epinephrine. Lie down and stay still.");
      return;
    }
    if (/\b(used|gave|did|injected|took|done)\b.*\b(epi|epipen|pen|shot|injector|injection|auvi)|\bi (used|did) it\b/.test(t)) {
      applyAction("epi_used");
      geeSay("Good job. I've started the five minute timer. Now call nine one one if you haven't already.");
      return;
    }
    if (isSerious(text)) {
      applyAction("serious");
      geeSay(hadEpi
        ? "That sounds serious. Make sure nine one one is on the way. If it has been five minutes since your first dose, use a second auto-injector if you have one."
        : "That sounds serious. Use your epinephrine now if you have it, then call nine one one.");
      return;
    }
    // Everything else (questions, how they feel, background noise): Gee answers with their real data
    setGeeThinking(true);
    try {
      const r = await fetch("/api/gee/sos", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          said: text, history: chatRef.current.slice(-10), step: STEPS[stepRef.current].title,
          epiMinutes: epiRef.current ? Math.floor((Date.now() - epiRef.current) / 60000) : null,
        }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.reply) throw new Error(out.error || "no reply");
      applyAction(out.action);
      geeSay(out.reply);
    } catch {
      // Offline / AI down: a simple, safe reply
      geeSay(/\b(worse|spreading|getting bad|can'?t|cannot)\b/.test(t)
        ? "I hear you. Tell the nine one one dispatcher it's getting worse. If it has been five minutes since your first dose, use a second auto-injector if you have one."
        : /\b(better|improving|easing|calmer|fine now|okay now|ok now)\b/.test(t)
          ? "I'm glad it's easing. Symptoms can come back, so stay lying down and keep nine one one on the way."
          : "Got it, I've written that down. Tell the nine one one dispatcher too, and keep following the steps.");
    } finally { setGeeThinking(false); }
  }, [markActive, addMsg, geeSay, applyAction]);

  // Keep the newest message in view
  const chatEl = useRef<HTMLDivElement>(null);
  useEffect(() => { chatEl.current?.scrollTo({ top: chatEl.current.scrollHeight, behavior: "smooth" }); }, [chat, geeThinking]);

  const recorder = useGeeRecorder({ onText: handleSaid, onError: m => setVoiceErr(m === "unsupported" ? "Voice isn’t available in this browser. Type instead." : m) });
  const talk = () => {
    markActive();
    if (recorder.state === "listening") { recorder.stop(); return; }
    if (recorder.state === "transcribing") return; // still writing down what they just said
    stop(); // don't record Gee's own voice
    recorder.start();
  };

  const s = STEPS[step];
  const speaking = voice === "elevenlabs" || voice === "device";

  return (
    <div className="screen guide-screen guide-fit">
      <AppHeader title="Emergency guide" onBack={() => { stop(); onExit(); }}
        right={<a className="sos-mini" href="tel:911" aria-label="Call 911"><Icon name="phone" size={17} /></a>} />

      {/* Gee, front and center: tap to talk */}
      <section className="guide-gee">
        <button className={`gee-voice-orb gee-voice-orb--small ${recorder.state === "listening" ? "is-listening" : ""} ${speaking ? "is-speaking" : ""}`}
          onClick={talk}
          aria-label={recorder.state === "listening" ? "Stop and send what I said" : "Talk to Gee"}>
          <Buddy />
          <span className="gee-microphone"><Icon name={speaking ? "speaker" : "microphone"} size={20} strokeWidth={2.1} /></span>
        </button>
        <p className="eyebrow">{muted ? "Gee is muted" : recorder.state === "listening" ? "Gee is listening" : recorder.state === "transcribing" ? "Writing it down" : geeThinking ? "Gee is thinking" : speaking ? "Gee is talking" : voice === "loading" ? "Gee is getting ready" : "Gee is here"}</p>
        <p className="gee-chat-hero__hint">{recorder.state === "listening" ? "Speak naturally. I’ll stop when you pause." : speaking ? "Tap me to answer." : "Tap me to talk, or type below."}</p>
        <span className={`voice-wave voice-wave--inline ${recorder.state === "listening" && !recorder.level ? "is-active" : ""}`} aria-hidden="true">
          {[0.55, 0.85, 1, 0.85, 0.55].map((k, i) => (
            <i key={i} style={recorder.state === "listening" ? { height: `${6 + Math.round(recorder.level * 24 * k)}px`, transition: "height .08s" } : undefined} />
          ))}
        </span>
      </section>

      <div className="guide-calls">
        <a className="call-button guide-call" href="tel:911"><Icon name="phone" /> Call 911</a>
        {contact.phone && (
          <a className="secondary-button guide-text" aria-label={`Text ${contact.name || "emergency contact"}`}
            href={`sms:${contact.phone}?&body=${encodeURIComponent(`I'm having an allergic reaction${trigger ? ` (possibly ${trigger})` : ""}. Please call me or come help.`)}`}>
            <Icon name="message" size={19} /> Text {contact.name?.split(" ")[0] || "contact"}
          </a>
        )}
      </div>

      {epiAt && (
        <div role="timer" className={`guide-timer guide-timer--row ${remaining <= 0 ? "is-due" : ""}`}>
          <small>{remaining > 0 ? "Second dose may be needed in" : "5 min since first dose: not better? Use a second auto-injector."}</small>
          <strong>{remaining > 0 ? fmt(remaining) : `+${fmt(-remaining)}`}</strong>
        </div>
      )}

      <section className="guide-step guide-step--compact" aria-live="assertive">
        <div className="guide-step__progress">
          {STEPS.map((_, i) => (
            <button key={i} aria-label={`Step ${i + 1}`} onClick={() => setStep(i)} className={i <= step ? "is-done" : ""} />
          ))}
        </div>
        <div className="guide-step__row">
          <button disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Previous step"><Icon name="back" size={18} /></button>
          <div>
            <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
            <h2>{s.title}</h2>
          </div>
          <button disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)} aria-label="Next step"><Icon name="arrow" size={18} /></button>
        </div>
        <p className="guide-step__body">{s.body}</p>
        {s.needsChoice && (
          <div className="guide-step__choice">
            <button className="call-button" onClick={usedEpi}><Icon name="check" size={18} /> I used it</button>
            <button className="secondary-button" onClick={() => setStep(1)}>I don’t have one</button>
          </div>
        )}
      </section>

      {/* The conversation takes whatever room is left and scrolls inside itself, so the page never does */}
      <div className="gee-chat gee-sos__chat guide-fit__chat" ref={chatEl} aria-live="polite">
        {chat.map(m => (
          <div key={m.id} className={`gee-msg gee-msg--${m.who === "gee" ? "assistant" : "user"}`}>
            {m.who === "gee" && <Buddy small />}
            <p>{m.text}</p>
            {m.who === "gee" && (
              <button className="gee-sos__replay" onClick={() => { markActive(); speak(m.text); }} aria-label="Say that again"><Icon name="speaker" size={15} /></button>
            )}
          </div>
        ))}
        {recorder.state === "transcribing" && <div className="gee-msg gee-msg--user gee-msg--typing"><p><i /><i /><i /></p></div>}
        {geeThinking && <div className="gee-msg gee-msg--assistant gee-msg--typing"><Buddy small /><p><i /><i /><i /></p></div>}
      </div>

      <form className="gee-chat-input" onSubmit={e => { e.preventDefault(); handleSaid(typed); setTyped(""); }}>
        <input value={typed} onChange={e => { setTyped(e.target.value); markActive(); }} placeholder="Tell Gee what’s happening…" aria-label="Type what's happening" />
        <button type="submit" disabled={!typed.trim()} aria-label="Send"><Icon name="arrow" size={18} strokeWidth={2.2} /></button>
      </form>
      {voiceErr && <p className="save-error guide-fit__err">{voiceErr}</p>}

      <div className="guide-chips" aria-label="Guide settings">
        {!epiAt && <button onClick={() => { setEpiAt(Date.now()); setNow(Date.now()); }}><Icon name="clock" size={14} /> Dose timer</button>}
        <label className={auto ? "is-on" : ""}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Hands-free</label>
        <label className={watchOn ? "is-on" : ""} title="Sound an alarm if I stop responding">
          <input type="checkbox" checked={watchOn} onChange={e => { setWatchOn(e.target.checked); markActive(); }} />
          Alarm{watchOn && phase === "ok" ? ` · ${fmt(Math.max(0, CHECK_IN_AFTER - idle))}` : ""}
        </label>
        <label className={muted ? "is-on" : ""}><input type="checkbox" checked={muted} onChange={e => { setMuted(e.target.checked); if (e.target.checked) stop(); }} /> Mute</label>
      </div>
      <p className="disclaimer guide-fit__disclaimer">Not medical advice. Always follow 911 dispatcher instructions.</p>

      {phase === "checking" && (
        <div className="guide-checkin" role="alertdialog" aria-labelledby="checkin-title">
          <div>
            <h2 id="checkin-title">Are you okay?</h2>
            <p>The alarm will sound in {Math.max(0, CHECK_IN_AFTER + ALARM_AFTER - idle)} seconds unless you respond.</p>
            <button className="call-button" onClick={markActive}><Icon name="check" size={22} /> I’m OK</button>
          </div>
        </div>
      )}

      {phase === "alarm" && (
        <div className={`guide-alarm ${sirenOn ? "" : "is-silent"}`} role="alertdialog" aria-labelledby="alarm-title">
          <div className="guide-alarm__card">
            <Icon name="sos" size={72} />
            <h2 id="alarm-title">This person needs help</h2>
            <p>They’re having a severe allergic reaction{trigger ? ` (possibly to ${trigger})` : ""} and stopped responding.</p>
            <ol>
              <li><strong>Call 911</strong> now.</li>
              <li>If they have an <strong>EpiPen</strong>: pull off the blue cap, press the orange tip into the outer thigh, hold 3 seconds.</li>
              <li>Lay them down with legs raised (on their side if vomiting). Stay with them.</li>
            </ol>
            <a className="call-button guide-alarm__call" href="tel:911"><Icon name="phone" /> Call 911</a>
            {contact.phone && <a className="secondary-button" href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}><Icon name="phone" size={19} /> Call {contact.name || "emergency contact"}</a>}
            <p className="guide-alarm__status">{sirenOn
              ? `Alarm sounding · turns off by itself in ${fmt(Math.max(0, Math.ceil(((alarmAt ?? Date.now()) + ALARM_MAX * 1000 - Date.now()) / 1000)))}` /* re-renders every second via the idle ticker */
              : "Alarm sound stopped after 2 minutes"}</p>
            <button className="guide-alarm__stop" onClick={stopAlarm}>{sirenOn ? "I’m OK — stop the alarm" : "I’m OK — close"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
