import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

import { callGenerate } from "@/lib/ai-server";
import { PROMPT_BOX, PROMPT_EXTRACT, CONFIG_BOX, CONFIG_EXTRACT } from "@/config/prompts";

// 两步 AI pipeline 各最多 2 分钟，总计最长 5 分钟
export const maxDuration = 300;

// 缓存 key = 文件名（去扩展名后 slug 化），同名图片直接命中缓存，无时间戳
export async function POST(req: NextRequest) {
  let file: File | null = null;
  let originalName = "style";
  try {
    const fd = await req.formData();
    file = fd.get("file") as File | null;
    originalName = (fd.get("name") as string | null) ?? "style";
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  // slug = 原文件名去扩展名，只保留字母数字下划线连字符，最长 60 字符
  const slug = originalName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]/gi, "_")
    .slice(0, 60);

  const libDir       = path.join(process.cwd(), "public", "style-library");
  const detectedDir  = path.join(libDir, "detected");
  const extractedDir = path.join(libDir, "extracted");
  await mkdir(detectedDir,  { recursive: true });
  await mkdir(extractedDir, { recursive: true });

  const detectedPath  = path.join(detectedDir,  `${slug}-detected.png`);
  const extractedPath = path.join(extractedDir, `${slug}-extracted.png`);

  // ── 缓存命中：同名文件已存在，直接返回 ──
  if (existsSync(detectedPath) && existsSync(extractedPath)) {
    const [detectedBuf, extractedBuf] = await Promise.all([
      readFile(detectedPath),
      readFile(extractedPath),
    ]);
    return NextResponse.json({
      slug,
      cached: true,
      detectedUrl:     `/style-library/detected/${slug}-detected.png`,
      extractedUrl:    `/style-library/extracted/${slug}-extracted.png`,
      detectedDataUrl: `data:image/png;base64,${detectedBuf.toString("base64")}`,
      extractedDataUrl:`data:image/png;base64,${extractedBuf.toString("base64")}`,
    });
  }

  // ── 缓存未命中：走 AI 两步 pipeline ──
  const inputBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  // Step 1：AI 在款式图上标注指甲红框
  let detectedBase64: string;
  try {
    detectedBase64 = await callGenerate(inputBase64, PROMPT_BOX, CONFIG_BOX);
  } catch (err) {
    return NextResponse.json({ error: `Step 1 failed: ${String(err)}` }, { status: 502 });
  }
  await writeFile(detectedPath, Buffer.from(detectedBase64, "base64"));

  // Step 2：AI 用标注图还原透明背景正视款式图
  let extractedBase64: string;
  try {
    extractedBase64 = await callGenerate(detectedBase64, PROMPT_EXTRACT, CONFIG_EXTRACT);
  } catch (err) {
    return NextResponse.json({ error: `Step 2 failed: ${String(err)}` }, { status: 502 });
  }
  await writeFile(extractedPath, Buffer.from(extractedBase64, "base64"));

  return NextResponse.json({
    slug,
    cached: false,
    detectedUrl:     `/style-library/detected/${slug}-detected.png`,
    extractedUrl:    `/style-library/extracted/${slug}-extracted.png`,
    detectedDataUrl: `data:image/png;base64,${detectedBase64}`,
    extractedDataUrl:`data:image/png;base64,${extractedBase64}`,
  });
}
