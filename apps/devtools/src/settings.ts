import {
  defaultSettingsFor,
  normalizeProvider,
  type AgentSettings,
  type AgentProvider,
} from "@reactlens/agent";

const PREFS_KEY = "react-lens/agent-settings";
/** AES wrap-key material — session-scoped so durable prefs never decrypt alone. */
const WRAP_KEY = "react-lens/agent-wrap-key";
/** Fallback when Web Crypto is unavailable: session-only plaintext key. */
const SESSION_KEY = "react-lens/agent-key-session";

const DEFAULTS: AgentSettings = defaultSettingsFor("openai");

type StorageLike = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
};

type VaultV1 = { v: 1; iv: string; data: string };

type StoredAgentPrefs = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  /** Legacy plaintext — migrated away on load/save. */
  apiKey?: string;
  vault?: VaultV1;
};

function localStore(): StorageLike | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function sessionStore(): StorageLike | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Prefer chrome.storage.session in the extension; fall back to web storage. */
function chromeSession(): StorageLike | null {
  try {
    const chromeApi = (
      globalThis as {
        chrome?: {
          storage?: {
            session?: {
              get: (keys: string | string[]) => Promise<Record<string, unknown>>;
              set: (items: Record<string, unknown>) => Promise<void>;
              remove?: (keys: string | string[]) => Promise<void>;
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
      async removeItem(key) {
        await session.remove?.(key);
      },
    };
  } catch {
    return null;
  }
}

function prefsStore(): StorageLike | null {
  return chromeSession() ?? localStore();
}

function secretStore(): StorageLike | null {
  // Extension session storage first; otherwise tab session — never durable disk for wrap material.
  return chromeSession() ?? sessionStore();
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function canUseSubtle(): boolean {
  try {
    return typeof crypto !== "undefined" && !!crypto.subtle;
  } catch {
    return false;
  }
}

async function getOrCreateWrapKey(store: StorageLike): Promise<CryptoKey> {
  const existing = await store.getItem(WRAP_KEY);
  if (existing) {
    return crypto.subtle.importKey("raw", b64ToBytes(existing), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await store.setItem(WRAP_KEY, bytesToB64(raw));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sealApiKey(apiKey: string, secrets: StorageLike): Promise<VaultV1 | null> {
  if (!apiKey) return null;
  if (!canUseSubtle()) {
    await secrets.setItem(SESSION_KEY, apiKey);
    await secrets.removeItem?.(WRAP_KEY);
    return null;
  }
  await secrets.removeItem?.(SESSION_KEY);
  const key = await getOrCreateWrapKey(secrets);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey),
  );
  return { v: 1, iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(ct)) };
}

async function openApiKey(
  vault: VaultV1 | undefined,
  legacyPlain: string | undefined,
  secrets: StorageLike | null,
): Promise<string> {
  if (secrets && canUseSubtle() && vault?.v === 1 && vault.iv && vault.data) {
    try {
      const wrap = await secrets.getItem(WRAP_KEY);
      if (wrap) {
        const key = await crypto.subtle.importKey("raw", b64ToBytes(wrap), "AES-GCM", false, [
          "decrypt",
        ]);
        const pt = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: b64ToBytes(vault.iv) },
          key,
          b64ToBytes(vault.data),
        );
        return new TextDecoder().decode(pt);
      }
    } catch {
      // Wrap key rotated / corrupt vault — treat as missing.
    }
  }
  if (secrets) {
    const sessionKey = await secrets.getItem(SESSION_KEY);
    if (typeof sessionKey === "string" && sessionKey) return sessionKey;
  }
  if (typeof legacyPlain === "string" && legacyPlain) return legacyPlain;
  return "";
}

function parsePrefs(raw: string | null): StoredAgentPrefs | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAgentPrefs;
  } catch {
    return null;
  }
}

function prefsWithoutSecrets(settings: AgentSettings, vault: VaultV1 | null): string {
  const stored: StoredAgentPrefs = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
  };
  if (vault) stored.vault = vault;
  return JSON.stringify(stored);
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  const prefs = prefsStore();
  const secrets = secretStore();
  if (!prefs) return { ...DEFAULTS };
  try {
    const stored = parsePrefs(await prefs.getItem(PREFS_KEY));
    if (!stored) return { ...DEFAULTS };
    const provider = normalizeProvider(stored.provider);
    const fallback = defaultSettingsFor(provider);
    const apiKey = await openApiKey(stored.vault, stored.apiKey, secrets);
    const settings: AgentSettings = {
      provider,
      baseUrl: typeof stored.baseUrl === "string" ? stored.baseUrl : fallback.baseUrl,
      apiKey,
      model: typeof stored.model === "string" ? stored.model : fallback.model,
    };
    // Migrate legacy plaintext off durable storage once we can seal it.
    if (stored.apiKey && apiKey && secrets) {
      await saveAgentSettings(settings);
    }
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveAgentSettings(settings: AgentSettings): Promise<void> {
  const prefs = prefsStore();
  const secrets = secretStore();
  if (!prefs) return;
  const vault = secrets ? await sealApiKey(settings.apiKey, secrets) : null;
  if (!settings.apiKey) {
    await secrets?.removeItem?.(SESSION_KEY);
  }
  await prefs.setItem(PREFS_KEY, prefsWithoutSecrets(settings, vault));
}

export function applyProvider(current: AgentSettings, provider: AgentProvider): AgentSettings {
  const next = defaultSettingsFor(provider);
  // Keep the key when switching providers — user may reuse the same secret store.
  return { ...next, apiKey: current.apiKey };
}

export { DEFAULTS as defaultAgentSettings, PREFS_KEY as agentSettingsStorageKey };
