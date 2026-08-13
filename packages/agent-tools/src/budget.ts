/**
 * Char-based budgeting for tool results sent to an LLM host. Structured
 * truncation lives in execute.enforceBudget; these helpers remain for the
 * BYOK transcript path that strings JSON into the provider chat.
 */

export const PER_RESULT_CAP = 6_000;
export const SOURCE_RESULT_CAP = 10_000;
export const TRANSCRIPT_TOOL_BUDGET = 60_000;
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
