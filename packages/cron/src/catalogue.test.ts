/**
 * Non-dérive entre le démon et le catalogue partagé.
 *
 * ── LE DÉFAUT QUE CE FICHIER EMPÊCHE DE REVENIR ────────────────────────────
 * Trois surfaces nomment les mêmes tâches : `runnerMap` ici, le catalogue de
 * `@rosegriffon/types/cron`, et la réponse de `GET /tasks`. Elles étaient
 * recopiées à la main, et elles avaient divergé : le bot connaissait dix-huit
 * tâches quand le démon en servait vingt-deux, si bien que `/cron lancer
 * noctaly:import` répondait « tâche inconnue » sur une tâche qui marche.
 *
 * Le catalogue est désormais unique, mais `runnerMap` reste ici — c'est le seul
 * endroit qui puisse associer un nom à une fonction. Ce test relie les deux :
 * ajouter une entrée au démon sans la décrire dans le catalogue (ou l'inverse)
 * fait échouer la CI, avec le nom manquant dans le message.
 *
 * Il lit le fichier source plutôt que d'importer le module : importer
 * `src/index.ts` démarrerait vraiment le démon (planifications, serveurs HTTP,
 * passerelle Discord).
 */
import { describe, expect, test } from "bun:test";

import { CATALOGUE_TACHES, normaliserNomTache, TACHES_CRON } from "@rosegriffon/types/cron";

const SOURCE = new URL("./index.ts", import.meta.url).pathname;

/** Les clés de `runnerMap`, lues dans le source du démon. */
async function clefsDuRunnerMap(): Promise<Set<string>> {
	const source = await Bun.file(SOURCE).text();
	const debut = source.indexOf("const runnerMap");
	expect(debut).toBeGreaterThan(-1);
	const fin = source.indexOf("const taskFn = runnerMap[taskName]", debut);
	expect(fin).toBeGreaterThan(debut);
	const bloc = source.slice(debut, fin);

	const clefs = new Set<string>();
	// `"discord:scan": runDiscordChannelScan,` et `db: runInaglePush,`
	for (const trouve of bloc.matchAll(/^\t{4}(?:"([^"]+)"|([a-z]+)):/gm)) {
		clefs.add(trouve[1] ?? trouve[2]!);
	}
	return clefs;
}

describe("catalogue partagé vs démon", () => {
	/**
	 * `GET /tasks` ne recopie plus rien : il rend `TACHES_CRON`,
	 * `PLANIFICATIONS` et `CATALOGUE_TACHES` tels quels. Ce test verrouille ce
	 * choix — remettre une liste littérale dans la route ferait revenir la
	 * dérive que tout ce fichier existe pour empêcher.
	 */
	test("la route /tasks sert le catalogue, elle ne le recopie pas", async () => {
		const source = await Bun.file(SOURCE).text();
		const debut = source.indexOf('url.pathname === "/tasks"');
		expect(debut).toBeGreaterThan(-1);
		const bloc = source.slice(debut, source.indexOf("// 5.", debut));
		expect(bloc).toContain("tasks: TACHES_CRON");
		expect(bloc).toContain("schedules: PLANIFICATIONS");
		expect(bloc).toContain("catalogue: CATALOGUE_TACHES");
	});

	test("toute tâche du catalogue a un exécutant dans runnerMap", async () => {
		const clefs = new Set([...(await clefsDuRunnerMap())].map(normaliserNomTache));
		const orphelines = TACHES_CRON.filter((nom) => !clefs.has(normaliserNomTache(nom)));
		expect(orphelines).toEqual([]);
	});

	/**
	 * L'inverse n'est PAS symétrique : `runnerMap` porte des alias d'écriture
	 * (`discord-scan` pour `discord:scan`) et une entrée non publiée
	 * (`discord:archives`). On vérifie donc seulement qu'aucune entrée non
	 * aliasée ne manque au catalogue.
	 *
	 * `zukan:videos` était tolérée ici tant qu'elle n'était lançable qu'à la
	 * main ; elle est publiée depuis qu'elle est planifiée (2h00, entre la
	 * poussée des données et la sauvegarde SQLite).
	 */
	test("les entrées du démon absentes du catalogue sont connues et assumées", async () => {
		const catalogue = new Set(TACHES_CRON.map(normaliserNomTache));
		const tolerees = new Set(["discord:archives"]);
		const surplus = [...(await clefsDuRunnerMap())]
			.map(normaliserNomTache)
			.filter((nom) => !catalogue.has(nom) && !tolerees.has(nom));
		expect(surplus).toEqual([]);
	});
});

describe("cohérence interne du catalogue", () => {
	test("aucun doublon de nom", () => {
		expect(new Set(TACHES_CRON).size).toBe(TACHES_CRON.length);
	});

	test("chaque interdiction porte son motif", () => {
		for (const tache of CATALOGUE_TACHES) {
			if (tache.niveau === "interdit") {
				expect(tache.motifInterdiction).toBeTruthy();
			} else {
				expect(tache.motifInterdiction).toBeNull();
			}
		}
	});

	test("une planification est une expression cron ou « manuel »", () => {
		for (const tache of CATALOGUE_TACHES) {
			if (tache.planification === "manuel") {
				continue;
			}
			expect(tache.planification.split(/\s+/)).toHaveLength(5);
		}
	});
});
