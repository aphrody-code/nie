import { describe, expect, test } from "bun:test";
import {
  explorerLocationHref,
  explorerSearchFiltersFromUrl,
  explorerSearchIsActive,
  explorerSearchUrl,
  fetchExplorerSearchPage,
  type ExplorerSearchFilters,
} from "./ExplorerView";

const exhaustive: ExplorerSearchFilters = {
  q: "chara base",
  ext: "g4tx",
  prefixe: "data/dx11/menu",
  glob: "data/**,!**/movie/**",
  cpk: "common.cpk",
  tailleMin: 0,
  tailleMax: 4096,
  sort: "taille",
  order: "desc",
  page: 3,
  perPage: 200,
};

describe("Explorer VFS server filters", () => {
  test("restores every shareable control from the browser URL", () => {
    expect(explorerSearchFiltersFromUrl(
      "?q=chara+base&ext=.g4tx&prefixe=data%2Fdx11%2Fmenu&glob=data%2F**%2C!**%2Fmovie%2F**&cpk=common.cpk&taille_min=0&taille_max=4096&tri=taille&ordre=desc&page=3",
    )).toEqual(exhaustive);

    expect(explorerSearchFiltersFromUrl("?taille_min=-1&taille_max=nope&page=0")).toEqual({
      q: "",
      ext: "",
      prefixe: "",
      glob: "",
      cpk: "",
      tailleMin: undefined,
      tailleMax: undefined,
      sort: "nom",
      order: "asc",
      page: 1,
      perPage: 200,
    });
		expect(explorerSearchFiltersFromUrl("?per_page=50").perPage).toBe(50);
		expect(explorerSearchFiltersFromUrl("?per_page=999").perPage).toBe(200);
  });

  test("serializes a request that the same URL parser can restore", () => {
    const url = new URL(explorerSearchUrl(exhaustive), "https://nie.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "chara base",
      ext: "g4tx",
      prefixe: "data/dx11/menu",
      glob: "data/**,!**/movie/**",
      cpk: "common.cpk",
      taille_min: "0",
      taille_max: "4096",
      tri: "taille",
      ordre: "desc",
      page: "3",
      per_page: "200",
    });
    expect(explorerSearchFiltersFromUrl(url.search)).toEqual(exhaustive);

    const href = explorerLocationHref("https://nie.test/explorateur?panel=details#selection", exhaustive);
    const location = new URL(href, "https://nie.test");
    expect(location.pathname).toBe("/explorateur");
    expect(location.searchParams.get("panel")).toBe("details");
    expect(location.hash).toBe("#selection");
    expect(explorerSearchFiltersFromUrl(location.search)).toEqual(exhaustive);
  });

  test("keeps sort-only changes on the current folder instead of starting a global search", () => {
    expect(explorerSearchIsActive({ ...exhaustive, q: "", ext: "", prefixe: "", glob: "", cpk: "", tailleMin: undefined, tailleMax: undefined })).toBeFalse();
    expect(explorerSearchIsActive({ ...exhaustive, q: "mark" })).toBeTrue();
  });

  test("transmits every control and maps the paginated server response", async () => {
    let requested = "";
    const request = Object.assign(async (input: RequestInfo | URL) => {
      requested = String(input);
      return Response.json({
        fichiers: [{ chemin: "data/dx11/menu/icon.g4tx", nom: "icon.g4tx", taille: 128 }],
        total: 401,
        page: 3,
        per_page: 200,
        filtres: {
          q: "chara base", ext: "g4tx", cpk: "common.cpk", taille_min: 0,
          taille_max: 4096, tri: "taille", ordre: "desc", prefixe: "data/dx11/menu",
          glob: "data/**,!**/movie/**", glob_vide: false, ext_inconnue: false,
          cpk_inconnu: false,
        },
      });
    }, { preconnect: globalThis.fetch.preconnect });

    const page = await fetchExplorerSearchPage(exhaustive, undefined, request);
    expect(Object.fromEntries(new URL(requested, "https://nie.test").searchParams)).toEqual({
      q: "chara base",
      ext: "g4tx",
      prefixe: "data/dx11/menu",
      glob: "data/**,!**/movie/**",
      cpk: "common.cpk",
      taille_min: "0",
      taille_max: "4096",
      tri: "taille",
      ordre: "desc",
      page: "3",
      per_page: "200",
    });
    expect(page).toEqual({
      files: [{ path: "data/dx11/menu/icon.g4tx", name: "icon.g4tx", size: 128 }],
      total: 401,
      page: 3,
      pages: 3,
      applied: {
        q: "chara base", ext: "g4tx", cpk: "common.cpk", taille_min: 0,
        taille_max: 4096, tri: "taille", ordre: "desc", prefixe: "data/dx11/menu",
        glob: "data/**,!**/movie/**", glob_vide: false, ext_inconnue: false,
        cpk_inconnu: false,
      },
    });
  });
});
