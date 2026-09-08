/**
 * Rend un glyphe gaiji « niveau / évolution » du jeu (atlas `gaiji_game2`) en **CSS-sprite** :
 * background-position sur l'atlas décodé (CDN), mis à l'échelle à la hauteur demandée. Pur (pas de
 * `"use client"`), utilisable serveur ou client. Données : `lib/gaiji-shared.ts` (niers → azalee).
 */
import {
	GaijiGlyph as SharedGaijiGlyph,
	SkillEvolutionGlyphs as SharedSkillEvolutionGlyphs,
	type GaijiGlyphProps as SharedGaijiGlyphProps,
	type SkillEvolutionGlyphsProps as SharedSkillEvolutionGlyphsProps,
} from "@niers/inacord-ui/components/wiki/wiki/GaijiGlyph";
import { GAIJI, GAIJI_ATLAS, GROWTH_TYPE_GLYPHS, type GaijiKey } from "@rosegriffon/azalee/text/gaiji";

/** Un glyphe gaiji unique, rendu à `size` px de haut. */
export type GaijiGlyphProps = Omit<SharedGaijiGlyphProps, "glyph" | "atlas"> & {
	glyph: GaijiKey;
};

/** Azalée adapter: it supplies the CDN atlas and game-data glyph definition. */
export function GaijiGlyph({
	glyph,
	size = 28,
	className,
}: GaijiGlyphProps) {
	return <SharedGaijiGlyph glyph={GAIJI[glyph]} atlas={GAIJI_ATLAS} size={size} className={className} />;
}

/**
 * Glyphes du **type d'évolution** d'une technique (`growth_type` 0..7). N'affiche rien pour les
 * types sans glyphe-libellé certain (0/4/5/6) — cf. `GROWTH_TYPE_GLYPHS`.
 */
export type SkillEvolutionGlyphsProps = Omit<SharedSkillEvolutionGlyphsProps, "glyphs" | "atlas"> & {
	growthType: number | null | undefined;
};

export function SkillEvolutionGlyphs({
	growthType,
	size = 24,
	className,
}: SkillEvolutionGlyphsProps) {
	const keys: readonly GaijiKey[] = growthType == null ? [] : (GROWTH_TYPE_GLYPHS[growthType] ?? []);
	return <SharedSkillEvolutionGlyphs glyphs={keys.map((key) => GAIJI[key])} atlas={GAIJI_ATLAS} size={size} className={className} />;
}
