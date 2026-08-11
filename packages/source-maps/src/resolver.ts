import { TraceMap, originalPositionFor, sourceContentFor } from "@jridgewell/trace-mapping";
import type { SourceLocation } from "@reactlens/protocol";

/** A resolved original position; `name` is the pre-minification identifier. */
export interface ResolvedLocation extends SourceLocation {
  name?: string;
}

export interface OriginalSource {
  /** Normalized original path, e.g. src/App.tsx. */
  path: string;
  /** Original (pre-compile) source text, from the map's sourcesContent. */
  content: string;
}

export type Fetcher = (url: string) => Promise<string>;

export interface SourceResolver {
  /**
   * Maps a compiled position (as seen in a stack / _debugStack) back to the
   * original source coordinates using the module's source map. Returns null if
   * no map is available or the position can't be mapped.
   */
  resolve(compiled: SourceLocation): Promise<ResolvedLocation | null>;
  /**
   * Original source text for a compiled module. When `prefer` is set, pick the
   * map source that best matches that path; otherwise use the last resolved
   * original, else the first entry with content.
   */
  sourceContent(compiledFile: string, prefer?: string): Promise<OriginalSource | null>;
  clear(): void;
}

const defaultFetch: Fetcher = async (url) => {
  // Only fetch absolute http(s) URLs. A bare pathname would resolve against the
  // caller's origin — in the extension panel that's chrome-extension://, which
  // logs a noisy ERR_FILE_NOT_FOUND for every lookup. Bail before fetch so the
  // resolver degrades quietly to null instead.
  if (!/^https?:\/\//.test(url)) throw new Error(`unsupported source url: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
};

/**
 * Resolves original source positions by fetching each module and parsing its
 * (usually inline) source map. Maps are cached per file. Framework-free — the
 * fetcher is injectable so it works in the panel, tests, or a worker.
 */
export function createSourceResolver(fetcher: Fetcher = defaultFetch): SourceResolver {
  const maps = new Map<string, TraceMap | null>();
  /** Last resolved original path per compiled file — used by sourceContent. */
  const lastOriginal = new Map<string, string>();

  async function mapFor(file: string): Promise<TraceMap | null> {
    if (maps.has(file)) return maps.get(file)!;
    let map: TraceMap | null = null;
    try {
      const code = await fetcher(file);
      const raw = extractSourceMap(code, file, fetcher);
      map = raw ? new TraceMap(await raw) : null;
    } catch {
      map = null;
    }
    maps.set(file, map);
    return map;
  }

  async function resolve(compiled: SourceLocation): Promise<ResolvedLocation | null> {
    const map = await mapFor(compiled.file);
    if (!map) return null;
    const pos = originalPositionFor(map, { line: compiled.line, column: compiled.column });
    if (pos.source == null || pos.line == null) return null;
    const file = normalizeSource(pos.source);
    lastOriginal.set(compiled.file, pos.source);
    return {
      file,
      line: pos.line,
      column: pos.column ?? 0,
      // The pre-minification identifier, when the map recorded one — the only
      // route back from `Qj` to `ProductCard`.
      ...(pos.name ? { name: pos.name } : {}),
    };
  }

  async function sourceContent(
    compiledFile: string,
    prefer?: string,
  ): Promise<OriginalSource | null> {
    const map = await mapFor(compiledFile);
    if (!map) return null;

    const matchesPrefer = (raw: string) => {
      if (!prefer) return true;
      const norm = normalizeSource(raw);
      return raw === prefer || norm === prefer || raw.endsWith(prefer) || norm.endsWith(prefer);
    };

    const ordered: string[] = [];
    const remembered = lastOriginal.get(compiledFile);
    if (remembered) ordered.push(remembered);
    for (const s of map.sources) {
      if (typeof s === "string") ordered.push(s);
    }

    const tried = new Set<string>();
    // First pass: prefer match
    if (prefer) {
      for (const raw of ordered) {
        if (tried.has(raw) || !matchesPrefer(raw)) continue;
        tried.add(raw);
        const content = sourceContentFor(map, raw);
        if (content != null) return { path: normalizeSource(raw), content };
      }
    }
    // Second pass: first available content
    for (const raw of ordered) {
      if (tried.has(raw)) continue;
      tried.add(raw);
      const content = sourceContentFor(map, raw);
      if (content != null) return { path: normalizeSource(raw), content };
    }
    return null;
  }

  return {
    resolve,
    sourceContent,
    clear: () => {
      maps.clear();
      lastOriginal.clear();
    },
  };
}

const INLINE = /\/\/[#@]\s*sourceMappingURL=data:application\/json[^,]*(?:;base64)?,([^\s'"]+)/;
const EXTERNAL = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m;

function extractSourceMap(
  code: string,
  file: string,
  fetcher: Fetcher,
): Promise<string> | string | null {
  const inline = INLINE.exec(code);
  if (inline) {
    const payload = inline[1]!;
    // base64 or URL-encoded JSON. atob exists in browsers and Node 20+.
    if (/;base64,/.test(inline[0])) return atob(payload);
    return decodeURIComponent(payload);
  }
  const external = EXTERNAL.exec(code);
  if (external) {
    const mapUrl = new URL(external[1]!, file).href;
    return fetcher(mapUrl);
  }
  return null;
}

/** Strip Vite/bundler prefixes so paths read like the repo layout. */
function normalizeSource(source: string): string {
  return source.replace(/^.*?\/(src\/)/, "$1").replace(/^\.?\//, "");
}
