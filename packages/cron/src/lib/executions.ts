/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registre des exécutions de tâches du démon cron.
 *
 * POURQUOI CE MODULE EXISTE
 * `index.ts` ne tenait qu'un objet `metrics` en mémoire : `startedAt`,
 * trois compteurs globaux et un `lastExecution` d'UNE seule ligne par tâche.
 * Conséquences mesurables :
 *   1. tout l'historique disparaît à chaque redémarrage du service — impossible
 *      de dire « la sauvegarde a échoué toutes les nuits depuis six semaines »,
 *      ce qui est pourtant exactement ce qui s'est produit (cf. l'en-tête de
 *      `tasks/db.ts`, six semaines de sauvegardes muettes) ;
 *   2. rien ne compte les échecs CONSÉCUTIFS, donc rien ne peut alerter ;
 *   3. l'écrasement de `lastExecution[nom]` efface le dernier SUCCÈS dès le
 *      premier échec : on ne sait plus depuis quand la tâche est morte.
 *
 * Ce module est volontairement PUR (aucun accès réseau, base ou disque) pour
 * rester testable et pour ne jamais pouvoir faire tomber le démon. L'écriture
 * en base vit dans `executions-postgres.ts`, l'alerte Discord dans
 * `alertes-cron.ts` ; tous deux consomment ce que le registre décide ici.
 */

/** D'où vient un déclenchement. Recopié tel quel dans la colonne `origine`. */
export type OrigineExecution = "planifie" | "manuel" | "cli" | "pont";

/** Ce que le démon rapporte au registre à la fin d'une exécution. */
export interface ResultatExecution {
	nom: string;
	/** Instant de début, en millisecondes epoch. */
	debutLe: number;
	dureeMs: number;
	succes: boolean;
	/** Message d'erreur brut ; il sera tronqué avant tout stockage. */
	erreur?: string;
	origine: OrigineExecution;
	/** Vrai quand l'échec vient du délai maximal, pas de la tâche elle-même. */
	expiree?: boolean;
}

/** État cumulé d'une tâche depuis le démarrage du démon. */
export interface EtatTache {
	succes: number;
	echecs: number;
	/** Exécutions refusées parce que la même tâche tournait déjà. */
	ignorees: number;
	/** Échecs dus au dépassement du délai maximal (sous-ensemble de `echecs`). */
	expirations: number;
	echecsConsecutifs: number;
	/** Une alerte a déjà été postée pour la série d'échecs en cours. */
	alerteEnvoyee: boolean;
	derniereLe: number | null;
	derniereDureeMs: number | null;
	derniereReussie: boolean | null;
	dernierSuccesLe: number | null;
	dernierEchecLe: number | null;
	/** Dernier message d'erreur connu, déjà tronqué. */
	derniereErreur: string | null;
}

/**
 * Décision d'alerte rendue par le registre.
 *
 * ANTI-SPAM : la série d'échecs ne produit qu'UNE seule `alerte` (au passage du
 * seuil), et le retour à la normale exactement UNE `retablissement`. Une tâche
 * qui échoue toutes les 5 minutes pendant une nuit n'écrit donc pas 288
 * messages dans le salon.
 */
export type DecisionAlerte =
	| { type: "aucune" }
	| { type: "alerte"; nom: string; echecsConsecutifs: number; erreur: string | null }
	| { type: "retablissement"; nom: string; echecsPrecedents: number; dureeMs: number };

/** Longueur maximale conservée d'un message d'erreur (base ET alerte). */
export const LONGUEUR_ERREUR_MAX = 500;

/**
 * Nombre d'échecs consécutifs déclenchant l'alerte.
 *
 * Trois et pas un : `stats:achillea` tourne tous les quarts d'heure et dépend
 * d'un SSH vers un autre VPS ; un échec isolé est du bruit réseau, trois de
 * suite sont une panne. Réglable par `CRON_ALERTE_SEUIL_ECHECS`.
 */
export const SEUIL_ALERTE_DEFAUT = 3;

export function seuilAlerte(env: Record<string, string | undefined> = Bun.env): number {
	const brut = Number.parseInt(env.CRON_ALERTE_SEUIL_ECHECS ?? "", 10);
	return Number.isFinite(brut) && brut > 0 ? brut : SEUIL_ALERTE_DEFAUT;
}

/** Tronque un message pour la base et pour Discord, en signalant la coupe. */
export function tronquerErreur(erreur: string | undefined | null): string | null {
	if (!erreur) return null;
	const propre = erreur.replace(/\s+/g, " ").trim();
	if (propre.length === 0) return null;
	return propre.length > LONGUEUR_ERREUR_MAX
		? `${propre.slice(0, LONGUEUR_ERREUR_MAX - 1)}…`
		: propre;
}

function etatNeuf(): EtatTache {
	return {
		succes: 0,
		echecs: 0,
		ignorees: 0,
		expirations: 0,
		echecsConsecutifs: 0,
		alerteEnvoyee: false,
		derniereLe: null,
		derniereDureeMs: null,
		derniereReussie: null,
		dernierSuccesLe: null,
		dernierEchecLe: null,
		derniereErreur: null,
	};
}

/**
 * Registre en mémoire. Une instance par démon ; les tests en créent la leur.
 */
export class RegistreExecutions {
	readonly demarreLe: number;
	private readonly taches = new Map<string, EtatTache>();
	private readonly seuil: number;

	constructor(options: { seuil?: number; demarreLe?: number } = {}) {
		this.seuil = options.seuil ?? seuilAlerte();
		this.demarreLe = options.demarreLe ?? Date.now();
	}

	/** Vue en lecture seule, pour le rendu Prometheus et le JSON d'observabilité. */
	etats(): ReadonlyMap<string, EtatTache> {
		return this.taches;
	}

	etat(nom: string): EtatTache | undefined {
		return this.taches.get(nom);
	}

	private ou(nom: string): EtatTache {
		let etat = this.taches.get(nom);
		if (!etat) {
			etat = etatNeuf();
			this.taches.set(nom, etat);
		}
		return etat;
	}

	/** Comptabilise un lancement refusé parce que la tâche tournait déjà. */
	noterIgnoree(nom: string): void {
		this.ou(nom).ignorees += 1;
	}

	/**
	 * Enregistre une exécution terminée et rend la décision d'alerte associée.
	 *
	 * Le registre ne poste rien lui-même : il DÉCIDE, l'appelant exécute. C'est
	 * ce qui permet de tester la règle anti-spam sans jeton Discord.
	 */
	noter(resultat: ResultatExecution): DecisionAlerte {
		const etat = this.ou(resultat.nom);
		const fin = resultat.debutLe + resultat.dureeMs;
		etat.derniereLe = fin;
		etat.derniereDureeMs = resultat.dureeMs;
		etat.derniereReussie = resultat.succes;

		if (resultat.succes) {
			etat.succes += 1;
			etat.dernierSuccesLe = fin;
			etat.derniereErreur = null;
			const echecsPrecedents = etat.echecsConsecutifs;
			etat.echecsConsecutifs = 0;
			if (etat.alerteEnvoyee) {
				etat.alerteEnvoyee = false;
				return {
					type: "retablissement",
					nom: resultat.nom,
					echecsPrecedents,
					dureeMs: resultat.dureeMs,
				};
			}
			return { type: "aucune" };
		}

		etat.echecs += 1;
		if (resultat.expiree) etat.expirations += 1;
		etat.dernierEchecLe = fin;
		etat.echecsConsecutifs += 1;
		etat.derniereErreur = tronquerErreur(resultat.erreur);

		if (etat.echecsConsecutifs >= this.seuil && !etat.alerteEnvoyee) {
			etat.alerteEnvoyee = true;
			return {
				type: "alerte",
				nom: resultat.nom,
				echecsConsecutifs: etat.echecsConsecutifs,
				erreur: etat.derniereErreur,
			};
		}
		return { type: "aucune" };
	}
}

/** Registre du démon. Créé à l'import, comme l'objet `metrics` qu'il complète. */
export const registreExecutions = new RegistreExecutions();

/** Rend une durée en français court, pour les messages d'alerte. */
export function formaterDuree(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)} ms`;
	const secondes = ms / 1000;
	if (secondes < 90) return `${secondes.toFixed(1)} s`;
	const minutes = secondes / 60;
	if (minutes < 90) return `${minutes.toFixed(1)} min`;
	return `${(minutes / 60).toFixed(1)} h`;
}
