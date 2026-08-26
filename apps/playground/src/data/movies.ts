export type Movie = {
  id: string;
  title: string;
  year: number;
  genre: Genre;
  rating: number;
  runtimeMinutes: number;
  director: string;
  synopsis: string;
  country: string;
  tags: readonly string[];
  /** Poster tile background; posters are drawn, not fetched. */
  accent: string;
};

export const GENRES = ["Sci-Fi", "Drama", "Thriller", "Animation", "Comedy"] as const;

export type Genre = (typeof GENRES)[number];

export const SORTS = ["rating", "year", "title", "runtime"] as const;
export type SortKey = (typeof SORTS)[number];

export const DECADES = [2000, 2010, 2020] as const;

export const MOVIES: readonly Movie[] = [
  {
    id: "arrival",
    title: "Arrival",
    year: 2016,
    genre: "Sci-Fi",
    rating: 7.9,
    runtimeMinutes: 116,
    director: "Denis Villeneuve",
    country: "USA",
    tags: ["language", "time", "first contact"],
    synopsis:
      "A linguist is recruited to communicate with extraterrestrial visitors, and learns that their language rewrites how she experiences time.",
    accent: "#2F4858",
  },
  {
    id: "blade-runner-2049",
    title: "Blade Runner 2049",
    year: 2017,
    genre: "Sci-Fi",
    rating: 8.0,
    runtimeMinutes: 164,
    director: "Denis Villeneuve",
    country: "USA",
    tags: ["neon", "identity", "noir"],
    synopsis:
      "A replicant blade runner uncovers a secret buried for thirty years and goes looking for a man who vanished with it.",
    accent: "#8C4A2F",
  },
  {
    id: "parasite",
    title: "Parasite",
    year: 2019,
    genre: "Thriller",
    rating: 8.5,
    runtimeMinutes: 132,
    director: "Bong Joon-ho",
    country: "South Korea",
    tags: ["class", "stairs", "rain"],
    synopsis:
      "A struggling family talks its way into the household of a wealthy one, and the arrangement curdles into something neither side can control.",
    accent: "#3D5A45",
  },
  {
    id: "whiplash",
    title: "Whiplash",
    year: 2014,
    genre: "Drama",
    rating: 8.5,
    runtimeMinutes: 106,
    director: "Damien Chazelle",
    country: "USA",
    tags: ["music", "obsession", "mentor"],
    synopsis:
      "A young drummer at an elite conservatory is pushed past every limit by an instructor who believes cruelty is the price of greatness.",
    accent: "#7A2E2E",
  },
  {
    id: "spirited-away",
    title: "Spirited Away",
    year: 2001,
    genre: "Animation",
    rating: 8.6,
    runtimeMinutes: 125,
    director: "Hayao Miyazaki",
    country: "Japan",
    tags: ["spirits", "bathhouse", "names"],
    synopsis:
      "A ten-year-old girl wanders into a world of spirits and must work in a bathhouse to win back her parents and her own name.",
    accent: "#2E6171",
  },
  {
    id: "the-grand-budapest-hotel",
    title: "The Grand Budapest Hotel",
    year: 2014,
    genre: "Comedy",
    rating: 8.1,
    runtimeMinutes: 99,
    director: "Wes Anderson",
    country: "Germany",
    tags: ["lobby", "pastel", "war"],
    synopsis:
      "A legendary concierge and his lobby boy become entangled in a stolen painting, a contested fortune, and a continent sliding into war.",
    accent: "#B0577A",
  },
  {
    id: "mad-max-fury-road",
    title: "Mad Max: Fury Road",
    year: 2015,
    genre: "Sci-Fi",
    rating: 8.1,
    runtimeMinutes: 120,
    director: "George Miller",
    country: "Australia",
    tags: ["chase", "desert", "war rig"],
    synopsis: "Across a scorched wasteland, a drifter and a runaway commander flee a warlord in one unbroken pursuit.",
    accent: "#A85426",
  },
  {
    id: "no-country-for-old-men",
    title: "No Country for Old Men",
    year: 2007,
    genre: "Thriller",
    rating: 8.2,
    runtimeMinutes: 122,
    director: "Joel & Ethan Coen",
    country: "USA",
    tags: ["coin", "desert", "fate"],
    synopsis:
      "A hunter finds two million dollars beside a drug deal gone wrong, and an implacable killer sets out to retrieve it.",
    accent: "#6B5B3E",
  },
  {
    id: "her",
    title: "Her",
    year: 2013,
    genre: "Drama",
    rating: 8.0,
    runtimeMinutes: 126,
    director: "Spike Jonze",
    country: "USA",
    tags: ["os", "loneliness", "future"],
    synopsis:
      "A lonely writer falls in love with an operating system, and discovers that she is growing in directions he cannot follow.",
    accent: "#C0563F",
  },
  {
    id: "inside-out",
    title: "Inside Out",
    year: 2015,
    genre: "Animation",
    rating: 8.1,
    runtimeMinutes: 95,
    director: "Pete Docter",
    country: "USA",
    tags: ["memory", "headquarters", "move"],
    synopsis:
      "Five emotions steer an eleven-year-old through a move across the country, until joy and sadness are lost far from headquarters.",
    accent: "#4B5EAA",
  },
  {
    id: "the-social-network",
    title: "The Social Network",
    year: 2010,
    genre: "Drama",
    rating: 7.8,
    runtimeMinutes: 120,
    director: "David Fincher",
    country: "USA",
    tags: ["harvard", "deposition", "code"],
    synopsis: "The founding of a website that connected the world, told through the depositions of the friendships it cost.",
    accent: "#33566B",
  },
  {
    id: "jojo-rabbit",
    title: "Jojo Rabbit",
    year: 2019,
    genre: "Comedy",
    rating: 7.9,
    runtimeMinutes: 108,
    director: "Taika Waititi",
    country: "New Zealand",
    tags: ["war", "imaginary", "attic"],
    synopsis:
      "A boy in the Hitler Youth discovers his mother is hiding a Jewish girl upstairs, and his imaginary friend takes it badly.",
    accent: "#9A6B2F",
  },
  {
    id: "dune",
    title: "Dune",
    year: 2021,
    genre: "Sci-Fi",
    rating: 8.0,
    runtimeMinutes: 155,
    director: "Denis Villeneuve",
    country: "USA",
    tags: ["spice", "desert", "prophecy"],
    synopsis: "A gifted son of a noble house is sent to a desert planet and becomes something the empire cannot contain.",
    accent: "#C4A574",
  },
  {
    id: "get-out",
    title: "Get Out",
    year: 2017,
    genre: "Thriller",
    rating: 7.8,
    runtimeMinutes: 104,
    director: "Jordan Peele",
    country: "USA",
    tags: ["sunken place", "weekend", "auction"],
    synopsis: "A photographer meets his girlfriend's family for the weekend and finds the welcome is a trap.",
    accent: "#1F3D2A",
  },
  {
    id: "coco",
    title: "Coco",
    year: 2017,
    genre: "Animation",
    rating: 8.4,
    runtimeMinutes: 105,
    director: "Lee Unkrich",
    country: "USA",
    tags: ["music", "family", "land of the dead"],
    synopsis: "A boy chasing a forbidden guitar crosses into the land of the dead and has to find his way back before sunrise.",
    accent: "#C45C26",
  },
  {
    id: "moonlight",
    title: "Moonlight",
    year: 2016,
    genre: "Drama",
    rating: 7.4,
    runtimeMinutes: 111,
    director: "Barry Jenkins",
    country: "USA",
    tags: ["identity", "miami", "three acts"],
    synopsis: "A young man grows up in three chapters, learning who he is in the space between tenderness and the neighborhood.",
    accent: "#2A4A6B",
  },
  {
    id: "the-lighthouse",
    title: "The Lighthouse",
    year: 2019,
    genre: "Thriller",
    rating: 7.4,
    runtimeMinutes: 109,
    director: "Robert Eggers",
    country: "USA",
    tags: ["fog", "two men", "lamp"],
    synopsis: "Two keepers stranded on a remote rock drink, hallucinate, and fight over who may tend the light.",
    accent: "#4A4A46",
  },
  {
    id: "portrait-of-a-lady-on-fire",
    title: "Portrait of a Lady on Fire",
    year: 2019,
    genre: "Drama",
    rating: 8.1,
    runtimeMinutes: 121,
    director: "Céline Sciamma",
    country: "France",
    tags: ["look", "island", "memory"],
    synopsis: "A painter is hired to secretly portrait a woman who refuses to sit, and they fall into a brief, complete love.",
    accent: "#6B3A32",
  },
  {
    id: "everything-everywhere",
    title: "Everything Everywhere All at Once",
    year: 2022,
    genre: "Comedy",
    rating: 7.8,
    runtimeMinutes: 139,
    director: "Daniels",
    country: "USA",
    tags: ["multiverse", "laundry", "googly eyes"],
    synopsis: "A laundromat owner is pulled across universes to save existence, and to talk to her daughter.",
    accent: "#C45B7A",
  },
  {
    id: "lady-bird",
    title: "Lady Bird",
    year: 2017,
    genre: "Comedy",
    rating: 7.4,
    runtimeMinutes: 94,
    director: "Greta Gerwig",
    country: "USA",
    tags: ["sacramento", "mother", "senior year"],
    synopsis: "A senior in Sacramento wants another name, another city, and a version of her mother she can stand.",
    accent: "#C46B4A",
  },
];

export type BrowseQuery = {
  query: string;
  genre: Genre | null;
  sort: SortKey;
  decade: number | null;
  minRating: number | null;
};

export function browseMovies(movies: readonly Movie[], opts: BrowseQuery): Movie[] {
  const needle = opts.query.trim().toLowerCase();

  const filtered = movies.filter((movie) => {
    if (opts.genre && movie.genre !== opts.genre) return false;
    if (opts.decade != null && Math.floor(movie.year / 10) * 10 !== opts.decade) return false;
    if (opts.minRating != null && movie.rating < opts.minRating) return false;
    if (!needle) return true;
    return (
      movie.title.toLowerCase().includes(needle) ||
      movie.director.toLowerCase().includes(needle) ||
      movie.genre.toLowerCase().includes(needle) ||
      movie.country.toLowerCase().includes(needle) ||
      movie.tags.some((tag) => tag.includes(needle))
    );
  });

  const sorted = [...filtered];
  switch (opts.sort) {
    case "year":
      sorted.sort((a, b) => b.year - a.year);
      break;
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "runtime":
      sorted.sort((a, b) => b.runtimeMinutes - a.runtimeMinutes);
      break;
    default:
      sorted.sort((a, b) => b.rating - a.rating);
  }
  return sorted;
}

export function filterMovies(
  movies: readonly Movie[],
  query: string,
  genre: Genre | null,
): readonly Movie[] {
  return browseMovies(movies, { query, genre, sort: "rating", decade: null, minRating: null });
}

export function countByGenre(movies: readonly Movie[]): Record<Genre, number> {
  const empty = Object.fromEntries(GENRES.map((genre) => [genre, 0])) as Record<Genre, number>;
  return movies.reduce((counts, movie) => {
    counts[movie.genre] += 1;
    return counts;
  }, empty);
}

export function topRated(movies: readonly Movie[], limit = 3): Movie[] {
  return [...movies].sort((a, b) => b.rating - a.rating).slice(0, limit);
}

export function similarMovies(movies: readonly Movie[], movie: Movie, limit = 3): Movie[] {
  return movies
    .filter((candidate) => candidate.id !== movie.id)
    .sort((a, b) => {
      const score = (m: Movie) =>
        (m.genre === movie.genre ? 3 : 0) + (m.director === movie.director ? 2 : 0) + (m.country === movie.country ? 1 : 0);
      return score(b) - score(a);
    })
    .slice(0, limit);
}

export function totalHours(movies: readonly Movie[]): number {
  return Math.round(movies.reduce((sum, movie) => sum + movie.runtimeMinutes, 0) / 60);
}

export function averageRating(movies: readonly Movie[]): string {
  if (movies.length === 0) return "—";
  return (movies.reduce((sum, movie) => sum + movie.rating, 0) / movies.length).toFixed(1);
}

export function monogram(title: string): string {
  return title
    .replace(/[^a-zA-Z ]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}
