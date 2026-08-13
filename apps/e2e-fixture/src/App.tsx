import { Showcase } from "./specimens/Showcase.js";
import { CartBadge } from "./specimens/CartBadge.js";
import { SuspenseDemo } from "./specimens/SuspenseDemo.js";
import { TransitionDemo } from "./specimens/TransitionDemo.js";
import { WasteDemo } from "./specimens/WasteDemo.js";
import { Expensive } from "./specimens/Expensive.js";
import { BigList } from "./specimens/BigList.js";

/**
 * Dedicated e2e fixture: specimens for every panel feature, not the Storefront demo.
 */
export function App() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "24px 16px 120px",
        color: "#16181d",
      }}
    >
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 6px", letterSpacing: "-0.02em" }}>
          React Lens · E2E Fixture
        </h1>
        <p style={{ color: "#5f6878", margin: 0, lineHeight: 1.45, fontSize: 13 }}>
          Specimens for Playwright — hooks, props, cart, suspense, transitions, waste, and a big
          list for tree virtualization.
        </p>
      </header>

      <Showcase />
      <CartBadge />
      <SuspenseDemo />
      <TransitionDemo />
      <WasteDemo />
      <Expensive />
      <BigList />
    </main>
  );
}
App.displayName = "App";
