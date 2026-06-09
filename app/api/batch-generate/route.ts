import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, readdir } from "fs/promises";
import path from "path";
import { callGenerate } from "@/lib/ai-server";
import {
  PROMPT_FULL_TRYON_KEEP,
  CONFIG_FULL_TRYON_KEEP,
} from "@/config/prompts";

export const maxDuration = 300;

const HANDS_DIR   = path.join(process.cwd(), "public", "uploads", "hands");
const RESULTS_DIR = path.join(process.cwd(), "public", "uploads", "results");
const INDEX_FILE  = path.join(RESULTS_DIR, "index.json");

// ── helpers ──────────────────────────────────────────────────────────────────

async function latestHandBase64(): Promise<string | null> {
  try {
    const files = (await readdir(HANDS_DIR))
      .filter((f) => f.startsWith("hand_") && f.endsWith(".png"))
      .sort((a, b) => {
        const ta = parseInt(a.slice(5, -4), 10);
        const tb = parseInt(b.slice(5, -4), 10);
        return tb - ta;
      });
    if (!files.length) return null;
    const buf = await readFile(path.join(HANDS_DIR, files[0]));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch { return null; }
}

async function readIndex(): Promise<Record<string, { url: string; ts: number; name: string }>> {
  try {
    return JSON.parse(await readFile(INDEX_FILE, "utf-8")) as Record<string, { url: string; ts: number; name: string }>;
  } catch { return {}; }
}

async function writeIndex(idx: Record<string, { url: string; ts: number; name: string }>) {
  await writeFile(INDEX_FILE, JSON.stringify(idx, null, 2));
}

// ── POST: generate try-on for each styleId ────────────────────────────────────

interface GenerateRequest {
  styles: Array<{ id: string; name: string; imageBase64: string }>;
}

export async function POST(req: NextRequest) {
  const { styles } = await req.json() as GenerateRequest;
  if (!styles?.length) return NextResponse.json({ error: "no styles" }, { status: 400 });

  const handBase64 = await latestHandBase64();
  if (!handBase64) return NextResponse.json({ error: "手图未上传，请先上传手图" }, { status: 400 });

  const idx = await readIndex();
  const results: Array<{ id: string; name: string; url: string }> = [];

  for (const style of styles) {
    try {
      const resultBase64 = await callGenerate(
        [style.imageBase64, handBase64],
        PROMPT_FULL_TRYON_KEEP,
        CONFIG_FULL_TRYON_KEEP,
      );
      const ts = Date.now();
      const filename = `result_${style.id}_${ts}.png`;
      const filepath = path.join(RESULTS_DIR, filename);
      await writeFile(filepath, Buffer.from(resultBase64, "base64"));
      const url = `/uploads/results/${filename}`;
      idx[style.id] = { url, ts, name: style.name };
      results.push({ id: style.id, name: style.name, url });
    } catch (e) {
      results.push({ id: style.id, name: style.name, url: "" });
      console.error(`batch-generate error for ${style.id}:`, e);
    }
  }

  await writeIndex(idx);
  return NextResponse.json({ results });
}

// ── GET: return current index ─────────────────────────────────────────────────

export async function GET() {
  const idx = await readIndex();
  return NextResponse.json({ results: idx });
}
