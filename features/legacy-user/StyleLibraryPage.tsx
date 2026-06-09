"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import type { NailStyle } from "./nailStyles";
import { useSelectedIds } from "./useSelectedIds";
import { useWantedIds } from "./useIntentIds";

const FILTER_NAMES = ["季节", "风格", "款式", "甲型"] as const;
const INITIAL_FILTERS = { 季节: "全部", 风格: "全部", 款式: "全部", 甲型: "全部" };

// ── 从 API 拉取款式数据 ───────────────────────────────────────────

interface XhsStyleDataset {
  styles: XhsStyle[];
  filterGroups: Record<string, string[]>;
  stats: { totalStyles: number };
}

interface XhsStyle {
  id: string;
  name: string;
  primaryTag: string;
  secondaryTag: string;
  image: string;
  likes: number;
  rating: number;
  reviews: string[];
  definition: string;
  rawDescription?: string;
  thumb: string;
  accent: string;
  nail: string;
  recommendBucket: string;
  hotScore: number;
  tagGroups: Record<string, string[]>;
  author?: string;
}

function maskName(review: string): string {
  const chars = [...review];
  if (chars.length <= 1) return chars[0] ?? "用";
  if (chars.length === 2) return chars[0] + "*";
  return chars[0] + "*" + chars[2];
}

function toNailStyle(s: XhsStyle): NailStyle {
  const likesNum = Number(s.likes) || 0;
  const ratingNum = Number(s.rating) || 5;
  return {
    id: s.id,
    name: s.name,
    primaryTag: s.primaryTag ?? "",
    secondaryTag: s.secondaryTag ?? "",
    coverImage: s.image ?? "",
    image: s.image ?? "",
    likes: likesNum >= 10000
      ? `${(likesNum / 10000).toFixed(likesNum >= 100000 ? 0 : 1)}万`
      : String(likesNum),
    rating: ratingNum.toFixed(1),
    reviews: Array.isArray(s.reviews) ? s.reviews.filter(Boolean).slice(0, 3) : [],
    definition: s.definition ?? "",
    thumb: s.thumb ?? "linear-gradient(135deg,#f8f0f4,#fdf5f0)",
    accent: s.accent ?? "#f3ddb8",
    nail: s.nail ?? "linear-gradient(160deg,#f6dfc5,#fff8ea 50%,#f0b9a8)",
    recommendBucket: s.recommendBucket ?? "stable",
    hotScore: s.hotScore ?? 50,
    tags: s.tagGroups,
    rawDescription: s.rawDescription ?? "",
  };
}

function matchesFilter(item: NailStyle, filterName: string, value: string) {
  if (value === "全部") return true;
  const haystack = [
    item.primaryTag,
    item.secondaryTag,
    item.name,
    item.definition,
    ...(item.tags ? Object.values(item.tags).flat() : []),
  ].join(" ");
  return haystack.includes(value);
}

// ── Detail dialog ─────────────────────────────────────────────────

function DetailDialog({
  item, selected, wanted, onToggle, onWant, onClose,
}: {
  item: NailStyle; selected: boolean; wanted: boolean;
  onToggle: () => void; onWant: () => void; onClose: () => void;
}) {
  return (
    <div
      className="dialog-backdrop"
      role="dialog" aria-modal="true" aria-label={`${item.name} 详情`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="dialog tryon-dialog">
        <button className="dialog-close" type="button" onClick={onClose} aria-label="关闭">✕</button>

        {/* 左列：大图 */}
        <div
          className={`dialog-art nail-thumb ${item.coverImage ? "has-image" : ""}`}
          style={{ "--thumb": item.thumb, "--nail": item.nail, "--accent": item.accent } as CSSProperties}
        >
          {item.coverImage && (
            <img src={item.coverImage} alt={item.name}
              onError={(e) => {
                e.currentTarget.closest(".nail-thumb")?.classList.remove("has-image");
                e.currentTarget.remove();
              }} />
          )}
        </div>

        {/* 右列：信息 */}
        <div className="dialog-body">
          <h2>{item.name}</h2>
          <div className="tag-stack">
            <span className="tag">{item.primaryTag}</span>
            {item.secondaryTag && <span className="tag sub-tag">{item.secondaryTag}</span>}
          </div>
          <div className="stats-row">
            <span>热度 {item.hotScore}</span>
            <span>点赞 {item.likes}</span>
            <span>评分 {item.rating}</span>
          </div>
          {item.rawDescription && (
            <p className="raw-desc">{item.rawDescription}</p>
          )}
          <p className="definition">{item.definition}</p>
          <div className="dialog-review-panel">
            {item.reviews.map((review, i) => (
              <div className="review" key={i}>
                <div className="review-head">
                  <strong>{maskName(review)}</strong>
                  <span>{Math.max(8, item.hotScore - i * 17)} 赞</span>
                </div>
                <div className="review-copy">"{review}"</div>
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button
              className={`select-action ${selected ? "selected" : ""}`}
              style={{ border: "2px solid", borderColor: selected ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
              type="button" onClick={onToggle}
            >
              {selected ? "已加入试戴" : "加入试戴"}
            </button>
            <button
              className={`select-action ${wanted ? "selected" : ""}`}
              style={{ border: "2px solid", borderColor: wanted ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
              type="button" onClick={onWant}
            >
              {wanted ? "已想做" : "我想做"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Nail card ─────────────────────────────────────────────────────

function NailCard({
  item, selected, wanted, onToggle, onDetail, onWant, index,
}: {
  item: NailStyle; selected: boolean; wanted: boolean;
  onToggle: () => void; onDetail: () => void; onWant: () => void;
  index: number;
}) {
  return (
    <article
      className="nail-card browse-slot"
      data-style-id={item.id}
      style={{ "--i": index } as CSSProperties}
    >
      <button
        className={`nail-thumb ${item.coverImage ? "has-image" : ""}`}
        style={{ "--thumb": item.thumb, "--nail": item.nail, "--accent": item.accent } as CSSProperties}
        type="button" aria-label={`查看${item.name}`} onClick={onDetail}
      >
        {item.coverImage && (
          <img src={item.coverImage} alt={item.name}
            onError={(e) => {
              e.currentTarget.closest(".nail-thumb")?.classList.remove("has-image");
              e.currentTarget.remove();
            }} />
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
        <div className="stats-row">
          <span>热度 {item.hotScore}</span>
          <span>点赞 {item.likes}</span>
        </div>
        {item.reviews[0] && (
          <div className="review-list" style={{ display: "grid" }}>
            <div className="review">
              <div className="review-head">
                <strong>{maskName(item.reviews[0])}</strong>
              </div>
              <div className="review-copy">"{item.reviews[0]}"</div>
            </div>
          </div>
        )}
        <div className="card-actions" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px" }}>
          <button
            className={`select-action ${selected ? "selected" : ""}`}
            style={{ border: "2px solid", borderColor: selected ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
            type="button" onClick={onToggle}
          >
            {selected ? "已加入试戴" : "加入试戴"}
          </button>
          <button
            className={`select-action ${wanted ? "selected" : ""}`}
            style={{ border: "2px solid", borderColor: wanted ? "var(--primary)" : "rgba(140,80,50,0.35)", fontWeight: 700 }}
            type="button" onClick={onWant}
          >
            {wanted ? "已想做" : "我想做"}
          </button>
          <button className="secondary-action" type="button" onClick={onDetail} style={{ gridColumn: "1 / -1" }}>查看详情</button>
        </div>
      </div>
    </article>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export default function StyleLibraryPage() {
  const { selectedIds, toggleSelected } = useSelectedIds();
  const { wantedIds, addWanted } = useWantedIds();
  const [styles, setStyles] = useState<NailStyle[]>([]);
  const [filterGroups, setFilterGroups] = useState<Record<string, string[]>>({
    季节: [], 风格: [], 款式: [], 甲型: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>(INITIAL_FILTERS);
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<NailStyle | null>(null);

  useEffect(() => {
    fetch("/api/xhs-style-dataset")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<XhsStyleDataset>;
      })
      .then((data) => {
        setStyles((data.styles ?? []).map(toNailStyle));
        if (data.filterGroups) setFilterGroups(data.filterGroups);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return styles.filter((item) => {
      const textMatch = !keyword || [
        item.name, item.primaryTag, item.secondaryTag, item.definition, ...item.reviews,
      ].some((t) => t.toLowerCase().includes(keyword));
      const filterMatch = FILTER_NAMES.every((name) => matchesFilter(item, name, filters[name]));
      return textMatch && filterMatch;
    });
  }, [styles, filters, query]);

  const allDefault = FILTER_NAMES.every((name) => filters[name] === "全部");

  // ── 筛选变化时触发卡片重新挂载动效 ──────────────────────────────────────
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => { setAnimKey((k) => k + 1); }, [filteredItems]);

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setQuery("");
    setOpenFilter(null);
  }

  function handleWant(id: string) {
    addWanted(id);
    setDetailItem(null);
  }

  return (
    <main>
      {detailItem && (
        <DetailDialog
          item={detailItem}
          selected={selectedIds.includes(detailItem.id)}
          wanted={wantedIds.includes(detailItem.id)}
          onToggle={() => toggleSelected(detailItem.id)}
          onWant={() => handleWant(detailItem.id)}
          onClose={() => setDetailItem(null)}
        />
      )}

      <section className="page active" id="styleLibrary" aria-labelledby="style-library-title">
        <div className="section-head catalog-head">
          <div>
            <p className="eyebrow">Style Library</p>
            <h1 id="style-library-title">店内真实款式</h1>
          </div>
          <div className="library-control-bar">
            <div className="library-search" role="search">
              <label htmlFor="catalogSearch">搜索款式</label>
              <div className="search-field">
                <span aria-hidden="true">⌕</span>
                <input
                  id="catalogSearch" type="search"
                  placeholder="猫眼、冰透、短甲、显白"
                  autoComplete="off" value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <button className="filter-drawer-trigger" type="button" onClick={resetFilters}>
              清空条件
            </button>
          </div>
        </div>

        <div className="quick-filter-strip" aria-label="快捷筛选">
          <div className="filter-area">
            <div className="filter-menu-bar">
              <button
                className={`filter-main-pill filter-all-pill ${allDefault ? "active" : ""}`}
                type="button" onClick={resetFilters}
              >
                全部
              </button>
              {FILTER_NAMES.map((name) => {
                const value = filters[name];
                const isOpen = openFilter === name;
                const options = filterGroups[name] ?? [];
                return (
                  <div
                    className={`filter-dropdown ${value !== "全部" ? "has-value" : ""} ${isOpen ? "is-open" : ""}`}
                    key={name}
                  >
                    <button
                      className="filter-main-pill" type="button"
                      onClick={() => setOpenFilter(isOpen ? null : name)}
                    >
                      <span>{name}</span>
                      {value !== "全部" && <strong>{value}</strong>}
                      <i aria-hidden="true" />
                    </button>
                    <div className="filter-popover" role="menu" aria-label={`${name}筛选`}>
                      {["全部", ...options].map((option) => (
                        <button
                          className={`filter-option ${option === value ? "active" : ""}`}
                          type="button" key={option}
                          onClick={() => {
                            setFilters((prev) => ({ ...prev, [name]: option }));
                            setOpenFilter(null);
                          }}
                        >
                          {option === "全部" ? `全部${name}` : option}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {!allDefault && (
              <div className="active-filter-row">
                {FILTER_NAMES.filter((name) => filters[name] !== "全部").map((name) => (
                  <button className="active-filter-chip" type="button" key={name}
                    onClick={() => setFilters((prev) => ({ ...prev, [name]: "全部" }))}>
                    {name}：{filters[name]} ×
                  </button>
                ))}
                <button className="active-filter-clear" type="button" onClick={resetFilters}>
                  清空筛选
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="filter-status" id="filterStatus">
          {loading
            ? "加载款式库中…"
            : error
              ? `加载失败：${error}`
              : filteredItems.length === styles.length
                ? `共 ${styles.length} 款真实款式`
                : `筛选结果 ${filteredItems.length} / ${styles.length} 款`}
        </p>

        <div className="nail-grid" id="nailGrid" style={{ "--nail-grid-cols": "4" } as CSSProperties}>
          {loading ? (
            <div className="empty-state">加载中…</div>
          ) : error ? (
            <div className="empty-state">加载失败，请确认本地服务已启动（localhost:5173）</div>
          ) : filteredItems.length ? (
            filteredItems.map((item, i) => (
              <NailCard
                key={`${item.id}-${animKey}`} item={item}
                index={i}
                selected={selectedIds.includes(item.id)}
                wanted={wantedIds.includes(item.id)}
                onToggle={() => toggleSelected(item.id)}
                onDetail={() => setDetailItem(item)}
                onWant={() => handleWant(item.id)}
              />
            ))
          ) : (
            <div className="empty-state">没有符合当前标签的款式，可以切回"全部"看看。</div>
          )}
        </div>
      </section>
    </main>
  );
}
