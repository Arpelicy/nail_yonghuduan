import { NextRequest, NextResponse } from "next/server";
import { writeFile, readdir } from "fs/promises";
import path from "path";

const HANDS_DIR = path.join(process.cwd(), "public", "uploads", "hands");

export async function POST(req: NextRequest) {
  try {
    const { imageBase64 } = await req.json() as { imageBase64: string };
    if (!imageBase64) return NextResponse.json({ error: "missing imageBase64" }, { status: 400 });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const timestamp = Date.now();
    const filename = `hand_${timestamp}.png`;
    const filepath = path.join(HANDS_DIR, filename);
    await writeFile(filepath, buffer);

    return NextResponse.json({ url: `/uploads/hands/${filename}`, timestamp });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const files = await readdir(HANDS_DIR);
    const pngs = files.filter((f) => f.startsWith("hand_") && f.endsWith(".png"));
    if (!pngs.length) return NextResponse.json({ url: null });

    pngs.sort((a, b) => {
      const ta = parseInt(a.replace("hand_", "").replace(".png", ""), 10);
      const tb = parseInt(b.replace("hand_", "").replace(".png", ""), 10);
      return tb - ta;
    });

    return NextResponse.json({ url: `/uploads/hands/${pngs[0]}` });
  } catch {
    return NextResponse.json({ url: null });
  }
}
