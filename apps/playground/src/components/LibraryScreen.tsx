import { Heading, Text } from "@chakra-ui/react";
import { cx } from "../lib/cx.js";
import {
  averageRating,
  countByGenre,
  topRated,
  totalHours,
  type Movie,
} from "../data/movies.js";
import { APPEARANCE_MODES, useAppearance, type AppearanceMode, type Density } from "../state/appearance.js";
import { LOCALES, LOCALE_LABELS } from "../data/translations.js";
import { useI18n } from "../hooks/use-i18n.js";
import { useWatchlist } from "../state/watchlist.js";
import { GenreCounts } from "./GenreCounts.js";
import { MovieRow } from "./MovieRow.js";

const APPEARANCE_KEYS = {
  system: "appearanceSystem",
  light: "appearanceLight",
  dark: "appearanceDark",
} as const satisfies Record<AppearanceMode, string>;

export function LibraryScreen({ movies, onSelect }: { movies: Movie[]; onSelect: (movie: Movie) => void }) {
  const { t, locale, setLocale } = useI18n();
  const { mode, setMode, density, setDensity } = useAppearance();
  const { ids } = useWatchlist();
  const counts = countByGenre(movies);
  const ranked = topRated(movies, 4);
  const saved = movies.filter((movie) => ids.includes(movie.id));

  return (
    <section className="cinema-library" data-testid="library-screen">
      <Heading as="h1" className="cinema-title" color="var(--text)" fontSize="var(--title)" fontWeight="650">
        {t("library")}
      </Heading>

      <div className="stats">
        <div className="stat">
          <b>{movies.length}</b>
          <span>{t("tabMovies")}</span>
        </div>
        <div className="stat">
          <b>{saved.length}</b>
          <span>{t("watchlist")}</span>
        </div>
        <div className="stat">
          <b>{totalHours(saved)}</b>
          <span>{t("hours", { count: totalHours(saved) })}</span>
        </div>
        <div className="stat">
          <b>{averageRating(movies)}</b>
          <span>{t("avgRating", { rating: averageRating(movies) })}</span>
        </div>
      </div>

      <div className="columns">
        <div className="panel">
          <h2>{t("byGenre")}</h2>
          <GenreCounts counts={counts} total={movies.length} />
        </div>
        <div className="panel">
          <h2>{t("topRated")}</h2>
          {ranked.map((movie) => (
            <MovieRow key={movie.id} movie={movie} onPress={onSelect} />
          ))}
        </div>
      </div>

      <div className="columns">
        <div className="panel">
          <Text mb="3" fontSize="13px" fontWeight="650" color="var(--text)">
            {t("appearance")}
          </Text>
          <div className="seg">
            {APPEARANCE_MODES.map((option) => (
              <button
                key={option}
                type="button"
                className={cx("seg-btn", mode === option && "is-on")}
                data-testid={`appearance-${option}`}
                onClick={() => setMode(option)}
              >
                {t(APPEARANCE_KEYS[option])}
              </button>
            ))}
          </div>
          <Text mt="4" mb="3" fontSize="13px" fontWeight="650" color="var(--text)">
            {t("settings")}
          </Text>
          <div className="seg">
            {(["comfortable", "compact"] as Density[]).map((option) => (
              <button
                key={option}
                type="button"
                className={cx("seg-btn", density === option && "is-on")}
                onClick={() => setDensity(option)}
              >
                {option === "compact" ? t("densityCompact") : t("densityComfortable")}
              </button>
            ))}
          </div>
        </div>
        <div className="panel">
          <Text mb="3" fontSize="13px" fontWeight="650" color="var(--text)">
            {t("language")}
          </Text>
          <div className="seg">
            {LOCALES.map((option) => (
              <button
                key={option}
                type="button"
                className={cx("seg-btn", locale === option && "is-on")}
                data-testid={`locale-${option}`}
                onClick={() => setLocale(option)}
              >
                {LOCALE_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
LibraryScreen.displayName = "LibraryScreen";
