import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile } from "fs/promises";
import path from "path";

const RESULTS_DIR = path.join(process.cwd(), "public", "uploads", "results");
const INDEX_FILE  = path.join(RESULTS_DIR, "index.json");

type Index = Record<string, { url: string; ts: number; name: string; status: "done" | "generating" | "failed" }>;

async function readIndex(): Promise<Index> {
  try { return JSON.parse(await readFile(INDEX_FILE, "utf-8")) as Index; }
  catch { return {}; }
}
async function saveIndex(idx: Index) {
  await writeFile(INDEX_FILE, JSON.stringify(idx, null, 2));
}

// POST — save one result (called from client after each nail-tryon completes)
export async function POST(req: NextRequest) {
  const { styleId, name, imageBase64, status } = await req.json() as {
    styleId: string; name: string; imageBase64?: string; status: "done" | "generating" | "failed";
  };
  const idx = await readIndex();
  const ts = Date.now();

  if (status === "done" && imageBase64) {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const filename = `result_${styleId}_${ts}.png`;
    await writeFile(path.join(RESULTS_DIR, filename), Buffer.from(base64Data, "base64"));
    idx[styleId] = { url: `/api/uploads/results/${filename}`, ts, name, status: "done" };
  } else {
    idx[styleId] = { url: idx[styleId]?.url ?? "", ts, name, status };
  }

  await saveIndex(idx);
  return NextResponse.json({ ok: true, entry: idx[styleId] });
}

// GET — return full index
export async function GET() {
  return NextResponse.json(await readIndex());
}
