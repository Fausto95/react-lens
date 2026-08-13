import type { ToolHandlers } from "@reactlens/agent-tools";
import type { LensSessionFile } from "@reactlens/protocol";

let warnedAppData = false;

function warnAppDataOnce(): void {
  if (warnedAppData) return;
  warnedAppData = true;
  console.error(
    "⚠ React Lens sessions may contain serialized app data (props, state). Treat session files as sensitive.",
  );
}

export async function analyzeSessionMarkdown(
  session: LensSessionFile,
  handlers: ToolHandlers,
): Promise<string> {
  warnAppDataOnce();
  const summary = await handlers.get_session_summary({});
  const waste = await handlers.get_waste_report({ limit: 10 });
  const slow = await handlers.diagnose_slowness({});

  const lines: string[] = ["# React Lens Analysis", ""];
  if (session.meta?.title) lines.push(`**Session:** ${session.meta.title}`);
  if (session.meta?.pageUrl) lines.push(`**Page:** ${session.meta.pageUrl}`);
  lines.push(`**Exported:** ${session.exportedAt}`, "");

  lines.push("## Session summary", "");
  if ("error" in summary) {
    lines.push(`Error: ${summary.error}`);
  } else {
    const s = summary.evidence.stats;
    lines.push(
      `- Events: ${s.events}`,
      `- Renders: ${s.renders}`,
      `- Snapshots: ${s.snapshots}`,
      `- Components: ${s.components}`,
      "",
    );
    if (summary.evidence.topComponents.length > 0) {
      lines.push("### Top components", "");
      for (const c of summary.evidence.topComponents.slice(0, 5)) {
        lines.push(`- **${c.name}** — ${c.renders} renders, ${c.totalSelf}ms self`);
      }
      lines.push("");
    }
  }

  lines.push("## Waste report", "");
  if ("error" in waste) {
    lines.push(`Error: ${waste.error}`);
  } else if (waste.waste.length === 0) {
    lines.push("No wasted (no-observable-change) renders detected.");
  } else {
    for (const w of waste.waste.slice(0, 5)) {
      lines.push(`- **${w.name}** — render ${w.renderId}, ${w.selfMs}ms`);
    }
  }
  lines.push("");

  lines.push("## Slowness diagnosis", "");
  if ("error" in slow) {
    lines.push(`Error: ${slow.error}`);
  } else {
    lines.push(`**Verdict:** ${slow.verdict}`, "");
    for (const f of slow.findings.slice(0, 5)) {
      lines.push(`- ${f.label}: ${f.detail}`);
    }
    if (slow.nextSteps.length > 0) {
      lines.push("", "**Next steps:**", ...slow.nextSteps.map((s) => `- \`${s}\``));
    }
  }

  return lines.join("\n");
}
