import { describe, expect, test } from "bun:test";
import type { FilmDto } from "../desktop/lib/bindings";
import {
	adjacentPlayableCueIndex,
	audioCueFileName,
	audioCueSourceUrl,
	filterSemanticMovies,
	movieCatalogStateFromUrl,
} from "./CatalogMedia";

describe("catalogue audio cue controls", () => {
	test("moves to the nearest cue backed by a waveform", () => {
		const cues = [
			{ awbId: 10 },
			{ awbId: null },
			{ awbId: 12 },
			{ awbId: null },
			{ awbId: 14 },
		];

		expect(adjacentPlayableCueIndex(cues, 0, -1)).toBe(-1);
		expect(adjacentPlayableCueIndex(cues, 0, 1)).toBe(2);
		expect(adjacentPlayableCueIndex(cues, 4, -1)).toBe(2);
		expect(adjacentPlayableCueIndex(cues, 4, 1)).toBe(-1);
	});

	test("creates a flat WAV download name from a native cue label", () => {
		expect(audioCueFileName("ev01/00200: intro")).toBe("ev01_00200_ intro.wav");
		expect(audioCueFileName("   ")).toBe("cue.wav");
	});

	test("uses the host Rust decoder URL with the exact AFS2 cue id", () => {
		const seen: Array<[string, number | null | undefined]> = [];
		const source = {
			urlAudio(path: string, awbId?: number | null) {
				seen.push([path, awbId]);
				return `/assets/audio/${path}?id=${awbId}`;
			},
		};

		expect(audioCueSourceUrl(source, "data/common/sound_asset/en/ev01_0.acb", 0))
			.toBe("/assets/audio/data/common/sound_asset/en/ev01_0.acb?id=0");
		expect(audioCueSourceUrl(source, "data/common/sound_asset/en/ev01_0.acb", null)).toBeNull();
		expect(seen).toEqual([["data/common/sound_asset/en/ev01_0.acb", 0]]);
	});
});

describe("semantic movie catalogue", () => {
	const film = (nom: string, rubrique: string, langue: string | null): FilmDto => ({
		chemin: `data/common/movie/${nom}.usm`,
		nom,
		rubrique,
		langue,
		octets: 10,
		codec: null,
		lisible: null,
		largeur: null,
		hauteur: null,
		images: null,
		cadence: null,
		duree: null,
		audio: [],
		chiffre: null,
		nom_origine: null,
		bgm: null,
		sous_titres: null,
	});

	test("restores shareable Rust catalogue filters and a bounded page", () => {
		expect(movieCatalogStateFromUrl("?q=story&rubrique=Chapitre%2001&langue=fr&page=3")).toEqual({
			q: "story",
			rubric: "Chapitre 01",
			language: "fr",
			page: 3,
		});
		expect(movieCatalogStateFromUrl("?page=-4").page).toBe(1);
	});

	test("filters the semantic films without duplicating their grouping rules", () => {
		const films = [
			film("ev01_00050_fr", "Chapitre 01", "fr"),
			film("ev01_00060_JP", "Chapitre 01", "JP"),
			film("title", "Écrans-titres", null),
		];
		expect(filterSemanticMovies(films, { q: "00050", rubric: null, language: null })).toEqual([films[0]]);
		expect(filterSemanticMovies(films, { q: "", rubric: "Chapitre 01", language: "JP" })).toEqual([films[1]]);
	});
});
