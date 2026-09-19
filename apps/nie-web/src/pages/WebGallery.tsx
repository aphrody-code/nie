import { resolveResourceNames } from "../game/resource-names";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useAssetSource } from "@niers/inacord-ui";
import type { AssetSource } from "@niers/asset-source";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "@niers/inacord-ui/lib/browser-navigation";
import { GalleryView } from "@niers/inacord-ui/gallery/GalleryView";
import type { GalleryServices } from "@niers/inacord-ui/gallery/contracts";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { readableSize } from "./screen-parts";
import { splitLanguagePrefix } from "../routing";

/** Name hits expanded into VFS lookups. One exact, bounded catalogue page is requested per hit. */
const MAX_NAME_CODES = 12;

/**
 * Pages lues au plus pour UN code, soit 2 000 textures.
 *
 * La borne existe parce que douze codes sont interrogés de front : sans elle, un code
 * anormalement fourni ferait partir des centaines de requêtes pour enrichir une seule page de
 * résultats. Atteinte, elle tronque — mais alors le corpus a changé d'ordre de grandeur, et
 * c'est la borne qu'il faut relever, pas la lecture de `pages` qu'il fallait omettre.
 */
const PAGES_MAX_PAR_CODE = 10;

export interface WebGalleryFilterState {
 query: string;
 category: string | null;
 subfolder: string | null;
}

export function webGalleryFiltersFromUrl(input: string): WebGalleryFilterState {
 const params = new URL(input, "http://localhost").searchParams;
 return {
  query: params.get("q") ?? "",
  category: params.get("categorie"),
  subfolder: params.get("dossier"),
 };
}

export function webGalleryHrefForFilters(input: string, filters: WebGalleryFilterState): string {
 const url = new URL(input, "http://localhost");
 for (const [key, value] of [
  ["q", filters.query],
  ["categorie", filters.category],
  ["dossier", filters.subfolder],
 ] as const) {
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
 }
 return `${url.pathname}${url.search}${url.hash}`;
}

/** Open one gallery asset in the canonical localized texture catalogue. */
export function webGalleryTextureHref(input: string, path: string): string {
 const url = new URL(input, "http://localhost");
 const { prefix } = splitLanguagePrefix(url.pathname);
 url.pathname = `${prefix}/textures`;
 url.search = "";
 url.searchParams.set("q", path);
 return `${url.pathname}${url.search}`;
}

export function webGalleryFiltersForCategory(
 filters: WebGalleryFilterState,
 category: string | null,
): WebGalleryFilterState {
 return { ...filters, category, subfolder: category === filters.category ? filters.subfolder : null };
}

/** Build the web bindings separately so their URL/query contract can be tested without a DOM. */
export function createWebGalleryServices(
 source: AssetSource,
 onExportError: (failed: boolean) => void = () => undefined,
 locale = "fr",
): GalleryServices {
 async function imageBlob(path: string) {
  if (!source.urlTexture) throw new Error("Texture decoding is unavailable");
  const response = await fetch(source.urlTexture(path));
  if (!response.ok) throw new Error(`Texture unavailable (${response.status})`);
  return response.blob();
 }
 return {
  nameSource: "wiki-http",
  resolveNames: resolveResourceNames,
  async ls(prefix) {
   const result = await source.parcourir(prefix, { ext: "g4tx", parPage: 1 });
   return { dirs: result.dossiers.map(path => ({
    name: path.replace(/\/$/, "").split("/").pop()!,
    count: result.folderCounts?.[path] ?? 0,
   })) };
  },
  async findPaged(prefix, ext, limit, offset, _gameDir, query, signal) {
   if (!source.catalogue) throw new Error("Paged resource listing is unavailable");
   const pageSize = Math.min(200, Math.max(1, Math.floor(limit)));
   const requestedOffset = Math.max(0, Math.floor(offset));
   const page = Math.floor(requestedOffset / pageSize) + 1;
   const skip = requestedOffset % pageSize;
   const term = query?.trim() ?? "";
   const result = await source.catalogue("textures", {
    prefixe: prefix,
    ext,
    ...(term ? { q: term } : {}),
    page,
    parPage: pageSize,
    signal,
   });
   const pathFiles = result.elements.slice(skip).map(entry => ({ path: entry.chemin, size: entry.taille }));
   if (!term) return { files: pathFiles, total: result.total, offset: requestedOffset };

   // VFS `q` searches native paths. The game UI also searches its resolved visible labels, so
   // reverse the localized name to exact native codes and append only results that the path
   // query did not already own. Path matches stay first, making pagination stable.
   let namedFiles: { path: string; size: number }[] = [];
   try {
    const response = await fetch(`/api/v1/wiki/names/search?${new URLSearchParams({ q: term, locale, limit: String(MAX_NAME_CODES) })}`, { signal });
    if (response.ok) {
     const body = await response.json() as { records?: { code: string }[] };
     const codes = [...new Set((body.records ?? []).map(record => record.code).filter(Boolean))].slice(0, MAX_NAME_CODES);
     // `page: 1` était écrit en dur et `pages` ignoré : dès qu'un code portait plus de 200
     // textures, le reste disparaissait en silence — et `total`, calculé plus bas à partir de
     // cette liste, devenait faux, donc la pagination affichée aussi. La réponse est plafonnée
     // à `PER_PAGE_MAX` sans le dire autrement que par `pages`, alors on la lit. Le cas courant
     // reste UNE requête par code : `pages` vaut 1.
     const pages = await Promise.all(codes.map(async code => {
      const sorties: { path: string; size: number }[] = [];
      let total = 1;
      for (let page = 1; page <= total && page <= PAGES_MAX_PAR_CODE; page += 1) {
       const matches = await source.catalogue!("textures", {
        prefixe: prefix, ext, q: code, page, parPage: 200, signal,
       });
       total = Math.max(1, matches.pages);
       for (const entry of matches.elements) sorties.push({ path: entry.chemin, size: entry.taille });
      }
      return sorties;
     }));
     const lowerTerm = term.toLocaleLowerCase();
     const unique = new Map<string, { path: string; size: number }>();
     for (const file of pages.flat()) {
      if (!file.path.toLocaleLowerCase().includes(lowerTerm)) unique.set(file.path, file);
     }
     namedFiles = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    }
   } catch (error) {
    if (signal?.aborted) throw error;
    // Name enrichment is best-effort; native path results remain usable.
   }
   const total = result.total + namedFiles.length;
   const files = requestedOffset < result.total
    ? [...pathFiles, ...namedFiles.slice(0, Math.max(0, pageSize - pathFiles.length))]
    : namedFiles.slice(requestedOffset - result.total, requestedOffset - result.total + pageSize);
   return { files, total, offset: requestedOffset };
  },
  async gameDataGallery() {
   const records: Awaited<ReturnType<GalleryServices["gameDataGallery"]>> = [];
   let offset = 0;
   while (true) {
    const response = await fetch(`/api/v1/wiki/gallery?limit=200&offset=${offset}`);
    if (!response.ok) throw new Error("Gallery metadata is unavailable");
    const result = await response.json() as { total: number; records: {
     imgPath: string | null; thumbPath: string | null; needTokenNum: number | null;
    }[] };
    for (const row of result.records) records.push({
     img_path: row.imgPath ?? "", thumb_path: row.thumbPath ?? "",
     unlock_kind: row.needTokenNum === null ? "" : `Jetons requis : ${row.needTokenNum}`,
     story_episode: null,
    });
    offset += result.records.length;
    if (offset >= result.total) break;
    if (!result.records.length) throw new Error("Gallery metadata page is incomplete");
   }
   return records;
  },
  async texturePngB64(path) {
   const blob = await imageBlob(path);
   return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]!);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
   });
  },
  async exportPng(path) {
   onExportError(false);
   try {
    const blob = await imageBlob(path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image"}.png`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
   } catch { onExportError(true); }
  },
  formatBytes: readableSize,
 };
}

/** HTTP adapter for the same gallery used by the desktop explorer. */
export function WebGallery() {
 const source = useAssetSource();
 const settings = useSettings();
 const [exportError, setExportError] = useState(false);
 const services = useMemo(() => createWebGalleryServices(source, setExportError, settings.gameLocale), [source, settings.gameLocale]);
 const location = useSyncExternalStore(subscribeBrowserLocation, browserLocationSnapshot, browserLocationSnapshot);
 const { query, category, subfolder } = webGalleryFiltersFromUrl(location);
 const writeFilters = (patch: { query?: string; category?: string | null; subfolder?: string | null }) => {
  const values = {
   query: patch.query ?? query,
   category: patch.category === undefined ? category : patch.category,
   subfolder: patch.subfolder === undefined ? subfolder : patch.subfolder,
  };
  const url = new URL(webGalleryHrefForFilters(window.location.href, values), window.location.origin);
  writeBrowserHistory(url, window.history.state, "replace");
 };
 return <div className="h-[75vh] min-h-96">{exportError && <p role="alert">L’image n’a pas pu être exportée.</p>}<GalleryView services={services}
  query={query} category={category} subfolder={subfolder} serverSearch
  onQueryChange={value => writeFilters({ query: value })}
  onCategoryChange={value => {
   const next = webGalleryFiltersForCategory({ query, category, subfolder }, value);
   writeFilters({ category: next.category, subfolder: next.subfolder });
  }}
  onSubfolderChange={value => writeFilters({ subfolder: value })}
  onOpenFile={path => {
   const url = new URL(webGalleryTextureHref(window.location.href, path), window.location.origin);
   writeBrowserHistory(url, window.history.state, "push");
  }} /></div>;
}
