import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SearchView, searchViewHref, searchViewStateFromUrl } from "./SearchView";
import { wikiDb } from "@/lib/wikiDb";

let root: Root | null;
let container: HTMLDivElement;
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;
let characterSearch: ReturnType<typeof spyOn>;
let skillSearch: ReturnType<typeof spyOn>;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

beforeEach(() => {
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
    "http://localhost:3000/inacord/search?q=Mark&kind=waza",
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  characterSearch = spyOn(wikiDb, "searchCharacter").mockResolvedValue([{
    id: "c1",
    chara_id: "c1",
    internal_code: "c01000010",
    name_fr: "Axel Blaze",
    name_en: "Axel Blaze",
    name_ja: null,
    element: "fire",
    position: "FW",
    rarity_label: null,
    slug: null,
    base_slug: null,
  }]);
  skillSearch = spyOn(wikiDb, "searchSkill").mockResolvedValue([{
    id: "w1",
    internal_code: "waza_fire_tornado",
    name_fr: "Tornade de Feu",
    name_en: "Fire Tornado",
    name_ja: null,
    category: "shoot",
    element: "fire",
    power_max: 100,
    power_min: 50,
    tp_cost: 20,
    description_fr: null,
    description_en: null,
    is_hyper: 0,
  }]);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  characterSearch.mockRestore();
  skillSearch.mockRestore();
  reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("SearchView URL state", () => {
  test("parses, bounds and serializes only q and kind", () => {
    expect(searchViewStateFromUrl("?q=%20Mark%20&kind=waza")).toEqual({ q: "Mark", kind: "waza" });
    expect(searchViewStateFromUrl("?q=Jude&kind=unknown")).toEqual({ q: "Jude", kind: "chara" });
    expect(searchViewHref("https://nie.test/inacord/search?keep=1&q=old&kind=waza#results", {
      q: " Axel ",
      kind: "chara",
    })).toBe("/inacord/search?keep=1&q=Axel#results");
  });

  test("restores q and kind on mount and popstate without a pagination claim", async () => {
    await act(async () => root?.render(<SearchView onOpenFile={() => undefined} />));
    await settle();

    expect(container.querySelector<HTMLInputElement>('input[placeholder^="Nom"]')?.value).toBe("Mark");
    expect(container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.textContent).toContain("Technique");
    expect(container.textContent).toContain("jusqu’à 50 résultats · sans pagination");

    window.history.pushState(null, "", "/inacord/search?q=Axel");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await settle();

    expect(container.querySelector<HTMLInputElement>('input[placeholder^="Nom"]')?.value).toBe("Axel");
    expect(container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.textContent).toContain("Personnage");
  });

  test("uses the browser wiki adapter and renders character then skill results", async () => {
    window.history.replaceState(null, "", "/inacord/search?q=Axel");
    await act(async () => root?.render(<SearchView onOpenFile={() => undefined} />));
    await settle();

    expect(characterSearch).toHaveBeenCalledWith("wiki-http", "Axel");
    expect(container.textContent).toContain("Axel Blaze");
    expect(container.textContent).toContain("miroir Rust HTTP");

    window.history.pushState(null, "", "/inacord/search?q=Feu&kind=waza");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    await settle();

    expect(skillSearch).toHaveBeenCalledWith("wiki-http", "Feu");
    expect(container.textContent).toContain("Tornade de Feu");
  });

  test("writes kind and submitted q to the web URL", async () => {
    await act(async () => root?.render(<SearchView onOpenFile={() => undefined} />));
    await settle();

    const characterTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent?.includes("Personnage"));
    await act(async () => characterTab?.click());
    expect(window.location.search).toBe("?q=Mark");

    const input = container.querySelector<HTMLInputElement>('input[placeholder^="Nom"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Jude");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Chercher");
    await act(async () => submit?.click());
    expect(window.location.search).toBe("?q=Jude");
    expect(window.location.search).not.toContain("limit");
  });
});
