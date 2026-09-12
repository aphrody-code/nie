import { describe, expect, test } from "bun:test";
import {
	filterGallery,
	galleryCollections,
	galleryTotals,
	GALLERY_FAMILIES,
	type GalleryData,
} from "./gallery";
import { listPage, stepCursor } from "./list-page";

const DATA: GalleryData = {
	trophies: [
		{ trophy_id: "0x7D48804A", code: "activity_story_miniquest_001", name: "Vieil homme qui a perdu sa clé", description: "Offrir son aide.", category: 1, story_episode: null, unlock_kind: "story" },
		{ trophy_id: "0xE441D1F0", code: "activity_story_miniquest_002", name: null, description: null, category: 1, story_episode: 4, unlock_kind: "story" },
	],
	gallery: [
		{ gallery_id: "0x33AF67B0", img_path: "img_story_ev01_main_0010", thumb_path: "thumb_story_ev01_main_0010", story_episode: 1, need_token_num: 1, unlock_kind: "story" },
	],
	movies: [
		{ movie_id: "0x15F883E4", movie_path: "common/movie/ev90_00100.usm", has_subtitles: false, staffroll_data_name: "ed_01" },
		{ movie_id: "0x688F77A1", movie_path: null, has_subtitles: true, staffroll_data_name: null },
	],
	musics: [
		{ entry_id: "0x45B73F82", music_id: "0x628A4DD8", name: null, track_no: 2, sort_index: 1, has_path: true },
	],
};

describe("gallery collections", () => {
	test("builds the four families the API serves, in the screen's order", () => {
		const collections = galleryCollections(DATA, null);
		expect(collections.map((collection) => collection.id)).toEqual(GALLERY_FAMILIES.map((family) => family.id));
		expect(collections.map((collection) => collection.items.length)).toEqual([2, 1, 2, 1]);
	});

	test("the typed fallback unlocks everything and says where it comes from", () => {
		const collections = galleryCollections(DATA, null);
		expect(collections.every((collection) => collection.origin === "game-data")).toBe(true);
		expect(collections.every((collection) => collection.items.every((item) => item.unlocked))).toBe(true);
		expect(galleryTotals(collections)).toEqual({ total: 6, unlocked: 6 });
	});

	test("the profile counters own the progression when they answer", () => {
		const collections = galleryCollections(DATA, {
			trophies: { total: 347, unlocked: 1 },
			gallery: { total: 360, unlocked: 360 },
			movies: { total: 219, unlocked: 219 },
			musics: { total: 108, unlocked: 108 },
		});
		expect(collections[0]?.origin).toBe("profile");
		expect(collections[0]?.progress).toEqual({ total: 347, unlocked: 1 });
		expect(collections[0]?.items.map((item) => item.unlocked)).toEqual([true, false]);
		expect(galleryTotals(collections)).toEqual({ total: 1034, unlocked: 688 });
	});

	test("labels never invent a title the data does not carry", () => {
		const [trophies, gallery, movies, musics] = galleryCollections(DATA, null);
		expect(trophies?.items[0]?.label).toBe("Vieil homme qui a perdu sa clé");
		// Sans nom, le code du succès — pas un libellé fabriqué.
		expect(trophies?.items[1]?.label).toBe("activity_story_miniquest_002");
		expect(gallery?.items[0]?.label).toBe("img_story_ev01_main_0010");
		expect(movies?.items[0]?.label).toBe("ev90_00100.usm");
		// Les musiques n'ont pas de nom dans la donnée : numéro de piste et identifiant.
		expect(musics?.items[0]?.label).toBe("Piste 2");
		expect(musics?.items[0]?.moviePath).toBeNull();
	});

	test("only a movie with a real VFS path is playable", () => {
		const movies = galleryCollections(DATA, null)[2];
		expect(movies?.items.map((item) => item.moviePath)).toEqual(["common/movie/ev90_00100.usm", null]);
	});

	test("the search reads the label and the detail, accent-insensitively", () => {
		const trophies = galleryCollections(DATA, null)[0]?.items ?? [];
		expect(filterGallery(trophies, "cle").map((item) => item.id)).toEqual(["0x7D48804A"]);
		expect(filterGallery(trophies, "offrir").map((item) => item.id)).toEqual(["0x7D48804A"]);
		expect(filterGallery(trophies, "")).toHaveLength(2);
	});
});

describe("list pagination", () => {
	const items = Array.from({ length: 47 }, (_, index) => index);

	test("the page follows the cursor and never leaves the bounds", () => {
		expect(listPage(items, 0, 20)).toMatchObject({ index: 0, count: 3, cursor: 0, cursorInPage: 0 });
		expect(listPage(items, 25, 20)).toMatchObject({ index: 1, cursor: 25, cursorInPage: 5 });
		expect(listPage(items, 999, 20)).toMatchObject({ index: 2, cursor: 46, cursorInPage: 6 });
		expect(listPage([], 3, 20)).toMatchObject({ index: 0, count: 1, cursor: -1, cursorInPage: -1, items: [] });
		expect(() => listPage(items, 0, 0)).toThrow();
	});

	test("the cursor steps by item, row and page without wrapping", () => {
		expect(stepCursor(0, 47, "item", 1, 5, 20)).toBe(1);
		expect(stepCursor(0, 47, "row", 1, 5, 20)).toBe(5);
		expect(stepCursor(0, 47, "page", 1, 5, 20)).toBe(20);
		expect(stepCursor(0, 47, "item", -1, 5, 20)).toBe(0);
		expect(stepCursor(46, 47, "page", 1, 5, 20)).toBe(46);
		expect(stepCursor(0, 0, "item", 1, 5, 20)).toBe(-1);
	});
});
