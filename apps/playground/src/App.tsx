import { Hero, Shell } from "@reactlens/demo-ui";
import { Storefront } from "./scenarios/Storefront.js";
import { OpsBoard } from "./scenarios/OpsBoard.js";
import { Stores } from "./scenarios/stores/index.js";

/**
 * The playground is the demo, and nothing else.
 * Storefront = cascade story; Stores = external-store rewind (one card per
 * shipped adapter); OpsBoard = scale / columnar stress.
 */
export function App() {
  return (
    <div className="demo-root">
      <Shell>
        <Hero
          brand="Roastery"
          lead="Add a tool to your cart and watch the cascade paint — setCart → Catalog → ProductRow → PriceTag."
          note="Refresh prices re-fetches equal values into new objects: hatched clips that changed nothing on screen."
        />
        <Storefront />
        <Stores />
        <OpsBoard />
      </Shell>
    </div>
  );
}
