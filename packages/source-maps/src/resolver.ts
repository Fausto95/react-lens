import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import type { SourceLocation } from "@react-lens/protocol";

export interface SourceResolver {
  /**
   * Maps a compiled position (as seen in a stack / _debugStack) back to the
   * original source coordinates using the module's source map. Returns null if
   * no map is available or the position can't be mapped.
   */
  resolve(compiled: SourceLocation): Promise<SourceLocation | null>;
  clear(): void;
}

type Fetcher = (url: string) => Promise<string>;

const defaultFetch: Fetcher = async (url) => {
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

  async function resolve(compiled: SourceLocation): Promise<SourceLocation | null> {
    const map = await mapFor(compiled.file);
    if (!map) return null;
    const pos = originalPositionFor(map, { line: compiled.line, column: compiled.column });
    if (pos.source == null || pos.line == null) return null;
    return {
      file: normalizeSource(pos.source),
      line: pos.line,
      column: pos.column ?? 0,
    };
  }

  return {
    resolve,
    clear: () => maps.clear(),
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
