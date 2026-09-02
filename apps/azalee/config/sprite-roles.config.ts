import type { CSSProperties } from "react";

export type SpriteRoleVariant = "glow" | "solid" | "grey" | "flat" | "tag" | "simple" | "default";
export type SpriteCategory = "size" | "role";
export type SpriteValue = "l" | "m" | "s" | "att" | "mil" | "def" | "gar" | "tout";

export interface SpriteItem {
	id: string;
	label: string;
	category: SpriteCategory;
	value: SpriteValue;
	variant: SpriteRoleVariant;
	coords: { x: number; y: number; w: number; h: number };
}

export const ROLES_SPRITE_SOURCE = "/icon_common2.webp";

/**
 * Configuration for icon_common2.webp
 * Coordinates are exact pixel values from the spritesheet.
 */
export const ROLES_MAP: Record<string, SpriteItem> = {
	// --- SIZES ---
	"size-l-default": {
		category: "size",
		coords: { h: 80, w: 80, x: 20, y: 20 },
		id: "size-l-default",
		label: "Large",
		value: "l",
		variant: "default",
	},
	"size-m-default": {
		category: "size",
		coords: { h: 80, w: 80, x: 20, y: 180 },
		id: "size-m-default",
		label: "Medium",
		value: "m",
		variant: "default",
	},
	"size-s-default": {
		category: "size",
		coords: { h: 80, w: 80, x: 340, y: 20 },
		id: "size-s-default",
		label: "Small",
		value: "s",
		variant: "default",
	},

	// --- ROLE: GLOW (Neon effect) ---
	"role-att-glow": {
		category: "role",
		coords: { h: 70, w: 180, x: 580, y: 20 },
		id: "role-att-glow",
		label: "Attaquant (Glow)",
		value: "att",
		variant: "glow",
	},
	"role-mil-glow": {
		category: "role",
		coords: { h: 70, w: 180, x: 580, y: 150 },
		id: "role-mil-glow",
		label: "Milieu (Glow)",
		value: "mil",
		variant: "glow",
	},
	"role-def-glow": {
		category: "role",
		coords: { h: 70, w: 180, x: 570, y: 300 },
		id: "role-def-glow",
		label: "Défenseur (Glow)",
		value: "def",
		variant: "glow",
	},
	"role-gar-glow": {
		category: "role",
		coords: { h: 70, w: 190, x: 790, y: 300 },
		id: "role-gar-glow",
		label: "Gardien (Glow)",
		value: "gar",
		variant: "glow",
	},

	// --- ROLE: SOLID (Bold color with outline) ---
	"role-att-solid": {
		category: "role",
		coords: { h: 80, w: 210, x: 550, y: 610 },
		id: "role-att-solid",
		label: "Attaquant (Solid)",
		value: "att",
		variant: "solid",
	},
	"role-mil-solid": {
		category: "role",
		coords: { h: 70, w: 190, x: 270, y: 630 },
		id: "role-mil-solid",
		label: "Milieu (Solid)",
		value: "mil",
		variant: "solid",
	},
	"role-def-solid": {
		category: "role",
		coords: { h: 80, w: 210, x: 0, y: 630 },
		id: "role-def-solid",
		label: "Défenseur (Solid)",
		value: "def",
		variant: "solid",
	},
	"role-gar-solid": {
		category: "role",
		coords: { h: 60, w: 190, x: 460, y: 900 },
		id: "role-gar-solid",
		label: "Gardien (Solid)",
		value: "gar",
		variant: "solid",
	},

	// --- ROLE: GREY (Inactive/Outline) ---
	"role-att-grey": {
		category: "role",
		coords: { h: 70, w: 200, x: 780, y: 460 },
		id: "role-att-grey",
		label: "Attaquant (Grey)",
		value: "att",
		variant: "grey",
	},
	"role-mil-grey": {
		category: "role",
		coords: { h: 70, w: 190, x: 780, y: 610 },
		id: "role-mil-grey",
		label: "Milieu (Grey)",
		value: "mil",
		variant: "grey",
	},
	"role-def-grey": {
		category: "role",
		coords: { h: 70, w: 200, x: 500, y: 750 },
		id: "role-def-grey",
		label: "Défenseur (Grey)",
		value: "def",
		variant: "grey",
	},
	"role-gar-grey": {
		category: "role",
		coords: { h: 70, w: 190, x: 570, y: 460 },
		id: "role-gar-grey",
		label: "Gardien (Grey)",
		value: "gar",
		variant: "grey",
	},
	"role-gar-grey-2": {
		category: "role",
		coords: { h: 70, w: 200, x: 720, y: 750 },
		id: "role-gar-grey-2",
		label: "Gardien (Grey 2)",
		value: "gar",
		variant: "grey",
	},

	// --- ROLE: FLAT (Colored Box) ---
	"role-att-flat": {
		category: "role",
		coords: { h: 90, w: 200, x: 220, y: 770 },
		id: "role-att-flat",
		label: "Attaquant (Flat)",
		value: "att",
		variant: "flat",
	},
	"role-mil-flat": {
		category: "role",
		coords: { h: 90, w: 200, x: 0, y: 790 },
		id: "role-mil-flat",
		label: "Milieu (Flat)",
		value: "mil",
		variant: "flat",
	},
	"role-def-flat": {
		category: "role",
		coords: { h: 90, w: 200, x: 220, y: 880 },
		id: "role-def-flat",
		label: "Défenseur (Flat)",
		value: "def",
		variant: "flat",
	},
	"role-tout-flat": {
		category: "role",
		coords: { h: 90, w: 160, x: 790, y: 10 },
		id: "role-tout-flat",
		label: "Tout (Flat)",
		value: "tout",
		variant: "flat",
	},

	// --- ROLE: TAG (Small pill) ---
	"role-att-tag": {
		category: "role",
		coords: { h: 50, w: 120, x: 790, y: 150 },
		id: "role-att-tag",
		label: "Attaquant (Tag)",
		value: "att",
		variant: "tag",
	},

	// --- ROLE: SIMPLE (Text only/Minimal) ---
	"role-mil-simple": {
		category: "role",
		coords: { h: 50, w: 120, x: 670, y: 880 },
		id: "role-mil-simple",
		label: "Milieu (Simple)",
		value: "mil",
		variant: "simple",
	},
	"role-def-simple": {
		category: "role",
		coords: { h: 50, w: 130, x: 810, y: 880 },
		id: "role-def-simple",
		label: "Défenseur (Simple)",
		value: "def",
		variant: "simple",
	},
	"role-gar-simple": {
		category: "role",
		coords: { h: 50, w: 120, x: 0, y: 920 },
		id: "role-gar-simple",
		label: "Gardien (Simple)",
		value: "gar",
		variant: "simple",
	},
};

/**
 * Helper to generate CSS style for a specific sprite item
 */
export function getSpriteStyle(id: string): CSSProperties {
	const item = ROLES_MAP[id];
	if (!item) {
		return {};
	}

	return {
		backgroundImage: `url(${ROLES_SPRITE_SOURCE})`,
		backgroundPosition: `-${item.coords.x}px -${item.coords.y}px`,
		backgroundRepeat: "no-repeat",
		display: "inline-block",
		height: `${item.coords.h}px`,
		width: `${item.coords.w}px`,
	};
}
