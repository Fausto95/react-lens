/**
 * Char-based budgeting for tool results. What the model sees is capped —
 * silently blowing the context on one query_trace over a big session is worse
 * than a truncation the model can react to. The same budgeted string feeds the
 * UI step, so there is one source of truth.
 */

/** Default per-tool-result cap (~1.5K tokens). */
export const PER_RESULT_CAP = 6_000;
/** Source snippets are the payload for fixes — allow more. */
export const SOURCE_RESULT_CAP = 10_000;
/** Once a conversation has accumulated this much tool output, tighten caps. */
export const TRANSCRIPT_TOOL_BUDGET = 60_000;
/** Cap applied after the transcript budget is exhausted. */
export const TIGHT_RESULT_CAP = 1_500;

export function budgetToolResult(
  content: string,
  cap: number,
): { content: string; truncated: boolean } {
  if (content.length <= cap) return { content, truncated: false };
  const dropped = content.length - cap;
  return {
    content: `${content.slice(0, cap)}\n…[truncated ${dropped} chars — ask a narrower question or pass a limit]`,
    truncated: true,
  };
}

export function capFor(toolName: string, spentSoFar: number): number {
  const base = toolName === "read_component_source" ? SOURCE_RESULT_CAP : PER_RESULT_CAP;
  return spentSoFar >= TRANSCRIPT_TOOL_BUDGET ? Math.min(base, TIGHT_RESULT_CAP) : base;
}
