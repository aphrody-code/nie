/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calcule un hash simple pour détecter les modifications de texte.
 */
export function computeStringHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = (hash << 5) - hash + str.charCodeAt(i);
		hash |= 0;
	}
	return hash.toString(36);
}

/**
 * Découpe un texte long en blocs (chunks) sémantiques récursifs.
 */
export function chunkText(text: string, chunkSize = 800, chunkOverlap = 150): string[] {
	const separators = ["\n\n", "\n", ". ", " ", ""];

	function splitText(txt: string, separator: string): string[] {
		return txt.split(separator);
	}

	function recurse(txt: string, currentSeparatorIndex: number): string[] {
		if (txt.length <= chunkSize) {
			return [txt];
		}

		const separator = separators[currentSeparatorIndex];
		if (separator === undefined) {
			const chunks: string[] = [];
			const step = chunkSize - chunkOverlap;
			for (let i = 0; i < txt.length; i += step > 0 ? step : chunkSize) {
				chunks.push(txt.slice(i, i + chunkSize));
			}
			return chunks;
		}

		const splits = splitText(txt, separator);
		const chunks: string[] = [];
		let currentChunk = "";

		for (const split of splits) {
			if (split.length > chunkSize) {
				if (currentChunk) {
					chunks.push(currentChunk.trim());
					currentChunk = "";
				}
				const subChunks = recurse(split, currentSeparatorIndex + 1);
				chunks.push(...subChunks);
			} else if (currentChunk.length + split.length + separator.length > chunkSize) {
				if (currentChunk) {
					chunks.push(currentChunk.trim());
				}
				let overlapStart = Math.max(0, currentChunk.length - chunkOverlap);
				if (overlapStart > 0) {
					const nextSpace = currentChunk.indexOf(" ", overlapStart);
					const prevSpace = currentChunk.lastIndexOf(" ", overlapStart);

					if (nextSpace !== -1 && overlapStart - prevSpace > nextSpace - overlapStart) {
						overlapStart = nextSpace + 1;
					} else if (prevSpace !== -1) {
						overlapStart = prevSpace + 1;
					}
				}
				currentChunk = currentChunk.slice(overlapStart) + (currentChunk ? separator : "") + split;
			} else {
				currentChunk += (currentChunk ? separator : "") + split;
			}
		}

		if (currentChunk) {
			chunks.push(currentChunk.trim());
		}

		return chunks.filter((c) => c.length > 30);
	}

	return recurse(text, 0);
}
