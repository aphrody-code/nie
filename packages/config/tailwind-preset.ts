// Preset Tailwind v4 partagé. Importé via `@import "tailwindcss"` côté apps
// + `@plugin "tailwindcss-animate"` + `@plugin "@tailwindcss/typography"`.
// Côté JS, ce module exporte uniquement le set de tokens partagés (couleurs Rose Griffon).

export const rgColors = {
	// Marine Patreon (de la DA packs personnages)
	marine: "#0c1730",
	// Branding Rose Griffon
	rose: "#e91e63",
	griffon: "#d4af37",
	// Sémantique
	success: "#22c55e",
	warning: "#f59e0b",
	danger: "#ef4444",
	info: "#3b82f6",
} as const;

export const rgFonts = {
	sans: ["Geist Sans", "system-ui", "sans-serif"],
	mono: ["Geist Mono", "monospace"],
	display: ["Geist Sans", "system-ui", "sans-serif"],
} as const;

export type RgColors = typeof rgColors;
export type RgFonts = typeof rgFonts;
