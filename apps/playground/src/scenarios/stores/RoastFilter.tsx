import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { registerStores, zustandAdapter } from "@reactlens/adapters";
import { Badge, Button, Card, Meta, Stack } from "@reactlens/demo-ui";

/**
 * The external-store story: state that lives outside React entirely, and still
 * follows the playhead.
 *
 * Nothing here holds the selection in a hook — scrubbing back would normally
 * leave these chips exactly where the live app left them. One registration
 * through `@reactlens/adapters` is the whole difference.
 */
const ROASTS = ["Light", "Medium", "Dark"] as const;
type Roast = (typeof ROASTS)[number];

interface FilterState {
  roasts: Roast[];
  toggle: (roast: Roast) => void;
  clear: () => void;
}

const filterStore = createStore<FilterState>((set) => ({
  roasts: [],
  toggle: (roast) =>
    set((s) => ({
      roasts: s.roasts.includes(roast) ? s.roasts.filter((r) => r !== roast) : [...s.roasts, roast],
    })),
  clear: () => set({ roasts: [] }),
}));

// Dev-only: in a production build there is no host to register against, so
// this resolves to a stub and costs one array entry. The guard makes the
// intent explicit anyway.
if (import.meta.env.DEV) {
  registerStores(zustandAdapter(filterStore, { id: "roast-filter" }));
}

export function RoastFilter() {
  const roasts = useStore(filterStore, (s) => s.roasts);
  const toggle = useStore(filterStore, (s) => s.toggle);
  const clear = useStore(filterStore, (s) => s.clear);

  return (
    <Card>
      <Stack>
        <Meta>Zustand — replacing setState, so keys added later are dropped.</Meta>
        <Stack row>
          {ROASTS.map((roast) => (
            <Button
              key={roast}
              size="sm"
              variant={roasts.includes(roast) ? "primary" : "ghost"}
              onClick={() => toggle(roast)}
            >
              {roast}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        </Stack>
        <Stack row>
          {roasts.length === 0 ? (
            <Meta>No roast selected</Meta>
          ) : (
            roasts.map((roast) => <Badge key={roast}>{roast}</Badge>)
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
RoastFilter.displayName = "RoastFilter";
