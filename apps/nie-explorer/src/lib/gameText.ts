// Table de localisation FR/EN/JA du JEU lui-même (hash Level-5 -> chaîne traduite),
// importée depuis azalee (public/locales/{fr,en,ja}.json — mêmes fichiers que le wiki,
// eux-mêmes extraits du texte du jeu). Distinct de `i18n.tsx` (chrome de l'appli niers) :
// ici les clés sont les hash `0xXXXXXXXX` référencés par les formats G4/T2B/RDBN du jeu
// (menus, descriptions de stats, noms…), pas des libellés d'interface.
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import type { Locale } from "@/lib/settings";

type GameDict = Record<string, string>;

const cache = new Map<Locale, GameDict>();
const inFlight = new Map<Locale, Promise<GameDict>>();

function loadDict(locale: Locale): Promise<GameDict> {
  const cached = cache.get(locale);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(locale);
  if (pending) return pending;

  const p = fetch(`/locales/${locale}.json`)
    .then((r) => r.json() as Promise<GameDict>)
    .then((dict) => {
      cache.set(locale, dict);
      inFlight.delete(locale);
      return dict;
    })
    .catch((e) => {
      inFlight.delete(locale);
      throw e;
    });
  inFlight.set(locale, p);
  return p;
}

export interface GameText {
  /** Résout un hash Level-5 (`"0x66B0C3B4"`, ou number) vers la chaîne localisée du jeu. */
  t: (hash: string | number | null | undefined) => string;
  /** Pareil que la wiki azalee : cherche `${fieldPrefix}_${LOCALE}`, repli FR puis champ nu. */
  getLocalized: (obj: Record<string, unknown> | null | undefined, fieldPrefix?: string) => string;
  loading: boolean;
}

/** Hook réactif : recharge le dictionnaire du jeu quand `settings.locale` change (mis en cache). */
export function useGameText(): GameText {
  const { locale } = useSettings();
  const [dict, setDict] = useState<GameDict>(() => cache.get(locale) ?? {});
  const [loading, setLoading] = useState(!cache.has(locale));

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(locale);
    if (cached) {
      setDict(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadDict(locale)
      .then((d) => {
        if (!cancelled) {
          setDict(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const t = (hash: string | number | null | undefined) => {
    if (hash === null || hash === undefined) return "";
    const key = String(hash);
    return dict[key] ?? key;
  };

  const getLocalized = (obj: Record<string, unknown> | null | undefined, fieldPrefix = "name") => {
    if (!obj) return "";
    const suffix = locale.toUpperCase();
    const target = obj[`${fieldPrefix}_${suffix}`];
    if (typeof target === "string" && target) return target;
    const fallbackFr = obj[`${fieldPrefix}_FR`];
    if (typeof fallbackFr === "string" && fallbackFr) return fallbackFr;
    const plain = obj[fieldPrefix];
    return typeof plain === "string" ? plain : "";
  };

  return { getLocalized, loading, t };
}
