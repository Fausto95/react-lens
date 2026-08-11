import {
  defaultSettingsFor,
  normalizeProvider,
  type AgentSettings,
  type AgentProvider,
} from "@reactlens/agent";

const KEY = "react-lens/agent-settings";

const DEFAULTS: AgentSettings = defaultSettingsFor("openai");

type StorageLike = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
};

function localStore(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Prefer chrome.storage.session in the extension; fall back to localStorage. */
function chromeSession(): StorageLike | null {
  try {
    const chromeApi = (
      globalThis as {
        chrome?: {
          storage?: {
            session?: {
              get: (keys: string | string[]) => Promise<Record<string, unknown>>;
              set: (items: Record<string, unknown>) => Promise<void>;
            };
          };
        };
      }
    ).chrome;
    const session = chromeApi?.storage?.session;
    if (!session) return null;
    return {
      async getItem(key) {
        const got = await session.get(key);
        const v = got[key];
        return typeof v === "string" ? v : null;
      },
      async setItem(key, value) {
        await session.set({ [key]: value });
      },
    };
  } catch {
    return null;
  }
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  const store = chromeSession() ?? localStore();
  if (!store) return { ...DEFAULTS };
  try {
    const raw = await store.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AgentSettings>;
    const provider = normalizeProvider(parsed.provider);
    const fallback = defaultSettingsFor(provider);
    return {
      provider,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : fallback.baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" ? parsed.model : fallback.model,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveAgentSettings(settings: AgentSettings): Promise<void> {
  const store = chromeSession() ?? localStore();
  if (!store) return;
  await store.setItem(KEY, JSON.stringify(settings));
}

export function applyProvider(current: AgentSettings, provider: AgentProvider): AgentSettings {
  const next = defaultSettingsFor(provider);
  // Keep the key when switching providers — user may reuse the same secret store.
  return { ...next, apiKey: current.apiKey };
}

export { DEFAULTS as defaultAgentSettings };
