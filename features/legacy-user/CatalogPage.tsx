"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";

import { GhostButton, GradientButton } from "@/components/ui";
import TypeWriter from "@/components/TypeWriter";
import { nailStyles } from "./nailStyles";
import { useSelectedIds } from "./useSelectedIds";

const hotItems = [...nailStyles].sort((a, b) => b.hotScore - a.hotScore);
const styleMap  = new Map(nailStyles.map((s) => [s.id, s]));

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

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

// ─── HomePickCard ─────────────────────────────────────────────────────────────

function HomePickCard({
  item, selected, onToggle, maxReached, index,
}: {
  item: (typeof nailStyles)[number];
  selected: boolean;
  onToggle: () => void;
  maxReached: boolean;
  index: number;
}) {
  return (
    <article
      className="home-pick-card"
      data-style-id={item.id}
      style={{ "--i": index } as CSSProperties}
    >
      <button
        className={`nail-thumb home-pick-thumb ${item.image ? "has-image" : ""}`}
        style={{ "--thumb": item.thumb, "--nail": item.nail, "--accent": item.accent } as CSSProperties}
        type="button"
        aria-label={`查看${item.name}`}
      >
        {item.image ? <img src={item.image} alt={item.name} /> : null}
      </button>
      <div className="home-pick-copy">
        <span className="tag">{item.primaryTag}</span>
        <h3>{item.name}</h3>
        <p>{item.secondaryTag} · 热度 {item.hotScore}</p>
        <div className="home-pick-actions">
          <button
            className={`select-action ${selected ? "selected" : ""}`}
            type="button"
            onClick={onToggle}
            disabled={!selected && maxReached}
            title={!selected && maxReached ? "最多选 4 款" : undefined}
          >
            {selected ? "已加入" : maxReached ? "已满 4 款" : "加入试戴"}
          </button>
          <Link className="secondary-action" href="/style-library">详情</Link>
        </div>
      </div>
    </article>
  );
}

// ─── CatalogPage ──────────────────────────────────────────────────────────────

interface CropBox { x: number; y: number; w: number; h: number }

export default function CatalogPage() {
  const { selectedIds, toggleSelected } = useSelectedIds();
  const [query, setQuery] = useState("");

  // ── hand upload & crop ────────────────────────────────────────────────────
  const handInputRef      = useRef<HTMLInputElement>(null);
  const [handRawUrl,      setHandRawUrl]      = useState<string | null>(null);
  const [handCropNatural, setHandCropNatural] = useState({ w: 1, h: 1 });
  const [handCropBox,     setHandCropBox]     = useState<CropBox | null>(null);
  const [saving,          setSaving]          = useState(false);
  const [handSaved,       setHandSaved]       = useState(false); // 手图是否已上传到服务端
  const [toast,           setToast]           = useState<string | null>(null);

  // 挂载时检查服务端是否已有手图
  useEffect(() => {
    fetch("/api/hand-save")
      .then((r) => r.json())
      .then((d: { url?: string }) => { if (d.url) setHandSaved(true); })
      .catch(() => {});
  }, []);

  async function handleHandUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const url = URL.createObjectURL(file);
    const img = await loadHtmlImage(url);
    setHandCropNatural({ w: img.naturalWidth, h: img.naturalHeight });
    const bw = Math.min(img.naturalWidth, (img.naturalHeight * 2) / 3);
    const bh = bw * 1.5;
    setHandCropBox({ x: (img.naturalWidth - bw) / 2, y: (img.naturalHeight - bh) / 2, w: bw, h: bh });
    setHandRawUrl(url);
  }

  async function confirmCrop() {
    if (!handRawUrl || !handCropBox) return;
    setSaving(true);
    try {
      const img = await loadHtmlImage(handRawUrl);
      const { w: natW, h: natH } = handCropNatural; void natH;
      const sx = Math.max(0, Math.min(handCropBox.x, img.naturalWidth - 1));
      const sy = Math.max(0, Math.min(handCropBox.y, img.naturalHeight - 1));
      const sw = Math.max(1, Math.min(handCropBox.w, img.naturalWidth - sx));
      const sh = Math.max(1, Math.min(handCropBox.h, img.naturalHeight - sy));
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 1536;
      canvas.getContext("2d")!.drawImage(img, sx, sy, sw, sh, 0, 0, 1024, 1536);
      const imageBase64 = canvas.toDataURL("image/png"); void natW;
      await fetch("/api/hand-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
      });
      URL.revokeObjectURL(handRawUrl);
      setHandRawUrl(null); setHandCropBox(null);
      setHandSaved(true);
      showToast("✓ 手图已裁剪上传（1024×1536），试戴时将自动使用最新手图");
    } catch { showToast("保存失败，请重试"); }
    finally { setSaving(false); }
  }

  function cancelCrop() {
    if (handRawUrl) URL.revokeObjectURL(handRawUrl);
    setHandRawUrl(null); setHandCropBox(null);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }

  // 裁框派生坐标
  const { w: natW, h: natH } = handCropNatural;
  const lp = handCropBox ? (handCropBox.x / natW) * 100 : 0;
  const tp = handCropBox ? (handCropBox.y / natH) * 100 : 0;
  const wp = handCropBox ? (handCropBox.w / natW) * 100 : 0;
  const hp = handCropBox ? (handCropBox.h / natH) * 100 : 0;

  const filteredPicks = useMemo(() =>
    query
      ? nailStyles.filter((item) =>
          [item.name, item.primaryTag, item.secondaryTag, item.definition].some((t) =>
            t.toLowerCase().includes(query.toLowerCase())
          )
        )
      : hotItems,
  [query]);

  // 搜索变化时触发卡片重新挂载动效
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => { setAnimKey((k) => k + 1); }, [filteredPicks]);

  const selectedItems  = nailStyles.filter((item) => selectedIds.includes(item.id));
  const maxReached     = selectedIds.length >= 4;

  return (
    <>
      {/* ── 裁图弹窗 ── */}
      {handRawUrl && handCropBox && (
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="animate-scale-in flex w-[420px] max-h-[92vh] flex-col gap-4 overflow-y-auto rounded-[28px] border border-white/80 bg-white p-5 shadow-soft scrollbar-soft">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-plum">裁剪手图</h2>
                <p className="mt-0.5 text-xs text-mist">拖动白框移动 · 右下角手柄缩放 · 固定 2∶3 输出 1024×1536</p>
              </div>
              <GhostButton className="h-8 w-8 p-0 flex items-center justify-center" onClick={cancelCrop}>
                <X className="h-4 w-4" />
              </GhostButton>
            </div>

            <div className="relative w-full overflow-hidden rounded-2xl bg-orchid-50" data-canvas>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={handRawUrl} alt="手图" className="block w-full h-auto" draggable={false} />
              <div className="pointer-events-none absolute inset-0 bg-black/30" />
              <div
                className="absolute cursor-move touch-none z-10"
                style={{ left:`${lp}%`, top:`${tp}%`, width:`${wp}%`, height:`${hp}%`, border:"2px solid #fff", boxShadow:"0 0 0 9999px rgba(0,0,0,0.35)" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
                  const rect = cnv.getBoundingClientRect();
                  const startX = e.clientX, startY = e.clientY, sb = { ...handCropBox };
                  const onMove = (ev: PointerEvent) => {
                    const dx = ((ev.clientX - startX) / rect.width) * natW;
                    const dy = ((ev.clientY - startY) / rect.height) * natH;
                    setHandCropBox({ ...sb, x: Math.max(0, Math.min(natW - sb.w, sb.x + dx)), y: Math.max(0, Math.min(natH - sb.h, sb.y + dy)) });
                  };
                  const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                  window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                }}
              >
                <span className="absolute -top-6 left-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-plum shadow whitespace-nowrap">
                  1024×1536 竖图框（可拖动）
                </span>
                <span
                  className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full bg-white border-2 border-orchid-500 cursor-nwse-resize z-20 block"
                  onPointerDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    const cnv = (e.currentTarget as HTMLElement).closest("[data-canvas]") as HTMLElement;
                    const rect = cnv.getBoundingClientRect();
                    const startX = e.clientX, startY = e.clientY, sw = handCropBox.w;
                    const onMove = (ev: PointerEvent) => {
                      const delta = (((ev.clientX - startX) / rect.width) * natW + ((ev.clientY - startY) / rect.height) * natH) / 2;
                      const maxW = Math.min(natW, (natH * 2) / 3);
                      const newW = Math.max(80, Math.min(maxW, sw + delta));
                      const newH = newW * 1.5;
                      setHandCropBox((p) => p ? { ...p, w: newW, h: newH, x: Math.max(0, Math.min(natW - newW, p.x)), y: Math.max(0, Math.min(natH - newH, p.y)) } : p);
                    };
                    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
                    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
                  }}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <GhostButton className="flex-1" onClick={cancelCrop}>取消</GhostButton>
              <GradientButton className="flex-[2]" onClick={confirmCrop} disabled={saving}>
                <Check className="h-4 w-4" />{saving ? "保存中…" : "确认裁图 1024×1536"}
              </GradientButton>
            </div>
          </div>
        </div>
      )}

      {/* ── 成功 toast ── */}
      {toast && (
        <button onClick={() => setToast(null)}
          className="animate-slide-up fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-white shadow-soft transition-opacity hover:opacity-80">
          {toast}
        </button>
      )}

      <main>
        <section className="page active" id="home" aria-labelledby="home-title">
          <div className="product-home">
            <section className="tryon-workbench" aria-label="AI 试戴工作台">
              <div className="workbench-copy reveal" data-reveal="left" data-reveal-delay="100">
                <p className="eyebrow">AI Nail Try-On</p>
                <h1 id="home-title">
                  <TypeWriter text="找到适合今天的美甲" speed={90} delay={400} />
                </h1>
                <p>先挑 1-4 款，再上传一张手图生成试戴效果。结果可直接加入想做或确认做。</p>
              </div>

              <div className="workbench-search reveal" data-reveal-delay="300" role="search">
                <label htmlFor="homeSearch">搜索款式</label>
                <div className="search-field">
                  <span aria-hidden="true">⌕</span>
                  <input id="homeSearch" type="search" placeholder="搜索猫眼、通勤、显白、短甲"
                    autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <div className="home-style-rail" aria-label="快速找款">
                  <button type="button" onClick={() => setQuery("猫眼")}>猫眼显白</button>
                  <button type="button" onClick={() => setQuery("通勤")}>通勤短甲</button>
                  <button type="button" onClick={() => setQuery("冰透")}>冰透干净</button>
                  <button type="button" onClick={() => setQuery("可爱")}>可爱手绘</button>
                </div>
              </div>

              <div className="hero-preview reveal" data-reveal="scale" data-reveal-delay="200" aria-label="真实美甲预览">
                <img src="/assets/nail-hero.png" alt="手部美甲试戴示例" />
              </div>
            </section>

            <aside className="tryon-basket session-panel reveal" data-reveal-delay="500" id="tryonBasket" aria-label="当前试戴会话">
              <div className="session-head">
                <span>试戴会话</span>
                <strong>已选 {selectedItems.length} 款</strong>
              </div>
              <p className="session-copy">
                {selectedItems.length ? "再上传一张手图，就能生成试戴效果。" : "选款、上传手图、生成结果会一直保留在这里。"}
              </p>
              <div className="session-selected">
                {selectedItems.length
                  ? selectedItems.map((item) => <span className="session-chip" key={item.id}>{item.name}</span>)
                  : "还没有加入试戴的款式"}
              </div>

              <hr className="session-divider" />

              <label className="basket-upload">
                <input ref={handInputRef} type="file" accept="image/*" capture="environment" onChange={handleHandUpload} />
                <span>上传手部照片</span>
              </label>

              <Link className={`primary-action full-width${selectedItems.length === 0 ? " disabled-link" : ""}`} href="/quick-try-on">
                一键生成试戴
              </Link>

              <Link className="ghost-action full-width session-ai-btn" href="/recommend">让 AI 帮我选款式</Link>
            </aside>
          </div>

          <div className="section-head home-picks-head reveal">
            <div>
              <p className="eyebrow">Today Picks</p>
              <h2>先试这几款</h2>
            </div>
            <Link className="secondary-action" href="/style-library">进入款式库</Link>
          </div>

          <div className="home-pick-grid" id="homePickGrid">
            {filteredPicks.length ? (
              filteredPicks.slice(0, 7).map((item, i) => (
                <HomePickCard key={`${item.id}-${animKey}`} item={item}
                  index={i}
                  selected={selectedIds.includes(item.id)}
                  onToggle={() => toggleSelected(item.id)}
                  maxReached={maxReached} />
              ))
            ) : (
              <div className="empty-state">暂时没有符合条件的精选款，可以进入款式库清空筛选。</div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
