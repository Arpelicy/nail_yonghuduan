"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { nailStyles } from "./nailStyles";
import { useWantedIds, useConfirmedIds } from "./useIntentIds";

interface ResultEntry { url: string; ts: number; name: string; status: "done" | "generating" | "failed" }
type ResultIndex = Record<string, ResultEntry>;

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return (
    <div
      role="dialog" aria-modal="true" aria-label={alt}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{ position: "relative" }}>
        <img src={src} alt={alt}
          style={{ display: "block", maxHeight: "90vh", maxWidth: "90vw", borderRadius: 12, objectFit: "contain" }} />
        <button type="button" onClick={onClose} aria-label="关闭"
          style={{
            position: "absolute", top: 10, right: 10,
            background: "rgba(0,0,0,0.5)", color: "#fff",
            border: "none", borderRadius: "50%", width: 32, height: 32,
            fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>
      </div>
    </div>
  );
}

export default function BatchResultsPage() {
  const { wantedIds, addWanted, removeWanted } = useWantedIds();
  const { addConfirmed } = useConfirmedIds();
  const [index, setIndex] = useState<ResultIndex>({});
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // 拉取结果 index，有 generating 条目时每 3 秒轮询
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const r = await fetch("/api/result-save");
        const d = await r.json() as ResultIndex;
        setIndex(d ?? {});
        const hasGenerating = Object.values(d ?? {}).some((e) => e.status === "generating");
        if (hasGenerating) timer = setTimeout(poll, 3000);
      } catch { /* ignore */ }
    }
    poll();
    return () => clearTimeout(timer);
  }, []);

  const resultEntries = Object.entries(index).sort(([, a], [, b]) => b.ts - a.ts);
  const styleMap = new Map(nailStyles.map((s) => [s.id, s]));

  return (
    <main>
      {lightbox && (
        <ImageLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}

      <section className="page active" id="batchResults" aria-labelledby="batch-results-title">
        <div className="results-head">
          <div>
            <p className="eyebrow">Batch Try-On</p>
            <h1 id="batch-results-title">一键试戴结果</h1>
            <p>这里展示高仿真试戴生成的结果，每款独立生成，点击图片可放大查看。</p>
          </div>
          <Link className="primary-action" href="/catalog">继续选款</Link>
        </div>

        {resultEntries.length === 0 && (
          <div className="batch-empty">
            还没有生成记录。在首页选好款式并上传手图后，点击「一键生成高仿真试戴」开始生成。
          </div>
        )}

        <div className="batch-grid" id="batchResultGrid">
          {resultEntries.map(([styleId, entry]) => {
            const style = styleMap.get(styleId);
            const wanted = wantedIds.includes(styleId);
            const ts = new Date(entry.ts).toLocaleString("zh-CN");
            const isGenerating = entry.status === "generating";
            const isFailed     = entry.status === "failed";

            return (
              <article className="batch-card" key={`${styleId}-${entry.ts}`}>
                <div
                  className={`batch-result-media ${isGenerating ? "" : "ready"}`}
                  style={{ cursor: isGenerating ? "default" : "pointer" }}
                  onClick={() => {
                    if (!isGenerating && entry.url) setLightbox({ src: entry.url, alt: `${entry.name}试戴效果` });
                  }}
                >
                  {isGenerating ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%",
                        border: "3px solid #e9d5ff", borderTopColor: "#a855f7",
                        animation: "spin 0.8s linear infinite",
                      }} />
                      <p style={{ fontSize: 12, color: "#a855f7", fontWeight: 600, margin: 0 }}>正在试戴…</p>
                    </div>
                  ) : isFailed ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#ef4444", fontSize: 13 }}>生成失败</div>
                  ) : entry.url ? (
                    <img src={entry.url} alt={`${entry.name}试戴效果`} />
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 13 }}>无结果</div>
                  )}
                </div>

                <div className="batch-card-body">
                  <h3>{entry.name}</h3>
                  {style && (
                    <div className="tag-stack">
                      <span className="tag">{style.primaryTag}</span>
                      {style.secondaryTag && <span className="tag sub-tag">{style.secondaryTag}</span>}
                    </div>
                  )}
                  <p style={{ fontSize: 11, color: "#aaa", margin: "4px 0 0" }}>{ts}</p>

                  {!isGenerating && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      <button className="secondary-action" type="button"
                        style={{ flex: 1, fontSize: 12, padding: "5px 0" }}
                        onClick={() => entry.url && setLightbox({ src: entry.url, alt: `${entry.name}试戴效果` })}>
                        放大查看
                      </button>
                      <button className="primary-action" type="button"
                        style={{ flex: 1, fontSize: 12, padding: "5px 0" }}
                        onClick={() => addConfirmed(styleId)}>
                        确认要做
                      </button>
                      <button
                        className={`select-action ${wanted ? "selected" : ""}`}
                        type="button"
                        style={{ flex: 1, fontSize: 12, padding: "5px 0", border: "2px solid", borderColor: wanted ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
                        onClick={() => wanted ? removeWanted(styleId) : addWanted(styleId)}>
                        {wanted ? "已想做" : "我想做"}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
