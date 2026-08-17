# External stores

Time travel restores `useState`, `useReducer` and class state on its own. State
that lives outside React — Zustand, Redux, TanStack Query, a module singleton —
is opt-in: register an adapter and it follows the playhead too.

Registration is explicit on purpose. React Lens cannot rewind a
`useSyncExternalStore` hook generically: overriding the hook's value would
revert on the store's next notification, and the store itself would still hold
the live state. The adapter gives it the store's own get/set instead.

```bash
npm i -D @reactlens/adapters
```

Everything below is dev-only. With no React Lens running, `registerStores`
resolves to a stub, costs one array entry and never throws — so the
`import.meta.env.DEV` guard is about intent, not safety.

## Zustand

```ts
import { registerStores, zustandAdapter } from "@reactlens/adapters";
import { useCartStore } from "./cart";

if (import.meta.env.DEV) {
  registerStores(zustandAdapter(useCartStore, { id: "cart" }));
}
```

Restores with `setState(snapshot, true)` — a replace, not a merge, so keys added
after the snapshot are dropped rather than left behind as state the app never
had. Actions live in the state object, so they ride along in the snapshot and
stay callable after a rewind. Subscribers are notified, so every `useStore`
component re-renders.

## Redux

Redux state can only move through a reducer, so the root reducer has to let the
rewind in:

```ts
import { configureStore } from "@reduxjs/toolkit";
import { registerStores, reduxAdapter, withTimeTravel } from "@reactlens/adapters";

export const store = configureStore({
  reducer: import.meta.env.DEV ? withTimeTravel(rootReducer) : rootReducer,
});

if (import.meta.env.DEV) {
  registerStores(reduxAdapter(store, { id: "app" }));
}
```

`withTimeTravel` answers one action type (`@reactlens/HYDRATE` by default,
overridable — pass the same value to both sides) and delegates everything else
to the wrapped reducer. Forget it and the adapter throws a named error on the
first restore rather than leaving the playhead silently doing nothing.

## TanStack Query

`dehydrate`/`hydrate` come from the app's own installed version, so React Lens
never pins or duplicates the library:

```ts
import { dehydrate, hydrate } from "@tanstack/react-query";
import { registerStores, queryAdapter } from "@reactlens/adapters";

if (import.meta.env.DEV) {
  registerStores(queryAdapter({ queryClient, dehydrate, hydrate, id: "query" }));
}
```

The default mode clears the cache before hydrating. That is not incidental:
`hydrate` keeps whichever copy is newer, so a merge cannot move a query the app
has since updated back to its old value — it can only backfill queries the cache
has lost. Pass `mode: "merge"` for a non-destructive scrub, knowing restores are
then partial. In either mode, observers on cleared keys refetch, and only what
`dehydrate` includes is restored (by default successful queries — not mutations,
errors or pending fetches).

## Anything else

`createStoreAdapter` is the seam every shipped adapter wraps. Jotai, for
example, has no public API to enumerate a store's atoms, so name the ones worth
rewinding:

```ts
import { createStoreAdapter, registerStores } from "@reactlens/adapters";
import { store, filterAtom, sortAtom } from "./state";

const atoms = { filter: filterAtom, sort: sortAtom };

registerStores(
  createStoreAdapter({
    id: "jotai",
    get: () => Object.fromEntries(Object.entries(atoms).map(([k, a]) => [k, store.get(a)])),
    set: (snap) => {
      for (const [k, a] of Object.entries(atoms)) store.set(a, snap[k]);
    },
  }),
);
```

A module singleton is the same shape: `get` returns the value, `set` writes it
back and notifies whatever the app subscribes with.

## Styles that live outside React

A className or inline style computed from `useState` rewinds on its own — that
is just React state, and the specimen matrix in `apps/e2e-fixture` proves it for
static classes, inline style objects, Emotion's runtime classes and effects that
write `el.style`, compiled and uncompiled alike.

What does not rewind is styling driven from outside React: a colour mode written
to `documentElement`, a CSS variable set by a module singleton, a motion value.
Those are stores like any other, so the same seam opts them in:

```ts
let mode: "light" | "dark" = "light";
const listeners = new Set<() => void>();

export const colorMode = {
  get: () => mode,
  set(next: "light" | "dark") {
    mode = next;
    document.documentElement.dataset.theme = next;
    for (const l of listeners) l();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

if (import.meta.env.DEV) {
  registerStores(createStoreAdapter({ id: "color-mode", get: colorMode.get, set: colorMode.set }));
}
```

The `set` does the same work the app does, so the DOM write follows the playhead
with it. The same shape covers a framer-motion `MotionValue` (`get()` / `set()`)
or any imperative writer you own.

Two things no adapter fixes, and the panel now tells you about both:

- **Transitions and animations.** A rewind is not an interaction, so the panel
  suppresses the page's transitions while traveling ("snap", on by default, next
  to the rewind toggle). Turn it off when the animation itself is what you are
  debugging — and expect styles to lag the playhead by the transition's duration
  while it is off.
- **Anything the panel cannot write.** Once a scrub settles, the page's DOM is
  compared against what was captured at that cursor; a disagreement appears in
  the restore chip as "page differs", naming the attributes involved. It is
  quiet by design — commit DOM is captured at most once per 250ms, so it only
  speaks when a capture sits close enough to the cursor to be evidence.

## What to expect

- **Snapshots are taken per commit**, bounded to the last 200 per store
  (`TIME_TRAVEL_RETENTION.snapshotsPerStore`). Commits that leave a store
  untouched produce a reference-identical snapshot and do not consume
  retention, so an expensive `getSnapshot` such as Query's `dehydrate` is not
  charged for idle commits.
- **Snapshots must be immutable**, or at least safe to re-apply. A snapshot the
  app keeps mutating is not a snapshot of the past.
- **Scrubbing before a store's first snapshot** cannot restore it. The restore
  pill names it: `cart — no snapshot this far back`.
- **Values never leave the page.** The panel only sends component/render ids and
  the cursor time; snapshots stay in the page runtime.
- **An adapter that throws** is reported as a failed restore for that store and
  surfaces as an error in the panel; the other stores still apply.
- **Registering is idempotent per id.** Re-registering under the same id
  replaces the previous adapter, and the old unregister becomes a no-op — hot
  reload is safe.

`registerStores` returns one disposer for every adapter it registered; call it
from a hot-reload dispose handler if the module owning the store is replaced.

## Under the hood

`registerStores` talks to `window.__REACT_LENS__`, installed by whichever host
is capturing — the extension's MAIN-world bridge at `document_start`, or the
embedded runtime at construction. Registrations made before a host installs are
queued and adopted, so import order does not matter.
