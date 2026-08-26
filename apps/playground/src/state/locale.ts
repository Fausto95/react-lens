import { atom, createStore } from "jotai";
import { createStoreAdapter, registerStores } from "@reactlens/adapters";
import { DEFAULT_LOCALE, type Locale } from "../data/translations.js";
import { recentQueriesAtom } from "./search.js";

export const localeAtom = atom<Locale>(DEFAULT_LOCALE);

export const localeStore = createStore();

if (import.meta.env.DEV) {
  registerStores(
    createStoreAdapter<{ locale: Locale; recents: string[] }>({
      id: "locale",
      get: () => ({
        locale: localeStore.get(localeAtom),
        recents: localeStore.get(recentQueriesAtom),
      }),
      set: (snapshot) => {
        localeStore.set(localeAtom, snapshot.locale);
        localeStore.set(recentQueriesAtom, snapshot.recents);
      },
    }),
  );
}
