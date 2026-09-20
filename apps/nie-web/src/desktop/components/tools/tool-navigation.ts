/** URL identities are stable across browser history and retired Azalée tool links. */
export const TOOL_IDS = {
	translator: "traducteur",
	stats: "stats",
	compare: "comparateur",
	random_team: "aleatoire",
	my_team: "equipe",
	progression: "progression",
	probabilities: "probabilites",
} as const;

export type ToolView = typeof TOOL_IDS[keyof typeof TOOL_IDS];

export function toolFromSearch(search: string): ToolView {
	const key = new URLSearchParams(search).get("tool");
	return key && Object.hasOwn(TOOL_IDS, key) ? TOOL_IDS[key as keyof typeof TOOL_IDS] : "traducteur";
}

export function toolSearch(search: string, view: ToolView): string {
	const params = new URLSearchParams(search);
	const key = Object.entries(TOOL_IDS).find(([, value]) => value === view)?.[0];
	if (!key) throw new Error("Unknown tool view");
	params.set("tool", key);
	return `?${params}`;
}
