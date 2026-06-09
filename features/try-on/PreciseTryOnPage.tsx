"use client";

import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check, Copy, Download, GripVertical, ImageUp, Plus,
  RefreshCw, RotateCw, Scissors, Sparkles, Trash2, Wand2, Zap,
} from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { Card, GhostButton, GradientButton } from "@/components/ui";
import type { Box, NailStyle, Placement, StyleBox, TargetNail, TryOnMode } from "@/lib/types";
import { boxStyle, cn, computeLongNailBox, nextRotation } from "@/lib/utils";

// 试戴模式：A=甲面迁移 B1=完整试戴 B2=完整保型 C=长度延长
type TryonApiMode = "transfer" | "full" | "full_keep" | "length";

// ─── API helpers ──────────────────────────────────────────────────────────────

const FINGER_NAMES: TargetNail["fingerName"][] = ["pinky", "ring", "middle", "index", "thumb"];
const FINGER_LABELS: Record<string, string> = {
  thumb: "拇指", index: "食指", middle: "中指", ring: "无名指", pinky: "小指",
};
const FINGER_COLORS: Record<string, string> = {
  pinky:  "#f43f5e",  // rose
  ring:   "#CF6338",  // terracotta
  middle: "#10b981",  // emerald
  index:  "#0ea5e9",  // sky
  thumb:  "#f59e0b",  // amber
};

async function callNailSegment(imageBlob: Blob): Promise<NailDetectResult | null> {
  try {
    const fd = new FormData();
    fd.append("file", imageBlob, "hand.png");
    const res = await fetch("/api/nail-segment", { method: "POST", body: fd });
    if (!res.ok) return null;
    return res.json() as Promise<NailDetectResult>;
  } catch { return null; }
}

// 浏览器直接调用 aihubmix，绕过服务器网络限制
const _AI_BASE = "https://aihubmix.com/v1";
const _AI_KEY  = "sk-11A20IIdQETwqD7M44BdB8F2Ea9a4f78B2B309947c6e8650";
const _PROMPTS: Record<string, string> = {
  full_keep: `任务：美甲款式上妆（保持甲型）——将第一张图的美甲颜色、图案和装饰效果原样贴合到第二张图用户指甲上，不改变任何甲型。\n第一张图（款式参考图）：美甲款式展示图，包含要复现的颜色、图案、纹理和装饰细节。\n第二张图（用户手图）：用户的手，是编辑目标。\n操作要求：\n1. 以第二张图（用户手图）为基础，绝对不能改变手指形状、指甲长度、指甲弧度、肤色、背景或光线。\n2. 将第一张图的美甲款式按从左到右顺序严格一一对应地应用到第二张图的对应指甲上。\n3. 严禁调整指甲的形状、长度或弧度——只替换甲面的视觉效果。\n4. 迁移后的美甲效果必须贴合用户指甲的真实透视、弧度和质感，不能像贴纸叠加。\n5. 尽可能忠实保留第一张图中的颜色、图案、纹理、边缘细节和装饰。\n6. 最终结果必须看起来像真实拍摄的手部照片——超写实美甲试戴效果。`,
  full: `任务：完整美甲款式试戴——将第一张图的美甲款式应用到第二张图用户手上。\n第一张图（款式参考图）：美甲款式展示图，包含要复现的设计、颜色、图案和甲型。\n第二张图（用户手图）：用户的手，是试戴目标。\n操作要求：\n1. 以第二张图（用户手图）为基础构图，绝对不能改变手指结构、肤色、背景或光线。\n2. 将第一张图的美甲款式按从左到右顺序严格一一对应地应用到第二张图的对应指甲上。\n3. 允许适度调整第二张图指甲的甲型大小和形状，以更好地贴合第一张图的款式比例和风格。\n4. 尽可能忠实复现第一张图的美甲效果，包括颜色、图案、纹理、装饰和边缘细节。\n5. 最终结果必须看起来像真实拍摄的美甲试戴照片——超写实效果，不能是拼贴或数字叠加感。\n6. 不添加多余的手指、指甲、配饰、文字或水印。`,
  length: `任务：美甲延长 + 款式上妆——按照第一张图红色虚线框所示范围延长第二张图用户指甲并应用款式。\n第一张图（款式参考图）：一张手部照片，每根手指上有红色虚线框，框的范围同时代表期望的指甲长度和要迁移的美甲款式。\n第二张图（用户手图）：用户的干净手图，是编辑目标。\n操作要求：\n1. 以第二张图（用户手图）为基础，绝对不能改变手指形状、肤色或背景。\n2. 将第二张图每根手指的指甲延长至第一张图对应红色虚线框所示的大致长度和覆盖范围。\n3. 将第一张图红色框内的美甲款式按从左到右顺序严格一一对应地应用到每根延长后的指甲上。\n4. 延长后的指甲长度、弧度和整体比例应自然真实。\n5. 最终结果必须看起来像真实拍摄的手部照片——超写实美甲延长试戴效果。`,
};

async function callTryonDirect(styleB64: string, handB64: string, mode: string): Promise<string> {
  const toUrl = (b: string) => b.startsWith("data:") ? b : `data:image/png;base64,${b}`;
  const prompt = _PROMPTS[mode] ?? _PROMPTS.full_keep;
  const res = await fetch(`${_AI_BASE}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_AI_KEY}` },
    body: JSON.stringify({
      model: "gpt-5.5",
      input: [{ role: "user", content: [
        { type: "input_text",  text: prompt },
        { type: "input_image", image_url: toUrl(styleB64) },
        { type: "input_image", image_url: toUrl(handB64)  },
      ]}],
      tools: [{ type: "image_generation", action: "edit", size: "1024x1536", quality: "medium", background: "opaque" }],
      tool_choice: { type: "image_generation" },
    }),
    signal: AbortSignal.timeout(360_000),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`AI ${res.status}: ${t.slice(0, 120)}`); }
  const data = await res.json();
  for (const item of data.output ?? []) {
    if (item.type === "image_generation_call" && item.result) return `data:image/png;base64,${item.result}`;
  }
  throw new Error("No image result");
}

// ─── UX helpers ──────────────────────────────────────────────────────────────

function useElapsedTimer(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return elapsed;
}

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

type Step = 1 | 2 | 3 | 4;
const STEP_DEFS: { label: string; desc: string }[] = [
  { label: "款式图", desc: "上传并确认款式框" },
  { label: "手图",   desc: "上传并确认裁图" },
  { label: "分配款式", desc: "拖拽款式到对应手指" },
  { label: "生成试戴", desc: "选择模式，开始生成" },
];

function StepBar({ current }: { current: Step }) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-0 border-b border-orchid-100 bg-white px-6 py-3">
      {STEP_DEFS.map(({ label, desc }, i) => {
        const step = (i + 1) as Step;
        const done   = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                "transition-[background,color,box-shadow,transform] duration-[350ms]",
                "will-change-transform",
                done   && "bg-orchid-100 text-orchid-600",
                active && [
                  "bg-orchid-500 text-white",
                  "shadow-[0_2px_10px_rgba(196,96,56,0.40)]",
                  "scale-[1.08]",
                ].join(" "),
                !done && !active && "bg-gray-100 text-gray-400 scale-[0.94] opacity-60",
              )}
              title={desc}
            >
              {done ? (
                /* SVG stroke-draw check — impeccable technique */
                <svg key={`check-${step}`} viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 overflow-visible">
                  <polyline
                    points="2,6 5,9 10,3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="stroke-draw"
                    pathLength="1"
                  />
                </svg>
              ) : (
                <span className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none",
                  active ? "border-white/60" : "border-current",
                )}>
                  {step}
                </span>
              )}
              <span>{label}</span>
            </div>
            {i < STEP_DEFS.length - 1 && (
              <div className="relative mx-1.5 h-px w-8 overflow-hidden bg-gray-200">
                {done && (
                  <div className="step-line-done absolute inset-0 bg-orchid-400" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PanelLoading({ show, message, elapsed, estimateSecs }: {
  show: boolean; message: string; elapsed: number; estimateSecs: number;
}) {
  if (!show) return null;
  const pct = Math.min(92, (elapsed / estimateSecs) * 100);
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/90 backdrop-blur-sm">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-orchid-100 border-t-orchid-500" />
      <p className="text-sm font-bold text-plum">{message}</p>
      <div className="w-44 overflow-hidden rounded-full bg-orchid-100" style={{ height: 6 }}>
        <div className="h-full rounded-full bg-gradient-to-r from-orchid-400 to-orchid-600 transition-all duration-1000"
          style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-mist">
        已等待 <span className="font-semibold text-plum">{fmtTime(elapsed)}</span>
        {" · "}预计约 <span className="font-semibold text-plum">{Math.ceil(estimateSecs / 60)} 分钟</span>
      </p>
    </div>
  );
}

async function callHandDetect(imageBlob: Blob): Promise<HandDetectResult | null> {
  try {
    const fd = new FormData();
    fd.append("file", imageBlob, "hand.png");
    const res = await fetch("/api/hand-detect", { method: "POST", body: fd });
    if (!res.ok) return null;
    return res.json() as Promise<HandDetectResult>;
  } catch { return null; }
}

interface NailDetectResult {
  detections: Array<{
    id: number; bbox: [number, number, number, number];
    confidence: number;
    oriented_box?: { angle?: number; points?: number[][] };
    assignment?: { finger?: string; hand_side?: string };
  }>;
  inputUrl?: string;
}

interface HandDetectResult {
  num_hands: number;
  hands: Array<{
    is_right: boolean; bbox: [number, number, number, number];
    keypoints_2d?: number[][];
  }>;
}

function nailsFromDetection(
  detections: NailDetectResult["detections"],
  imgW: number, imgH: number,
): TargetNail[] {
  // 按 x 中心从左到右排列（小指→拇指）
  const sorted = [...detections].sort((a, b) => (a.bbox[0] + a.bbox[2]) / 2 - (b.bbox[0] + b.bbox[2]) / 2);
  return sorted.slice(0, 5).map((det, i) => {
    const [x1, y1, x2, y2] = det.bbox;
    const safe = expandTargetNailBbox(x1, y1, x2, y2, imgW, imgH);
    const fingerName = FINGER_NAMES[i];
    const id = `target_api_${det.id ?? i + 1}`;
    const boxObj: Box = {
      id, rotation: 0,
      x: (safe.x1 / imgW) * 100, y: (safe.y1 / imgH) * 100,
      width: ((safe.x2 - safe.x1) / imgW) * 100, height: ((safe.y2 - safe.y1) / imgH) * 100,
    };
    const directionVector = { x: 0, y: -1 };  // 默认朝上，精确方向由 WiLoR keypoints 提供
    const nail: TargetNail = {
      id, fingerName, label: (fingerName ? FINGER_LABELS[fingerName] : null) ?? `指甲 ${i + 1}`,
      originalBox: boxObj, currentBox: boxObj, directionVector, lengthMultiplier: 1.5,
    };
    return { ...nail, longBox: computeLongNailBox(nail, 1.5) };
  });
}

function expandTargetNailBbox(x1: number, y1: number, x2: number, y2: number, imgW: number, imgH: number) {
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  const padX = Math.max(3, w * 0.12);
  const padTop = Math.max(2, h * 0.08);
  const padBottom = Math.max(4, h * 0.2);
  return {
    x1: Math.max(0, x1 - padX),
    y1: Math.max(0, y1 - padTop),
    x2: Math.min(imgW, x2 + padX),
    y2: Math.min(imgH, y2 + padBottom),
  };
}

// ─── constants ───────────────────────────────────────────────────────────────

const styleImageUrl = "/demo/nail-strip.png";
const targetImageUrl = "/demo/hand-reference.png";

const initialStyleBoxes: StyleBox[] = [
  { id: "style_model_1", confirmed: true, box: { id: "style_model_1", x: 27.35, y: 47.11, width: 13.89, height: 14.03, rotation: 0 } },
  { id: "style_model_2", confirmed: true, box: { id: "style_model_2", x: 46.99, y: 46.85, width: 11.66, height: 8.43, rotation: 0 } },
  { id: "style_model_3", confirmed: true, box: { id: "style_model_3", x: 63.77, y: 43.08, width: 13.26, height: 15.5, rotation: 0 } },
];

const initialTargetNails: TargetNail[] = [
  { id: "target_1", fingerName: "middle" as const, label: "中指",   originalBox: { id: "target_1", x: 43.4, y: 19.1, width: 5.5, height: 7.1, rotation: 0 }, currentBox: { id: "target_1", x: 43.4, y: 19.1, width: 5.5, height: 7.1, rotation: 0 }, directionVector: { x: 0, y: -1 }, lengthMultiplier: 1.5 },
  { id: "target_2", fingerName: "index" as const,  label: "食指",   originalBox: { id: "target_2", x: 58.8, y: 25.0, width: 5.6, height: 7.9, rotation: 0 }, currentBox: { id: "target_2", x: 58.8, y: 25.0, width: 5.6, height: 7.9, rotation: 0 }, directionVector: { x: 0, y: -1 }, lengthMultiplier: 1.5 },
  { id: "target_3", fingerName: "ring" as const,   label: "无名指", originalBox: { id: "target_3", x: 27.3, y: 23.8, width: 5.1, height: 7.8, rotation: 0 }, currentBox: { id: "target_3", x: 27.3, y: 23.8, width: 5.1, height: 7.8, rotation: 0 }, directionVector: { x: 0, y: -1 }, lengthMultiplier: 1.5 },
  { id: "target_4", fingerName: "pinky" as const,  label: "小指",   originalBox: { id: "target_4", x: 9.6,  y: 38.9, width: 5.2, height: 6.9, rotation: 0 }, currentBox: { id: "target_4", x: 9.6,  y: 38.9, width: 5.2, height: 6.9, rotation: 0 }, directionVector: { x: 0, y: -1 }, lengthMultiplier: 1.5 },
  { id: "target_5", fingerName: "thumb" as const,  label: "拇指",   originalBox: { id: "target_5", x: 75.2, y: 56.0, width: 5.6, height: 6.3, rotation: 0 }, currentBox: { id: "target_5", x: 75.2, y: 56.0, width: 5.6, height: 6.3, rotation: 0 }, directionVector: { x: 0, y: -1 }, lengthMultiplier: 1.5 },
].map((nail) => ({ ...nail, longBox: computeLongNailBox(nail, nail.lengthMultiplier ?? 1.5) }));

function makePlacements(targets: TargetNail[]): Placement[] {
  return targets.map((t) => ({ id: `placement_${t.id}`, targetNailId: t.id, styleId: null, rotation: 0, flipVertical: false }));
}

// ─── root page ───────────────────────────────────────────────────────────────

export default function PreciseTryOnPage() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <div className="min-h-0 flex-1">
        <NormalView />
      </div>
    </div>
  );
}

function NormalView() {
  const [currentStyleImageUrl, setCurrentStyleImageUrl] = useState("/demo/nail-strip.png");
  const [styleBoxes, setStyleBoxes] = useState<StyleBox[]>(initialStyleBoxes);
  const [styles, setStyles] = useState<NailStyle[]>([]);
  const [styleBoxesConfirmed, setStyleBoxesConfirmed] = useState(false);
  const [targetNails, setTargetNails] = useState<TargetNail[]>(initialTargetNails);
  const [placements, setPlacements] = useState<Placement[]>(makePlacements(initialTargetNails));
  const [selectedStyleBoxId, setSelectedStyleBoxId] = useState<string | null>(initialStyleBoxes[0]?.id ?? null);
  const [selectedTargetNailId, setSelectedTargetNailId] = useState<string | null>(initialTargetNails[0]?.id ?? null);
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null);
  // 精准试戴必选其一：保持甲型 or 按红框大小
  const [preciseMode, setPreciseMode] = useState<"keep_shape" | "red_box">("keep_shape");
  const [longMultiplier, setLongMultiplier] = useState(1.5);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [currentTargetImageUrl, setCurrentTargetImageUrl] = useState(targetImageUrl);
  const [originalHandImageUrl, setOriginalHandImageUrl] = useState(targetImageUrl); // 上传的原图（重新裁图用）
  // 裁图状态：cropBox 单位像素，相对图片自然尺寸
  const cropMode = "portrait" as const;
  const [cropBox, setCropBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropNatural, setCropNatural] = useState<{ w: number; h: number }>({ w: 843, h: 1171 });
  const [cropConfirmed, setCropConfirmed] = useState(false);
  // 存储检测数据，供切换裁图模式时重建 smart crop
  const [cropDetections, setCropDetections] = useState<Array<{ bbox: [number, number, number, number] }> | null>(null);
  // 上传后预裁图检测结果，确认裁图时重映射为 targetNails
  const [preCropDetections, setPreCropDetections] = useState<NailDetectResult["detections"] | null>(null);
  const handImgRef = useRef<HTMLImageElement>(null);
  const handFileInputRef = useRef<HTMLInputElement>(null);
  // upload flow
  const [detectedDataUrl, setDetectedDataUrl] = useState<string | null>(null);

  const [uploadDetecting, setUploadDetecting] = useState(false);

  // ── 步骤推导 ──────────────────────────────────────────────────────────────
  const currentStep: Step = !styleBoxesConfirmed ? 1
    : !cropConfirmed ? 2
    : placements.some((p) => !p.styleId) ? 3
    : 4;

  const uploadElapsed = useElapsedTimer(uploadDetecting);
  const detectElapsed = useElapsedTimer(detecting);
  const genElapsed    = useElapsedTimer(loading);

  const [uploadModal, setUploadModal] = useState<{
    imageUrl: string;
    detectedImageUrl?: string;
    boxes: StyleBox[];
    fingerNames: (TargetNail["fingerName"] | undefined)[];
  } | null>(null);
  const [uploadModalStep, setUploadModalStep] = useState<"boxes" | "crops">("boxes");
  const [uploadCrops, setUploadCrops] = useState<NailStyle[]>([]);
  const [uploadSelectedBoxId, setUploadSelectedBoxId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void bootstrap(currentStyleImageUrl); }, []);

  async function bootstrap(imgUrl: string) {
    const pixelBoxes = await detectPixelSeparatedStyleBoxes(imgUrl);
    const safeBoxes = pixelBoxes.length ? pixelBoxes : initialStyleBoxes;
    setStyleBoxes(safeBoxes);
    setSelectedStyleBoxId(safeBoxes[0]?.id ?? null);
    setTargetNails(initialTargetNails);
    setSelectedTargetNailId(initialTargetNails[0]?.id ?? null);
    setPlacements(makePlacements(initialTargetNails));
    // 用手部分割数据智能初始化裁图框，确保所有指甲在框内且尽量保留手部
    try {
      const seg = await fetch('/demo/hand-reference-segmentation.json').then((r) => r.json()) as {
        detections?: Array<{ bbox: [number, number, number, number] }>;
      };
      if (seg?.detections?.length) {
        setCropDetections(seg.detections);
        const box = buildSmartCropBox(seg.detections, 843, 1171, cropMode);
        setCropNatural({ w: 843, h: 1171 });
        setCropBox(box);
        setCropConfirmed(false);
        return;
      }
    } catch { /* fallback */ }
    initCropBox(843, 1171);
  }

  function initCropBox(natW: number, natH: number) {
    setCropNatural({ w: natW, h: natH });
    setCropConfirmed(false);
    // 统一竖图 2:3 → 最大可用尺寸，宽度铺满（或受高度限制）
    const bw = Math.min(natW, (natH * 2) / 3);
    const bh = bw * 1.5;
    setCropBox({ x: Math.max(0, (natW - bw) / 2), y: Math.max(0, (natH - bh) / 2), w: bw, h: bh });
  }

  async function confirmCrop() {
    if (!cropBox) return;
    const img = await loadHtmlImage(currentTargetImageUrl);
    const outW = 1024, outH = 1536;
    const canvas = document.createElement("canvas");
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 夹紧到图片自然边界，防止放缩后坐标越界导致输出异常
    const imgNatW = img.naturalWidth, imgNatH = img.naturalHeight;
    const sx = Math.max(0, Math.min(cropBox.x, imgNatW - 1));
    const sy = Math.max(0, Math.min(cropBox.y, imgNatH - 1));
    const sw = Math.max(1, Math.min(cropBox.w, imgNatW - sx));
    const sh = Math.max(1, Math.min(cropBox.h, imgNatH - sy));
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    const croppedUrl = canvas.toDataURL("image/png");
    setCurrentTargetImageUrl(croppedUrl);
    setCropConfirmed(true);

    const { w: natW, h: natH } = cropNatural;
    const snap = { ...cropBox };
    setCropBox(null);

    const transformedNails = initialTargetNails.map((nail) => {
      const b = nail.currentBox;
      const px = (b.x / 100) * natW;
      const py = (b.y / 100) * natH;
      const pw = (b.width / 100) * natW;
      const ph = (b.height / 100) * natH;
      const newBox: Box = {
        ...b,
        x: ((px - snap.x) / snap.w) * 100,
        y: ((py - snap.y) / snap.h) * 100,
        width: (pw / snap.w) * 100,
        height: (ph / snap.h) * 100,
      };
      const updated = { ...nail, currentBox: newBox, originalBox: newBox };
      return { ...updated, longBox: computeLongNailBox(updated, updated.lengthMultiplier ?? 1.5) };
    });

    // 如果有预裁图检测结果，直接重映射到裁图后坐标系（1024×1536），不需要再点识别指甲
    if (preCropDetections?.length) {
      const remapped = preCropDetections
        .map((det) => {
          const [x1, y1, x2, y2] = det.bbox;
          return {
            ...det,
            bbox: [
              ((x1 - snap.x) / snap.w) * outW,
              ((y1 - snap.y) / snap.h) * outH,
              ((x2 - snap.x) / snap.w) * outW,
              ((y2 - snap.y) / snap.h) * outH,
            ] as [number, number, number, number],
          };
        })
        .filter((d) => d.bbox[2] > d.bbox[0] && d.bbox[3] > d.bbox[1]); // 过滤裁框外的指甲

      if (remapped.length) {
        const nails = nailsFromDetection(remapped, outW, outH);
        setTargetNails(nails);
        setSelectedTargetNailId(nails[0]?.id ?? null);
        setPlacements(makePlacements(nails));
        setToast(`✓ 裁图完成，${nails.length} 个指甲红框已自动更新`);
        return;
      }
    }

    setTargetNails(transformedNails);
    setSelectedTargetNailId(transformedNails[0]?.id ?? null);
    setPlacements(makePlacements(transformedNails));
    setToast(`已裁图 ${outW}×${outH}，可点「识别指甲」更新红框`);
  }

  // 调用 YOLO 指甲分割 + WiLoR 手部检测，更新目标指甲框
  async function detectTargetNails() {
    setDetecting(true);
    setToast("正在调用指甲分割和手部检测…");
    try {
      const imgBlob = await fetch(currentTargetImageUrl).then((r) => r.blob());
      const imgEl = await loadHtmlImage(currentTargetImageUrl);
      const imgW = imgEl.naturalWidth, imgH = imgEl.naturalHeight;

      // 并行调两个接口
      const [nailResult, handResult] = await Promise.all([
        callNailSegment(imgBlob),
        callHandDetect(imgBlob),
      ]);

      if (nailResult?.detections?.length) {
        const nails = nailsFromDetection(nailResult.detections, imgW, imgH);
        setTargetNails(nails);
        setSelectedTargetNailId(nails[0]?.id ?? null);
        setPlacements(makePlacements(nails));
        const handMsg = handResult?.num_hands ? `，检测到 ${handResult.num_hands} 只手` : "";
        setToast(`识别完成：${nails.length} 个指甲${handMsg}`);
      } else {
        setToast(handResult?.num_hands ? `检测到手部但未识别到指甲，保留默认框` : "服务暂不可用，保留默认框");
      }
    } catch (e) {
      setToast(`识别失败：${String(e)}`);
    } finally {
      setDetecting(false);
    }
  }

  // 上传手图：显示图片 → 自动识别指甲 → 以最左最右指甲中点为中心定位裁框
  async function handleHandImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    const objectUrl = URL.createObjectURL(file);
    setOriginalHandImageUrl(objectUrl);
    setCurrentTargetImageUrl(objectUrl);
    setCropConfirmed(false);
    setResultImageUrl(null);
    setToast("正在识别指甲并定位裁框…");
    setDetecting(true);

    try {
      const img = await loadHtmlImage(objectUrl);
      const natW = img.naturalWidth, natH = img.naturalHeight;
      setCropNatural({ w: natW, h: natH });

      const imgBlob = await fetch(objectUrl).then((r) => r.blob());
      const [nailResult, handResult] = await Promise.all([
        callNailSegment(imgBlob),
        callHandDetect(imgBlob),
      ]);

      if (nailResult?.detections?.length) {
        // 存预裁图检测结果，确认裁图时重映射
        setCropDetections(nailResult.detections);
        setPreCropDetections(nailResult.detections);
        const box = buildSmartCropBox(nailResult.detections, natW, natH, "portrait");
        setCropBox(box);
        const handMsg = handResult?.num_hands ? `，检测到 ${handResult.num_hands} 只手` : "";
        setToast(`识别完成：${nailResult.detections.length} 个指甲${handMsg}，裁框已定位，请确认裁图`);
      } else {
        setPreCropDetections(null);
        initCropBox(natW, natH);
        setToast("未识别到指甲，已居中初始化裁框");
      }
    } catch (err) {
      const img = await loadHtmlImage(objectUrl).catch(() => null);
      if (img) initCropBox(img.naturalWidth, img.naturalHeight);
      setToast(`识别失败，已初始化裁框：${String(err).slice(0, 40)}`);
    } finally {
      setDetecting(false);
    }
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploadDetecting(true);
    setToast("Step 1/2 — AI 正在标注指甲框…");

    try {
      // ── 调用两步 AI pipeline ──────────────────────────────────
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("name", file.name);
      const res = await fetch("/api/style-detect", { method: "POST", body: fd, signal: AbortSignal.timeout(360_000) });

      if (res.ok) {
        const data = await res.json() as {
          detectedDataUrl: string; extractedDataUrl: string; cached?: boolean;
        };

        // detected 图立刻存入 state，供 A/C 模式使用
        setDetectedDataUrl(data.detectedDataUrl);
        // 左面板立刻更新为 AI 还原的透明款式图
        setCurrentStyleImageUrl(data.extractedDataUrl);

        setToast("AI 处理完成，正在切割款式区域…");

        // 在 extracted 图上像素切割，得到各指甲区域框
        const boxes = await detectPixelSeparatedStyleBoxes(data.extractedDataUrl);
        const safeBoxes = boxes.length ? boxes : initialStyleBoxes;

        // 弹出 modal：左=detected参考图，右=extracted+可调框
        // 左面板的 currentStyleImageUrl / styleBoxes 保持不变，等用户在 modal 里确认后再更新
        setUploadModal({
          imageUrl: data.extractedDataUrl,
          detectedImageUrl: data.detectedDataUrl,
          boxes: safeBoxes,
          fingerNames: safeBoxes.map((_, i) => FINGER_NAMES[i]),
        });
        setUploadSelectedBoxId(safeBoxes[0]?.id ?? null);
        setUploadModalStep("boxes");
        setUploadCrops([]);
        setToast(`✓ AI 处理完成${data.cached ? "（命中缓存）" : ""}，请在弹窗中确认款式框`);
      } else {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setToast(`AI 调用失败：${err.error?.slice(0, 60) ?? res.status}`);
      }
    } catch (err) {
      setToast(`AI 超时或网络错误：${String(err).slice(0, 50)}`);
    } finally {
      setUploadDetecting(false);
    }
  }

  function patchUploadBox(id: string, patch: Partial<Box>) {
    setUploadModal((prev) => prev ? {
      ...prev,
      boxes: prev.boxes.map((b) => b.id === id ? { ...b, box: clampBox({ ...b.box, ...patch }) } : b),
    } : null);
  }

  async function generateUploadCrops() {
    if (!uploadModal) return;
    const crops = await makeStylePiecesFromBoxes(uploadModal.imageUrl, uploadModal.boxes);
    setUploadCrops(crops);
    setUploadModalStep("crops");
  }

  async function confirmUpload() {
    if (!uploadModal) return;
    const { imageUrl, boxes } = uploadModal;
    if (uploadModal.detectedImageUrl) setDetectedDataUrl(uploadModal.detectedImageUrl);
    setCurrentStyleImageUrl(imageUrl);
    setResultImageUrl(null);
    setUploadModal(null);
    setUploadCrops([]);

    setToast("正在自动重切割款式区域…");

    // 确认后自动重切割 → 生成款式池
    const recut = await detectPixelSeparatedStyleBoxes(imageUrl);
    const safeBoxes = recut.length ? recut : boxes;
    setStyleBoxes(safeBoxes);
    setSelectedStyleBoxId(safeBoxes[0]?.id ?? null);

    const pieces = await makeStylePiecesFromBoxes(imageUrl, safeBoxes);
    setStyles(pieces);
    setSelectedStyleId(pieces[0]?.id ?? null);
    setStyleBoxesConfirmed(true);
    setPlacements(makePlacements(targetNails));
    setToast(`✓ 款式图已更新，${pieces.length} 款自动生成`);
  }

  async function confirmStyleBoxes(imgUrl = currentStyleImageUrl, boxes = styleBoxes) {
    const pieces = await makeStylePiecesFromBoxes(imgUrl, boxes);
    setStyles(pieces);
    setSelectedStyleId(pieces[0]?.id ?? null);
    setStyleBoxesConfirmed(true);
    setToast(`款式池已生成 ${pieces.length} 款`);
  }

  function patchStyleBox(id: string, patch: Partial<Box>) {
    setStyleBoxes((cur) => cur.map((i) => i.id === id ? { ...i, box: clampBox({ ...i.box, ...patch }) } : i));
    setStyleBoxesConfirmed(false);
  }

  function patchTargetBox(id: string, patch: Partial<Box>) {
    setTargetNails((cur) => cur.map((item) => {
      if (item.id !== id) return item;
      const currentBox = clampBox({ ...item.currentBox, ...patch });
      return { ...item, currentBox, longBox: computeLongNailBox({ ...item, currentBox }, item.lengthMultiplier ?? longMultiplier) };
    }));
  }

  function addStyleBox() {
    const id = `style_manual_${Date.now()}`;
    setStyleBoxes((cur) => [...cur, { id, confirmed: true, box: { id, x: 42, y: 42, width: 12, height: 20, rotation: 0 } }]);
    setSelectedStyleBoxId(id);
    setStyleBoxesConfirmed(false);
  }

  async function splitSelectedStyleBox() {
    const selected = styleBoxes.find((i) => i.id === selectedStyleBoxId);
    if (!selected) return setToast("请先选中一个款式框");
    const split = await splitBoxByPixelGap(currentStyleImageUrl, selected.box);
    if (!split) return setToast("未找到明显像素空隙");
    setStyleBoxes((cur) => {
      const next = cur.filter((i) => i.id !== selected.id);
      return [
        ...next,
        { id: `${selected.id}_a`, confirmed: true, box: { ...split[0], id: `${selected.id}_a` } },
        { id: `${selected.id}_b`, confirmed: true, box: { ...split[1], id: `${selected.id}_b` } },
      ].sort((a, b) => a.box.x - b.box.x);
    });
    setSelectedStyleBoxId(`${selected.id}_a`);
    setStyleBoxesConfirmed(false);
    setToast("已按像素空隙切割");
  }

  function addTargetBox() {
    const index = targetNails.length + 1;
    const id = `target_${index}`;
    const target: TargetNail = {
      id, label: `新增 ${index}`,
      originalBox: { id, x: 45, y: 44, width: 10, height: 12, rotation: 0 },
      currentBox: { id, x: 45, y: 44, width: 10, height: 12, rotation: 0 },
      directionVector: { x: 0, y: -1 }, lengthMultiplier: longMultiplier,
    };
    setTargetNails((cur) => [...cur, { ...target, longBox: computeLongNailBox(target, longMultiplier) }]);
    setPlacements((cur) => [...cur, { id: `placement_${id}`, targetNailId: id, styleId: null, rotation: 0, flipVertical: false }]);
    setSelectedTargetNailId(id);
  }

  function assignStyle(styleId: string) {
    if (!selectedTargetNailId) return setToast("请先点击目标指甲");

    // 先计算新的 placements（不等 setState 批次）
    const newPlacements = placements.map((p) =>
      p.targetNailId === selectedTargetNailId ? { ...p, styleId } : p
    );
    setPlacements(newPlacements);
    setSelectedStyleId(styleId);

    // 自动跳到下一个未分配款式的指甲位
    const curIdx = targetNails.findIndex((n) => n.id === selectedTargetNailId);
    for (let i = 1; i <= targetNails.length; i++) {
      const nextNail = targetNails[(curIdx + i) % targetNails.length];
      const nextPlacement = newPlacements.find((p) => p.targetNailId === nextNail.id);
      if (!nextPlacement?.styleId) {
        setSelectedTargetNailId(nextNail.id);
        break;
      }
    }
  }

  function patchPlacement(targetNailId: string, patch: Partial<Placement>) {
    setPlacements((cur) => cur.map((i) => i.targetNailId === targetNailId ? { ...i, ...patch } : i));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPlacements((cur) => {
      const from = cur.findIndex((i) => i.id === active.id);
      const to = cur.findIndex((i) => i.id === over.id);
      if (from < 0 || to < 0) return cur;
      const next = [...cur];
      const a = next[from]; const b = next[to];
      next[from] = { ...a, styleId: b.styleId, rotation: b.rotation, flipVertical: b.flipVertical };
      next[to] = { ...b, styleId: a.styleId, rotation: a.rotation, flipVertical: a.flipVertical };
      return next;
    });
  }

  function copyToNextEmpty(targetNailId: string) {
    const source = placements.find((i) => i.targetNailId === targetNailId);
    const empty = placements.find((i) => !i.styleId);
    if (!source?.styleId) return setToast("当前指位还没有款式");
    if (!empty) return setToast("没有空的目标指位");
    patchPlacement(empty.targetNailId, { styleId: source.styleId, rotation: source.rotation, flipVertical: source.flipVertical });
  }

  function applyLongMultiplier(value: number) {
    setLongMultiplier(value);
    setTargetNails((cur) => cur.map((nail) => ({ ...nail, lengthMultiplier: value, longBox: computeLongNailBox(nail, value) })));
  }

  async function submitGenerate() {
    if (!cropConfirmed) return setToast("请先确认裁图");

    setLoading(true);
    setToast("AI 试戴生成中，约 1-2 分钟…");
    try {
      // 精准试戴：图1 始终是 renderHandWithBoxes()（手图+红框），图2 是用户手图
      // 区别只在提示词：保持甲型 → full_keep，按红框大小 → length
      const styleBase64 = await renderHandWithBoxes();
      const handBase64  = await urlToBase64(currentTargetImageUrl);
      const apiMode = preciseMode === "red_box" ? "length" : "full_keep";

      const resultDataUrl = await callTryonDirect(styleBase64, handBase64, apiMode);
      setResultImageUrl(resultDataUrl);
      setToast("✓ 试戴生成成功");
    } catch (e) {
      setToast(`生成出错：${String(e).slice(0, 60)}`);
    } finally {
      setLoading(false);
    }
  }

  // 渲染手图 + 款式裁片 + 红色指甲框 → dataURL
  // 同时用于：① 导出 PNG ② 模式 A/C 的图1输入
  async function renderHandWithBoxes(): Promise<string> {
    const W = 1024, H = 1536;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const handImg = await loadHtmlImage(currentTargetImageUrl);
    ctx.drawImage(handImg, 0, 0, W, H);

    for (const nail of targetNails) {
      const box = preciseMode === "red_box" ? (nail.longBox ?? nail.currentBox) : nail.currentBox;
      const bx = (box.x / 100) * W;
      const by = (box.y / 100) * H;
      const bw = (box.width  / 100) * W;
      const bh = (box.height / 100) * H;
      const cx = bx + bw / 2;
      const cy = by + bh / 2;
      const boxRot = (box.rotation ?? 0) * Math.PI / 180;

      // 贴款式裁片（如果有分配）
      const placement = placements.find((p) => p.targetNailId === nail.id);
      const style = styles.find((s) => s.id === placement?.styleId);
      const src = style?.pieceSrc ?? style?.styleSrc;
      if (src && style) {
        const styleImg = await loadHtmlImage(src);
        const iw = styleImg.naturalWidth, ih = styleImg.naturalHeight;
        const scale = Math.min(bw / iw, bh / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = -dw / 2, dy = bh / 2 - dh; // bottom-center
        const styleRot = ((style.rotation + (placement?.rotation ?? 0)) % 360) * Math.PI / 180;
        const flip = style.flipVertical || placement?.flipVertical;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(boxRot);
        ctx.beginPath(); ctx.rect(-bw / 2, -bh / 2, bw, bh); ctx.clip();
        ctx.rotate(styleRot);
        if (flip) ctx.scale(1, -1);
        ctx.drawImage(styleImg, dx, dy, dw, dh);
        ctx.restore();
      }

      // 红色实线框（AI 识别用）
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(boxRot);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    }

    return canvas.toDataURL("image/png");
  }

  async function exportPng() {
    if (!cropConfirmed) return setToast("请先确认裁图");
    setLoading(true);
    try {
      const dataUrl = await renderHandWithBoxes();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "nail-tryon-overlay.png";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setToast("✓ 已导出 1024×1536 贴片效果图");
    } catch (e) { setToast(`导出失败：${String(e)}`); }
    finally { setLoading(false); }
  }

  return (
    <>
    {/* ── upload modal：AI 处理完自动弹出，左=detected参考，右=extracted可调框 ── */}
    {uploadModal && (
      <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="animate-scale-in flex w-[680px] max-h-[92vh] flex-col gap-4 overflow-y-auto rounded-[28px] border border-white/80 bg-white p-5 shadow-soft scrollbar-soft">
          {uploadModalStep === "boxes" ? (
            <>
              <div>
                <h2 className="text-base font-bold text-plum">款式框调整</h2>
                <p className="mt-0.5 text-xs text-mist">
                  {uploadModal.detectedImageUrl
                    ? "左：AI 红框标注图（参考）· 右：透明正视图（调整框后生成款式）"
                    : `检测到 ${uploadModal.boxes.length} 个区域，可拖拽调整后生成裁片`}
                </p>
              </div>
              {uploadModal.detectedImageUrl ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-center text-[10px] font-semibold text-mist">① AI 标注框（参考）</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={uploadModal.detectedImageUrl} alt="AI 标注" className="w-full rounded-xl border border-orchid-100" draggable={false} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-center text-[10px] font-semibold text-mist">② 透明正视图（调整框）</span>
                    <EditableImageCanvas image={uploadModal.imageUrl}>
                      {uploadModal.boxes.map((item, index) => (
                        <EditableBox key={item.id} box={item.box}
                          label={uploadModal.fingerNames[index] ? FINGER_LABELS[uploadModal.fingerNames[index]!] : `${index + 1}`}
                          active={uploadSelectedBoxId === item.id}
                          accentColor={FINGER_COLORS.pinky}
                          onSelect={() => setUploadSelectedBoxId(item.id)}
                          onPatch={(patch) => patchUploadBox(item.id, patch)} />
                      ))}
                    </EditableImageCanvas>
                  </div>
                </div>
              ) : (
                <EditableImageCanvas image={uploadModal.imageUrl}>
                  {uploadModal.boxes.map((item, index) => (
                    <EditableBox key={item.id} box={item.box}
                      label={uploadModal.fingerNames[index] ? FINGER_LABELS[uploadModal.fingerNames[index]!] : `${index + 1}`}
                      active={uploadSelectedBoxId === item.id}
                      accentColor={FINGER_COLORS.pinky}
                      onSelect={() => setUploadSelectedBoxId(item.id)}
                      onPatch={(patch) => patchUploadBox(item.id, patch)} />
                  ))}
                </EditableImageCanvas>
              )}
              <BoxEditor title="框数值"
                box={uploadModal.boxes.find((b) => b.id === uploadSelectedBoxId)?.box}
                onPatch={(patch) => uploadSelectedBoxId && patchUploadBox(uploadSelectedBoxId, patch)} />
              <div className="flex gap-3">
                <GhostButton className="flex-1" onClick={() => setUploadModal(null)}>关闭</GhostButton>
                <GradientButton className="flex-1" onClick={generateUploadCrops}>
                  <Check className="h-4 w-4" />确认
                </GradientButton>
              </div>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-base font-bold text-plum">款式裁切预览</h2>
                <p className="mt-0.5 text-xs text-mist">
                  已生成 <span className="font-semibold text-orchid-600">{uploadCrops.length}</span> 款 · 可返回调整框，或确认应用
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {uploadCrops.map((crop) => (
                  <div key={crop.id} className="flex flex-col gap-1.5 rounded-2xl border border-orchid-100 bg-white p-2 shadow-sm">
                    <StyleThumb style={crop} className="aspect-[3/4] w-full rounded-xl" />
                    <p className="text-center text-xs font-semibold text-plum">{crop.label}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <GhostButton className="flex-1" onClick={() => setUploadModalStep("boxes")}>← 返回调整框</GhostButton>
                <GradientButton className="flex-1" onClick={confirmUpload}>
                  <Check className="h-4 w-4" />确认使用此款式
                </GradientButton>
              </div>
            </>
          )}
        </div>
      </div>
    )}

    <div className="flex h-full min-h-0 flex-col">
      <StepBar current={currentStep} />
      {/* 步骤说明条 — hint-in 动效随步骤变化重播 */}
      <div key={`hint-${currentStep}`} className="hint-in shrink-0 border-b border-orchid-100 bg-orchid-50 px-4 py-2 text-center text-xs font-medium text-orchid-700">
        {currentStep === 1 && "👈 第一步：在左侧上传美甲款式图，确认切割框后点「确认 N 个框 · 生成款式池」"}
        {currentStep === 2 && "☝️ 第二步：在中间上传你的手图，调整裁图框后点「确认裁图」"}
        {currentStep === 3 && "👉 第三步：在右侧【指甲映射】将款式点击 + 分配给每根手指，分配完后点「开始生成」；可选择【本甲】或【延长甲】"}
        {currentStep === 4 && "✅ 已就绪：选择【本甲】或【延长甲】，点「开始生成」"}
      </div>
    <div className="min-h-0 flex-1 grid grid-cols-[420px_minmax(0,1fr)_200px] gap-2 p-2">
      {/* ── left: style detection + style pool ── */}
      <div className="flex flex-col gap-2.5 overflow-y-auto scrollbar-soft">
        {/* 款式图 */}
        <Card key={`left-${currentStep === 1}`} className={cn(
          "relative flex shrink-0 flex-col gap-2 p-3",
          currentStep === 1 ? "precise-panel-active" : "precise-panel-inactive",
        )}>
          <div className="flex items-center justify-between">
            <PanelTitle title="美甲款式图" subtitle="上传后自动 AI 处理 + 切割" />
            <GhostButton onClick={() => fileInputRef.current?.click()} disabled={uploadDetecting}>
              <ImageUp className="h-3.5 w-3.5" />
              {uploadDetecting ? "处理中…" : "上传"}
            </GhostButton>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadFile} />
          </div>

          <EditableImageCanvas image={currentStyleImageUrl}>
            {styleBoxes.map((item, index) => (
              <EditableBox key={item.id} box={item.box} label={`${index + 1}`}
                active={selectedStyleBoxId === item.id}
                accentColor={FINGER_COLORS.pinky}
                onSelect={() => setSelectedStyleBoxId(item.id)}
                onPatch={(patch) => patchStyleBox(item.id, patch)} />
            ))}
          </EditableImageCanvas>
          <BoxEditor title="框数值"
            box={styleBoxes.find((i) => i.id === selectedStyleBoxId)?.box}
            onPatch={(patch) => selectedStyleBoxId && patchStyleBox(selectedStyleBoxId, patch)} />
          <div className="grid grid-cols-4 gap-1.5">
            <GhostButton className="flex-col gap-0.5 py-1.5 text-[11px]" onClick={async () => {
              const boxes = await detectPixelSeparatedStyleBoxes(currentStyleImageUrl);
              const safe = boxes.length ? boxes : initialStyleBoxes;
              setStyleBoxes(safe); setSelectedStyleBoxId(safe[0]?.id ?? null); setStyleBoxesConfirmed(false);
              setToast("已重新像素切割");
            }}>
              <RefreshCw className="h-3.5 w-3.5" />重切割
            </GhostButton>
            <GhostButton className="flex-col gap-0.5 py-1.5 text-[11px]" onClick={splitSelectedStyleBox} disabled={!selectedStyleBoxId}>
              <Scissors className="h-3.5 w-3.5" />切开
            </GhostButton>
            <GhostButton className="flex-col gap-0.5 py-1.5 text-[11px]" onClick={addStyleBox}>
              <Plus className="h-3.5 w-3.5" />补框
            </GhostButton>
            <GhostButton className="flex-col gap-0.5 py-1.5 text-[11px]" onClick={() => selectedStyleBoxId && setStyleBoxes((cur) => cur.filter((i) => i.id !== selectedStyleBoxId))} disabled={!selectedStyleBoxId}>
              <Trash2 className="h-3.5 w-3.5" />删框
            </GhostButton>
          </div>
          <GradientButton
            className={cn("w-full", currentStep === 1 && !loading && "cta-breathe")}
            onClick={() => confirmStyleBoxes()}
            disabled={loading || styleBoxes.length === 0}
          >
            <Check className="h-3.5 w-3.5" />
            {loading ? "处理中…" : `确认 ${styleBoxes.length} 个框 · 生成款式池`}
          </GradientButton>
          <PanelLoading show={uploadDetecting} message="AI 正在分析款式图…" elapsed={uploadElapsed} estimateSecs={150} />
        </Card>

        {/* 款式池 — 3 列网格，无分类过滤，全部展示 */}
        <Card className="flex flex-col gap-1.5 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-plum">款式池</span>
            <span className="text-[11px] text-mist">
              {styleBoxesConfirmed
                ? `${styles.length} 款 · ${selectedTargetNailId ? "点 + 分配款式" : "先选目标指甲"}`
                : "确认框后生成"}
            </span>
          </div>
          {!styleBoxesConfirmed ? (
            <div className="flex h-24 items-center justify-center rounded-2xl border border-dashed border-orchid-200 bg-orchid-50">
              <p className="text-center text-[11px] text-mist">确认切割框后生成款式池</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {styles.map((style) => (
                <article key={style.id} onClick={() => setSelectedStyleId(style.id)}
                  className={cn(
                    "rounded-xl border bg-white p-1.5 shadow-sm cursor-pointer",
                    "transition-all duration-150 ease-out hover:scale-[1.04] hover:shadow-glow-sm",
                    "active:scale-[0.97]",
                    selectedStyleId === style.id ? "border-orchid-500 ring-2 ring-orchid-100 shadow-glow-sm" : "border-orchid-100",
                  )}>
                  <StyleThumb style={style} className="aspect-[3/4] w-full rounded-lg" />
                  <p className="mt-1 truncate px-0.5 text-[10px] font-semibold text-plum leading-tight">{style.label}</p>
                  <div className="mt-1 flex items-center gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setStyles((cur) => cur.map((s) => s.id === style.id ? { ...s, flipVertical: !s.flipVertical } : s)); }}
                      className="flex-1 rounded-full bg-orchid-50 py-0.5 text-[9px] font-semibold text-orchid-600">翻</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setStyles((cur) => cur.map((s) => s.id === style.id ? { ...s, rotation: nextRotation(s.rotation) } : s)); }}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orchid-50 text-orchid-600">
                      <RotateCw className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); assignStyle(style.id); }}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-orchid-500 text-white shadow-sm">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── center: target hand（单卡，手图撑满）── */}
      <Card key={`center-${currentStep === 2 || currentStep === 4}`} className={cn(
        "relative flex min-h-0 flex-col gap-2 p-3",
        (currentStep === 2 || currentStep === 4) && "precise-panel-active",
      )}>
        {/* 头部：标题 + 模式 + 操作 全部一行 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <GhostButton onClick={() => handFileInputRef.current?.click()} disabled={detecting}>
            <ImageUp className="h-3.5 w-3.5" />{detecting ? "识别中…" : "上传手图"}
          </GhostButton>
          <input ref={handFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleHandImageUpload} />

          <div className="flex-1" />

          {/* 操作按钮 */}
          {!cropConfirmed ? (
            <>
            <GradientButton
              className={cn(currentStep === 2 && "cta-breathe")}
              onClick={confirmCrop}
              disabled={!cropBox}
            >
              <Check className="h-3.5 w-3.5" />确认裁图 1024×1536
            </GradientButton>
            </>
          ) : (
            <>
              <GhostButton onClick={() => { setCropConfirmed(false); setCurrentTargetImageUrl(originalHandImageUrl); initCropBox(cropNatural.w, cropNatural.h); setToast(""); }}>
                <RefreshCw className="h-3.5 w-3.5" />重新裁图
              </GhostButton>
              <GhostButton onClick={addTargetBox}><Plus className="h-3.5 w-3.5" />新增框</GhostButton>
              {/* ── 精准试戴模式（必选其一）── */}
              {(["keep_shape", "red_box"] as const).map((m) => (
                <label key={m} className={cn(
                  "flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition",
                  preciseMode === m
                    ? "border-orchid-500 bg-orchid-50 text-plum"
                    : "border-orchid-200 bg-white text-mist",
                )}>
                  <input type="radio" name="preciseMode" value={m} checked={preciseMode === m}
                    onChange={() => { setPreciseMode(m); if (m === "keep_shape") applyLongMultiplier(1.5); }}
                    className="h-3 w-3 accent-orchid-500" />
                  {m === "keep_shape" ? "本甲" : "延长甲"}
                </label>
              ))}

              {/* 倍率（仅按红框大小时显示） */}
              {preciseMode === "red_box" && (
                <>
                  {[1.5, 1.8, 2.2].map((v) => (
                    <button key={v} onClick={() => applyLongMultiplier(v)}
                      className={cn("rounded-full px-2 py-1 text-xs font-semibold",
                        longMultiplier === v ? "bg-orchid-500 text-white" : "bg-orchid-50 text-orchid-600")}>
                      {v}x
                    </button>
                  ))}
                  <input type="number" min={1} max={3} step={0.1} value={longMultiplier}
                    onChange={(e) => applyLongMultiplier(Number(e.target.value))}
                    className="w-14 rounded-full border border-orchid-200 px-2 py-0.5 text-xs outline-none focus:border-orchid-500" />
                </>
              )}

              <GradientButton
                className={cn(currentStep === 4 && !loading && "cta-breathe")}
                onClick={submitGenerate}
                disabled={loading}
              >
                <Wand2 className="h-3.5 w-3.5" />{loading ? "生成中…" : "开始生成"}
              </GradientButton>
              <GhostButton onClick={exportPng} disabled={loading}>
                <Download className="h-3.5 w-3.5" />导出 PNG
              </GhostButton>
            </>
          )}
        </div>

        {/* 手图区域 — 非激活步骤时退场 */}
        <div className={cn(
          "relative min-h-0 flex-1 rounded-2xl bg-orchid-50",
          cropConfirmed
            ? "overflow-hidden flex items-center justify-center"
            : "overflow-auto scrollbar-soft flex items-start justify-center",
          currentStep === 1 && "precise-panel-inactive",
        )}>
          <div className={cn(
            "relative",
            cropConfirmed ? "h-full" : "w-full max-w-sm"
          )} style={cropConfirmed ? { aspectRatio: "2/3" } : undefined} data-canvas>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={handImgRef}
              src={currentTargetImageUrl}
              alt=""
              className={cn(cropConfirmed ? "block h-full w-full object-cover" : "block w-full h-auto")}
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (!cropConfirmed) initCropBox(el.naturalWidth, el.naturalHeight);
              }} />

            {/* 裁图前：显示裁框（可拖动、可缩放）*/}
            {!cropConfirmed && cropBox && (() => {
              const { w: natW, h: natH } = cropNatural;
              const leftPct = (cropBox.x / natW) * 100;
              const topPct  = (cropBox.y / natH) * 100;
              const wPct    = (cropBox.w / natW) * 100;
              const hPct    = (cropBox.h / natH) * 100;
              const label   = "1024×1536 竖图框（可拖动）";
              return (
                <>
                  <div className="absolute inset-0 bg-black/30 pointer-events-none" />
                  <div
                    className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] cursor-move touch-none z-10"
                    style={{ left: `${leftPct}%`, top: `${topPct}%`, width: `${wPct}%`, height: `${hPct}%` }}
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
                      const rect = cnv.getBoundingClientRect();
                      const startX = e.clientX, startY = e.clientY;
                      const sb = { ...cropBox };
                      const onMove = (ev: globalThis.PointerEvent) => {
                        const dx = ((ev.clientX - startX) / rect.width) * natW;
                        const dy = ((ev.clientY - startY) / rect.height) * natH;
                        setCropBox({ ...sb,
                          x: Math.max(0, Math.min(natW - sb.w, sb.x + dx)),
                          y: Math.max(0, Math.min(natH - sb.h, sb.y + dy)),
                        });
                      };
                      const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                      window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                    }}
                  >
                    <span className="absolute -top-6 left-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-plum shadow">
                      {label}
                    </span>
                    {/* 右下角缩放手柄：方图等比，竖图保持 2:3 */}
                    <span className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full bg-white border-2 border-orchid-500 cursor-nwse-resize z-20"
                      onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation();
                        const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
                        const rect = cnv.getBoundingClientRect();
                        const startX = e.clientX, startY = e.clientY;
                        const sw = cropBox.w, sh = cropBox.h;
                        const onMove = (ev: globalThis.PointerEvent) => {
                          // 对角线平均位移，锁定比例
                          const dxPx = ((ev.clientX - startX) / rect.width) * natW;
                          const dyPx = ((ev.clientY - startY) / rect.height) * natH;
                          // 固定 2:3 竖图比例
                          const delta = (dxPx + dyPx) / 2;
                          const maxW = Math.min(natW, (natH * 2) / 3);
                          const newW = Math.max(80, Math.min(maxW, sw + delta));
                          const newH = newW * 1.5;
                          setCropBox((prev) => prev ? { ...prev, w: newW, h: newH,
                            x: Math.max(0, Math.min(natW - newW, prev.x)),
                            y: Math.max(0, Math.min(natH - newH, prev.y)) } : prev);
                        };
                        const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                        window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                      }} />
                  </div>
                </>
              );
            })()}

            {/* 裁图后：显示指甲框 */}
            {cropConfirmed && targetNails.map((nail, index) => {
              const box = preciseMode === "red_box" ? nail.longBox ?? nail.currentBox : nail.currentBox;
              const placement = placements.find((p) => p.targetNailId === nail.id);
              const style = styles.find((s) => s.id === placement?.styleId);
              return (
                <EditableBox key={nail.id} box={box} label={`${index + 1}`}
                  active={selectedTargetNailId === nail.id}
                  accentColor="#ef4444"
                  directionVector={nail.directionVector}
                  onSelect={() => setSelectedTargetNailId(nail.id)}
                  onPatch={(patch) => patchTargetBox(nail.id, patch)}>
                  {style && <StyleThumb style={style} placement={placement} className="h-full w-full" />}
                </EditableBox>
              );
            })}
          </div>
        </div>
        <PanelLoading show={detecting} message="AI 正在识别指甲位置…" elapsed={detectElapsed} estimateSecs={90} />
        <PanelLoading show={loading}   message="AI 试戴生成中，请耐心等待…" elapsed={genElapsed} estimateSecs={210} />

        {/* 生成结果悬浮预览（在手图容器外，绝对定位到 Card 右下） */}
        {resultImageUrl && (
          <div className="animate-scale-in absolute bottom-20 right-4 z-20 overflow-hidden rounded-2xl border-2 border-white shadow-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resultImageUrl} alt="试戴结果" className="animate-reveal h-24 w-24 object-cover" />
          </div>
        )}

        {/* 框数值 + 删除（紧凑底部）*/}
        <div className="flex shrink-0 items-end gap-2">
          <div className="flex-1">
            <MidpointBoxEditor
              box={targetNails.find((n) => n.id === selectedTargetNailId)?.currentBox}
              onPatch={(patch) => selectedTargetNailId && patchTargetBox(selectedTargetNailId, patch)} />
          </div>
          <GhostButton className="mb-0.5 shrink-0" onClick={() => selectedTargetNailId && (
            setTargetNails((cur) => cur.filter((n) => n.id !== selectedTargetNailId)),
            setPlacements((cur) => cur.filter((p) => p.targetNailId !== selectedTargetNailId))
          )} disabled={!selectedTargetNailId}>
            <Trash2 className="h-3.5 w-3.5" />
          </GhostButton>
        </div>
      </Card>

      {/* ── right: mapping panel ── */}
      <div className="flex flex-col overflow-y-auto scrollbar-soft">
        <Card key={`right-${currentStep === 3}`} className={cn(
          "flex flex-col gap-2.5 p-3",
          currentStep === 3 ? "precise-panel-active" : "precise-panel-inactive",
        )}>
          <div className="flex shrink-0 items-center justify-between">
            <PanelTitle title="指甲映射" subtitle="拖拽行交换款式" />
            <GhostButton onClick={() => setPlacements((cur) => cur.map((i) => ({ ...i, styleId: null, rotation: 0, flipVertical: false })))}>
              清空
            </GhostButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-soft">
            <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={placements.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2 pb-2">
                  {placements.map((placement) => (
                    <SortablePlacementRow key={placement.id} placement={placement}
                      target={targetNails.find((n) => n.id === placement.targetNailId)}
                      style={styles.find((s) => s.id === placement.styleId)}
                      active={selectedTargetNailId === placement.targetNailId}
                      onSelect={setSelectedTargetNailId}
                      onRotate={(id) => { const p = placements.find((i) => i.targetNailId === id); patchPlacement(id, { rotation: nextRotation(p?.rotation ?? 0) }); }}
                      onFlip={(id) => { const p = placements.find((i) => i.targetNailId === id); patchPlacement(id, { flipVertical: !p?.flipVertical }); }}
                      onDelete={(id) => patchPlacement(id, { styleId: null, rotation: 0, flipVertical: false })}
                      onCopy={copyToNextEmpty} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </Card>
      </div>

      {/* toast */}
      {toast && (
        <button onClick={() => setToast("")}
          className="animate-slide-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-opacity hover:opacity-80">
          {toast}
        </button>
      )}
    </div>{/* end inner grid */}
    </div>{/* end outer flex */}
    </>
  );
}

// ─── quick view（B1/B2 快速试戴：上传款式图 + 手图，勾选保持甲型，直接生成）─────

function QuickView() {
  const [styleFile, setStyleFile] = useState<{ url: string } | null>(null);
  const [keepShape, setKeepShape] = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  // 手图裁图状态
  const [handRawUrl,      setHandRawUrl]      = useState<string | null>(null);
  const [handCropBox,     setHandCropBox]     = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [handCropNatural, setHandCropNatural] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  const [handCropped,     setHandCropped]     = useState<string | null>(null); // 裁图后的 dataURL

  const styleInputRef = useRef<HTMLInputElement>(null);
  const handInputRef  = useRef<HTMLInputElement>(null);

  // 上传款式图：直接用原图
  function handleStyleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setStyleFile({ url: URL.createObjectURL(file) });
    setResultUrl(null);
    setToast("✓ 款式图已上传");
  }

  // 上传手图：展示原图 + 初始化裁框
  async function handleHandUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setResultUrl(null);
    setHandCropped(null);
    const rawUrl = URL.createObjectURL(file);
    setHandRawUrl(rawUrl);
    const img = await loadHtmlImage(rawUrl);
    const natW = img.naturalWidth, natH = img.naturalHeight;
    setHandCropNatural({ w: natW, h: natH });
    const bw = Math.min(natW, (natH * 2) / 3);
    const bh = bw * 1.5;
    setHandCropBox({ x: (natW - bw) / 2, y: (natH - bh) / 2, w: bw, h: bh });
    setToast("手图已上传，请调整裁框后确认");
  }

  // 确认裁图
  async function confirmHandCrop() {
    if (!handRawUrl || !handCropBox) return;
    const img = await loadHtmlImage(handRawUrl);
    const { w: natW, h: natH } = handCropNatural;
    const sx = Math.max(0, Math.min(handCropBox.x, img.naturalWidth - 1));
    const sy = Math.max(0, Math.min(handCropBox.y, img.naturalHeight - 1));
    const sw = Math.max(1, Math.min(handCropBox.w, img.naturalWidth - sx));
    const sh = Math.max(1, Math.min(handCropBox.h, img.naturalHeight - sy));
    const canvas = document.createElement("canvas");
    canvas.width = 1024; canvas.height = 1536;
    canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, 1024, 1536);
    setHandCropped(canvas.toDataURL("image/png"));
    setHandRawUrl(null);
    setToast("✓ 裁图完成 1024×1536");
    void natW; void natH;
  }

  async function generate() {
    if (!styleFile || !handCropped) return setToast("请先上传款式图并确认裁图");
    setLoading(true);
    setToast("AI 试戴生成中，约 1-2 分钟…");
    try {
      const [styleBase64, handBase64] = await Promise.all([
        urlToBase64(styleFile.url),
        urlToBase64(handCropped),
      ]);
      const resultDataUrl = await callTryonDirect(styleBase64, handBase64, keepShape ? "full_keep" : "full");
      setResultUrl(resultDataUrl);
      setToast("✓ 试戴生成成功");
    } catch (e) {
      setToast(`生成出错：${String(e).slice(0, 60)}`);
    } finally { setLoading(false); }
  }

  return (
    <div className="flex h-full gap-3 overflow-hidden p-3">
      {/* ── 左栏 ── */}
      <Card className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto p-4 scrollbar-soft">
        <PanelTitle title="快速试戴" subtitle="上传款式图 + 手图，确认裁图后生成" />

        {/* 款式图 */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-mist">款式图</p>
          <button onClick={() => styleInputRef.current?.click()}
            className="flex h-32 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-orchid-200 bg-orchid-50 transition-all duration-150 hover:border-orchid-400 hover:bg-orchid-100/60 hover:shadow-glow-sm active:scale-[0.98]">
            {styleFile
              ? <img src={styleFile.url} alt="款式" className="h-full w-full object-contain p-1" /> // eslint-disable-line @next/next/no-img-element
              : <div className="flex flex-col items-center gap-1.5 text-mist"><ImageUp className="h-5 w-5 text-orchid-300" /><span className="text-xs">点击上传款式图</span></div>}
          </button>
          <input ref={styleInputRef} type="file" accept="image/*" className="hidden" onChange={handleStyleUpload} />
        </div>

        {/* 手图：上传后显示裁框，确认后显示缩略图 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-mist">手图</p>
            {handCropped && (
              <GhostButton onClick={() => { setHandCropped(null); setHandRawUrl(null); }} className="h-6 px-2 text-[10px]">
                重新上传
              </GhostButton>
            )}
          </div>

          {/* 未上传 */}
          {!handRawUrl && !handCropped && (
            <button onClick={() => handInputRef.current?.click()}
              className="flex h-32 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-orchid-200 bg-orchid-50 transition-all duration-150 hover:border-orchid-400 hover:bg-orchid-100/60 hover:shadow-glow-sm active:scale-[0.98]">
              <div className="flex flex-col items-center gap-1.5 text-mist">
                <ImageUp className="h-5 w-5 text-orchid-300" />
                <span className="text-xs">点击上传手图</span>
              </div>
            </button>
          )}

          {/* 裁图界面 */}
          {handRawUrl && handCropBox && (
            <div className="flex flex-col gap-2">
              <div className="relative w-full overflow-hidden rounded-2xl bg-orchid-50" data-canvas>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={handRawUrl} alt="手图" className="block w-full h-auto" draggable={false} />
                {/* 裁框遮罩 */}
                {(() => {
                  const { w: natW, h: natH } = handCropNatural;
                  const lp = (handCropBox.x / natW) * 100;
                  const tp = (handCropBox.y / natH) * 100;
                  const wp = (handCropBox.w / natW) * 100;
                  const hp = (handCropBox.h / natH) * 100;
                  return (
                    <div className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] cursor-move touch-none z-10"
                      style={{ left: `${lp}%`, top: `${tp}%`, width: `${wp}%`, height: `${hp}%` }}
                      onPointerDown={(ev) => {
                        ev.preventDefault();
                        const cnv = ev.currentTarget.closest("[data-canvas]") as HTMLElement;
                        const rect = cnv.getBoundingClientRect();
                        const sx = ev.clientX, sy = ev.clientY, sb = { ...handCropBox };
                        const onMove = (e: globalThis.PointerEvent) => {
                          const dx = ((e.clientX - sx) / rect.width) * natW;
                          const dy = ((e.clientY - sy) / rect.height) * natH;
                          setHandCropBox({ ...sb, x: Math.max(0, Math.min(natW - sb.w, sb.x + dx)), y: Math.max(0, Math.min(natH - sb.h, sb.y + dy)) });
                        };
                        const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                        window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                      }}>
                      {/* 缩放手柄 */}
                      <span className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full bg-white border-2 border-orchid-500 cursor-nwse-resize z-20"
                        onPointerDown={(ev) => {
                          ev.preventDefault(); ev.stopPropagation();
                          const cnv = ev.currentTarget.closest("[data-canvas]") as HTMLElement;
                          const rect = cnv.getBoundingClientRect();
                          const sx = ev.clientX, sy = ev.clientY, sw = handCropBox.w;
                          const onMove = (e: globalThis.PointerEvent) => {
                            const delta = (((e.clientX - sx) / rect.width) * natW + ((e.clientY - sy) / rect.height) * natH) / 2;
                            const maxW = Math.min(natW, (natH * 2) / 3);
                            const newW = Math.max(80, Math.min(maxW, sw + delta));
                            const newH = newW * 1.5;
                            setHandCropBox((p) => p ? { ...p, w: newW, h: newH, x: Math.max(0, Math.min(natW - newW, p.x)), y: Math.max(0, Math.min(natH - newH, p.y)) } : p);
                          };
                          const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                          window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                        }} />
                    </div>
                  );
                })()}
              </div>
              <GradientButton className="w-full" onClick={confirmHandCrop}>
                <Check className="h-3.5 w-3.5" />确认裁图 1024×1536
              </GradientButton>
            </div>
          )}

          {/* 裁图完成缩略图 */}
          {handCropped && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={handCropped} alt="手图" className="w-full rounded-2xl border border-orchid-100 object-contain" style={{ aspectRatio: "2/3" }} />
          )}

          <input ref={handInputRef} type="file" accept="image/*" className="hidden" onChange={handleHandUpload} />
        </div>

        {/* 保持甲型 */}
        <label className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-orchid-100 bg-white p-3 hover:border-orchid-300">
          <input type="checkbox" checked={keepShape} onChange={(e) => setKeepShape(e.target.checked)} className="h-4 w-4 rounded accent-orchid-500" />
          <div>
            <p className="text-xs font-semibold text-plum">保持自身甲型不变</p>
            <p className="text-[10px] text-mist">只换图案，不改变指甲长度与弧度</p>
          </div>
        </label>

        <GradientButton className="w-full" onClick={generate} disabled={loading || !styleFile || !handCropped}>
          <Wand2 className="h-4 w-4" />{loading ? "生成中…" : "开始生成"}
        </GradientButton>
      </Card>

      {/* ── 右栏：结果 ── */}
      <Card className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <PanelTitle title="试戴结果" subtitle={resultUrl ? "生成成功" : "等待生成…"} />
          {resultUrl && (
            <a href={resultUrl} download="nail-tryon-quick.png">
              <GhostButton><Download className="h-3.5 w-3.5" />下载</GhostButton>
            </a>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-3xl bg-orchid-50">
          {resultUrl
            ? <img src={resultUrl} alt="试戴结果" className="animate-reveal max-h-full rounded-2xl object-contain shadow-soft" /> // eslint-disable-line @next/next/no-img-element
            : <div className="flex flex-col items-center gap-2 text-mist"><Sparkles className="h-8 w-8 opacity-20" /><p className="text-sm">上传图片并确认裁图后点「开始生成」</p></div>}
        </div>
      </Card>

      {toast && (
        <button onClick={() => setToast("")}
          className="animate-slide-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-opacity hover:opacity-80">
          {toast}
        </button>
      )}
    </div>
  );
}

// ─── shared sub-components ────────────────────────────────────────────────────

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="shrink-0">
      <h2 className="text-sm font-bold text-plum">{title}</h2>
      <p className="mt-0.5 text-xs text-mist">{subtitle}</p>
    </div>
  );
}

// EditableImageCanvas: w-full h-auto，让容器精确匹配图片尺寸，不使用 object-contain
// 这样框的百分比坐标能和图片像素坐标对齐
function EditableImageCanvas({ image, className, children }: { image: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("relative w-full overflow-hidden rounded-[20px] bg-orchid-50", className)} data-canvas>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="block w-full h-auto" draggable={false} />
      {children}
    </div>
  );
}

type ResizeEdge = "move" | "n" | "s" | "e" | "w" | "rotate";

/**
 * 中点坐标编辑器（用于目标手图指甲框）
 * 显示4条边的中点坐标 T/B/L/R，修改任一值只影响对应边，对边固定
 */
function MidpointBoxEditor({ box, onPatch }: { box?: Box; onPatch: (patch: Partial<Box>) => void }) {
  if (!box) return <p className="text-xs text-mist">目标框：未选择</p>;
  const T = Math.round(box.y * 10) / 10;
  const B = Math.round((box.y + box.height) * 10) / 10;
  const L = Math.round(box.x * 10) / 10;
  const R = Math.round((box.x + box.width) * 10) / 10;
  return (
    <div className="flex items-center gap-1 rounded-xl bg-red-50 px-2 py-1">
      <span className="shrink-0 text-[10px] font-semibold text-red-400">边中点</span>
      {([["T", T, (v: number) => onPatch({ y: v, height: Math.max(2, B - v) })],
         ["B", B, (v: number) => onPatch({ height: Math.max(2, v - box.y) })],
         ["L", L, (v: number) => onPatch({ x: v, width: Math.max(2, R - v) })],
         ["R", R, (v: number) => onPatch({ width: Math.max(2, v - box.x) })],
      ] as [string, number, (v: number) => void][]).map(([lbl, val, handler]) => (
        <label key={lbl} className="flex items-center gap-0.5 text-[10px] text-mist">
          <span className="font-semibold text-red-500">{lbl}</span>
          <input type="number" step="0.1" value={val}
            onChange={(e) => handler(Number(e.target.value))}
            className="w-12 rounded-lg border border-red-100 bg-white px-1 py-0.5 text-[10px] text-plum outline-none focus:border-red-400" />
        </label>
      ))}
    </div>
  );
}

/**
 * EditableBox — 4个边中点圆圈方案
 * 所有元素直接挂在 data-canvas 坐标系下（fragment），互相独立，不存在事件传播歧义。
 * 圆圈直径16px，点击目标明确；视觉边线 pointer-events-none 不干扰事件。
 */
function EditableBox({ box, label, active, onSelect, onPatch, children, directionVector, accentColor = "#ef4444" }: {
  box: Box; label: string; active: boolean;
  onSelect: () => void; onPatch: (patch: Partial<Box>) => void;
  children?: React.ReactNode;
  directionVector?: { x: number; y: number };
  accentColor?: string;
}) {
  const { x, y, width, height } = box;
  const θ = ((box.rotation ?? 0) * Math.PI) / 180;
  const cosθ = Math.cos(θ), sinθ = Math.sin(θ);
  const cx = x + width / 2, cy = y + height / 2;

  // 4个边中点：旋转后的实际 canvas 百分比坐标
  // 旋转矩阵（顺时针 θ）：(px,py) → (px·cosθ+py·sinθ, -px·sinθ+py·cosθ) — CSS屏幕坐标系
  // 上边中点：box局部 (0, -h/2) → 屏幕 (cx+(h/2)·sinθ, cy-(h/2)·cosθ)
  const mT = { x: cx + (height / 2) * sinθ,  y: cy - (height / 2) * cosθ };
  const mB = { x: cx - (height / 2) * sinθ,  y: cy + (height / 2) * cosθ };
  const mL = { x: cx - (width  / 2) * cosθ,  y: cy - (width  / 2) * sinθ };
  const mR = { x: cx + (width  / 2) * cosθ,  y: cy + (width  / 2) * sinθ };

  function startMidDrag(e: React.PointerEvent, edge: ResizeEdge) {
    e.preventDefault(); e.stopPropagation(); onSelect();
    const canvas = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement | null;
    const rect = canvas?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX, sy = e.clientY;
    const b = { ...box };
    const onMove = (ev: globalThis.PointerEvent) => {
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      const bθ = ((b.rotation ?? 0) * Math.PI) / 180;
      const bc = Math.cos(bθ), bs = Math.sin(bθ);
      if (edge === "rotate") {
        const rcx = rect.left + ((b.x + b.width / 2) / 100) * rect.width;
        const rcy = rect.top  + ((b.y + b.height/ 2) / 100) * rect.height;
        onPatch({ rotation: Math.round(Math.atan2(ev.clientY - rcy, ev.clientX - rcx) * (180 / Math.PI) + 90) });
        return;
      }
      if (edge === "move") { onPatch({ x: b.x + dx, y: b.y + dy }); return; }

      // 每个中点拖拽：先把鼠标位移投影到该边法向量上，再沿旋转坐标系更新 x/y/w/h
      // 对边始终固定：下线锚定(n)、上线锚定(s)、右线锚定(w)、左线锚定(e)
      if (edge === "n") {
        // 上边法向：box局部 (0,-1) → 屏幕 (sinθ, -cosθ)
        const p = dx * bs - dy * bc;   // 正值=向上伸长
        onPatch({ x: b.x + p / 2 * bs, y: b.y - p / 2 * (1 + bc), height: Math.max(2, b.height + p) });
        return;
      }
      if (edge === "s") {
        // 下边法向：box局部 (0,+1) → 屏幕 (-sinθ, cosθ)
        const p = -dx * bs + dy * bc;  // 正值=向下伸长
        onPatch({ x: b.x - p / 2 * bs, y: b.y + p / 2 * (bc - 1), height: Math.max(2, b.height + p) });
        return;
      }
      if (edge === "e") {
        // 右边法向：box局部 (+1,0) → 屏幕 (cosθ, sinθ)
        const p = dx * bc + dy * bs;   // 正值=向右伸长
        onPatch({ x: b.x + p / 2 * (bc - 1), y: b.y + p / 2 * bs, width: Math.max(2, b.width + p) });
        return;
      }
      if (edge === "w") {
        // 左边法向：box局部 (-1,0) → 屏幕 (-cosθ, -sinθ)
        const p = -dx * bc - dy * bs;  // 正值=向左伸长
        onPatch({ x: b.x - p / 2 * (1 + bc), y: b.y - p / 2 * bs, width: Math.max(2, b.width + p) });
      }
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  }

  const lineColor = active ? accentColor : `${accentColor}88`;
  const zi = active ? 20 : 10;

  return (
    <>
      {/* ── 视觉容器：旋转变换在此应用，pointer-events-none 不干扰交互 ── */}
      <div className="absolute pointer-events-none" style={{
        left:`${x}%`, top:`${y}%`, width:`${width}%`, height:`${height}%`,
        transform:`rotate(${box.rotation ?? 0}deg)`, transformOrigin:"center center",
        zIndex: zi - 5,
      }}>
        {/* 实线框，统一 1.5px，选中时颜色更亮 */}
        <div className="absolute inset-0" style={{ border: `1.5px solid ${lineColor}` }} />
        {/* StyleThumb */}
        <div className="absolute inset-0 overflow-hidden">{children}</div>
      </div>

      {/* ── 中心移动热区 ── */}
      <div className="absolute cursor-move"
        style={{ left:`${x+width*0.2}%`, top:`${y+height*0.2}%`, width:`${width*0.6}%`, height:`${height*0.6}%`, zIndex: zi }}
        onPointerDown={(e) => startMidDrag(e, "move")}
        onClick={(e) => { e.stopPropagation(); onSelect(); }} />

      {/* ── 上边中点圆圈 ── */}
      <div className="absolute cursor-ns-resize grid place-items-center touch-none"
        style={{ left:`${mT.x}%`, top:`${mT.y}%`, width:16, height:16, transform:"translate(-50%,-50%)", zIndex: zi + 2 }}
        onPointerDown={(e) => startMidDrag(e, "n")}>
        <div className="rounded-full border-2 border-white shadow-md"
          style={{ width: active ? 12 : 10, height: active ? 12 : 10, background: accentColor }} />
      </div>
      {/* ── 下边中点圆圈 ── */}
      <div className="absolute cursor-ns-resize grid place-items-center touch-none"
        style={{ left:`${mB.x}%`, top:`${mB.y}%`, width:16, height:16, transform:"translate(-50%,-50%)", zIndex: zi + 2 }}
        onPointerDown={(e) => startMidDrag(e, "s")}>
        <div className="rounded-full border-2 border-white shadow-md"
          style={{ width: active ? 12 : 10, height: active ? 12 : 10, background: active ? accentColor : "#fff", border: `2px solid ${accentColor}` }} />
      </div>
      {/* ── 左边中点圆圈 ── */}
      <div className="absolute cursor-ew-resize grid place-items-center touch-none"
        style={{ left:`${mL.x}%`, top:`${mL.y}%`, width:16, height:16, transform:"translate(-50%,-50%)", zIndex: zi + 2 }}
        onPointerDown={(e) => startMidDrag(e, "w")}>
        <div className="rounded-full border-2 border-white shadow-md"
          style={{ width: active ? 12 : 10, height: active ? 12 : 10, background: active ? accentColor : "#fff", border: `2px solid ${accentColor}` }} />
      </div>
      {/* ── 右边中点圆圈 ── */}
      <div className="absolute cursor-ew-resize grid place-items-center touch-none"
        style={{ left:`${mR.x}%`, top:`${mR.y}%`, width:16, height:16, transform:"translate(-50%,-50%)", zIndex: zi + 2 }}
        onPointerDown={(e) => startMidDrag(e, "e")}>
        <div className="rounded-full border-2 border-white shadow-md"
          style={{ width: active ? 12 : 10, height: active ? 12 : 10, background: active ? accentColor : "#fff", border: `2px solid ${accentColor}` }} />
      </div>

      {/* ── 标签 ── */}
      <span className="absolute pointer-events-none rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow leading-none text-white"
        style={{ left:`${x}%`, top:`${y}%`, transform:"translate(2px,2px)", zIndex: zi + 1, background: accentColor }}>
        {label}
      </span>

      {/* ── 旋转按钮（仅选中时）── */}
      {active && (
        <button type="button"
          className="absolute grid h-5 w-5 place-items-center rounded-full bg-white/90 shadow touch-none"
          style={{ left:`${x+width}%`, top:`${y}%`, transform:"translate(-100%,0)", zIndex: zi + 3, color: accentColor }}
          onPointerDown={(e) => startMidDrag(e, "rotate")}>
          <RotateCw className="h-3 w-3" />
        </button>
      )}
    </>
  );
}

function StyleThumb({ style, placement, className }: { style: NailStyle; placement?: Placement; className?: string }) {
  const rotation = (style.rotation + (placement?.rotation ?? 0)) % 360;
  const flip = style.flipVertical || placement?.flipVertical;
  const xform: React.CSSProperties = { transform: `rotate(${rotation}deg) scaleY(${flip ? -1 : 1})` };
  const rasterSrc = placement ? (style.pieceSrc ?? style.styleSrc) : (style.previewSrc ?? style.pieceSrc ?? style.styleSrc);

  if (rasterSrc) {
    if (placement) {
      // 贴在指甲框上：等比缩放，靠下对齐（指甲根部贴近框底线）
      return (
        <div className={cn("overflow-hidden bg-transparent", className)} style={xform}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={rasterSrc}
            alt={style.label}
            className="block h-full w-full object-contain"
            style={{ objectPosition: "bottom center" }}
          />
        </div>
      );
    }

    return (
      <div className={cn("grid place-items-center overflow-hidden bg-white", !placement && "p-2", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={rasterSrc}
          alt={style.label}
          className={cn(
            "object-contain",
            placement ? "h-auto w-auto max-h-full max-w-full" : "max-h-full max-w-full"
          )}
          style={xform}
        />
      </div>
    );
  }

  // CSS 裁切 — 用 transform: translate 而不是 left/top %
  // 因为 translate(X%, Y%) 的百分比是相对元素自身宽高，
  // 而 left/top 的百分比是相对容器宽/高，两者含义不同。
  if (style.sourceImageUrl && style.sourceBox) {
    const { x, y, width } = style.sourceBox;
    // 图片宽度设为容器的 (100/width)%，即把整张图缩放到 box 区域恰好填满容器
    const imgWidthPct = 100 / width * 100;  // e.g. box.width=14% → img=714% of container
    // translate: -x% of image width = -(x/100)*(imgWidth), -y% of image height (square assumed)
    return (
      <div className={cn("relative overflow-hidden bg-orchid-50", className)} style={xform}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={style.sourceImageUrl} alt={style.label}
          className="absolute pointer-events-none"
          style={{
            width: `${imgWidthPct}%`,
            top: 0,
            left: 0,
            transform: `translate(-${x}%, -${y}%)`,  // % 相对图片自身尺寸
          }}
          draggable={false}
        />
      </div>
    );
  }
  if (style.imageUrl) {
    return (
      <div className={cn("overflow-hidden bg-white", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={style.imageUrl} alt={style.label} className="h-full w-full object-cover" style={xform} />
      </div>
    );
  }
  // 兜底：渐变色块
  const swatches = ["from-[#f2d7ff] to-[#d58cff]","from-[#d8c8ff] to-[#8f7bff]","from-[#fff6fb] to-[#d2b6ff]"];
  const swatch = swatches[parseInt(style.id.replace(/\D/g, ""), 10) % swatches.length];
  return (
    <div className={cn("grid place-items-center overflow-hidden rounded-xl bg-gradient-to-br", swatch, className)} style={xform}>
      <span className="text-[10px] font-semibold text-white/80">{style.label}</span>
    </div>
  );
}

function SortablePlacementRow({ placement, target, style, active, onSelect, onRotate, onFlip, onDelete, onCopy }: {
  placement: Placement; target?: TargetNail; style?: NailStyle; active: boolean;
  onSelect: (id: string) => void; onRotate: (id: string) => void; onFlip: (id: string) => void;
  onDelete: (id: string) => void; onCopy: (id: string) => void;
}) {
  const sortable = useSortable({ id: placement.id });
  return (
    <div ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      onClick={() => onSelect(placement.targetNailId)}
      className={cn("rounded-2xl border p-2.5 cursor-pointer",
        active ? "border-orchid-500 bg-orchid-50" : "border-orchid-100 bg-white")}>
      <div className="flex items-center gap-2">
        <button {...sortable.attributes} {...sortable.listeners} className="cursor-grab text-orchid-300">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-orchid-50">
          {style ? <StyleThumb style={style} placement={placement} className="h-full w-full object-contain" /> : <span className="text-xs text-mist">空</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-plum">{target?.label ?? placement.targetNailId}</p>
          <p className="truncate text-xs text-mist">{style ? `${style.label} / ${placement.rotation}°` : "未绑定"}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <button onClick={(e) => { e.stopPropagation(); onCopy(placement.targetNailId); }} className="rounded-full bg-orchid-50 py-1 text-xs font-semibold text-orchid-600"><Copy className="mx-auto h-3 w-3" /></button>
        <button onClick={(e) => { e.stopPropagation(); onRotate(placement.targetNailId); }} className="rounded-full bg-orchid-50 py-1 text-xs font-semibold text-orchid-600">旋转</button>
        <button onClick={(e) => { e.stopPropagation(); onFlip(placement.targetNailId); }} className="rounded-full bg-orchid-50 py-1 text-xs font-semibold text-orchid-600">翻转</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(placement.targetNailId); }} className="rounded-full bg-rose-50 py-1 text-xs font-semibold text-rose-500">删除</button>
      </div>
    </div>
  );
}

function BoxEditor({ title, box, onPatch }: { title: string; box?: Box; onPatch: (patch: Partial<Box>) => void }) {
  const fields: Array<["x" | "y" | "width" | "height" | "rotation", string]> = [["x", "X"], ["y", "Y"], ["width", "W"], ["height", "H"], ["rotation", "R"]];
  if (!box) return <p className="text-xs text-mist">{title}：未选择</p>;
  return (
    <div className="flex items-center gap-1 rounded-xl bg-orchid-50 px-2 py-1">
      <span className="shrink-0 text-[10px] font-semibold text-mist">{title}</span>
      {fields.map(([key, label]) => (
        <label key={key} className="flex items-center gap-0.5 text-[10px] text-mist">
          <span className="font-semibold">{label}</span>
          <input type="number" value={Math.round(Number(box[key] ?? 0) * 10) / 10}
            onChange={(e) => onPatch({ [key]: Number(e.target.value) })}
            className="w-12 rounded-lg border border-orchid-100 bg-white px-1 py-0.5 text-[10px] text-plum outline-none focus:border-orchid-500" />
        </label>
      ))}
    </div>
  );
}

function Control({ label, value, min, max, suffix, onChange }: {
  label: string; value: number; min: number; max: number; suffix: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-2xl bg-white/70 p-3">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold">
        <span className="text-plum">{label}</span>
        <span className="text-orchid-600">{value}{suffix}</span>
      </div>
      <input type="range" value={value} min={min} max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-orchid-500" />
    </label>
  );
}

// ─── 通用工具 ─────────────────────────────────────────────────────────────────

/** blob/objectURL/dataURL → base64 dataURL */
async function urlToBase64(url: string): Promise<string> {
  const res  = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** 居中裁剪图片到 1024×1536（2:3 竖图），返回 dataURL */
async function centerCropTo1024x1536(src: string): Promise<string> {
  const img = await loadHtmlImage(src);
  const targetW = 1024, targetH = 1536;
  const srcRatio = img.naturalWidth / img.naturalHeight;
  const dstRatio = targetW / targetH;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (srcRatio > dstRatio) {
    sw = img.naturalHeight * dstRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / dstRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetW; canvas.height = targetH;
  canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/png");
}

// ─── pixel helpers ────────────────────────────────────────────────────────────

async function detectPixelSeparatedStyleBoxes(imageUrl: string): Promise<StyleBox[]> {
  const image = await loadHtmlImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // 优先用连通域——图片是透明底时最准确
  const components = detectOpaqueComponents(data, canvas.width, canvas.height);
  if (components.length >= 2 && components.length <= 6) {
    return components.map((region, index) => {
      const id = `style_pixel_${index + 1}`;
      return {
        id, confirmed: true,
        box: {
          id,
          x: (region.x / canvas.width) * 100,
          y: (region.y / canvas.height) * 100,
          width: (region.width / canvas.width) * 100,
          height: (region.height / canvas.height) * 100,
          rotation: 0,
        },
      };
    });
  }

  // 降级：列像素密度扫描（适合白底但有明显空隙的图）
  const columnScores = new Array(canvas.width).fill(0);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (isNailContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) columnScores[x]++;
    }
  }
  const smoothed = columnScores.map((_, x) => {
    let sum = 0, count = 0;
    for (let off = -4; off <= 4; off++) {
      const nx = x + off;
      if (nx < 0 || nx >= canvas.width) continue;
      sum += columnScores[nx]; count++;
    }
    return sum / Math.max(1, count);
  });
  const threshold = Math.max(18, canvas.height * 0.02);
  const rough: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  for (let x = 0; x < canvas.width; x++) {
    if (smoothed[x] > threshold && start === null) { start = x; }
    else if ((smoothed[x] <= threshold || x === canvas.width - 1) && start !== null) {
      const end = x === canvas.width - 1 ? x : x - 1;
      if (end - start >= 42) rough.push({ start, end });
      start = null;
    }
  }
  const merged: Array<{ start: number; end: number }> = [];
  for (const seg of rough) {
    const prev = merged[merged.length - 1];
    if (prev && seg.start - prev.end < 28) prev.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged
    .map((seg) => tightenPixelRegion(data, canvas.width, canvas.height, seg.start, seg.end))
    .filter((r) => r.width > 45 && r.height > 80)
    .sort((a, b) => a.x - b.x)
    .slice(0, 5)
    .map((region, index) => {
      const id = `style_pixel_${index + 1}`;
      return {
        id, confirmed: true,
        box: {
          id,
          x: (region.x / canvas.width) * 100,
          y: (region.y / canvas.height) * 100,
          width: (region.width / canvas.width) * 100,
          height: (region.height / canvas.height) * 100,
          rotation: 0,
        },
      };
    });
}

function detectOpaqueComponents(data: Uint8ClampedArray, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    if (isNailContentPixel(data[p], data[p + 1], data[p + 2], data[p + 3])) mask[y * width + x] = 1;
  }
  const visited = new Uint8Array(width * height);
  const components: Array<{ x: number; y: number; width: number; height: number; area: number }> = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const idx = y * width + x;
    if (!mask[idx] || visited[idx]) continue;
    const comp = floodFillComponent(mask, visited, width, height, x, y);
    if (comp.area > 3500 && comp.width > 70 && comp.height > 150) components.push(comp);
  }
  return components
    .sort((a, b) => a.x - b.x)
    .slice(0, 5)
    .map((c) => expandPixelRegion(c, width, height, Math.max(3, Math.round(c.width * 0.03)), Math.max(4, Math.round(c.height * 0.03))));
}

function floodFillComponent(mask: Uint8Array, visited: Uint8Array, width: number, height: number, startX: number, startY: number) {
  const stack: Array<[number, number]> = [[startX, startY]];
  let minX = startX, maxX = startX, minY = startY, maxY = startY, area = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const [x, y] = node;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx] || !mask[idx]) continue;
    visited[idx] = 1; area++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area };
}

function tightenPixelRegion(data: Uint8ClampedArray, width: number, height: number, startX: number, endX: number) {
  let minX = endX, maxX = startX, minY = height, maxY = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = startX; x <= endX; x++) {
    const i = (y * width + x) * 4;
    if (!isNailContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
  }
  if (count < 500) return { x: startX, y: 0, width: endX - startX + 1, height };
  return expandPixelRegion(
    { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    width,
    height,
    3,
    4,
  );
}

function expandPixelRegion(
  region: { x: number; y: number; width: number; height: number },
  maxWidth: number,
  maxHeight: number,
  padX: number,
  padY: number,
) {
  const leftPad = Math.max(padX, Math.round(region.width * 0.03));
  const rightPad = Math.max(padX, Math.round(region.width * 0.03));
  const topPad = Math.max(Math.round(padY * 0.7), Math.round(region.height * 0.02));
  const bottomPad = Math.max(Math.round(padY * 1.1), Math.round(region.height * 0.05));
  const x = Math.max(0, region.x - leftPad);
  const y = Math.max(0, region.y - topPad);
  const right = Math.min(maxWidth, region.x + region.width + rightPad);
  const bottom = Math.min(maxHeight, region.y + region.height + bottomPad);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

// 将确认后的框真正裁成独立 PNG，保持原始比例，不做额外拉伸
async function makeStylePiecesFromBoxes(imageUrl: string, boxes: StyleBox[]): Promise<NailStyle[]> {
  const image = await loadHtmlImage(imageUrl);
  const confirmedBoxes = boxes.filter((b) => b.confirmed);
  return confirmedBoxes.map((srcBox, index) => {
    const rect = percentBoxToImageRect(srcBox.box, image.naturalWidth, image.naturalHeight);
    const refined = refineNailRect(image, rect, 2);
    const overlayRect = expandRect(
      refined,
      image,
      Math.max(1, Math.round(Math.min(refined.width, refined.height) * 0.02)),
    );
    const previewRect = expandRect(refined, image, 2);
    const pieceSrc = cropPiece(image, overlayRect, true);
    const previewSrc = cropPiece(image, previewRect, false);
    return {
      id: `style_piece_${srcBox.id}`,
      label: `款式 ${index + 1}`,
      category: "全部",
      rotation: 0,
      flipVertical: false,
      pieceSrc,
      previewSrc,
      sourceImageUrl: imageUrl,
      sourceBox: { x: srcBox.box.x, y: srcBox.box.y, width: srcBox.box.width, height: srcBox.box.height },
    } satisfies NailStyle;
  });
}

async function splitBoxByPixelGap(imageUrl: string, box: Box): Promise<[Box, Box] | null> {
  const image = await loadHtmlImage(imageUrl);
  const rect = percentBoxToImageRect(box, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, rect.width); canvas.height = Math.max(1, rect.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scores = new Array(canvas.width).fill(0);
  for (let x = 0; x < canvas.width; x++) for (let y = 0; y < canvas.height; y++) {
    const i = (y * canvas.width + x) * 4;
    if (isNailContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) scores[x]++;
  }
  const start = Math.floor(canvas.width * 0.25), end = Math.floor(canvas.width * 0.75);
  let bestX = -1, bestScore = Infinity;
  for (let x = start; x <= end; x++) {
    const score = scores.slice(Math.max(0, x - 3), Math.min(canvas.width, x + 4)).reduce((s, v) => s + v, 0);
    if (score < bestScore) { bestScore = score; bestX = x; }
  }
  if (bestX < 18 || bestX > canvas.width - 18) return null;
  const splitPercent = (bestX / canvas.width) * box.width;
  const leftWidth = splitPercent, rightX = box.x + splitPercent, rightWidth = box.width - splitPercent;
  if (leftWidth < 3 || rightWidth < 3) return null;
  return [clampBox({ ...box, width: leftWidth }), clampBox({ ...box, x: rightX, width: rightWidth })];
}

async function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  // Fetch non-blob/data URLs as a blob first so the canvas is never tainted
  // (Next.js dev server doesn't send CORS headers for static assets)
  let url = src;
  if (!src.startsWith("blob:") && !src.startsWith("data:")) {
    const res = await fetch(src);
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function percentBoxToImageRect(box: Box, w: number, h: number) {
  return { x: Math.round((box.x / 100) * w), y: Math.round((box.y / 100) * h), width: Math.max(1, Math.round((box.width / 100) * w)), height: Math.max(1, Math.round((box.height / 100) * h)) };
}

function refineNailRect(image: HTMLImageElement, rect: { x: number; y: number; width: number; height: number }, padding: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, rect.width); canvas.height = Math.max(1, rect.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return rect;
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0, count = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    if (!isNailContentPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); count++;
  }
  if (count < 800) return rect;
  return { x: Math.max(0, rect.x + minX - padding), y: Math.max(0, rect.y + minY - padding), width: Math.max(1, Math.min(image.naturalWidth, rect.x + maxX + padding) - Math.max(0, rect.x + minX - padding)), height: Math.max(1, Math.min(image.naturalHeight, rect.y + maxY + padding) - Math.max(0, rect.y + minY - padding)) };
}

function expandRect(rect: { x: number; y: number; width: number; height: number }, image: HTMLImageElement, padding: number) {
  const x = Math.max(0, rect.x - padding), y = Math.max(0, rect.y - padding);
  return { x, y, width: Math.min(image.naturalWidth, rect.x + rect.width + padding) - x, height: Math.min(image.naturalHeight, rect.y + rect.height + padding) - y };
}

function cropPiece(image: HTMLImageElement, rect: { x: number; y: number; width: number; height: number }, transparentWhite: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width)); canvas.height = Math.max(1, Math.round(rect.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: transparentWhite });
  if (!ctx) return "";
  if (!transparentWhite) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
  if (transparentWhite) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data } = imageData;
    const width = canvas.width;
    const height = canvas.height;
    const visited = new Uint8Array(width * height);
    const stack: Array<[number, number]> = [];
    const pushIfBackground = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const idx = y * width + x;
      if (visited[idx]) return;
      const p = idx * 4;
      if (isNailContentPixel(data[p], data[p + 1], data[p + 2], data[p + 3])) return;
      visited[idx] = 1;
      stack.push([x, y]);
    };

    for (let x = 0; x < width; x++) {
      pushIfBackground(x, 0);
      pushIfBackground(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      pushIfBackground(0, y);
      pushIfBackground(width - 1, y);
    }

    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      const [x, y] = node;
      const idx = y * width + x;
      data[idx * 4 + 3] = 0;
      pushIfBackground(x + 1, y);
      pushIfBackground(x - 1, y);
      pushIfBackground(x, y + 1);
      pushIfBackground(x, y - 1);
    }
    ctx.putImageData(imageData, 0, 0);
    return trimTransparentCanvas(canvas);
  }
  return canvas.toDataURL("image/png");
}

function trimTransparentCanvas(source: HTMLCanvasElement) {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source.toDataURL("image/png");
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return source.toDataURL("image/png");
  const pad = 1;
  const cropX = Math.max(0, minX - pad);
  const cropY = Math.max(0, minY - pad);
  const cropW = Math.max(1, Math.min(width, maxX + pad + 1) - cropX);
  const cropH = Math.max(1, Math.min(height, maxY + pad + 1) - cropY);
  const out = document.createElement("canvas");
  out.width = cropW;
  out.height = cropH;
  const outCtx = out.getContext("2d");
  if (!outCtx) return source.toDataURL("image/png");
  outCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out.toDataURL("image/png");
}

function isNailContentPixel(r: number, g: number, b: number, alpha = 255) {
  if (alpha < 20) return false;
  const avg = (r + g + b) / 3, gap = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return avg < 246 || gap > 15;
}

/**
 * 根据指甲检测结果计算最优正方形裁图框：
 * 1. 取所有指甲 bbox 的并集
 * 2. 四周加 15% margin
 * 3. 扩为正方形（取长边）
 * 4. 尽量扩大到 min(imgW,imgH) 的 90%，最大化保留手部
 * 5. 以指甲中心为基准，夹紧到图片边界
 */
function buildSmartCropBox(
  detections: Array<{ bbox: [number, number, number, number] }>,
  imgW: number,
  imgH: number,
  mode: "square" | "portrait" = "square",
): { x: number; y: number; w: number; h: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const det of detections) {
    x1 = Math.min(x1, det.bbox[0]);
    y1 = Math.min(y1, det.bbox[1]);
    x2 = Math.max(x2, det.bbox[2]);
    y2 = Math.max(y2, det.bbox[3]);
  }
  const margin = Math.max(x2 - x1, y2 - y1) * 0.15;
  x1 = Math.max(0, x1 - margin);
  y1 = Math.max(0, y1 - margin);
  x2 = Math.min(imgW, x2 + margin);
  y2 = Math.min(imgH, y2 + margin);
  const cx = (x1 + x2) / 2;

  if (mode === "portrait") {
    // 竖图 2:3 — 横宽最大化：取图片宽或 natH*(2/3) 的较小值
    const w = Math.min(imgW, (imgH * 2) / 3);
    const h = w * 1.5;
    // 水平居中于指甲中心，垂直使指甲顶部距框顶 8%
    const boxX = Math.max(0, Math.min(imgW - w, cx - w / 2));
    const boxY = Math.max(0, Math.min(imgH - h, y1 - h * 0.08));
    return { x: boxX, y: boxY, w, h };
  }

  // 方图：至少覆盖指甲，尽量扩大到图片短边的 90%
  const needed = Math.max(x2 - x1, y2 - y1);
  const size = Math.min(Math.min(imgW, imgH), Math.max(needed, Math.min(imgW, imgH) * 0.9));
  return {
    x: Math.max(0, Math.min(imgW - size, cx - size / 2)),
    y: Math.max(0, Math.min(imgH - size, y1 - size * 0.1)),
    w: size,
    h: size,
  };
}

function clampBox(box: Box): Box {
  const width = Math.max(2, Math.min(100, box.width)), height = Math.max(2, Math.min(100, box.height));
  return { ...box, x: Math.max(0, Math.min(100 - width, box.x)), y: Math.max(0, Math.min(100 - height, box.y)), width, height, rotation: box.rotation ?? 0 };
}


