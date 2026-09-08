import { describe, expect, test } from "bun:test";
import type { AvatarComposition } from "./contract";
import { avatarModelUrl } from "./request";

const composition: AvatarComposition = {
	pieces: [{ directory: "_bodySK", name: "skeleton" }, { directory: "_facebase", name: "face" }],
	faceLayers: ["00_face/face_00", "01_eye/eye_01"], morphology: "female", morphologyIndex: 1,
	skeleton: "skeleton", height: 0, skinColor: "ABCDEF", irisColor: "112233", hairColor: "445566", warnings: [],
};

describe("shared avatar HTTP binding", () => {
	test("web and desktop produce the same resource request from the Rust composition", () => {
		const web = new URL(avatarModelUrl(composition, "https://example.invalid/assets/"));
		const desktop = avatarModelUrl(composition, "").replace(/^\//, "");
		expect(web.pathname).toBe("/assets/model-avatar/_bodySK/skeleton+_facebase/face.glb");
		expect(web.pathname.replace("/assets/", "") + web.search).toBe(desktop);
		expect(web.searchParams.get("face")).toBe("00_face/face_00,01_eye/eye_01");
		expect(web.searchParams.get("morpho")).toBe("female");
		expect(web.searchParams.get("taille")).toBe("0");
		expect(web.searchParams.get("tint")).toBe("ABCDEF,112233,FFFFFF");
		expect(web.searchParams.get("hair")).toBe("445566");
	});

	test("unset settings preserve the existing assembler defaults without heuristic morphs", () => {
		const url = new URL(avatarModelUrl({ ...composition, height: null, skinColor: null, irisColor: null, hairColor: null, faceLayers: [] }), "https://example.invalid");
		expect([...url.searchParams.keys()]).toEqual(["morpho"]);
		expect(url.searchParams.has("forme")).toBe(false);
		expect(url.searchParams.has("habits")).toBe(false);
	});
});
