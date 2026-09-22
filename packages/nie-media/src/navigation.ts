export function neighboringEpisodes(disponibles: readonly number[], numero: number): {
	previous: number | null;
	next: number | null;
} {
	const values = [...new Set(disponibles.filter(Number.isFinite))].sort((a, b) => a - b);
	return {
		previous: [...values].reverse().find((value) => value < numero) ?? null,
		next: values.find((value) => value > numero) ?? null,
	};
}

export function nextUnwatchedEpisode(disponibles: readonly number[], vus: ReadonlySet<number>, current = 0): number | null {
	return [...new Set(disponibles)].sort((a, b) => a - b).find((episode) => episode > current && !vus.has(episode)) ?? null;
}
