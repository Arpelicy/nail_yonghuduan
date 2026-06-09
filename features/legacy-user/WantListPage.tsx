"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { NailStyle } from "./nailStyles";
import { useConfirmedIds, useWantedIds } from "./useIntentIds";
import { useSelectedIds } from "./useSelectedIds";

// ── 从 API 取款式（复用同一 endpoint）────────────────────────────
function useStyleMap() {
  const [map, setMap] = useState<Map<string, NailStyle>>(new Map());
  useEffect(() => {
    fetch("/api/xhs-style-dataset")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((data) => {
        const m = new Map<string, NailStyle>();
        for (const s of data.styles ?? []) {
          const likesNum = Number(s.likes) || 0;
          const ratingNum = Number(s.rating) || 5;
          m.set(s.id, {
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

// ── 卡片 ────────────────────────────────────────────────────────
function IntentCard({
  item, confirmed, onConfirm, onRemove,
}: {
  item: NailStyle;
  confirmed: boolean;
  onConfirm: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="batch-card profile-record-card">
      <div className="batch-result-media ready">
        {item.image
          ? <img src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%", background: item.thumb }} />}
      </div>
      <div className="batch-card-body">
        <h3>{item.name}</h3>
        <div className="tag-stack">
          <span className="tag">{item.primaryTag}</span>
          {item.secondaryTag && <span className="tag sub-tag">{item.secondaryTag}</span>}
        </div>
        <p style={{ fontSize: 12, color: "rgba(60,40,28,0.55)", margin: "4px 0 8px" }}>
          {confirmed ? "已确认要做，到店前可把试戴图给美甲师。" : "已加入候选，适合稍后比较后再确认。"}
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          {!confirmed && (
            <button
              className="select-action"
              style={{ flex: 1, fontSize: 12, padding: "5px 0", border: "2px solid rgba(140,80,50,0.35)", fontWeight: 700 }}
              type="button"
              onClick={onConfirm}
            >
              确认做
            </button>
          )}
          <button
            className="secondary-action"
            style={{ flex: 1, fontSize: 12, padding: "5px 0" }}
            type="button"
            onClick={onRemove}
          >
            {confirmed ? "取消确认" : "移除"}
          </button>
        </div>
      </div>
    </article>
  );
}

// ── 页面 ────────────────────────────────────────────────────────
export default function WantListPage() {
  const styleMap = useStyleMap();
  const { wantedIds, removeWanted } = useWantedIds();
  const { confirmedIds, addConfirmed, removeConfirmed } = useConfirmedIds();
  const { selectedIds } = useSelectedIds();

  function handleConfirm(id: string) {
    addConfirmed(id);
    removeWanted(id);
  }

  function handleRemoveConfirmed(id: string) {
    removeConfirmed(id);
  }

  const wantItems = wantedIds.map((id) => styleMap.get(id)).filter(Boolean) as NailStyle[];
  const confirmedItems = confirmedIds.map((id) => styleMap.get(id)).filter(Boolean) as NailStyle[];

  return (
    <main>
      <section className="page profile-page active" id="wantList" aria-labelledby="want-list-title">
        <div className="profile-grid">

          {/* 概览卡 */}
          <section className="profile-card profile-summary-card" aria-label="用户概览">
            <div className="profile-avatar" aria-hidden="true" />
            <div className="profile-summary-main">
              <p className="eyebrow">My Studio</p>
              <h1 id="want-list-title">美甲体验用户0607</h1>
              <p>偏好：短甲 / 低饱和 / 通勤</p>
              <div className="profile-stat-row" aria-label="我的记录统计">
                <span><strong>{wantItems.length}</strong>想做</span>
                <span><strong>{selectedIds.length}</strong>试戴</span>
                <span><strong>{selectedIds.length}</strong>保存图</span>
                <span><strong>{confirmedItems.length}</strong>确认做</span>
              </div>
            </div>
            <div className="profile-actions">
              <button className="secondary-action" type="button">刷新</button>
              <Link className="primary-action" href="/batch-results">看试戴结果</Link>
            </div>
          </section>

          {/* 偏好 */}
          <aside className="profile-card preference-card" aria-label="偏好档案">
            <div className="profile-section-head">
              <div>
                <p className="eyebrow">Preference</p>
                <h2>偏好档案</h2>
              </div>
              <Link className="ghost-action" href="/recommend">编辑偏好</Link>
            </div>
            <div className="preference-chip-row">
              {["显白", "短甲", "低饱和", "通勤", "猫眼", "冰透"].map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div className="privacy-row">
              <span className="profile-icon profile-icon-shield" aria-hidden="true" />
              <div>
                <strong>手图隐私</strong>
                <p>仅用于本次试戴与推荐，可随时清除。</p>
              </div>
            </div>
          </aside>

          {/* 意向区 */}
          <section className="profile-card intent-panel">
            <div className="profile-section-head">
              <div>
                <p className="eyebrow">Want To Do</p>
                <h2>我的意向</h2>
              </div>
              <div className="profile-segmented" aria-label="意向分类">
                <span>我想做 {wantItems.length > 0 && `(${wantItems.length})`}</span>
                <span>确认做 {confirmedItems.length > 0 && `(${confirmedItems.length})`}</span>
              </div>
            </div>
            <p className="profile-section-copy">意向款和已确认款直接展示在这里，方便到店前快速比较和决策。</p>
            <div className="intent-columns">
              <section>
                <h3>我想做</h3>
                <p>已加入候选，适合稍后比较后再确认。</p>
                <div className="batch-grid profile-item-grid">
                  {wantItems.length === 0
                    ? <p style={{ color: "rgba(60,40,28,0.4)", fontSize: 13 }}>还没有添加，去款式库点"我想做"吧</p>
                    : wantItems.map((item) => (
                      <IntentCard
                        key={item.id}
                        item={item}
                        confirmed={false}
                        onConfirm={() => handleConfirm(item.id)}
                        onRemove={() => removeWanted(item.id)}
                      />
                    ))}
                </div>
              </section>
              <section>
                <h3>已确认做</h3>
                <p>预约成交池，默认代表已经确认要做。</p>
                <div className="batch-grid profile-item-grid">
                  {confirmedItems.length === 0
                    ? <p style={{ color: "rgba(60,40,28,0.4)", fontSize: 13 }}>点"确认做"后款式会移到这里</p>
                    : confirmedItems.map((item) => (
                      <IntentCard
                        key={item.id}
                        item={item}
                        confirmed
                        onConfirm={() => {}}
                        onRemove={() => handleRemoveConfirmed(item.id)}
                      />
                    ))}
                </div>
              </section>
            </div>
          </section>

          {/* 最近试戴 */}
          <aside className="profile-card recent-tryon-panel">
            <div className="profile-section-head">
              <div>
                <p className="eyebrow">Recent</p>
                <h2>最近试戴</h2>
              </div>
              <Link className="ghost-action" href="/quick-try-on">去试戴</Link>
            </div>
            <div className="recent-tryon-list">
              {selectedIds.slice(0, 3).map((id) => {
                const item = styleMap.get(id);
                if (!item) return null;
                return (
                  <div className="recent-tryon-item" key={id}>
                    <img src={item.image} alt={item.name} />
                    <div>
                      <strong>{item.name}</strong>
                      <span>已加入试戴</span>
                    </div>
                  </div>
                );
              })}
              {selectedIds.length === 0 && (
                <p style={{ color: "rgba(60,40,28,0.4)", fontSize: 13, padding: "8px 0" }}>还没有试戴记录</p>
              )}
            </div>
          </aside>

          {/* 保存效果图 */}
          <section className="profile-card saved-effects-panel">
            <div className="profile-section-head">
              <div>
                <p className="eyebrow">Saved Results</p>
                <h2>保存效果图</h2>
              </div>
              <Link className="ghost-action" href="/batch-results">全部结果</Link>
            </div>
            <div className="saved-effect-grid">
              {selectedIds.map((id) => {
                const item = styleMap.get(id);
                if (!item) return null;
                return <img key={id} src={item.image} alt={`${item.name}保存效果图`} />;
              })}
              {selectedIds.length === 0 && (
                <p style={{ color: "rgba(60,40,28,0.4)", fontSize: 13 }}>去款式库加入试戴后显示在这里</p>
              )}
            </div>
          </section>

        </div>
      </section>
    </main>
  );
}
