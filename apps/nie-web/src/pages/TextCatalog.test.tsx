import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setSettings } from "@nie/inacord-ui/lib/settings";
import {
  TextCatalog,
  textCatalogHrefForState,
  textCatalogStateFromUrl,
} from "./TextCatalog";

let root: Root | null;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;
let requests: string[];

const reactEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

const catalogue = {
  languages: [{ language: "ja", lines: 70 }],
  families: [
    { family: "menu_text", languages: ["ja"], files: 2, lines: 70 },
    { family: "item_text", languages: ["ja"], files: 1, lines: 20 },
  ],
  files: 3,
  lines: 90,
};

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(): Promise<void> {
  await act(async () => root?.render(<TextCatalog />));
  await settle();
}

beforeEach(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  (
    window as unknown as { happyDOM: { setURL: (url: string) => void } }
  ).happyDOM.setURL("http://localhost:3000/ja/textes");
  setSettings({ gameLocale: "ja" });
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
      if (url.pathname === "/api/v1/text") return Response.json(catalogue);
      if (url.pathname.startsWith("/api/v1/text/ja/")) {
        const page = Number(url.searchParams.get("page") ?? "1");
        const perPage = Number(url.searchParams.get("per_page") ?? "100");
        const q = url.searchParams.get("q");
        return Response.json({
          files: ["data/text.cfg.bin"],
          q,
          total_unfiltered: 70,
          results: {
            elements: [
              {
                hash: 1,
                hash_hex: "0x00000001",
                text: "Ballon",
                file: "data/text.cfg.bin",
              },
            ],
            page,
            per_page: perPage,
            total: 70,
            pages: 3,
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
  setSettings({ gameLocale: "fr" });
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("text catalogue URL state", () => {
  test("parses, trims and bounds every server-backed filter", () => {
    expect(
      textCatalogStateFromUrl(
        "?famille=%20menu_text%20&page=3&per_page=900&q=%20ballon%20",
      ),
    ).toEqual({
      family: "menu_text",
      page: 3,
      perPage: 200,
      q: "ballon",
    });
    expect(textCatalogStateFromUrl("?page=0&per_page=nan")).toEqual({
      family: "",
      page: 1,
      perPage: 100,
      q: "",
    });
    expect(
      textCatalogHrefForState("https://nie.test/ja/textes?obsolete=1", {
        family: "menu_text",
        page: 3,
        perPage: 25,
        q: "ballon",
      }),
    ).toBe("/ja/textes?famille=menu_text&page=3&per_page=25&q=ballon");
  });

  test("requests one server page and exposes family, query, page size and text export", async () => {
    window.history.replaceState(
      null,
      "",
      "/ja/textes?famille=menu_text&page=2&per_page=25&q=ballon",
    );
    await mount();

    expect(
      requests.filter((url) => url.includes("/api/v1/text/ja/menu_text?"))
        .length,
    ).toBe(1);
    expect(requests).toContain(
      "/api/v1/text/ja/menu_text?page=2&per_page=25&q=ballon",
    );
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("ballon");
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Lignes par page"]',
      )?.value,
    ).toBe("25");
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
    ).toContain("menu_text");
    expect(
      container
        .querySelector<HTMLAnchorElement>("a[download]")
        ?.getAttribute("href"),
    ).toBe("/api/v1/text/ja/menu_text?page=2&per_page=25&format=txt&q=ballon");
  });

  test("writes pagination and family changes to the URL and restores them on popstate", async () => {
    window.history.replaceState(
      null,
      "",
      "/ja/textes?famille=menu_text&page=2&per_page=25&q=ballon",
    );
    await mount();

    const next = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Suivant");
    await act(async () => next?.click());
    await settle();
    expect(window.location.search).toBe(
      "?famille=menu_text&page=3&per_page=25&q=ballon",
    );
    expect(requests).toContain(
      "/api/v1/text/ja/menu_text?page=3&per_page=25&q=ballon",
    );

    const itemFamily = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ].find((button) => button.textContent?.includes("item_text"));
    await act(async () => itemFamily?.click());
    await settle();
    expect(window.location.search).toBe("?famille=item_text&per_page=25");
    expect(requests).toContain("/api/v1/text/ja/item_text?page=1&per_page=25");

    window.history.pushState(
      null,
      "",
      "/ja/textes?famille=menu_text&page=2&per_page=25&q=retour",
    );
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await settle();
    expect(requests).toContain(
      "/api/v1/text/ja/menu_text?page=2&per_page=25&q=retour",
    );
    expect(
      container.querySelector<HTMLInputElement>('input[type="search"]')?.value,
    ).toBe("retour");
  });
});
