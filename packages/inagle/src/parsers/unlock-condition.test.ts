import { describe, expect, it } from "vitest";
import { crc32String } from "./hash/crc32.js";
import {
	buildEventCrcLookup,
	decodeUnlockCondition,
	STORY_EPISODE_BASE,
	STORY_EPISODE_STEP,
	storyThresholdToEpisode,
} from "./unlock-condition.js";

// Fixtures reels extraits de gallery_config / scene_archive_config (cf. donnees IEVR).
const STORY_EV01 = "AAAAAA8FNbkZNtoAAQAyAABOKnE="; // gallery openCond, seuil 20010
const SCENE_EV01_00050 = "AAAAABgFNSo9RUMACgEoAAYCNNG3Zz4yAAAAAXg="; // condition -> ev01_00150
const TRIVIAL = Buffer.from("1802cb11163f20d14e", "hex").toString("base64");
const COMPOSITE_0B = Buffer.from(
	"00000000300b35b91936da000100320000c35a7135dafab70a0013022800060234c05d8c3b2800060232000000013200000001788f",
	"hex"
).toString("base64");
const COMPOSITE_17 = Buffer.from(
	"0000000048173200000001352a3d4543000a0128000602344dea45163200000001788f32000000018f3200000001352a3d4543000a01280006023456b7ca0e3200000001788f32000000018f90",
	"hex"
).toString("base64");

describe("storyThresholdToEpisode", () => {
	it("mappe les seuils sur les episodes ev01..ev08", () => {
		expect(storyThresholdToEpisode(STORY_EPISODE_BASE)).toBe(1);
		expect(storyThresholdToEpisode(STORY_EPISODE_BASE + STORY_EPISODE_STEP)).toBe(2);
		expect(storyThresholdToEpisode(90010)).toBe(8);
	});

	it("renvoie undefined pour un seuil non aligne", () => {
		expect(storyThresholdToEpisode(12345)).toBeUndefined();
		expect(storyThresholdToEpisode(0)).toBeUndefined();
	});
});

describe("decodeUnlockCondition - story", () => {
	it("decode un seuil de progression (ev01 = 20010)", () => {
		const c = decodeUnlockCondition(STORY_EV01);
		expect(c.type).toBe("story");
		expect(c.op).toBe("single");
		expect(c.storyThreshold).toBe(20010);
		expect(c.storyEpisode).toBe(1);
		expect(c.requiredEvents).toHaveLength(0);
	});

	it("verifie la grille +10000/episode jusqu'a ev08", () => {
		// Reconstruit chaque seuil et verifie l'episode deduit.
		for (let ep = 1; ep <= 8; ep++) {
			const threshold = STORY_EPISODE_BASE + (ep - 1) * STORY_EPISODE_STEP;
			expect(storyThresholdToEpisode(threshold)).toBe(ep);
		}
	});
});

describe("decodeUnlockCondition - event-flag (CRC32)", () => {
	it("decode une feuille event-flag et resout le CRC32", () => {
		const lookup = buildEventCrcLookup(["ev01_00150"]);
		const c = decodeUnlockCondition(SCENE_EV01_00050, (crc) => lookup.get(crc));
		expect(c.type).toBe("eventFlag");
		expect(c.requiredEvents).toHaveLength(1);
		const ev = c.requiredEvents[0];
		// CRC32 poly 0xEDB88320 de "ev01_00150"
		expect(ev.crc).toBe(crc32String("ev01_00150") >>> 0);
		expect(ev.crcHex).toBe("0xD1B7673E");
		expect(ev.count).toBe(1);
		expect(ev.eventId).toBe("ev01_00150");
	});

	it("laisse eventId indefini sans reverse-lookup", () => {
		const c = decodeUnlockCondition(SCENE_EV01_00050);
		expect(c.requiredEvents[0].eventId).toBeUndefined();
		expect(c.requiredEvents[0].crc).toBe(crc32String("ev01_00150") >>> 0);
	});
});

describe("decodeUnlockCondition - composite (AND)", () => {
	it("combine seuil story + event-flag (opcode 0x0B)", () => {
		const c = decodeUnlockCondition(COMPOSITE_0B);
		expect(c.type).toBe("composite");
		expect(c.op).toBe("and");
		expect(c.storyThreshold).toBe(50010);
		expect(c.storyEpisode).toBe(4);
		expect(c.requiredEvents).toHaveLength(1);
		expect(c.requiredEvents[0].namespace).toBe("0xDAFAB70A");
	});

	it("combine deux event-flags (opcode 0x17)", () => {
		const c = decodeUnlockCondition(COMPOSITE_17);
		expect(c.type).toBe("eventFlag");
		expect(c.op).toBe("and");
		expect(c.requiredEvents).toHaveLength(2);
		expect(c.requiredEvents[0].crc).toBe(crc32String("ev04_02110") >>> 0);
		expect(c.requiredEvents[0].crcHex).toBe("0x4DEA4516");
		expect(c.requiredEvents.every((e) => e.namespace === "0x2A3D4543")).toBe(true);
	});
});

describe("decodeUnlockCondition - trivial / vide", () => {
	it("traite l'opcode 0x3F comme toujours debloque", () => {
		const c = decodeUnlockCondition(TRIVIAL);
		expect(c.type).toBe("always");
		expect(c.op).toBe("none");
		expect(c.requiredEvents).toHaveLength(0);
	});

	it("traite une entree vide comme toujours debloque", () => {
		const c = decodeUnlockCondition("");
		expect(c.type).toBe("always");
		expect(decodeUnlockCondition(null).type).toBe("always");
		expect(decodeUnlockCondition(undefined).type).toBe("always");
	});
});
