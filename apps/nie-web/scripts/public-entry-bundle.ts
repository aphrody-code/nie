/** Post-build contract for the framework-free public readiness path. */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SOURCE = {
	main: "/src/main.ts",
	bootstrap: "/src/public-bootstrap.ts",
	host: "/src/host-mount.tsx",
} as const;

interface SourceMapManifest {
	sources: string[];
}

interface BundleChunk {
	file: string;
	sources: string[];
}

function filesIn(dir: string, suffix: string, accumulator: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) filesIn(path, suffix, accumulator);
		else if (path.endsWith(suffix)) accumulator.push(path);
	}
	return accumulator;
}

function normalize(path: string): string {
	return path.replaceAll("\\", "/");
}

function chunkForSource(chunks: readonly BundleChunk[], suffix: string): BundleChunk {
	const found = chunks.filter((chunk) => chunk.sources.some((source) => normalize(source).endsWith(suffix)));
	if (found.length !== 1) throw new Error(`bundle gate: expected one chunk for ${suffix}, found ${found.length}`);
	return found[0] as BundleChunk;
}

function resolveChunk(bundle: string, importer: string, specifier: string): string | null {
	const clean = specifier.split(/[?#]/u, 1)[0] as string;
	if (clean.startsWith("/")) return resolve(bundle, clean.slice(1));
	if (clean.startsWith(".")) return resolve(dirname(importer), clean);
	return null;
}

function importsOf(bundle: string, chunk: BundleChunk): { static: string[]; dynamic: string[] } {
	const code = readFileSync(chunk.file, "utf8");
	const imports = new Bun.Transpiler({ loader: "js" }).scanImports(code);
	const resolveExisting = (kind: "import-statement" | "dynamic-import") => imports
		.filter((entry) => entry.kind === kind)
		.map((entry) => resolveChunk(bundle, chunk.file, entry.path))
		.filter((path): path is string => path !== null && existsSync(path));
	return {
		static: resolveExisting("import-statement"),
		dynamic: resolveExisting("dynamic-import"),
	};
}

/**
 * Inspect the actual Vite chunks after `vite build` and before precompression.
 *
 * This deliberately does not claim that the complete application is React-free. The React host
 * remains a compatibility chunk after readiness and on secondary routes; only the entry and
 * public-bootstrap static closure are forbidden from carrying it.
 */
export function assertPublicEntryBundle(bundle: string): void {
	const chunks = filesIn(bundle, ".js.map").map((mapFile): BundleChunk => {
		const manifest = JSON.parse(readFileSync(mapFile, "utf8")) as SourceMapManifest;
		if (!Array.isArray(manifest.sources)) throw new Error(`bundle gate: invalid source map ${relative(bundle, mapFile)}`);
		return { file: mapFile.slice(0, -4), sources: manifest.sources };
	});
	const byFile = new Map(chunks.map((chunk) => [resolve(chunk.file), chunk]));
	const main = chunkForSource(chunks, SOURCE.main);
	const bootstrap = chunkForSource(chunks, SOURCE.bootstrap);
	const host = chunkForSource(chunks, SOURCE.host);
	const mainImports = importsOf(bundle, main);

	if (!mainImports.dynamic.includes(resolve(bootstrap.file))) {
		throw new Error("bundle gate: public-bootstrap is not a dynamic import of the entry chunk");
	}
	if (!mainImports.dynamic.includes(resolve(host.file))) {
		throw new Error("bundle gate: compatibility host is not a dynamic import of the entry chunk");
	}

	const critical = new Set<BundleChunk>();
	const pending = [main, bootstrap];
	while (pending.length > 0) {
		const chunk = pending.pop();
		if (!chunk || critical.has(chunk)) continue;
		critical.add(chunk);
		for (const imported of importsOf(bundle, chunk).static) {
			const dependency = byFile.get(resolve(imported));
			if (dependency) pending.push(dependency);
		}
	}

	if (critical.has(host)) throw new Error("bundle gate: compatibility host entered the static readiness graph");
	const sources = [...critical].flatMap((chunk) => chunk.sources).map(normalize);
	const react = sources.find((source) => /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?react(?:-dom)?\//u.test(source));
	if (react) throw new Error(`bundle gate: React entered the static readiness graph through ${react}`);
	const hostModule = sources.find((source) => source.endsWith("/src/BrowserHost.tsx") || source.endsWith("/src/desktop/DesktopHost.tsx"));
	if (hostModule) throw new Error(`bundle gate: #nie-host entered the static readiness graph through ${hostModule}`);

	console.log(`public entry bundle: ${critical.size} critical chunks, 0 React modules, compatibility host dynamic`);
}
