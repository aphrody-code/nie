/**
 * Le forum comme catalogue : un fil par saison, tenu à jour par le bot.
 *
 * ── UN FIL PAR SAISON, PAS PAR ÉPISODE ─────────────────────────────────────
 * Un fil par épisode ferait douze cents fils : illisible, et Discord archive
 * les plus anciens. Une saison tient dans UN message — mais pas dans un seul
 * embed : 51 épisodes en deux langues dépassent les 4 096 caractères d'une
 * description. D'où le format compact de `listerSaison` (pas de titre, liens
 * `youtu.be`) et son découpage en pages, sous le plafond de 6 000 caractères
 * que Discord applique à l'ensemble des embeds d'un message.
 *
 * ── LE FIL EST RETROUVÉ PAR IDENTIFIANT ────────────────────────────────────
 * La correspondance saison → fil est mémorisée dans le cache. Chercher par nom
 * casserait au premier renommage, et l'expérience de ce serveur est qu'un nom
 * se fait renommer. Un fil disparu (supprimé à la main) est simplement recréé.
 *
 * ── LE BOT MODIFIE, IL NE REPUBLIE PAS ─────────────────────────────────────
 * Le message d'ouverture d'un fil de forum porte l'identifiant du fil : il se
 * modifie. Republier à chaque rafraîchissement noierait les discussions des
 * membres sous des listes identiques.
 */

import type { Catalogue } from "./catalogue.ts";
import { ecranFilArc } from "./ecrans.ts";
import { grouperParEpisode, meilleurTitre, premiereVignette } from "./ui/index.ts";
import type { Marque } from "./ui/theme.ts";
import type { MessageV2 } from "./ui/v2.ts";

/** Clé de métadonnée portant la table saison → identifiant de fil. */
export const CLE_FILS = "wonderbot:forum-fils";

/** Préfixe des `custom_id` des menus du forum. */
export const PREFIXE_MENU = "wb:ep";

/** Menu déroulant d'épisodes, indépendant de discord.js pour rester testable. */
export interface MenuEpisodes {
	customId: string;
	placeholder: string;
	options: { label: string; value: string; description?: string }[];
}

/** Un menu Discord accepte 25 options ; un message en accepte 5. */
const OPTIONS_PAR_MENU = 25;
const MENUS_PAR_MESSAGE = 5;

/** Valeur d'option : `saison:numéro`. */
export function valeurOption(saison: number, numero: number): string {
	return `${saison}:${numero}`;
}

/** Lit une valeur d'option, `null` si elle est malformée. */
export function lireValeurOption(valeur: string): { saison: number; numero: number } | null {
	const [saison, numero] = valeur.split(":").map((part) => Number.parseInt(part, 10));
	if (!Number.isFinite(saison) || !Number.isFinite(numero)) return null;
	return { saison: saison!, numero: numero! };
}

/**
 * Menus de sélection d'une saison, découpés par tranches de 25.
 *
 * C'est ce qui remplace les liens : un membre choisit son épisode ici et le bot
 * lui répond avec le lecteur intégré, sans jamais l'envoyer sur un site tiers.
 * Au-delà de cinq menus (125 épisodes) le reste n'est pas proposé — aucune
 * saison n'approche ce volume, et un message n'accepte pas plus de cinq rangées.
 */
export function menusDeSaison(
	saison: number,
	numeros: readonly number[]
): MenuEpisodes[] {
	const menus: MenuEpisodes[] = [];
	for (let page = 0; page * OPTIONS_PAR_MENU < numeros.length && page < MENUS_PAR_MESSAGE; page++) {
		const tranche = numeros.slice(page * OPTIONS_PAR_MENU, (page + 1) * OPTIONS_PAR_MENU);
		if (tranche.length === 0) break;
		const premier = tranche[0]!;
		const dernier = tranche[tranche.length - 1]!;
		menus.push({
			customId: `${PREFIXE_MENU}:${saison}:${page}`,
			placeholder:
				numeros.length <= OPTIONS_PAR_MENU
					? "Choisis un épisode à regarder"
					: `Épisodes ${premier} à ${dernier}`,
			options: tranche.map((numero) => ({
				label: `Épisode ${numero}`,
				value: valeurOption(saison, numero),
			})),
		});
	}
	return menus;
}

/** Ce que la synchronisation attend de Discord — remplacé par une doublure en test. */
export interface PasserelleForum {
	/** Identifiants des fils encore présents dans le salon forum. */
	filsExistants(): Promise<string[]>;
	/** Crée un fil et rend son identifiant. */
	creerFil(nom: string, message: MessageV2, etiquettes: string[]): Promise<string>;
	/** Réécrit le message d'ouverture d'un fil. */
	majFil(filId: string, nom: string, message: MessageV2, etiquettes: string[]): Promise<void>;
	/**
	 * Supprime un fil.
	 *
	 * ── LA SEULE OPÉRATION DESTRUCTRICE DU BOT ─────────────────────────────
	 * Elle n'est appelée QUE par une reconstruction explicitement demandée
	 * (`recreer`), jamais par la synchronisation ordinaire : une saison qui
	 * disparaît du catalogue est bien plus souvent un scraping raté qu'une
	 * saison retirée, et supprimer un fil emporte les discussions qu'il porte.
	 */
	supprimerFil(filId: string): Promise<void>;
}

/** Ce que la synchronisation attend du support de persistance. */
export interface StockageFils {
	lireMeta(cle: string): string | null;
	ecrireMeta(cle: string, valeur: string): void;
}

export interface OptionsForum {
	catalogue: Catalogue;
	passerelle: PasserelleForum;
	stockage: StockageFils;
	marque: Marque;
	/** Étiquettes du forum, par libellé en minuscules → identifiant. */
	etiquettes?: Readonly<Record<string, string>>;
	/**
	 * Trous confirmés (`"3:7"`), affichés dans le fil de la saison. Un épisode
	 * qu'on sait manquant est une information utile — la taire laisse croire
	 * que la liste est complète.
	 */
	lacunesConfirmees?: ReadonlySet<string>;
	/**
	 * Horodatage du dernier rafraîchissement, affiché en tête de fil.
	 *
	 * Une FONCTION : la valeur change à chaque passage, et la capturer à la
	 * construction figerait la date du démarrage du bot dans tous les fils.
	 */
	rafraichiLe?: () => number;
}

export interface ResultatSynchronisation {
	crees: number[];
	majs: number[];
	/** Saisons dont le fil avait disparu et qui ont été recréées. */
	recrees: number[];
}

/** Table saison → fil, tolérante à une valeur abîmée. */
export function analyserTableFils(brut: string | null): Map<number, string> {
	if (!brut || brut.trim() === "") return new Map();
	try {
		const valeur: unknown = JSON.parse(brut);
		if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return new Map();
		return new Map(
			Object.entries(valeur as Record<string, unknown>)
				.filter((entree): entree is [string, string] => typeof entree[1] === "string")
				.map(([saison, fil]) => [Number(saison), fil] as const)
				.filter(([saison]) => Number.isFinite(saison))
		);
	} catch {
		// Table illisible : on repart d'une table vide. Les fils orphelins seront
		// recréés, ce qui vaut mieux que de refuser de synchroniser.
		return new Map();
	}
}

/**
 * Nom du fil d'un arc. C'est lui qui se lit dans la liste du forum, d'où
 * l'importance du nom donné par la source : « Films — 5 » plutôt que
 * « Saison 10 — 5 ».
 */
export function nomFilSaison(saison: number, episodes: number, nom?: string | null): string {
	return `${nom?.trim() || `Saison ${saison}`} — ${episodes} épisode(s)`;
}

/**
 * Étiquettes à poser sur le fil d'une saison : les langues réellement présentes.
 * Une étiquette absente du forum est simplement ignorée — le fil vaut mieux
 * sans étiquette que pas de fil du tout.
 */
export function etiquettesDeSaison(
  langues: Readonly<Record<string, number>>,
  disponibles: Readonly<Record<string, string>>
): string[] {
	const voulues: string[] = [];
	if ((langues.vf ?? 0) > 0) voulues.push("vf");
	if ((langues.vostfr ?? 0) > 0) voulues.push("vostfr");
	return voulues.map((nom) => disponibles[nom]).filter((id): id is string => typeof id === "string");
}

export class SynchronisationForum {
	private readonly options: OptionsForum;

	constructor(options: OptionsForum) {
		this.options = options;
	}

	/** Numéros confirmés manquants pour une saison, croissants. */
	private manquantsDe(saison: number): number[] {
		const confirmes = this.options.lacunesConfirmees;
		if (!confirmes || confirmes.size === 0) return [];
		const prefixe = `${saison}:`;
		return [...confirmes]
			.filter((cle) => cle.startsWith(prefixe))
			.map((cle) => Number(cle.slice(prefixe.length)))
			.filter((n) => Number.isFinite(n))
			.sort((a, b) => a - b);
	}

	private table(): Map<number, string> {
		return analyserTableFils(this.options.stockage.lireMeta(CLE_FILS));
	}

	private enregistrer(table: Map<number, string>): void {
		this.options.stockage.ecrireMeta(
			CLE_FILS,
			JSON.stringify(Object.fromEntries([...table].map(([s, f]) => [String(s), f])))
		);
	}

	/**
	 * Le message d'ouverture d'un fil : la galerie, la liste, les compteurs.
	 *
	 * ── EN COMPOSANTS V2, ET C'EST CE QUI CHANGE TOUT ──────────────────────
	 * Un embed ne porte qu'UNE image ; un message V2 porte une galerie de dix.
	 * Le fil d'un arc montre donc enfin ses épisodes plutôt que d'en réciter
	 * les numéros. Le prix est un budget de texte plus étroit — 4 000 au lieu
	 * de 6 000 — que `ecranFilArc` absorbe en resserrant les titres au lieu
	 * d'écarter des épisodes.
	 */
	construireMessage(saison: number, nomArc?: string | null): {
		message: MessageV2;
		episodes: number;
		langues: Record<string, number>;
	} {
		const episodes = this.options.catalogue.saison(saison, undefined, 10_000);

		const langues: Record<string, number> = {};
		for (const episode of episodes) langues[episode.language] = (langues[episode.language] ?? 0) + 1;

		const groupes = grouperParEpisode(episodes);
		const message = ecranFilArc({
			saison,
			// Le nom donné par la source fait autorité : le dixième arc s'appelle
			// « Films », pas « Saison 10 ».
			nom: nomArc?.trim() || `Saison ${saison}`,
			episodes: groupes.map((groupe) => ({
				numero: groupe.numero ?? 0,
				titre: meilleurTitre(groupe.versions),
				langues: [...new Set(groupe.versions.map((version) => version.language))],
				vignette: premiereVignette(groupe.versions),
				// Un fil est PUBLIC : aucun état personnel n'y a sa place.
				vu: false,
				dansListe: false,
			})),
			langues,
			introuvables: this.manquantsDe(saison),
			rafraichiLe: this.options.rafraichiLe?.() ?? 0,
			marque: this.options.marque,
		});

		return { message, episodes: groupes.length, langues };
	}

	/**
	 * Met le forum en accord avec le catalogue : un fil par saison, créé s'il
	 * manque, réécrit s'il existe. Ne supprime jamais un fil — les membres y
	 * discutent, et une saison qui disparaît du catalogue est plus souvent un
	 * scraping raté qu'une saison retirée.
	 */
	async synchroniser(): Promise<ResultatSynchronisation> {
		const saisons = this.options.catalogue.saisonsDisponibles();
		if (saisons.length === 0) {
			return { crees: [], majs: [], recrees: [] };
		}

		const table = this.table();
		const noms = this.options.catalogue.nomsDeSaisons();
		const vivants = new Set(await this.options.passerelle.filsExistants());
		const etiquettes = this.options.etiquettes ?? {};
		const resultat: ResultatSynchronisation = { crees: [], majs: [], recrees: [] };

		for (const saison of saisons) {
			const { message, episodes, langues } = this.construireMessage(saison, noms.get(saison));
			const nom = nomFilSaison(saison, episodes, noms.get(saison));
			const tags = etiquettesDeSaison(langues, etiquettes);
			const connu = table.get(saison);

			if (connu && vivants.has(connu)) {
				await this.options.passerelle.majFil(connu, nom, message, tags);
				resultat.majs.push(saison);
				continue;
			}

			const filId = await this.options.passerelle.creerFil(nom, message, tags);
			table.set(saison, filId);
			(connu ? resultat.recrees : resultat.crees).push(saison);
		}

		this.enregistrer(table);
		return resultat;
	}

	/**
	 * Reconstruit le forum de zéro : tout supprimer, tout recréer.
	 *
	 * ── C'EST DESTRUCTEUR, ET CE N'EST JAMAIS AUTOMATIQUE ──────────────────
	 * Supprimer un fil emporte les messages qu'il porte. La synchronisation
	 * ordinaire ne supprime donc RIEN — elle modifie. Cette méthode-ci n'existe
	 * que pour une reconstruction demandée explicitement, quand la forme des
	 * fils a changé au point qu'une modification ne suffit plus.
	 *
	 * `garderNonVides` est une sécurité, active par défaut : un fil où quelqu'un
	 * a écrit n'est pas supprimé, seulement réécrit. On ne détruit pas la parole
	 * des membres pour changer une mise en page.
	 */
	async recreer(
		options: { garderNonVides?: boolean; messagesDe?: (filId: string) => Promise<number> } = {}
	): Promise<ResultatSynchronisation & { supprimes: string[]; conserves: string[] }> {
		const garder = options.garderNonVides ?? true;
		const table = this.table();
		const vivants = new Set(await this.options.passerelle.filsExistants());

		const supprimes: string[] = [];
		const conserves: string[] = [];

		for (const filId of vivants) {
			if (garder && options.messagesDe) {
				// `> 1` : le message d'OUVERTURE est celui du bot. Un fil qui n'a
				// que lui n'a jamais servi à personne.
				const messages = await options.messagesDe(filId).catch(() => 0);
				if (messages > 1) {
					conserves.push(filId);
					continue;
				}
			}
			await this.options.passerelle.supprimerFil(filId);
			supprimes.push(filId);
		}

		// La table ne garde que les fils survivants : les autres n'existent plus,
		// et les laisser ferait chercher des identifiants morts au prochain tour.
		const survivants = new Map(
			[...table.entries()].filter(([, filId]) => conserves.includes(filId))
		);
		this.enregistrer(survivants);

		return { ...(await this.synchroniser()), supprimes, conserves };
	}
}
