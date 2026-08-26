import { useMemo, type Dispatch, type ReactNode } from "react";
import {
  DECADES,
  SORTS,
  browseMovies,
  similarMovies,
  topRated,
  type Movie,
} from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";
import { type BrowseAction, type BrowseState } from "../state/browse.js";
import { useMoviesQuery, useRefreshMovies } from "../state/query.js";
import { useWatchlist } from "../state/watchlist.js";
import { GenreChips } from "./GenreChips.js";
import { MoviePoster } from "./MoviePoster.js";
import { MovieRow } from "./MovieRow.js";

export function MoviesScreen({
  query,
  browse,
  dispatch,
  selectedIds,
  onToggleSelect,
  onSelect,
  onQueue,
}: {
  query: string;
  browse: BrowseState;
  dispatch: Dispatch<BrowseAction>;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onSelect: (movie: Movie) => void;
  onQueue: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const { data, isFetching } = useMoviesQuery();
  const refresh = useRefreshMovies();
  const { saveMany } = useWatchlist();
  const movies = data ?? [];
  const results = useMemo(
    () =>
      browseMovies(movies, {
        query,
        genre: browse.genre,
        sort: browse.sort,
        decade: browse.decade,
        minRating: browse.minRating,
      }),
    [movies, query, browse],
  );
  const featured = topRated(movies, 1)[0];

  return (
    <section className="cinema-page" data-testid="movies-screen">
      <header className="page-head">
        <div>
          <h1 className="cinema-title">{t("nowShowing")}</h1>
          <p className="cinema-meta">
            {t("resultCount", { count: results.length, total: movies.length })}
            {selectedIds.length > 0 ? ` · ${t("selectedCount", { count: selectedIds.length })}` : ""}
          </p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" data-testid="refresh-catalog" onClick={refresh}>
            {t("refresh")}
            {isFetching ? "…" : ""}
          </button>
          {selectedIds.length > 0 ? (
            <button type="button" className="btn is-primary" onClick={() => saveMany(selectedIds)}>
              {t("bulkSave")}
            </button>
          ) : null}
        </div>
      </header>

      {featured ? (
        <Featured movie={featured} related={similarMovies(movies, featured)} onOpen={onSelect} onQueue={onQueue} />
      ) : null}

      <ContinueRail movies={movies} onSelect={onSelect} />

      <div className="toolbar">
        <GenreChips value={browse.genre} onChange={(genre) => dispatch({ type: "setGenre", genre })} />
      </div>

      <div className="toolbar filter-bar">
        <FilterGroup label={t("decade")}>
          <div className="seg" aria-label={t("decade")}>
            <button
              type="button"
              className={cx("seg-btn", browse.decade == null && "is-on")}
              onClick={() => dispatch({ type: "setDecade", decade: null })}
            >
              {t("filterAll")}
            </button>
            {DECADES.map((decade) => (
              <button
                key={decade}
                type="button"
                className={cx("seg-btn", browse.decade === decade && "is-on")}
                onClick={() => dispatch({ type: "setDecade", decade })}
              >
                {decade}s
              </button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup label={t("minRating")}>
          <div className="seg" aria-label={t("minRating")}>
            {[null, 7.5, 8].map((rating) => (
              <button
                key={String(rating)}
                type="button"
                className={cx("seg-btn", browse.minRating === rating && "is-on")}
                onClick={() => dispatch({ type: "setMinRating", minRating: rating })}
              >
                {rating == null ? t("filterAny") : `${rating}+`}
              </button>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup label={t("sort")}>
          <div className="seg" aria-label={t("sort")}>
            {SORTS.map((sort) => (
              <button
                key={sort}
                type="button"
                className={cx("seg-btn", browse.sort === sort && "is-on")}
                onClick={() => dispatch({ type: "setSort", sort })}
              >
                {t(
                  sort === "rating"
                    ? "sortRating"
                    : sort === "year"
                      ? "sortYear"
                      : sort === "title"
                        ? "sortTitle"
                        : "sortRuntime",
                )}
              </button>
            ))}
          </div>
        </FilterGroup>
        <div className="seg view-seg">
          {(["list", "grid", "posters"] as const).map((view) => (
            <button
              key={view}
              type="button"
              className={cx("seg-btn", browse.view === view && "is-on")}
              onClick={() => dispatch({ type: "setView", view })}
            >
              {view === "list" ? t("viewList") : view === "grid" ? t("viewGrid") : t("viewPosters")}
            </button>
          ))}
        </div>
      </div>

      {movies.length === 0 && isFetching ? (
        <p className="empty">{t("loading")}</p>
      ) : results.length === 0 ? (
        <p className="empty">{t("noMatch", { query })}</p>
      ) : (
        <div className={cx("catalog", `is-${browse.view}`)}>
          {results.map((movie) => (
            <MovieRow
              key={movie.id}
              movie={movie}
              onPress={onSelect}
              selected={selectedIds.includes(movie.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}
MoviesScreen.displayName = "MoviesScreen";

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="filter-group" data-filter-group={label}>
      <span>{label}</span>
      {children}
    </div>
  );
}
FilterGroup.displayName = "FilterGroup";

function Featured({
  movie,
  related,
  onOpen,
  onQueue,
}: {
  movie: Movie;
  related: Movie[];
  onOpen: (movie: Movie) => void;
  onQueue: (movie: Movie) => void;
}) {
  const { t, genre, runtime } = useI18n();
  return (
    <article className="hero" style={{ ["--hero" as string]: movie.accent }}>
      <MoviePoster title={movie.title} accent={movie.accent} size="hero" />
      <div className="hero-copy">
        <span className="kicker">{t("featured")}</span>
        <h2>{movie.title}</h2>
        <p>
          {movie.year} · {genre(movie.genre)} · {runtime(movie.runtimeMinutes)} · {movie.director}
        </p>
        <p>{movie.synopsis}</p>
        <div className="hero-actions">
          <button type="button" className="btn is-primary" onClick={() => onOpen(movie)}>
            {t("continueWatching")}
          </button>
          <button type="button" className="btn" onClick={() => onQueue(movie)}>
            {t("queue")}
          </button>
        </div>
        <div className="related">
          {related.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpen(item)}>
              {item.title}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
Featured.displayName = "Featured";

function ContinueRail({ movies, onSelect }: { movies: Movie[]; onSelect: (movie: Movie) => void }) {
  const { t } = useI18n();
  const { progress, ids } = useWatchlist();
  const items = movies.filter((movie) => (progress[movie.id] ?? 0) > 0 && (progress[movie.id] ?? 0) < 100);
  const queued = movies.filter((movie) => ids.includes(movie.id)).slice(0, 4);
  if (items.length === 0 && queued.length === 0) return null;

  return (
    <div className="columns">
      {items.length > 0 ? (
        <div className="panel">
          <h2>{t("continueWatching")}</h2>
          {items.slice(0, 3).map((movie) => (
            <MovieRow key={movie.id} movie={movie} onPress={onSelect} />
          ))}
        </div>
      ) : null}
      {queued.length > 0 ? (
        <div className="panel">
          <h2>{t("upNext")}</h2>
          {queued.map((movie) => (
            <MovieRow key={movie.id} movie={movie} onPress={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
ContinueRail.displayName = "ContinueRail";
