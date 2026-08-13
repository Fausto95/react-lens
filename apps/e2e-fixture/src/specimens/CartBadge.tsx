import { useSyncExternalStore } from "react";
import { Button, Card, Section, Stack } from "@reactlens/demo-ui";
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

/** External-store cart — name matters for tree/timeline selection. */
export function CartBadge() {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getState);
  return (
    <Section
      kicker="Bag"
      title="Quick add"
      hint="useSyncExternalStore cart registered for time travel."
    >
      <Card>
        <Stack row>
          <Button
            variant="primary"
            size="sm"
            onClick={() => cartStore.setState({ count: cart.count + 1 })}
          >
            Add
          </Button>
          <output>cart: {cart.count}</output>
        </Stack>
      </Card>
    </Section>
  );
}
CartBadge.displayName = "CartBadge";
