/**
 * Returns the lowest available episode number that has not been watched.
 *
 * Catalogue membership is authoritative: missing episode numbers are never invented.
 */
export function nextUnwatchedEpisode(
	available: readonly number[],
	watched: ReadonlySet<number>,
): number | null {
	for (const episode of [...available].sort((left, right) => left - right)) {
		if (!watched.has(episode)) return episode;
	}
	return null;
}

/** Returns the nearest available episode numbers around a catalogue position. */
export function neighboringEpisodes(
	available: readonly number[],
	episode: number,
): { previous: number | null; next: number | null } {
	const sorted = [...available].sort((left, right) => left - right);
	const index = sorted.indexOf(episode);
	if (index === -1) {
		return {
			previous: sorted.filter((candidate) => candidate < episode).at(-1) ?? null,
			next: sorted.find((candidate) => candidate > episode) ?? null,
		};
	}
	return {
		previous: index > 0 ? sorted[index - 1]! : null,
		next: index < sorted.length - 1 ? sorted[index + 1]! : null,
	};
}
