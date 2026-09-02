import { expect, test, describe, beforeAll } from "bun:test";
import { createInagleService } from "./service.js";
import { DATA_ROOT, FILES } from "./core/paths.js";
import { join } from "node:path";
import { readdir, exists } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

// Helper to find latest SQLite database
async function getSqlitePath(): Promise<string> {
	const dir = "/home/ubuntu/rg/apps/azalee/data/backups";
	if (!(await exists(dir))) {
		throw new Error(`Backup directory ${dir} does not exist`);
	}
	const files = await readdir(dir);
	const sqliteFiles = files
		.filter((f) => f.startsWith("supabase-") && f.endsWith(".sqlite"))
		.sort((a, b) => b.localeCompare(a));

	if (sqliteFiles.length === 0) {
		throw new Error("No SQLite backups found in apps/azalee/data/backups");
	}
	return join(dir, sqliteFiles[0]);
}

/**
 * Ces tests exigent le corpus RÉEL du jeu (`<DATA_ROOT>/common/…`, ~50 fichiers
 * `.cfg.bin` et 6 000 personnages) : ils ne testent rien d'autre que le fait de le lire.
 *
 * Ce corpus est un dérivé du jeu, gitignoré : il vit sur cette machine
 * (`/home/ubuntu/niers/data`, résolu par `paths.ts`) mais n'existe ni dans une CI ni
 * sur un poste neuf, où ces tests échouaient sans autre cause que son absence. Un test
 * rouge en permanence ne signale plus rien.
 *
 * On les SAUTE donc quand le corpus est absent, et on le DIT. Un saut silencieux serait
 * l'erreur inverse, et la pire des deux : une suite verte qui n'a rien exécuté.
 */
const CORPUS_PRESENT = existsSync(join(DATA_ROOT, "common"));
if (!CORPUS_PRESENT) {
	console.warn(
		`⚠ Tests d'intégration inagle SAUTÉS : corpus du jeu absent sous ${DATA_ROOT}. ` +
			"Poser DATA_PATH sur une copie contenant `common/` pour les exécuter."
	);
}

describe.skipIf(!CORPUS_PRESENT)("Azalée CLI & Inagle Real-World Integration Tests", () => {
	let service: any;
	let sqlitePath: string;

	beforeAll(async () => {
		// 1. Initialize the Inagle service using real game files
		service = await createInagleService();
		sqlitePath = await getSqlitePath();
	}, 120000); // Le parse réel (~50 cfg.bin, 6000+ persos) dépasse le défaut 5s → timeout explicite.

	test("1. Bun File System API - Verify real game config files exist and are readable", async () => {
		const charaBasePath = join(DATA_ROOT, "common/gamedata/character", FILES.charaBase);
		const charaFile = Bun.file(charaBasePath);

		// Assert file existence and metadata via Bun.file
		expect(await charaFile.exists()).toBe(true);
		expect(charaFile.size).toBeGreaterThan(100 * 1024); // Must be >100KB

		// Read and parse JSON content natively
		const charaBaseData = await charaFile.json();
		expect(charaBaseData).toHaveProperty("entries");
		expect(Array.isArray(charaBaseData.entries)).toBe(true);
		expect(charaBaseData.entries.length).toBeGreaterThan(0);

		// The actual character info list items are children of the BEG node
		const begEntry = charaBaseData.entries.find((e: any) => e.name?.startsWith("CHARA_BASE_INFO_LIST_BEG"));
		expect(begEntry).toBeDefined();
		expect(Array.isArray(begEntry.children)).toBe(true);
		expect(begEntry.children.length).toBeGreaterThan(1000); // Thousands of base character child nodes
	});

	test("2. Bun File System API - Verify SQLite database backup file", async () => {
		const dbFile = Bun.file(sqlitePath);
		expect(await dbFile.exists()).toBe(true);
		expect(dbFile.size).toBeGreaterThan(10 * 1024 * 1024); // SQLite backup must be >10MB
	});

	test("3. Inagle Service - Query real game data", async () => {
		expect(service).toBeDefined();

		// Fetch characters
		const characters = service.characters.all();
		expect(characters.length).toBeGreaterThan(1000);

		// Verify specific legendary character profiles exist in the parsed VFS/data
		// Mark Evans (mamoru endo)
		const markEvans = characters.find((c: any) => 
			c.names?.fr === "Mark Evans" || 
			c.names?.en === "Mark Evans"
		);
		expect(markEvans).toBeDefined();
		expect(markEvans.names?.fr).toBe("Mark Evans");
		
		// Axel Blaze (goenji shuya)
		const axelBlaze = characters.find((c: any) => 
			c.names?.fr === "Axel Blaze" || 
			c.names?.en === "Axel Blaze"
		);
		expect(axelBlaze).toBeDefined();
		expect(axelBlaze.names?.fr).toBe("Axel Blaze");
	});

	test("4. Integration & Alignment - Compare parsed inagle data with SQLite backup tables", async () => {
		const db = new Database(sqlitePath, { readonly: true });

		// Verify characters alignment
		const charactersParsed = service.characters.all();
		const charactersDbCountRow = db.query("SELECT COUNT(*) as count FROM inagle_characters").get() as any;
		const dbCount = charactersDbCountRow.count;

		expect(dbCount).toBeGreaterThan(1000);
		// The SQLite table includes all variations/variants, so it might be >= parsed count
		expect(dbCount).toBeGreaterThanOrEqual(charactersParsed.length);

		// Verify skills alignment
		const skillsParsed = service.skills.all();
		const skillsDbCountRow = db.query("SELECT COUNT(*) as count FROM inagle_skills").get() as any;
		expect(skillsDbCountRow.count).toBeGreaterThan(0);
		expect(skillsParsed.length).toBeGreaterThan(0);

		db.close();
	});

	test("5. Bun Process API - Execute Azalée CLI test suite under real conditions", async () => {
		// Run '/home/ubuntu/.local/bin/azalee test' natively using Bun.spawn
		// `SQLITE_DB_PATH` est transmis comme la PRODUCTION le fait (unité systemd
		// azalee-web.service). Sans lui, la CLI retombe sur la découverte implicite du
		// miroir, qui part du répertoire courant : lancée depuis `packages/inagle`, elle
		// ne trouvait rien et sortait en 1 sur « Base de données SQLite introuvable ».
		// Ce test vérifie la CLI, pas la capacité de deviner un chemin depuis un dossier
		// quelconque — et le faire échouer pour cette raison rendait `bun run test` rouge
		// en permanence.
		// La CLI est lancée DEPUIS LES SOURCES, pas depuis `/home/ubuntu/.local/bin/azalee` :
		// ce binaire compilé date du 2026-08-10 et fige un code que le dépôt a corrigé depuis.
		// Le test vérifiait donc un artefact périmé, et échouait sur des bogues déjà réparés.
		const cliSource = new URL("../../azalee/src/cli.ts", import.meta.url).pathname;
		const proc = Bun.spawn([process.execPath, cliSource, "test"], {
			env: { ...process.env, SQLITE_DB_PATH: sqlitePath },
			stdout: "pipe",
			stderr: "pipe"
		});

		const exitCode = await proc.exited;
		const stdoutText = await new Response(proc.stdout).text();
		const stderrText = await new Response(proc.stderr).text();

		if (exitCode !== 0) {
			console.error("CLI test suite stderr:", stderrText);
			console.log("CLI test suite stdout:", stdoutText);
		}

		// Verify CLI executed successfully and output contains success summary
		expect(exitCode).toBe(0);
		expect(stdoutText).toContain("TOUTES LES SUITES DE TESTS NATIVES ONT RÉUSSI");
	}, { timeout: 150000 }); // Give Next.js server compile step plenty of time to stabilize
});
