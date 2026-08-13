import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadSession } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality } from "@reactlens/causality";
import { createSourceResolver } from "@reactlens/source-maps";
import {
  TOOL_DEFINITIONS,
  createToolHandlers,
  executeTool,
  type ToolCall,
  type ToolName,
} from "@reactlens/agent-tools";
import { redactToolResult } from "./redact.js";

export interface McpServerOptions {
  sessionPath?: string;
  includeValues?: boolean;
}

function createHandlersFromSession(path: string) {
  const session = loadSession(readFileSync(path, "utf8"));
  const store = new TraceStore();
  store.ingest(session.payload);
  const causality = createCausality(store);
  const sourceResolver = createSourceResolver(async () => {
    throw new Error("source fetch unavailable in MCP session mode");
  });
  return createToolHandlers({ store, causality, sourceResolver });
}

export async function runMcpServer(opts: McpServerOptions = {}): Promise<void> {
  const sessionPath = opts.sessionPath ?? process.env.LENS_SESSION;
  if (!sessionPath) {
    throw new Error("MCP server requires --session or LENS_SESSION");
  }

  const handlers = createHandlersFromSession(sessionPath);
  const server = new McpServer({ name: "react-lens", version: "0.0.0" });

  for (const def of TOOL_DEFINITIONS) {
    const name = def.function.name as ToolName;
    server.tool(
      name,
      def.function.description,
      def.function.parameters as Record<string, unknown>,
      async (args) => {
        const call: ToolCall = { id: name, name, arguments: args as Record<string, unknown> };
        let result = await executeTool(handlers, call);
        if (!opts.includeValues) {
          result = redactToolResult(result);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { redactToolResult } from "./redact.js";
