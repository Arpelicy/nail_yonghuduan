/**
 * 服务端 AI 调用公共模块（仅在 Node.js/Route Handler 中使用，不可 import 到客户端）
 */
import sharp from "sharp";
import type { AI_TASK_CONFIG } from "@/config/ai";
import { AI_BASE } from "@/config/ai";
import { SYSTEM_TRYON } from "@/config/prompts";

// ── PNG 头解析，读取宽高 ──────────────────────────────────────────
function readPngSize(base64: string): { w: number; h: number } | null {
  try {
    const raw = base64.startsWith("data:") ? base64.split(",")[1] : base64;
    const buf = Buffer.from(raw.slice(0, 48), "base64");
    if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch { return null; }
}

// API 支持的输出档位
export const SUPPORTED_SIZES = [
  { size: "1024x1024" as const, w: 1024, h: 1024, ratio: 1 },
  { size: "1024x1536" as const, w: 1024, h: 1536, ratio: 1024 / 1536 },
  { size: "1536x1024" as const, w: 1536, h: 1024, ratio: 1536 / 1024 },
] satisfies Array<{ size: AI_TASK_CONFIG["size"]; w: number; h: number; ratio: number }>;

// 按宽高比找最近档位
export function autoSize(base64: string, fallback: AI_TASK_CONFIG["size"]): AI_TASK_CONFIG["size"] {
  const dim = readPngSize(base64);
  if (!dim) return fallback;
  const inputRatio = dim.w / dim.h;
  let best = SUPPORTED_SIZES[0];
  let bestDiff = Math.abs(inputRatio - best.ratio);
  for (const s of SUPPORTED_SIZES.slice(1)) {
    const diff = Math.abs(inputRatio - s.ratio);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best.size;
}

// edit 模式：letterbox padding 到目标尺寸，原图像素不缩放
export async function padToTarget(
  inputBuf: Buffer,
  targetW: number,
  targetH: number,
): Promise<Buffer> {
  const meta = await sharp(inputBuf).metadata();
  const srcW = meta.width  ?? targetW;
  const srcH = meta.height ?? targetH;
  if (srcW === targetW && srcH === targetH) return inputBuf;
  const left = Math.floor((targetW - srcW) / 2);
  const top  = Math.floor((targetH - srcH) / 2);
  return sharp(inputBuf)
    .extend({
      top,
      bottom: targetH - srcH - top,
      left,
      right:  targetW - srcW - left,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

// ── 核心调用 ─────────────────────────────────────────────────────
export async function callGenerate(
  images: string | string[],  // base64，单图传 string，双图传 [style, user]
  prompt: string,
  cfg: AI_TASK_CONFIG,
): Promise<string> {
  const imgList = Array.isArray(images) ? images : [images];
  const isMulti = imgList.length > 1;

  const size: AI_TASK_CONFIG["size"] = (cfg.action === "edit" && !cfg.inputFixed)
    ? autoSize(imgList[imgList.length - 1], cfg.size)
    : cfg.size;

  const target = SUPPORTED_SIZES.find((s) => s.size === size)!;

  const processedImgs = cfg.action === "edit" && !cfg.inputFixed
    ? await Promise.all(imgList.map(async (b64) => {
        const raw = b64.startsWith("data:") ? b64.split(",")[1] : b64;
        const padded = await padToTarget(Buffer.from(raw, "base64"), target.w, target.h);
        return `data:image/png;base64,${padded.toString("base64")}`;
      }))
    : imgList.map((b64) => b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);

  const userContent: object[] = [
    { type: "input_text", text: prompt },
    ...processedImgs.map((url) => ({ type: "input_image", image_url: url })),
  ];

  // aihubmix /responses 不支持 system role，统一用单条 user 消息（与 Python 脚本一致）
  const input = [{ role: "user", content: userContent }];

  const res = await fetch(`${AI_BASE.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_BASE.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      input,
      tools: [
        {
          type:       "image_generation",
          action:     cfg.action,
          size,
          quality:    cfg.quality,
          background: cfg.background,
        },
      ],
      tool_choice: { type: "image_generation" },
    }),
    signal: AbortSignal.timeout(AI_BASE.timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { output?: Array<{ type: string; result?: string }> };
  for (const item of data.output ?? []) {
    if (item.type === "image_generation_call" && item.result) return item.result;
  }
  throw new Error("No image_generation_call in response");
}
