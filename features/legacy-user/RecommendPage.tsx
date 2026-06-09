"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import type { CSSProperties } from "react";

import type { NailStyle } from "./nailStyles";
import { useSelectedIds } from "./useSelectedIds";
import { useWantedIds } from "./useIntentIds";

// ── 类型 ──────────────────────────────────────────────────────────
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  recommendedIds?: string[];
}

// ── 从款式库按 id 查找 ─────────────────────────────────────────────
function useStyleMap() {
  const [map, setMap] = useState<Map<string, NailStyle>>(new Map());
  useEffect(() => {
    fetch("/api/xhs-style-dataset")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((data) => {
        const m = new Map<string, NailStyle>();
        for (const s of data.styles ?? []) {
          const likesNum = Number(s.likes) || 0;
          m.set(s.id, {
            id: s.id,
            name: s.name,
            primaryTag: s.primaryTag ?? "",
            secondaryTag: s.secondaryTag ?? "",
            coverImage: s.image ?? "",
            image: s.image ?? "",
            likes: likesNum >= 10000 ? `${(likesNum / 10000).toFixed(likesNum >= 100000 ? 0 : 1)}万` : String(likesNum),
            rating: (Number(s.rating) || 5).toFixed(1),
            reviews: Array.isArray(s.reviews) ? s.reviews.slice(0, 3) : [],
            definition: s.definition ?? "",
            thumb: s.thumb ?? "linear-gradient(135deg,#f8f0f4,#fdf5f0)",
            accent: s.accent ?? "#f3ddb8",
            nail: s.nail ?? "linear-gradient(160deg,#f6dfc5,#fff8ea 50%,#f0b9a8)",
            recommendBucket: s.recommendBucket ?? "stable",
            hotScore: s.hotScore ?? 50,
            tags: s.tagGroups,
          } as NailStyle);
        }
        setMap(m);
      })
      .catch(() => {});
  }, []);
  return map;
}

const QUICK_PROMPTS = [
  { label: "我喜欢可爱的", full: "我喜欢可爱风格，但担心手绘翻车，帮我推荐店里稳一点的款。" },
  { label: "我手偏黄", full: "我手偏黄，想要冰透感，帮我避开容易显黑的颜色，推荐适合的款式。" },
];

export default function RecommendPage() {
  const styleMap = useStyleMap();
  const { selectedIds, toggleSelected } = useSelectedIds();
  const { wantedIds, addWanted } = useWantedIds();

  const [history, setHistory] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "我会根据你的手部照片、肤色倾向、甲床长度、使用场景和店内款式库来推荐。你可以直接说：「想要显白、不要太夸张、预算 200 左右」。",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const [detailItem, setDetailItem] = useState<NailStyle | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: text };
    setHistory((h) => [...h, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history
            .filter((m) => m.role !== "assistant" || history.indexOf(m) > 0)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (data.error) {
        setHistory((h) => [...h, { role: "assistant", content: `出错了：${data.error}` }]);
      } else {
        setHistory((h) => [...h, {
          role: "assistant",
          content: data.reply,
          recommendedIds: data.recommendedIds?.length ? data.recommendedIds : undefined,
        }]);
      }
    } catch (e) {
      setHistory((h) => [...h, { role: "assistant", content: `网络错误：${String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    sendMessage(input.trim());
  }

  const recommendedStyles = recommendedIds.map((id) => styleMap.get(id)).filter(Boolean) as NailStyle[];

  return (
    <main>
      <section className="page active" id="recommend" aria-labelledby="recommend-title">
        <div className="ai-shell">

          {/* 左栏 */}
          <aside className="ai-intent-panel" aria-label="挑款需求输入">
            <p className="eyebrow">Pick Assistant</p>
            <h1 id="recommend-title">帮我挑款</h1>
            <p>告诉它场景、肤色、甲型和预算，推荐卡片可以一键加入试戴会话。</p>

            <div className="quick-prompts" aria-label="快捷需求">
              {QUICK_PROMPTS.map((p) => (
                <button key={p.label} type="button" onClick={() => sendMessage(p.full)}>
                  {p.label}
                </button>
              ))}
            </div>

            <label className="photo-chip">
              <input type="file" accept="image/*" capture="environment" />
              <span className="align-guide">
                <img className="hand-guide-overlay" src="/user/assets/hand-guide-outline.png" alt="" />
                <small>手掌对准线框拍摄</small>
              </span>
            </label>

            <div className="assistant-memory-block">
              <p className="eyebrow">Memory</p>
              <div className="memory-list">
                <span>待提取：肤色倾向</span>
                <span>待提取：甲型/甲床</span>
                <span>待提取：预算</span>
                <span>待提取：禁忌偏好</span>
              </div>
            </div>
          </aside>

          {/* 中栏：对话 */}
          <section className="ai-chat-panel" aria-label="AI 美甲顾问对话">
            <div className="chat-window" aria-live="polite">
              {history.map((msg, i) => {
                const picks = msg.recommendedIds
                  ?.map((id) => styleMap.get(id))
                  .filter(Boolean) as NailStyle[] | undefined;
                return (
                  <div key={i} style={{ display: "contents" }}>
                    <div className={`message ${msg.role === "user" ? "user" : "ai"}`}>
                      {msg.role === "assistant" && <div className="avatar">AI</div>}
                      <div className="bubble">
                        {msg.role === "assistant"
                          ? <ReactMarkdown>{msg.content}</ReactMarkdown>
                          : msg.content}
                      </div>
                      {msg.role === "user" && <div className="avatar">我</div>}
                    </div>
                    {picks && picks.length > 0 && (
                      <div style={{ display: "flex", gap: 10, paddingLeft: 44, flexWrap: "wrap", alignSelf: "flex-start", maxWidth: "100%" }}>
                        {picks.map((item) => (
                          <article key={item.id} style={{ width: 160, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", flexShrink: 0 }}>
                            <button
                              className={`nail-thumb ${item.coverImage ? "has-image" : ""}`}
                              style={{ "--thumb": item.thumb, "--nail": item.nail, "--accent": item.accent, width: "100%", aspectRatio: "1/1", display: "block" } as CSSProperties}
                              type="button"
                              onClick={() => setDetailItem(item)}
                            >
                              {item.coverImage && (
                                <img src={item.coverImage} alt={item.name}
                                  onError={(e) => { e.currentTarget.closest(".nail-thumb")?.classList.remove("has-image"); e.currentTarget.remove(); }} />
                              )}
                            </button>
                            <div style={{ padding: "8px 10px 10px" }}>
                              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                              <div style={{ fontSize: 11, color: "rgba(60,40,28,0.5)", marginBottom: 6 }}>{item.primaryTag}{item.secondaryTag ? ` · ${item.secondaryTag}` : ""}</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                <button
                                  className={`select-action ${selectedIds.includes(item.id) ? "selected" : ""}`}
                                  style={{ fontSize: 11, padding: "4px 0", border: "1.5px solid", borderColor: selectedIds.includes(item.id) ? "var(--primary)" : "rgba(140,80,50,0.3)", fontWeight: 700 }}
                                  type="button" onClick={() => toggleSelected(item.id)}
                                >
                                  {selectedIds.includes(item.id) ? "已试戴" : "试戴"}
                                </button>
                                <button
                                  className={`select-action ${wantedIds.includes(item.id) ? "selected" : ""}`}
                                  style={{ fontSize: 11, padding: "4px 0", border: "1.5px solid", borderColor: wantedIds.includes(item.id) ? "var(--primary)" : "rgba(140,80,50,0.3)", fontWeight: 700 }}
                                  type="button" onClick={() => addWanted(item.id)}
                                >
                                  {wantedIds.includes(item.id) ? "已想做" : "想做"}
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {loading && (
                <div className="message ai">
                  <div className="avatar">AI</div>
                  <div className="bubble" style={{ opacity: 0.5 }}>思考中…</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form className="chat-composer" onSubmit={onSubmit}>
              <textarea
                rows={2}
                placeholder="告诉 AI：场景、预算、喜欢/不喜欢、甲型、肤色顾虑..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input.trim());
                  }
                }}
                disabled={loading}
              />
              <button className="primary-action" type="submit" disabled={loading}>
                {loading ? "…" : "发送"}
              </button>
            </form>
          </section>

          {/* 详情弹窗 */}
          {detailItem && (
            <div
              className="dialog-backdrop"
              role="dialog" aria-modal="true"
              onClick={(e) => { if (e.target === e.currentTarget) setDetailItem(null); }}
            >
              <div className="dialog tryon-dialog">
                <button className="dialog-close" type="button" onClick={() => setDetailItem(null)} aria-label="关闭">✕</button>
                <div
                  className={`dialog-art nail-thumb ${detailItem.coverImage ? "has-image" : ""}`}
                  style={{ "--thumb": detailItem.thumb, "--nail": detailItem.nail, "--accent": detailItem.accent } as CSSProperties}
                >
                  {detailItem.coverImage && (
                    <img src={detailItem.coverImage} alt={detailItem.name}
                      onError={(e) => { e.currentTarget.remove(); }} />
                  )}
                </div>
                <div className="dialog-body">
                  <h2>{detailItem.name}</h2>
                  <div className="tag-stack">
                    <span className="tag">{detailItem.primaryTag}</span>
                    {detailItem.secondaryTag && <span className="tag sub-tag">{detailItem.secondaryTag}</span>}
                  </div>
                  <div className="stats-row">
                    <span>热度 {detailItem.hotScore}</span>
                    <span>点赞 {detailItem.likes}</span>
                    <span>评分 {detailItem.rating}</span>
                  </div>
                  <p className="definition">{detailItem.definition}</p>
                  {detailItem.reviews?.length > 0 && (
                    <div className="dialog-review-panel">
                      {detailItem.reviews.map((r, i) => (
                        <div className="review" key={i}>
                          <div className="review-head"><strong>{[...r][0]}*{[...r][2] ?? ""}</strong><span>{Math.max(8, detailItem.hotScore - i * 17)} 赞</span></div>
                          <div className="review-copy">"{r}"</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="dialog-actions">
                    <button
                      className={`select-action ${selectedIds.includes(detailItem.id) ? "selected" : ""}`}
                      style={{ border: "2px solid", borderColor: selectedIds.includes(detailItem.id) ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
                      type="button" onClick={() => toggleSelected(detailItem.id)}
                    >
                      {selectedIds.includes(detailItem.id) ? "已加入试戴" : "加入试戴"}
                    </button>
                    <button
                      className={`select-action ${wantedIds.includes(detailItem.id) ? "selected" : ""}`}
                      style={{ border: "2px solid", borderColor: wantedIds.includes(detailItem.id) ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
                      type="button" onClick={() => { addWanted(detailItem.id); setDetailItem(null); }}
                    >
                      {wantedIds.includes(detailItem.id) ? "已想做" : "我想做"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 右栏：推荐结果 */}
          <aside className="ai-side-panel">
            <div className="recommend-evidence">
              <p className="eyebrow">Knowledge Base</p>
              <div>
                <span>黄皮显白</span>
                <span>短甲友好</span>
                <span>猫眼持久度</span>
                <span>手绘风险</span>
              </div>
            </div>

            <div className="recommend-result-panel">
              <div className="recommend-result-head">
                <p className="eyebrow">Shop Picks</p>
                <h2>当前可推荐</h2>
              </div>
              <div className="mini-picks" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {recommendedStyles.length === 0 ? (
                  <p style={{ fontSize: 13, color: "rgba(60,40,28,0.45)", padding: "8px 0" }}>
                    发送需求后 AI 会从款式库里推荐
                  </p>
                ) : (
                  recommendedStyles.map((item) => (
                    <article className="nail-card browse-slot" key={item.id} style={{ cursor: "default" }}>
                      <button
                        className={`nail-thumb ${item.coverImage ? "has-image" : ""}`}
                        style={{ "--thumb": item.thumb, "--nail": item.nail, "--accent": item.accent } as CSSProperties}
                        type="button" aria-label={`查看${item.name}`}
                        onClick={() => setDetailItem(item)}
                      >
                        {item.coverImage && (
                          <img src={item.coverImage} alt={item.name}
                            onError={(e) => { e.currentTarget.closest(".nail-thumb")?.classList.remove("has-image"); e.currentTarget.remove(); }} />
                        )}
                      </button>
                      <div className="card-body">
                        <div className="card-title-row">
                          <h3>{item.name}</h3>
                          <div className="tag-stack">
                            <span className="tag">{item.primaryTag}</span>
                            {item.secondaryTag && <span className="tag sub-tag">{item.secondaryTag}</span>}
                          </div>
                        </div>
                        <p className="definition">{item.definition}</p>
                        <div className="card-actions" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                          <button
                            className={`select-action ${selectedIds.includes(item.id) ? "selected" : ""}`}
                            style={{ border: "2px solid", borderColor: selectedIds.includes(item.id) ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700, fontSize: 12 }}
                            type="button" onClick={() => toggleSelected(item.id)}
                          >
                            {selectedIds.includes(item.id) ? "已加入试戴" : "加入试戴"}
                          </button>
                          <button
                            className={`select-action ${wantedIds.includes(item.id) ? "selected" : ""}`}
                            style={{ border: "2px solid", borderColor: wantedIds.includes(item.id) ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700, fontSize: 12 }}
                            type="button" onClick={() => addWanted(item.id)}
                          >
                            {wantedIds.includes(item.id) ? "已想做" : "我想做"}
                          </button>
                          <button className="secondary-action" type="button" onClick={() => setDetailItem(item)}
                            style={{ gridColumn: "1 / -1", fontSize: 12 }}>查看详情</button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </aside>

        </div>
      </section>
    </main>
  );
}
