"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, ArrowLeft, RefreshCw } from "lucide-react";

import { GhostButton, GradientButton } from "@/components/ui";
import { handUploadStore } from "@/lib/hand-upload-store";

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

interface CropBox { x: number; y: number; w: number; h: number }

export default function HandCropPage() {
  const router = useRouter();
  const { rawUrl, natural } = handUploadStore.get();
  const { w: natW, h: natH } = natural;

  const [cropBox, setCropBox] = useState<CropBox>(() => {
    const bw = Math.min(natW, (natH * 2) / 3);
    const bh = bw * 1.5;
    return { x: (natW - bw) / 2, y: (natH - bh) / 2, w: bw, h: bh };
  });
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // 没有图就直接回首页
  useEffect(() => {
    if (!rawUrl) router.replace("/catalog");
  }, [rawUrl, router]);

  if (!rawUrl) return null;

  // 百分比坐标（供 CSS 定位）
  const lp = (cropBox.x / natW) * 100;
  const tp = (cropBox.y / natH) * 100;
  const wp = (cropBox.w / natW) * 100;
  const hp = (cropBox.h / natH) * 100;

  function resetCrop() {
    const bw = Math.min(natW, (natH * 2) / 3);
    const bh = bw * 1.5;
    setCropBox({ x: (natW - bw) / 2, y: (natH - bh) / 2, w: bw, h: bh });
  }

  async function confirmCrop() {
    setSaving(true);
    try {
      const img = await loadHtmlImage(rawUrl!);
      const sx = Math.max(0, Math.min(cropBox.x, img.naturalWidth - 1));
      const sy = Math.max(0, Math.min(cropBox.y, img.naturalHeight - 1));
      const sw = Math.max(1, Math.min(cropBox.w, img.naturalWidth - sx));
      const sh = Math.max(1, Math.min(cropBox.h, img.naturalHeight - sy));
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 1536;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, 1024, 1536);
      const imageBase64 = canvas.toDataURL("image/png");

      await fetch("/api/hand-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      });

      handUploadStore.clear();
      router.push("/catalog?hand=saved");
    } catch {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ── header bar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-orchid-100 bg-white px-5 py-3">
        <GhostButton onClick={() => { handUploadStore.clear(); router.back(); }}>
          <ArrowLeft className="h-4 w-4" />返回
        </GhostButton>
        <div className="flex-1">
          <p className="text-sm font-bold text-plum">裁剪手图</p>
          <p className="text-[11px] text-mist">拖动白框移动 · 拖右下角手柄缩放 · 固定 2:3 竖图输出 1024×1536</p>
        </div>
        <GhostButton onClick={resetCrop}>
          <RefreshCw className="h-3.5 w-3.5" />重置
        </GhostButton>
        <GradientButton onClick={confirmCrop} disabled={saving}>
          <Check className="h-4 w-4" />
          {saving ? "保存中…" : "确认裁图 1024×1536"}
        </GradientButton>
      </div>

      {/* ── crop canvas ── */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-orchid-50 p-6 scrollbar-soft">
        <div
          className="relative w-full max-w-sm"
          data-canvas
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={rawUrl}
            alt="手图"
            className="block w-full h-auto"
            draggable={false}
          />

          {/* dim overlay outside frame */}
          <div className="pointer-events-none absolute inset-0 bg-black/30" />

          {/* draggable crop frame */}
          <div
            className="absolute cursor-move touch-none z-10"
            style={{
              left: `${lp}%`, top: `${tp}%`,
              width: `${wp}%`, height: `${hp}%`,
              border: "2px solid #fff",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)",
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
              const rect = cnv.getBoundingClientRect();
              const startX = e.clientX, startY = e.clientY;
              const sb = { ...cropBox };
              const onMove = (ev: PointerEvent) => {
                const dx = ((ev.clientX - startX) / rect.width) * natW;
                const dy = ((ev.clientY - startY) / rect.height) * natH;
                setCropBox({
                  ...sb,
                  x: Math.max(0, Math.min(natW - sb.w, sb.x + dx)),
                  y: Math.max(0, Math.min(natH - sb.h, sb.y + dy)),
                });
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          >
            {/* label badge */}
            <span className="absolute -top-6 left-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-plum shadow whitespace-nowrap">
              1024×1536 竖图框（可拖动）
            </span>

            {/* resize handle — bottom-right */}
            <span
              className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full bg-white border-2 border-orchid-500 cursor-nwse-resize z-20 block"
              onPointerDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
                const rect = cnv.getBoundingClientRect();
                const startX = e.clientX, startY = e.clientY;
                const sw = cropBox.w;
                const onMove = (ev: PointerEvent) => {
                  const dxPx = ((ev.clientX - startX) / rect.width) * natW;
                  const dyPx = ((ev.clientY - startY) / rect.height) * natH;
                  const delta = (dxPx + dyPx) / 2;
                  const maxW = Math.min(natW, (natH * 2) / 3);
                  const newW = Math.max(80, Math.min(maxW, sw + delta));
                  const newH = newW * 1.5;
                  setCropBox((p) => ({
                    ...p, w: newW, h: newH,
                    x: Math.max(0, Math.min(natW - newW, p.x)),
                    y: Math.max(0, Math.min(natH - newH, p.y)),
                  }));
                };
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
