/**
 * Open a file:line in a local editor via custom URL schemes (page MAIN world).
 */
export function openInEditor(file: string, line = 1, column = 1): boolean {
  const path = normalizeEditorPath(file);
  if (!path) return false;
  const loc = `${path}:${Math.max(1, line)}:${Math.max(1, column)}`;
  const schemes = [`cursor://file/${loc}`, `vscode://file/${loc}`];
  try {
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = schemes[0]!;
    document.documentElement.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1500);
    setTimeout(() => {
      const iframe2 = document.createElement("iframe");
      iframe2.style.display = "none";
      iframe2.src = schemes[1]!;
      document.documentElement.appendChild(iframe2);
      setTimeout(() => iframe2.remove(), 1500);
    }, 80);
    return true;
  } catch {
    return false;
  }
}

function normalizeEditorPath(file: string): string | null {
  const trimmed = file.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("webpack:")) return null;
  let p = trimmed.replace(/^file:\/\//, "");
  if (p.startsWith("/") && /^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  return p;
}
