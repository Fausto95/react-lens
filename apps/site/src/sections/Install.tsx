import { IconCopy } from "@react-lens/icons";

function Copy({ text }: { text: string }) {
  return (
    <button
      className="copybtn"
      title="Copy"
      aria-label="Copy to clipboard"
      onClick={() => void navigator.clipboard?.writeText(text)}
    >
      <IconCopy size={14} />
    </button>
  );
}

const EMBED = `import { createEmbeddedRuntime } from "@react-lens/devtools/runtime";
import { mountEmbedded } from "@react-lens/devtools/embed";

const runtime = createEmbeddedRuntime();
runtime.start();       // before react-dom mounts
mountEmbedded(runtime); // dock the live panel`;

export function Install() {
  return (
    <section id="install">
      <div className="sec-kicker"><span className="dot" /> Get started</div>
      <h2>Run it in seconds.</h2>
      <p className="sec-lead">
        Use it as a Chrome extension on any dev build, or embed the panel directly in
        your app the way this very site does.
      </p>

      <div className="steps">
        <div className="step">
          <div>
            <strong>Chrome extension</strong> — build and load unpacked:
            <pre className="code"><span className="k">pnpm</span> build:extension<Copy text="pnpm build:extension" /></pre>
            Then <code>chrome://extensions</code> → Developer mode → Load unpacked →
            <code> apps/extension/dist</code>, and open DevTools → <strong>React Lens</strong>.
          </div>
        </div>
        <div className="step">
          <div>
            <strong>Embedded panel</strong> — no extension needed (this is how the site runs):
            <pre className="code">{EMBED}<Copy text={EMBED} /></pre>
          </div>
        </div>
        <div className="step">
          <div>
            <strong>Try the playground</strong> — an app engineered to misbehave:
            <pre className="code"><span className="k">pnpm</span> dev:playground<Copy text="pnpm dev:playground" /></pre>
          </div>
        </div>
      </div>
    </section>
  );
}
