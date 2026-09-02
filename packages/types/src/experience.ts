/**
 * Niveaux de communauté — la courbe que les membres connaissent déjà.
 *
 * ── POURQUOI CELLE-CI, ET PLUS CELLE DU JEU ────────────────────────────────
 * Ce module reprenait la table d'expérience d'Inazuma Eleven Victory Road
 * (`inagle_exp_table`, cent paliers), pour que monter de niveau sur le Discord
 * coûte ce que ça coûte en jeu. L'idée était juste et le résultat ne l'était
 * pas : la communauté a passé des années sur **Noctaly**, dont la courbe est
 * celle de tous les bots de niveaux (`5n² + 50n + 100` par palier). Les mêmes
 * XP y donnaient quatre à six niveaux de MOINS — un membre à 44 580 XP lisait
 * « niveau 26 » depuis toujours et se voyait soudain « niveau 32 ».
 *
 * Un niveau n'a de valeur que comparé : entre membres, et à ce qu'on avait
 * hier. Reprendre la courbe de Noctaly, c'est garder cette continuité. La
 * courbe du jeu, elle, reste ce qu'elle a toujours été — la courbe du jeu, que
 * le wiki expose là où elle a un sens.
 *
 * Aligné le 1/9/2026 sur le classement Noctaly, vérifié point par point :
 *
 *   XP        Noctaly   ici
 *   44 580      26       26
 *   29 045      22       22
 *   20 572      19       19
 *   12 280      16       16
 *
 * ── LE NIVEAU 1 EST LE DÉPART ──────────────────────────────────────────────
 * Noctaly affiche « niveau 1 » à zéro XP, là où la formule d'origine compte à
 * partir de 0. C'est le décalage qui explique le dernier écart : `CUMULS[1]`
 * vaut 0, et le premier palier (100 XP) mène au niveau 2.
 *
 *   niveau 10 →      3 720 XP  ≈    186 messages
 *   niveau 25 →     37 820 XP  ≈  1 891 messages
 *   niveau 40 →    136 045 XP  ≈  6 802 messages
 *   niveau 60 →    425 095 XP  ≈ 21 255 messages
 *
 * (à 20 XP par message éligible, soit un message par minute — les règles de
 * Noctaly, reprises telles quelles dans `GAIN_DEFAUT`.)
 */

/**
 * XP nécessaire pour passer du niveau `n` au niveau `n + 1`.
 *
 * `PALIERS_EXPERIENCE[0]` est le coût du niveau 1 → 2, et vaut 100. La formule
 * est celle des bots de niveaux : `5·i² + 50·i + 100` pour le i-ième palier,
 * i comptant à partir de 0. Elle est CALCULÉE plutôt que recopiée : une table
 * de cent nombres se relit mal, et une formule d'une ligne se vérifie.
 */
export const PALIERS_EXPERIENCE: readonly number[] = Object.freeze(
	Array.from({ length: 100 }, (_, index) => 5 * index * index + 50 * index + 100)
);

/** Plafond, celui du jeu. */
export const NIVEAU_MAX = 100;

/**
 * XP cumulée nécessaire pour ATTEINDRE chaque niveau. `CUMULS[1] === 0` : le
 * niveau 1 est le point de départ, il ne se gagne pas.
 *
 * Calculé une fois à l'import plutôt qu'à chaque appel : `niveauPour` est
 * appelé sur chaque message du serveur.
 */
export const CUMULS: readonly number[] = (() => {
	const cumuls: number[] = Array.from({ length: NIVEAU_MAX + 1 }, () => 0);
	for (let niveau = 2; niveau <= NIVEAU_MAX; niveau++) {
		cumuls[niveau] = (cumuls[niveau - 1] as number) + (PALIERS_EXPERIENCE[niveau - 2] as number);
	}
	return Object.freeze(cumuls);
})();

/** XP totale à accumuler pour toucher le plafond. */
export const XP_NIVEAU_MAX = CUMULS[NIVEAU_MAX] as number;

/**
 * XP cumulée à posséder pour être de ce niveau. Hors bornes, on borne plutôt que
 * de lever : un niveau vient parfois d'une colonne, et un `NaN` ne doit pas
 * remonter jusqu'à un affichage.
 */
export function xpPourAtteindre(niveau: number): number {
	if (!Number.isFinite(niveau) || niveau <= 1) {
		return 0;
	}
	return CUMULS[Math.min(NIVEAU_MAX, Math.floor(niveau))] as number;
}

/**
 * Niveau correspondant à une XP cumulée.
 *
 * Recherche dichotomique : 100 paliers ne justifient pas une boucle linéaire sur
 * un chemin appelé à chaque message de deux mille membres.
 */
export function niveauPour(xp: number): number {
	if (!Number.isFinite(xp) || xp <= 0) {
		return 1;
	}
	if (xp >= XP_NIVEAU_MAX) {
		return NIVEAU_MAX;
	}
	let bas = 1;
	let haut = NIVEAU_MAX;
	while (bas < haut) {
		const milieu = Math.ceil((bas + haut) / 2);
		if ((CUMULS[milieu] as number) <= xp) {
			bas = milieu;
		} else {
			haut = milieu - 1;
		}
	}
	return bas;
}

/** Tout ce qu'une carte de profil a besoin de savoir sur une XP. */
export interface Progression {
	niveau: number;
	xp: number;
	/** XP acquise DANS le niveau courant. */
	xpDansNiveau: number;
	/** XP que coûte le passage au niveau suivant, `0` au plafond. */
	xpDuNiveau: number;
	/** Ce qu'il reste à gagner pour monter, `0` au plafond. */
	restant: number;
	/** Avancement dans le niveau, de 0 à 1. Vaut 1 au plafond. */
	ratio: number;
	/** Vrai quand le plafond du jeu est atteint. */
	auMaximum: boolean;
}

/** Décompose une XP cumulée pour l'affichage. */
export function progression(xp: number): Progression {
	const total = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
	const niveau = niveauPour(total);
	if (niveau >= NIVEAU_MAX) {
		return {
			auMaximum: true,
			niveau: NIVEAU_MAX,
			ratio: 1,
			restant: 0,
			xp: total,
			xpDansNiveau: 0,
			xpDuNiveau: 0,
		};
	}
	const base = CUMULS[niveau] as number;
	const xpDuNiveau = PALIERS_EXPERIENCE[niveau - 1] as number;
	const xpDansNiveau = total - base;
	return {
		auMaximum: false,
		niveau,
		ratio: xpDuNiveau === 0 ? 0 : xpDansNiveau / xpDuNiveau,
		restant: xpDuNiveau - xpDansNiveau,
		xp: total,
		xpDansNiveau,
		xpDuNiveau,
	};
}

/**
 * Niveaux FRANCHIS entre deux XP cumulées, dans l'ordre.
 *
 * Rend une liste et non un booléen : un gain exceptionnel (un don d'XP, une
 * correction) peut franchir plusieurs paliers d'un coup, et chacun peut porter
 * sa propre récompense de rôle. N'annoncer que le dernier ferait sauter les
 * rôles intermédiaires en silence.
 */
export function niveauxFranchis(xpAvant: number, xpApres: number): number[] {
	const depart = niveauPour(xpAvant);
	const arrivee = niveauPour(xpApres);
	if (arrivee <= depart) {
		return [];
	}
	const franchis: number[] = [];
	for (let niveau = depart + 1; niveau <= arrivee; niveau++) {
		franchis.push(niveau);
	}
	return franchis;
}

// ─── Rangs ──────────────────────────────────────────────────────────────────

/**
 * L'échelle de rareté du jeu, telle qu'elle est écrite dans les données
 * françaises (`inagle_characters.rarity_label`, relevé le 14/8/2026 :
 * Normal 5 805 · Expérimenté 150 · Héros 122 · BASARA 71).
 *
 * On ne réinvente donc pas un vocabulaire (« Bronze », « Diamant »…) : le membre
 * lit sur sa carte le même mot que sur les fiches du wiki, et la rareté d'un
 * rang correspond à la rareté réelle de la catégorie dans le jeu.
 */
export interface Rang {
	/** Libellé exact des données FR du jeu. */
	nom: string;
	/** Premier niveau du rang. */
	depuis: number;
	/** Rôle de couleur à demander au thème (`lib/canvas/theme.ts`). */
	teinte: "texteAttenue" | "azalee" | "brique" | "or";
}

export const RANGS: readonly Rang[] = Object.freeze([
	{ depuis: 1, nom: "Normal", teinte: "texteAttenue" },
	{ depuis: 20, nom: "Expérimenté", teinte: "azalee" },
	{ depuis: 50, nom: "Héros", teinte: "brique" },
	{ depuis: 80, nom: "BASARA", teinte: "or" },
]);

/** Rang d'un niveau. Toujours défini : le premier rang commence au niveau 1. */
export function rangDe(niveau: number): Rang {
	const borne = Number.isFinite(niveau) ? niveau : 1;
	let trouve = RANGS[0] as Rang;
	for (const rang of RANGS) {
		if (borne >= rang.depuis) {
			trouve = rang;
		}
	}
	return trouve;
}

/** Niveau du prochain rang, `null` quand le dernier est atteint. */
export function prochainRang(niveau: number): Rang | null {
	return RANGS.find((rang) => rang.depuis > niveau) ?? null;
}

// ─── Gain d'expérience ──────────────────────────────────────────────────────

/**
 * Réglages du gain, valeurs par défaut.
 *
 * Le DÉLAI est ce qui fait la différence entre un système de niveaux et un
 * concours de spam : sans lui, quinze messages d'un mot rapportent quinze fois
 * plus qu'un vrai échange. Une minute est la valeur de fait du domaine, et elle
 * a le mérite d'être invisible pour qui discute normalement.
 *
 * Les valeurs viennent de `@rosegriffon/types/bot` : ce sont les MÊMES que
 * celles du schéma des réglages, et le formulaire du site les affiche comme
 * « valeur par défaut ». Les redéclarer ici les ferait diverger le jour où l'un
 * des deux bouge — et personne ne verrait qu'un serveur gagne 15–25 XP quand
 * l'interface promet autre chose.
 */
// Réexporté sous son nom court : le reste du module (et le bot) le connaît
// comme `GAIN_DEFAUT`, alors que le contrat des réglages le nomme `GAIN_XP_DEFAUT`.
import { GAIN_XP_DEFAUT as GAIN_DEFAUT } from "./bot";

export { GAIN_DEFAUT };

export interface ReglesGain {
	minimum: number;
	maximum: number;
	delaiSecondes: number;
}

/**
 * XP d'un message, tirée dans la fourchette.
 *
 * Le hasard est INJECTÉ : c'est ce qui rend la fonction testable (un tirage figé
 * donne toujours la même valeur) et ce qui évite un `Math.random()` planqué au
 * milieu d'un module par ailleurs pur.
 */
export function gainDeMessage(regles: ReglesGain = GAIN_DEFAUT, tirage: number = Math.random()): number {
	const bas = Math.max(0, Math.floor(regles.minimum));
	const haut = Math.max(bas, Math.floor(regles.maximum));
	const borne = Number.isFinite(tirage) ? Math.min(0.999_999, Math.max(0, tirage)) : 0;
	return bas + Math.floor(borne * (haut - bas + 1));
}

/**
 * Le message rapporte-t-il, ou tombe-t-il dans le délai anti-spam ?
 *
 * Un `dernier` absent (premier message du membre) rapporte toujours : sans ça,
 * l'arrivée d'un nouveau membre serait la seule occasion où le système ne
 * compte pas.
 */
export function messageEligible(
	dernier: Date | string | number | null | undefined,
	maintenant: Date = new Date(),
	delaiSecondes: number = GAIN_DEFAUT.delaiSecondes
): boolean {
	if (dernier === null || dernier === undefined || dernier === "") {
		return true;
	}
	const instant = dernier instanceof Date ? dernier : new Date(dernier);
	const ms = instant.getTime();
	if (Number.isNaN(ms)) {
		return true;
	}
	return maintenant.getTime() - ms >= Math.max(0, delaiSecondes) * 1_000;
}

/**
 * Cette montée mérite-t-elle une annonce publique ?
 *
 * ── POURQUOI FILTRER ───────────────────────────────────────────────────────
 * En début de courbe, un membre actif monte tous les deux ou trois jours (le
 * niveau 10 coûte 2 422 XP, soit ~121 messages). Multiplié par les membres
 * actifs d'un serveur de deux mille, l'annonce à chaque niveau rend le salon
 * illisible en une semaine — et c'est toujours la même chose qui se passe
 * ensuite : le staff coupe le bot.
 *
 * On n'annonce donc que ce qui se fête : les paliers ronds, et les trois
 * changements de rang d'une vie de membre. Le reste se lit sur `/profil`, à la
 * demande de l'intéressé.
 */
export function meriteAnnonce(
	niveauAvant: number,
	niveauApres: number,
	options: { palier?: number; annoncerRang?: boolean } = {}
): boolean {
	if (niveauApres <= niveauAvant) {
		return false;
	}
	if (options.annoncerRang !== false && rangDe(niveauApres).nom !== rangDe(niveauAvant).nom) {
		return true;
	}
	const palier = Math.max(1, Math.floor(options.palier ?? 5));
	if (palier === 1) {
		return true;
	}
	// Un gain exceptionnel peut franchir plusieurs niveaux d'un coup : on annonce
	// dès qu'un palier a été TRAVERSÉ, pas seulement atterri dessus.
	return Math.floor(niveauApres / palier) > Math.floor(niveauAvant / palier);
}

/**
 * Jetons Kizuna offerts pour une montée de niveau.
 *
 * Croissants avec le niveau : franchir le niveau 50 doit rapporter plus que
 * franchir le niveau 2, sans quoi la seule stratégie rentable serait de rester
 * en bas de l'échelle.
 */
export function jetonsDeMontee(
	niveau: number,
	parNiveau: number = GAIN_DEFAUT.jetonsParNiveau
): number {
	const borne = Number.isFinite(niveau) ? Math.max(1, Math.floor(niveau)) : 1;
	return borne * Math.max(0, Math.floor(parNiveau));
}
