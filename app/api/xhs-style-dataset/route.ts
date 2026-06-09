import { NextResponse } from "next/server";

const NAIL_API = process.env.NAIL_API_URL ?? "http://localhost:5173";

export async function GET() {
  try {
    const res = await fetch(`${NAIL_API}/api/xhs-style-dataset`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
