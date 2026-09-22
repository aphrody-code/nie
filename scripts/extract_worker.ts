import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type Player = "byron" | "shawn";
type AssetKind = "modele" | "texture" | "son" | "video" | "texte" | "donnee" | "preview";

interface CharacterCode {
	code: string;
	player: Player;
	label: string;
	series: string;
	faceDir?: string;
}

interface RemoteEntry {
	chemin?: string;
	path?: string;
	nom?: string;
	name?: string;
	taille?: number;
	size?: number;
	cpk?: string;
}

interface DownloadTask {
	id: string;
	player: Player;
	code?: string;
	kind: AssetKind;
	source: "vfs" | "model" | "api";
	vfsPath?: string;
	url: string;
	localPath: string;
	minBytes: number;
	expectedBytes?: number;
}

interface ManifestEntry extends DownloadTask {
	sizeBytes: number;
	sha256: string;
	status: "downloaded" | "existing";
}

const BASE_URL = "https://nie.aphrody.com";
const ROOT = path.resolve("data/ref/afubuki");
const META_DIR = path.join(ROOT, "meta");
const CONCURRENCY = 6;

const KNOWN_CODES: CharacterCode[] = [
	{ code: "c01001900", player: "byron", label: "Byron Love / Aphrodi IE1", series: "01_IE1", faceDir: "data/common/chr/_face/01_IE1/c01001900" },
	{ code: "c05026590", player: "byron", label: "Byron Love / Aphrodi GO", series: "05_GO2", faceDir: "data/common/chr/_face/05_GO2/c05026590" },
	{ code: "c07080010", player: "byron", label: "Byron Love / Aphrodi Ares", series: "07_ARES", faceDir: "data/common/chr/_face/07_ARES/c07080010" },
	{ code: "c02023290", player: "shawn", label: "Shawn Froste / Shirou Fubuki IE2", series: "02_IE2", faceDir: "data/common/chr/_face/02_IE2/c02023290" },
	{ code: "c02023370", player: "shawn", label: "Shawn Froste / Shirou Fubuki IE2 variant", series: "02_IE2", faceDir: "data/common/chr/_face/02_IE2/c02023370" },
	{ code: "c02023380", player: "shawn", label: "Atsuya / Fubuki IE2 variant", series: "02_IE2", faceDir: "data/common/chr/_face/02_IE2/c02023380" },
	{ code: "c05024700", player: "shawn", label: "Shawn Froste / Shirou Fubuki GO", series: "05_GO2", faceDir: "data/common/chr/_face/05_GO2/c05024700" },
	{ code: "c07090010", player: "shawn", label: "Shawn Froste / Shirou Fubuki Ares", series: "07_ARES", faceDir: "data/common/chr/_face/07_ARES/c07090010" },
	{ code: "c11902360", player: "shawn", label: "Shawn Froste / Shirou Fubuki Victory Road", series: "11_VICTORY", faceDir: "data/common/chr/_face/11_VICTORY/c11902360" },
	{ code: "c11908200", player: "shawn", label: "Shawn Froste / Shirou Fubuki Victory Road mirror", series: "11_VICTORY" },
];

const HASHES = {
	byron: ["0x4b2792b9", "0x67b94fdf", "0x692de197", "0x80a79f5e", "0xb6f181e9", "0x93850195"],
	shawn: ["0x77914767", "0xe8d000de", "0x6f481c11", "0x1f22e89e", "0x76532d50", "0x79abd642", "0xd9cc895f", "0xf8e838f2", "0xc2d71d92", "0x8b91a859", "0x412af058"],
};

const TEXT_QUERIES = [
	"aphrodi", "aphrodite", "byron", "terumi", "afuro", "亜風炉", "照美",
	"fubuki", "shirou", "shawn", "froste", "atsuya", "吹雪", "士郎",
	"god knows", "god break", "heaven", "chaos break",
	"eternal blizzard", "wolf legend", "wyvern blizzard", "cross fire", "snow angel",
];

function apiUrl(route: string, params: Record<string, string | number | undefined> = {}): string {
	const url = new URL(route, BASE_URL);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) url.searchParams.set(key, String(value));
	}
	return url.toString();
}

function fileNameFromVfs(vfsPath: string): string {
	return vfsPath.split("/").pop() ?? "asset.bin";
}

function kindFromPath(vfsPath: string): AssetKind {
	const ext = path.extname(vfsPath).toLowerCase();
	if ([".g4md", ".g4mg", ".g4sk", ".g4mt", ".g4pk", ".g4pkm"].includes(ext)) return "modele";
	if ([".g4tx", ".dds", ".png"].includes(ext)) return "texture";
	if ([".acb", ".awb", ".hca", ".adx", ".wav"].includes(ext)) return "son";
	if ([".usm", ".mp4", ".webm"].includes(ext)) return "video";
	if (ext === ".bin" || ext === ".cfg") return "donnee";
	return "donnee";
}

function localPathForVfs(player: Player, code: string, vfsPath: string): string {
	const kind = kindFromPath(vfsPath);
	const fileName = fileNameFromVfs(vfsPath);
	if (kind === "modele") return path.join(ROOT, "modeles", player, code, fileName);
	if (kind === "texture") return path.join(ROOT, "textures", player, code, fileName);
	if (kind === "son") return path.join(ROOT, "sons", player, fileName);
	if (kind === "video") return path.join(ROOT, "videos", fileName);
	return path.join(ROOT, "texte", "api", fileName.replace(/[^\w.-]+/g, "_"));
}

async function fetchJson<T>(url: string, retries = 4): Promise<T> {
	for (let attempt = 0; attempt <= retries; attempt += 1) {
		const response = await fetch(url, { headers: { accept: "application/json" } });
		if (response.ok) return await response.json() as T;
		if (![429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
			throw new Error(`HTTP ${response.status} ${url}`);
		}
		await Bun.sleep(500 * 2 ** attempt);
	}
	throw new Error(`retry exhausted ${url}`);
}

async function queryEntries(route: string, q: string, limit = 200): Promise<RemoteEntry[]> {
	const json = await fetchJson<{ elements?: RemoteEntry[]; results?: { elements?: RemoteEntry[] } }>(apiUrl(route, { q, limit }));
	return json.elements ?? json.results?.elements ?? [];
}

async function collectRemoteEntries(): Promise<Map<string, RemoteEntry>> {
	const entries = new Map<string, RemoteEntry>();
	const add = (entry: RemoteEntry) => {
		const chemin = entry.chemin ?? entry.path;
		if (chemin) entries.set(chemin, entry);
	};

	for (const item of KNOWN_CODES) {
		for (const route of ["/api/v1/modeles", "/api/v1/textures", "/api/v1/sons", "/api/v1/videos"]) {
			for (const entry of await queryEntries(route, item.code)) add(entry);
		}
		if (item.faceDir) {
			for (const ext of ["g4md", "g4mg"]) {
				add({ chemin: `${item.faceDir}/${item.code}.${ext}` });
			}
			add({ chemin: `data/dx11/chr/_face/${item.series}/${item.code}/${item.code}.g4tx` });
			if (item.code === "c02023290") add({ chemin: `data/dx11/chr/_face/${item.series}/${item.code}/${item.code}_03.g4tx` });
		}
	}

	for (const glob of ["*aphrodi*", "*afuro*", "*fubuki*", "*shirou*", "*atsuya*"]) {
		const page = await fetchJson<{ elements?: RemoteEntry[] }>(apiUrl("/api/v1/tout", { glob, limit: 200, page: 1 }));
		for (const entry of page.elements ?? []) add(entry);
	}

	return entries;
}

async function collectText(): Promise<Record<string, unknown>> {
	const output: Record<string, unknown> = {};
	for (const lang of ["fr", "en", "ja"]) {
		const langResults: Record<string, unknown> = {};
		for (const q of TEXT_QUERIES) {
			try {
				const json = await fetchJson<unknown>(apiUrl("/api/v1/text/search", { q, language: lang }));
				langResults[q] = json;
			} catch (error) {
				langResults[q] = { error: String(error) };
			}
			await Bun.sleep(80);
		}
		output[lang] = langResults;
		await mkdir(path.join(ROOT, "texte", lang), { recursive: true });
		await writeFile(path.join(ROOT, "texte", lang, "search-results.json"), JSON.stringify(langResults, null, 2));
	}
	return output;
}

function buildTasks(entries: Map<string, RemoteEntry>): DownloadTask[] {
	const tasks = new Map<string, DownloadTask>();
	const add = (task: DownloadTask) => tasks.set(task.localPath, task);

	for (const item of KNOWN_CODES.filter((code) => code.faceDir)) {
		add({
			id: `glb:${item.code}`,
			player: item.player,
			code: item.code,
			kind: "modele",
			source: "model",
			url: `${BASE_URL}/model/perso/${item.code}.glb`,
			localPath: path.join(ROOT, "modeles", item.player, `${item.code}.glb`),
			minBytes: 1024 * 1024,
		});
		add({
			id: `preview:${item.code}`,
			player: item.player,
			code: item.code,
			kind: "preview",
			source: "model",
			url: `${BASE_URL}/model/perso/${item.code}.png`,
			localPath: path.join(ROOT, "textures", item.player, `${item.code}-preview.png`),
			minBytes: 512,
		});
	}

	for (const [vfsPath, entry] of entries) {
		const code = KNOWN_CODES.find((item) => vfsPath.includes(item.code));
		if (!code || !code.faceDir) continue;
		const kind = kindFromPath(vfsPath);
		if (!["modele", "texture", "son", "video"].includes(kind)) continue;
		add({
			id: `vfs:${vfsPath}`,
			player: code.player,
			code: code.code,
			kind,
			source: "vfs",
			vfsPath,
			url: `${BASE_URL}/f/${vfsPath}`,
			localPath: localPathForVfs(code.player, code.code, vfsPath),
			minBytes: kind === "modele" ? 1 : 128,
			expectedBytes: entry.taille ?? entry.size,
		});
	}

	return [...tasks.values()].sort((a, b) => a.localPath.localeCompare(b.localPath));
}

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	hash.update(await readFile(filePath));
	return hash.digest("hex");
}

async function downloadTask(task: DownloadTask): Promise<ManifestEntry> {
	await mkdir(path.dirname(task.localPath), { recursive: true });
	try {
		const current = await stat(task.localPath);
		if (current.size >= task.minBytes && (!task.expectedBytes || current.size === task.expectedBytes)) {
			return { ...task, sizeBytes: current.size, sha256: await sha256File(task.localPath), status: "existing" };
		}
	} catch {
		// file missing: download below
	}

	for (let attempt = 0; attempt < 5; attempt += 1) {
		const response = await fetch(task.url);
		if (response.ok) {
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength < task.minBytes) throw new Error(`too small ${task.url}: ${bytes.byteLength}`);
			const tempPath = `${task.localPath}.tmp-${process.pid}`;
			await Bun.write(tempPath, bytes);
			await rename(tempPath, task.localPath);
			return { ...task, sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), status: "downloaded" };
		}
		if (![429, 500, 502, 503, 504, 404].includes(response.status) || attempt === 4) {
			throw new Error(`HTTP ${response.status} ${task.url}`);
		}
		await Bun.sleep(600 * 2 ** attempt);
	}
	throw new Error(`retry exhausted ${task.url}`);
}

async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	let index = 0;
	async function loop(): Promise<void> {
		for (;;) {
			const item = items[index];
			index += 1;
			if (!item) return;
			results.push(await worker(item));
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => loop()));
	return results;
}

async function listFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	async function walk(current: string): Promise<void> {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) await walk(full);
			else out.push(full);
		}
	}
	await walk(dir);
	return out;
}

function summarize(manifest: ManifestEntry[], health: unknown, textResults: Record<string, unknown>) {
	const byPlayer: Record<Player, Record<string, number>> = { byron: {}, shawn: {} };
	for (const entry of manifest) {
		byPlayer[entry.player][entry.kind] = (byPlayer[entry.player][entry.kind] ?? 0) + 1;
	}
	return {
		generated_at: new Date().toISOString(),
		source: BASE_URL,
		health,
		total_files: manifest.length,
		total_bytes: manifest.reduce((sum, entry) => sum + entry.sizeBytes, 0),
		by_player: byPlayer,
		text_languages: Object.keys(textResults),
	};
}

async function writeReadme(manifest: ManifestEntry[], summary: ReturnType<typeof summarize>, failures: Array<{ task: DownloadTask; error: string }>) {
	const count = (player: Player, kind: AssetKind) => manifest.filter((entry) => entry.player === player && entry.kind === kind).length;
	const bytes = manifest.reduce((sum, entry) => sum + entry.sizeBytes, 0);
	const lines = [
		"# Extraction VFS - Byron Love et Shawn Froste",
		"",
		`Source: \`${BASE_URL}\``,
		`Generation: \`${summary.generated_at}\``,
		`Fichiers indexes: ${manifest.length}`,
		`Taille totale: ${bytes} octets`,
		"",
		"## Synthese par joueur",
		"",
		"| Joueur | Modeles | Textures/previews | Sons | Videos |",
		"|---|---:|---:|---:|---:|",
		`| Byron Love / Aphrodi | ${count("byron", "modele")} | ${count("byron", "texture") + count("byron", "preview")} | ${count("byron", "son")} | ${count("byron", "video")} |`,
		`| Shawn Froste / Fubuki | ${count("shawn", "modele")} | ${count("shawn", "texture") + count("shawn", "preview")} | ${count("shawn", "son")} | ${count("shawn", "video")} |`,
		"",
		"## Fichiers de controle",
		"",
		"- `meta/manifest.json`: chemin VFS ou route source, chemin local, taille et SHA-256.",
		"- `meta/chara_ids.json`: codes internes, slugs, series et hashes connus.",
		"- `meta/stats_summary.json`: resume quantitatif et health distant.",
		"- `texte/{fr,en,ja}/search-results.json`: resultats bruts du moteur de texte.",
		"",
		"## Limites observees",
		"",
		failures.length === 0 ? "- Aucun echec de telechargement bloquant." : `- ${failures.length} telechargements non recuperes, voir \`meta/failures.json\`.`,
		"- Les videos restent a 0 si `/api/v1/videos` ne retourne aucun `.usm` associe aux codes suivis.",
		"- Les fichiers deja presents et valides sont conserves puis rehaches.",
		"",
	];
	await writeFile(path.join(ROOT, "README.md"), lines.join("\n"));
}

async function main() {
	await mkdir(META_DIR, { recursive: true });
	const health = await fetchJson<unknown>(apiUrl("/api/v1/health"));
	const [entries, textResults] = await Promise.all([collectRemoteEntries(), collectText()]);
	const tasks = buildTasks(entries);
	const failures: Array<{ task: DownloadTask; error: string }> = [];
	const manifest = await runPool(tasks, CONCURRENCY, async (task) => {
		try {
			return await downloadTask(task);
		} catch (error) {
			failures.push({ task, error: String(error) });
			return undefined;
		}
	});
	const completeManifest = manifest.filter((entry): entry is ManifestEntry => Boolean(entry));

	const extraJsonFiles = (await listFiles(path.join(ROOT, "texte")).catch(() => []))
		.filter((file) => file.endsWith(".json"))
		.map((file) => path.relative(ROOT, file).replaceAll("\\", "/"));

	const charaIds = {
		generated_at: new Date().toISOString(),
		codes: KNOWN_CODES,
		hashes: HASHES,
		text_files: extraJsonFiles,
	};
	const summary = summarize(completeManifest, health, textResults);
	await writeFile(path.join(META_DIR, "manifest.json"), JSON.stringify(completeManifest, null, 2));
	await writeFile(path.join(META_DIR, "chara_ids.json"), JSON.stringify(charaIds, null, 2));
	await writeFile(path.join(META_DIR, "stats_summary.json"), JSON.stringify(summary, null, 2));
	await writeFile(path.join(META_DIR, "failures.json"), JSON.stringify(failures, null, 2));
	await writeReadme(completeManifest, summary, failures);

	console.log(JSON.stringify({
		status: failures.length === 0 ? "FAIT" : "INCOMPLET",
		tasks: tasks.length,
		manifest: completeManifest.length,
		failures: failures.length,
		bytes: summary.total_bytes,
	}, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
