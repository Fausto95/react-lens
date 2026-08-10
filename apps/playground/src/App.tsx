import { Toolbar } from "./scenarios/Toolbar.js";
import { Showcase } from "./scenarios/Showcase.js";
import { DeepTree } from "./scenarios/DeepTree.js";
import { Expensive } from "./scenarios/Expensive.js";
import { WasteZone } from "./scenarios/WasteZone.js";
import { SuspenseDemo } from "./scenarios/SuspenseDemo.js";
import { TransitionDemo } from "./scenarios/TransitionDemo.js";
import { BigList } from "./scenarios/BigList.js";
import { Shop } from "./scenarios/Shop.js";

/**
 * Playground root — each scenario lives in its own module under `scenarios/`
 * and exercises a different part of React Lens.
 */
export function App() {
  return (
    <div>
      <header>
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>React Lens Playground</h1>
        <p style={{ color: "#5f6878", marginTop: 0 }}>
          Each section exercises a different part of the tool.
        </p>
      </header>
      <Toolbar />
      <Showcase />
      <DeepTree />
      <Expensive />
      <WasteZone />
      <SuspenseDemo />
      <TransitionDemo />
      <BigList />
      <Shop />
    </div>
  );
}
