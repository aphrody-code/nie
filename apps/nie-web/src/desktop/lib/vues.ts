// Registry of the Inacord desktop views.
//
// Inacord is the user-facing VFS explorer. Reverse engineering, modding, Lua, live memory,
// wiki/data queries and 3D authoring are library capabilities exposed through API, CLI, MCP,
// code and scripts; they are deliberately not desktop navigation targets.
import type { TFn } from "@/lib/i18n";

export type GroupeVue = "principal";

export interface Vue {
	id: "explorer";
	cle: "tab.explorer";
	icone: "folder_open";
	groupe: "principal";
	description: string;
	barreLaterale: true;
}

/** The only Inacord desktop surface: browse and render the mounted VFS for the user. */
export const VUES: readonly Vue[] = [
	{
		id: "explorer",
		cle: "tab.explorer",
		icone: "folder_open",
		groupe: "principal",
		description: "Arborescence complète du VFS, à onglets, avec aperçu des ressources.",
		barreLaterale: true,
	},
] as const;

export const LIBELLE_GROUPE: Record<GroupeVue, string | null> = { principal: null };

const PAR_ID = new Map<string, Vue>(VUES.map((v) => [v.id, v]));

export function vue(id: string): Vue | undefined {
	return PAR_ID.get(id);
}

export function libellesVues(t: TFn): Record<string, string> {
	return Object.fromEntries(VUES.map((v) => [v.id, t(v.cle)]));
}

export function vuesDuGroupe(groupe: GroupeVue): Vue[] {
	return VUES.filter((v) => v.groupe === groupe);
}

export const IDS_VUES: readonly string[] = VUES.map((v) => v.id);
