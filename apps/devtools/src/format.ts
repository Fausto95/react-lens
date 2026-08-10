import type { SerializedValue } from "@react-lens/protocol";

/** Compact human rendering of a serialized value for inspector rows. */
export function formatValue(v: SerializedValue | undefined): string {
  if (!v) return "—";
  switch (v.k) {
    case "primitive":
      return v.type === "string" ? `"${v.value}"` : String(v.value);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "bigint":
      return `${v.value}n`;
    case "symbol":
      return `Symbol(${v.description ?? ""})`;
    case "function":
      return `ƒ ${v.name ?? ""} #${shortId(v.identity)}`;
    case "date":
      return v.iso;
    case "regexp":
      return `/${v.source}/${v.flags}`;
    case "array":
      return `Array(${v.length}) #${shortId(v.identity)}`;
    case "object":
      return `${v.ctor ?? "Object"} #${shortId(v.identity)}`;
    case "map":
      return `Map(${v.size})`;
    case "set":
      return `Set(${v.size})`;
    case "dom":
      return `<${v.nodeName.toLowerCase()}>`;
    case "react-element":
      return `<${v.typeName ?? "?"} />`;
    case "ref":
      return `↻ #${shortId(v.identity)}`;
    case "unserializable":
      return `⟨${v.reason}⟩`;
  }
}

function shortId(identity: string): string {
  return identity.replace(/^[a-z]+_/, "");
}

export function ms(n: number): string {
  if (n < 1) return `${n.toFixed(2)}ms`;
  if (n < 10) return `${n.toFixed(1)}ms`;
  return `${Math.round(n)}ms`;
}
