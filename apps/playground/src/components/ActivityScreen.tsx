import type { Movie } from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";
import type { ActivityEvent } from "../state/journal.js";

export function ActivityScreen({
  events,
  movies,
  onSelect,
  onClear,
  onRead,
  onReadAll,
}: {
  events: ActivityEvent[];
  movies: Movie[];
  onSelect: (movie: Movie) => void;
  onClear: () => void;
  onRead: (id: string) => void;
  onReadAll: () => void;
}) {
  const { t } = useI18n();
  const byId = new Map(movies.map((movie) => [movie.id, movie]));
  const unread = events.filter((event) => event.unread).length;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1 className="cinema-title">{t("inbox")}</h1>
          <p className="cinema-meta">
            {t("activity")}
            {unread > 0 ? ` · ${unread}` : ""}
          </p>
        </div>
        <div className="toolbar">
          {unread > 0 ? (
            <button type="button" className="btn" onClick={onReadAll}>
              {t("markRead")}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClear}>
            {t("clear")}
          </button>
        </div>
      </header>
      {events.length === 0 ? (
        <p className="empty">{t("emptyActivity")}</p>
      ) : (
        <div className={cx("inbox", "panel", unread > 0 && "is-unread")}>
          {events.map((event) => {
            const movie = byId.get(event.movieId);
            return (
              <button
                key={event.id}
                type="button"
                className={cx("inbox-row", event.unread && "is-unread")}
                onClick={() => {
                  onRead(event.id);
                  if (movie) onSelect(movie);
                }}
              >
                <span className={cx("status-dot", event.unread && "is-on")} />
                <div>
                  <strong>{movie?.title ?? event.movieId}</strong>
                  <div className="cinema-meta">{event.label}</div>
                </div>
                <time>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
ActivityScreen.displayName = "ActivityScreen";
