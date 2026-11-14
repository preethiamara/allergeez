import { identifyProduct, searchFoods } from "@/lib/nutrition";

// GET /api/nutrition?q=nutella                      → text search
// GET /api/nutrition?barcode=...&brand=...&name=... → identify a product read from a photo
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = p.get("q") ?? "";
  const barcode = p.get("barcode") ?? "", brand = p.get("brand") ?? "", name = p.get("name") ?? "";
  try {
    if (barcode || brand || name) {
      if (!barcode && (brand + name).trim().length < 2) return Response.json({ error: "Not enough to identify the product" }, { status: 400 });
      return Response.json(await identifyProduct({ barcode, brand, name }));
    }
    if (q.trim().length < 2) return Response.json({ error: "Type at least 2 letters" }, { status: 400 });
    return Response.json(await searchFoods(q));
  } catch (e: any) {
    console.error("[nutrition]", e);
    return Response.json({ error: "Couldn’t reach the food database. Try again in a moment." }, { status: 502 });
  }
}
