import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { registerStores, zustandAdapter } from "@reactlens/adapters";
import { Button, Card, Section, Stack } from "@reactlens/demo-ui";

interface CartState {
  count: number;
  add: () => void;
}

const cartStore = createStore<CartState>((set) => ({
  count: 0,
  add: () => set((s) => ({ count: s.count + 1 })),
}));

/**
 * Registration goes through the page API (`window.__REACT_LENS__`) rather than
 * the embedded runtime object — the same path an app using the Chrome
 * extension takes.
 */
registerStores(zustandAdapter(cartStore, { id: "cart" }));

/** External-store cart — name matters for tree/timeline selection. */
export function CartBadge() {
  const count = useStore(cartStore, (s) => s.count);
  const add = useStore(cartStore, (s) => s.add);
  return (
    <Section
      kicker="Bag"
      title="Quick add"
      hint="Zustand cart registered for time travel through @reactlens/adapters."
    >
      <Card>
        <Stack row>
          <Button variant="primary" size="sm" onClick={add}>
            Add
          </Button>
          <output>cart: {count}</output>
        </Stack>
      </Card>
    </Section>
  );
}
CartBadge.displayName = "CartBadge";
