/** Portable comparison selection; statistics remain owned and recomputed by the Rust engine. */
export interface ComparisonSelection {
	id: string;
	name: string;
}

export interface ComparisonShare {
	schema: "nie.compare.v1";
	left: ComparisonSelection;
	right: ComparisonSelection;
	level: number;
}

/** Retain historical char1/char2 aliases, but emit unambiguous exact variant IDs. */
export function comparisonFromSearch(search: string): { left: string | null; right: string | null; level: number } {
	const params = new URLSearchParams(search);
	const identity = (canonical: string, legacy: string) => {
		const value = params.get(canonical) ?? params.get(legacy);
		return value && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
	};
	const level = Number(params.get("level") ?? 99);
	return { left: identity("left", "char1"), right: identity("right", "char2"), level: Number.isInteger(level) && level >= 1 && level <= 99 ? level : 99 };
}

export function comparisonSearch(search: string, left: string | null, right: string | null, level: number): string {
	const params = new URLSearchParams(search);
	params.delete("char1");
	params.delete("char2");
	for (const [key, value] of [["left", left], ["right", right]] as const) {
		if (value) params.set(key, value); else params.delete(key);
	}
	params.set("level", String(Math.min(99, Math.max(1, Math.trunc(level)))));
	return `?${params}`;
}

/** Import identities only: shared values never override the owner's computed statistics. */
export function parseComparisonShare(text: string): ComparisonShare {
	if (text.length > 8192) throw new Error("Comparison payload exceeds limit");
	const payload: unknown = JSON.parse(text);
	if (!payload || typeof payload !== "object") throw new Error("Invalid comparison payload");
	const value = payload as Record<string, unknown>;
	if (value.schema !== "nie.compare.v1" || typeof value.level !== "number"
		|| !Number.isInteger(value.level) || value.level < 1 || value.level > 99) {
		throw new Error("Invalid comparison schema or level");
	}
	const selection = (input: unknown): ComparisonSelection => {
		if (!input || typeof input !== "object") throw new Error("Missing comparison selection");
		const record = input as Record<string, unknown>;
		if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 256
			|| typeof record.name !== "string" || record.name.length > 1024) {
			throw new Error("Invalid comparison identity");
		}
		return { id: record.id, name: record.name };
	};
	return { schema: "nie.compare.v1", left: selection(value.left), right: selection(value.right), level: value.level };
}

export function comparisonShareText(
	left: ComparisonSelection,
	right: ComparisonSelection,
	level: number,
): string {
	if (!Number.isFinite(level)) throw new Error("Invalid comparison level");
	const payload: ComparisonShare = {
		schema: "nie.compare.v1",
		left,
		right,
		level: Math.min(99, Math.max(1, Math.trunc(level))),
	};
	const text = JSON.stringify(payload);
	parseComparisonShare(text);
	return text;
}
