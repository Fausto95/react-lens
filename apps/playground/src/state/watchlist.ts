import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { registerStores, zustandAdapter } from "@reactlens/adapters";

export const WATCH_STATUSES = ["queued", "watching", "watched"] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

interface LibraryState {
  ids: string[];
  status: Record<string, WatchStatus>;
  progress: Record<string, number>;
  toggle: (id: string) => void;
  setStatus: (id: string, status: WatchStatus) => void;
  setProgress: (id: string, value: number) => void;
  saveMany: (ids: string[]) => void;
}

export const watchlistStore = createStore<LibraryState>((set) => ({
  ids: [],
  status: {},
  progress: {},
  toggle: (id) =>
    set((state) => {
      const saved = state.ids.includes(id);
      const ids = saved ? state.ids.filter((entry) => entry !== id) : [...state.ids, id];
      const status = { ...state.status };
      if (saved) delete status[id];
      else if (!status[id]) status[id] = "queued";
      return { ids, status };
    }),
  setStatus: (id, next) =>
    set((state) => ({
      ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
      status: { ...state.status, [id]: next },
      progress: next === "watched" ? { ...state.progress, [id]: 100 } : state.progress,
    })),
  setProgress: (id, value) =>
    set((state) => ({
      ids: state.ids.includes(id) ? state.ids : [...state.ids, id],
      progress: { ...state.progress, [id]: value },
      status: {
        ...state.status,
        [id]: value >= 100 ? "watched" : value > 0 ? "watching" : (state.status[id] ?? "queued"),
      },
    })),
  saveMany: (ids) =>
    set((state) => {
      const nextIds = [...state.ids];
      const status = { ...state.status };
      for (const id of ids) {
        if (!nextIds.includes(id)) nextIds.push(id);
        if (!status[id]) status[id] = "queued";
      }
      return { ids: nextIds, status };
    }),
}));

if (import.meta.env.DEV) {
  registerStores(zustandAdapter(watchlistStore, { id: "watchlist" }));
}

export function useWatchlist() {
  const ids = useStore(watchlistStore, (s) => s.ids);
  const status = useStore(watchlistStore, (s) => s.status);
  const progress = useStore(watchlistStore, (s) => s.progress);
  const toggle = useStore(watchlistStore, (s) => s.toggle);
  const setStatus = useStore(watchlistStore, (s) => s.setStatus);
  const setProgress = useStore(watchlistStore, (s) => s.setProgress);
  const saveMany = useStore(watchlistStore, (s) => s.saveMany);

  return {
    ids,
    status,
    progress,
    toggle,
    setStatus,
    setProgress,
    saveMany,
    count: ids.length,
    has: (id: string) => ids.includes(id),
    of: (id: string): WatchStatus | undefined => status[id],
    percent: (id: string) => progress[id] ?? 0,
  };
}
