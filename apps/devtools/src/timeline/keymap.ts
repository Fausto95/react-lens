/**
 * Timeline keyboard bindings as data.
 */

export type TimelineKeyAction =
  | { kind: "escape-band" }
  | { kind: "fit" }
  | { kind: "fit-selection" }
  | { kind: "zoom"; factor: number }
  | { kind: "toggle-play" }
  | { kind: "play-forward" }
  | { kind: "play-reverse" }
  | { kind: "stop" }
  | { kind: "set-in" }
  | { kind: "set-out" }
  | { kind: "nudge-playhead"; dir: -1 | 1 }
  | { kind: "step-commit"; dir: -1 | 1 }
  | { kind: "toggle-help" }
  | { kind: "go-live" };

export type TimelineKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

interface Binding {
  keys?: string[];
  codes?: string[];
  allowAlt?: boolean;
  /** When set, Shift must match this value (default: ignore Shift). */
  shift?: boolean;
  action: TimelineKeyAction;
}

const BINDINGS: Binding[] = [
  {
    keys: ["["],
    codes: ["BracketLeft"],
    allowAlt: true,
    action: { kind: "set-in" },
  },
  {
    keys: ["]"],
    codes: ["BracketRight"],
    allowAlt: true,
    action: { kind: "set-out" },
  },
  { keys: ["Escape"], action: { kind: "escape-band" } },
  { keys: ["0"], action: { kind: "fit" } },
  { keys: ["f", "F"], action: { kind: "fit-selection" } },
  { keys: ["+", "="], action: { kind: "zoom", factor: 0.72 } },
  { keys: ["-", "_"], action: { kind: "zoom", factor: 1.4 } },
  { keys: [" "], codes: ["Space"], action: { kind: "toggle-play" } },
  { keys: ["j", "J"], action: { kind: "play-reverse" } },
  { keys: ["k", "K"], action: { kind: "stop" } },
  { keys: ["l", "L"], action: { kind: "play-forward" } },
  { keys: ["?"], action: { kind: "toggle-help" } },
  {
    keys: ["ArrowLeft"],
    codes: ["ArrowLeft"],
    shift: true,
    action: { kind: "step-commit", dir: -1 },
  },
  {
    keys: ["ArrowRight"],
    codes: ["ArrowRight"],
    shift: true,
    action: { kind: "step-commit", dir: 1 },
  },
  { keys: ["ArrowLeft"], codes: ["ArrowLeft"], shift: false, action: { kind: "nudge-playhead", dir: -1 } },
  {
    keys: ["ArrowRight"],
    codes: ["ArrowRight"],
    shift: false,
    action: { kind: "nudge-playhead", dir: 1 },
  },
  { keys: ["End"], codes: ["End"], action: { kind: "go-live" } },
  { keys: ["."], codes: ["Period"], action: { kind: "go-live" } },
];

export function timelineKeyAction(e: TimelineKeyEvent): TimelineKeyAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  for (const b of BINDINGS) {
    if (e.altKey && !b.allowAlt) continue;
    if (b.shift !== undefined && e.shiftKey !== b.shift) continue;
    if (b.keys?.includes(e.key) || b.codes?.includes(e.code)) return b.action;
  }
  return null;
}
