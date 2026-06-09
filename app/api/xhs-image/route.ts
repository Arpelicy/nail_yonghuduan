import { type NextRequest, NextResponse } from "next/server";

const NAIL_API = process.env.NAIL_API_URL ?? "http://localhost:5173";

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  try {
    const upstream = await fetch(`${NAIL_API}/api/xhs-image?file=${encodeURIComponent(file)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: upstream.status });
    }
    const buf = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    return new NextResponse(buf, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
