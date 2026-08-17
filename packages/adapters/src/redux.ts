import type { TimeTravelStoreAdapter } from "@reactlens/protocol";
import { createStoreAdapter } from "./register.js";

/** Default action type carrying a rewound state tree. */
export const REDUX_HYDRATE = "@reactlens/HYDRATE";

export interface ActionLike {
  type: string;
}

export type ReducerLike<S, A extends ActionLike = ActionLike> = (
  state: S | undefined,
  action: A,
) => S;

/**
 * The part of a Redux store this adapter needs — structural, so there is no
 * dependency on redux and Redux Toolkit stores work unchanged.
 */
export interface ReduxLikeStore<S> {
  getState(): S;
  dispatch(action: { type: string; payload?: unknown }): unknown;
}

/**
 * Wrap the root reducer so React Lens can restore a state tree. Required:
 * Redux state can only change through a reducer, so without this the playhead
 * has no way in.
 *
 *     const store = configureStore({ reducer: withTimeTravel(rootReducer) })
 *
 * In production the wrapper is a single string comparison per action, but
 * nothing dispatches the hydrate action unless React Lens is running.
 */
export function withTimeTravel<S, A extends ActionLike>(
  reducer: ReducerLike<S, A>,
  actionType: string = REDUX_HYDRATE,
): ReducerLike<S, A> {
  return (state, action) => {
    if (action.type === actionType) return (action as unknown as { payload: S }).payload;
    return reducer(state, action);
  };
}

/**
 * Rewind a Redux store with the playhead. Pair with `withTimeTravel` on the
 * root reducer, using the same `actionType` if you override it.
 */
export function reduxAdapter<S>(
  store: ReduxLikeStore<S>,
  options: { id?: string; actionType?: string } = {},
): TimeTravelStoreAdapter {
  const actionType = options.actionType ?? REDUX_HYDRATE;
  return createStoreAdapter<S>({
    id: options.id ?? "redux",
    get: () => store.getState(),
    set: (snapshot) => {
      store.dispatch({ type: actionType, payload: snapshot });
      // An unwrapped reducer ignores the hydrate action and leaves the state
      // untouched. Failing loudly beats a playhead that silently does nothing:
      // the restore is reported as failed and the cause is named.
      if (!Object.is(store.getState(), snapshot)) {
        throw new Error(
          `[react-lens] the "${actionType}" action did not reach the store. ` +
            `Wrap the root reducer with withTimeTravel() from @reactlens/adapters.`,
        );
      }
    },
  });
}
