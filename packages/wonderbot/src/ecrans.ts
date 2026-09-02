/**
 * Les écrans du service de lecture — accueil, arc, ma liste, lecteur.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Chaque fonction prend une VUE — un objet littéral décrivant ce qu'il y a à
 * afficher — et rend le JSON d'un message. Aucun accès au catalogue, à la
 * progression ni à discord.js : c'est `bot.ts` qui remplit la vue et pose le
 * message. Toute la mise en page se teste donc avec des objets, sans jeton,
 * sans base et sans réseau.
 *
 * ── DEUX FAMILLES D'ÉCRANS, ET C'EST UNE CONTRAINTE, PAS UN CHOIX ──────────
 * Les écrans de NAVIGATION (accueil, arc, ma liste) sont en composants V2 :
 * conteneurs, sections avec vignette, galeries d'images, séparateurs. Le
 * LECTEUR, lui, reste en V1 — parce que le lecteur vidéo intégré de Discord ne
 * se déclenche que sur une URL nue posée dans `content`, et qu'un message V2
 * n'a pas le droit d'avoir de `content`. Voir `ui/v2.ts`.
 */

import type { LanguageVersion } from "@aphrody/ietv";

import { route } from "./routes.ts";
import { avancement, barre } from "./progression.ts";
import {
	COULEURS,
	ICONES,
	dateLisible,
	echapperMarkdown,
	fiche,
	horodatageRelatif,
	libelleLangue,
	listerSaison,
	repartitionLangues,
	type Marque,
	type Reponse,
} from "./ui/index.ts";
import {
	STYLE_BOUTON,
	bouton,
	boutonLien,
	conteneur,
	ecran,
	galerie,
	rangee,
	rangeeSelect,
	section,
	separateur,
	texte,
	vignette,
	type ComposantV2,
	type MessageV2,
} from "./ui/v2.ts";

/** Épisodes affichés par page d'arc — le plafond d'un menu déroulant Discord. */
export const PAR_PAGE = 25;

/** Un arc du catalogue, vu par un membre donné. */
export interface VueArcResume {
	saison: number;
	nom: string;
	total: number;
	vus: number;
}

/** L'épisode que le membre est en train de suivre. */
export interface VueReprise {
	saison: number;
	nomArc: string;
	episode: number;
	titre: string;
	vignette: string | null;
	/** Épisodes vus et disponibles dans l'arc — pour la barre. */
	vus: number;
	total: number;
	/**
	 * Le membre a-t-il déjà regardé quelque chose ?
	 *
	 * « Reprendre » à quelqu'un qui n'a jamais rien vu est un contresens : il
	 * n'y a rien à reprendre, il y a tout à commencer. Le mot change, l'épisode
	 * proposé reste le même — le premier non vu.
	 */
	commence: boolean;
}

export interface VueAccueil {
	stats: { episodes: number; sources: number; parLangue: Readonly<Record<string, number>> };
	arcs: readonly VueArcResume[];
	reprise: VueReprise | null;
	/** Nombre d'entrées dans « Ma liste ». */
	tailleListe: number;
	/** Dernier rafraîchissement, en millisecondes epoch. */
	rafraichiLe: number;
	marque: Marque;
}

/**
 * L'écran d'accueil — ce qu'un service de lecture montre en premier.
 *
 * L'ordre n'est pas décoratif : « Reprendre » vient AVANT le catalogue, parce
 * que dans neuf cas sur dix c'est ce qu'on est venu faire. Un membre qui n'a
 * rien commencé ne voit pas un bloc vide, il voit une invitation à commencer.
 */
export function ecranAccueil(vue: VueAccueil): MessageV2 {
	const blocs: (ComposantV2 | null)[] = [];

	blocs.push(
		texte(
			`# ${ICONES.catalogue} ${vue.marque.nom}\n` +
				`-# ${vue.stats.episodes} épisodes · ${vue.arcs.length} arcs · ${vue.stats.sources} sources · ` +
				repartitionLangues(vue.stats.parLangue)
		)
	);
	blocs.push(separateur({ trait: false }));

	if (vue.reprise) {
		const pourcentage = avancement(vue.reprise.vus, vue.reprise.total);
		const verbe = vue.reprise.commence ? "Reprendre" : "Commencer";
		const lignes = [
			`### ${ICONES.episode} ${verbe}`,
			`**${vue.reprise.nomArc} — E${String(vue.reprise.episode).padStart(2, "0")}** · ` +
				echapperMarkdown(vue.reprise.titre),
			`-# ${barre(pourcentage)} ${pourcentage} % · ${vue.reprise.vus}/${vue.reprise.total} épisodes`,
		];
		blocs.push(
			vue.reprise.vignette
				? section(lignes, vignette(vue.reprise.vignette, vue.reprise.titre))
				: section(lignes, bouton({ id: route("reprendre"), libelle: verbe, emoji: "▶️", style: STYLE_BOUTON.primaire }))
		);
		blocs.push(
			rangee([
				bouton({
					id: route("lire", vue.reprise.saison, vue.reprise.episode),
					libelle: verbe,
					emoji: "▶️",
					style: STYLE_BOUTON.primaire,
				}),
				bouton({ id: route("arc", vue.reprise.saison, 0), libelle: vue.reprise.nomArc, emoji: "📚" }),
			])
		);
	} else {
		blocs.push(
			texte(
				`### ${ICONES.episode} Commencer\n` +
					"Rien de commencé pour l'instant. Choisis un arc ci-dessous, ou lance la lecture au hasard."
			)
		);
	}

	blocs.push(separateur());
	blocs.push(texte(`### ${ICONES.saison} Parcourir`));

	// Cinq boutons par rangée, deux rangées : dix arcs affichés, ce qui couvre
	// le catalogue actuel. Au-delà, le menu déroulant plus bas prend le relais.
	const arcsBoutons = vue.arcs.slice(0, 10);
	for (let debut = 0; debut < arcsBoutons.length; debut += 5) {
		blocs.push(
			rangee(
				arcsBoutons.slice(debut, debut + 5).map((arc) =>
					bouton({
						id: route("arc", arc.saison, 0),
						libelle: arc.vus > 0 ? `${arc.nom} · ${arc.vus}/${arc.total}` : arc.nom,
						style: arc.vus >= arc.total && arc.total > 0 ? STYLE_BOUTON.succes : STYLE_BOUTON.secondaire,
					})
				)
			)
		);
	}

	blocs.push(separateur());
	blocs.push(
		rangee([
			bouton({ id: route("hasard"), libelle: "Au hasard", emoji: "🎲", style: STYLE_BOUTON.primaire }),
			bouton({
				id: route("maliste"),
				libelle: vue.tailleListe > 0 ? `Ma liste · ${vue.tailleListe}` : "Ma liste",
				emoji: "⭐",
			}),
			bouton({ id: route("accueil"), libelle: "Actualiser", emoji: "🔄" }),
		])
	);

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/** Un épisode dans la grille d'un arc. */
export interface VueEpisodeArc {
	numero: number;
	titre: string;
	langues: readonly LanguageVersion[];
	vignette: string | null;
	vu: boolean;
	dansListe: boolean;
}

export interface VueArc {
	saison: number;
	nom: string;
	episodes: readonly VueEpisodeArc[];
	/** Page affichée, à partir de 0. */
	page: number;
	/** Total d'épisodes de l'arc, toutes pages confondues. */
	total: number;
	/** Épisodes vus dans l'arc entier. */
	vus: number;
	/** Numéros confirmés introuvables, affichés tels quels. */
	introuvables: readonly number[];
	marque: Marque;
}

/**
 * La grille d'un arc — la « page de saison » d'un service de lecture.
 *
 * Une galerie de jaquettes en tête, la liste dessous, un menu pour lancer la
 * lecture, et la pagination. La pastille ✓ marque ce qui est déjà vu : c'est
 * elle qui transforme une liste en progression.
 */
export function ecranArc(vue: VueArc): MessageV2 {
	const pages = Math.max(1, Math.ceil(vue.total / PAR_PAGE));
	const page = Math.min(Math.max(0, vue.page), pages - 1);
	const pourcentage = avancement(vue.vus, vue.total);

	const blocs: (ComposantV2 | null)[] = [];

	blocs.push(
		texte(
			`# ${ICONES.saison} ${vue.nom}\n` +
				`-# ${vue.total} épisodes · ${barre(pourcentage)} ${pourcentage} % · ${vue.vus} vus` +
				(pages > 1 ? ` · page ${page + 1}/${pages}` : "")
		)
	);

	// Une rangée de jaquettes, comme la bande-annonce d'une saison. Cinq images
	// suffisent : dix noient la liste qui suit, qui est l'essentiel de l'écran.
	blocs.push(
		galerie(
			vue.episodes
				.filter((episode) => episode.vignette !== null)
				.slice(0, 5)
				.map((episode) => ({
					url: episode.vignette,
					description: `E${String(episode.numero).padStart(2, "0")} — ${episode.titre}`,
				}))
		)
	);

	blocs.push(separateur());

	if (vue.episodes.length === 0) {
		blocs.push(texte("*Aucun épisode référencé sur cette page.*"));
	} else {
		blocs.push(
			texte(
				vue.episodes
					.map((episode) => {
						const marques = [
							episode.vu ? "✓" : "◦",
							`**E${String(episode.numero).padStart(2, "0")}**`,
							echapperMarkdown(episode.titre),
						];
						const langues = episode.langues.map((langue) => libelleLangue(langue)).join(" ");
						const etoile = episode.dansListe ? " ⭐" : "";
						return `${marques.join(" ")} · ${langues}${etoile}`;
					})
					.join("\n")
			)
		);
	}

	if (vue.introuvables.length > 0) {
		blocs.push(
			texte(
				`-# ${ICONES.attention} Introuvables : ` +
					vue.introuvables.map((numero) => `E${String(numero).padStart(2, "0")}`).join(", ")
			)
		);
	}

	blocs.push(separateur());

	blocs.push(
		rangeeSelect({
			id: route("choix", vue.saison),
			invite: "Choisis un épisode à regarder",
			choix: vue.episodes.map((episode) => ({
				label: `E${String(episode.numero).padStart(2, "0")} · ${episode.titre}`,
				value: String(episode.numero),
				description: episode.vu ? "déjà vu" : undefined,
				emoji: { name: episode.vu ? "✅" : "▶️" },
			})),
		})
	);

	const navigation = [
		bouton({
			id: route("arc", vue.saison, Math.max(0, page - 1)),
			emoji: "◀️",
			desactive: page === 0,
		}),
		bouton({
			id: route("arc", vue.saison, Math.min(pages - 1, page + 1)),
			emoji: "▶️",
			desactive: page >= pages - 1,
		}),
		bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" }),
		bouton({ id: route("hasard"), emoji: "🎲" }),
	];
	blocs.push(rangee(navigation));

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/** Une entrée de « Ma liste », telle qu'affichée. */
export interface VueEntreeListe {
	saison: number;
	nomArc: string;
	episode: number;
	titre: string;
	vignette: string | null;
	vu: boolean;
	/** Vrai quand l'épisode a disparu du catalogue depuis son ajout. */
	absent: boolean;
}

export interface VueMaListe {
	entrees: readonly VueEntreeListe[];
	marque: Marque;
}

/**
 * « Ma liste » — ce que le membre a mis de côté.
 *
 * Une entrée dont l'épisode a quitté le catalogue est AFFICHÉE quand même,
 * grisée : la supprimer en silence ferait disparaître un choix délibéré du
 * membre à cause d'un scraping raté d'en face.
 */
export function ecranMaListe(vue: VueMaListe): MessageV2 {
	const blocs: (ComposantV2 | null)[] = [texte(`# ⭐ Ma liste`)];

	if (vue.entrees.length === 0) {
		blocs.push(
			texte(
				"Ta liste est vide.\n" +
					"-# Le bouton ⭐ d'un épisode l'ajoute ici, pour le retrouver plus tard."
			)
		);
		blocs.push(rangee([bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" })]));
		return ecran([conteneur(blocs, vue.marque.couleur)]);
	}

	// Cinq sections au plus : chacune coûte quatre composants, et le message
	// entier en accepte quarante. Le reste est listé en texte compact dessous.
	for (const entree of vue.entrees.slice(0, 5)) {
		const lignes = [
			`**${entree.nomArc} — E${String(entree.episode).padStart(2, "0")}**`,
			echapperMarkdown(entree.titre),
			entree.absent
				? `-# ${ICONES.attention} absent du catalogue pour l'instant`
				: `-# ${entree.vu ? "✓ déjà vu" : "◦ pas encore vu"}`,
		];
		blocs.push(
			entree.vignette
				? section(lignes, vignette(entree.vignette, entree.titre))
				: section(
						lignes,
						bouton({
							id: route("lire", entree.saison, entree.episode),
							libelle: "Regarder",
							emoji: "▶️",
							style: STYLE_BOUTON.primaire,
							desactive: entree.absent,
						})
					)
		);
	}

	const reste = vue.entrees.slice(5);
	if (reste.length > 0) {
		blocs.push(
			texte(
				reste
					.map(
						(entree) =>
							`${entree.vu ? "✓" : "◦"} **${entree.nomArc} E${String(entree.episode).padStart(2, "0")}** · ` +
							echapperMarkdown(entree.titre)
					)
					.join("\n")
			)
		);
	}

	blocs.push(separateur());
	blocs.push(
		rangeeSelect({
			id: route("choix", 0),
			invite: "Regarder un épisode de ma liste",
			choix: vue.entrees
				.filter((entree) => !entree.absent)
				.map((entree) => ({
					label: `${entree.nomArc} E${String(entree.episode).padStart(2, "0")} · ${entree.titre}`,
					value: `${entree.saison}:${entree.episode}`,
					emoji: { name: entree.vu ? "✅" : "▶️" },
				})),
		})
	);
	blocs.push(rangee([bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" })]));

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/** Une version jouable d'un épisode. */
export interface VueVersion {
	langue: LanguageVersion;
	source: string | null;
	url: string;
	/** Vrai si Discord sait en faire un lecteur intégré. */
	jouable: boolean;
}

export interface VueLecture {
	saison: number;
	nomArc: string;
	episode: number;
	titre: string;
	titreOriginal: string | null;
	resume: string | null;
	vignette: string | null;
	diffuseLe: string | null;
	versions: readonly VueVersion[];
	vu: boolean;
	dansListe: boolean;
	precedent: number | null;
	suivant: number | null;
	marque: Marque;
}

/**
 * Le lecteur — le seul écran qui reste en V1, et pour une seule raison.
 *
 * ── L'URL NUE EST LE LECTEUR ───────────────────────────────────────────────
 * Discord n'intègre un lecteur vidéo que pour une URL de plateforme connue,
 * posée SEULE dans le contenu du message. Un lien Markdown dans une description
 * n'en produit aucun, et un message en composants V2 n'a pas le droit d'avoir
 * de contenu. Cet écran renonce donc à la mise en page riche pour garder ce qui
 * compte ici : la vidéo qui se joue dans Discord, sans quitter le serveur.
 *
 * Les boutons, eux, fonctionnent dans les deux mondes : « suivant » réécrit ce
 * même message avec l'épisode d'après. C'est ce qui fait l'enchaînement.
 */
export function ecranLecture(vue: VueLecture): Reponse {
	const f = fiche({
		titre: `${ICONES.episode} ${vue.nomArc} — E${String(vue.episode).padStart(2, "0")}`,
		intention: "marque",
		marque: vue.marque,
	}).description(
		[`## ${echapperMarkdown(vue.titre)}`, vue.resume ? echapperMarkdown(vue.resume) : null]
			.filter((part): part is string => part !== null)
			.join("\n\n")
	);

	f.miniature(vue.vignette);
	if (vue.titreOriginal) f.champ("Titre original", vue.titreOriginal, { enLigne: true });
	if (vue.diffuseLe) f.champ("Première diffusion", dateLisible(vue.diffuseLe), { enLigne: true });

	for (const version of vue.versions) {
		f.champ(
			`${libelleLangue(version.langue)}${version.source ? ` · ${version.source}` : ""}`,
			`[Ouvrir](${version.url})`,
			{ enLigne: true }
		);
	}

	// La première version que Discord sait jouer. Une page de site ne rend
	// qu'une carte : seule une URL de plateforme vidéo produit un lecteur.
	const jouable = vue.versions.find((version) => version.jouable);

	const navigation = rangee([
		bouton({
			id: route("lire", vue.saison, vue.precedent ?? vue.episode),
			emoji: "⏮️",
			desactive: vue.precedent === null,
		}),
		bouton({
			id: route("vu", vue.saison, vue.episode),
			libelle: vue.vu ? "Vu" : "Marquer vu",
			emoji: vue.vu ? "✅" : "☑️",
			style: vue.vu ? STYLE_BOUTON.succes : STYLE_BOUTON.secondaire,
		}),
		bouton({
			id: route("lire", vue.saison, vue.suivant ?? vue.episode),
			libelle: "Suivant",
			emoji: "⏭️",
			style: STYLE_BOUTON.primaire,
			desactive: vue.suivant === null,
		}),
		bouton({
			id: route("liste", vue.saison, vue.episode),
			emoji: "⭐",
			style: vue.dansListe ? STYLE_BOUTON.succes : STYLE_BOUTON.secondaire,
		}),
		bouton({ id: route("arc", vue.saison, Math.floor((vue.episode - 1) / PAR_PAGE)), emoji: "📚" }),
	]);

	const secondaire = rangee([
		bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" }),
		bouton({ id: route("hasard"), emoji: "🎲" }),
		// La bande son dans le salon vocal, pour écouter à plusieurs. L'image,
		// elle, reste ici : Discord n'offre aucune API vidéo à un bot.
		bouton({ id: route("vocal", vue.saison, vue.episode), libelle: "En vocal", emoji: "🔊" }),
		...(jouable ? [boutonLien(jouable.url, "Ouvrir ailleurs", "🔗")] : []),
	]);

	return {
		embeds: [f.finir(`${vue.versions.length} version(s)`)],
		...(jouable ? { contenu: jouable.url } : {}),
		composants: [navigation, secondaire],
	};
}

export interface VueProgression {
	arcs: readonly VueArcResume[];
	/** Épisodes vus, toutes saisons confondues. */
	vus: number;
	/** Épisodes disponibles, toutes saisons confondues. */
	total: number;
	/** Les derniers épisodes regardés, du plus récent au plus ancien. */
	recents: readonly { saison: number; nomArc: string; episode: number; titre: string }[];
	marque: Marque;
}

/**
 * L'avancement du membre, arc par arc.
 *
 * Un service de lecture qui ne sait pas dire « il te reste dix-sept épisodes »
 * laisse son catalogue en vrac. Les arcs entamés viennent d'abord : ce sont
 * ceux sur lesquels on peut agir tout de suite.
 */
export function ecranProgression(vue: VueProgression): MessageV2 {
	const global = avancement(vue.vus, vue.total);
	const blocs: (ComposantV2 | null)[] = [
		texte(
			`# 📈 Ta progression\n` +
				`${barre(global, 20)} **${global} %**\n` +
				`-# ${vue.vus} épisodes vus sur ${vue.total}`
		),
		separateur(),
	];

	// Entamés d'abord, puis les plus fournis : un arc jamais commencé n'a rien
	// à dire, un arc à 40/47 attend une action.
	const classes = [...vue.arcs].sort((a, b) => {
		const entameA = a.vus > 0 && a.vus < a.total ? 0 : 1;
		const entameB = b.vus > 0 && b.vus < b.total ? 0 : 1;
		if (entameA !== entameB) return entameA - entameB;
		return b.vus - a.vus;
	});

	blocs.push(
		texte(
			classes
				.map((arc) => {
					const pourcentage = avancement(arc.vus, arc.total);
					const etat = arc.total > 0 && arc.vus >= arc.total ? "✅" : arc.vus > 0 ? "▶️" : "◦";
					return `${etat} **${arc.nom}** · ${barre(pourcentage, 10)} ${arc.vus}/${arc.total}`;
				})
				.join("\n")
		)
	);

	if (vue.recents.length > 0) {
		blocs.push(separateur());
		blocs.push(
			texte(
				`### 🕒 Derniers vus\n` +
					vue.recents
						.map(
							(recent) =>
								`**${recent.nomArc} E${String(recent.episode).padStart(2, "0")}** · ` +
								echapperMarkdown(recent.titre)
						)
						.join("\n")
			)
		);
	}

	blocs.push(separateur());
	blocs.push(
		rangee([
			bouton({ id: route("reprendre"), libelle: "Reprendre", emoji: "▶️", style: STYLE_BOUTON.primaire }),
			bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" }),
			bouton({ id: route("maliste"), libelle: "Ma liste", emoji: "⭐" }),
		])
	);

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/**
 * L'aide — ce que le bot sait faire.
 *
 * Elle est écrite du point de vue de CE QU'ON VEUT FAIRE, pas de la liste des
 * commandes : « regarder », « retrouver », « suivre ». Une énumération de
 * sous-commandes n'apprend rien à qui ne sait pas encore ce que le bot propose.
 */
export function ecranAide(marque: Marque): MessageV2 {
	return ecran([
		conteneur(
			[
				texte(
					`# ${ICONES.catalogue} ${marque.nom}\n` +
						"Le catalogue d'épisodes du serveur, avec son lecteur — sans quitter Discord."
				),
				separateur(),
				texte(
					"### ▶️ Regarder\n" +
						"`/episodes accueil` — l'écran principal : reprendre, parcourir, ta liste.\n" +
						"`/episodes arc numero:` — la grille d'un arc, avec ce que tu as déjà vu.\n" +
						"`/episodes suivant` — enchaîner après ton dernier épisode.\n" +
						"`/episodes hasard` — un épisode au hasard, de préférence pas encore vu."
				),
				texte(
					"### 🔎 Retrouver\n" +
						"`/episodes recherche texte:` — les propositions arrivent pendant la frappe ; " +
						"en choisir une ouvre directement le lecteur.\n" +
						"`/episodes episode saison: numero:` — toutes les versions d'un épisode précis."
				),
				texte(
					"### 📈 Suivre\n" +
						"`/episodes progression` — ton avancement, arc par arc.\n" +
						"`/episodes maliste` — ce que tu as mis de côté avec le bouton ⭐.\n" +
						"-# Ces écrans-là ne sont visibles que par toi."
				),
				separateur(),
				texte(
					"-# Le catalogue se met à jour tout seul. Les nouveautés sont annoncées, " +
						"et le forum tient un fil par arc."
				),
				rangee([
					bouton({ id: route("accueil"), libelle: "Ouvrir l'accueil", emoji: "🏠", style: STYLE_BOUTON.primaire }),
					bouton({ id: route("hasard"), libelle: "Au hasard", emoji: "🎲" }),
				]),
			],
			marque.couleur
		),
	]);
}

export interface VueFilArc {
	saison: number;
	nom: string;
	/** TOUS les épisodes de l'arc, pas une page. */
	episodes: readonly VueEpisodeArc[];
	langues: Readonly<Record<string, number>>;
	introuvables: readonly number[];
	/** Millisecondes epoch du dernier rafraîchissement, 0 si jamais. */
	rafraichiLe: number;
	marque: Marque;
}

/** Budget de texte d'un message en composants V2, réserve d'en-tête déduite. */
const BUDGET_FIL = 3400;

/**
 * Le message d'ouverture d'un fil de forum — public, donc SANS état personnel.
 *
 * ── UN FIL EST PARTAGÉ, PAS PERSONNEL ──────────────────────────────────────
 * `ecranArc` affiche les pastilles de visionnage de CELUI qui l'ouvre : c'est
 * juste pour un écran éphémère, et faux pour un fil que tout le serveur lit.
 * Aucun ✓ ici, aucune barre d'avancement : le fil décrit le CATALOGUE, et les
 * boutons renvoient chacun vers son propre écran privé.
 *
 * ── LE BUDGET N'EST PAS CELUI DES EMBEDS ───────────────────────────────────
 * Un message V2 plafonne à 4 000 caractères là où un message à embeds en
 * accepte 6 000. La liste est donc bâtie avec un budget explicite, et
 * `listerSaison` resserre les titres plutôt que d'écarter des épisodes — une
 * liste de saison amputée serait un mensonge sur le catalogue.
 */
export function ecranFilArc(vue: VueFilArc): MessageV2 {
	const total = vue.episodes.length;
	const blocs: (ComposantV2 | null)[] = [];

	blocs.push(
		texte(
			`# ${ICONES.saison} ${vue.nom}\n` +
				`-# ${total} épisode(s) · ${repartitionLangues(vue.langues)}` +
				(vue.rafraichiLe > 0 ? ` · mis à jour ${horodatageRelatif(vue.rafraichiLe)}` : "")
		)
	);

	// La galerie de vignettes : ce qu'un message à embeds ne sait pas faire —
	// un embed ne porte qu'UNE image. C'est elle qui donne au fil l'allure
	// d'une page de catalogue plutôt que d'une liste.
	blocs.push(
		galerie(
			vue.episodes
				.filter((episode) => episode.vignette !== null)
				.slice(0, 10)
				.map((episode) => ({
					url: episode.vignette,
					description: `E${String(episode.numero).padStart(2, "0")} — ${episode.titre}`,
				}))
		)
	);

	blocs.push(separateur());

	// `listerSaison` groupe par NUMÉRO et rend une ligne par épisode portant
	// toutes ses langues : on lui repasse donc UNE entrée par langue, sinon un
	// épisode disponible en VF et en VOSTFR n'en afficherait qu'une.
	const liste = listerSaison(
		vue.episodes.flatMap((episode) =>
			(episode.langues.length > 0 ? episode.langues : (["unknown"] as const)).map((langue) => ({
				...VERSION_MINIMALE,
				season: vue.saison,
				episode: episode.numero,
				title: episode.titre,
				language: langue,
			}))
		),
		{ budgetPage: BUDGET_FIL, budgetTotal: BUDGET_FIL }
	);

	for (const page of liste.pages.length > 0 ? liste.pages : ["*Aucun épisode référencé.*"]) {
		blocs.push(texte(page));
	}

	if (vue.introuvables.length > 0) {
		blocs.push(
			texte(
				`-# ${ICONES.attention} Introuvables : ` +
					vue.introuvables.map((numero) => `E${String(numero).padStart(2, "0")}`).join(", ") +
					" — cherchés puis abandonnés, l'information vaut mieux que le silence."
			)
		);
	}

	blocs.push(separateur());

	blocs.push(
		rangeeSelect({
			id: route("choix", vue.saison),
			invite: "Choisis un épisode à regarder",
			choix: vue.episodes.slice(0, 25).map((episode) => ({
				label: `E${String(episode.numero).padStart(2, "0")} · ${episode.titre}`,
				value: String(episode.numero),
				emoji: { name: "▶️" },
			})),
		})
	);

	blocs.push(
		rangee([
			bouton({
				id: route("arc", vue.saison, 0),
				libelle: "Ouvrir l'arc",
				emoji: "📚",
				style: STYLE_BOUTON.primaire,
			}),
			bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠" }),
			bouton({ id: route("hasard"), emoji: "🎲" }),
		])
	);

	blocs.push(
		texte(
			"-# Les boutons répondent en privé : ton avancement ne s'affiche que pour toi. " +
				"Le fil, lui, reste ouvert à la discussion."
		)
	);

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/** Champs qu'un épisode de catalogue porte et dont le fil n'a que faire. */
const VERSION_MINIMALE = {
	videoId: "",
	url: "",
	description: null,
	thumbnail: null,
	publishDate: null,
	titleJp: null,
	romaji: null,
	duration: null,
	viewCount: null,
} as const;

export interface VueEcoute {
	/** `"arrete"` | `"lecture"` | `"pause"`. */
	etat: "arrete" | "lecture" | "pause";
	courante: { saison: number; episode: number; titre: string; nomArc: string } | null;
	file: readonly { saison: number; episode: number; titre: string; nomArc: string }[];
	/** Salon vocal où le bot se trouve, `null` s'il n'y est pas. */
	salonId: string | null;
	/** Message d'avertissement — source introuvable, par exemple. */
	avertissement?: string | null;
	marque: Marque;
}

/**
 * L'écoute en vocal : ce qui passe, ce qui suit, et les commandes.
 *
 * ── ON DIT CE QUE LE VOCAL EST, ET CE QU'IL N'EST PAS ──────────────────────
 * Un membre qui lance « écouter en vocal » s'attend souvent à voir l'épisode
 * dans le salon. Discord ne le permet pas — un bot n'a aucune API pour
 * diffuser de la vidéo. L'écran l'écrit noir sur blanc plutôt que de laisser
 * croire à une panne.
 */
export function ecranEcoute(vue: VueEcoute): MessageV2 {
	const blocs: (ComposantV2 | null)[] = [];

	const etatLisible =
		vue.etat === "lecture" ? "▶️ en lecture" : vue.etat === "pause" ? "⏸️ en pause" : "⏹️ arrêté";

	blocs.push(
		texte(
			`# 🔊 Écoute en vocal\n` +
				(vue.salonId ? `-# ${etatLisible} · salon <#${vue.salonId}>` : `-# ${etatLisible}`)
		)
	);

	if (vue.courante) {
		blocs.push(
			texte(
				`### ${vue.courante.nomArc} — E${String(vue.courante.episode).padStart(2, "0")}\n` +
					echapperMarkdown(vue.courante.titre)
			)
		);
	} else {
		blocs.push(texte("*Rien en lecture.*"));
	}

	if (vue.file.length > 0) {
		blocs.push(separateur());
		blocs.push(
			texte(
				`### 🎞️ À suivre · ${vue.file.length}\n` +
					vue.file
						.slice(0, 10)
						.map(
							(piste, rang) =>
								`\`${rang + 1}.\` **${piste.nomArc} E${String(piste.episode).padStart(2, "0")}** · ` +
								echapperMarkdown(piste.titre)
						)
						.join("\n") +
					(vue.file.length > 10 ? `\n-# …et ${vue.file.length - 10} de plus.` : "")
			)
		);
	}

	if (vue.avertissement) {
		blocs.push(texte(`-# ${ICONES.attention} ${vue.avertissement}`));
	}

	blocs.push(separateur());
	blocs.push(
		texte(
			"-# Le vocal porte la bande son. Discord n'offre aucune API permettant à un bot de " +
				"diffuser de la vidéo : l'image reste dans le lecteur du message."
		)
	);

	blocs.push(
		rangee([
			bouton({
				id: route("vpause"),
				libelle: vue.etat === "pause" ? "Reprendre" : "Pause",
				emoji: vue.etat === "pause" ? "▶️" : "⏸️",
				style: STYLE_BOUTON.primaire,
				desactive: vue.etat === "arrete",
			}),
			bouton({ id: route("vpasser"), libelle: "Suivante", emoji: "⏭️", desactive: vue.file.length === 0 }),
			bouton({
				id: route("vstop"),
				libelle: "Arrêter",
				emoji: "⏹️",
				style: STYLE_BOUTON.danger,
				desactive: vue.etat === "arrete" && vue.salonId === null,
			}),
			bouton({ id: route("accueil"), emoji: "🏠" }),
		])
	);

	return ecran([conteneur(blocs, vue.marque.couleur)]);
}

/** Écran d'erreur d'un bouton devenu invalide. */
export function ecranRouteInconnue(marque: Marque): MessageV2 {
	return ecran([
		conteneur(
			[
				texte(
					`### ${ICONES.attention} Ce bouton n'est plus valide\n` +
						"Il vient d'un message publié par une version antérieure du bot. " +
						"Relance `/episodes accueil` pour repartir d'un écran à jour."
				),
				rangee([bouton({ id: route("accueil"), libelle: "Accueil", emoji: "🏠", style: STYLE_BOUTON.primaire })]),
			],
			COULEURS.attention
		),
	]);
}
