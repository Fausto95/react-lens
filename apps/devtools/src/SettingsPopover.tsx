import { useEffect, useState } from "react";
import {
  testAgentConnection,
  PROVIDER_PRESETS,
  type AgentSettings,
  type AgentProvider,
} from "@react-lens/agent";
import {
  applyProvider,
  defaultAgentSettings,
  loadAgentSettings,
  saveAgentSettings,
} from "./settings.js";

export function SettingsPopover({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (s: AgentSettings) => void;
}) {
  const [settings, setSettings] = useState<AgentSettings>(defaultAgentSettings);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadAgentSettings().then(setSettings);
    setStatus(null);
  }, [open]);

  if (!open) return null;

  const preset = PROVIDER_PRESETS[settings.provider];
  const keyNeeded = preset.keyRequired;

  return (
    <div className="rl-settings" role="dialog" aria-label="Settings">
      <div className="rl-settings-head">
        <strong>Settings</strong>
        <button type="button" className="rl-icon-btn" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>
      <p className="rl-settings-hint">
        Bring your own key (BYOK). Keys stay in this panel — calls go only to the provider you pick
        (OpenAI, Claude, or Z.AI GLM).
      </p>
      <label className="rl-settings-field">
        <span>Provider</span>
        <select
          value={settings.provider}
          onChange={(e) => {
            const provider = e.target.value as AgentProvider;
            setSettings((s) => applyProvider(s, provider));
            setStatus(null);
          }}
        >
          {(Object.keys(PROVIDER_PRESETS) as AgentProvider[]).map((id) => (
            <option key={id} value={id}>
              {PROVIDER_PRESETS[id].label}
            </option>
          ))}
        </select>
      </label>
      <p className="rl-settings-hint subtle">{preset.hint}</p>
      <label className="rl-settings-field">
        <span>Base URL</span>
        <input
          value={settings.baseUrl}
          onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
          placeholder={preset.baseUrl}
          autoComplete="off"
        />
      </label>
      <label className="rl-settings-field">
        <span>API key{keyNeeded ? "" : " (optional)"}</span>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
          placeholder={keyNeeded ? "sk-…" : "optional"}
          autoComplete="off"
        />
      </label>
      <label className="rl-settings-field">
        <span>Model</span>
        <input
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          placeholder={preset.model}
          autoComplete="off"
        />
      </label>
      <div className="rl-settings-actions">
        <button
          type="button"
          className="rl-btn"
          disabled={busy || (keyNeeded && !settings.apiKey)}
          onClick={() => {
            setBusy(true);
            setStatus(null);
            void testAgentConnection(settings)
              .then((msg) => setStatus(msg))
              .catch((err) => setStatus(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          Test connection
        </button>
        <button
          type="button"
          className="rl-btn primary"
          onClick={() => {
            void saveAgentSettings(settings).then(() => {
              onSaved?.(settings);
              setStatus("Saved");
            });
          }}
        >
          Save
        </button>
      </div>
      {status && <div className="rl-settings-status">{status}</div>}
    </div>
  );
}
