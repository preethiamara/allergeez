export async function POST(req: Request) {
  const { text } = await req.json();
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is missing" }, { status: 500 });
  if (!text || typeof text !== "string") return Response.json({ error: "No text" }, { status: 400 });

  const call = () => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    // flash model = lowest latency, which matters in an emergency
    body: JSON.stringify({ text, model_id: "eleven_flash_v2_5", voice_settings: { stability: 0.6, similarity_boost: 0.8 } }),
    signal: AbortSignal.timeout(15_000),
  });

  try {
    let r = await call();
    if (r.status === 429) { await new Promise(res => setTimeout(res, 700)); r = await call(); } // concurrency limit on free tier
    if (!r.ok) {
      const detail = await r.text();
      console.error("[speak] ElevenLabs", r.status, detail.slice(0, 300));
      return Response.json({ error: `ElevenLabs ${r.status}`, detail: detail.slice(0, 300) }, { status: 502 });
    }
    return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[speak]", e);
    return Response.json({ error: e?.message ?? "tts failed" }, { status: 502 });
  }
}
