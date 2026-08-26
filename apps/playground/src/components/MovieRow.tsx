import * as stylex from "@stylexjs/stylex";
import type { Movie } from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";
import { useWatchlist } from "../state/watchlist.js";
import { MoviePoster } from "./MoviePoster.js";

const styles = stylex.create({
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
});

export function MovieRow({
  movie,
  onPress,
  selected,
  onToggleSelect,
}: {
  movie: Movie;
  onPress: (movie: Movie) => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const { genre, runtime, t } = useI18n();
  const { has, toggle, of, percent } = useWatchlist();
  const saved = has(movie.id);
  const status = of(movie.id);
  const watched = status === "watched";
  const queued = status === "queued" || status === "watching";
  const progress = percent(movie.id);

  return (
    <article
      className={cx(
        "movie-card",
        saved && "is-saved",
        watched && "is-watched",
        selected && "is-selected",
        queued && "is-queued",
      )}
    >
      {onToggleSelect ? (
        <button
          type="button"
          className={cx("check", selected && "is-on")}
          aria-label="Select"
          onClick={() => onToggleSelect(movie.id)}
        />
      ) : null}
      <button
        type="button"
        className="movie-hit"
        data-testid={`movie-row-${movie.id}`}
        aria-label={`${movie.title}, ${movie.year}`}
        onClick={() => onPress(movie)}
      >
        <MoviePoster title={movie.title} accent={movie.accent} />
        <div className="movie-copy">
          <h3>{movie.title}</h3>
          <p>
            {movie.year} · {genre(movie.genre)} · {movie.country}
          </p>
          <p>
            {runtime(movie.runtimeMinutes)} · {movie.director}
          </p>
          {progress > 0 ? (
            <div className="progress-rail">
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <span className="status-dot" />
        <span className="rating-pill">{movie.rating.toFixed(1)}</span>
      </button>
      <div {...stylex.props(styles.actions)}>
        <button
          type="button"
          className={cx("btn", saved && "is-primary")}
          data-testid={`watchlist-${movie.id}`}
          onClick={() => toggle(movie.id)}
        >
          {saved ? t("saved") : t("save")}
        </button>
      </div>
    </article>
  );
}
MovieRow.displayName = "MovieRow";
