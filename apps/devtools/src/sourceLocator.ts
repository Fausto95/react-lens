import type { ComponentId, SourceLocation } from "@reactlens/protocol";
import type { ResolvedLocation } from "@reactlens/source-maps";
import { getSourceResolver } from "./sourceResolver.js";
import { declaredNameNear } from "./declaredName.js";

/**
 * Where a component is defined on a PRODUCTION build, where React exposes no
 * `_debugSource`/`_debugStack`. The page locates the component function's
 * compiled definition site (see @reactlens/fiber `locateComponent`); the panel
 * then symbolicates it through the usual source resolver.
 *
 * The locator is injected: embedded mode calls the runtime directly, the
 * extension proxies over its port. Unset ⇒ feature off (dev builds don't need
 * it).
 */
export type ComponentLocator = (id: ComponentId) => Promise<SourceLocation | null>;

export interface LocatedSource {
  /** Definition site inside the shipped bundle. */
  compiled: SourceLocation;
  /** Original position, when a source map was reachable. */
  original?: ResolvedLocation;
  /** Pre-minification identifier, when the map recorded one. */
  originalName?: string;
}

let locator: ComponentLocator | undefined;
/** Resolved results and in-flight promises, keyed by component. */
const cache = new Map<ComponentId, Promise<LocatedSource | null>>();

export function configureComponentLocator(next: ComponentLocator | undefined): void {
  locator = next;
  cache.clear();
}

export function hasComponentLocator(): boolean {
  return locator !== undefined;
}

export function clearLocatedSources(): void {
  cache.clear();
}

export function locateComponentSource(id: ComponentId): Promise<LocatedSource | null> {
  if (!locator) return Promise.resolve(null);
  // One request per component, shared by concurrent callers: locating costs a
  // page round-trip plus a shallow component call.
  const existing = cache.get(id);
  if (existing) return existing;
  const pending = run(locator, id);
  cache.set(id, pending);
  return pending;
}

async function run(locate: ComponentLocator, id: ComponentId): Promise<LocatedSource | null> {
  let compiled: SourceLocation | null = null;
  try {
    compiled = await locate(id);
  } catch {
    // Transport death or a page that refused to locate — nothing to show.
    return null;
  }
  if (!compiled) return null;
  let original: ResolvedLocation | null = null;
  try {
    original = await getSourceResolver().resolve(compiled);
  } catch {
    original = null; // no map deployed, cross-origin chunk, CSP — keep compiled
  }
  return {
    compiled,
    ...(original ? { original } : {}),
    ...(original ? await originalNameOf(compiled, original) : {}),
  };
}

/** Component names are capitalised; `useState` or `props` are not one. */
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_$]*$/;

/**
 * The pre-minification name.
 *
 * The map's `name` at this position is unreliable — a located frame often lands
 * on the component's first statement, so the recorded identifier can be the
 * hook being called. Read the enclosing declaration out of the original source
 * (text the map already ships for the Source tab) and keep the map's name only
 * as a component-shaped fallback.
 */
async function originalNameOf(
  compiled: SourceLocation,
  original: ResolvedLocation,
): Promise<{ originalName?: string }> {
  try {
    const src = await getSourceResolver().sourceContent(compiled.file, original.file);
    const declared = src ? declaredNameNear(src.content, original.line) : null;
    if (declared) return { originalName: declared };
  } catch {
    // No sourcesContent (maps can omit it) — fall through to the map name.
  }
  return original.name && COMPONENT_NAME.test(original.name)
    ? { originalName: original.name }
    : {};
}
