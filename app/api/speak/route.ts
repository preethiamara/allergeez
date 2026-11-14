export async function POST(req: Request) {
  const { text } = await req.json();
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
  });
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg" } });
}
