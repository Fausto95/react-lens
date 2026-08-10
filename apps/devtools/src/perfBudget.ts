/**
 * The inadmissible-cost line for inline "Fix with AI" affordances: one frame
 * at 60fps. A component (or a single render) spending this much self time is
 * always worth a targeted investigation.
 */
export const SLOW_SELF_MS = 16;

/** Targeted agent question for a slow component (tree row). */
export function componentFixPrompt(name: string, id: number, selfMs: number, renders: number): string {
  return `Component ${name} [component:${id}] spent ${Math.round(selfMs * 10) / 10}ms of self time across ${renders} renders — why is it that expensive, and how do I fix it? Read its source before proposing the fix.`;
}

/** Targeted agent question for one slow render (timeline waterfall bar). */
export function renderFixPrompt(name: string, componentId: number, renderId: number, selfMs: number): string {
  return `Render [render:${renderId}] of ${name} [component:${componentId}] took ${Math.round(selfMs * 10) / 10}ms self time — explain the cause chain and propose a concrete fix. Read the source of the cause site before proposing it.`;
}

/** Targeted agent question for an anomalous commit (timeline ⚠ card). */
export function commitFixPrompt(commitId: number, totalSelfMs: number, componentCount: number): string {
  return `Commit ${commitId} cost ${Math.round(totalSelfMs)}ms across ${componentCount} components — an outlier for this session. Which components dominate it, why, and how do I fix the worst one?`;
}
