import { expect, test } from "bun:test";
import {
	countGalleryRecords,
	filterGalleryRecords,
	galleryResourceKey,
	mergeGalleryRecords,
	type GalleryRecord,
} from "./gallery-collection";

interface Fixture extends GalleryRecord {
	id: string;
	needTokenNum: number;
}

const story: Fixture = {
	id: "sql-story", imgPath: "img_story_opening", category: "story",
	title: "Opening Match", needTokenNum: 25,
};
const storyRaster: Fixture = {
	id: "manifest-story", imgPath: "gallery_img2/img_story_opening.png", category: "gallery_img2",
	title: "Manifest Opening", needTokenNum: 0,
};
const stadium: Fixture = {
	id: "stadium", imgPath: "stadium/stadium_night.webp", category: "stadium",
	title: "Night Stadium", needTokenNum: 0,
};
const chronicle: Fixture = {
	id: "chronicle", imgPath: "img_chronicle_final", category: "chronicle",
	title: "Chronicle Final", needTokenNum: 10,
};

test("native paths, basename SQL identities and raster extensions identify the same image", () => {
	const paths = [
		"img_story_opening",
		"gallery_img2/img_story_opening.png",
		"/data/dx11/menu/220_img/gallery_img2/img_story_opening.g4tx",
		"dx11/menu/220_img/gallery_img2/img_story_opening.WEBP",
		"menu/220_img/gallery_img2/img_story_opening.png",
		"data\\dx11\\menu\\220_img\\gallery_img2\\img_story_opening.g4tx",
	];
	for (const path of paths) expect(galleryResourceKey(path)).toBe("gallery_img2/img_story_opening");
});

test("identical basenames in different folders and languages remain separate resources", () => {
	const paths = ["stadium/image.png", "ev_pic/image.g4tx", "hlp/fr/image.webp", "hlp/en/image.webp"];
	const records = paths.map((imgPath, id) => ({ ...stadium, id: String(id), imgPath }));
	expect(mergeGalleryRecords([], records)).toHaveLength(4);
	expect(new Set(records.map(item => galleryResourceKey(item.imgPath))).size).toBe(4);
});

test("SQL records take precedence over duplicate manifest resources without losing metadata", () => {
	const duplicateSql = { ...story, id: "later-sql", needTokenNum: 999 };
	const merged = mergeGalleryRecords([story, duplicateSql, chronicle], [storyRaster, stadium, { ...stadium }]);
	expect(merged).toEqual([story, chronicle, stadium]);
	expect(merged[0]).toBe(story);
	expect(merged[0]!.needTokenNum).toBe(25);
	expect(merged[0]!.category).toBe("story");
	expect(storyRaster.category).toBe("gallery_img2");
});

test("empty resource identities do not enter the merged inventory", () => {
	expect(mergeGalleryRecords([{ ...story, imgPath: "" }], [{ ...stadium, imgPath: "" }])).toEqual([]);
});

test("facet counts describe the deduplicated inventory without double counting a matching folder category", () => {
	const merged = mergeGalleryRecords([story, chronicle], [storyRaster, stadium]);
	const counts = countGalleryRecords(merged);
	expect(counts).toEqual({ all: 3, story: 1, chronicle: 1, gallery_img2: 2, stadium: 1 });
	for (const facet of ["all", "story", "chronicle", "gallery_img2", "stadium"]) {
		expect(filterGalleryRecords(merged, facet).length).toBe(counts[facet]!);
	}
});

test("semantic and folder filters select independent facets while unknown categories return no records", () => {
	const merged = mergeGalleryRecords([story, chronicle], [storyRaster, stadium]);
	expect(filterGalleryRecords(merged, "story")).toEqual([story]);
	expect(filterGalleryRecords(merged, "gallery_img2")).toEqual([story, chronicle]);
	expect(filterGalleryRecords(merged, "stadium")).toEqual([stadium]);
	expect(filterGalleryRecords(merged, "unknown")).toEqual([]);
	expect(filterGalleryRecords(merged, "all")).toEqual(merged);
	expect(filterGalleryRecords(merged, "menu")).toEqual(merged);
	expect(filterGalleryRecords(merged)).toEqual(merged);
});

test("search trims whitespace, ignores case and intersects title or path matches with the selected category", () => {
	const merged = mergeGalleryRecords([story, chronicle], [storyRaster, stadium]);
	expect(filterGalleryRecords(merged, undefined, "  OPENING match  ")).toEqual([story]);
	expect(filterGalleryRecords(merged, "gallery_img2", "IMG_CHRONICLE")).toEqual([chronicle]);
	expect(filterGalleryRecords(merged, "story", "night")).toEqual([]);
	expect(filterGalleryRecords(merged, "stadium", "NIGHT")).toEqual([stadium]);
	expect(filterGalleryRecords(merged, "gallery_img2", "  ")).toEqual([story, chronicle]);
	expect(merged).toEqual([story, chronicle, stadium]);
});
