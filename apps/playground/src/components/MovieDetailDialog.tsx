import { Button, Dialog, Portal, Text } from "@chakra-ui/react";
import { similarMovies, type Movie } from "../data/movies.js";
import { useI18n } from "../hooks/use-i18n.js";
import { WATCH_STATUSES, useWatchlist } from "../state/watchlist.js";
import { cx } from "../lib/cx.js";
import { MoviePoster } from "./MoviePoster.js";

export function MovieDetailDialog({
  movie,
  catalog,
  note,
  onNote,
  onClose,
  onOpenRelated,
}: {
  movie: Movie | null;
  catalog: Movie[];
  note: string;
  onNote: (text: string) => void;
  onClose: () => void;
  onOpenRelated: (movie: Movie) => void;
}) {
  const { t, genre, runtime } = useI18n();
  const { has, toggle, of, setStatus, percent, setProgress } = useWatchlist();
  const related = movie ? similarMovies(catalog, movie) : [];

  return (
    <Dialog.Root
      open={movie !== null}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
      size="xl"
      scrollBehavior="inside"
    >
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content bg="var(--surface)" color="var(--text)" border="1px solid var(--border)">
            {movie ? (
              <>
                <Dialog.Header>
                  <Dialog.Title flex="1">{movie.title}</Dialog.Title>
                  <Dialog.CloseTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      color="var(--text)"
                      data-testid="movie-detail-close"
                      onClick={onClose}
                    >
                      {t("close")}
                    </Button>
                  </Dialog.CloseTrigger>
                </Dialog.Header>
                <Dialog.Body>
                  <div className="detail-grid">
                    <MoviePoster title={movie.title} accent={movie.accent} size="detail" />
                    <div>
                      <Text fontWeight="700">{t("ratingOutOf", { rating: movie.rating.toFixed(1) })}</Text>
                      <Text color="var(--text-secondary)" fontSize="sm" mt="1">
                        {movie.year} · {genre(movie.genre)} · {movie.country}
                      </Text>
                      <Text color="var(--text-secondary)" fontSize="sm">
                        {runtime(movie.runtimeMinutes)} · {t("directedBy", { name: movie.director })}
                      </Text>
                      <div className="chip-row" style={{ marginTop: 12 }}>
                        {movie.tags.map((tag) => (
                          <span key={tag} className="chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="seg" style={{ marginTop: 14 }}>
                        {WATCH_STATUSES.map((status) => (
                          <button
                            key={status}
                            type="button"
                            className={cx("seg-btn", of(movie.id) === status && "is-on")}
                            onClick={() => setStatus(movie.id, status)}
                          >
                            {status === "queued"
                              ? t("statusQueued")
                              : status === "watching"
                                ? t("statusWatching")
                                : t("statusWatched")}
                          </button>
                        ))}
                      </div>
                      <Text mt="4" mb="2" fontSize="12px" color="var(--text-secondary)">
                        {t("progress")} · {percent(movie.id)}%
                      </Text>
                      <input
                        className="range"
                        type="range"
                        min={0}
                        max={100}
                        value={percent(movie.id)}
                        onChange={(event) => setProgress(movie.id, Number(event.target.value))}
                      />
                      <div className="hero-actions" style={{ marginTop: 12 }}>
                        <button
                          type="button"
                          className={cx("btn", has(movie.id) && "is-primary")}
                          onClick={() => toggle(movie.id)}
                        >
                          {has(movie.id) ? t("saved") : t("save")}
                        </button>
                      </div>
                    </div>
                  </div>
                  <Text mt="5" mb="4" lineHeight="1.6">
                    {movie.synopsis}
                  </Text>
                  <Text fontSize="13px" fontWeight="650" mb="2">
                    {t("notes")}
                  </Text>
                  <textarea
                    className="note"
                    placeholder={t("notesPlaceholder")}
                    value={note}
                    onChange={(event) => onNote(event.target.value)}
                  />
                  <Text fontSize="13px" fontWeight="650" mt="4" mb="2">
                    {t("similar")}
                  </Text>
                  <div className="related">
                    {related.map((item) => (
                      <button key={item.id} type="button" onClick={() => onOpenRelated(item)}>
                        {item.title}
                      </button>
                    ))}
                  </div>
                </Dialog.Body>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
MovieDetailDialog.displayName = "MovieDetailDialog";
