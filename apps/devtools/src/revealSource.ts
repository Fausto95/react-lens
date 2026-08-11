import type { SourceLocation } from "@reactlens/protocol";
import { openResolvedInEditor } from "./openInEditor.js";

/**
 * Show a source location to the user.
 *
 * Two surfaces, because "the source" means different things: an embedded panel
 * inspects an app whose files are on this machine, so the local editor is
 * right. The extension may be inspecting any deployed site — those files exist
 * only inside the page, and the browser's own Sources panel already has them
 * (with sourcemaps applied). Injected so this module stays framework- and
 * chrome-free.
 */
export type SourceRevealer = (file: string, line: number, column: number) => Promise<boolean>;

let revealer: SourceRevealer | undefined;

export function configureSourceRevealer(next: SourceRevealer | undefined): void {
  revealer = next;
}

export async function revealSource(
  compiled: SourceLocation,
  original: SourceLocation | null,
): Promise<boolean> {
  if (revealer) {
    // Hand over the original path when we have one: the browser resolves maps
    // itself, so this lands on readable code rather than a minified chunk.
    const at = original ?? compiled;
    if (at.file.trim() && (await revealer(at.file, at.line, at.column ?? 0))) return true;
  }
  return openResolvedInEditor(compiled, original);
}
