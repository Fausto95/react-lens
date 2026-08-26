import { QueryClient, dehydrate, hydrate, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryAdapter, registerStores } from "@reactlens/adapters";
import { fetchMovies } from "../api/movies.js";
import type { Movie } from "../data/movies.js";

export const MOVIES_QUERY_KEY = ["movies"] as const;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
});

if (import.meta.env.DEV) {
  registerStores(queryAdapter({ queryClient, dehydrate, hydrate, id: "movies" }));
}

export function useMoviesQuery() {
  return useQuery<Movie[]>({ queryKey: MOVIES_QUERY_KEY, queryFn: fetchMovies });
}

export function useRefreshMovies() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: MOVIES_QUERY_KEY });
  };
}
