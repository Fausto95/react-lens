import { useSyncExternalStore } from "react";
import { Section, btn } from "./ui.js";
import { runtime } from "../boot.js";

interface CartState {
  count: number;
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
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const cartStore = createCartStore({ count: 0 });

runtime.timeTravel.registerStore({
  id: "cart",
  getSnapshot: () => cartStore.getState(),
  applySnapshot: (s) => cartStore.setState(s as CartState),
});

/** External-store cart badge — name matters for tree/timeline selection. */
export function CartBadge() {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getState);
  return (
    <Section title="External store" hint="useSyncExternalStore cart registered for time travel.">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          style={btn}
          onClick={() => cartStore.setState({ count: cart.count + 1 })}
        >
          Add
        </button>
        <output>cart: {cart.count}</output>
      </div>
    </Section>
  );
}
CartBadge.displayName = "CartBadge";
