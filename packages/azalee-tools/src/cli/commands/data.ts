/**
 * `azalee data` — pipeline de données unifié.
 *
 * The command only verifies local game/VFS inputs and Rust-owned data paths.
 * Cloud database ingestion is intentionally not part of this tool.
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import type { Command } from "commander";

import { colors } from "../context";
import type { DataMigrateOptions } from "../types";

/**
 * Racine du monorepo (les scripts orchestrés y sont ancrés).
 *
 * Résolue à l'exécution, jamais compilée : `AZALEE_REPO_ROOT` d'abord, sinon la remontée
 * jusqu'au répertoire qui porte `bun.lock`. Ce marqueur-là et pas `turbo.json` : le
 * workspace Bun n'a qu'un seul lockfile, à la racine, dans les deux dépôts — alors que
 * `turbo.json` n'existe que dans `rg`, si bien qu'un marqueur turbo aurait toujours échoué
 * ici. La valeur était auparavant le chemin d'une machine précise, absent partout ailleurs.
 */
const REPO_ROOT = ((): string => {
	if (process.env.AZALEE_REPO_ROOT) return path.resolve(process.env.AZALEE_REPO_ROOT);
	let d = process.cwd();
	while (d !== path.dirname(d)) {
		if (existsSync(path.join(d, "bun.lock"))) return d;
		d = path.dirname(d);
	}
	return process.cwd();
})();
/** Racine des dumps de jeu. */
const DATA_ROOT_DEFAULT = process.env.DATA_ROOT || process.env.DATA_PATH || "/home/ubuntu/niers/data";

/**
 * Exécute une étape du pipeline et journalise son issue.
 *
 * `cmd` est une ligne de shell complète (pipes, `&&`) → confiée à `sh -c`, en
 * **synchrone** pour préserver l'ordre d'affichage des étapes.
 */
function runDataStep(label: string, cmd: string, env: Record<string, string> = {}): boolean {
	const t0 = Date.now();
	console.log(`${colors.cyan}▸ ${label}${colors.reset}\n  $ ${cmd}`);
	const res = Bun.spawnSync(["sh", "-c", cmd], {
		cwd: REPO_ROOT,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	if (res.exitCode === 0) {
		console.log(`${colors.green}✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)${colors.reset}`);
		return true;
	}
	console.log(`${colors.red}✗ ${label} — échec${colors.reset}`);
	return false;
}

export function registerDataCommand(program: Command): void {
	const dataCmd = program
		.command("data")
		.description("Verify local VFS, zukan and inagle game data");

	dataCmd
		.command("push")
		.description("Removed: game data is read from the VFS and local inagle mirror")
		.action(() => {
			console.error("Cloud ingestion is disabled. Rebuild the local inagle mirror from verified game sources.");
			process.exit(2);
		});

	dataCmd
		.command("migrate")
		.description("Migrations SQL (better-auth_migrations/*.sql) — liste par défaut, --apply pour exécuter")
		.option("--apply", "Applique les migrations via psql (rose_griffon local)")
		.action((opts: DataMigrateOptions) => {
			const dir = `${REPO_ROOT}/apps/azalee/better-auth_migrations`;
			let files: string[] = [];
			try {
				files = readdirSync(dir)
					.filter((f: string) => f.endsWith(".sql"))
					.sort();
			} catch {
				console.log(`${colors.yellow}Aucun dossier de migrations: ${dir}${colors.reset}`);
				return;
			}
			if (files.length === 0) {
				console.log(`${colors.green}Aucune migration SQL en attente.${colors.reset}`);
				return;
			}
			console.log(`${colors.cyan}${files.length} migration(s) SQL:${colors.reset}`);
			for (const f of files) console.log(`  - ${f}`);
			if (!opts.apply) {
				console.log(`${colors.yellow}(dry-run — relancer avec --apply pour exécuter)${colors.reset}`);
				return;
			}
			let allOk = true;
			for (const f of files) {
				allOk = runDataStep(`migrate ${f}`, `sudo -u postgres psql -d rose_griffon -f ${dir}/${f}`) && allOk;
			}
			process.exit(allOk ? 0 : 1);
		});

	dataCmd
		.command("load")
		.description("Removed: use the verified local game mirror")
		.action(() => {
			console.error("Cloud loading is disabled; no external database is a source for IEVR data.");
			process.exit(2);
		});

	dataCmd
		.command("sync")
		.description("Removed: external synchronization is disabled")
		.option("--full", "Resync complet")
		.option("--deletes", "Propage les suppressions")
		.action(() => {
			console.error("External synchronization is disabled; use VFS/inagle/zukan inputs only.");
			process.exit(2);
		});

	dataCmd
		.command("typecheck")
		.description("Type-check strict (azalee + inagle, tsc --noEmit)")
		.action(() => {
			const a = runDataStep("typecheck azalee", `bun --filter @rosegriffon/azalee-web type-check`);
			const b = runDataStep("typecheck inagle", `bun --filter @rosegriffon/inagle type-check`);
			process.exit(a && b ? 0 : 1);
		});

	dataCmd
		.command("verify")
		.description("Verify local VFS, mirror, entries and zukan paths")
		.action(() => {
			let ok = true;
			const check = (label: string, cond: boolean, detail = "") => {
				console.log(
					`  ${cond ? colors.green + "✓" : colors.red + "✗"} ${label}${colors.reset}${detail ? ` — ${detail}` : ""}`,
				);
				if (!cond) ok = false;
			};
			const mirror = `${REPO_ROOT}/var/mirror.sqlite`;
			check("game mirror present", existsSync(mirror), mirror);
			check("DATA_ROOT existe", existsSync(DATA_ROOT_DEFAULT), DATA_ROOT_DEFAULT);
			check("dump chara_param présent", existsSync(`${DATA_ROOT_DEFAULT}/common/gamedata/character`));
			check("inagle entries/characters.json", existsSync(`${REPO_ROOT}/packages/inagle/src/entries/characters.json`));
			check("zukan data present", existsSync(`${REPO_ROOT}/data/azalee/zukan/param_en.json`));
			console.log(ok ? `${colors.green}verify OK${colors.reset}` : `${colors.red}verify: anomalies détectées${colors.reset}`);
			process.exit(ok ? 0 : 1);
		});

	dataCmd
		.command("all")
		.description("Verify local game data and run type checks")
		.action(() => {
			const steps: Array<[string, string, Record<string, string>]> = [
				["typecheck azalee", `bun --filter @rosegriffon/azalee-web type-check`, {}],
				["typecheck inagle", `bun --filter @rosegriffon/inagle type-check`, {}],
			];
			for (const [label, cmd, env] of steps) {
				if (!runDataStep(label, cmd, env)) {
					console.log(`${colors.red}Pipeline interrompu à '${label}'.${colors.reset}`);
					process.exit(1);
				}
			}
			runDataStep("verify", `bun ${REPO_ROOT}/packages/azalee/src/cli.ts data verify`);
			console.log(`${colors.green}✓ pipeline data complet${colors.reset}`);
		});
}
