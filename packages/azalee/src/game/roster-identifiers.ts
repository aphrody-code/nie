/**
 * Canonical roster identifiers shared by save import clients and data hosts.
 *
 * A parsed save can expose an unsigned 32-bit character identifier as a number,
 * a decimal string, or a hexadecimal string.  The game-data mirror stores the
 * canonical uppercase hexadecimal representation.  Keeping that conversion in
 * the portable game package prevents browser and server adapters from silently
 * resolving different characters for the same save.
 */

/** Largest character identifier representable by the game save format. */
export const MAX_ROSTER_IDENTIFIER = 0xffff_ffff;

/** Default maximum number of distinct identifiers accepted in one lookup. */
export const DEFAULT_MAX_ROSTER_IDENTIFIERS = 8_000;

/**
 * Convert one untrusted roster identifier to the mirror's canonical
 * `0xXXXXXXXX` representation, or return `null` when it is outside the u32
 * range or malformed.
 *
 * Unprefixed strings containing only decimal digits are decimal.  Hexadecimal
 * strings must either use the `0x` prefix or contain at least one A-F digit;
 * that removes the ambiguity that previously made values such as `"123"`
 * depend on the adapter that received them.
 */
export function normalizeRosterIdentifier(raw: unknown): string | null {
	let value: number;

	if (typeof raw === "number") {
		value = raw;
	} else if (typeof raw === "string") {
		const valueText = raw.trim();
		if (/^0x[0-9a-fA-F]{1,8}$/i.test(valueText)) {
			value = Number.parseInt(valueText.slice(2), 16);
		} else if (/^[0-9]+$/.test(valueText)) {
			value = Number(valueText);
		} else if (/^[0-9a-fA-F]{1,8}$/.test(valueText) && /[a-f]/i.test(valueText)) {
			value = Number.parseInt(valueText, 16);
		} else {
			return null;
		}
	} else {
		return null;
	}

	if (!Number.isInteger(value) || value < 0 || value > MAX_ROSTER_IDENTIFIER) {
		return null;
	}
	return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Normalize, deduplicate, and cap identifiers while preserving their first
 * appearance order.  The cap is a transport guard; callers can expose a
 * stricter boundary without reimplementing conversion semantics.
 */
export function normalizeRosterIdentifiers(
	values: readonly unknown[],
	max = DEFAULT_MAX_ROSTER_IDENTIFIERS
): string[] {
	const limit = Number.isSafeInteger(max) && max > 0 ? max : 0;
	const identifiers: string[] = [];
	const seen = new Set<string>();

	for (const value of values) {
		const identifier = normalizeRosterIdentifier(value);
		if (!identifier || seen.has(identifier)) {
			continue;
		}
		seen.add(identifier);
		identifiers.push(identifier);
		if (identifiers.length >= limit) {
			break;
		}
	}

	return identifiers;
}
