import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type {
  ComponentId,
  ComponentType,
  RenderId,
  RenderSnapshot,
  SerializedValue,
} from "@reactlens/protocol";
import { hasIdentity } from "@reactlens/protocol";
import { causeOf, type ClipCause } from "../timeline/model/lanes.js";
import { edgesForCommit, originOf, contextConsumerCount } from "../timeline/model/edges.js";

/**
 * One render, told as a story: **Cause → Change → Cost → Fix**.
 *
 * Pure derivation over the trace — no React, no formatting. The inspector
 * renders exactly what this returns, so the reasoning is testable on its own.
 */

export interface ChainStep {
  kind: "origin" | "link" | "target";
  text: string;
  componentId?: ComponentId;
}

export interface ChangeRow {
  kind: "removed" | "added" | "same";
  /** `props.onSelect`, `state[0]`, `context.CartContext` */
  path: string;
  text: string;
  /** Reference identity, when the value has one — the `@ref` chip. */
  identity?: string;
}

export type FixKind =
  | "none"
  | "memo-component"
  | "use-callback"
  | "use-memo"
  | "context-value"
  | "context-selector";

export interface Fix {
  kind: FixKind;
  text: string;
  code: string | null;
  /** Offer a before/after replay — only for fixes we can simulate. */
  replayable: boolean;
}

export interface RenderStory {
  cause: ClipCause;
  headline: string;
  chain: ChainStep[];
  changes: ChangeRow[];
  refWarning: string | null;
  /**
   * What this render cost, in the only terms React actually reports:
   * its own work, its subtree's, and its effects. There is no per-component
   * commit time in the profiler, so we don't invent one.
   */
  cost: { render: number; subtree: number; effects: number };
  wasted: boolean;
  fix: Fix;
}

const SHORT = 60;

function label(value: SerializedValue): string {
  switch (value.k) {
    case "primitive":
      return typeof value.value === "string" ? JSON.stringify(value.value) : String(value.value);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "bigint":
      return `${value.value}n`;
    case "function":
      return `ƒ ${value.name ?? "anonymous"}`;
    case "date":
      return value.iso;
    case "regexp":
      return `/${value.source}/${value.flags}`;
    case "array":
      return `Array(${value.length})`;
    case "object":
      return value.ctor && value.ctor !== "Object" ? `${value.ctor} {…}` : "{…}";
    case "map":
      return `Map(${value.size})`;
    case "set":
      return `Set(${value.size})`;
    case "dom":
      return `<${value.nodeName.toLowerCase()}>`;
    case "react-element":
      return `<${value.typeName ?? "Element"} />`;
    case "symbol":
      return `Symbol(${value.description ?? ""})`;
    case "ref":
      return "ref";
    case "unserializable":
      return value.reason;
  }
}

function identityOf(value: SerializedValue): string | undefined {
  return hasIdentity(value) ? value.identity : undefined;
}

/** Same rendered label, different reference — the memo-breaking case. */
function identityOnlyChange(before: SerializedValue, after: SerializedValue): boolean {
  const a = identityOf(before);
  const b = identityOf(after);
  if (!a || !b || a === b) return false;
  return label(before) === label(after) && before.k === after.k;
}

function entriesOf(value: SerializedValue | undefined): Array<[string, SerializedValue]> {
  if (!value) return [];
  if (value.k === "object") return value.entries ?? [];
  if (value.k === "array") return (value.items ?? []).map((v, i) => [String(i), v]);
  return [];
}

function truncate(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT - 1)}…` : text;
}

function diffSection(
  prefix: string,
  before: SerializedValue | undefined,
  after: SerializedValue | undefined,
): { rows: ChangeRow[]; identityOnly: string[] } {
  const rows: ChangeRow[] = [];
  const identityOnly: string[] = [];
  const beforeMap = new Map(entriesOf(before));
  const afterMap = new Map(entriesOf(after));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const key of [...keys].sort()) {
    const prev = beforeMap.get(key);
    const next = afterMap.get(key);
    const path = `${prefix}.${key}`;
    if (prev && next && identityOnlyChange(prev, next)) {
      identityOnly.push(key);
      rows.push({
        kind: "removed",
        path,
        text: `− ${key}: ${truncate(label(prev))}`,
        ...(identityOf(prev) ? { identity: identityOf(prev)! } : {}),
      });
      rows.push({
        kind: "added",
        path,
        text: `+ ${key}: ${truncate(label(next))}`,
        ...(identityOf(next) ? { identity: identityOf(next)! } : {}),
      });
      continue;
    }
    const prevText = prev ? label(prev) : "—";
    const nextText = next ? label(next) : "—";
    if (prevText === nextText) {
      rows.push({ kind: "same", path, text: `· ${key}: ${truncate(nextText)} (unchanged)` });
      continue;
    }
    if (prev) {
      rows.push({
        kind: "removed",
        path,
        text: `− ${key}: ${truncate(prevText)}`,
        ...(identityOf(prev) ? { identity: identityOf(prev)! } : {}),
      });
    }
    if (next) {
      rows.push({
        kind: "added",
        path,
        text: `+ ${key}: ${truncate(nextText)}`,
        ...(identityOf(next) ? { identity: identityOf(next)! } : {}),
      });
    }
  }
  return { rows, identityOnly };
}

function isFunctionKey(snapshot: RenderSnapshot | undefined, key: string): boolean {
  for (const [k, v] of entriesOf(snapshot?.props)) {
    if (k === key) return v.k === "function";
  }
  return false;
}

/**
 * Fix suggestion.
 *
 * Note: this deliberately proposes manual memoization (`useMemo` /
 * `useCallback` / `memo`) — see DESIGN.md §1.4, which was amended to allow it.
 * When the Compiler is on and still could not memoize, the bailout reason is
 * the more useful answer and is surfaced in the headline instead.
 */
function suggestFix(
  cause: ClipCause,
  identityOnly: string[],
  functionProps: string[],
  componentName: string,
  changedAnything: boolean,
  contextName: string | null,
  stateChanged: boolean,
): Fix {
  // A render whose own state changed is doing necessary work, whatever the
  // first-listed reason says — React reports several reasons per render.
  if (cause === "state" || cause === "mount" || stateChanged) {
    return {
      kind: "none",
      text: "Rendered from its own state — expected work.",
      code: null,
      replayable: false,
    };
  }

  if (cause === "cascade" && !changedAnything) {
    return {
      kind: "memo-component",
      text: `${componentName} is pure — wrap it so parent renders stop here:`,
      code: `export default memo(${componentName});`,
      replayable: true,
    };
  }

  if (cause === "props" && functionProps.length > 0) {
    const name = functionProps[0]!;
    return {
      kind: "use-callback",
      text: `${name} is a new function identity on every parent render. Stabilize it in the parent:`,
      // Match the concept snippet shape so the highlighter paints like the HTML.
      code: `const ${name} = useCallback(\n  id => select(id), [select]\n);`,
      replayable: true,
    };
  }

  if (cause === "props" && identityOnly.length > 0) {
    const name = identityOnly[0]!;
    return {
      kind: "use-memo",
      text: `${name} is a new object with the same contents every render. Memoize it in the parent:`,
      code: `const ${name} = useMemo(\n  () => ({ /* … */ }),\n  [/* deps */]\n);`,
      replayable: true,
    };
  }

  if (cause === "context" && identityOnly.length > 0) {
    return {
      kind: "context-value",
      text: `Memoize the context value so consumers only render when contents actually change:`,
      code: `const value = useMemo(\n  () => ({ /* … */ }),\n  [/* deps */]\n);`,
      replayable: true,
    };
  }

  if (cause === "context") {
    return {
      kind: "context-selector",
      text: `${componentName} subscribes to the whole context but reads only part of it. Subscribe to the slice instead:`,
      code: `const slice = useContextSelector(\n  ${contextName ?? "Context"}, c => c./* field */\n);`,
      replayable: true,
    };
  }

  return {
    kind: "none",
    text: "No obvious fix — this render looks necessary.",
    code: null,
    replayable: false,
  };
}

export function buildRenderStory(
  store: TraceStore,
  causality: Causality,
  renderId: RenderId,
): RenderStory | null {
  const render = store.getRender(renderId);
  if (!render) return null;
  const instance = store.instance(render.componentId);
  const componentName = instance?.name ?? `#${render.componentId}`;
  const cause = causeOf(render);

  let why;
  try {
    why = causality.why(renderId);
  } catch {
    why = null;
  }
  const wasted = why?.verdict === "no-observable-change";

  const contextReason = render.reasons.find((r) => r.type === "context");
  const contextName = contextReason
    ? (store.instance(contextReason.contextType as unknown as ComponentId)?.name ??
      contextDisplayName(store, renderId, contextReason.contextType) ??
      null)
    : null;

  // ── Cause: the chain back to the origin of this cascade ────────────────────
  const commitEdges = edgesForCommit(store, renderId);
  const origin = originOf(commitEdges, renderId);
  const chain: ChainStep[] = [];
  const nameOf = (rid: RenderId): string => {
    const r = store.getRender(rid);
    return r ? (store.instance(r.componentId)?.name ?? `#${r.componentId}`) : "?";
  };

  if (origin !== renderId) {
    const originRender = store.getRender(origin);
    const originCause = originRender ? causeOf(originRender) : "other";
    const originName = nameOf(origin);
    chain.push({
      kind: "origin",
      text: originCause === "state" ? `setState · ${originName}` : `${originCause} · ${originName}`,
      ...(originRender ? { componentId: originRender.componentId } : {}),
    });
    // Middle step naming the mechanism — the concept's "CartContext value changed".
    if (cause === "context" || contextName) {
      chain.push({
        kind: "link",
        text: `${contextName ?? "Context"} value changed`,
      });
    } else if (cause === "cascade") {
      chain.push({ kind: "link", text: "parent re-rendered (no own changes)" });
    }
    const fanout = contextConsumerCount(commitEdges, store, origin);
    if (fanout > 1 && (cause === "context" || contextName)) {
      chain.push({
        kind: "target",
        text: `${fanout} consumers re-rendered`,
        componentId: render.componentId,
      });
    } else {
      chain.push({
        kind: "target",
        text: `${componentName} re-rendered (${cause})`,
        componentId: render.componentId,
      });
    }
  } else {
    chain.push({
      kind: "origin",
      text: cause === "state" ? `setState · ${componentName}` : `${componentName} — ${cause}`,
      componentId: render.componentId,
    });
  }

  let headline =
    why?.causes[0]?.explanation ??
    (cause === "cascade"
      ? `${componentName} re-rendered because its parent did.`
      : cause === "context" && contextName
        ? `${componentName} re-rendered because ${contextName} changed.`
        : `${componentName} re-rendered (${cause}).`);
  if (wasted) {
    headline = `Wasted render. ${headline}`;
  }

  // ── Change: what actually differed, and whether only the reference did ─────
  const { changes, refWarning, identityOnly, functionProps, stateChanged } = changesForRender(
    store,
    renderId,
  );

  // ── Cost: render / subtree / effects ──────────────────────────────────────
  const effects = store
    .allEvents()
    .filter(
      (e) =>
        e.type === "effect" &&
        e.componentId === render.componentId &&
        e.timestamp >= render.timestamp &&
        e.timestamp <= render.timestamp + Math.max(render.totalDuration, 1) + 16,
    )
    .reduce((sum, e) => sum + (e as { duration: number }).duration, 0);

  const renderMs = Math.max(0, render.selfDuration);
  const residual = Math.max(0, render.totalDuration - render.selfDuration);
  const cost = {
    render: renderMs,
    // `totalDuration - selfDuration` is the SUBTREE's time, not commit time.
    // Labelling it "commit" (and scaling it by an arbitrary share of the
    // commit's total) made a parent component's bar almost entirely one
    // colour — it read as a progress bar rather than a cost breakdown.
    subtree: residual,
    effects,
  };

  return {
    cause,
    headline,
    chain,
    changes,
    refWarning,
    cost,
    wasted,
    fix: suggestFix(
      cause,
      identityOnly,
      functionProps,
      componentName,
      changes.some((c) => c.kind !== "same"),
      contextName,
      stateChanged,
    ),
  };
}

/**
 * Props / state / context rows for one render vs the previous — the same
 * Change list the clip inspector shows. Shared by the story and the Renders
 * feed so the two never drift.
 */
export function changesForRender(
  store: TraceStore,
  renderId: RenderId,
): {
  changes: ChangeRow[];
  refWarning: string | null;
  identityOnly: string[];
  functionProps: string[];
  stateChanged: boolean;
} {
  const render = store.getRender(renderId);
  if (!render) {
    return {
      changes: [],
      refWarning: null,
      identityOnly: [],
      functionProps: [],
      stateChanged: false,
    };
  }
  const previous = store
    .rendersOf(render.componentId)
    .filter((r) => r.timestamp < render.timestamp)
    .at(-1);
  const before = previous ? store.snapshot(previous.renderId) : undefined;
  const after = store.snapshot(renderId);

  const props = diffSection("props", before?.props, after?.props);
  const state = diffSection("state", before?.state, after?.state);
  const context = diffContexts(before, after);
  const changes = [...props.rows, ...state.rows, ...context.rows];
  const identityOnly = [...props.identityOnly, ...state.identityOnly, ...context.identityOnly];
  const functionProps = props.identityOnly.filter((key) => isFunctionKey(after, key));
  const refWarning =
    identityOnly.length > 0
      ? `${identityOnly.join(", ")} ${identityOnly.length === 1 ? "is" : "are"} referentially new but structurally identical — same shape, new reference. Memoized consumers are broken by this.`
      : null;

  return {
    changes,
    refWarning,
    identityOnly,
    functionProps,
    stateChanged: state.rows.some((r) => r.kind !== "same"),
  };
}

/** Prefer the snapshot's displayName when the provider isn't a tracked instance. */
function contextDisplayName(
  store: TraceStore,
  renderId: RenderId,
  contextType: ComponentType,
): string | null {
  const snap = store.snapshot(renderId);
  const match = snap?.contexts?.find((c) => c.contextType === contextType);
  return match?.displayName ?? null;
}

/**
 * Diff consumed contexts between two snapshots.
 *
 * Prefer per-context entries (so `@ref` chips land on `totals`, not a blob);
 * fall back to the combined `context` field the causality engine uses.
 */
function diffContexts(
  before: RenderSnapshot | undefined,
  after: RenderSnapshot | undefined,
): { rows: ChangeRow[]; identityOnly: string[] } {
  const beforeList = before?.contexts ?? [];
  const afterList = after?.contexts ?? [];
  if (beforeList.length === 0 && afterList.length === 0) {
    return diffSection("context", before?.context, after?.context);
  }

  const keyOf = (c: { displayName?: string; contextType?: unknown }, i: number) =>
    c.displayName ?? (c.contextType !== undefined ? String(c.contextType) : `context[${i}]`);

  const beforeMap = new Map(beforeList.map((c, i) => [keyOf(c, i), c.value]));
  const afterMap = new Map(afterList.map((c, i) => [keyOf(c, i), c.value]));
  const rows: ChangeRow[] = [];
  const identityOnly: string[] = [];
  const names = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];

  for (const name of names) {
    const prev = beforeMap.get(name);
    const next = afterMap.get(name);
    // Diff object fields when possible so `totals` gets its own @ref chip.
    const section = diffSection(name, prev, next);
    if (section.rows.length > 0) {
      rows.push(...section.rows);
      identityOnly.push(...section.identityOnly);
      continue;
    }
    // Whole-value fallback (primitive / opaque context).
    if (prev && next && identityOnlyChange(prev, next)) {
      identityOnly.push(name);
      rows.push({
        kind: "removed",
        path: name,
        text: `− ${name}: ${truncate(label(prev))}`,
        ...(identityOf(prev) ? { identity: identityOf(prev)! } : {}),
      });
      rows.push({
        kind: "added",
        path: name,
        text: `+ ${name}: ${truncate(label(next))}`,
        ...(identityOf(next) ? { identity: identityOf(next)! } : {}),
      });
    } else if (prev || next) {
      if (prev) {
        rows.push({
          kind: "removed",
          path: name,
          text: `− ${name}: ${truncate(label(prev))}`,
          ...(identityOf(prev) ? { identity: identityOf(prev)! } : {}),
        });
      }
      if (next) {
        rows.push({
          kind: "added",
          path: name,
          text: `+ ${name}: ${truncate(label(next))}`,
          ...(identityOf(next) ? { identity: identityOf(next)! } : {}),
        });
      }
    }
  }
  return { rows, identityOnly };
}
