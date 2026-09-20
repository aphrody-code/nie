import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { assertPublicEntryBundle } from "./public-entry-bundle";

let bundle: string | null = null;
afterEach(() => {
	if (bundle) rmSync(bundle, { recursive: true, force: true });
	bundle = null;
});

function fixture({ reactInBootstrap = false, hostStatic = false } = {}): string {
	bundle = mkdtempSync(join(tmpdir(), "nie-public-entry-bundle-"));
	const staticDir = join(bundle, "static");
	mkdirSync(staticDir);
	const writeChunk = (name: string, code: string, sources: string[]) => {
		writeFileSync(join(staticDir, `${name}.js`), code);
		writeFileSync(join(staticDir, `${name}.js.map`), JSON.stringify({ version: 3, sources, mappings: "" }));
	};
	writeChunk(
		"main-00000000",
		`${hostStatic ? 'import "./host-00000000.js";' : ''}import("./bootstrap-00000000.js");import("./host-00000000.js");`,
		["../../../src/main.ts"],
	);
	writeChunk("bootstrap-00000000", reactInBootstrap ? 'import "./react-00000000.js";' : "export{};", ["../../../src/public-bootstrap.ts"]);
	writeChunk("host-00000000", 'import "./react-00000000.js";', ["../../../src/host-mount.tsx", "../../../src/BrowserHost.tsx"]);
	writeChunk("react-00000000", "export{};", ["../../../../node_modules/.bun/react@19.2.8/node_modules/react/index.js"]);
	return bundle;
}

test("accepts a React compatibility host which is only dynamically imported", () => {
	expect(() => assertPublicEntryBundle(fixture())).not.toThrow();
});

test("rejects React in the public-bootstrap static closure", () => {
	expect(() => assertPublicEntryBundle(fixture({ reactInBootstrap: true }))).toThrow(/React entered/);
});

test("rejects a statically imported compatibility host", () => {
	expect(() => assertPublicEntryBundle(fixture({ hostStatic: true }))).toThrow(/static readiness graph/);
});
