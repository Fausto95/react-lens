import type { ComponentDatum } from "./types.js";

export type Predicate = (d: ComponentDatum) => boolean;

/**
 * Parses a structured search query into a predicate over component data.
 * Tokens are space-separated and AND-combined. Supported:
 *   renders:>20  renders:>=5  renders:<3  renders:10
 *   self:>5                                (self time in ms)
 *   compiled:true|false
 *   visual-change:false | changed:true     (observable DOM change)
 *   name:Foo | bare words                  (case-insensitive name substring)
 * Unknown tokens are treated as name substrings, so free text just works.
 */
export function parseQuery(input: string): Predicate {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return () => true;

  const predicates = tokens.map(tokenToPredicate);
  return (d) => predicates.every((p) => p(d));
}

function tokenToPredicate(token: string): Predicate {
  const colon = token.indexOf(":");
  if (colon === -1) return nameContains(token);

  const field = token.slice(0, colon).toLowerCase();
  const value = token.slice(colon + 1);

  switch (field) {
    case "renders":
      return numericField((d) => d.renders, value);
    case "self":
      return numericField((d) => d.selfTime, value);
    case "compiled":
      return (d) => d.compiled === parseBool(value);
    case "visual-change":
    case "changed":
      return (d) => observable(d) === parseBool(value);
    case "name":
      return nameContains(value);
    default:
      // Unknown field — fall back to matching the whole token as a name.
      return nameContains(token);
  }
}

function nameContains(needle: string): Predicate {
  const lower = needle.toLowerCase();
  return (d) => d.name.toLowerCase().includes(lower);
}

function parseBool(value: string): boolean {
  return value === "true" || value === "1" || value === "yes";
}

/** Treat unknown observable-change as "did not change" for filtering. */
function observable(d: ComponentDatum): boolean {
  return d.observableChange === true;
}

function numericField(get: (d: ComponentDatum) => number, expr: string): Predicate {
  const m = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
  if (!m) return () => true;
  const op = m[1] ?? "=";
  const n = Number(m[2]);
  return (d) => {
    const v = get(d);
    switch (op) {
      case ">":
        return v > n;
      case "<":
        return v < n;
      case ">=":
        return v >= n;
      case "<=":
        return v <= n;
      default:
        return v === n;
    }
  };
}
