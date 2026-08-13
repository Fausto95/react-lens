import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSession } from "@reactlens/protocol";
import { compareSessions } from "@reactlens/agent-tools";

export interface CiOptions {
  baselineDir: string;
  actualDir: string;
  updateBaseline?: boolean;
}

function listLensFiles(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".lens.json"));
}

export function runCi(opts: CiOptions): { ok: boolean; report: string } {
  const { baselineDir, actualDir, updateBaseline } = opts;

  if (updateBaseline) {
    mkdirSync(baselineDir, { recursive: true });
    for (const file of listLensFiles(actualDir)) {
      cpSync(join(actualDir, file), join(baselineDir, file));
    }
    return {
      ok: true,
      report: `Updated baseline: copied ${listLensFiles(actualDir).length} file(s).`,
    };
  }

  const baselineFiles = new Set(listLensFiles(baselineDir));
  const actualFiles = listLensFiles(actualDir);
  const failures: string[] = [];
  const lines: string[] = ["# React Lens CI", ""];

  for (const file of actualFiles) {
    if (!baselineFiles.has(file)) {
      failures.push(`Missing baseline for ${file}`);
      lines.push(`- ❌ ${file}: no baseline`);
      continue;
    }
    const before = loadSession(readFileSync(join(baselineDir, file), "utf8"));
    const after = loadSession(readFileSync(join(actualDir, file), "utf8"));
    const result = compareSessions(before.payload, after.payload);
    if (result.regressions.length > 0) {
      failures.push(`${file}: ${result.verdict}`);
      lines.push(`- ❌ ${file}: ${result.verdict}`);
      for (const r of result.regressions) {
        lines.push(
          `  - ${r.name}: renders ${r.beforeRenderCount} → ${r.afterRenderCount} (+${r.renderDeltaPct}%), waste ${r.beforeWaste} → ${r.afterWaste}`,
        );
      }
    } else {
      lines.push(`- ✅ ${file}: ${result.verdict}`);
    }
  }

  for (const file of baselineFiles) {
    if (!actualFiles.includes(file)) {
      failures.push(`Missing actual for ${file}`);
      lines.push(`- ❌ ${file}: missing in actual dir`);
    }
  }

  return { ok: failures.length === 0, report: lines.join("\n") };
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function writeReport(path: string, body: string): void {
  writeFileSync(path, body, "utf8");
}
