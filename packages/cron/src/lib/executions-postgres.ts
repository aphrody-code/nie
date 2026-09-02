/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persistance de l'historique d'exécution des tâches, dans `public.cron_executions`.
 *
 * RÈGLE ABSOLUE DE CE FICHIER : il ne doit JAMAIS faire échouer une tâche ni
 * tomber le démon. L'historique est de l'observabilité, pas de la production ;
 * une base injoignable, une table pas encore migrée ou un droit manquant se
 * traduisent par une ligne de journal et rien d'autre.
 *
 * TABLE ABSENTE = CAS NOMINAL AU DÉPLOIEMENT
 * La migration `apps/website/supabase/migrations/20260813_02_cron_executions.sql`
 * n'est PAS appliquée automatiquement (aucune migration de ce dépôt ne l'est).
 * Le code part donc du principe que la table peut ne pas exister : au premier
 * `42P01` (`undefined_table`), l'écriture se met en veille et se retente au bout
 * d'un quart d'heure — appliquer la migration suffit alors à faire repartir
 * l'historique, sans redémarrer `rg-cron`.
 *
 * VÉRIFIÉ, PAS SUPPOSÉ : `Bun.SQL` lève un `PostgresError` dont `code` vaut
 * `"ERR_POSTGRES_SERVER_ERROR"` et dont **`errno` porte le SQLSTATE** (ici la
 * chaîne `"42P01"`). C'est `errno` qu'il faut tester, pas `code`.
 */

import { hostname } from "node:os";
import { sql } from "./db.js";
import { tronquerErreur, type ResultatExecution } from "./executions.js";

/** SQLSTATE « la relation n'existe pas ». */
const SQLSTATE_TABLE_ABSENTE = "42P01";
/** SQLSTATE « droits insuffisants ». */
const SQLSTATE_DROITS = "42501";

/** Délai avant de re-tenter une écriture après une mise en veille. */
const VEILLE_MS = 15 * 60_000;

/** Rétention par défaut de l'historique, en jours. */
const RETENTION_JOURS_DEFAUT = 90;

/** Intervalle minimal entre deux purges. */
const PERIODE_PURGE_MS = 24 * 3600_000;

const HOTE = hostname();

let enVeilleJusqua = 0;
let motifVeille = "";
let echecsPersistance = 0;
let dernierePurge = 0;

/** Nombre d'écritures d'historique refusées depuis le démarrage (métrique). */
export function echecsPersistanceHistorique(): number {
	return echecsPersistance;
}

/** Vrai si l'écriture est actuellement en veille (table absente, base coupée…). */
export function persistanceEnVeille(): boolean {
	return Date.now() < enVeilleJusqua;
}

function sqlstate(err: unknown): string | null {
	if (typeof err !== "object" || err === null) return null;
	const errno = (err as { errno?: unknown }).errno;
	return typeof errno === "string" ? errno : null;
}

function mettreEnVeille(err: unknown): void {
	const etat = sqlstate(err);
	const message = err instanceof Error ? err.message : String(err);
	enVeilleJusqua = Date.now() + VEILLE_MS;

	if (etat === SQLSTATE_TABLE_ABSENTE) {
		motifVeille = "table absente";
		console.warn(
			`[cron-historique] public.cron_executions n'existe pas : historique désactivé pendant ${
				VEILLE_MS / 60_000
			} min. Appliquer apps/website/supabase/migrations/20260813_02_cron_executions.sql.`
		);
		return;
	}
	if (etat === SQLSTATE_DROITS) {
		motifVeille = "droits insuffisants";
		console.warn(
			`[cron-historique] écriture refusée (SQLSTATE 42501) : ${message.slice(0, 200)}`
		);
		return;
	}
	motifVeille = etat ? `SQLSTATE ${etat}` : "erreur base";
	console.warn(`[cron-historique] écriture impossible (${motifVeille}) : ${message.slice(0, 200)}`);
}

/**
 * Écrit une exécution terminée dans l'historique.
 *
 * Ne lève jamais. Rend `true` si la ligne a bien été écrite — utile aux tests
 * d'intégration et au diagnostic, ignoré par le démon.
 */
export async function enregistrerExecutionEnBase(resultat: ResultatExecution): Promise<boolean> {
	if (persistanceEnVeille()) {
		echecsPersistance += 1;
		return false;
	}

	const debut = new Date(resultat.debutLe).toISOString();
	const fin = new Date(resultat.debutLe + resultat.dureeMs).toISOString();
	const erreur = tronquerErreur(resultat.erreur);

	try {
		await sql`
			INSERT INTO public.cron_executions
				(tache, demarre_le, termine_le, duree_ms, succes, expiree, erreur, origine, hote)
			VALUES (
				${resultat.nom}, ${debut}::timestamptz, ${fin}::timestamptz,
				${Math.round(resultat.dureeMs)}, ${resultat.succes}, ${resultat.expiree === true},
				${erreur}, ${resultat.origine}, ${HOTE}
			)
		`;
		// Une écriture réussie ferme la veille éventuelle (base revenue, migration
		// appliquée) sans attendre la fin du quart d'heure.
		enVeilleJusqua = 0;
		motifVeille = "";
		void purgerHistoriqueSiNecessaire();
		return true;
	} catch (err) {
		echecsPersistance += 1;
		mettreEnVeille(err);
		return false;
	}
}

/**
 * Purge les lignes plus vieilles que la rétention, au plus une fois par jour.
 *
 * Faite ici plutôt que par un `Bun.cron` de plus : la purge n'a de sens que si
 * des lignes sont écrites, et un démon arrêté n'a rien à purger.
 */
export async function purgerHistoriqueSiNecessaire(maintenant = Date.now()): Promise<number> {
	if (maintenant - dernierePurge < PERIODE_PURGE_MS) return 0;
	dernierePurge = maintenant;

	const brut = Number.parseInt(Bun.env.CRON_HISTORIQUE_RETENTION_JOURS ?? "", 10);
	const jours = Number.isFinite(brut) && brut > 0 ? brut : RETENTION_JOURS_DEFAUT;

	try {
		const supprimees = await sql`
			DELETE FROM public.cron_executions
			 WHERE demarre_le < now() - (${jours}::int * interval '1 day')
			RETURNING 1
		`;
		const n = Array.isArray(supprimees) ? supprimees.length : 0;
		if (n > 0) {
			console.log(`[cron-historique] purge : ${n} exécution(s) de plus de ${jours} jours retirées.`);
		}
		return n;
	} catch (err) {
		console.warn(
			"[cron-historique] purge impossible :",
			err instanceof Error ? err.message.slice(0, 200) : err
		);
		return 0;
	}
}

/**
 * Relit l'historique persisté pour une tâche (le démon l'expose sur
 * `/metrics.json`). Rend un tableau vide si l'historique est indisponible :
 * l'observabilité ne doit jamais transformer une requête HTTP en 500.
 */
export async function historiqueRecent(limite = 50): Promise<
	Array<{
		tache: string;
		demarre_le: string;
		duree_ms: number;
		succes: boolean;
		erreur: string | null;
		origine: string;
	}>
> {
	if (persistanceEnVeille()) return [];
	const plafond = Math.min(Math.max(Math.trunc(limite), 1), 500);
	try {
		const lignes = await sql`
			SELECT tache, demarre_le, duree_ms, succes, erreur, origine
			  FROM public.cron_executions
			 ORDER BY demarre_le DESC
			 LIMIT ${plafond}
		`;
		return lignes as unknown as Awaited<ReturnType<typeof historiqueRecent>>;
	} catch (err) {
		mettreEnVeille(err);
		return [];
	}
}

/** Motif courant de la veille, ou chaîne vide. Exposé pour le diagnostic. */
export function motifVeillePersistance(): string {
	return persistanceEnVeille() ? motifVeille : "";
}
