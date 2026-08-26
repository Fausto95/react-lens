import { useAtom } from "jotai";
import { useEffect, useReducer, useState } from "react";
import type { Movie } from "./data/movies.js";
import { cx } from "./lib/cx.js";
import { AppShell, type Tab } from "./components/AppShell.js";
import { ActivityScreen } from "./components/ActivityScreen.js";
import { CommandPalette } from "./components/CommandPalette.js";
import { LibraryScreen } from "./components/LibraryScreen.js";
import { MovieDetailDialog } from "./components/MovieDetailDialog.js";
import { MoviesScreen } from "./components/MoviesScreen.js";
import { WatchlistScreen } from "./components/WatchlistScreen.js";
import { useAppearance } from "./state/appearance.js";
import { browseReducer, initialBrowseState } from "./state/browse.js";
import { activityReducer, initialActivityState, notesReducer } from "./state/journal.js";
import { useMoviesQuery } from "./state/query.js";
import { pushRecentQuery, recentQueriesAtom } from "./state/search.js";
import { useWatchlist } from "./state/watchlist.js";

/**
 * Lumen — playground cinema app.
 *
 *   search / tab / selection / toasts     useState
 *   filters + view + notes + inbox        useReducer
 *   catalog                               TanStack Query
 *   watchlist / progress / status         Zustand
 *   locale + recent queries               Jotai
 *   appearance / density / sidebar        useSyncExternalStore
 *
 * Chrome classes are toggled on the root: is-compact,
 * is-sidebar-collapsed, is-command-open, is-toast-on. Cards toggle
 * is-saved / is-watched / is-selected / is-queued.
 */
export function App() {
  const { scheme, density, sidebarCollapsed } = useAppearance();
  const { data } = useMoviesQuery();
  const movies = data ?? [];
  const { setStatus } = useWatchlist();

  const [tab, setTab] = useState<Tab>("movies");
  const [selected, setSelected] = useState<Movie | null>(null);
  const [query, setQuery] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [browse, dispatch] = useReducer(browseReducer, initialBrowseState);
  const [activity, log] = useReducer(activityReducer, initialActivityState);
  const [notes, setNotes] = useReducer(notesReducer, {});
  const [recents, setRecents] = useAtom(recentQueriesAtom);

  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (!inField && event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setSelected(null);
      }
      if (!inField && ["1", "2", "3", "4"].includes(event.key)) {
        const tabs: Tab[] = ["movies", "watchlist", "activity", "library"];
        setTab(tabs[Number(event.key) - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const openMovie = (movie: Movie) => {
    setSelected(movie);
    log({ type: "push", event: { kind: "opened", movieId: movie.id, label: "Opened" } });
  };

  return (
    <div
      className={cx(
        "cinema-root",
        `is-${density}`,
        sidebarCollapsed && "is-sidebar-collapsed",
        commandOpen && "is-command-open",
        Boolean(toast) && "is-toast-on",
      )}
    >
      <AppShell
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        onCommand={() => setCommandOpen(true)}
        unread={activity.events.filter((event) => event.unread).length}
        onSearchSubmit={() => {
          setRecents((list) => pushRecentQuery(list, query));
          setTab("movies");
        }}
      >
        {tab === "movies" ? (
          <MoviesScreen
            query={query}
            browse={browse}
            dispatch={dispatch}
            selectedIds={selectedIds}
            onToggleSelect={(id) =>
              setSelectedIds((ids) => (ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]))
            }
            onSelect={openMovie}
            onQueue={(movie) => {
              setStatus(movie.id, "queued");
              log({ type: "push", event: { kind: "status", movieId: movie.id, label: "Queued" } });
              setToast("Added to queue");
            }}
          />
        ) : null}
        {tab === "watchlist" ? <WatchlistScreen movies={movies} onSelect={openMovie} /> : null}
        {tab === "activity" ? (
          <ActivityScreen
            events={activity.events}
            movies={movies}
            onSelect={openMovie}
            onClear={() => log({ type: "clear" })}
            onRead={(id) => log({ type: "read", id })}
            onReadAll={() => log({ type: "readAll" })}
          />
        ) : null}
        {tab === "library" ? <LibraryScreen movies={movies} onSelect={openMovie} /> : null}
      </AppShell>

      <MovieDetailDialog
        movie={selected}
        catalog={movies}
        note={selected ? (notes[selected.id] ?? "") : ""}
        onNote={(text) => {
          if (!selected) return;
          setNotes({ type: "set", id: selected.id, text });
          log({ type: "push", event: { kind: "note", movieId: selected.id, label: "Updated notes" } });
        }}
        onClose={() => setSelected(null)}
        onOpenRelated={openMovie}
      />

      <CommandPalette
        open={commandOpen}
        movies={movies}
        recents={recents}
        onClose={() => setCommandOpen(false)}
        onSelectMovie={openMovie}
        onTab={setTab}
      />

      <div className="toast">{toast}</div>
    </div>
  );
}
