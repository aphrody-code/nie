import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Modeles3D,
  modelFilterStateFromUrl,
  modelHrefForFilters,
} from "./Models3D";

let root: Root | null;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;
let requests: string[];

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

const capabilities = {
  amont: "test",
  vfs_pret: true,
  miroir_present: true,
  moteur: {
    focale: 1,
    distance: 3,
    tilt: 0.2,
    taille_defaut: 256,
    taille_max: 1024,
    simultanes: 1,
  },
  familles: [
    {
      segment: "perso",
      libelle: "Personnages",
      source: "miroir",
      dossier: null,
      total: 10,
      verifie: true,
    },
    {
      segment: "objet",
      libelle: "Objets",
      source: "vfs",
      dossier: null,
      total: 8,
      verifie: true,
    },
  ],
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

async function waitForRequest(
  fragment: string,
  previousCount = 0,
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      requests.filter((request) => request.includes(fragment)).length >
      previousCount
    )
      return;
    await settle();
  }
  throw new Error(`request not observed: ${fragment}`);
}

beforeEach(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  (
    window as unknown as { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("http://localhost:3000/modeles");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  requests = [];
  const respond = Object.assign(
    async (input: RequestInfo | URL) => {
      const value =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requests.push(value);
      const url = new URL(value, window.location.origin);
      if (url.pathname === "/api/v1/3d") return Response.json(capabilities);
      if (url.pathname === "/api/v1/3d/modeles") {
        return Response.json({
          elements: [],
          page: Number(url.searchParams.get("page")),
          per_page: 24,
          total: 48,
          pages: 6,
        });
      }
      if (url.pathname === "/api/v1/3d/modeles/objet/o0000100") {
        return Response.json({
          modele: {
            code: "o0000100",
            famille: "objet",
            nom: null,
            fichiers: 3,
            glb: "/model/objet/o0000100.glb",
            apercu: "/model/objet/o0000100.png",
          },
        });
      }
      return new Response(null, { status: 404 });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(respond);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  fetchMock.mockRestore();
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("model catalogue URL state", () => {
  test("keeps mobile filters, title and pagination inside the content column", () => {
    const css = readFileSync(
      new URL("./models-3d.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain(".models-3d-page > h2");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)",
    );
    expect(css).toContain(".models-3d-pagination > button");
  });

  test("parses and serializes family, search and page without unrelated filters", () => {
    expect(
      modelFilterStateFromUrl("?famille=objet&q=ballon&page=4&per_page=48"),
    ).toEqual({
      family: "objet",
      q: "ballon",
      page: 4,
      perPage: 48,
      view: "grid",
      model: null,
    });
    expect(modelFilterStateFromUrl("?famille=&page=-3")).toEqual({
      family: "perso",
      q: "",
      page: 1,
      perPage: 24,
      view: "grid",
      model: null,
    });
    expect(modelFilterStateFromUrl("?par_page=12").perPage).toBe(12);
    expect(modelFilterStateFromUrl("?par_page=12&per_page=36").perPage).toBe(
      36,
    );
    expect(
      modelHrefForFilters(
        "https://nie.test/modeles?par_page=12",
        modelFilterStateFromUrl("?par_page=12"),
      ),
    ).toBe("/modeles?per_page=12");
    expect(
      modelHrefForFilters(
        "https://nie.test/ja/modeles?vue=textures&tri=taille",
        { family: "objet", q: "ballon", page: 4, perPage: 48, view: "grid", model: null },
      ),
    ).toBe("/ja/modeles?famille=objet&q=ballon&page=4&per_page=48");
    expect(
      modelHrefForFilters(
        "https://nie.test/modeles?affichage=liste&modele=old",
        modelFilterStateFromUrl("?famille=objet&affichage=liste&modele=o0000100"),
      ),
    ).toBe("/modeles?famille=objet&view=list&model=o0000100");
  });

  test("uses the URL after popstate and again after a remount", async () => {
    window.history.replaceState(
      null,
      "",
      "/modeles?famille=objet&q=ballon&page=3",
    );
    await act(async () => root?.render(<Modeles3D />));
    await waitForRequest("famille=objet&page=3&per_page=24&q=ballon");
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("ballon");

    window.history.pushState(null, "", "/modeles?q=mark&page=2");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await waitForRequest("famille=perso&page=2&per_page=24&q=mark");
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("mark");

    window.history.replaceState(
      null,
      "",
      "/modeles?famille=objet&q=ballon&page=3",
    );
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await waitForRequest("famille=objet&page=3&per_page=24&q=ballon", 1);

    await act(async () => root?.unmount());
    root = createRoot(container);
    await act(async () => root!.render(<Modeles3D />));
    await waitForRequest("famille=objet&page=3&per_page=24&q=ballon", 2);
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("ballon");
  });

  test("writes family and pagination changes back to the canonical URL", async () => {
    await act(async () => root?.render(<Modeles3D />));
    await waitForRequest("famille=perso&page=1&per_page=24");

    const objectButton = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Objets"));
    expect(objectButton).not.toBeUndefined();
    await act(async () => objectButton?.click());
    await waitForRequest("famille=objet&page=1&per_page=24");
    expect(window.location.pathname).toBe("/modeles");
    expect(window.location.search).toBe("?famille=objet");

    const next = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Suivant");
    expect(next).not.toBeUndefined();
    await act(async () => next?.click());
    await waitForRequest("famille=objet&page=2&per_page=24");
    expect(window.location.search).toBe("?famille=objet&page=2");
  });

  test("restores and edits the server page size through per_page", async () => {
    window.history.replaceState(null, "", "/modeles?per_page=48&page=2");
    await act(async () => root?.render(<Modeles3D />));
    await waitForRequest("page=2&per_page=48");

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Modèles par page"]',
    );
    expect(input?.value).toBe("48");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "36");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await waitForRequest("page=1&per_page=36");
    expect(window.location.search).toBe("?per_page=36");
  });

  test("restores list mode and a directly linked model", async () => {
    window.history.replaceState(
      null,
      "",
      "/modeles?famille=objet&view=list&model=o0000100",
    );
    await act(async () => root?.render(<Modeles3D />));
    await waitForRequest("/api/v1/3d/modeles/objet/o0000100");

    const list = container.querySelector<HTMLButtonElement>(
      'button[aria-pressed="true"]',
    );
    expect([...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]')]
      .some((button) => button.textContent === "Liste")).toBeTrue();
    expect(container.textContent).toContain("objet/o0000100");

    const close = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Fermer");
    await act(async () => close?.click());
    expect(window.location.search).toBe("?famille=objet&view=list");
    expect(list).toBeDefined();
  });
});
