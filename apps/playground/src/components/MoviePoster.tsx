import * as stylex from "@stylexjs/stylex";
import { monogram } from "../data/movies.js";

type PosterSize = "row" | "card" | "hero" | "detail";

const sizes: Record<PosterSize, { width: number; height: number; radius: number; font: number }> = {
  row: { width: 44, height: 64, radius: 8, font: 16 },
  card: { width: 52, height: 76, radius: 10, font: 18 },
  hero: { width: 176, height: 256, radius: 16, font: 52 },
  detail: { width: 120, height: 176, radius: 14, font: 40 },
};

const styles = stylex.create({
  poster: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
  },
  monogram: {
    color: "#ffffff",
    fontWeight: 700,
    letterSpacing: "0.08em",
    lineHeight: 1,
  },
});

export function MoviePoster({
  title,
  accent,
  size = "card",
}: {
  title: string;
  accent: string;
  size?: PosterSize;
}) {
  const { width, height, radius, font } = sizes[size];

  return (
    <div
      {...stylex.props(styles.poster)}
      style={{ width, height, borderRadius: radius, background: `linear-gradient(165deg, ${accent}, #111)` }}
    >
      <span {...stylex.props(styles.monogram)} style={{ fontSize: font }}>
        {monogram(title)}
      </span>
    </div>
  );
}
MoviePoster.displayName = "MoviePoster";
