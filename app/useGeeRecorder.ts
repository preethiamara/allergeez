"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "listening" | "transcribing" | "error";

const SILENCE_MS = 1600;      // stop after this much quiet once the user has spoken
const MAX_MS = 60_000;        // hard limit per recording
const START_GRACE_MS = 6000;  // give up if nothing is said in this time
const SPEECH_LEVEL = 0.06;    // RMS level that counts as speech

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return types.find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(t)) ?? "";
}

/**
 * Records the user's voice, stops on silence, and transcribes it with ElevenLabs (via /api/transcribe).
 * `level` (0–1) drives the on-screen voice meter.
 */
export function useGeeRecorder({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelled = useRef(false);
  const cb = useRef({ onText, onError });
  cb.current = { onText, onError };

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
    setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    stop();
    cleanup();
    setState("idle");
  }, [stop, cleanup]);

  const start = useCallback(async () => {
    if (!supported) { cb.current.onError("unsupported"); return false; }
    if (rec.current && rec.current.state !== "inactive") return true;
    cancelled.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      rec.current = r;
      chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        cleanup();
        if (cancelled.current) return;
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 2000) { setState("idle"); cb.current.onError("I didn’t catch anything. Tap Gee and try again."); return; }
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, `speech.${(r.mimeType || "audio/webm").includes("mp4") ? "mp4" : "webm"}`);
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || out.error) throw new Error(out.error || `Transcription failed (${res.status})`);
          setState("idle");
          if (out.text) cb.current.onText(out.text);
          else cb.current.onError("I didn’t catch any words. Try again, a little closer to the mic.");
        } catch (e: any) {
          setState("error");
          cb.current.onError(e?.message ?? "Gee couldn’t hear that. Try again, or type instead.");
        }
      };

      // Voice meter + silence detection
      const ac = new AudioContext();
      ctx.current = ac;
      ac.resume().catch(() => {});
      const analyser = ac.createAnalyser();
      analyser.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const began = performance.now();
      let heardSpeech = false, lastLoud = began;
      // A timer (not requestAnimationFrame) so silence detection keeps working if the tab is in the background
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 6));
        const now = performance.now();
        if (rms > SPEECH_LEVEL) { heardSpeech = true; lastLoud = now; }
        const tooQuietToStart = !heardSpeech && now - began > START_GRACE_MS;
        if ((heardSpeech && now - lastLoud > SILENCE_MS) || now - began > MAX_MS || tooQuietToStart) {
          if (timer.current) clearInterval(timer.current);
          timer.current = null;
          stop();
        }
      };
      r.start(250);
      setState("listening");
      timer.current = setInterval(tick, 80);
      return true;
    } catch (e: any) {
      cleanup();
      setState("error");
      cb.current.onError(e?.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser settings, or type instead." : "Couldn’t start the microphone.");
      return false;
    }
  }, [supported, cleanup, stop]);

  useEffect(() => () => { cancelled.current = true; rec.current?.state !== "inactive" && rec.current?.stop(); cleanup(); }, [cleanup]);

  return { state, level, supported, start, stop, cancel };
}
