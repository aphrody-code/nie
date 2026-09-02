/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rendu des métriques du démon au format d'exposition Prometheus (text/plain,
 * version 0.0.4).
 *
 * POURQUOI CE FORMAT
 * `GET /metrics` renvoyait un objet JSON maison : aucun collecteur standard ne
 * sait le lire, et l'unique série temporelle qu'il contenait (`lastExecution`)
 * était écrasée à chaque passage. Un rendu Prometheus permet de tracer l'âge du
 * dernier succès de chaque tâche — la seule métrique qui aurait rendu visibles
 * les six semaines de sauvegardes nocturnes muettes.
 *
 * CE QUI N'Y FIGURE PAS, VOLONTAIREMENT : les messages d'erreur. `:3005` écoute
 * sur `*` et `ufw` autorise `3000:3010/tcp` depuis n'importe où (vérifié le
 * 13/8/2026) ; `/metrics` est en outre servi AVANT le contrôle d'autorisation.
 * Y mettre le texte d'une exception exposerait des chemins internes au premier
 * venu. Le détail reste sur `/metrics.json`, lui authentifié.
 *
 * Aucune dépendance : le format d'exposition est une poignée de lignes de texte,
 * et `prom-client` ferait entrer un client Node complet pour cela.
 */

import type { EtatTache } from "./executions.js";

export interface EntreeMetriques {
	/** Démarrage du démon, en millisecondes epoch. */
	demarreLe: number;
	lancees: number;
	reussies: number;
	echouees: number;
	ignorees: number;
	expirees: number;
	echecsPersistance: number;
	persistanceEnVeille: boolean;
	connexionsWs: number;
	taches: ReadonlyMap<string, EtatTache>;
	/** Instant du rendu ; injecté par les tests. */
	maintenant?: number;
}

/** Échappement d'une valeur d'étiquette, selon le format d'exposition. */
export function echapperEtiquette(valeur: string): string {
	return valeur.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Secondes avec 3 décimales, sans notation exponentielle. */
function secondes(ms: number): string {
	return (ms / 1000).toFixed(3);
}

export function rendreMetriquesPrometheus(entree: EntreeMetriques): string {
	const maintenant = entree.maintenant ?? Date.now();
	const lignes: string[] = [];

	const bloc = (nom: string, aide: string, type: "counter" | "gauge", valeurs: string[]): void => {
		if (valeurs.length === 0) return;
		lignes.push(`# HELP ${nom} ${aide}`);
		lignes.push(`# TYPE ${nom} ${type}`);
		lignes.push(...valeurs);
	};

	bloc("rg_cron_uptime_seconds", "Durée de fonctionnement du démon, en secondes.", "gauge", [
		`rg_cron_uptime_seconds ${secondes(Math.max(0, maintenant - entree.demarreLe))}`,
	]);
	bloc(
		"rg_cron_start_time_seconds",
		"Horodatage Unix du démarrage du démon, en secondes.",
		"gauge",
		[`rg_cron_start_time_seconds ${secondes(entree.demarreLe)}`]
	);
	bloc("rg_cron_tasks_triggered_total", "Exécutions de tâches lancées.", "counter", [
		`rg_cron_tasks_triggered_total ${entree.lancees}`,
	]);
	bloc("rg_cron_tasks_succeeded_total", "Exécutions de tâches réussies.", "counter", [
		`rg_cron_tasks_succeeded_total ${entree.reussies}`,
	]);
	bloc("rg_cron_tasks_failed_total", "Exécutions de tâches en échec.", "counter", [
		`rg_cron_tasks_failed_total ${entree.echouees}`,
	]);
	bloc(
		"rg_cron_tasks_skipped_total",
		"Lancements refusés parce que la même tâche tournait déjà.",
		"counter",
		[`rg_cron_tasks_skipped_total ${entree.ignorees}`]
	);
	bloc(
		"rg_cron_tasks_timed_out_total",
		"Exécutions abandonnées sur dépassement du délai maximal.",
		"counter",
		[`rg_cron_tasks_timed_out_total ${entree.expirees}`]
	);
	bloc(
		"rg_cron_history_write_errors_total",
		"Écritures de l'historique d'exécution refusées par la base.",
		"counter",
		[`rg_cron_history_write_errors_total ${entree.echecsPersistance}`]
	);
	bloc(
		"rg_cron_history_paused",
		"1 quand la persistance de l'historique est en veille (table absente, base coupée).",
		"gauge",
		[`rg_cron_history_paused ${entree.persistanceEnVeille ? 1 : 0}`]
	);
	bloc("rg_cron_ws_connections", "Clients connectés au flux de journal WebSocket.", "gauge", [
		`rg_cron_ws_connections ${entree.connexionsWs}`,
	]);

	const executions: string[] = [];
	const duree: string[] = [];
	const dernierSucces: string[] = [];
	const ageSucces: string[] = [];
	const dernierEchec: string[] = [];
	const consecutifs: string[] = [];
	const ignorees: string[] = [];
	const expirations: string[] = [];
	const derniereReussie: string[] = [];

	// Tri par nom : un rendu stable rend les diffs de `curl` lisibles et évite de
	// faire croire à un changement là où seul l'ordre d'insertion a bougé.
	for (const nom of [...entree.taches.keys()].sort()) {
		const etat = entree.taches.get(nom);
		if (!etat) continue;
		const e = echapperEtiquette(nom);
		executions.push(`rg_cron_task_runs_total{tache="${e}",issue="succes"} ${etat.succes}`);
		executions.push(`rg_cron_task_runs_total{tache="${e}",issue="echec"} ${etat.echecs}`);
		ignorees.push(`rg_cron_task_skipped_total{tache="${e}"} ${etat.ignorees}`);
		expirations.push(`rg_cron_task_timed_out_total{tache="${e}"} ${etat.expirations}`);
		consecutifs.push(`rg_cron_task_consecutive_failures{tache="${e}"} ${etat.echecsConsecutifs}`);
		if (etat.derniereDureeMs !== null) {
			duree.push(`rg_cron_task_last_duration_seconds{tache="${e}"} ${secondes(etat.derniereDureeMs)}`);
		}
		if (etat.derniereReussie !== null) {
			derniereReussie.push(
				`rg_cron_task_last_run_success{tache="${e}"} ${etat.derniereReussie ? 1 : 0}`
			);
		}
		if (etat.dernierSuccesLe !== null) {
			dernierSucces.push(
				`rg_cron_task_last_success_timestamp_seconds{tache="${e}"} ${secondes(etat.dernierSuccesLe)}`
			);
			ageSucces.push(
				`rg_cron_task_last_success_age_seconds{tache="${e}"} ${secondes(
					Math.max(0, maintenant - etat.dernierSuccesLe)
				)}`
			);
		}
		if (etat.dernierEchecLe !== null) {
			dernierEchec.push(
				`rg_cron_task_last_failure_timestamp_seconds{tache="${e}"} ${secondes(etat.dernierEchecLe)}`
			);
		}
	}

	bloc("rg_cron_task_runs_total", "Exécutions par tâche et par issue.", "counter", executions);
	bloc("rg_cron_task_skipped_total", "Lancements refusés par tâche (déjà en cours).", "counter", ignorees);
	bloc(
		"rg_cron_task_timed_out_total",
		"Dépassements du délai maximal par tâche.",
		"counter",
		expirations
	);
	bloc(
		"rg_cron_task_last_duration_seconds",
		"Durée de la dernière exécution, en secondes.",
		"gauge",
		duree
	);
	bloc(
		"rg_cron_task_last_run_success",
		"1 si la dernière exécution a réussi, 0 sinon.",
		"gauge",
		derniereReussie
	);
	bloc(
		"rg_cron_task_last_success_timestamp_seconds",
		"Horodatage Unix du dernier succès, en secondes.",
		"gauge",
		dernierSucces
	);
	bloc(
		"rg_cron_task_last_success_age_seconds",
		"Âge du dernier succès, en secondes. C'est la métrique à alerter : une tâche quotidienne dont l'âge dépasse 48 h est morte.",
		"gauge",
		ageSucces
	);
	bloc(
		"rg_cron_task_last_failure_timestamp_seconds",
		"Horodatage Unix du dernier échec, en secondes.",
		"gauge",
		dernierEchec
	);
	bloc(
		"rg_cron_task_consecutive_failures",
		"Échecs consécutifs en cours ; l'alerte Discord part au seuil configuré.",
		"gauge",
		consecutifs
	);

	// Le format d'exposition exige une fin de ligne terminale.
	return `${lignes.join("\n")}\n`;
}
