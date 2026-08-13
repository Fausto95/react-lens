import { Hero, Shell } from "@reactlens/demo-ui";
import { Storefront } from "./scenarios/Storefront.js";

/**
 * The playground is the demo, and nothing else.
 * One small shop, one cascade story for the embedded panel.
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
      </Shell>
    </div>
  );
}
