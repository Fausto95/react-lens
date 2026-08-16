# Getting started

Requires **Node ≥ 20** and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/Fausto95/react-lens.git
cd react-lens
pnpm install
```

Live product site (self-inspecting): [https://www.reactlens.xyz/](https://www.reactlens.xyz/).

## 1. Playground (fastest)

No extension. The panel mounts inside a demo app engineered to misbehave.

```bash
pnpm dev:playground
```

Open the URL Vite prints. Click a product in the Shop — the panel records the
interaction on **Cascade**, flags avoidable re-renders, and can **Explain** the
cost. Try ⌘K for search / commands and ⌘I for the BYOK agent.

## 2. Chrome extension

```bash
pnpm build:extension
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `apps/extension/dist`
4. Open any React 19 app → DevTools → **React Lens**

Rebuild after panel changes with `pnpm build:extension` again. Zip for
distribution: `pnpm package:extension`.

## 3. Product site (inspects itself)

```bash
pnpm dev:site
```

The marketing page boots the capture runtime and docks the real panel on the
right. Everything in the tree — and on Cascade — is the page you are reading.

## Next

- [Panel guide](panel.md) — shortcuts, Cascade, filters, sessions
- [Sessions](sessions.md) — export a `.json` for CLI / MCP
- [CLI](cli.md) / [MCP](mcp.md) / [Verify](verify.md) — agents and CI
