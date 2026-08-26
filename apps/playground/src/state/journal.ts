export type ActivityKind = "saved" | "unsaved" | "status" | "opened" | "note";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  movieId: string;
  label: string;
  at: number;
  unread: boolean;
};

export type ActivityState = {
  events: ActivityEvent[];
};

export type ActivityAction =
  | { type: "push"; event: Omit<ActivityEvent, "id" | "at" | "unread"> }
  | { type: "read"; id: string }
  | { type: "readAll" }
  | { type: "clear" };

export const initialActivityState: ActivityState = { events: [] };

export function activityReducer(state: ActivityState, action: ActivityAction): ActivityState {
  switch (action.type) {
    case "push":
      return {
        events: [
          {
            ...action.event,
            id: `${action.event.movieId}-${Date.now()}`,
            at: Date.now(),
            unread: true,
          },
          ...state.events,
        ].slice(0, 40),
      };
    case "read":
      return {
        events: state.events.map((event) => (event.id === action.id ? { ...event, unread: false } : event)),
      };
    case "readAll":
      return { events: state.events.map((event) => ({ ...event, unread: false })) };
    case "clear":
      return initialActivityState;
    default:
      return state;
  }
}

export type NotesState = Record<string, string>;
export type NotesAction = { type: "set"; id: string; text: string };

export function notesReducer(state: NotesState, action: NotesAction): NotesState {
  if (action.type === "set") return { ...state, [action.id]: action.text };
  return state;
}
