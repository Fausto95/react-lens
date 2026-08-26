import { GENRES, type Genre } from "../data/movies.js";
import { useI18n } from "../hooks/use-i18n.js";

export function GenreCounts({ counts, total }: { counts: Record<Genre, number>; total: number }) {
  const { genre: genreLabel, filmCount } = useI18n();

  return (
    <div>
      {GENRES.map((name) => (
        <div key={name} className="genre-meter" data-testid={`genre-count-${name}`}>
          <span>{genreLabel(name)}</span>
          <div className="meter">
            <span style={{ width: total === 0 ? "0%" : `${(counts[name] / total) * 100}%` }} />
          </div>
          <span>{filmCount(counts[name])}</span>
        </div>
      ))}
    </div>
  );
}
GenreCounts.displayName = "GenreCounts";
