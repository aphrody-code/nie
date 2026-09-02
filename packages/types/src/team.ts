import type { Database } from "@rosegriffon/db";

/** Membre de l'équipe Rose Griffon. */
export type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

/** Équipes identifiées. */
export const TEAMS = [
	"staff",
	"association",
	"partenaires",
	"bureauteam",
	"assoteam",
	"collabteam",
	"achilleateam",
	"azaleeteam",
	"loreteam",
	"dessinateurteam",
	"mediationteam",
	"productionteam",
	"socialteam",
] as const;

export type TeamId = (typeof TEAMS)[number];
