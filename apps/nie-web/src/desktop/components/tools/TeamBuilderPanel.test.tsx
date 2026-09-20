import { afterEach, beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as runtime from "../../../game/team-rules";
import { ROSTER_PAGE_SIZE, TeamBuilderPanel } from "./TeamBuilderPanel";
import type { Joueur } from "../../lib/equipe";
import init, * as wasm from "../../../wasm/nie_wasm.js";
import { configureTeamRulesRuntime } from "@niers/game/game/team-rules";
import { wikiDb } from "../../lib/wikiDb";
import { teamsDb } from "../../lib/teamsDb";
import { TEAM_STORAGE_KEY } from "../../lib/teams-browser";
import { configureTeamCodeRuntime, encodeTeamCode, decodeTeamCode } from "@niers/game/game/team-code";
import { AssetSourceProvider } from "@niers/inacord-ui";

beforeAll(async () => {
  await init({ module_or_path: await Bun.file(new URL("../../../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
  configureTeamRulesRuntime(wasm);
  configureTeamCodeRuntime(wasm);
});

let root: Root;
let container: HTMLDivElement;
let readiness: ReturnType<typeof spyOn<typeof runtime, "ensureTeamRules">>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let previousEnvironment: boolean | undefined;

beforeEach(() => {
  previousEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  readiness = spyOn(runtime, "ensureTeamRules");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  readiness.mockRestore();
  environment.IS_REACT_ACT_ENVIRONMENT = previousEnvironment;
});

test("the builder does not run synchronous rules before runtime readiness", async () => {
  readiness.mockImplementation(() => new Promise(() => {}));
  await act(async () => root.render(<TeamBuilderPanel roster={[]} />));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector("input")).toBeNull();
  expect(readiness).toHaveBeenCalledTimes(1);
});

test("failed runtime initialization is visible and retryable", async () => {
  readiness.mockRejectedValueOnce(new Error("runtime unavailable"));
  readiness.mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => root.render(<TeamBuilderPanel roster={[]} />));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("runtime unavailable");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(readiness).toHaveBeenCalledTimes(2);
});

test("browser staff loads without a mirror path and persists distinct coach/coordinator slots", async () => {
  readiness.mockResolvedValue();
  const previous = window.localStorage.getItem(TEAM_STORAGE_KEY);
  window.localStorage.removeItem(TEAM_STORAGE_KEY);
  const staff = spyOn(wikiDb, "loadStaff").mockResolvedValue([
    { id: 7, name_localised: "Synthetic coach", name_romaji: null, name_kanji: null, role: "Coach", playstyle: "Bond", element: null, buff: "Source buff", requirements: null },
    { id: 8, name_localised: "Synthetic coordinator", name_romaji: null, name_kanji: null, role: "Coordinator", playstyle: null, element: null, buff: null, requirements: null },
  ]);
  try {
    await act(async () => root.render(<TeamBuilderPanel roster={[]} />));
    expect(staff).toHaveBeenCalledWith("");
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Créneau manager-0"]')!.click());
    expect(container.textContent).toContain("Synthetic coach");
    expect(container.textContent).toContain("Source buff");
    expect(container.textContent).not.toContain("Synthetic coordinator");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Synthetic coach"))!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Créneau support-0"]')!.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Synthetic coordinator"))!.click());
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Enregistrer"))!.click());
    const saved = await teamsDb.lister();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.membres["manager-0"]!.charaId).toBe("staff-7");
    expect(saved[0]!.membres["manager-0"]!.position).toBe("COACH");
    expect(saved[0]!.membres["support-0"]!.charaId).toBe("staff-8");
    expect(saved[0]!.membres["support-0"]!.position).toBe("COORD");
    const slots = Object.values(saved[0]!.membres).map(member => ({ slot: member.slot, charaId: member.charaId }));
    expect(decodeTeamCode(encodeTeamCode(saved[0]!.formationId, slots))).toEqual({ formationId: saved[0]!.formationId, slots });
    expect(container.textContent).toContain("Aucun joueur sur le terrain");
  } finally {
    staff.mockRestore();
    if (previous === null) window.localStorage.removeItem(TEAM_STORAGE_KEY);
    else window.localStorage.setItem(TEAM_STORAGE_KEY, previous);
  }
});

test("staff read errors are visible and retryable without destroying saved teams", async () => {
  readiness.mockResolvedValue();
  const staff = spyOn(wikiDb, "loadStaff").mockRejectedValueOnce(new Error("staff unavailable")).mockResolvedValueOnce([]);
  try {
    await act(async () => root.render(<TeamBuilderPanel roster={[]} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[title="Créneau manager-0"]')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("staff unavailable");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Réessayer l’encadrement"))!.click());
    expect(staff).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally { staff.mockRestore(); }
});

function rosterPlayer(index: number): Joueur {
  return {
    id: `player-${index}`,
    nom: `Player ${String(index).padStart(3, "0")}`,
    poste: "Milieu",
    element: "Vent",
    rarete: "Normal",
    codeRarete: null,
    serie: null,
    genre: null,
    code: null,
    stats: {
      kick: 1,
      control: 1,
      technique: 1,
      pressure: 1,
      physical: 1,
      agility: 1,
      intelligence: 1,
    },
  };
}

test("the searchable roster mounts one bounded page and preserves exact selection", async () => {
  readiness.mockResolvedValue();
  const staff = spyOn(wikiDb, "loadStaff").mockResolvedValue([]);
  const roster = Array.from({ length: ROSTER_PAGE_SIZE * 2 + 5 }, (_, index) => rosterPlayer(index));
  const source = { capacites: async () => ({}) } as never;
  try {
    await act(async () => root.render(
      <AssetSourceProvider source={source}>
        <TeamBuilderPanel roster={roster} />
      </AssetSourceProvider>,
    ));
    expect(container.querySelectorAll("[data-roster-player]")).toHaveLength(ROSTER_PAGE_SIZE);
    expect(container.querySelector('[data-roster-player="player-0"]')).not.toBeNull();
    expect(container.querySelector('[data-roster-player="player-60"]')).toBeNull();
    expect(container.querySelector('[aria-label="Page du roster"]')?.textContent).toBe("1 / 3");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Page suivante du roster"]')!.click());
    expect(container.querySelector('[data-roster-player="player-0"]')).toBeNull();
    expect(container.querySelector('[data-roster-player="player-60"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-roster-player]")).toHaveLength(ROSTER_PAGE_SIZE);

    const search = container.querySelector<HTMLInputElement>('input[placeholder="Rechercher un joueur…"]')!;
    await act(async () => {
      const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      value?.call(search, "Player 124");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Page du roster"]')?.textContent).toBe("1 / 1");
    expect(container.querySelectorAll("[data-roster-player]")).toHaveLength(1);
    expect(container.querySelector('[data-roster-player="player-124"]')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('[title="Créneau field-0"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[data-roster-player="player-124"]')!.click());
    expect(container.querySelector<HTMLButtonElement>('[title="Player 124"]')).not.toBeNull();
  } finally {
    staff.mockRestore();
  }
});
