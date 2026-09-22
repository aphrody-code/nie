/** Browser-local transport for saved compositions; no SQL interpretation or server writes. */
import type { TeamMember } from "@nie/game/game/team-types";
import type { EquipeEnregistree, LigneEquipe } from "./teamsDb";

export const TEAM_STORAGE_KEY = "nie.teams.v1";
export const MAX_SAVED_TEAMS = 256;
export const MAX_TEAM_STORAGE_BYTES = 2 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function members(value: unknown): Record<string, TeamMember> {
  const validStats = (stats: unknown) => stats === undefined || (object(stats)
    && ["kick", "control", "technique", "pressure", "physical", "agility", "intelligence"]
      .every(key => typeof stats[key] === "number" && Number.isFinite(stats[key])));
  if (!object(value) || Object.entries(value).some(([slot, member]) =>
    !object(member) || member.slot !== slot || typeof member.charaId !== "string"
    || typeof member.name !== "string" || typeof member.position !== "string"
    || typeof member.element !== "string" || typeof member.rarity !== "string"
    || typeof member.imageUrl !== "string" || typeof member.slug !== "string" || !validStats(member.stats))) {
    throw new Error("Invalid saved team members");
  }
  return value as unknown as Record<string, TeamMember>;
}

function decoded(row: LigneEquipe): EquipeEnregistree {
  return { id: row.id, nom: row.name, formationId: row.formation_id,
    membres: members(JSON.parse(row.members)), misAJourLe: row.updated_at };
}

/** Each operation reads fresh storage. Writes are atomic setItem calls and preserve other keys. */
export function createBrowserTeamStore(storage: () => Storage) {
  function read(): LigneEquipe[] {
    const encoded = storage().getItem(TEAM_STORAGE_KEY);
    if (encoded === null) return [];
    if (new TextEncoder().encode(encoded).length > MAX_TEAM_STORAGE_BYTES) throw new Error("Saved teams exceed the storage limit");
    const payload: unknown = JSON.parse(encoded);
    if (!object(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.teams)) {
      throw new Error("Unsupported saved team storage format");
    }
    if (payload.teams.length > MAX_SAVED_TEAMS) throw new Error("Too many saved teams");
    const ids = new Set<string>();
    for (const row of payload.teams) {
      if (!object(row) || !["id", "name", "formation_id", "members", "created_at", "updated_at"].every(key => typeof row[key] === "string")
        || !row.id || ids.has(row.id as string)) throw new Error("Invalid saved team record");
      ids.add(row.id as string);
      members(JSON.parse(row.members as string));
    }
    return payload.teams as LigneEquipe[];
  }

  function write(rows: LigneEquipe[]): void {
    if (rows.length > MAX_SAVED_TEAMS) throw new Error("Too many saved teams");
    const encoded = JSON.stringify({ schemaVersion: 1, teams: rows });
    if (new TextEncoder().encode(encoded).length > MAX_TEAM_STORAGE_BYTES) throw new Error("Saved teams exceed the storage limit");
    // Quota/security failures propagate. Never clear valid data to make room.
    storage().setItem(TEAM_STORAGE_KEY, encoded);
  }

  return {
    async lister(): Promise<EquipeEnregistree[]> {
      return read().sort((a, b) => a.updated_at === b.updated_at
        ? a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        : a.updated_at > b.updated_at ? -1 : 1).map(decoded);
    },
    async lire(id: string): Promise<EquipeEnregistree | null> {
      const row = read().find(row => row.id === id);
      return row ? decoded(row) : null;
    },
    async creer(name: string, formationId: string, composition: Record<string, TeamMember>): Promise<string> {
      const rows = read();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      rows.push({ id, name, formation_id: formationId, members: JSON.stringify(members(composition)), created_at: now, updated_at: now });
      write(rows);
      return id;
    },
    async mettreAJour(id: string, name: string, formationId: string, composition: Record<string, TeamMember>): Promise<void> {
      const rows = read();
      const row = rows.find(row => row.id === id);
      if (!row) throw new Error("Unknown saved team");
      row.name = name;
      row.formation_id = formationId;
      row.members = JSON.stringify(members(composition));
      row.updated_at = new Date().toISOString();
      write(rows);
    },
    async supprimer(id: string): Promise<void> {
      const rows = read();
      const retained = rows.filter(row => row.id !== id);
      if (retained.length !== rows.length) write(retained);
    },
  };
}
