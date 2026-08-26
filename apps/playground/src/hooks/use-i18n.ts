import { useAtomValue, useSetAtom } from "jotai";
import { localeAtom } from "../state/locale.js";
import type { Genre } from "../data/movies.js";
import {
  formatRuntimeLocalized,
  translate,
  translateFilmCount,
  translateGenre,
  type Locale,
  type TranslationKey,
} from "../data/translations.js";

export function useI18n() {
  const locale = useAtomValue(localeAtom);
  const setLocale = useSetAtom(localeAtom);

  return {
    locale,
    setLocale: (next: Locale) => setLocale(next),
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
    genre: (name: Genre) => translateGenre(locale, name),
    filmCount: (count: number) => translateFilmCount(locale, count),
    runtime: (minutes: number) => formatRuntimeLocalized(locale, minutes),
  };
}
