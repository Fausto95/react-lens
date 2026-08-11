/**
 * The component name declared on a line of original source.
 *
 * Needed because minifiers usually record no sourcemap `names` entry for a
 * function's body position, so a located production component resolves to a
 * file and line but no identifier. The original line itself carries it.
 */

/** Component names are capitalised; hooks and helpers are not. */
const COMPONENT = "[A-Z][A-Za-z0-9_$]*";

const PATTERNS = [
  // memo(function Inner…) / forwardRef(function Inner…) — the located function
  // is the inner one, so its name wins over the binding's.
  new RegExp(`\\((?:function|class)\\s+(${COMPONENT})`),
  // function App() / export default async function Page()
  new RegExp(`\\bfunction\\s*\\*?\\s+(${COMPONENT})\\s*[(<]`),
  // class Boundary extends …
  new RegExp(`\\bclass\\s+(${COMPONENT})\\b`),
  // const Button = (…) => / let Legacy = function
  new RegExp(`\\b(?:const|let|var)\\s+(${COMPONENT})\\s*=`),
];

export function declaredNameAtLine(sourceText: string, line: number): string | null {
  if (!sourceText || line < 1) return null;
  return nameOnLine(sourceText.split("\n")[line - 1]);
}

function nameOnLine(text: string | undefined): string | null {
  if (!text) return null;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** How far above a located line to look for its enclosing declaration. */
const MAX_LOOKBACK = 40;

/**
 * Name of the component enclosing `line`. A located frame typically points at
 * the first statement inside the component (the hook call that threw), so walk
 * upward — stopping at a closed top-level block, which means we left the
 * function and would otherwise borrow the previous component's name.
 */
export function declaredNameNear(sourceText: string, line: number): string | null {
  if (!sourceText || line < 1) return null;
  const lines = sourceText.split("\n");
  if (line > lines.length) return null;
  for (let i = line - 1; i >= 0 && i > line - 1 - MAX_LOOKBACK; i--) {
    const text = lines[i]!;
    const found = nameOnLine(text);
    if (found) return found;
    // A brace closing at column 0 ends a top-level block: anything above it
    // encloses nothing here.
    if (i < line - 1 && /^\s*\}/.test(text) && !/^\s+/.test(text)) return null;
  }
  return null;
}
