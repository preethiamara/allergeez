// Speech-to-text for "Talk to Gee" using ElevenLabs Scribe.
// The browser records a short clip (webm/opus in Chrome, mp4 in Safari) and posts it here as multipart form data.
const MODELS = ["scribe_v2", "scribe_v1"];
const MAX_BYTES = 15 * 1024 * 1024; // ~ several minutes of compressed audio

export const maxDuration = 60;

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is missing" }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "That recording is too long. Try a shorter one." }, { status: 413 });

  let lastError = "";
  for (const model of MODELS) {
    const body = new FormData();
    body.append("model_id", model);
    body.append("language_code", "en");
    body.append("tag_audio_events", "false");
    body.append("file", audio, (audio as File).name || "speech.webm");
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST", headers: { "xi-api-key": key }, body, signal: AbortSignal.timeout(30_000),
      });
      const text = await r.text();
      if (!r.ok) { lastError = `ElevenLabs ${r.status}: ${text.slice(0, 160)}`; console.warn("[transcribe]", model, lastError); continue; }
      const out = JSON.parse(text);
      return Response.json({ text: String(out.text ?? "").trim(), model });
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      console.warn("[transcribe]", model, lastError);
    }
  }
  return Response.json({ error: "Gee couldn’t hear that. Try again, or type instead.", detail: lastError.slice(0, 200) }, { status: 502 });
}
