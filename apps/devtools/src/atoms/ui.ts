/**
 * Module-scope UI atoms for the panel. Wired gradually; Panel.tsx still uses
 * useState for most of these until the Jotai migration lands.
 */
import { atom } from "jotai";
import type { ComponentId } from "@reactlens/protocol";
import type { TimeCursor, ABMarks } from "../timeCursor.js";

export const selectedIdAtom = atom<ComponentId | null>(null);
export const cursorAtom = atom<TimeCursor>({ t: 0, mode: "live" });
export const abMarksAtom = atom<ABMarks>({});
export const agentOpenAtom = atom(false);
export const doctorOpenAtom = atom(false);
export const menuOpenAtom = atom(false);
export const paletteOpenAtom = atom(false);
export const settingsOpenAtom = atom(false);
export const travelOnAtom = atom(false);
