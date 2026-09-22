import { resolveResourceNames } from "../game/resource-names";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useAssetSource } from "@nie/inacord-ui";
import type { AssetSource } from "@nie/asset-source";
import { browserLocationSnapshot, subscribeBrowserLocation, writeBrowserHistory } from "@nie/inacord-ui/lib/browser-navigation";
import { GALLERY_PAGE_SIZE, GalleryView } from "@nie/inacord-ui/gallery/GalleryView";
import type { GalleryServices } from "@nie/inacord-ui/gallery/contracts";
import { useSettings } from "@nie/inacord-ui/lib/settings";
import { readableSize } from "./screen-parts";
import { splitLanguagePrefix } from "../routing";
import { fetchJson } from "@nie/asset-source";
import { downloadExport, fetchExportFormats } from "../game/export-formats";

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

export interface TextureDomain {
 id: string;
 label: string;
 prefix: string;
 count: number;
}

/**
 * Les six arbres de textures du jeu — une **partition**, pas une sélection.
 *
 * Les préfixes sont disjoints et leurs comptes s'additionnent exactement aux 54 203 `.g4tx`
 * relevés sur le VFS de référence (`nie vfs find --ext g4tx`, 2026-09-20), ce que
 * `WebGallery.test.ts` vérifie plutôt que de le croire. C'est délibéré : la version précédente
 * offrait `Illustrations` (220_img) et `Icônes` (200_icon) comme deux domaines de premier rang
 * et laissait les **44 autres dossiers de `data/dx11/menu`** — 4 570 textures, les écrans de
 * match, de victoire, de titre, d'avatar — hors de toute combinaison de filtres. Deux pastilles
 * dont les comptes se lisent comme une somme ne peuvent pas non plus dire qu'il en manque.
 *
 * Les deux anciens domaines restent des URL valides : ils sont traduits en catégorie du domaine
 * `menu` par [`DOMAIN_ALIASES`], donc un lien existant ouvre exactement la même grille.
 */
export const TEXTURE_DOMAINS: readonly TextureDomain[] = [
 { id: "menu", label: "Menus", prefix: "data/dx11/menu", count: 41191 },
 { id: "characters", label: "Personnages", prefix: "data/dx11/chr", count: 9727 },
 { id: "effects", label: "Effets", prefix: "data/dx11/effect", count: 1995 },
 { id: "maps", label: "Décors & Cartes", prefix: "data/dx11/map", count: 1240 },
 { id: "fonts", label: "Polices", prefix: "data/dx11/font", count: 34 },
 { id: "events", label: "Événements", prefix: "data/dx11/event", count: 16 },
] as const;

/** Total mesuré des `.g4tx` du jeu — la borne que la partition doit atteindre, pas approcher. */
export const TEXTURE_TOTAL = 54203;

/**
 * Domaines d'une version antérieure, traduits en `domaine` + `categorie` du domaine qui les
 * contient. Un lien partagé ou un signet continue d'ouvrir la même grille.
 */
export const DOMAIN_ALIASES: Readonly<Record<string, { domain: string; category: string }>> = {
 illustrations: { domain: "menu", category: "220_img" },
 icons: { domain: "menu", category: "200_icon" },
};

/** Domaine ouvert quand l'URL n'en nomme aucun — le plus fourni, et celui des illustrations. */
export const DOMAIN_DEFAULT = "menu";

export function rootPrefixForDomain(domain?: string | null): string {
 const alias = domain ? DOMAIN_ALIASES[domain] : undefined;
 const id = alias?.domain ?? domain;
 const found = TEXTURE_DOMAINS.find(d => d.id === id);
 return found ? found.prefix : TEXTURE_DOMAINS[0]!.prefix;
}

export interface WebGalleryFilterState {
 query: string;
 category: string | null;
 subfolder: string | null;
 domain?: string | null;
 view?: "editorial" | null;
 page?: number;
}

export function webGalleryFiltersFromUrl(input: string): WebGalleryFilterState {
 const params = new URL(input, "http://localhost").searchParams;
 const domain = params.get("domaine");
 const alias = domain ? DOMAIN_ALIASES[domain] : undefined;
 return {
  query: params.get("q") ?? "",
  // Un alias porte SA catégorie : `?domaine=illustrations` doit rendre 220_img, pas la racine
  // des menus. Une catégorie explicite dans l'URL reste prioritaire — elle est plus précise.
  category: params.get("categorie") ?? alias?.category ?? null,
  subfolder: params.get("dossier"),
  ...(alias ? { domain: alias.domain } : domain ? { domain } : {}),
  ...(params.get("view") === "editorial" ? { view: "editorial" as const } : {}),
  ...(Number.isSafeInteger(Number(params.get("page"))) && Number(params.get("page")) > 1
   ? { page: Number(params.get("page")) }
   : {}),
 };
}

export function webGalleryHrefForFilters(input: string, filters: WebGalleryFilterState): string {
 const url = new URL(input, "http://localhost");
 for (const [key, value] of [
  ["q", filters.query],
  ["categorie", filters.category],
  ["dossier", filters.subfolder],
  ["domaine", filters.domain && filters.domain !== DOMAIN_DEFAULT ? filters.domain : null],
  ["view", filters.view === "editorial" ? "editorial" : null],
  ["page", filters.page && filters.page > 1 ? String(filters.page) : null],
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

export function webGalleryFiltersForDomain(
 filters: WebGalleryFilterState,
 domain: string | null,
): WebGalleryFilterState {
 const { view: _view, ...withoutView } = filters;
 return {
  ...withoutView,
  domain: domain && domain !== DOMAIN_DEFAULT ? domain : undefined,
  category: null,
  subfolder: null,
 };
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
  // La conversion est celle de `nie-site`, pas une réencodage local : le serveur seul sait ce
  // qu'il sait produire d'un `.g4tx`, et il le déclare fichier par fichier.
  exportFormats: (path, _gameDir) => fetchExportFormats(path),
  exportAs: (path, format, _gameDir) => downloadExport(path, format),
  async ls(prefix) {
   const result = await source.parcourir(prefix, { ext: "g4tx", parPage: 1 });
   return { dirs: result.dossiers.map(path => ({
    name: path.replace(/\/$/, "").split("/").pop()!,
    count: result.folderCounts?.[path] ?? 0,
   })) };
  },
  async findPaged(prefix, ext, limit, offset, _gameDir, query, signal, sort) {
   if (!source.catalogue) throw new Error("Paged resource listing is unavailable");
   const pageSize = Math.min(200, Math.max(1, Math.floor(limit)));
   const requestedOffset = Math.max(0, Math.floor(offset));
   const page = Math.floor(requestedOffset / pageSize) + 1;
   const skip = requestedOffset % pageSize;
   const term = query?.trim() ?? "";
   // `/api/v1/recherche` nomme ses critères en français (`tri=nom|taille`, `ordre=asc|desc`) ;
   // le contrat du composant les nomme en anglais. La traduction se fait ICI, au seul endroit
   // qui connaît les deux vocabulaires.
   const ordering = sort ? { tri: sort.by === "size" ? "taille" as const : "nom" as const, ordre: sort.order } : {};
   const result = await source.catalogue("textures", {
    prefixe: prefix,
    ext,
    ...(term ? { q: term } : {}),
    ...ordering,
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
    const body = await fetchJson<{ records?: { code: string }[] }>(
     `/api/v1/wiki/names/search?${new URLSearchParams({ q: term, locale, limit: String(MAX_NAME_CODES) })}`,
     { signal, retries: 1 }
    );
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
  async editorialPage(category, limit, offset, query, signal) {
   const params = new URLSearchParams({
    view: "editorial",
    limit: String(Math.min(200, Math.max(1, Math.floor(limit)))),
    offset: String(Math.max(0, Math.floor(offset))),
   });
   if (category) params.set("category", category);
   if (query?.trim()) params.set("q", query.trim());
   const result = await fetchJson<{
    total: number;
    offset: number;
    records: { vfsPath?: string; id: string }[];
    categories?: { id: string; count: number }[];
   }>(`/api/v1/wiki/gallery?${params}`, { signal, timeoutMs: 15_000, retries: 2 });
   return {
    files: result.records.flatMap(record => record.vfsPath
     ? [{ path: record.vfsPath, size: 0 }]
     : []),
    total: result.total,
    offset: result.offset,
    categories: (result.categories ?? []).map(row => ({ name: row.id, count: row.count })),
   };
  },
  async gameDataGallery() {
   const records: Awaited<ReturnType<GalleryServices["gameDataGallery"]>> = [];
   let offset = 0;
   while (true) {
    const result = await fetchJson<{ total: number; records: {
     imgPath: string | null; thumbPath: string | null; needTokenNum: number | null;
    }[] }>(`/api/v1/wiki/gallery?limit=200&offset=${offset}`, { timeoutMs: 15_000, retries: 2 })
     .catch(() => { throw new Error("Gallery metadata is unavailable"); });
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
 const { query, category, subfolder, domain, view, page } = webGalleryFiltersFromUrl(location);
 const editorial = view === "editorial";
 const activeDomain = domain ?? DOMAIN_DEFAULT;
 const writeFilters = (patch: { query?: string; category?: string | null; subfolder?: string | null; domain?: string | null; view?: "editorial" | null; page?: number }) => {
  const values = {
   query: patch.query ?? query,
   category: patch.category === undefined ? category : patch.category,
   subfolder: patch.subfolder === undefined ? subfolder : patch.subfolder,
   domain: patch.domain === undefined ? domain : patch.domain,
   view: patch.view === undefined ? view : patch.view,
   page: patch.page === undefined ? page : patch.page,
  };
  const url = new URL(webGalleryHrefForFilters(window.location.href, values), window.location.origin);
  writeBrowserHistory(url, window.history.state, "replace");
 };
 return (
  <div className="flex h-[82vh] min-h-96 flex-col">
   <div className="flex flex-wrap items-center gap-1.5 border-b border-app-line pb-2 mb-2" role="tablist" aria-label="Domaines de textures">
    <button
     role="tab"
     aria-selected={editorial}
     type="button"
     className={`state-layer rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
      editorial ? "border-primary bg-primary text-on-primary" : "border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
     }`}
     onClick={() => writeFilters({ view: "editorial", domain: null, category: null, subfolder: null, page: 1 })}
    >
     Illustrations
    </button>
    {TEXTURE_DOMAINS.map(d => {
     const active = !editorial && activeDomain === d.id;
     return (
      <button
       key={d.id}
       role="tab"
       aria-selected={active}
       type="button"
       className={`state-layer rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active
         ? "border-primary bg-primary text-on-primary"
         : "border-outline-variant/30 text-on-surface-variant hover:text-on-surface"
       }`}
       onClick={() => {
        const next = webGalleryFiltersForDomain({ query, category, subfolder, domain, view, page }, d.id);
        writeFilters({ domain: next.domain, category: null, subfolder: null, view: null, page: 1 });
       }}
      >
       {d.label}
       <span className="ml-1.5 opacity-70 text-xs">({d.count.toLocaleString(settings.locale)})</span>
      </button>
     );
    })}
   </div>
   {exportError && <p role="alert">L’image n’a pas pu être exportée.</p>}
   <div className="min-h-0 flex-1">
    <GalleryView
     services={services}
     rootPrefix={rootPrefixForDomain(domain)}
     editorial={editorial}
     initialOffset={editorial ? ((page ?? 1) - 1) * GALLERY_PAGE_SIZE : 0}
     query={query}
     category={category}
     subfolder={subfolder}
     serverSearch
     onQueryChange={value => writeFilters({ query: value, page: 1 })}
     onCategoryChange={value => {
      const next = webGalleryFiltersForCategory({ query, category, subfolder, domain, view, page }, value);
      writeFilters({ category: next.category, subfolder: next.subfolder, page: 1 });
     }}
     onSubfolderChange={value => writeFilters({ subfolder: value })}
     onOpenFile={path => {
      const url = new URL(webGalleryTextureHref(window.location.href, path), window.location.origin);
      writeBrowserHistory(url, window.history.state, "push");
     }}
    />
   </div>
  </div>
 );
}
