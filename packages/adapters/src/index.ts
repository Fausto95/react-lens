export { createStoreAdapter, registerStore, registerStores } from "./register.js";
export { zustandAdapter, type ZustandLikeStore } from "./zustand.js";
export {
  reduxAdapter,
  withTimeTravel,
  REDUX_HYDRATE,
  type ReduxLikeStore,
  type ReducerLike,
  type ActionLike,
} from "./redux.js";
export { queryAdapter, type QueryClientLike, type QueryAdapterOptions } from "./query.js";
export type { TimeTravelStoreAdapter } from "@reactlens/protocol";
