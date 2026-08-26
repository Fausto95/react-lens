import type { Genre, SortKey } from "../data/movies.js";

export type ViewMode = "list" | "grid" | "posters";

export type BrowseState = {
  genre: Genre | null;
  sort: SortKey;
  decade: number | null;
  minRating: number | null;
  view: ViewMode;
};

export type BrowseAction =
  | { type: "setGenre"; genre: Genre | null }
  | { type: "setSort"; sort: SortKey }
  | { type: "setDecade"; decade: number | null }
  | { type: "setMinRating"; minRating: number | null }
  | { type: "setView"; view: ViewMode }
  | { type: "reset" };

export const initialBrowseState: BrowseState = {
  genre: null,
  sort: "rating",
  decade: null,
  minRating: null,
  view: "grid",
};

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case "setGenre":
      return { ...state, genre: action.genre };
    case "setSort":
      return { ...state, sort: action.sort };
    case "setDecade":
      return { ...state, decade: action.decade };
    case "setMinRating":
      return { ...state, minRating: action.minRating };
    case "setView":
      return { ...state, view: action.view };
    case "reset":
      return initialBrowseState;
    default:
      return state;
  }
}
