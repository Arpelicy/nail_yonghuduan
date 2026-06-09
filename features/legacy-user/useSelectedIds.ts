"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "nail-tryon-selected-ids";
const EVENT_NAME  = "nail-selected-ids-changed";

function read(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch { return []; }
}

function write(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function useSelectedIds() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 初始化 + 跨实例同步
  useEffect(() => {
    setSelectedIds(read());
    function sync() { setSelectedIds(read()); }
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function toggleSelected(id: string) {
    const current = read();
    const next = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id].slice(0, 4);
    write(next);
    setSelectedIds(next);
  }

  function clearSelected() {
    write([]);
    setSelectedIds([]);
  }

  return { selectedIds, toggleSelected, clearSelected };
}
