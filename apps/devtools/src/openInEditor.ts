/**
 * Open a file:line in a local editor via custom URL schemes.
 * Tries Cursor, then VS Code, then JetBrains — first navigation wins in practice
 * (OS handler registration). No-op when `file` is empty or a URL.
 */
export function openInEditor(
  file: string,
  line = 1,
  column = 1,
): boolean {
  const path = normalizeEditorPath(file);
  if (!path) return false;
  const loc = `${path}:${Math.max(1, line)}:${Math.max(1, column)}`;
  const schemes = [
    `cursor://file/${loc}`,
    `vscode://file/${loc}`,
    `windsurf://file/${loc}`,
    `webstorm://open?file=${encodeURIComponent(path)}&line=${line}&column=${column}`,
  ];
  // Prefer an invisible iframe so we don't navigate the DevTools panel away.
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = schemes[0]!;
    document.documentElement.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1500);
    // Also poke vscode as fallback for users without Cursor.
    setTimeout(() => {
      const iframe2 = document.createElement("iframe");
      iframe2.style.display = "none";
      iframe2.src = schemes[1]!;
      document.documentElement.appendChild(iframe2);
      setTimeout(() => iframe2.remove(), 1500);
    }, 80);
    return true;
  } catch {
    try {
      window.open(schemes[0], "_blank");
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
