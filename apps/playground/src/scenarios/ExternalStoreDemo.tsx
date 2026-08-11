import { useSyncExternalStore } from "react";
import { Section } from "./ui.js";
import { runtime } from "../boot.js";

/**
 * Module-level store (Zustand-style) exercising the opt-in time-travel
 * adapter: without registerStore, rewinding the hook state alone would revert
 * on the store's next notification. The adapter pattern is the same for
 * Zustand (`getState`/`setState(s, true)`) and Redux (`getState`/`dispatch`
 * of a hydrate action).
 */
interface CartState {
  items: string[];
  total: number;
}

function createCartStore(initial: CartState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(next: CartState) {
      state = next;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const cartStore = createCartStore({ items: [], total: 0 });

// Opt-in: snapshots are captured per commit and rewound with the timeline.
runtime.timeTravel.registerStore({
  id: "cart",
  getSnapshot: () => cartStore.getState(),
  applySnapshot: (s) => cartStore.setState(s as CartState),
});

const PRICES: Record<string, number> = { Sticker: 3, Mug: 14, Tee: 25 };

export function ExternalStoreDemo() {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getState);
  const add = (item: string) =>
    cartStore.setState({
      items: [...cart.items, item],
      total: cart.total + (PRICES[item] ?? 0),
    });
  return (
    <Section
      title="External store (time-travel adapter)"
      hint="Module store via useSyncExternalStore, registered with runtime.timeTravel.registerStore — scrubbing rewinds it with the rest of the app."
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {Object.keys(PRICES).map((item) => (
          <button key={item} onClick={() => add(item)}>
            add {item}
          </button>
        ))}
        <output>
          cart: {cart.items.length} items · ${cart.total}
        </output>
      </div>
    </Section>
  );
}
