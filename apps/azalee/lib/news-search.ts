/**
 * Sanitize a user-supplied search query for Postgres `to_tsquery`/`textSearch`
 * with config="french". Strips operators / control chars and joins terms with `&`.
 *
 * Returns null when the input contains no usable token.
 *
 * Allowed runes: ASCII word chars, whitespace, hyphen, plus the Latin-1 supplement
 * `À-ÿ` (which already covers `à-ÿ`) and the OE/oe ligatures `Œœ`.
 */
export function sanitizeNewsSearchQuery(raw: string | null | undefined): string | null {
	if (!raw) {
		return null;
	}
	const cleaned = raw
		.trim()
		.replaceAll(/[^\w\sÀ-ÿŒœ-]/g, "")
		.split(/\s+/)
		.filter(Boolean);
	if (cleaned.length === 0) {
		return null;
	}
	return cleaned.join(" & ");
}
