"use client";
import { useEffect, useRef, useState } from "react";
import Emergency, { unlockEmergencyAudio } from "./Emergency";

export default function Home() {
  const [allergens, setAllergens] = useState("");
  const [contact, setContact] = useState({ name: "", phone: "" });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"scan" | "reaction">("scan");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);

  useEffect(() => {
    fetch("/api/profile").then(r => r.json()).then(p => {
      setAllergens((p.allergens ?? []).join(", "));
      setContact({ name: p.contact_name ?? "", phone: p.contact_phone ?? "" });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (camOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [camOn]);

  const list = () => allergens.split(",").map(s => s.trim()).filter(Boolean);
  const post = (url: string, method: string, body: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const save = () => post("/api/profile", "PUT", { allergens: list(), contact_name: contact.name, contact_phone: contact.phone });

  // Phone photos are often 4-12 MB; shrink to a JPEG Gemini reads quickly. Falls back to the raw file.
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

  async function scan(file: File) {
    setBusy(true); setResult(null); setError("");
    try {
      const { data, mimeType } = await prepareImage(file);
      const r = await post("/api/scan", "POST", { image: data, mimeType, allergens: list() });
      const json = await r.json().catch(() => ({ error: `Server returned ${r.status}` }));
      if (!r.ok || json.error) throw new Error(json.error || `Scan failed (${r.status})`);
      setResult(json);
    } catch (e: any) {
      setError(e?.message ?? "Scan failed");
    } finally {
      setBusy(false);
    }
  }

  async function openCamera() {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      setCamOn(true);
    } catch { alert("Camera unavailable. Allow camera access, or use the upload option."); }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  async function capture() {
    const v = videoRef.current!;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const blob: Blob = await new Promise(res => c.toBlob(b => res(b!), "image/jpeg", 0.85));
    closeCamera();
    scan(new File([blob], "capture.jpg", { type: "image/jpeg" }));
  }

  const trigger: string | undefined = result?.flags?.[0]?.allergen;
  const startReaction = () => {
    unlockEmergencyAudio(); // must run inside the click so the browser allows audio
    setMode("reaction");
    post("/api/profile", "POST", { suspected_trigger: trigger ?? "unknown" }).catch(() => {});
  };

  const box = { background: "#fff", border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 } as const;
  const btn = { padding: "12px 18px", borderRadius: 10, border: 0, background: "#222", color: "#fff", fontSize: 16, cursor: "pointer" } as const;

  if (mode === "reaction") return <Emergency contact={contact} trigger={trigger} onExit={() => setMode("scan")} />;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <h1>AllergyAid</h1>
      <button onClick={startReaction} style={{ ...btn, background: "#b00020", width: "100%", fontSize: 20, padding: 20, marginBottom: 16 }}>I'm having a reaction</button>
      <section style={box}>
        <h3>My allergies</h3>
        <input style={{ width: "100%", padding: 8 }} placeholder="peanuts, milk, shellfish" value={allergens} onChange={e => setAllergens(e.target.value)} />
        <input style={{ width: "100%", padding: 8, marginTop: 8 }} placeholder="Emergency contact name" value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })} />
        <input style={{ width: "100%", padding: 8, marginTop: 8 }} placeholder="Emergency contact phone" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} />
        <button style={{ ...btn, marginTop: 8 }} onClick={save}>Save</button>
      </section>
      <section style={box}>
        <h3>Scan a label or menu</h3>
        {camOn ? (
          <div>
            <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 10 }} />
            <button style={btn} onClick={capture}>Take photo</button>{" "}
            <button style={{ ...btn, background: "#999" }} onClick={closeCamera}>Cancel</button>
          </div>
        ) : (
          <>
            <button style={btn} onClick={openCamera}>Open camera</button>
            <p style={{ margin: "8px 0 4px" }}>or upload a photo:</p>
            <input type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && scan(e.target.files[0])} />
          </>
        )}
        {busy && <p>Reading label...</p>}
        {error && <p role="alert" style={{ color: "#b00020", background: "#fff0f0", padding: 10, borderRadius: 8 }}>{error}</p>}
        {result && (
          <div>
            <h2 style={{ color: result.safe ? "#1b7f3b" : "#b00020" }}>{result.safe ? "No flagged allergens found" : "Possible allergen risk"}</h2>
            {result.flags?.map((f: any, i: number) => <p key={i}><b>{f.ingredient}</b> ({f.allergen}): {f.reason}</p>)}
            <p style={{ fontSize: 14 }}>{result.note}</p>
            <details><summary>All ingredients</summary>{result.ingredients?.join(", ")}</details>
          </div>
        )}
      </section>
      <p style={{ fontSize: 12, color: "#666" }}>Informational only. Not medical advice.</p>
    </main>
  );
}
