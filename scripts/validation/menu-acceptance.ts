/** Frozen delivery policy. Reports use raw 8-bit RGB deltas as well as normalized values. */
export const MENU_ACCEPTANCE = Object.freeze({ minSsim: 0.99, maxRgbDelta: 2, maxGeometryDelta: 1 });

export interface PixelMetrics {
	grayscaleSsim: number;
	rgbMeanAbsoluteDelta: number;
}

export interface MeasuredRect { x: number; y: number; w: number; h: number }

export function visualFailures(metrics: PixelMetrics): string[] {
	const failures: string[] = [];
	if (!Number.isFinite(metrics.grayscaleSsim) || metrics.grayscaleSsim < MENU_ACCEPTANCE.minSsim || metrics.grayscaleSsim > 1.000000001) {
		failures.push("grayscale SSIM must be at least 0.99 and finite");
	}
	if (!Number.isFinite(metrics.rgbMeanAbsoluteDelta) || metrics.rgbMeanAbsoluteDelta < 0 || metrics.rgbMeanAbsoluteDelta > MENU_ACCEPTANCE.maxRgbDelta) {
		failures.push("RGB mean absolute delta must be at most 2 on 8-bit channels");
	}
	return failures;
}

export function validRect(rect: MeasuredRect, width = 1920, height = 1080): boolean {
	return rect != null && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)
		&& rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0
		&& rect.x + rect.w <= width && rect.y + rect.h <= height;
}

export function geometryFailures(expected: MeasuredRect, actual: MeasuredRect): string[] {
	if (!validRect(expected) || !validRect(actual)) return ["missing or invalid element geometry"];
	return (["x", "y", "w", "h"] as const)
		.filter((key) => Math.abs(expected[key] - actual[key]) > MENU_ACCEPTANCE.maxGeometryDelta)
		.map((key) => `${key} differs by more than 1 pixel`);
}

export interface InventoryReference {
	file: string;
	sha256: string;
	screen: string;
	visual_subscreen: string | null;
	client_crop: { x: number; y: number; w: number; h: number } | null;
}

/** A complete corpus is a set, not a success count that duplicates can inflate. */
export function coverageFailures(references: readonly InventoryReference[], captured: readonly string[]): string[] {
	const failures: string[] = [];
	const expected = new Set(references.map((entry) => entry.file));
	if (references.length !== 38 || expected.size !== 38) failures.push("inventory must contain 38 unique references");
	const seen = new Set<string>();
	for (const file of captured) {
		if (seen.has(file)) failures.push(`duplicate capture: ${file}`);
		if (!expected.has(file)) failures.push(`unknown capture: ${file}`);
		seen.add(file);
	}
	for (const file of expected) if (!seen.has(file)) failures.push(`missing capture: ${file}`);
	return failures;
}
