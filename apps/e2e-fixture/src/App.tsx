import { Hero, Shell, Stack } from "@reactlens/demo-ui";
import { Showcase } from "./specimens/Showcase.js";
import { CartBadge } from "./specimens/CartBadge.js";
import { SuspenseDemo } from "./specimens/SuspenseDemo.js";
import { TransitionDemo } from "./specimens/TransitionDemo.js";
import { WasteDemo } from "./specimens/WasteDemo.js";
import { Expensive } from "./specimens/Expensive.js";
import { BigList } from "./specimens/BigList.js";

/**
 * Atlas Shop — realistic multi-section host for Playwright.
 * Keeps frozen e2e displayNames and button labels under a coherent product shell.
 */
export function App() {
  return (
    <div className="demo-root">
      <Shell>
        {/* `main` is the e2e scope for page-only locators (propsLine, etc.). */}
        <main>
          <Hero
            brand="Atlas Shop · E2E Fixture"
            lead="Hooks, cart travel, suspense, transitions, waste, and a long catalog — one shop shell."
          />
          <Stack>
            <Showcase />
            <CartBadge />
            <SuspenseDemo />
            <TransitionDemo />
            <WasteDemo />
            <Expensive />
            <BigList />
          </Stack>
        </main>
      </Shell>
    </div>
  );
}
App.displayName = "App";
