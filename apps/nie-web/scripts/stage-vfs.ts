/** Optional candidate assets join the canonical Vite build; this does not publish a release. */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { assertNePubliePas } from "./out-dir";

export function stageVfs(sourceDirectory: string, outputDirectory: string): number {
	assertNePubliePas(outputDirectory);
	const manifestBytes = readFileSync(join(sourceDirectory, "manifest.json"));
	const manifest = JSON.parse(manifestBytes.toString()) as {
		schemaVersion: number;
		archives: Array<{ id: string; url: string; bytes: number; sha256: string; paths: string[] }>;
	};
	if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.archives) || manifest.archives.length === 0) {
		throw new Error("Invalid candidate VFS manifest");
	}
	const ids = new Set<string>();
	const paths = new Set<string>();
	for (const archive of manifest.archives) {
		if (!/^[a-z_]+$/.test(archive.id) || !/^[a-f0-9]{64}$/.test(archive.sha256)
			|| archive.url !== `/static/game/vfs/${archive.id}_${archive.sha256}.nievfs`
			|| !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 || archive.bytes > 512 * 1024 * 1024
			|| !Array.isArray(archive.paths) || ids.has(archive.id)) throw new Error("Invalid candidate archive reference");
		ids.add(archive.id);
		for (const path of archive.paths) {
			if (typeof path !== "string" || !path.startsWith("data/") || path.includes("\\")
				|| path.split("/").some(segment => !segment || segment === "." || segment === "..") || paths.has(path)) {
				throw new Error("Invalid or duplicated candidate VFS path");
			}
			paths.add(path);
		}
		const bytes = readFileSync(join(sourceDirectory, basename(archive.url)));
		if (bytes.length !== archive.bytes || createHash("sha256").update(bytes).digest("hex") !== archive.sha256) {
			throw new Error("Candidate VFS integrity mismatch");
		}
	}
	const destination = join(outputDirectory, "static/game/vfs");
	mkdirSync(destination, { recursive: true });
	for (const archive of manifest.archives) {
		copyFileSync(join(sourceDirectory, basename(archive.url)), join(destination, basename(archive.url)));
	}
	// The manifest is the commit point: never advertise a partially validated candidate.
	writeFileSync(join(destination, "manifest.json"), manifestBytes);
	return manifest.archives.length;
}
