/**
 * The inadmissible-cost line for inline "Fix with AI" affordances: one frame
 * at 60fps. A component (or a single render) spending this much self time is
 * always worth a targeted investigation.
 */
export const SLOW_SELF_MS = 16;

/** Targeted agent question for a slow component (tree row). */
export function componentFixPrompt(name: string, id: number, selfMs: number, renders: number): string {
  return `Component ${name} [component:${id}] spent ${Math.round(selfMs * 10) / 10}ms of self time across ${renders} renders — why is it that expensive, and how do I fix it? Start from its runtime profile (component_runtime): use the render reasons, wasted renders, and its actual prop/hook values to decide which fix applies. Read the source of the cause site before proposing code, respect its compiler status, and state which renders your fix eliminates.`;
}

/** Targeted agent question for one slow render (timeline waterfall bar). */
export function renderFixPrompt(name: string, componentId: number, renderId: number, selfMs: number): string {
  return `Render [render:${renderId}] of ${name} [component:${componentId}] took ${Math.round(selfMs * 10) / 10}ms self time — explain the cause chain and propose a concrete fix. Check the component's runtime profile (component_runtime) for context, then why this render happened; read the source of the cause site before proposing code, and say what this render's cost buys the user, if anything.`;
}

/** Targeted agent question for an anomalous commit (timeline ⚠ card). */
export function commitFixPrompt(commitId: number, totalSelfMs: number, componentCount: number): string {
  return `Commit ${commitId} cost ${Math.round(totalSelfMs)}ms across ${componentCount} components — an outlier for this session. Which components dominate it? Pull the runtime profile (component_runtime) of the worst one, explain why it rendered, and propose a fix grounded in its source and compiler status — plus the expected ms saved.`;
}
