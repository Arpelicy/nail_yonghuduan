"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2, ChevronRight, X } from "lucide-react";

import { nailStyles } from "@/features/legacy-user/nailStyles";
import { useSelectedIds } from "@/features/legacy-user/useSelectedIds";

const styleMap = new Map(nailStyles.map((s) => [s.id, s]));

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

export default function TryOnAssistant() {
  const router = useRouter();
  const { selectedIds, toggleSelected } = useSelectedIds();
  const [open,       setOpen]       = useState(false);
  const [handSaved,  setHandSaved]  = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress,   setProgress]   = useState("");
  const [toast,      setToast]      = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 检查服务端是否已有手图
  useEffect(() => {
    fetch("/api/hand-save")
      .then((r) => r.json())
      .then((d: { url?: string }) => setHandSaved(!!d.url))
      .catch(() => {});
  }, []);

  // 点外关闭
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 5000);
  }

  // 并行发 N 个 /api/nail-tryon，每完成一个立刻存盘（照抄快速试戴的方式）
  async function handleGenerate() {
    if (!handSaved) return showToast("请先在首页上传手图");
    if (selectedIds.length === 0) return showToast("请先加入试戴款式");

    setGenerating(true);
    setProgress(`准备图片…`);

    // 1. 读取最新手图 base64
    let handBase64: string;
    try {
      const r = await fetch("/api/hand-save");
      const d = await r.json() as { url?: string };
      if (!d.url) { showToast("手图未找到，请重新上传"); setGenerating(false); setProgress(""); return; }
      handBase64 = await urlToBase64(d.url);
    } catch {
      showToast("读取手图失败"); setGenerating(false); setProgress(""); return;
    }

    // 2. 先把每款状态标记为 generating
    const styles = selectedIds.map((id) => styleMap.get(id)).filter(Boolean) as typeof nailStyles;
    await Promise.all(styles.map((s) =>
      fetch("/api/result-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleId: s.id, name: s.name, status: "generating" }),
      })
    ));

    // 3. 跳转到结果页（在后台继续生成）
    router.push("/batch-results");
    setOpen(false);

    let done = 0;
    setProgress(`生成中 0/${styles.length}…`);

    // 4. 并行对每个款式发 /api/nail-tryon（full_keep 模式）
    await Promise.all(styles.map(async (s) => {
      try {
        const styleBase64 = await urlToBase64(s.image ?? s.coverImage ?? "");
        const res = await fetch("/api/nail-tryon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleImageBase64: styleBase64, handImageBase64: handBase64, mode: "full_keep" }),
          signal: AbortSignal.timeout(360_000),
        });
        if (res.ok) {
          const data = await res.json() as { resultDataUrl: string };
          await fetch("/api/result-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ styleId: s.id, name: s.name, imageBase64: data.resultDataUrl, status: "done" }),
          });
        } else {
          await fetch("/api/result-save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ styleId: s.id, name: s.name, status: "failed" }),
          });
        }
      } catch {
        await fetch("/api/result-save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ styleId: s.id, name: s.name, status: "failed" }),
        });
      }
      done++;
      setProgress(`生成中 ${done}/${styles.length}…`);
    }));

    setProgress("");
    setGenerating(false);
    showToast(`✓ ${done} 款试戴生成完成`);
  }

  const selectedItems = selectedIds.map((id) => styleMap.get(id)).filter(Boolean) as typeof nailStyles;

  return (
    <>
      {/* toast */}
      {toast && (
        <button
          onClick={() => setToast(null)}
          style={{
            position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)",
            zIndex: 9999, background: "#3b0764", color: "#fff",
            padding: "10px 20px", borderRadius: 999, fontSize: 13,
            fontWeight: 600, border: "none", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)", whiteSpace: "nowrap",
          }}
        >{toast}</button>
      )}

      <div ref={panelRef} style={{ position: "fixed", bottom: 28, right: 28, zIndex: 50 }}>

        {/* 弹窗 */}
        {open && (
          <div style={{
            position: "absolute", bottom: 72, right: 0, width: 320,
            background: "#fff", borderRadius: 20,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            border: "1px solid rgba(140,80,50,0.12)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            {/* header */}
            <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid rgba(140,80,50,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontWeight: 800, fontSize: 14, color: "#3b0764", margin: 0 }}>一键试戴</p>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>
                  已选 {selectedItems.length}/4 款 · 手图{handSaved ? " ✓ 已就绪" : " 未上传"}
                </p>
              </div>
              <button onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 18, lineHeight: 1, padding: 4 }}>
                <X size={16} />
              </button>
            </div>

            {/* 款式列表 */}
            <div style={{ maxHeight: 240, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {selectedItems.length === 0 ? (
                <p style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "16px 0", margin: 0 }}>还没有加入试戴的款式</p>
              ) : selectedItems.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "rgba(140,80,50,0.04)", border: "1px solid rgba(140,80,50,0.08)" }}>
                  <div style={{ width: 40, height: 52, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: item.thumb }}>
                    {item.image && <img src={item.image} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 12, color: "#3b0764", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</p>
                    <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>{item.primaryTag}</p>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <Link href="/style-library" title="查看详情"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: "rgba(140,80,50,0.08)", color: "#CF6338", textDecoration: "none" }}>
                      <ChevronRight size={14} />
                    </Link>
                    <button onClick={() => toggleSelected(item.id)} title="移除"
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "none", cursor: "pointer" }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 进度 */}
            {progress && (
              <p style={{ fontSize: 11, color: "#a855f7", textAlign: "center", padding: "4px 12px", margin: 0 }}>{progress}</p>
            )}

            {/* 操作 */}
            <div style={{ padding: "10px 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={handleGenerate}
                disabled={generating || selectedItems.length === 0 || !handSaved}
                style={{
                  width: "100%", padding: "11px 0", borderRadius: 12, border: "none",
                  background: (generating || selectedItems.length === 0 || !handSaved)
                    ? "#e5e7eb"
                    : "linear-gradient(135deg,#CF6338,#a855f7)",
                  color: (generating || selectedItems.length === 0 || !handSaved) ? "#9ca3af" : "#fff",
                  fontWeight: 700, fontSize: 13, cursor: generating ? "wait" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <Sparkles size={15} />
                {generating ? "生成中…" : "一键生成高仿真试戴"}
              </button>
              <Link href="/batch-results"
                style={{
                  display: "block", textAlign: "center", padding: "8px 0",
                  borderRadius: 12, border: "1px solid rgba(140,80,50,0.2)",
                  color: "#CF6338", fontSize: 12, fontWeight: 600, textDecoration: "none",
                  background: "rgba(140,80,50,0.04)",
                }}>
                查看试戴结果 →
              </Link>
            </div>
          </div>
        )}

        {/* 气泡按钮 */}
        <button
          onClick={() => setOpen((v) => !v)}
          title="一键试戴"
          style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg,#CF6338,#a855f7)",
            border: "3px solid #fff",
            boxShadow: "0 4px 20px rgba(207,99,56,0.4)",
            cursor: "pointer", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 1,
            position: "relative",
          }}
        >
          <Sparkles size={18} color="#fff" />
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.85)", fontWeight: 700, letterSpacing: 0.2, lineHeight: 1 }}>一键试戴</span>
          {selectedItems.length > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4,
              background: "#ef4444", color: "#fff",
              borderRadius: "50%", width: 20, height: 20,
              fontSize: 11, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid #fff",
            }}>
              {selectedItems.length}
            </span>
          )}
        </button>
      </div>
    </>
  );
}
