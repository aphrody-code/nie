import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createBrowserTeamStore, MAX_SAVED_TEAMS, MAX_TEAM_STORAGE_BYTES, TEAM_STORAGE_KEY } from "./teams-browser";
import { teamsDb } from "./teamsDb";
import Database from "./sqlite";
import type { TeamMember } from "@niers/game/game/team-types";

const neighborKey = "niers.teams.test.neighbor";
let previous: string | null;
let previousNeighbor: string | null;
const storage = () => window.localStorage;
const store = createBrowserTeamStore(storage);
const composition: Record<string, TeamMember> = {
  "field-0": { slot: "field-0", charaId: "synthetic_01", name: "Synthetic é日本", position: "FW", element: "Fire", rarity: "Normal", imageUrl: "", slug: "synthetic_01" },
};

beforeEach(() => {
  previous = storage().getItem(TEAM_STORAGE_KEY);
  previousNeighbor = storage().getItem(neighborKey);
  storage().removeItem(TEAM_STORAGE_KEY);
  storage().setItem(neighborKey, "untouched");
});
afterEach(() => {
  if (previous === null) storage().removeItem(TEAM_STORAGE_KEY); else storage().setItem(TEAM_STORAGE_KEY, previous);
  if (previousNeighbor === null) storage().removeItem(neighborKey); else storage().setItem(neighborKey, previousNeighbor);
});

test("real browser Storage round-trips IDs, Unicode, updates, deletion and a fresh store instance", async () => {
  expect(await store.lister()).toEqual([]);
  const id = await store.creer("Équipe 日本", "diamond442", composition);
  const second = await store.creer("Second", "box442", {});
  const reloaded = createBrowserTeamStore(storage);
  const saved = await reloaded.lire(id);
  expect(saved?.id).toBe(id);
  expect(saved?.membres).toEqual(composition);
  expect(saved?.nom).toBe("Équipe 日本");
  await reloaded.mettreAJour(id, "Updated", "box442", {});
  expect((await store.lire(id))?.nom).toBe("Updated");
  expect((await store.lire(id))?.formationId).toBe("box442");
  expect((await store.lire(id))?.membres).toEqual({});
  await store.supprimer(id);
  expect(await reloaded.lire(id)).toBeNull();
  expect((await reloaded.lister()).map(team => team.id)).toEqual([second]);
  expect(storage().getItem(neighborKey)).toBe("untouched");
});

test("the public browser facade never invokes native SQLite", async () => {
  const native = spyOn(Database, "load").mockRejectedValue(new Error("Native SQLite must not run"));
  try {
    const id = await teamsDb.creer("Browser", "diamond442", composition);
    expect((await teamsDb.lire(id))?.membres).toEqual(composition);
    await teamsDb.mettreAJour(id, "Renamed", "box442", {});
    expect((await teamsDb.lister())[0]?.nom).toBe("Renamed");
    await teamsDb.supprimer(id);
    expect(await teamsDb.lire(id)).toBeNull();
    expect(native).not.toHaveBeenCalled();
  } finally { native.mockRestore(); }
});

test("corrupt and future-version data remain intact instead of being silently replaced", async () => {
  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 2, teams: [] }), JSON.stringify({ schemaVersion: 1, teams: [{}] })]) {
    storage().setItem(TEAM_STORAGE_KEY, raw);
    await expect(store.creer("New", "diamond442", composition)).rejects.toThrow();
    expect(storage().getItem(TEAM_STORAGE_KEY)).toBe(raw);
  }
});

test("size, count, missing-ID and member errors do not damage previously saved records", async () => {
  const id = await store.creer("Kept", "diamond442", composition);
  const valid = storage().getItem(TEAM_STORAGE_KEY)!;
  await expect(store.creer("x".repeat(MAX_TEAM_STORAGE_BYTES), "diamond442", {})).rejects.toThrow("storage limit");
  expect(storage().getItem(TEAM_STORAGE_KEY)).toBe(valid);
  await expect(store.mettreAJour("missing", "No", "diamond442", {})).rejects.toThrow("Unknown saved team");
  await expect(store.mettreAJour(id, "No", "diamond442", { "field-1": composition["field-0"]! })).rejects.toThrow("Invalid saved team members");
  expect(storage().getItem(TEAM_STORAGE_KEY)).toBe(valid);
  const row = JSON.parse(valid).teams[0];
  const full = JSON.stringify({ schemaVersion: 1, teams: Array.from({ length: MAX_SAVED_TEAMS }, (_, index) => ({ ...row, id: String(index) })) });
  storage().setItem(TEAM_STORAGE_KEY, full);
  expect(await store.lister()).toHaveLength(MAX_SAVED_TEAMS);
  await expect(store.creer("Extra", "diamond442", {})).rejects.toThrow("Too many saved teams");
  expect(storage().getItem(TEAM_STORAGE_KEY)).toBe(full);
});

test("quota and denied-access errors propagate without clearing user storage", async () => {
  await store.creer("Kept", "diamond442", composition);
  const valid = storage().getItem(TEAM_STORAGE_KEY);
  // Keep real Storage reads; inject only the browser's atomic write failure boundary.
  const full = new Proxy(storage(), { get(target, key) {
    if (key === "setItem") return () => { throw new DOMException("Full", "QuotaExceededError"); };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(createBrowserTeamStore(() => full).creer("Rejected", "diamond442", {})).rejects.toThrow("Full");
  expect(storage().getItem(TEAM_STORAGE_KEY)).toBe(valid);
  const denied = createBrowserTeamStore(() => { throw new DOMException("Denied", "SecurityError"); });
  await expect(denied.lister()).rejects.toThrow("Denied");
  expect(storage().getItem(neighborKey)).toBe("untouched");
});
