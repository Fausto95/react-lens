import { createPlugin, toCrossJSON } from "seroval";
import type { SerializedValue } from "@reactlens/protocol";

export interface SerializeOptions {
  maxDepth: number;
  maxItems: number;
  maxStringLength: number;
}

const DEFAULTS: SerializeOptions = {
  maxDepth: 4,
  maxItems: 50,
  maxStringLength: 1_000,
};

export interface Serializer {
  serialize(value: unknown, opts?: Partial<SerializeOptions>): SerializedValue;
  identityOf(value: object | Function): string;
  reset(): void;
}

/** Marker produced by the soften pass when a getter throws. */
class Unserializable {
  reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}

const TAG_FUNCTION = "rl/function";
const TAG_DOM = "rl/dom";
const TAG_REACT = "rl/react-element";
const TAG_SYMBOL = "rl/symbol";
const TAG_BAD = "rl/unserializable";

/** Seroval node type tags (mirrors seroval's SerovalNodeType). */
const T = {
  Number: 0,
  String: 1,
  Constant: 2,
  BigInt: 3,
  IndexedValue: 4,
  Date: 5,
  RegExp: 6,
  Set: 7,
  Map: 8,
  Array: 9,
  Object: 10,
  NullConstructor: 11,
  Error: 13,
  WKSymbol: 17,
  Plugin: 25,
} as const;

const C = {
  Null: 0,
  Undefined: 1,
  True: 2,
  False: 3,
  NegZero: 4,
  Inf: 5,
  NegInf: 6,
  Nan: 7,
} as const;

type SerovalNode = {
  t: number;
  i?: number;
  s?: unknown;
  c?: unknown;
  m?: unknown;
  a?: unknown[];
  p?: { k?: unknown[]; v?: unknown[] };
  e?: { k?: unknown[]; v?: unknown[] };
  o?: number;
  f?: unknown;
};

/**
 * Safe serialization for arbitrary application values, backed by seroval.
 *
 * Invariants:
 *  - never throws (throwing getters / exotic objects become `unserializable`);
 *  - never retains a strong reference to app objects (identity via WeakMap);
 *  - never recurses past `maxDepth`.
 *
 * seroval encodes the tree (cycles, Map/Set/BigInt, plugins for functions/DOM).
 * A session WeakMap stamps stable `identity` strings onto every reference so
 * reference-vs-value diffing still works across snapshots.
 */
export function createSerializer(): Serializer {
  let identities = new WeakMap<object, string>();
  let nextIdentity = 1;
  const symbolIdentities = new Map<symbol, string>();

  const plugins = [
    createPlugin<Unserializable, { reason: string }>({
      tag: TAG_BAD,
      test: (v): v is Unserializable => v instanceof Unserializable,
      parse: { sync: (v) => ({ reason: v.reason }) },
      serialize: () => "null",
      deserialize: (n) => new Unserializable(n.reason),
    }),
    createPlugin<Function, { name: string }>({
      tag: TAG_FUNCTION,
      test: (v): v is Function => typeof v === "function",
      parse: { sync: (v) => ({ name: v.name || "" }) },
      serialize: () => "null",
      deserialize: () => function () {},
    }),
    createPlugin<object, { nodeName: string }>({
      tag: TAG_DOM,
      test: (v): v is object => typeof Node !== "undefined" && v instanceof Node,
      parse: { sync: (v) => ({ nodeName: (v as Node).nodeName }) },
      serialize: () => "null",
      deserialize: () => null as never,
    }),
    createPlugin<object, { typeName?: string }>({
      tag: TAG_REACT,
      test: (v): v is object =>
        typeof v === "object" &&
        v !== null &&
        "$$typeof" in v &&
        typeof (v as { $$typeof: unknown }).$$typeof === "symbol",
      parse: {
        sync: (v) => {
          const type = (v as { type?: unknown }).type;
          const typeName =
            typeof type === "string"
              ? type
              : typeof type === "function"
                ? type.name || undefined
                : undefined;
          return typeName !== undefined ? { typeName } : {};
        },
      },
      serialize: () => "null",
      deserialize: () => null as never,
    }),
    createPlugin<symbol, { description?: string }>({
      tag: TAG_SYMBOL,
      test: (v): v is symbol => typeof v === "symbol",
      parse: {
        sync: (v) => (v.description !== undefined ? { description: v.description } : {}),
      },
      serialize: () => "null",
      deserialize: (n) => Symbol(n.description),
    }),
  ];

  function identityOf(value: object | Function): string {
    let id = identities.get(value);
    if (id === undefined) {
      const prefix = typeof value === "function" ? "fn" : "obj";
      id = `${prefix}_${nextIdentity++}`;
      identities.set(value, id);
    }
    return id;
  }

  function symbolIdentity(sym: symbol): string {
    let id = symbolIdentities.get(sym);
    if (id === undefined) {
      id = `sym_${nextIdentity++}`;
      symbolIdentities.set(sym, id);
    }
    return id;
  }

  function identityForIndex(
    index: number | undefined,
    byIndex: Map<number, object>,
    kind: "fn" | "obj",
  ): string {
    if (index === undefined) return `${kind}_${nextIdentity++}`;
    const original = byIndex.get(index);
    if (original !== undefined) return identityOf(original);
    return `${kind}_${index}`;
  }

  function serialize(value: unknown, opts?: Partial<SerializeOptions>): SerializedValue {
    const options = { ...DEFAULTS, ...opts };
    try {
      const standInToOriginal = new WeakMap<object, object>();
      const softened = soften(value, options, 0, new WeakMap(), standInToOriginal);
      const callRefs = new Map<unknown, number>();
      const tree = toCrossJSON(softened, { refs: callRefs, plugins }) as SerovalNode;
      const byIndex = new Map<number, object>();
      for (const [obj, i] of callRefs) {
        if (typeof obj === "object" && obj !== null) {
          byIndex.set(i, standInToOriginal.get(obj) ?? obj);
        } else if (typeof obj === "function") {
          byIndex.set(i, obj);
        } else if (typeof obj === "symbol") {
          // Stored as object for the map type; recovered via typeof check in projectPlugin.
          byIndex.set(i, obj as unknown as object);
        }
      }
      return project(tree, byIndex, options, 0, new Set());
    } catch (err) {
      return { k: "unserializable", reason: reasonOf(err) };
    }
  }

  function project(
    node: SerovalNode | 0 | null | undefined,
    byIndex: Map<number, object>,
    opts: SerializeOptions,
    depth: number,
    seen: Set<number>,
  ): SerializedValue {
    if (node === 0 || node == null) return { k: "undefined" };
    if (typeof node !== "object") return { k: "unserializable", reason: "unexpected node" };

    switch (node.t) {
      case T.Number:
        return { k: "primitive", type: "number", value: node.s as number };
      case T.String: {
        let v = String(node.s ?? "");
        if (v.length > opts.maxStringLength) v = v.slice(0, opts.maxStringLength) + "…";
        return { k: "primitive", type: "string", value: v };
      }
      case T.Constant:
        return projectConstant(node.s as number);
      case T.BigInt:
        return { k: "bigint", value: String(node.s ?? "0") };
      case T.IndexedValue: {
        const i = node.i;
        if (i !== undefined && seen.has(i)) {
          return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
        }
        // Top-level re-entry shouldn't happen with fresh refs; treat as ref.
        return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
      }
      case T.Date:
        return { k: "date", iso: String(node.s ?? "Invalid Date") };
      case T.RegExp:
        return { k: "regexp", source: String(node.c ?? ""), flags: String(node.m ?? "") };
      case T.Array: {
        const i = node.i;
        if (i !== undefined) {
          if (seen.has(i)) return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
          seen.add(i);
        }
        const identity = identityForIndex(i, byIndex, "obj");
        const itemsRaw = node.a ?? [];
        if (depth >= opts.maxDepth) return { k: "array", identity, length: itemsRaw.length };
        const items: SerializedValue[] = [];
        for (let n = 0; n < itemsRaw.length && n < opts.maxItems; n++) {
          const child = itemsRaw[n];
          items.push(
            child === 0 || child == null
              ? { k: "undefined" }
              : project(child as SerovalNode, byIndex, opts, depth + 1, seen),
          );
        }
        return { k: "array", identity, length: itemsRaw.length, items };
      }
      case T.Object:
      case T.NullConstructor: {
        const i = node.i;
        if (i !== undefined) {
          if (seen.has(i)) return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
          seen.add(i);
        }
        const original = i !== undefined ? byIndex.get(i) : undefined;
        const identity = identityForIndex(i, byIndex, "obj");
        const ctor = original ? constructorName(original) : undefined;
        if (depth >= opts.maxDepth) {
          return ctor !== undefined ? { k: "object", identity, ctor } : { k: "object", identity };
        }
        const keys = (node.p?.k ?? []) as string[];
        const values = (node.p?.v ?? []) as SerovalNode[];
        const entries: Array<[string, SerializedValue]> = [];
        for (let n = 0; n < keys.length && n < opts.maxItems; n++) {
          entries.push([
            String(keys[n]),
            project(values[n] as SerovalNode, byIndex, opts, depth + 1, seen),
          ]);
        }
        return ctor !== undefined
          ? { k: "object", identity, ctor, entries }
          : { k: "object", identity, entries };
      }
      case T.Map: {
        const i = node.i;
        if (i !== undefined) {
          if (seen.has(i)) return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
          seen.add(i);
        }
        const identity = identityForIndex(i, byIndex, "obj");
        const keys = (node.e?.k ?? []) as SerovalNode[];
        const values = (node.e?.v ?? []) as SerovalNode[];
        const size = keys.length;
        if (depth >= opts.maxDepth) return { k: "map", identity, size };
        const entries: Array<[SerializedValue, SerializedValue]> = [];
        for (let n = 0; n < keys.length && n < opts.maxItems; n++) {
          entries.push([
            project(keys[n]!, byIndex, opts, depth + 1, seen),
            project(values[n]!, byIndex, opts, depth + 1, seen),
          ]);
        }
        return { k: "map", identity, size, entries };
      }
      case T.Set: {
        const i = node.i;
        if (i !== undefined) {
          if (seen.has(i)) return { k: "ref", identity: identityForIndex(i, byIndex, "obj") };
          seen.add(i);
        }
        const identity = identityForIndex(i, byIndex, "obj");
        const itemsRaw = (node.a ?? []) as SerovalNode[];
        if (depth >= opts.maxDepth) return { k: "set", identity, size: itemsRaw.length };
        const values: SerializedValue[] = [];
        for (let n = 0; n < itemsRaw.length && n < opts.maxItems; n++) {
          values.push(project(itemsRaw[n]!, byIndex, opts, depth + 1, seen));
        }
        return { k: "set", identity, size: itemsRaw.length, values };
      }
      case T.Error: {
        const i = node.i;
        const identity = identityForIndex(i, byIndex, "obj");
        const message = String(node.m ?? "");
        return {
          k: "object",
          identity,
          ctor: "Error",
          entries: [["message", { k: "primitive", type: "string", value: message }]],
        };
      }
      case T.Plugin:
        return projectPlugin(node, byIndex);
      case T.WKSymbol:
        return {
          k: "symbol",
          description: undefined,
          identity: `sym_wk_${String(node.s ?? 0)}`,
        };
      default:
        return { k: "unserializable", reason: `unsupported seroval node ${node.t}` };
    }
  }

  function projectPlugin(node: SerovalNode, byIndex: Map<number, object>): SerializedValue {
    const tag = String(node.c ?? "");
    const data = (node.s ?? {}) as Record<string, unknown>;
    const i = node.i;
    switch (tag) {
      case TAG_FUNCTION: {
        const identity = identityForIndex(i, byIndex, "fn");
        const name = typeof data.name === "string" && data.name ? data.name : undefined;
        return name !== undefined ? { k: "function", identity, name } : { k: "function", identity };
      }
      case TAG_DOM: {
        const identity = identityForIndex(i, byIndex, "obj");
        return { k: "dom", identity, nodeName: String(data.nodeName ?? "Unknown") };
      }
      case TAG_REACT: {
        const identity = identityForIndex(i, byIndex, "obj");
        const typeName = typeof data.typeName === "string" ? data.typeName : undefined;
        return typeName !== undefined
          ? { k: "react-element", identity, typeName }
          : { k: "react-element", identity };
      }
      case TAG_SYMBOL: {
        const original = i !== undefined ? byIndex.get(i) : undefined;
        const identity =
          typeof original === "symbol" ? symbolIdentity(original) : `sym_${i ?? nextIdentity++}`;
        const description = typeof data.description === "string" ? data.description : undefined;
        return description !== undefined
          ? { k: "symbol", description, identity }
          : { k: "symbol", identity };
      }
      case TAG_BAD:
        return { k: "unserializable", reason: String(data.reason ?? "unserializable") };
      default:
        return { k: "unserializable", reason: `unknown plugin ${tag}` };
    }
  }

  function reset(): void {
    identities = new WeakMap<object, string>();
    nextIdentity += 1_000_000;
    symbolIdentities.clear();
  }

  return { serialize, identityOf, reset };
}

function projectConstant(code: number): SerializedValue {
  switch (code) {
    case C.Null:
      return { k: "null" };
    case C.Undefined:
      return { k: "undefined" };
    case C.True:
      return { k: "primitive", type: "boolean", value: true };
    case C.False:
      return { k: "primitive", type: "boolean", value: false };
    case C.NegZero:
      return { k: "primitive", type: "number", value: -0 };
    case C.Inf:
      return { k: "primitive", type: "number", value: Infinity };
    case C.NegInf:
      return { k: "primitive", type: "number", value: -Infinity };
    case C.Nan:
      return { k: "primitive", type: "number", value: NaN };
    default:
      return { k: "undefined" };
  }
}

/**
 * Produce a seroval-safe view of `value`. Containers keep their original
 * reference whenever every property access succeeds — that is what keeps
 * session identity stable across snapshots. A getter that throws is replaced
 * with an Unserializable marker on a shallow stand-in so encode never aborts.
 * Class instances become plain stand-ins (seroval rejects custom prototypes)
 * while `standInToOriginal` keeps identity/ctor pointed at the live object.
 */
function soften(
  value: unknown,
  opts: SerializeOptions,
  depth: number,
  seen: WeakMap<object, unknown>,
  standInToOriginal: WeakMap<object, object>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Unserializable) return value;
  // Built-ins and host objects: seroval (or our plugins) handle them; do not
  // clone — cloning would mint a new identity every snapshot.
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    Array.isArray(value) ||
    value instanceof Error ||
    (typeof Node !== "undefined" && value instanceof Node) ||
    ("$$typeof" in value && typeof (value as { $$typeof: unknown }).$$typeof === "symbol")
  ) {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) return existing;
  if (depth >= opts.maxDepth) return value;

  let keys: string[];
  try {
    keys = Object.keys(value);
  } catch (err) {
    return new Unserializable(reasonOf(err));
  }

  const reads: Array<[string, unknown]> = [];
  let failed = false;
  for (let i = 0; i < keys.length && i < opts.maxItems; i++) {
    const key = keys[i]!;
    try {
      reads.push([key, (value as Record<string, unknown>)[key]]);
    } catch (err) {
      failed = true;
      reads.push([key, new Unserializable(reasonOf(err))]);
    }
  }

  let childChanged = failed;
  const softenedChildren: Array<[string, unknown]> = [];
  for (const [key, child] of reads) {
    if (child instanceof Unserializable) {
      softenedChildren.push([key, child]);
      continue;
    }
    const next = soften(child, opts, depth + 1, seen, standInToOriginal);
    softenedChildren.push([key, next]);
    if (next !== child) childChanged = true;
  }

  const needsStandIn = childChanged || !isPlainObject(value);
  if (!needsStandIn) {
    seen.set(value, value);
    return value;
  }

  const out: Record<string, unknown> = {};
  seen.set(value, out);
  standInToOriginal.set(out, value);
  for (const [key, child] of softenedChildren) out[key] = child;
  return out;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function constructorName(obj: object): string | undefined {
  try {
    const name = obj.constructor?.name;
    return name && name !== "Object" ? name : undefined;
  } catch {
    return undefined;
  }
}

function reasonOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "threw during access";
}
