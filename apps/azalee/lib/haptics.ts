/**
 * Haptic feedback via Vibration API.
 * Silently no-ops on unsupported devices.
 */
export function haptic(type: "light" | "medium" | "heavy" = "light") {
	if (typeof navigator === "undefined" || !navigator.vibrate) {
		return;
	}

	const patterns: Record<string, number> = {
		heavy: 40,
		light: 10,
		medium: 20,
	};

	try {
		navigator.vibrate(patterns[type]);
	} catch {
		// Silently fail
	}
}
