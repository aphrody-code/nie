/**
 * `/episodes` — la seule racine de commandes de Wonderbot.
 *
 * ⚠ Le nom de la commande, ses descriptions et ses réponses sont PUBLICS : ils
 * s'affichent dans le client Discord de chaque membre. Aucun n'emploie de nom
 * déposé — la racine s'appelait `/ietv`, elle a été renommée pour cette raison.
 *
 * ── LES HANDLERS NE CONNAISSENT PAS DISCORD.JS ─────────────────────────────
 * Chaque sous-commande reçoit des options déjà lues et rend une {@link Reponse}
 * (des embeds au format de l'API). C'est le pont, dans `bot.ts`, qui traduit
 * une `ChatInputCommandInteraction` en appel et repose la réponse. Résultat :
 * toute la logique de commande se teste avec un objet littéral, sans passerelle,
 * sans jeton et sans serveur.
 */

import {
	ICONES,
	echec,
	fiche,
	horodatageRelatif,
	libelleLangue,
	listerEpisodes,
	repartitionLangues,
	succes,
	vide,
	type Marque,
	type Reponse,
} from "../ui/index.ts";
import type { Catalogue } from "../catalogue.ts";
import {
	ecranAccueil,
	ecranAide,
	ecranArc,
	ecranLecture,
	ecranMaListe,
	ecranProgression,
} from "../ecrans.ts";
// Type seulement : `service.ts` importe `estLisibleEnLigne` d'ici, et une
// importation de valeur dans les deux sens ferait un cycle à l'exécution.
import type { Service } from "../service.ts";

/**
 * Types d'options de l'API Discord. Recopiés plutôt qu'importés de discord.js :
 * ce module doit rester chargeable — et testable — sans la bibliothèque.
 * (`ApplicationCommandOptionType`, valeurs stables depuis l'API v8.)
 */
const TYPE = { sousCommande: 1, chaine: 3, entier: 4 } as const;

const CHOIX_LANGUE = [
	{ name: "VF (doublage français)", value: "vf" },
	{ name: "VOSTFR (VO sous-titrée)", value: "vostfr" },
] as const;

/** Nombre maximal d'épisodes qu'une réponse liste. */
const LIMITE_MAX = 25;
const LIMITE_DEFAUT = 10;

/**
 * Définition envoyée à Discord. Un objet JSON, pas un `SlashCommandBuilder` :
 * `client.application.commands.set()` accepte les deux, et celui-ci se compare
 * dans un test.
 */
export const DEFINITION_IETV = {
	name: "episodes",
	description: "Le catalogue d'épisodes du serveur — VF et VOSTFR",
	options: [
		{
			type: TYPE.sousCommande,
			name: "recherche",
			description: "Chercher un épisode par titre",
			options: [
				{
					type: TYPE.chaine,
					name: "texte",
					description: "Titre, mot-clé, nom d'arc…",
					required: true,
					// Les propositions arrivent pendant la frappe : le membre n'a
					// plus à deviner l'orthographe d'un titre pour le trouver.
					autocomplete: true,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
				{
					type: TYPE.entier,
					name: "limite",
					description: `Nombre de résultats (1 à ${LIMITE_MAX})`,
					min_value: 1,
					max_value: LIMITE_MAX,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "episode",
			description: "Toutes les versions d'un épisode précis",
			options: [
				{
					type: TYPE.entier,
					name: "saison",
					description: "Numéro de saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.entier,
					name: "numero",
					description: "Numéro d'épisode dans la saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "saison",
			description: "Les épisodes d'une saison",
			options: [
				{
					type: TYPE.entier,
					name: "numero",
					description: "Numéro de saison",
					required: true,
					min_value: 1,
				},
				{
					type: TYPE.chaine,
					name: "langue",
					description: "Ne garder qu'une version",
					choices: CHOIX_LANGUE,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "accueil",
			description: "L'accueil : reprendre, parcourir les arcs, ma liste",
		},
		{
			type: TYPE.sousCommande,
			name: "arc",
			description: "Parcourir un arc : la grille de ses épisodes, avec ton avancement",
			options: [
				{
					type: TYPE.entier,
					name: "numero",
					description: "L'arc — tape son nom, les propositions arrivent",
					required: true,
					min_value: 1,
					autocomplete: true,
				},
			],
		},
		{
			type: TYPE.sousCommande,
			name: "suivant",
			description: "Enchaîner sur l'épisode suivant celui que tu viens de voir",
		},
		{
			type: TYPE.sousCommande,
			name: "progression",
			description: "Ton avancement, arc par arc",
		},
		{
			type: TYPE.sousCommande,
			name: "reprendre",
			description: "Reprendre là où tu t'es arrêté",
		},
		{
			type: TYPE.sousCommande,
			name: "maliste",
			description: "Les épisodes que tu as mis de côté",
		},
		{
			type: TYPE.sousCommande,
			name: "hasard",
			description: "Un épisode au hasard, de préférence pas encore vu",
		},
		{
			type: TYPE.sousCommande,
			name: "vocal",
			description: "Écouter la bande son dans ton salon vocal",
		},
		{
			type: TYPE.sousCommande,
			name: "catalogue",
			description: "État du catalogue : sources, volumes, fraîcheur",
		},
		{
			type: TYPE.sousCommande,
			name: "aide",
			description: "Ce que sait faire le bot, et par où commencer",
		},
		{
			type: TYPE.sousCommande,
			name: "rafraichir",
			description: "Rescraper toutes les sources (staff)",
		},
	],
} as const;

/**
 * Sous-commandes dont la réponse ne regarde que l'appelant.
 *
 * Le choix se fait AVANT l'exécution, et ce n'est pas un détail : Discord fige
 * la visibilité au `deferReply`. Une réponse différée publiquement ne peut plus
 * devenir éphémère, `editReply` refuse le drapeau. `rafraichir` est du bruit
 * d'exploitation — il n'a rien à faire dans le fil d'un salon public.
 */
const SOUS_COMMANDES_PRIVEES = new Set([
	"rafraichir",
	// ── LES ÉCRANS PERSONNELS SONT PRIVÉS ──────────────────────────────────
	// Ces quatre-là affichent l'avancement de l'APPELANT : ce qu'il a vu, ce
	// qu'il a mis de côté, où il en est. Publiés dans le salon, ils exposeraient
	// ses habitudes à tout le serveur — et leurs boutons modifieraient un
	// message que tout le monde voit, si bien qu'un clic changerait l'écran sous
	// les yeux des autres.
	"maliste",
	"accueil",
	"arc",
	"progression",
	"reprendre",
	"suivant",
	"hasard",
]);

/** La réponse à cette sous-commande doit-elle être privée ? */
export function reponsePrivee(sousCommande: string): boolean {
	return SOUS_COMMANDES_PRIVEES.has(sousCommande);
}

/** Options d'une interaction, déjà lues — un objet littéral suffit en test. */
export interface OptionsCommande {
	chaine(nom: string): string | null;
	entier(nom: string): number | null;
}

/** Lecteur d'options à partir d'un simple objet. */
export function optionsDepuisObjet(source: Record<string, string | number | undefined>): OptionsCommande {
	return {
		chaine: (nom) => {
			const valeur = source[nom];
			return typeof valeur === "string" ? valeur : null;
		},
		entier: (nom) => {
			const valeur = source[nom];
			return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
		},
	};
}

export interface ContexteCommande {
	catalogue: Catalogue;
	marque: Marque;
	/** Vrai si l'appelant a le droit de déclencher un rafraîchissement. */
	estStaff: boolean;
	/** Plafond d'affichage des annonces, repris dans le résumé. */
	now?: () => number;
	/**
	 * Service de lecture — il croise le catalogue et la progression du membre.
	 *
	 * FACULTATIF à dessein : les cinq sous-commandes historiques (recherche,
	 * episode, saison, catalogue, rafraichir) n'en ont pas besoin et restent
	 * testables avec un simple catalogue. Les écrans de lecture, eux, le
	 * réclament — et disent lequel manque plutôt que d'échouer sur `undefined`.
	 */
	service?: Service;
	/** Identifiant Discord de l'appelant, requis par les écrans personnels. */
	membre?: string;
}

type Langue = "vf" | "vostfr";

function lireLangue(options: OptionsCommande): Langue | undefined {
	const brut = options.chaine("langue");
	return brut === "vf" || brut === "vostfr" ? brut : undefined;
}

/** Plateformes dont Discord sait rendre un lecteur inline. */
const HOTES_LISIBLES = ["youtube.com", "youtu.be", "twitch.tv", "vimeo.com", "dailymotion.com"];

/**
 * L'URL produit-elle un lecteur dans Discord ?
 *
 * Discord n'intègre de lecteur que pour les plateformes qu'il connaît. Une page
 * de site, même si elle contient une vidéo, ne rend qu'une carte. Le test porte
 * sur l'HÔTE, pas sur la chaîne entière : un chemin contenant « youtube » sur un
 * autre domaine ne doit pas passer pour lisible.
 */
export function estLisibleEnLigne(url: string): boolean {
	let hote: string;
	try {
		hote = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return false;
	}
	return HOTES_LISIBLES.some((connu) => hote === connu || hote.endsWith(`.${connu}`));
}

/**
 * `2009-04-08` → `<t:…:D>`, l'horodatage natif de Discord.
 *
 * Il s'affiche dans le fuseau et la langue de chaque lecteur, là où une date
 * écrite en dur impose le format de celui qui l'a produite.
 */
export function dateLisible(iso: string): string {
	const instant = Date.parse(`${iso}T12:00:00Z`);
	return Number.isFinite(instant) ? `<t:${Math.floor(instant / 1000)}:D>` : iso;
}

/** Suffixe `(VF)` accolé aux titres quand un filtre de langue est actif. */
function mentionLangue(langue: Langue | undefined): string {
	return langue ? ` — ${libelleLangue(langue)}` : "";
}

/**
 * Exécute une sous-commande de `/ietv`.
 *
 * Une sous-commande inconnue rend un échec plutôt que de lever : Discord a déjà
 * accusé réception de l'interaction, une exception ici laisserait le membre
 * devant un « L'application n'a pas répondu » sans explication.
 */
export async function executerIetv(
	sousCommande: string,
	options: OptionsCommande,
	contexte: ContexteCommande
): Promise<Reponse> {
	switch (sousCommande) {
		case "recherche":
			return recherche(options, contexte);
		case "episode":
			return episode(options, contexte);
		case "saison":
			return saison(options, contexte);
		case "accueil":
			return accueil(contexte);
		case "arc":
			return arc(options, contexte);
		case "suivant":
			return suivant(contexte);
		case "progression":
			return progression(contexte);
		case "aide":
			return aide(contexte);
		case "reprendre":
			return reprendre(contexte);
		case "maliste":
			return maListe(contexte);
		case "hasard":
			return hasard(contexte);
		case "catalogue":
			return catalogue(contexte);
		case "rafraichir":
			return rafraichir(contexte);
		default:
			return echec(
				"Sous-commande inconnue",
				`\`${sousCommande}\` n'existe pas. Tape \`/episodes\` et choisis dans la liste.`,
				contexte.marque
			);
	}
}

/**
 * L'appelant a-t-il CHOISI une proposition d'autocomplétion ?
 *
 * ── UNE PROPOSITION CHOISIE N'EST PAS UNE RECHERCHE ────────────────────────
 * Discord envoie la VALEUR de la proposition, pas son libellé : le membre voit
 * « GO E12 · Le Stade Aérodrome » et le bot reçoit `4:12`. Traité comme du
 * texte libre, ce `4:12` ne correspondrait à aucun titre et la recherche
 * répondrait « aucun épisode » sur l'épisode que le membre venait justement de
 * désigner. On le reconnaît donc, et on ouvre directement le lecteur.
 */
export function cleAutocompletion(texte: string): { saison: number; episode: number } | null {
	const trouve = /^(\d{1,4}):(\d{1,5})$/.exec(texte.trim());
	if (!trouve) return null;
	return { saison: Number(trouve[1]), episode: Number(trouve[2]) };
}

function recherche(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const texte = (options.chaine("texte") ?? "").trim();
	if (texte === "") {
		return echec("Recherche vide", "Donne au moins un mot à chercher.", contexte.marque);
	}

	const choisi = cleAutocompletion(texte);
	if (choisi && contexte.service && contexte.membre) {
		const vue = contexte.service.lecture(contexte.membre, choisi);
		if (vue) return ecranLecture(vue);
		// Proposition périmée : le catalogue a bougé entre la frappe et l'envoi.
		return vide(
			"Épisode indisponible",
			"Cet épisode a quitté le catalogue depuis que la proposition s'est affichée.",
			contexte.marque
		);
	}

	const langue = lireLangue(options);
	const limite = Math.min(options.entier("limite") ?? LIMITE_DEFAUT, LIMITE_MAX);
	const resultats = contexte.catalogue.rechercher({
		texte,
		...(langue ? { langue } : {}),
		limite,
	});

	if (resultats.length === 0) {
		return vide(
			"Aucun épisode",
			`Rien pour « ${texte} »${mentionLangue(langue)}. Essaie un mot-clé plus court, ` +
				"ou `/episodes saison` pour parcourir une saison entière.",
			contexte.marque
		);
	}

	const liste = listerEpisodes(resultats, { limite });
	return {
		embeds: [
			fiche({
				titre: `${ICONES.recherche} « ${texte} »${mentionLangue(langue)}`,
				marque: contexte.marque,
			})
				.description(liste.texte)
				.finir(`${liste.affiches} sur ${resultats.length}`),
		],
	};
}

function episode(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const saisonDemandee = options.entier("saison");
	const numero = options.entier("numero");
	if (saisonDemandee === null || numero === null) {
		return echec(
			"Épisode incomplet",
			"Il faut la saison ET le numéro : `/episodes episode saison:1 numero:5`.",
			contexte.marque
		);
	}

	const langue = lireLangue(options);
	const versions = contexte.catalogue.episode(saisonDemandee, numero, langue);

	if (versions.length === 0) {
		const disponibles = contexte.catalogue.saisonsDisponibles();
		const piste =
			disponibles.length === 0
				? "Le catalogue est vide : lance `/episodes rafraichir` ou attends le prochain passage."
				: `Saisons au catalogue : ${disponibles.join(", ")}.`;
		return vide(
			`S${saisonDemandee}E${numero} introuvable`,
			`Aucune version${mentionLangue(langue)} pour cet épisode. ${piste}`,
			contexte.marque
		);
	}

	const principal = versions[0]!;
	const f = fiche({
		titre: `${ICONES.episode} Saison ${saisonDemandee}, épisode ${numero}`,
		marque: contexte.marque,
	})
		.description(principal.description ?? "")
		.miniature(principal.thumbnail);

	// Titre original et date de première diffusion : ils viennent de la
	// chronologie et n'existent sur aucune des sources vidéo.
	const original = [principal.titleJp, principal.romaji].filter(Boolean).join(" · ");
	if (original) f.champ("Titre original", original, { enLigne: true });
	if (principal.publishDate) {
		f.champ("Première diffusion", dateLisible(principal.publishDate), { enLigne: true });
	}

	// Un champ par version : le même épisode existe en VF et en VOSTFR, souvent
	// sur plusieurs chaînes. Les empiler dans la description perdrait le lien.
	for (const version of versions) {
		f.champ(
			`${libelleLangue(version.language)}${version.channel ? ` · ${version.channel}` : ""}`,
			`[${version.title}](${version.url})`
		);
	}

	// URL nue en contenu : c'est ce que Discord transforme en lecteur. On prend
	// la première version lisible en ligne — une page de site ne donne qu'une
	// carte, seule une URL de plateforme vidéo produit un lecteur.
	const jouable = versions.find((version) => estLisibleEnLigne(version.url));

	return {
		embeds: [f.finir(`${versions.length} version(s)`)],
		...(jouable ? { contenu: jouable.url } : {}),
	};
}

function saison(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const numero = options.entier("numero");
	if (numero === null) {
		return echec("Saison manquante", "Précise la saison : `/episodes saison numero:2`.", contexte.marque);
	}

	const langue = lireLangue(options);
	const episodes = contexte.catalogue.saison(numero, langue);

	if (episodes.length === 0) {
		const disponibles = contexte.catalogue.saisonsDisponibles();
		return vide(
			`Saison ${numero} absente`,
			disponibles.length === 0
				? "Le catalogue est vide : lance `/episodes rafraichir`."
				: `Saisons au catalogue : ${disponibles.join(", ")}.`,
			contexte.marque
		);
	}

	const liste = listerEpisodes(episodes, { limite: LIMITE_MAX });
	return {
		embeds: [
			fiche({
				titre: `${ICONES.saison} Saison ${numero}${mentionLangue(langue)}`,
				marque: contexte.marque,
			})
				.description(liste.texte)
				.finir(`${liste.affiches} sur ${episodes.length}`),
		],
	};
}

/**
 * Le service et l'appelant, ou un échec qui dit lequel manque.
 *
 * Une commande de lecture appelée sans service configuré doit le DIRE : un
 * `undefined` propagé jusqu'à l'écran produirait un « L'application n'a pas
 * répondu » qui n'apprend rien à personne.
 */
function exigerService(
	contexte: ContexteCommande
): { service: Service; membre: string } | Reponse {
	if (!contexte.service || !contexte.membre) {
		return echec(
			"Lecture indisponible",
			"Le service de lecture n'est pas branché sur ce bot. Les commandes de consultation " +
				"(`/episodes recherche`, `saison`, `catalogue`) fonctionnent toujours.",
			contexte.marque
		);
	}
	return { service: contexte.service, membre: contexte.membre };
}

/** Écran d'accueil — le point d'entrée du service de lecture. */
function accueil(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;
	return { embeds: [], v2: ecranAccueil(acces.service.accueil(acces.membre)) };
}

/** La grille d'un arc — la surface de parcours principale. */
function arc(options: OptionsCommande, contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;

	const numero = options.entier("numero");
	if (numero === null) {
		return echec("Arc manquant", "Précise l'arc : `/episodes arc numero:4`.", contexte.marque);
	}

	const vue = acces.service.arc(acces.membre, numero, 0);
	if (vue.total === 0) {
		const disponibles = contexte.catalogue.saisonsDisponibles();
		return vide(
			`Arc ${numero} absent`,
			disponibles.length === 0
				? "Le catalogue est vide : lance `/episodes rafraichir`."
				: `Arcs au catalogue : ${disponibles.join(", ")}.`,
			contexte.marque
		);
	}
	return { embeds: [], v2: ecranArc(vue) };
}

/**
 * L'épisode SUIVANT celui qu'on vient de voir.
 *
 * Différent de `reprendre` : « reprendre » propose le premier NON VU, qui peut
 * être un épisode ancien laissé de côté ; « suivant » enchaîne strictement
 * après le dernier visionnage. Les deux existent parce qu'on veut tantôt
 * combler un trou, tantôt continuer sa série.
 */
function suivant(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;

	const apres = acces.service.apresDernierVu(acces.membre);
	if (!apres) {
		return vide(
			"Rien à enchaîner",
			"Tu n'as encore rien regardé — `/episodes accueil` pour commencer, " +
				"ou `/episodes hasard` pour te laisser porter.",
			contexte.marque
		);
	}

	const vue = acces.service.lecture(acces.membre, apres);
	return vue
		? ecranLecture(vue)
		: vide("Épisode indisponible", "Cet épisode a quitté le catalogue.", contexte.marque);
}

/** L'avancement de l'appelant, arc par arc. */
function progression(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;
	return { embeds: [], v2: ecranProgression(acces.service.progressionGlobale(acces.membre)) };
}

/** Ce que le bot sait faire — la porte d'entrée pour un nouveau membre. */
function aide(contexte: ContexteCommande): Reponse {
	return { embeds: [], v2: ecranAide(contexte.marque) };
}

/** « Ma liste » — les épisodes mis de côté par l'appelant. */
function maListe(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;
	// Privée : la liste d'un membre ne regarde que lui, et l'afficher
	// publiquement remplirait le salon d'inventaires personnels.
	return { embeds: [], prive: true, v2: ecranMaListe(acces.service.maListe(acces.membre)) };
}

/** Reprend là où l'appelant s'est arrêté, lecteur compris. */
function reprendre(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;

	const reprise = acces.service.reprise(acces.membre);
	if (!reprise) {
		return vide(
			"Rien à reprendre",
			"Tu n'as rien commencé — ou tu as tout vu. `/episodes accueil` pour parcourir les arcs, " +
				"`/episodes hasard` pour te laisser porter.",
			contexte.marque
		);
	}

	const vue = acces.service.lecture(acces.membre, {
		saison: reprise.saison,
		episode: reprise.episode,
	});
	return vue
		? ecranLecture(vue)
		: vide("Épisode indisponible", "Cet épisode a quitté le catalogue.", contexte.marque);
}

/** Un épisode au hasard, de préférence pas encore vu. */
function hasard(contexte: ContexteCommande): Reponse {
	const acces = exigerService(contexte);
	if ("embeds" in acces) return acces;

	const cle = acces.service.hasard(acces.membre);
	if (!cle) {
		return vide(
			"Catalogue vide",
			"Aucun épisode en base. Le premier rafraîchissement n'a pas encore tourné.",
			contexte.marque
		);
	}

	const vue = acces.service.lecture(acces.membre, cle);
	return vue
		? ecranLecture(vue)
		: vide("Épisode indisponible", "Cet épisode a quitté le catalogue.", contexte.marque);
}

function catalogue(contexte: ContexteCommande): Reponse {
	const resume = contexte.catalogue.resume();

	if (resume.stats.episodes === 0) {
		return vide(
			"Catalogue vide",
			"Aucun épisode en base. Le premier rafraîchissement n'a pas encore tourné — " +
				"`/episodes rafraichir` le déclenche tout de suite.",
			contexte.marque
		);
	}

	const f = fiche({ titre: `${ICONES.catalogue} Catalogue IETV`, marque: contexte.marque })
		.champ("Épisodes", String(resume.stats.episodes), { enLigne: true })
		.champ("Saisons", String(resume.stats.seasons), { enLigne: true })
		.champ("Sources", String(resume.stats.channels), { enLigne: true })
		.champ("Versions", repartitionLangues(resume.stats.byLanguage))
		.champ(
			`${ICONES.horloge} Dernier rafraîchissement`,
			horodatageRelatif(resume.dernierRafraichissement)
		);

	const sources = resume.sources
		.slice(0, 10)
		.map((source) => `• **${source.titre ?? source.nom}** — ${source.episodes} épisode(s)`)
		.join("\n");
	if (sources !== "") f.champ("Détail des sources", sources);

	return { embeds: [f.finir()] };
}

async function rafraichir(contexte: ContexteCommande): Promise<Reponse> {
	if (!contexte.estStaff) {
		return echec(
			"Réservé au staff",
			"Le rafraîchissement rescrape toutes les sources : il est réservé aux administrateurs " +
				"du serveur et aux rôles déclarés dans `WONDERBOT_STAFF_ROLE_IDS`. Le catalogue se " +
				"met à jour tout seul, régulièrement.",
			contexte.marque
		);
	}

	try {
		const resultat = await contexte.catalogue.rafraichir();
		const secondes = (resultat.dureeMs / 1000).toFixed(1);
		const details = [
			`${resultat.stats.episodes} épisode(s) sur ${resultat.sources} source(s), en ${secondes} s.`,
			resultat.nouveaux.length > 0
				? `${ICONES.nouveau} ${resultat.nouveaux.length} nouveauté(s) depuis le dernier passage.`
				: "Aucune nouveauté depuis le dernier passage.",
		].join("\n");
		return succes("Catalogue rafraîchi", details, contexte.marque);
	} catch (err) {
		return echec(
			"Rafraîchissement échoué",
			`${err instanceof Error ? err.message : String(err)}\n\n` +
				"Le catalogue précédent est conservé : les autres commandes répondent toujours.",
			contexte.marque
		);
	}
}
