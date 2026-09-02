/**
 * Ce que CHAQUE membre a déjà regardé, et ce qu'il veut regarder.
 *
 * C'est la pièce qui sépare un annuaire d'épisodes d'un service de lecture : un
 * catalogue dit ce qui existe, une progression dit où TU en es. « Reprendre »,
 * « épisode suivant », la pastille ✓ dans une liste de saison et « Ma liste »
 * en découlent tous.
 *
 * ── LA CLÉ EST (SAISON, ÉPISODE), JAMAIS L'IDENTIFIANT DE VIDÉO ────────────
 * Un `videoId` appartient à une SOURCE. Le catalogue est rescrapé toutes les
 * six heures et une source peut dépublier une vidéo, la remplacer, ou être
 * momentanément injoignable : une progression indexée dessus s'effacerait
 * toute seule au premier incident d'en face. Le couple (saison, épisode), lui,
 * désigne l'ŒUVRE — il survit au changement de source comme au changement de
 * langue.
 *
 * ── LA BASE EST SÉPARÉE DE CELLE DU CATALOGUE ──────────────────────────────
 * Le catalogue est un CACHE : `rafraichir()` en efface et réécrit des pans
 * entiers, source par source. Ce que les membres ont regardé n'est pas un
 * cache, cela ne se re-scrape pas. Les deux bases vivent donc dans le même
 * répertoire — le seul que l'unité systemd ouvre en écriture — mais dans deux
 * fichiers distincts.
 *
 * ── MODULE À DEUX ÉTAGES ───────────────────────────────────────────────────
 * {@link Progression} ne connaît qu'une interface de stockage. La version
 * SQLite sert en production, la version en mémoire sert aux tests : toute la
 * logique de reprise et de tri se couvre sans fichier ni base.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Un épisode repéré par l'œuvre, pas par la source qui le sert. */
export interface CleEpisode {
	saison: number;
	episode: number;
}

/** Un visionnage enregistré. */
export interface Visionnage extends CleEpisode {
	/** Millisecondes epoch. */
	quand: number;
}

/** Une entrée de « Ma liste ». */
export interface EntreeListe extends CleEpisode {
	/** Millisecondes epoch. */
	ajouteLe: number;
}

/**
 * Ce que la progression attend de sa persistance.
 *
 * Volontairement étroit : chaque méthode répond à un besoin d'écran précis, et
 * rien n'y expose de SQL. C'est ce qui permet à la doublure de test d'être un
 * objet de quinze lignes.
 */
export interface StockageProgression {
	marquerVu(membre: string, cle: CleEpisode, quand: number): void;
	oublierVu(membre: string, cle: CleEpisode): void;
	/** Visionnages d'un membre pour une saison — juste les numéros. */
	vusDeSaison(membre: string, saison: number): number[];
	/** Le dernier épisode regardé, toutes saisons confondues. */
	dernierVu(membre: string): Visionnage | null;
	/** Les N derniers épisodes regardés, du plus récent au plus ancien. */
	derniersVus(membre: string, limite: number): Visionnage[];
	/** Combien d'épisodes vus, par saison. */
	comptesParSaison(membre: string): Map<number, number>;

	ajouterAListe(membre: string, cle: CleEpisode, quand: number): void;
	retirerDeListe(membre: string, cle: CleEpisode): void;
	estDansListe(membre: string, cle: CleEpisode): boolean;
	/** « Ma liste », de l'ajout le plus récent au plus ancien. */
	liste(membre: string, limite: number): EntreeListe[];

	fermer(): void;
}

/** `3:12` — la forme d'une clé dans un `custom_id` ou un ensemble. */
export function cleTexte(cle: CleEpisode): string {
	return `${cle.saison}:${cle.episode}`;
}

/**
 * Progression d'un membre, au-dessus d'un stockage quelconque.
 *
 * Les décisions d'affichage — « quel est l'épisode suivant », « où reprendre »
 * — vivent ici, hors de SQL, pour être couvertes sans base.
 */
export class Progression {
	private readonly stockage: StockageProgression;
	private readonly maintenant: () => number;

	constructor(stockage: StockageProgression, maintenant: () => number = Date.now) {
		this.stockage = stockage;
		this.maintenant = maintenant;
	}

	marquerVu(membre: string, cle: CleEpisode): void {
		this.stockage.marquerVu(membre, cle, this.maintenant());
	}

	/** Pose ou retire la marque de visionnage, et dit dans quel sens. */
	basculerVu(membre: string, cle: CleEpisode, vus: ReadonlySet<number>): boolean {
		if (vus.has(cle.episode)) {
			this.stockage.oublierVu(membre, cle);
			return false;
		}
		this.stockage.marquerVu(membre, cle, this.maintenant());
		return true;
	}

	vusDeSaison(membre: string, saison: number): Set<number> {
		return new Set(this.stockage.vusDeSaison(membre, saison));
	}

	dernierVu(membre: string): Visionnage | null {
		return this.stockage.dernierVu(membre);
	}

	derniersVus(membre: string, limite = 5): Visionnage[] {
		return this.stockage.derniersVus(membre, limite);
	}

	comptesParSaison(membre: string): Map<number, number> {
		return this.stockage.comptesParSaison(membre);
	}

	/**
	 * Bascule l'appartenance à « Ma liste » et dit si l'épisode y est
	 * désormais.
	 *
	 * Un seul bouton pour les deux sens : c'est ce que fait tout service de
	 * lecture, et cela évite deux boutons dont un est toujours inutile.
	 */
	basculerListe(membre: string, cle: CleEpisode): boolean {
		if (this.stockage.estDansListe(membre, cle)) {
			this.stockage.retirerDeListe(membre, cle);
			return false;
		}
		this.stockage.ajouterAListe(membre, cle, this.maintenant());
		return true;
	}

	estDansListe(membre: string, cle: CleEpisode): boolean {
		return this.stockage.estDansListe(membre, cle);
	}

	liste(membre: string, limite = 25): EntreeListe[] {
		return this.stockage.liste(membre, limite);
	}

	fermer(): void {
		this.stockage.fermer();
	}
}

/**
 * Le prochain épisode à regarder dans une saison.
 *
 * ── LE PLUS PETIT NON VU, PAS « LE DERNIER VU + 1 » ────────────────────────
 * Les deux coïncident quand on regarde dans l'ordre, et divergent dès qu'on
 * saute un épisode : quelqu'un qui a vu E01, E02 puis E07 doit se voir proposer
 * E03, l'épisode qu'il lui manque, et non E08. C'est aussi ce qui rend la
 * fonction juste quand la saison a des trous : elle ne propose que des numéros
 * qui EXISTENT au catalogue.
 *
 * Rend `null` quand la saison est finie — l'appelant enchaîne alors sur la
 * suivante.
 */
export function prochainNonVu(
	disponibles: readonly number[],
	vus: ReadonlySet<number>
): number | null {
	for (const numero of [...disponibles].sort((a, b) => a - b)) {
		if (!vus.has(numero)) return numero;
	}
	return null;
}

/** Épisode précédent et suivant réellement présents au catalogue. */
export function voisins(
	disponibles: readonly number[],
	numero: number
): { precedent: number | null; suivant: number | null } {
	const tries = [...disponibles].sort((a, b) => a - b);
	const rang = tries.indexOf(numero);
	if (rang === -1) {
		// L'épisode courant n'est pas au catalogue (source retirée entre-temps) :
		// on encadre quand même, pour ne pas laisser la navigation sans issue.
		const avant = tries.filter((n) => n < numero).at(-1) ?? null;
		const apres = tries.find((n) => n > numero) ?? null;
		return { precedent: avant, suivant: apres };
	}
	return {
		precedent: rang > 0 ? tries[rang - 1]! : null,
		suivant: rang < tries.length - 1 ? tries[rang + 1]! : null,
	};
}

/**
 * Avancement d'une saison, en pourcentage entier.
 *
 * Zéro épisode au catalogue rend 0 plutôt qu'une division par zéro : une
 * saison vide n'est pas une saison finie.
 */
export function avancement(vus: number, total: number): number {
	if (total <= 0) return 0;
	return Math.min(100, Math.round((vus / total) * 100));
}

/**
 * Barre de progression en douze caractères pleins/vides.
 *
 * Douze parce que c'est ce qui tient sur un téléphone à côté d'un pourcentage,
 * sans passer à la ligne dans un `TextDisplay`.
 */
export function barre(pourcentage: number, largeur = 12): string {
	const borne = Math.max(0, Math.min(100, pourcentage));
	const pleins = Math.round((borne / 100) * largeur);
	return `${"█".repeat(pleins)}${"░".repeat(largeur - pleins)}`;
}

/** Stockage en mémoire — la doublure des tests, et rien d'autre. */
export class ProgressionMemoire implements StockageProgression {
	private readonly vus = new Map<string, Map<string, number>>();
	private readonly listes = new Map<string, Map<string, number>>();

	private table(source: Map<string, Map<string, number>>, membre: string): Map<string, number> {
		let table = source.get(membre);
		if (!table) {
			table = new Map();
			source.set(membre, table);
		}
		return table;
	}

	marquerVu(membre: string, cle: CleEpisode, quand: number): void {
		this.table(this.vus, membre).set(cleTexte(cle), quand);
	}

	oublierVu(membre: string, cle: CleEpisode): void {
		this.table(this.vus, membre).delete(cleTexte(cle));
	}

	vusDeSaison(membre: string, saison: number): number[] {
		const prefixe = `${saison}:`;
		return [...this.table(this.vus, membre).keys()]
			.filter((cle) => cle.startsWith(prefixe))
			.map((cle) => Number(cle.slice(prefixe.length)))
			.filter((n) => Number.isFinite(n));
	}

	private visionnages(membre: string): Visionnage[] {
		return [...this.table(this.vus, membre).entries()]
			.map(([cle, quand]) => {
				const [saison, episode] = cle.split(":").map(Number);
				return { saison: saison!, episode: episode!, quand };
			})
			.sort(
				(a, b) =>
					// Départage à horodatage ÉGAL, ce qui arrive dès que deux
					// marquages tombent dans la même milliseconde : sans ce
					// second critère, « le dernier vu » dépend de l'ordre
					// d'insertion, et `apresDernierVu` enchaîne au mauvais
					// endroit. Le plus avancé fait foi.
					b.quand - a.quand || b.saison - a.saison || b.episode - a.episode
			);
	}

	dernierVu(membre: string): Visionnage | null {
		return this.visionnages(membre)[0] ?? null;
	}

	derniersVus(membre: string, limite: number): Visionnage[] {
		return this.visionnages(membre).slice(0, limite);
	}

	comptesParSaison(membre: string): Map<number, number> {
		const comptes = new Map<number, number>();
		for (const visionnage of this.visionnages(membre)) {
			comptes.set(visionnage.saison, (comptes.get(visionnage.saison) ?? 0) + 1);
		}
		return comptes;
	}

	ajouterAListe(membre: string, cle: CleEpisode, quand: number): void {
		this.table(this.listes, membre).set(cleTexte(cle), quand);
	}

	retirerDeListe(membre: string, cle: CleEpisode): void {
		this.table(this.listes, membre).delete(cleTexte(cle));
	}

	estDansListe(membre: string, cle: CleEpisode): boolean {
		return this.table(this.listes, membre).has(cleTexte(cle));
	}

	liste(membre: string, limite: number): EntreeListe[] {
		return [...this.table(this.listes, membre).entries()]
			.map(([cle, ajouteLe]) => {
				const [saison, episode] = cle.split(":").map(Number);
				return { saison: saison!, episode: episode!, ajouteLe };
			})
			.sort((a, b) => b.ajouteLe - a.ajouteLe)
			.slice(0, limite);
	}

	fermer(): void {
		this.vus.clear();
		this.listes.clear();
	}
}

/**
 * Chemin de la base d'état, déduit de celui du catalogue.
 *
 * Le même répertoire, délibérément : c'est le SEUL que l'unité systemd ouvre en
 * écriture (`ReadWritePaths=/home/ubuntu/.cache/ietv`). Poser l'état ailleurs
 * ferait échouer l'ouverture en EROFS, et le bot planterait au premier clic.
 */
export function cheminEtatDepuisCatalogue(cheminCatalogue: string): string {
	return `${dirname(cheminCatalogue)}/wonderbot.db`;
}

/** Stockage SQLite — celui de la production. */
export class ProgressionSqlite implements StockageProgression {
	private readonly db: Database;

	constructor(chemin: string) {
		const dossier = dirname(chemin);
		if (dossier !== "" && !existsSync(dossier)) mkdirSync(dossier, { recursive: true });

		this.db = new Database(chemin, { create: true });
		// WAL : le bot lit à chaque clic pendant que le planificateur écrit.
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.db.exec(`
      CREATE TABLE IF NOT EXISTS vus (
        membre TEXT NOT NULL,
        saison INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        quand INTEGER NOT NULL,
        PRIMARY KEY (membre, saison, episode)
      );
      CREATE TABLE IF NOT EXISTS ma_liste (
        membre TEXT NOT NULL,
        saison INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        ajouteLe INTEGER NOT NULL,
        PRIMARY KEY (membre, saison, episode)
      );
      CREATE INDEX IF NOT EXISTS idx_vus_recents ON vus(membre, quand DESC);
      CREATE INDEX IF NOT EXISTS idx_liste_recente ON ma_liste(membre, ajouteLe DESC);
    `);
	}

	marquerVu(membre: string, cle: CleEpisode, quand: number): void {
		this.db
			.prepare(
				"INSERT INTO vus (membre, saison, episode, quand) VALUES (?, ?, ?, ?) " +
					"ON CONFLICT(membre, saison, episode) DO UPDATE SET quand = excluded.quand"
			)
			.run(membre, cle.saison, cle.episode, quand);
	}

	oublierVu(membre: string, cle: CleEpisode): void {
		this.db
			.prepare("DELETE FROM vus WHERE membre = ? AND saison = ? AND episode = ?")
			.run(membre, cle.saison, cle.episode);
	}

	vusDeSaison(membre: string, saison: number): number[] {
		return (
			this.db
				.prepare("SELECT episode FROM vus WHERE membre = ? AND saison = ?")
				.all(membre, saison) as { episode: number }[]
		).map((ligne) => ligne.episode);
	}

	dernierVu(membre: string): Visionnage | null {
		return this.derniersVus(membre, 1)[0] ?? null;
	}

	derniersVus(membre: string, limite: number): Visionnage[] {
		return this.db
			.prepare(
				// Même départage qu'en mémoire : à horodatage égal, le plus
				// avancé fait foi, sinon l'ordre dépendrait du rowid.
				"SELECT saison, episode, quand FROM vus WHERE membre = ? " +
					"ORDER BY quand DESC, saison DESC, episode DESC LIMIT ?"
			)
			.all(membre, limite) as Visionnage[];
	}

	comptesParSaison(membre: string): Map<number, number> {
		const lignes = this.db
			.prepare("SELECT saison, COUNT(*) AS n FROM vus WHERE membre = ? GROUP BY saison")
			.all(membre) as { saison: number; n: number }[];
		return new Map(lignes.map((ligne) => [ligne.saison, ligne.n]));
	}

	ajouterAListe(membre: string, cle: CleEpisode, quand: number): void {
		this.db
			.prepare(
				"INSERT INTO ma_liste (membre, saison, episode, ajouteLe) VALUES (?, ?, ?, ?) " +
					"ON CONFLICT(membre, saison, episode) DO UPDATE SET ajouteLe = excluded.ajouteLe"
			)
			.run(membre, cle.saison, cle.episode, quand);
	}

	retirerDeListe(membre: string, cle: CleEpisode): void {
		this.db
			.prepare("DELETE FROM ma_liste WHERE membre = ? AND saison = ? AND episode = ?")
			.run(membre, cle.saison, cle.episode);
	}

	estDansListe(membre: string, cle: CleEpisode): boolean {
		const ligne = this.db
			.prepare("SELECT 1 AS present FROM ma_liste WHERE membre = ? AND saison = ? AND episode = ?")
			.get(membre, cle.saison, cle.episode);
		return ligne !== null && ligne !== undefined;
	}

	liste(membre: string, limite: number): EntreeListe[] {
		return this.db
			.prepare(
				"SELECT saison, episode, ajouteLe FROM ma_liste WHERE membre = ? ORDER BY ajouteLe DESC LIMIT ?"
			)
			.all(membre, limite) as EntreeListe[];
	}

	fermer(): void {
		this.db.close();
	}
}
