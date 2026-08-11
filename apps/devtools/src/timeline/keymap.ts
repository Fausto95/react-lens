/**
 * Timeline keyboard bindings as data: each binding declares how it matches —
 * by typed character (what the keycap says: letters, + and -) or by physical
 * key code (position-critical pairs like [ ] that many layouts, e.g. AZERTY,
 * can only type through Alt). Pure: event fields in, action out.
 */

export type TimelineKeyAction =
  | { kind: "escape-band" }
  | { kind: "go-live" }
  | { kind: "fit" }
  | { kind: "step-interaction"; dir: -1 | 1 }
  | { kind: "zoom"; factor: number }
  | { kind: "toggle-play" }
  | { kind: "step-commit"; dir: -1 | 1 };

export type TimelineKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey"
>;

interface Binding {
  /** Typed characters that trigger the action. */
  keys?: string[];
  /** Physical key codes that trigger the action (layout-independent). */
  codes?: string[];
  /**
   * Alt-tolerant: on AZERTY/Mac layouts the character itself is typed WITH
   * Alt (e.g. "[" is Option+5), so Alt must not veto these bindings.
   */
  allowAlt?: boolean;
  action: TimelineKeyAction;
}

const BINDINGS: Binding[] = [
  {
    keys: ["["],
    codes: ["BracketLeft"],
    allowAlt: true,
    action: { kind: "step-interaction", dir: -1 },
  },
  {
    keys: ["]"],
    codes: ["BracketRight"],
    allowAlt: true,
    action: { kind: "step-interaction", dir: 1 },
  },
  { keys: ["Escape"], action: { kind: "escape-band" } },
  { keys: ["l", "L"], action: { kind: "go-live" } },
  { keys: ["f", "F"], action: { kind: "fit" } },
  { keys: ["+", "="], action: { kind: "zoom", factor: 1.25 } },
  { keys: ["-", "_"], action: { kind: "zoom", factor: 0.8 } },
  { keys: [" "], codes: ["Space"], action: { kind: "toggle-play" } },
  { keys: ["ArrowLeft"], action: { kind: "step-commit", dir: -1 } },
  { keys: ["ArrowRight"], action: { kind: "step-commit", dir: 1 } },
];

export function timelineKeyAction(e: TimelineKeyEvent): TimelineKeyAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  for (const b of BINDINGS) {
    if (e.altKey && !b.allowAlt) continue;
    if (b.keys?.includes(e.key) || b.codes?.includes(e.code)) return b.action;
  }
  return null;
}
