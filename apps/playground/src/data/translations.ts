import type { Genre } from "./movies.js";

export const LOCALES = ["en", "pt", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  pt: "Português",
  fr: "Français",
};

type Dictionary = {
  nowShowing: string;
  library: string;
  searchPlaceholder: string;
  filterAll: string;
  resultCount: string;
  noMatch: string;
  byGenre: string;
  topRated: string;
  filmCount: string;
  filmCountPlural: string;
  close: string;
  directedBy: string;
  ratingOutOf: string;
  appearance: string;
  appearanceSystem: string;
  appearanceLight: string;
  appearanceDark: string;
  language: string;
  tabMovies: string;
  tabLibrary: string;
  tabWatchlist: string;
  tabActivity: string;
  save: string;
  saved: string;
  watchlist: string;
  refresh: string;
  loading: string;
  brand: string;
  commandPlaceholder: string;
  commandHint: string;
  viewList: string;
  viewGrid: string;
  viewPosters: string;
  densityComfortable: string;
  densityCompact: string;
  sortRating: string;
  sortYear: string;
  sortTitle: string;
  sortRuntime: string;
  statusQueued: string;
  statusWatching: string;
  statusWatched: string;
  notes: string;
  notesPlaceholder: string;
  continueWatching: string;
  upNext: string;
  activity: string;
  emptyWatchlist: string;
  emptyActivity: string;
  similar: string;
  hours: string;
  avgRating: string;
  shortcuts: string;
  featured: string;
  queue: string;
  markWatched: string;
  decade: string;
  minRating: string;
  filters: string;
  bulkSave: string;
  selectedCount: string;
  settings: string;
  recentlyViewed: string;
  progress: string;
  inbox: string;
  filterAny: string;
  sort: string;
  clear: string;
  markRead: string;
  genres: Record<Genre, string>;
};

export const TRANSLATIONS: Record<Locale, Dictionary> = {
  en: {
    nowShowing: "Now Showing",
    library: "Library",
    searchPlaceholder: "Search titles, directors, tags",
    filterAll: "All",
    resultCount: "{count} of {total}",
    noMatch: "No films match “{query}”.",
    byGenre: "By genre",
    topRated: "Top rated",
    filmCount: "{count} film",
    filmCountPlural: "{count} films",
    close: "Close",
    directedBy: "Dir. {name}",
    ratingOutOf: "{rating} / 10",
    appearance: "Appearance",
    appearanceSystem: "System",
    appearanceLight: "Light",
    appearanceDark: "Dark",
    language: "Language",
    tabMovies: "Browse",
    tabLibrary: "Library",
    tabWatchlist: "Watchlist",
    tabActivity: "Inbox",
    save: "Save",
    saved: "Saved",
    watchlist: "Watchlist",
    refresh: "Sync",
    loading: "Loading catalog…",
    brand: "Lumen",
    commandPlaceholder: "Jump to a film, view, or action",
    commandHint: "⌘K",
    viewList: "List",
    viewGrid: "Board",
    viewPosters: "Posters",
    densityComfortable: "Comfortable",
    densityCompact: "Compact",
    sortRating: "Rating",
    sortYear: "Year",
    sortTitle: "Title",
    sortRuntime: "Runtime",
    statusQueued: "Up next",
    statusWatching: "Watching",
    statusWatched: "Watched",
    notes: "Notes",
    notesPlaceholder: "A private note for this film",
    continueWatching: "Continue",
    upNext: "Up next",
    activity: "Activity",
    emptyWatchlist: "Nothing saved yet.",
    emptyActivity: "No activity yet.",
    similar: "Related",
    hours: "{count} hr queued",
    avgRating: "Avg {rating}",
    shortcuts: "Shortcuts",
    featured: "Featured",
    queue: "Add to queue",
    markWatched: "Mark watched",
    decade: "Decade",
    minRating: "Rating",
    filters: "Filters",
    bulkSave: "Save selected",
    selectedCount: "{count} selected",
    settings: "Settings",
    recentlyViewed: "Recently opened",
    progress: "Progress",
    inbox: "Inbox",
    filterAny: "Any",
    sort: "Sort",
    clear: "Clear",
    markRead: "Mark read",
    genres: {
      "Sci-Fi": "Sci-Fi",
      Drama: "Drama",
      Thriller: "Thriller",
      Animation: "Animation",
      Comedy: "Comedy",
    },
  },
  pt: {
    nowShowing: "Em exibição",
    library: "Biblioteca",
    searchPlaceholder: "Procurar títulos, realizadores, tags",
    filterAll: "Todos",
    resultCount: "{count} de {total}",
    noMatch: "Nenhum filme corresponde a “{query}”.",
    byGenre: "Por género",
    topRated: "Melhor avaliados",
    filmCount: "{count} filme",
    filmCountPlural: "{count} filmes",
    close: "Fechar",
    directedBy: "Real. {name}",
    ratingOutOf: "{rating} / 10",
    appearance: "Aparência",
    appearanceSystem: "Sistema",
    appearanceLight: "Claro",
    appearanceDark: "Escuro",
    language: "Idioma",
    tabMovies: "Explorar",
    tabLibrary: "Biblioteca",
    tabWatchlist: "Lista",
    tabActivity: "Inbox",
    save: "Guardar",
    saved: "Guardado",
    watchlist: "Lista",
    refresh: "Sincronizar",
    loading: "A carregar catálogo…",
    brand: "Lumen",
    commandPlaceholder: "Ir para um filme, vista ou ação",
    commandHint: "⌘K",
    viewList: "Lista",
    viewGrid: "Quadro",
    viewPosters: "Posters",
    densityComfortable: "Confortável",
    densityCompact: "Compacto",
    sortRating: "Nota",
    sortYear: "Ano",
    sortTitle: "Título",
    sortRuntime: "Duração",
    statusQueued: "A seguir",
    statusWatching: "A ver",
    statusWatched: "Visto",
    notes: "Notas",
    notesPlaceholder: "Uma nota privada para este filme",
    continueWatching: "Continuar",
    upNext: "A seguir",
    activity: "Atividade",
    emptyWatchlist: "Ainda não guardaste nada.",
    emptyActivity: "Ainda sem atividade.",
    similar: "Relacionados",
    hours: "{count} h na fila",
    avgRating: "Média {rating}",
    shortcuts: "Atalhos",
    featured: "Destaque",
    queue: "Adicionar à fila",
    markWatched: "Marcar como visto",
    decade: "Década",
    minRating: "Nota",
    filters: "Filtros",
    bulkSave: "Guardar seleção",
    selectedCount: "{count} selecionados",
    settings: "Definições",
    recentlyViewed: "Abertos recentemente",
    progress: "Progresso",
    inbox: "Inbox",
    filterAny: "Qualquer",
    sort: "Ordenar",
    clear: "Limpar",
    markRead: "Marcar lido",
    genres: {
      "Sci-Fi": "Ficção científica",
      Drama: "Drama",
      Thriller: "Suspense",
      Animation: "Animação",
      Comedy: "Comédia",
    },
  },
  fr: {
    nowShowing: "À l'affiche",
    library: "Bibliothèque",
    searchPlaceholder: "Rechercher titres, réalisateurs, tags",
    filterAll: "Tous",
    resultCount: "{count} sur {total}",
    noMatch: "Aucun film ne correspond à « {query} ».",
    byGenre: "Par genre",
    topRated: "Mieux notés",
    filmCount: "{count} film",
    filmCountPlural: "{count} films",
    close: "Fermer",
    directedBy: "Réal. {name}",
    ratingOutOf: "{rating} / 10",
    appearance: "Apparence",
    appearanceSystem: "Système",
    appearanceLight: "Clair",
    appearanceDark: "Sombre",
    language: "Langue",
    tabMovies: "Parcourir",
    tabLibrary: "Bibliothèque",
    tabWatchlist: "Liste",
    tabActivity: "Inbox",
    save: "Enregistrer",
    saved: "Enregistré",
    watchlist: "Liste",
    refresh: "Sync",
    loading: "Chargement du catalogue…",
    brand: "Lumen",
    commandPlaceholder: "Aller à un film, une vue ou une action",
    commandHint: "⌘K",
    viewList: "Liste",
    viewGrid: "Tableau",
    viewPosters: "Affiches",
    densityComfortable: "Confortable",
    densityCompact: "Compact",
    sortRating: "Note",
    sortYear: "Année",
    sortTitle: "Titre",
    sortRuntime: "Durée",
    statusQueued: "À suivre",
    statusWatching: "En cours",
    statusWatched: "Vu",
    notes: "Notes",
    notesPlaceholder: "Une note privée pour ce film",
    continueWatching: "Reprendre",
    upNext: "À suivre",
    activity: "Activité",
    emptyWatchlist: "Rien d'enregistré.",
    emptyActivity: "Aucune activité.",
    similar: "Liés",
    hours: "{count} h en file",
    avgRating: "Moy. {rating}",
    shortcuts: "Raccourcis",
    featured: "À la une",
    queue: "Ajouter à la file",
    markWatched: "Marquer vu",
    decade: "Décennie",
    minRating: "Note",
    filters: "Filtres",
    bulkSave: "Enregistrer la sélection",
    selectedCount: "{count} sélectionnés",
    settings: "Réglages",
    recentlyViewed: "Ouverts récemment",
    progress: "Progression",
    inbox: "Inbox",
    filterAny: "Toutes",
    sort: "Trier",
    clear: "Effacer",
    markRead: "Marquer lu",
    genres: {
      "Sci-Fi": "Science-fiction",
      Drama: "Drame",
      Thriller: "Thriller",
      Animation: "Animation",
      Comedy: "Comédie",
    },
  },
};

export type TranslationKey = Exclude<keyof Dictionary, "genres">;
export const DEFAULT_LOCALE: Locale = "en";

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {},
): string {
  const template = TRANSLATIONS[locale][key];
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function translateGenre(locale: Locale, genre: Genre): string {
  return TRANSLATIONS[locale].genres[genre];
}

export function translateFilmCount(locale: Locale, count: number): string {
  return translate(locale, count === 1 ? "filmCount" : "filmCountPlural", { count });
}

export function formatRuntimeLocalized(locale: Locale, minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const minuteUnit = locale === "fr" ? "min" : "m";
  return hours === 0 ? `${rest}${minuteUnit}` : `${hours}h ${rest}${minuteUnit}`;
}
