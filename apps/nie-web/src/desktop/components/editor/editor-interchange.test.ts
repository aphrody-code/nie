import { describe, expect, mock, test } from "bun:test";

mock.module("../../../game/model-render", () => ({
	inspectModelGlb: async (bytes: Uint8Array) => {
		if (bytes[0] === 0) throw new Error("GLB refusé");
		return { primitives: 4, textures: 2, textureSizes: [[64, 64], [32, 16]], textureNames: ["body", null] };
	},
	validateEditorPng: async (bytes: Uint8Array) => {
		if (bytes[0] !== 0x89 || bytes.length < 9) throw new Error("PNG refusé par Rust");
		return [640, 360] as const;
	},
}));

const { editorExportName, importEditorGlb, importEditorPng, MAX_EDITOR_GLB_BYTES } = await import("./editor-interchange");

describe("editor interchange admission", () => {
	test("passes a bounded GLB through the Rust inspection owner", async () => {
		const result = await importEditorGlb(new File([new Uint8Array([1, 2, 3])], "local.glb"));
		expect(result.name).toBe("local.glb");
		expect(result.inspection).toEqual({
			primitives: 4,
			textures: 2,
			textureSizes: [[64, 64], [32, 16]],
			textureNames: ["body", null],
		});
	});

	test("rejects wrong extensions, empty files, and oversized GLBs before parsing", async () => {
		expect(importEditorGlb(new File([new Uint8Array([1])], "local.gltf"))).rejects.toThrow(".glb");
		expect(importEditorGlb(new File([], "empty.glb"))).rejects.toThrow("vide");
		const huge = { name: "huge.glb", size: MAX_EDITOR_GLB_BYTES + 1 } as File;
		expect(importEditorGlb(huge)).rejects.toThrow("volumineux");
	});

	test("admits PNG references through Rust without building a base64 URL", async () => {
		const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
		const file = new File([signature], "reference.png", { type: "image/png" });
		const png = await importEditorPng(file);
		expect([png.width, png.height]).toEqual([640, 360]);
		expect(png.blob).toBe(file);
		expect(png).not.toHaveProperty("dataUrl");
		expect(importEditorPng(new File([new Uint8Array([1, 2, 3])], "fake.png"))).rejects.toThrow("Rust");
	});

	test("sanitizes exported names", () => {
		expect(editorExportName("C:\\refs\\my model.final.glb", "png")).toBe("my_model_final.png");
		expect(editorExportName("", "glb")).toBe("scene.glb");
	});
});
