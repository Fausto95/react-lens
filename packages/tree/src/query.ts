import type { ComponentDatum } from "./types.js";

export type Predicate = (d: ComponentDatum) => boolean;

export interface ParsedQuery {
  predicate: Predicate;
  /** Human-readable parse problems (invalid regex, malformed numerics). */
  errors: string[];
}

/**
 * Parses a structured search query into a predicate over component data.
 * Tokens are space-separated and AND-combined. Supported:
 *   renders:>20  renders:>=5  renders:<3  renders:10
 *   self:>5                                (self time in ms)
 *   compiled:true|false
 *   visual-change:false | changed:true     (observable DOM change)
 *   name:Foo | bare words                  (case-insensitive name substring)
 *   /pattern/flags | name:/pattern/flags   (regex over the name)
 * Unknown tokens are treated as name substrings, so free text just works.
 * Malformed tokens (bad regex, renders:abc) surface in `errors` and match
 * nothing — a silently ignored filter reads as a broken one.
 */
export function parseQuery(input: string): ParsedQuery {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const errors: string[] = [];
  if (tokens.length === 0) return { predicate: () => true, errors };

  const predicates = tokens.map((t) => tokenToPredicate(t, errors));
  return { predicate: (d) => predicates.every((p) => p(d)), errors };
}

const NEVER: Predicate = () => false;

function tokenToPredicate(token: string, errors: string[]): Predicate {
  const asRegex = parseRegexToken(token);
  if (asRegex) return regexPredicate(asRegex, errors);

  const colon = token.indexOf(":");
  if (colon === -1) return nameContains(token);

  const field = token.slice(0, colon).toLowerCase();
  const value = token.slice(colon + 1);

  switch (field) {
    case "renders":
      return numericField((d) => d.renders, value, field, errors);
    case "self":
      return numericField((d) => d.selfTime, value, field, errors);
    case "compiled":
      return (d) => d.compiled === parseBool(value);
    case "visual-change":
    case "changed":
      return (d) => observable(d) === parseBool(value);
    case "name": {
      const valueRegex = parseRegexToken(value);
      return valueRegex ? regexPredicate(valueRegex, errors) : nameContains(value);
    }
    default:
      // Unknown field — fall back to matching the whole token as a name.
      return nameContains(token);
  }
}

/** `/pattern/flags` → its parts, or null when the token isn't regex-shaped. */
function parseRegexToken(token: string): { pattern: string; flags: string } | null {
  const m = /^\/(.+)\/([a-z]*)$/.exec(token);
  return m ? { pattern: m[1]!, flags: m[2]! } : null;
}

function regexPredicate(
  { pattern, flags }: { pattern: string; flags: string },
  errors: string[],
): Predicate {
  try {
    const re = new RegExp(pattern, flags);
    return (d) => re.test(d.name);
  } catch {
    errors.push(`Invalid regex /${pattern}/${flags}`);
    return NEVER;
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

function numericField(
  get: (d: ComponentDatum) => number,
  expr: string,
  field: string,
  errors: string[],
): Predicate {
  const m = /^(>=|<=|>|<|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(expr);
  if (!m) {
    errors.push(`${field}: expects a number (e.g. ${field}:>5)`);
    return NEVER;
  }
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
