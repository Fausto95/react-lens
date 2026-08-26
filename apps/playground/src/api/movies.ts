import { MOVIES, type Movie } from "../data/movies.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stands in for a network fetch: the catalog is a local fixture. */
export async function fetchMovies(): Promise<Movie[]> {
  await delay(160);
  return MOVIES.map((movie) => ({ ...movie }));
}
