/**
 * Open a file:line in a local editor via a custom URL scheme.
 *
 * Exactly ONE navigation per call: browsers show a single external-protocol
 * dialog at a time, so a second scheme fired while it is up cancels it — and
 * removing the carrier iframe early dismisses it too. The editor is chosen
 * from a persisted preference (localStorage "react-lens:editor"), defaulting
 * to vscode. No-op when `file` is empty or a URL.
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

export function openInEditor(file: string, line = 1, column = 1): boolean {
  const path = normalizeEditorPath(file);
  if (!path) return false;
  const url = EDITOR_SCHEMES[preferredEditor()](path, Math.max(1, line), Math.max(1, column));
  // An invisible iframe so we don't navigate the DevTools panel away.
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = url;
    document.documentElement.appendChild(iframe);
    setTimeout(() => iframe.remove(), IFRAME_TTL_MS);
    return true;
  } catch {
    try {
      window.open(url, "_blank");
      return true;
    } catch {
      return false;
    }
  }
}

function normalizeEditorPath(file: string): string | null {
  const trimmed = file.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("webpack:")) return null;
  // Strip webpack / vite file URL prefixes.
  let p = trimmed.replace(/^file:\/\//, "");
  if (p.startsWith("/") && /^\/[A-Za-z]:\//.test(p)) {
    // file:///C:/... → C:/...
    p = p.slice(1);
  }
  return p;
}

/** Absolute path suitable for editor URLs, or null. */
export function editorLocationLabel(file: string, line: number): string {
  return `${file}:${line}`;
}
