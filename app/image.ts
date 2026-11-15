"use client";
/** Shrink a photo to at most 1600px and JPEG-encode it, for sending to the AI. */
export async function prepareImage(file: File): Promise<{ data: string; mimeType: string }> {
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
