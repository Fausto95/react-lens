/**
 * Open a file:line in a local editor.
 *
 * Routing (see editorOpenPlan): dev-server URLs and root/relative sourcemap
 * paths go to Vite's /__open-in-editor middleware — only the server knows the
 * project root on disk, a vscode://file scheme would error with "path does
 * not exist". Real OS-absolute paths use the editor's URL scheme directly.
 *
 * Scheme navigations fire exactly ONCE per call: browsers show a single
 * external-protocol dialog at a time, so a second scheme fired while it is up
 * cancels it — and removing the carrier iframe early dismisses it too. The
 * editor is chosen from a persisted preference (localStorage
 * "react-lens:editor"), defaulting to vscode.
 */

export type EditorId = keyof typeof EDITOR_SCHEMES;

const EDITOR_SCHEMES = {
  vscode: (p: string, l: number, c: number) => `vscode://file/${p}:${l}:${c}`,
  cursor: (p: string, l: number, c: number) => `cursor://file/${p}:${l}:${c}`,
  windsurf: (p: string, l: number, c: number) => `windsurf://file/${p}:${l}:${c}`,
  webstorm: (p: string, l: number, c: number) =>
    `webstorm://open?file=${encodeURIComponent(p)}&line=${l}&column=${c}`,
} as const;

const EDITOR_PREF_KEY = "react-lens:editor";
const DEFAULT_EDITOR: EditorId = "vscode";
/** Long enough to answer the browser's open-app dialog. */
const IFRAME_TTL_MS = 60_000;

export function preferredEditor(): EditorId {
  try {
    const v = localStorage.getItem(EDITOR_PREF_KEY);
    return v && v in EDITOR_SCHEMES ? (v as EditorId) : DEFAULT_EDITOR;
  } catch {
    return DEFAULT_EDITOR;
  }
}

export const EDITOR_IDS = Object.keys(EDITOR_SCHEMES) as EditorId[];

export function setPreferredEditor(editor: EditorId): void {
  try {
    localStorage.setItem(EDITOR_PREF_KEY, editor);
  } catch {
    /* storage unavailable — the preference simply doesn't persist */
  }
}

export type EditorOpenPlan = { kind: "dev-server"; url: string } | { kind: "scheme"; url: string };

/** Roots that mark a path as a real filesystem location, not server-relative. */
const OS_ABSOLUTE = /^(\/(Users|home|var|opt|srv|mnt|tmp|private|Volumes)\/|\/?[A-Za-z]:[\\/])/;

/** Pure routing: where should this source location open? Null = nowhere. */
export function editorOpenPlan(
  file: string,
  line: number,
  column: number,
  pageOrigin: string,
): EditorOpenPlan | null {
  const trimmed = file.trim();
  if (!trimmed || trimmed.startsWith("webpack:")) return null;

  const devServer = (origin: string, path: string): EditorOpenPlan => ({
    kind: "dev-server",
    url: `${origin}/__open-in-editor?file=${encodeURIComponent(`${path.replace(/^\/+/, "")}:${line}:${column}`)}`,
  });

  // Dev-server URL: the serving origin can open it relative to its root.
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    return devServer(url.origin, url.pathname);
  }

  let p = trimmed.replace(/^file:\/\//, "");
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // file:///C:/… → C:/…

  // Real filesystem path → editor scheme.
  if (OS_ABSOLUTE.test(p)) {
    return { kind: "scheme", url: EDITOR_SCHEMES[preferredEditor()](p, line, column) };
  }

  // Root-relative or bare-relative sourcemap path: only a dev server can
  // resolve it against the project root.
  if (/^https?:$/.test(safeProtocol(pageOrigin))) return devServer(pageOrigin, p);

  // Extension panel with no dev-server origin: a leading-slash path might
  // still be absolute on exotic roots — try the scheme as a best effort.
  if (p.startsWith("/")) {
    return { kind: "scheme", url: EDITOR_SCHEMES[preferredEditor()](p, line, column) };
  }
  return null;
}

function safeProtocol(origin: string): string {
  try {
    return new URL(origin).protocol;
  } catch {
    return "";
  }
}

/** A path launch-editor could NOT resolve without knowing the map's root. */
export function isOsAbsolutePath(p: string): boolean {
  return OS_ABSOLUTE.test(p.replace(/^file:\/\//, ""));
}

/**
 * Open a source location that went through sourcemap resolution. Sourcemap
 * originals are often bare filenames ("Showcase.tsx") the server can't locate;
 * the compiled dev-server URL is the reliable file identity in dev (Vite
 * transforms are 1:1 per module), so open THAT file at the RESOLVED position.
 */
export function openResolvedInEditor(
  compiled: { file: string; line: number; column?: number },
  resolved: { file: string; line: number; column?: number } | null,
): boolean {
  const at = resolved ?? compiled;
  const file = resolved && isOsAbsolutePath(resolved.file) ? resolved.file : compiled.file;
  return openInEditor(file, at.line, at.column ?? 1);
}

export function openInEditor(file: string, line = 1, column = 1): boolean {
  const plan = editorOpenPlan(file, Math.max(1, line), Math.max(1, column), window.location.origin);
  if (!plan) return false;
  if (plan.kind === "dev-server") {
    void fetch(plan.url).catch(() => {
      /* middleware absent (non-Vite server) — nothing else can resolve it */
    });
    return true;
  }
  // An invisible iframe so we don't navigate the DevTools panel away.
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = plan.url;
    document.documentElement.appendChild(iframe);
    setTimeout(() => iframe.remove(), IFRAME_TTL_MS);
    return true;
  } catch {
    try {
      window.open(plan.url, "_blank");
      return true;
    } catch {
      return false;
    }
  }
}

/** Absolute path suitable for editor URLs, or null. */
export function editorLocationLabel(file: string, line: number): string {
  return `${file}:${line}`;
}
