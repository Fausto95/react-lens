import type { ComponentId } from "@reactlens/protocol";

/**
 * Components the developer has handed to the AI panel.
 *
 * The agent already has tools that take a component id, so an attachment is
 * just that pairing — the preamble names the component *and* its id so the
 * model can call those tools instead of guessing from the name, which is not
 * unique.
 *
 * Pure: plain data in, plain data out, no React and no DOM.
 */

export interface AgentAttachment {
  id: ComponentId;
  name: string;
}

/** Appends unless the component is already attached. Returns the same list if so. */
export function addAttachment(
  list: readonly AgentAttachment[],
  next: AgentAttachment,
): AgentAttachment[] | readonly AgentAttachment[] {
  if (list.some((item) => item.id === next.id)) return list;
  return [...list, next];
}

/** Returns the same list when nothing matched, so React can skip the render. */
export function removeAttachment(
  list: readonly AgentAttachment[],
  id: ComponentId,
): AgentAttachment[] | readonly AgentAttachment[] {
  if (!list.some((item) => item.id === id)) return list;
  return list.filter((item) => item.id !== id);
}

/** The context line the agent reads before the question. Empty when nothing is attached. */
export function attachmentPreamble(list: readonly AgentAttachment[]): string {
  if (list.length === 0) return "";
  const named = list.map((item) => `${item.name} (component ${item.id as number})`).join(", ");
  return list.length === 1
    ? `About this component: ${named}.`
    : `About these components: ${named}.`;
}

/** The question as the agent should receive it, with any attached context first. */
export function withAttachments(question: string, list: readonly AgentAttachment[]): string {
  const asked = question.trim();
  const preamble = attachmentPreamble(list);
  return preamble === "" ? asked : `${preamble}\n\n${asked}`;
}
