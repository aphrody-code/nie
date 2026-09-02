/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tâche `noctaly:import` — DÉCLENCHEMENT MANUEL SEUL, jamais planifiée.
 *
 * ── POURQUOI CETTE TÂCHE N'A PAS DE `Bun.cron(...)` ────────────────────────
 * Toutes les autres tâches de ce fichier tournent en boucle parce que leur
 * source change en continu (tweets, sondages, articles). Celle-ci ne le peut
 * pas : elle rattrape un historique FIGÉ (Noctaly n'a été activé sur le
 * serveur que le 11/3/2026, et son remplaçant tourne depuis le 14/8/2026 —
 * personne ne va gagner de nouvelle XP chez Noctaly après ça). La relancer
 * chaque nuit ne rattraperait rien de neuf, et l'API de Noctaly le dit
 * explicitement : un excès de requêtes peut faire blacklister l'application,
 * avec un `retryAfter` d'une HEURE. Programmer ce risque sur un minuteur
 * serait absurde pour un gain nul.
 *
 * D'où le schedule `"manuel"` (comme `discord:backfill`) : disponible via
 * `--run noctaly:import` en CLI ou `POST /tasks/noctaly:import/run` (jeton
 * admin), jamais via `Bun.cron`. Voir aussi la règle du dépôt : un service qui
 * peut agir sur le serveur ne s'active pas tout seul, un humain le déclenche.
 *
 * ── POURQUOI UN `Bun.spawn`, ET PAS UNE RÉÉCRITURE ICI ─────────────────────
 * La logique d'import (cadence prudente, lecture des en-têtes de quota, arrêt
 * NET sur 429 sans réessai, écriture dans `bot_profils`/`bot_import_noctaly`)
 * vit déjà dans `apps/bot/src/scripts/import-noctaly.ts` + `lib/noctaly.ts`,
 * testée et éprouvée. `packages/cron` et `apps/bot` sont délibérément
 * DÉCOUPLÉS (aucun import croisé — voir `lib/ipc-unix.ts`, doublon assumé du
 * catalogue de tâches) : cron n'a pas vocation à réimporter la moitié du
 * domaine communautaire du bot pour ce seul déclenchement. `Bun.spawn` fait
 * de cron un simple ORCHESTRATEUR (même précédent que
 * `tasks/stats/achillea.ts`, qui shell vers un `ssh`) : le bot reste seul
 * propriétaire de ses tables et de sa clé API.
 *
 * ── LE TAUX DE CONVERSION MONÉTAIRE RESTE À ZÉRO PAR DÉFAUT ────────────────
 * Volontairement. `import-noctaly.ts` ne convertit la monnaie Noctaly en
 * jetons Kizuna que si `--taux=` est fourni : cette tâche ne le passe jamais,
 * précisément pour qu'un déclenchement (dashboard, oubli, script de test) ne
 * puisse jamais créditer personne sans qu'un humain ait choisi le taux après
 * avoir vu la distribution réelle. Une conversion se fait à la main, en CLI.
 */
import { $ } from "bun";
import { join } from "node:path";

import { depotRoseGriffon } from "../lib/racine";

/**
 * Le bot communautaire est resté dans `rg` (cf. `docs/FUSION.md`) : son dossier est résolu
 * à l'exécution, jamais par un nombre de « .. » qui change de sens selon le dépôt d'où le
 * démon tourne — depuis ici, quatre niveaux au-dessus désignaient un `apps/bot` inexistant.
 */
const RG = depotRoseGriffon();
const BOT_DIR = RG ? join(RG, "apps", "bot") : null;
const SCRIPT = BOT_DIR ? join(BOT_DIR, "src", "scripts", "import-noctaly.ts") : null;

interface ResultatImportNoctaly {
	success: boolean;
	error?: string;
	stats?: {
		sortie: string;
		codeSortie: number;
	};
}

/**
 * Lance l'import Noctaly complet, dans le répertoire du bot (pour que Bun y
 * charge `apps/bot/.env` — c'est là que vit `NOCTALY_API_KEY`, jamais dans
 * `packages/cron/.env`).
 *
 * Le code de sortie du script fait foi : `import-noctaly.ts` sort en 1 sur
 * clé refusée ou quota dépassé (voir son commentaire d'en-tête), en 0 sinon —
 * y compris pour une clé manquante, ce que `executeTask` doit distinguer
 * clairement d'un import réussi.
 */
export async function runNoctalyImport(): Promise<ResultatImportNoctaly> {
	if (!SCRIPT || !BOT_DIR) {
		const error =
			"Bot communautaire introuvable : `RG_MONOREPO` n'est pas défini et /home/ubuntu/rg n'existe pas.";
		console.error(`[Noctaly] ${error}`);
		return { success: false, error };
	}
	const proc = await $`bun ${SCRIPT}`.cwd(BOT_DIR).nothrow().quiet();
	const sortie = `${proc.stdout.toString()}${proc.stderr.toString()}`.trim();

	// Les dernières lignes utiles sont celles qu'un humain veut lire en premier
	// dans le journal cron — le rapport détaillé (top profils, distribution de
	// monnaie) reste disponible dans la sortie complète pour qui la consulte.
	const dernieresLignes = sortie.split("\n").filter(Boolean).slice(-6).join(" · ");

	if (proc.exitCode !== 0) {
		console.error(`[noctaly:import] échec (code ${proc.exitCode}) : ${dernieresLignes}`);
		return {
			error: dernieresLignes || `code de sortie ${proc.exitCode}`,
			stats: { codeSortie: proc.exitCode, sortie },
			success: false,
		};
	}

	console.log(`[noctaly:import] ${dernieresLignes}`);
	return { stats: { codeSortie: proc.exitCode, sortie }, success: true };
}
