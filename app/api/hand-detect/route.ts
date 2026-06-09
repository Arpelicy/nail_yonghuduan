import { NextRequest, NextResponse } from "next/server";

const WILOR_API = process.env.WILOR_API_URL ?? "http://localhost:8088";
const NAIL_API = process.env.NAIL_API_URL ?? "http://124.220.46.84";

export async function POST(req: NextRequest) {
  // 读一次 body，后面两条请求复用同一 ArrayBuffer 重建 FormData
  const buf = await req.arrayBuffer();
  const contentType = req.headers.get("content-type") ?? "";

  async function tryFetch(url: string) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: buf,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  // 先试本地 WiLoR
  try {
    return NextResponse.json(await tryFetch(`${WILOR_API}/api/detect`));
  } catch { /* fall through */ }

  // fallback 公网 stub
  try {
    return NextResponse.json(await tryFetch(`${NAIL_API}/api/hand-detect-clean`));
  } catch { /* fall through */ }

  return NextResponse.json({ num_hands: 0, hands: [], message: "all services unavailable" });
}
