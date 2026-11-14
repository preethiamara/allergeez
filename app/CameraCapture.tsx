"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/**
 * Live in-app camera: viewfinder + shutter. Calls onCapture with a JPEG file.
 * If the camera can't be opened (no permission, no camera, insecure origin), it explains why
 * and offers the system photo picker instead.
 */
export default function CameraCapture({ onCapture, onClose, onFallback }: {
  onCapture: (file: File) => void;
  onClose: () => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canFlip, setCanFlip] = useState(false);
  const [state, setState] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);

  const stopStream = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };

  const start = useCallback(async (mode: "environment" | "user") => {
    stopStream();
    setState("starting"); setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError(window.isSecureContext ? "This browser can’t open the camera." : "The camera only works over https or on localhost.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      setCanFlip(cams.length > 1);
      setState("ready");
    } catch (e: any) {
      setState("error");
      setError(e?.name === "NotAllowedError" ? "Camera access was blocked. Allow it in your browser settings, or choose a photo instead."
        : e?.name === "NotFoundError" ? "No camera was found on this device."
        : "Couldn’t start the camera.");
    }
  }, []);

  useEffect(() => { start(facing); return stopStream; }, [facing, start]);

  async function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true); setTimeout(() => setFlash(false), 180);
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    if (facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // match the mirrored preview
    ctx.drawImage(v, 0, 0);
    const blob: Blob | null = await new Promise(res => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return;
    stopStream();
    onCapture(new File([blob], `meal-${Date.now()}.jpg`, { type: "image/jpeg" }));
  }

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label="Take a photo">
      <video ref={videoRef} className={`camera__video ${facing === "user" ? "is-mirrored" : ""}`} playsInline muted autoPlay />
      {flash && <div className="camera__flash" />}

      <div className="camera__top">
        <button className="camera__round" onClick={() => { stopStream(); onClose(); }} aria-label="Close camera"><Icon name="close" /></button>
        <span>Snap your meal, a label, or a menu</span>
      </div>

      {state === "starting" && <p className="camera__status">Opening camera…</p>}
      {state === "error" && (
        <div className="camera__error">
          <Icon name="camera" size={30} />
          <p>{error}</p>
          <button className="primary-button" onClick={() => { stopStream(); onFallback(); }}>Choose a photo instead</button>
          <button className="text-button" onClick={() => start(facing)}>Try again</button>
        </div>
      )}

      {state !== "error" && <div className="camera__frame" aria-hidden="true" />}

      {state !== "error" && <div className="camera__bottom">
        <button className="camera__round" onClick={() => { stopStream(); onFallback(); }} aria-label="Choose from library"><Icon name="image" /></button>
        <button className="camera__shutter" onClick={capture} disabled={state !== "ready"} aria-label="Take photo"><span /></button>
        <button className="camera__round" onClick={() => setFacing(f => (f === "environment" ? "user" : "environment"))}
          disabled={!canFlip || state !== "ready"} aria-label="Switch camera"><Icon name="flip" /></button>
      </div>}
    </div>
  );
}
