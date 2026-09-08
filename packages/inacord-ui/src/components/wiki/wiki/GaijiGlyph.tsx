/**
 * A glyph rectangle in a decoded game atlas. The host owns the atlas URL:
 * Azalee uses its CDN while desktop resolves the same VFS resource locally.
 */
export interface GaijiGlyphDefinition {
	x: number;
	y: number;
	w: number;
	h: number;
	label: string;
}

/** Dimensions and URL of the decoded atlas supplied by the host. */
export interface GaijiAtlas {
	url: string;
	width: number;
	height: number;
}

export interface GaijiGlyphProps {
	glyph: GaijiGlyphDefinition;
	atlas: GaijiAtlas;
	size?: number;
	className?: string;
}

/**
 * Shared CSS-sprite rendering for a decoded gaiji atlas. It deliberately owns
 * neither VFS lookup nor a CDN URL so every host renders the same measured rect.
 */
export function GaijiGlyph({ glyph, atlas, size = 28, className }: GaijiGlyphProps) {
	const scale = size / glyph.h;
	return (
		<span
			role="img"
			aria-label={glyph.label}
			title={glyph.label}
			className={className}
			style={{
				backgroundImage: `url(${atlas.url})`,
				backgroundPosition: `-${(glyph.x * scale).toFixed(1)}px -${(glyph.y * scale).toFixed(1)}px`,
				backgroundRepeat: "no-repeat",
				backgroundSize: `${(atlas.width * scale).toFixed(1)}px ${(atlas.height * scale).toFixed(1)}px`,
				display: "inline-block",
				height: `${size}px`,
				width: `${(glyph.w * scale).toFixed(1)}px`,
			}}
		/>
	);
}

export interface SkillEvolutionGlyphsProps {
	glyphs: readonly GaijiGlyphDefinition[];
	atlas: GaijiAtlas;
	size?: number;
	className?: string;
}

/** Renders the glyph sequence already selected by the host's game-data resolver. */
export function SkillEvolutionGlyphs({ glyphs, atlas, size = 24, className }: SkillEvolutionGlyphsProps) {
	if (glyphs.length === 0) return null;
	return (
		<span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
			{glyphs.map((glyph) => (
				<GaijiGlyph key={glyph.label} glyph={glyph} atlas={atlas} size={size} />
			))}
		</span>
	);
}
