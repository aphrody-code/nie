import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageVfs } from "./stage-vfs";

test("canonical build stages only integrity-checked archives and publishes manifest last", () => {
	const directory = mkdtempSync(join(tmpdir(), "niers-vfs-stage-"));
	try {
		const bytes = new Uint8Array([1, 2, 3]);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const file = `menu_${sha256}.nievfs`;
		const manifest = { schemaVersion: 1, archives: [{ id: "menu", url: `/static/game/vfs/${file}`, bytes: 3, sha256, paths: ["data/menu"] }] };
		writeFileSync(join(directory, file), bytes);
		writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
		const output = join(directory, "output");
		expect(stageVfs(directory, output)).toBe(1);
		expect(new Uint8Array(readFileSync(join(output, "static/game/vfs", file)))).toEqual(bytes);
		expect(JSON.parse(readFileSync(join(output, "static/game/vfs/manifest.json"), "utf8"))).toEqual(manifest);
		writeFileSync(join(directory, file), new Uint8Array([9, 2, 3]));
		const corruptOutput = join(directory, "corrupt");
		expect(() => stageVfs(directory, corruptOutput)).toThrow("integrity mismatch");
		expect(existsSync(corruptOutput)).toBe(false);
		manifest.archives[0]!.url = "/static/../escape";
		writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
		expect(() => stageVfs(directory, corruptOutput)).toThrow("Invalid candidate archive reference");
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
