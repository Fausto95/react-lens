import { useMemo, useState } from "react";
import type { Movie } from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";
import type { Tab } from "./AppShell.js";

type Hit =
  | { id: string; label: string; hint: string; run: () => void }
  | { id: string; label: string; hint: string; movie: Movie; run: () => void };

export function CommandPalette({
  open,
  movies,
  recents,
  onClose,
  onSelectMovie,
  onTab,
}: {
  open: boolean;
  movies: Movie[];
  recents: string[];
  onClose: () => void;
  onSelectMovie: (movie: Movie) => void;
  onTab: (tab: Tab) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);

  const hits = useMemo<Hit[]>(() => {
    const needle = value.trim().toLowerCase();
    const actions: Hit[] = [
      { id: "browse", label: t("tabMovies"), hint: "1", run: () => onTab("movies") },
      { id: "watchlist", label: t("tabWatchlist"), hint: "2", run: () => onTab("watchlist") },
      { id: "inbox", label: t("tabActivity"), hint: "3", run: () => onTab("activity") },
      { id: "library", label: t("tabLibrary"), hint: "4", run: () => onTab("library") },
    ];
    const films = movies
      .filter((movie) => {
        if (!needle) return recents.some((entry) => movie.title.toLowerCase().includes(entry.toLowerCase()));
        return (
          movie.title.toLowerCase().includes(needle) ||
          movie.director.toLowerCase().includes(needle) ||
          movie.tags.some((tag) => tag.includes(needle))
        );
      })
      .slice(0, 8)
      .map((movie) => ({
        id: movie.id,
        label: movie.title,
        hint: String(movie.year),
        movie,
        run: () => onSelectMovie(movie),
      }));
    const list = needle ? [...films, ...actions.filter((item) => item.label.toLowerCase().includes(needle))] : [...films, ...actions];
    return list.slice(0, 12);
  }, [movies, value, recents, onSelectMovie, onTab, t]);

  if (!open) return <div className="command-layer" />;

  return (
    <div
      className="command-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command" role="dialog" aria-label="Command palette">
        <input
          autoFocus
          placeholder={t("commandPlaceholder")}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              hits[active]?.run();
              onClose();
            }
            if (event.key === "Escape") onClose();
          }}
        />
        <div className="command-list">
          {hits.map((hit, index) => (
            <button
              key={hit.id}
              type="button"
              className={cx("command-item", index === active && "is-active")}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                hit.run();
                onClose();
              }}
            >
              <span>{hit.label}</span>
              <span className="search-kbd" style={{ marginLeft: "auto" }}>
                {hit.hint}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
CommandPalette.displayName = "CommandPalette";
