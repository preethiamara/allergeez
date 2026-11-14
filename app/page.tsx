"use client";
import { useEffect, useState } from "react";

const STEPS = [
  "Stay calm. If you have an epinephrine auto-injector, use it now. Pull off the safety cap, press the orange tip firmly into your outer thigh, and hold for three seconds.",
  "Call 911 right now, even if you feel better after the injection.",
  "Lie down with your legs raised. If you are having trouble breathing, sit up instead.",
  "Tell someone nearby what is happening. A second injection may be needed after five minutes.",
];

export default function Home() {
  const [allergens, setAllergens] = useState("");
  const [contact, setContact] = useState({ name: "", phone: "" });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"scan" | "reaction">("scan");

  useEffect(() => {
    fetch("/api/profile").then(r => r.json()).then(p => {
      setAllergens((p.allergens ?? []).join(", "));
      setContact({ name: p.contact_name ?? "", phone: p.contact_phone ?? "" });
    }).catch(() => {});
  }, []);

  const list = () => allergens.split(",").map(s => s.trim()).filter(Boolean);
  const post = (url: string, method: string, body: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const save = () => post("/api/profile", "PUT", { allergens: list(), contact_name: contact.name, contact_phone: contact.phone });

  async function scan(file: File) {
    setBusy(true); setResult(null);
    const data = await new Promise<string>(res => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.readAsDataURL(file); });
    const r = await post("/api/scan", "POST", { image: data, mimeType: file.type, allergens: list() });
    setResult(await r.json()); setBusy(false);
  }

  async function speak(text: string) {
    const r = await post("/api/speak", "POST", { text });
    new Audio(URL.createObjectURL(await r.blob())).play();
  }

  const startReaction = () => {
    setMode("reaction");
    post("/api/profile", "POST", { suspected_trigger: "unknown" });
    speak(STEPS.join(" "));
  };

  const box = { background: "#fff", border: "1px solid #ddd", borderRadius: 12, padding: 16, marginBottom: 16 } as const;
  const btn = { padding: "12px 18px", borderRadius: 10, border: 0, background: "#222", color: "#fff", fontSize: 16, cursor: "pointer" } as const;
  const link = { ...btn, display: "block", textAlign: "center", textDecoration: "none", marginBottom: 8 } as const;

  if (mode === "reaction") return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
      <h1 style={{ color: "#b00020" }}>Reaction mode</h1>
      <a href="tel:911" style={{ ...link, background: "#b00020", fontSize: 24, padding: 24 }}>Call 911</a>
      <ol style={{ fontSize: 18, lineHeight: 1.5 }}>{STEPS.map(s => <li key={s}>{s}</li>)}</ol>
      {contact.phone && <a href={`sms:${contact.phone}?body=${encodeURIComponent("I may be having an allergic reaction. Please call me or come help.")}`} style={link}>Text {contact.name || "emergency contact"}</a>}
      <a href="tel:18002221222" style={{ ...link, background: "#555" }}>Poison Control 1-800-222-1222</a>
      <button style={btn} onClick={() => speak(STEPS.join(" "))}>Repeat instructions</button>{" "}
      <button style={{ ...btn, background: "#999" }} onClick={() => setMode("scan")}>Back</button>
      <p style={{ fontSize: 12, color: "#666" }}>Informational only. Not medical advice. In an emergency call 911.</p>
    </main>
  );

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
        <input type="file" accept="image/*" capture="environment" onChange={e => e.target.files?.[0] && scan(e.target.files[0])} />
        {busy && <p>Reading label...</p>}
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
