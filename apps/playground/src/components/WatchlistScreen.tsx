import type { Movie } from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";
import { WATCH_STATUSES, useWatchlist, type WatchStatus } from "../state/watchlist.js";
import { MovieRow } from "./MovieRow.js";

export function WatchlistScreen({
  movies,
  onSelect,
}: {
  movies: Movie[];
  onSelect: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const { ids, of, setStatus } = useWatchlist();
  const saved = movies.filter((movie) => ids.includes(movie.id));

  return (
    <section>
      <header className="page-head">
        <div>
          <h1 className="cinema-title">{t("watchlist")}</h1>
          <p className="cinema-meta">{t("resultCount", { count: saved.length, total: movies.length })}</p>
        </div>
      </header>
      {saved.length === 0 ? (
        <p className="empty">{t("emptyWatchlist")}</p>
      ) : (
        <div className="kanban">
          {WATCH_STATUSES.map((status) => {
            const column = saved.filter((movie) => (of(movie.id) ?? "queued") === status);
            return (
              <div key={status} className={cx("kanban-col", "panel", column.length === 0 && "is-empty")}>
                <header className="kanban-head">
                  <h2>
                    {status === "queued"
                      ? t("statusQueued")
                      : status === "watching"
                        ? t("statusWatching")
                        : t("statusWatched")}
                  </h2>
                  <span className="nav-count">{column.length}</span>
                </header>
                {column.length === 0 ? (
                  <p className="empty">{t("emptyWatchlist")}</p>
                ) : (
                  column.map((movie) => (
                    <div key={movie.id} className="kanban-card">
                      <MovieRow movie={movie} onPress={onSelect} />
                      <div className="seg">
                        {WATCH_STATUSES.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={cx("seg-btn", status === value && "is-on")}
                            onClick={() => setStatus(movie.id, value satisfies WatchStatus)}
                          >
                            {value === "queued"
                              ? t("statusQueued")
                              : value === "watching"
                                ? t("statusWatching")
                                : t("statusWatched")}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
WatchlistScreen.displayName = "WatchlistScreen";
