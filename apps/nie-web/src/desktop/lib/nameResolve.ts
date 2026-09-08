/** Desktop binding to the shared batched resolver; locale follows persisted settings. */
import { useResolvedNames as useSharedResolvedNames } from "@niers/inacord-ui/lib/resolved-names";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { wikiDb, type ResolvedName } from "@/lib/wikiDb";

const resolveNames = wikiDb.resolveManyByCode;
export function useResolvedNames(dbPath: string, codes: string[]): Map<string, ResolvedName> {
  const { locale } = useSettings();
  return useSharedResolvedNames(resolveNames, dbPath, locale, codes);
}
export function useResolvedName(dbPath: string, code: string | null): ResolvedName | null {
  const names = useResolvedNames(dbPath, code ? [code] : []);
  return code ? names.get(code) ?? null : null;
}
