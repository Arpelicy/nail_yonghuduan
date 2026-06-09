import { NextRequest, NextResponse } from "next/server";
import { callGenerate } from "@/lib/ai-server";

export const maxDuration = 300;
import type { AI_TASK_CONFIG } from "@/config/ai";
import {
  PROMPT_TRANSFER,        CONFIG_TRANSFER,
  PROMPT_FULL_TRYON,      CONFIG_FULL_TRYON,
  PROMPT_FULL_TRYON_KEEP, CONFIG_FULL_TRYON_KEEP,
  PROMPT_LENGTH,          CONFIG_LENGTH,
} from "@/config/prompts";

// ── 4 种试戴模式 ─────────────────────────────────────────────────
// transfer  → 模式 A：甲面迁移（保持甲型），图1=detected带框款式手图
// full      → 模式 B1：完整试戴（可调甲型），图1=美甲款式图
// full_keep → 模式 B2：完整试戴（保持甲型），图1=美甲款式图
// length    → 模式 C：长度延长，图1=detected带框款式手图
type TryonMode = "transfer" | "full" | "full_keep" | "length";

interface TryonRequest {
  styleImageBase64: string;  // 图1（款式参考）
  handImageBase64:  string;  // 图2（用户手图，已裁为 1024×1536）
  mode: TryonMode;
}

export async function POST(req: NextRequest) {
  let body: TryonRequest;
  try {
    body = await req.json() as TryonRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { styleImageBase64, handImageBase64, mode } = body;
  if (!styleImageBase64 || !handImageBase64) {
    return NextResponse.json(
      { error: "styleImageBase64 and handImageBase64 are required" },
      { status: 400 },
    );
  }

  // 根据模式选提示词和配置
  let prompt: string;
  let cfg: AI_TASK_CONFIG;
  switch (mode) {
    case "transfer":
      prompt = PROMPT_TRANSFER;
      cfg    = CONFIG_TRANSFER;
      break;
    case "full_keep":
      prompt = PROMPT_FULL_TRYON_KEEP;
      cfg    = CONFIG_FULL_TRYON_KEEP;
      break;
    case "length":
      prompt = PROMPT_LENGTH;
      cfg    = CONFIG_LENGTH;
      break;
    default:  // "full"
      prompt = PROMPT_FULL_TRYON;
      cfg    = CONFIG_FULL_TRYON;
      break;
  }

  let resultBase64: string;
  try {
    // 图1=款式参考，图2=用户手图（SYSTEM_TRYON 约定顺序）
    resultBase64 = await callGenerate(
      [styleImageBase64, handImageBase64],
      prompt,
      cfg,
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  return NextResponse.json({
    resultDataUrl: `data:image/png;base64,${resultBase64}`,
  });
}
