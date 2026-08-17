import { beforeEach, describe, expect, it } from "vite-plus/test";
import { loadAgentSettings, saveAgentSettings } from "./settings.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("agent settings vault", () => {
  it("never writes a plaintext apiKey to durable prefs", async () => {
    await saveAgentSettings({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-secret-value",
      model: "gpt-4o-mini",
    });
    const raw = localStorage.getItem("react-lens/agent-settings");
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("sk-secret-value");
    const parsed = JSON.parse(raw!);
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.vault?.v).toBe(1);
    expect(parsed.vault?.iv).toBeTruthy();
    expect(parsed.vault?.data).toBeTruthy();
  });

  it("round-trips the key via the session wrap key", async () => {
    await saveAgentSettings({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-round-trip",
      model: "gpt-4o-mini",
    });
    const loaded = await loadAgentSettings();
    expect(loaded.apiKey).toBe("sk-round-trip");
    expect(loaded.model).toBe("gpt-4o-mini");
  });

  it("cannot decrypt after the wrap key is cleared", async () => {
    await saveAgentSettings({
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-session-bound",
      model: "gpt-4o-mini",
    });
    sessionStorage.clear();
    const loaded = await loadAgentSettings();
    expect(loaded.apiKey).toBe("");
    expect(loaded.provider).toBe("openai");
  });

  it("migrates legacy plaintext out of localStorage", async () => {
    localStorage.setItem(
      "react-lens/agent-settings",
      JSON.stringify({
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-legacy",
        model: "gpt-4o-mini",
      }),
    );
    const loaded = await loadAgentSettings();
    expect(loaded.apiKey).toBe("sk-legacy");
    const raw = localStorage.getItem("react-lens/agent-settings")!;
    expect(raw).not.toContain("sk-legacy");
    expect(JSON.parse(raw).vault?.v).toBe(1);
  });
});
