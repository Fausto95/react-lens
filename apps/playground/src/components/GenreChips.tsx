import { GENRES, type Genre } from "../data/movies.js";
import { cx } from "../lib/cx.js";
import { useI18n } from "../hooks/use-i18n.js";

export function GenreChips({
  value,
  onChange,
}: {
  value: Genre | null;
  onChange: (genre: Genre | null) => void;
}) {
  const { t, genre: genreLabel } = useI18n();

  return (
    <div className="chip-row">
      {[null, ...GENRES].map((option) => {
        const isOn = value === option;
        const label = option ? genreLabel(option) : t("filterAll");
        return (
          <button
            key={option ?? "all"}
            type="button"
            className={cx("chip", isOn && "is-on")}
            data-testid={`genre-chip-${option ?? "All"}`}
            aria-pressed={isOn}
            onClick={() => onChange(option)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
GenreChips.displayName = "GenreChips";
