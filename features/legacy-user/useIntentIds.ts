"use client";

import { useEffect, useState } from "react";

const WANT_KEY = "nail-want-ids";
const CONFIRMED_KEY = "nail-confirmed-ids";

function useStoredIds(key: string) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) setIds(JSON.parse(stored));
    } catch {}
  }, []);

  function add(id: string) {
    setIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function remove(id: string) {
    setIds((prev) => {
      const next = prev.filter((x) => x !== id);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function toggle(id: string) {
    ids.includes(id) ? remove(id) : add(id);
  }

  return { ids, add, remove, toggle };
}

export function useWantedIds() {
  const store = useStoredIds(WANT_KEY);
  return { wantedIds: store.ids, addWanted: store.add, removeWanted: store.remove };
}

export function useConfirmedIds() {
  const store = useStoredIds(CONFIRMED_KEY);
  return { confirmedIds: store.ids, addConfirmed: store.add, removeConfirmed: store.remove };
}
