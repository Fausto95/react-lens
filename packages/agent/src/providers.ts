import type { AgentSettings, AgentProvider } from "./types.js";

export const PROVIDER_PRESETS: Record<
  AgentProvider,
  {
    label: string;
    baseUrl: string;
    model: string;
    hint: string;
    keyRequired: boolean;
    /** Wire format: Anthropic Messages vs OpenAI Chat Completions. */
    api: "openai" | "anthropic";
  }
> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    hint: "OpenAI or any OpenAI-compatible gateway",
    keyRequired: true,
    api: "openai",
  },
  anthropic: {
    label: "Claude",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    hint: "Anthropic Messages API (Claude)",
    keyRequired: true,
    api: "anthropic",
  },
  zml: {
    label: "Z.AI (GLM)",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-5v-turbo",
    hint: "Z.AI GLM via Anthropic-compatible API",
    keyRequired: true,
    api: "anthropic",
  },
};

export function defaultSettingsFor(provider: AgentProvider): AgentSettings {
  const p = PROVIDER_PRESETS[provider];
  return {
    provider,
    baseUrl: p.baseUrl,
    apiKey: "",
    model: p.model,
  };
}

export function normalizeProvider(value: unknown): AgentProvider {
  if (value === "anthropic" || value === "claude") return "anthropic";
  if (value === "zml" || value === "zlm" || value === "zai" || value === "glm") return "zml";
  return "openai";
}

export function usesAnthropicApi(provider: AgentProvider): boolean {
  return PROVIDER_PRESETS[provider].api === "anthropic";
}
