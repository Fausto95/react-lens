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

/**
 * Safe serialization for arbitrary application values.
 *
 * Invariants:
 *  - never throws (throwing getters / exotic objects become `unserializable`);
 *  - never retains a strong reference to app objects (identity via WeakMap);
 *  - never recurses past `maxDepth`.
 *
 * Reference identity is the core capability: the same reference always yields
 * the same `identity` string within a session, which is what makes
 * reference-vs-value diffing possible downstream.
 */
export function createSerializer(): Serializer {
  let identities = new WeakMap<object, string>();
  let nextIdentity = 1;

  function identityOf(value: object | Function): string {
    let id = identities.get(value);
    if (id === undefined) {
      const prefix = typeof value === "function" ? "fn" : "obj";
      id = `${prefix}_${nextIdentity++}`;
      identities.set(value, id);
    }
    return id;
  }

  function serialize(value: unknown, opts?: Partial<SerializeOptions>): SerializedValue {
    const options = { ...DEFAULTS, ...opts };
    // `seen` maps an in-progress reference to its identity so cycles collapse
    // to a `ref` pointing back at the enclosing container.
    return walk(value, options, 0, new Map<object, string>());
  }

  function walk(
    value: unknown,
    opts: SerializeOptions,
    depth: number,
    seen: Map<object, string>,
  ): SerializedValue {
    if (value === null) return { k: "null" };
    if (value === undefined) return { k: "undefined" };

    switch (typeof value) {
      case "string": {
        const v =
          value.length > opts.maxStringLength
            ? value.slice(0, opts.maxStringLength) + "…"
            : value;
        return { k: "primitive", type: "string", value: v };
      }
      case "number":
        return { k: "primitive", type: "number", value };
      case "boolean":
        return { k: "primitive", type: "boolean", value };
      case "bigint":
        return { k: "bigint", value: value.toString() };
      case "symbol":
        return { k: "symbol", description: value.description, identity: symbolIdentity(value) };
      case "function":
        return { k: "function", identity: identityOf(value), name: value.name || undefined };
    }

    // From here `value` is a non-null object.
    const obj = value as object;

    const existing = seen.get(obj);
    if (existing !== undefined) return { k: "ref", identity: existing };

    if (obj instanceof Date) return { k: "date", iso: safeIso(obj) };
    if (obj instanceof RegExp) return { k: "regexp", source: obj.source, flags: obj.flags };

    // DOM node — never follow into the live tree.
    if (isDomNode(obj)) {
      return { k: "dom", identity: identityOf(obj), nodeName: (obj as Node).nodeName };
    }
    if (isReactElement(obj)) {
      return {
        k: "react-element",
        identity: identityOf(obj),
        typeName: reactElementTypeName(obj),
      };
    }

    const identity = identityOf(obj);
    seen.set(obj, identity);

    if (obj instanceof Map) return serializeMap(obj, identity, opts, depth, seen);
    if (obj instanceof Set) return serializeSet(obj, identity, opts, depth, seen);
    if (Array.isArray(obj)) return serializeArray(obj, identity, opts, depth, seen);

    return serializePlainObject(obj, identity, opts, depth, seen);
  }

  function serializeArray(
    arr: unknown[],
    identity: string,
    opts: SerializeOptions,
    depth: number,
    seen: Map<object, string>,
  ): SerializedValue {
    if (depth >= opts.maxDepth) return { k: "array", identity, length: arr.length };
    const items: SerializedValue[] = [];
    for (let i = 0; i < arr.length && i < opts.maxItems; i++) {
      items.push(walk(arr[i], opts, depth + 1, seen));
    }
    return { k: "array", identity, length: arr.length, items };
  }

  function serializePlainObject(
    obj: object,
    identity: string,
    opts: SerializeOptions,
    depth: number,
    seen: Map<object, string>,
  ): SerializedValue {
    const ctor = constructorName(obj);
    if (depth >= opts.maxDepth) return { k: "object", identity, ctor };

    const entries: Array<[string, SerializedValue]> = [];
    let keys: string[];
    try {
      keys = Object.keys(obj);
    } catch {
      return { k: "object", identity, ctor };
    }
    for (let i = 0; i < keys.length && i < opts.maxItems; i++) {
      const key = keys[i]!;
      let child: SerializedValue;
      try {
        child = walk((obj as Record<string, unknown>)[key], opts, depth + 1, seen);
      } catch (err) {
        child = { k: "unserializable", reason: reasonOf(err) };
      }
      entries.push([key, child]);
    }
    return { k: "object", identity, ctor, entries };
  }

  function serializeMap(
    map: Map<unknown, unknown>,
    identity: string,
    opts: SerializeOptions,
    depth: number,
    seen: Map<object, string>,
  ): SerializedValue {
    if (depth >= opts.maxDepth) return { k: "map", identity, size: map.size };
    const entries: Array<[SerializedValue, SerializedValue]> = [];
    let i = 0;
    for (const [key, val] of map) {
      if (i++ >= opts.maxItems) break;
      entries.push([walk(key, opts, depth + 1, seen), walk(val, opts, depth + 1, seen)]);
    }
    return { k: "map", identity, size: map.size, entries };
  }

  function serializeSet(
    set: Set<unknown>,
    identity: string,
    opts: SerializeOptions,
    depth: number,
    seen: Map<object, string>,
  ): SerializedValue {
    if (depth >= opts.maxDepth) return { k: "set", identity, size: set.size };
    const values: SerializedValue[] = [];
    let i = 0;
    for (const val of set) {
      if (i++ >= opts.maxItems) break;
      values.push(walk(val, opts, depth + 1, seen));
    }
    return { k: "set", identity, size: set.size, values };
  }

  const symbolIdentities = new Map<symbol, string>();
  function symbolIdentity(sym: symbol): string {
    let id = symbolIdentities.get(sym);
    if (id === undefined) {
      id = `sym_${nextIdentity++}`;
      symbolIdentities.set(sym, id);
    }
    return id;
  }

  function reset(): void {
    // WeakMap has no clear(); replace it so previously-seen references get
    // fresh identities. Bump the counter too so newly minted identities never
    // collide with ones the panel may still be holding from the old session.
    identities = new WeakMap<object, string>();
    nextIdentity += 1_000_000;
    symbolIdentities.clear();
  }

  return { serialize, identityOf, reset };
}

function safeIso(d: Date): string {
  const t = d.getTime();
  return Number.isNaN(t) ? "Invalid Date" : d.toISOString();
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

function isDomNode(obj: object): boolean {
  return typeof Node !== "undefined" && obj instanceof Node;
}

function isReactElement(obj: object): boolean {
  return (
    "$$typeof" in obj &&
    typeof (obj as { $$typeof: unknown }).$$typeof === "symbol"
  );
}

function reactElementTypeName(obj: object): string | undefined {
  const type = (obj as { type?: unknown }).type;
  if (typeof type === "string") return type;
  if (typeof type === "function") return type.name || undefined;
  return undefined;
}
