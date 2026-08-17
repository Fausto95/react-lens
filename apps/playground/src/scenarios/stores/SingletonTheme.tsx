import { useSyncExternalStore } from "react";
import { createStoreAdapter, registerStores } from "@reactlens/adapters";
import { Badge, Button, Card, Meta, Stack } from "@reactlens/demo-ui";

/**
 * The generic seam: a plain module singleton, no library involved. Anything with
 * a getter and a setter maps onto `createStoreAdapter` — this is also the recipe
 * for Jotai, where the atoms worth rewinding are named explicitly.
 */
type Grind = "fine" | "medium" | "coarse";

let grind: Grind = "medium";
const listeners = new Set<() => void>();

const grindStore = {
  get: (): Grind => grind,
  set: (next: Grind): void => {
    grind = next;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

if (import.meta.env.DEV) {
  registerStores(
    createStoreAdapter<Grind>({
      id: "grind",
      get: grindStore.get,
      set: grindStore.set,
    }),
  );
}

const GRINDS: Grind[] = ["fine", "medium", "coarse"];

export function SingletonTheme() {
  const current = useSyncExternalStore(grindStore.subscribe, grindStore.get);

  return (
    <Card>
      <Stack>
        <Meta>Module singleton — createStoreAdapter over a plain get / set pair.</Meta>
        <Stack row>
          {GRINDS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={current === option ? "primary" : "ghost"}
              onClick={() => grindStore.set(option)}
            >
              {option}
            </Button>
          ))}
        </Stack>
        <Stack row>
          <Badge>grind: {current}</Badge>
        </Stack>
      </Stack>
    </Card>
  );
}
SingletonTheme.displayName = "SingletonTheme";
