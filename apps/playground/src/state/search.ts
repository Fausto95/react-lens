import { atom } from "jotai";

/** Recent command-palette queries — Jotai, beside locale. */
export const recentQueriesAtom = atom<string[]>([]);

export function pushRecentQuery(list: string[], query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return list;
  return [trimmed, ...list.filter((entry) => entry !== trimmed)].slice(0, 6);
}
