import { NextRequest, NextResponse } from "next/server";

// 优先用环境变量，默认指向腾讯云公网 YOLO 服务
const NAIL_API = process.env.NAIL_API_URL ?? "http://124.220.46.84";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const res = await fetch(`${NAIL_API}/api/nail-segment`, {
      method: "POST",
      body: formData,
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
