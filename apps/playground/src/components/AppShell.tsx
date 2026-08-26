import type { ReactNode } from "react";
import { cx } from "../lib/cx.js";
import { LOCALES } from "../data/translations.js";
import { useI18n } from "../hooks/use-i18n.js";
import { useAppearance } from "../state/appearance.js";
import { useWatchlist } from "../state/watchlist.js";

export type Tab = "movies" | "watchlist" | "activity" | "library";

export function AppShell({
  tab,
  onTab,
  query,
  onQuery,
  onCommand,
  onSearchSubmit,
  unread,
  children,
}: {
  tab: Tab;
  onTab: (tab: Tab) => void;
  query: string;
  onQuery: (value: string) => void;
  onCommand: () => void;
  onSearchSubmit: () => void;
  unread: number;
  children: ReactNode;
}) {
  const { t, locale, setLocale } = useI18n();
  const { toggleSidebar, density, setDensity, scheme, setMode } = useAppearance();
  const { count } = useWatchlist();

  const items: { id: Tab; label: string; icon: string; count?: number }[] = [
    { id: "movies", label: t("tabMovies"), icon: "◎" },
    { id: "watchlist", label: t("tabWatchlist"), icon: "★", count },
    { id: "activity", label: t("tabActivity"), icon: "◈", count: unread || undefined },
    { id: "library", label: t("tabLibrary"), icon: "▦" },
  ];

  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" />
          <span className="brand-word">{t("brand")}</span>
        </div>
        <div className="nav-section">Menu</div>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx("nav-item", tab === item.id && "is-active")}
            data-testid={`tab-${item.id}`}
            onClick={() => onTab(item.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="nav-label">{item.label}</span>
            {item.count != null ? <span className="nav-count">{item.count}</span> : null}
          </button>
        ))}
        <p className="sidebar-foot">{t("shortcuts")}: ⌘K · / · 1–4</p>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button type="button" className="icon-btn" aria-label="Collapse sidebar" onClick={toggleSidebar}>
            ☰
          </button>
          <form
            className="search-pill"
            onSubmit={(event) => {
              event.preventDefault();
              onSearchSubmit();
            }}
          >
            <input
              aria-label="Search movies"
              data-testid="movie-search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
            />
            <span className="search-kbd">{t("commandHint")}</span>
          </form>
          <button type="button" className="icon-btn" onClick={onCommand} aria-label="Command palette">
            ⌕
          </button>
          <button
            type="button"
            className={cx("icon-btn", "locale-chip")}
            aria-label={t("language")}
            onClick={() => {
              const index = LOCALES.indexOf(locale);
              setLocale(LOCALES[(index + 1) % LOCALES.length]!);
            }}
          >
            {locale.toUpperCase()}
          </button>
          <button
            type="button"
            className={cx("icon-btn", density === "compact" && "is-on")}
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
            aria-label="Density"
          >
            ▤
          </button>
          <button
            type="button"
            className={cx("icon-btn", scheme === "dark" && "is-on")}
            onClick={() => setMode(scheme === "dark" ? "light" : "dark")}
            aria-label="Theme"
          >
            ◐
          </button>
        </header>
        <main className="main">{children}</main>
      </div>

      <nav className="mobile-nav">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cx("nav-item", tab === item.id && "is-active")}
            onClick={() => onTab(item.id)}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.count != null ? <span className="nav-count">{item.count}</span> : null}
          </button>
        ))}
      </nav>
    </>
  );
}
AppShell.displayName = "AppShell";
