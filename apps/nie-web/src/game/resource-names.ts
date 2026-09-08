import type { NameResolver, ResolvedName } from "@niers/inacord-ui/lib/resolved-names";
import { useResolvedNames, nameWithId } from "@niers/inacord-ui/lib/resolved-names";
import { useSettings } from "@niers/inacord-ui/lib/settings";

export const resolveResourceNames: NameResolver = async (_source, codes, locale) => {
    const names = new Map<string, ResolvedName>();
    const unique = [...new Set(codes)];
    for (let index = 0; index < unique.length; index += 200) {
     const params = new URLSearchParams({ locale, codes: unique.slice(index, index + 200).join(",") });
     const response = await fetch(`/api/v1/wiki/names?${params}`);
     if (!response.ok) throw new Error("Resource names are unavailable");
     const result = await response.json() as { records: { code: string; kind: "chara" | "skill" | "item" | "tactic" | "team" | "keshin" | "soul"; id: string; name: string }[] };
     for (const row of result.records) {
      if (!names.has(row.code)) {
       names.set(row.code, { kind: row.kind, id: row.id, name: row.name, extra: null });
      }
     }
    }
    return names;
   };

export function resourceCode(path: string): string {
 return path.split("/").pop()!.replace(/\.[^.]+$/, "");
}
export function useResourceNames(paths: string[]) {
 const { locale } = useSettings();
 return useResolvedNames(resolveResourceNames, "wiki-http", locale, paths.map(resourceCode));
}
export function resourceLabel(path: string, names: Map<string, ResolvedName>): string {
 const code = resourceCode(path);
 const resolved = names.get(code);
 return resolved ? nameWithId(resolved.name, resolved.id && resolved.id !== code ? `${code} / ${resolved.id}` : code) : path.split("/").pop()!;
}
