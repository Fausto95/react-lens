import {
  QueryClient,
  QueryClientProvider,
  dehydrate,
  hydrate,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { registerStores, queryAdapter } from "@reactlens/adapters";
import { Badge, Button, Card, Meta, Stack } from "@reactlens/demo-ui";

/**
 * Server state: the case with a real trade-off. The adapter clears the cache
 * before hydrating, because `hydrate` keeps whichever copy is newer and a merge
 * therefore cannot move a refetched query back. Scrub after refetching and the
 * old batch number returns — at the cost of observers refetching on go-live.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
});

if (import.meta.env.DEV) {
  registerStores(queryAdapter({ queryClient, dehydrate, hydrate, id: "stock" }));
}

let batch = 1000;

/** Stands in for a fetch: a new batch number every call, no network. */
async function fetchStock(): Promise<{ batch: number; kilos: number }> {
  await new Promise((r) => setTimeout(r, 120));
  batch += 1;
  return { batch, kilos: 40 + (batch % 7) * 5 };
}

export function QueryStock() {
  return (
    <QueryClientProvider client={queryClient}>
      <StockPanel />
    </QueryClientProvider>
  );
}
QueryStock.displayName = "QueryStock";

function StockPanel() {
  const client = useQueryClient();
  const { data, isFetching } = useQuery({ queryKey: ["stock"], queryFn: fetchStock });

  return (
    <Card>
      <Stack>
        <Meta>TanStack Query — dehydrate / hydrate, cleared before restore.</Meta>
        <Stack row>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void client.invalidateQueries({ queryKey: ["stock"] })}
          >
            Refetch
          </Button>
          {isFetching ? <Meta>fetching…</Meta> : null}
        </Stack>
        <Stack row>
          {data ? (
            <>
              <Badge>batch {data.batch}</Badge>
              <Badge tone="neutral">{data.kilos} kg</Badge>
            </>
          ) : (
            <Meta>No batch loaded</Meta>
          )}
        </Stack>
      </Stack>
    </Card>
  );
}
StockPanel.displayName = "StockPanel";
