import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./editor-view.css", import.meta.url), "utf8");
const editor = readFileSync(new URL("./EditorView.tsx", import.meta.url), "utf8");
const browser = readFileSync(new URL("./ContentBrowser.tsx", import.meta.url), "utf8");

describe("public editor responsive geometry", () => {
	test("contains intrinsic widths and stacks the inspector at the 720 px gate", () => {
		expect(css).toContain("contain: inline-size");
		expect(css).toContain("@media (max-width: 900px)");
		expect(css).toContain("flex-direction: column");
		expect(css).toContain("inline-size: 100% !important");
		expect(editor).toContain('import "./editor-view.css"');
	});

	test("wraps every content-browser control into the host width", () => {
		expect(css).toContain(".content-browser__toolbar");
		expect(css).toContain("flex-wrap: wrap");
		expect(css).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
		expect(browser).toContain("content-browser__filters");
		expect(browser).toContain("overflow-x-hidden");
	});

	test("keeps developer menu corpora out of the public read-only editor", () => {
		expect(editor).toContain('espace.id === "avatar-modeles"');
		expect(editor).toContain("authoring\n    ? ESPACES_TRAVAIL");
		expect(editor).toContain("visibleWorkspaces.map");
	});

	test("backs the public Details tab with the selected node transformation", () => {
		expect(editor).toContain("disabled={authoring ? !selectedCode : !selectedNodeInfo}");
		expect(editor).toContain('aria-label="Transformation en lecture seule"');
		expect(editor).toContain("vec3(selectedTransform.position)");
		expect(editor).toContain("vec3(selectedTransform.rotation, 180 / Math.PI)");
		expect(editor).toContain("vec3(selectedTransform.scale)");
	});

	test("keeps public interchange in an explicit responsive extension without developer tools", () => {
		expect(editor).toContain('aria-label="Extension import et export 3D"');
		expect(editor).toContain("Importer GLB");
		expect(editor).toContain("Texture PNG");
		expect(editor).toContain("Référence PNG");
		expect(editor).toContain("Exporter GLB");
		expect(editor).toContain("Exporter PNG");
		expect(css).toContain(".inacord-editor__extension-actions");
		expect(css).toContain("flex-basis: calc(50% - 0.25rem)");
		expect(editor).toContain("replaceModelTextureGlb(");
		expect(editor).toContain("revision: glbRevisions[p] ?? 0");
		expect(editor).toContain("nouveau GLB validé par Rust, rechargé dans le viewport");
	});

	test("imports OC documents through the shared Rust contract without browser filesystem writes", () => {
		expect(editor).toContain("importAvatarReference(catalog, INITIAL_AVATAR_STATE");
		expect(editor).toContain('item.kind === "glb" || item.kind === "png"');
		expect(editor).toContain("aucune écriture dans");
		expect(editor).not.toContain("writeOverride(");
	});
});
