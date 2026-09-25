import { describe, expect, test } from "bun:test";
import { sourceFromEpisode, sourcePlayerUrl } from "./player.ts";

describe("sourceFromEpisode", () => {
	test("an 11-character video id is a YouTube source", () => {
		expect(sourceFromEpisode("dQw4w9WgXcQ", null)).toEqual({ platform: "youtube", id: "dQw4w9WgXcQ" });
		expect(sourceFromEpisode("a-b_c1234XY", "https://www.dailymotion.com/video/x8abc")).toEqual({
			platform: "youtube",
			id: "a-b_c1234XY",
		});
	});

	test("otherwise the Dailymotion id is read from the thumbnail URL", () => {
		expect(sourceFromEpisode("", "https://www.dailymotion.com/thumbnail/video/x8k2p9q")).toEqual({
			platform: "dailymotion",
			id: "x8k2p9q",
		});
		expect(sourceFromEpisode("episode-042x","https://s1.dmcdn.net/v/dm_x7zz1")).toEqual({ platform: "dailymotion", id: "x7zz1" });
	});

	test("no recognisable id gives no source rather than a guessed one", () => {
		expect(sourceFromEpisode("short", null)).toBeNull();
		expect(sourceFromEpisode("twelve-chars", "https://example.com/image.jpg")).toBeNull();
	});
});

describe("sourcePlayerUrl", () => {
	test("YouTube embeds use the no-cookie host without related videos", () => {
		expect(sourcePlayerUrl({ platform: "youtube", id: "dQw4w9WgXcQ" })).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
		);
	});

	test("Dailymotion embeds disable sharing", () => {
		expect(sourcePlayerUrl({ platform: "dailymotion", id: "x8k2p9q" })).toBe(
			"https://geo.dailymotion.com/player/x/embed/video/x8k2p9q?sharing-enable=false",
		);
	});

	test("a positive start offset is floored to whole seconds; zero or negative is omitted", () => {
		expect(sourcePlayerUrl({ platform: "youtube", id: "dQw4w9WgXcQ" }, 92.9)).toBe(
			"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=92",
		);
		expect(sourcePlayerUrl({ platform: "dailymotion", id: "x1" }, 30)).toBe(
			"https://geo.dailymotion.com/player/x/embed/video/x1?sharing-enable=false&start=30",
		);
		expect(sourcePlayerUrl({ platform: "youtube", id: "dQw4w9WgXcQ" }, 0)).not.toContain("start=");
		expect(sourcePlayerUrl({ platform: "youtube", id: "dQw4w9WgXcQ" }, -5)).not.toContain("start=");
	});

	test("the id is URL-encoded, so a crafted id cannot inject query parameters", () => {
		expect(sourcePlayerUrl({ platform: "youtube", id: "a&autoplay=1" })).toBe(
			"https://www.youtube-nocookie.com/embed/a%26autoplay%3D1?rel=0",
		);
	});
});
