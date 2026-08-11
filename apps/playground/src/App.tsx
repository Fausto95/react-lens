import { useState } from "react";
import { Storefront } from "./scenarios/Storefront.js";
import { Showcase } from "./scenarios/Showcase.js";
import { DeepTree } from "./scenarios/DeepTree.js";
import { Expensive } from "./scenarios/Expensive.js";
import { WasteZone } from "./scenarios/WasteZone.js";
import { SuspenseDemo } from "./scenarios/SuspenseDemo.js";
import { TransitionDemo } from "./scenarios/TransitionDemo.js";
import { BigList } from "./scenarios/BigList.js";
import { Shop } from "./scenarios/Shop.js";
import { ExternalStoreDemo } from "./scenarios/ExternalStoreDemo.js";

/**
 * Default mount is ONLY the cart cascade — `<details>` still mounts children
 * when closed, which flooded the timeline with BigList/DeepTree mounts and
 * buried the setCart → ctx → props story.
 */
export function App() {
  const [more, setMore] = useState(false);

  return (
    <div>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, marginBottom: 6 }}>React Lens Playground</h1>
        <p style={{ color: "#5f6878", margin: 0, maxWidth: 540, lineHeight: 1.45 }}>
          Click <b>Add</b> on any row. The timeline paints the cascade it caused:{" "}
          <b>setCart → Catalog → ProductRow → PriceTag</b>. Select a clip in the middle of that
          chain and the arrows point both ways — back to what caused it, forward to what it caused.{" "}
          <b>Refresh prices</b> re-renders everything and changes nothing: the hatched clips.
        </p>
      </header>

      <Storefront />

      <div style={{ marginTop: 32 }}>
        {!more ? (
          <button
            type="button"
            onClick={() => setMore(true)}
            style={{
              fontSize: 13,
              color: "#5f6878",
              background: "transparent",
              border: "1px solid #d0d4dc",
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            Load more scenarios…
          </button>
        ) : (
          <>
            <Showcase />
            <DeepTree />
            <Expensive />
            <WasteZone />
            <SuspenseDemo />
            <TransitionDemo />
            <BigList />
            <Shop />
            <ExternalStoreDemo />
          </>
        )}
      </div>
    </div>
  );
}
