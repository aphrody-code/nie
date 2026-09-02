/**
 * Rend un glyphe gaiji « niveau / évolution » du jeu (atlas `gaiji_game2`) en **CSS-sprite** :
 * background-position sur l'atlas décodé (CDN), mis à l'échelle à la hauteur demandée. Pur (pas de
 * `"use client"`), utilisable serveur ou client. Données : `lib/gaiji-shared.ts` (niers → azalee).
 */
import { GAIJI, GAIJI_ATLAS, GROWTH_TYPE_GLYPHS, type GaijiKey } from "@rosegriffon/azalee/text/gaiji";

/** Un glyphe gaiji unique, rendu à `size` px de haut. */
export function GaijiGlyph({
	glyph,
	size = 28,
	className,
}: {
	glyph: GaijiKey;
	size?: number;
	className?: string;
}) {
	const g = GAIJI[glyph];
	const scale = size / g.h;
	return (
		<span
			role="img"
			aria-label={g.label}
			title={g.label}
			className={className}
			style={{
				backgroundImage: `url(${GAIJI_ATLAS.url})`,
				backgroundPosition: `-${(g.x * scale).toFixed(1)}px -${(g.y * scale).toFixed(1)}px`,
				backgroundRepeat: "no-repeat",
				backgroundSize: `${(GAIJI_ATLAS.width * scale).toFixed(1)}px ${(GAIJI_ATLAS.height * scale).toFixed(1)}px`,
				display: "inline-block",
				height: `${size}px`,
				width: `${(g.w * scale).toFixed(1)}px`,
			}}
		/>
	);
}

/**
 * Glyphes du **type d'évolution** d'une technique (`growth_type` 0..7). N'affiche rien pour les
 * types sans glyphe-libellé certain (0/4/5/6) — cf. `GROWTH_TYPE_GLYPHS`.
 */
export function SkillEvolutionGlyphs({
	growthType,
	size = 24,
	className,
}: {
	growthType: number | null | undefined;
	size?: number;
	className?: string;
}) {
	const keys: GaijiKey[] = growthType == null ? [] : (GROWTH_TYPE_GLYPHS[growthType] ?? []);
	if (keys.length === 0) return null;
	return (
		<span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
			{keys.map((k) => (
				<GaijiGlyph key={k} glyph={k} size={size} />
			))}
		</span>
	);
}
