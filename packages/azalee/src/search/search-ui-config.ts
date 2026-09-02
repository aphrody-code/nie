/**
 * Shared search UI configuration
 *
 * Single source of truth for type labels, icons, and badge styles
 * used by both GlobalSearch (Cmd+K dialog) and SearchClient (full-page search).
 */

/** Singular labels — used in result subtitles */
export const TYPE_LABELS: Record<string, string> = {
	article: "Actualité",
	aura: "Aura",
	awakening: "Éveil",
	basara: "BASARA",
	character: "Personnage",
	item: "Objet",
	keshin: "Esprit Guerrier",
	miximax: "Miximax",
	modechange: "Changement Mode",
	passive: "Talent",
	patchnote: "Patch Note",
	skill: "Technique",
	soul: "Totem",
	tactic: "Tactique",
	team: "Équipe",
	tweet: "Tweet X",
	re: "IE RE (Remake)",
	cross: "IE Cross",
	level5: "Info LEVEL-5",
	topic: "Info LEVEL-5",
	doc: "Documentation",
};

/** Plural labels — used in group headings */
export const TYPE_LABELS_PLURAL: Record<string, string> = {
	article: "Actualités",
	aura: "Auras",
	awakening: "Éveils",
	basara: "Joueurs BASARA",
	character: "Personnages",
	item: "Objets",
	keshin: "Esprits Guerriers",
	miximax: "Miximax",
	modechange: "Changements de Mode",
	passive: "Talents",
	patchnote: "Patch Notes",
	skill: "Techniques",
	soul: "Totems",
	tactic: "Tactiques",
	team: "Équipes",
	tweet: "Tweets X",
	re: "Infos IE RE",
	cross: "Infos IE Cross",
	level5: "Infos LEVEL-5",
	topic: "Infos LEVEL-5",
	doc: "Documentations",
};

/** Language badge colors (Material Design 3 tokens) */
export const LANG_BADGE_STYLES: Record<string, string> = {
	EN: "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]",
	FR: "bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]",
	JP: "bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]",
};
