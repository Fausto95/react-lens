#!/usr/bin/env node
import { runCi } from "./ci.js";
import { analyzeSessionMarkdown } from "./analyze.js";
import { loadSessionFromPath } from "./sessionRuntime.js";

function usage(): never {
  console.error(`Usage:
  react-lens analyze <session.json>
  react-lens mcp [--session file.json]
  react-lens ci --baseline <dir> --actual <dir>
  react-lens ci --update-baseline --baseline <dir> --actual <dir>`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

async function main(): Promise<void> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  if (!command) usage();

  switch (command) {
    case "analyze": {
      const path = positional[0];
      if (!path) usage();
      const { session, handlers } = loadSessionFromPath(path);
      const md = await analyzeSessionMarkdown(session, handlers);
      console.log(md);
      break;
    }
    case "mcp": {
      const sessionPath =
        (typeof flags.session === "string" ? flags.session : undefined) ??
        process.env.LENS_SESSION;
      const { runMcpServer } = await import("@reactlens/mcp");
      await runMcpServer({
        sessionPath,
        includeValues: flags["include-values"] === true,
      });
      break;
    }
    case "ci": {
      const baseline = flags.baseline;
      const actual = flags.actual;
      if (typeof baseline !== "string" || typeof actual !== "string") usage();
      const { ok, report } = runCi({
        baselineDir: baseline,
        actualDir: actual,
        updateBaseline: flags["update-baseline"] === true,
      });
      console.log(report);
      if (!ok) process.exit(1);
      break;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
