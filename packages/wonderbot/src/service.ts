/**
 * Le service de lecture — il croise le CATALOGUE (ce qui existe) et la
 * PROGRESSION (où en est ce membre) pour remplir les écrans.
 *
 * ── POURQUOI UNE COUCHE DE PLUS ────────────────────────────────────────────
 * `ecrans.ts` ne sait que mettre en page, `catalogue.ts` ne sait que lire la
 * base, `progression.ts` ne sait que ce qu'un membre a vu. Le raisonnement qui
 * les relie — « quel est le prochain épisode à proposer », « cet arc est-il
 * fini », « où reprendre quand la saison est terminée » — n'appartient à aucun
 * des trois. Il vit ici, et se teste avec un catalogue factice et une
 * progression en mémoire, sans jeton ni base.
 */

import { estLisibleEnLigne } from "./commands/ietv.ts";
import type { Catalogue } from "./catalogue.ts";
import {
	PAR_PAGE,
	type VueAccueil,
	type VueArc,
	type VueArcResume,
	type VueLecture,
	type VueMaListe,
	type VueReprise,
} from "./ecrans.ts";
import { Progression, prochainNonVu, voisins, type CleEpisode } from "./progression.ts";
import {
	grouperParEpisode,
	meilleurTitre,
	premiereVignette,
	titreCourt,
	titreOriginal,
	type EpisodeCatalogue,
	type Marque,
} from "./ui/index.ts";

export interface OptionsService {
	catalogue: Catalogue;
	progression: Progression;
	marque: Marque;
	/**
	 * Trous confirmés (`"3:7"`) — affichés dans la grille d'un arc.
	 *
	 * Une FONCTION, pas un ensemble : `Reparateur.confirmes()` reconstruit son
	 * `Set` à chaque appel depuis la persistance. Le capturer une fois à la
	 * construction figerait l'instantané vide du démarrage, et l'écran
	 * n'afficherait jamais un trou confirmé plus tard.
	 */
	lacunesConfirmees?: () => ReadonlySet<string>;
	/** Injectable pour rendre `hasard` déterministe en test. */
	tirage?: () => number;
}

/** Un arc et ses épisodes, groupés une fois pour toutes. */
interface ArcCharge {
	saison: number;
	nom: string;
	groupes: { numero: number | null; versions: EpisodeCatalogue[] }[];
	numeros: number[];
}

export class Service {
	private readonly options: Required<OptionsService>;

	constructor(options: OptionsService) {
		this.options = {
			tirage: Math.random,
			lacunesConfirmees: () => new Set<string>(),
			...options,
		};
	}

	/** Nom d'affichage d'un arc — celui de la source, sinon « Saison N ». */
	nomArc(saison: number): string {
		return this.options.catalogue.nomsDeSaisons().get(saison)?.trim() || `Saison ${saison}`;
	}

	/**
	 * Un arc chargé : ses épisodes groupés et ses numéros disponibles.
	 *
	 * Les épisodes sans numéro sont écartés des NUMÉROS — on ne sait pas les
	 * situer, donc ni les enchaîner ni les marquer vus — mais restent dans les
	 * groupes, pour rester visibles dans la grille.
	 */
	private chargerArc(saison: number): ArcCharge {
		const groupes = grouperParEpisode(this.options.catalogue.saison(saison, undefined, 10_000));
		return {
			saison,
			nom: this.nomArc(saison),
			groupes,
			numeros: groupes
				.map((groupe) => groupe.numero)
				.filter((numero): numero is number => numero !== null),
		};
	}

	/** Résumé de chaque arc pour l'accueil, avec l'avancement du membre. */
	arcs(membre: string): VueArcResume[] {
		const comptes = this.options.progression.comptesParSaison(membre);
		const noms = this.options.catalogue.nomsDeSaisons();
		return this.options.catalogue.saisonsDisponibles().map((saison) => {
			const numeros = new Set(
				this.options.catalogue
					.saison(saison, undefined, 10_000)
					.map((episode) => episode.episode)
					.filter((numero): numero is number => numero !== null)
			);
			return {
				saison,
				nom: noms.get(saison)?.trim() || `Saison ${saison}`,
				total: numeros.size,
				// Borné au total : un membre peut avoir vu un épisode qu'une source
				// a depuis dépublié, et un « 48/47 » serait absurde.
				vus: Math.min(comptes.get(saison) ?? 0, numeros.size),
			};
		});
	}

	/**
	 * Où reprendre.
	 *
	 * ── ON REPREND DANS L'ARC EN COURS, PUIS ON PASSE AU SUIVANT ───────────
	 * Le point de départ est le dernier épisode regardé : c'est là qu'est
	 * l'attention du membre. Dans cet arc, on propose le plus petit épisode non
	 * vu — pas « le dernier + 1 », qui sauterait un trou (cf.
	 * {@link prochainNonVu}). Quand l'arc est fini, on enchaîne sur le premier
	 * arc suivant qui a encore quelque chose à voir : c'est ce qui fait qu'on
	 * ne retombe jamais sur un écran « rien à reprendre » après avoir terminé
	 * une saison.
	 *
	 * Rend `null` seulement quand le membre n'a RIEN commencé, ou a tout vu.
	 */
	reprise(membre: string): VueReprise | null {
		const dernier = this.options.progression.dernierVu(membre);
		const saisons = this.options.catalogue.saisonsDisponibles();
		if (saisons.length === 0) return null;

		// L'arc du dernier visionnage d'abord, puis les suivants dans l'ordre,
		// puis les précédents — un membre qui a fini GO se voit proposer Chrono
		// Stones, pas la saison 1.
		const depart = dernier ? saisons.indexOf(dernier.saison) : -1;
		const ordre =
			depart === -1
				? saisons
				: [...saisons.slice(depart), ...saisons.slice(0, depart)];

		for (const saison of ordre) {
			const arc = this.chargerArc(saison);
			if (arc.numeros.length === 0) continue;
			const vus = this.options.progression.vusDeSaison(membre, saison);
			const prochain = prochainNonVu(arc.numeros, vus);
			if (prochain === null) continue;

			const groupe = arc.groupes.find((candidat) => candidat.numero === prochain);
			if (!groupe) continue;

			return {
				saison,
				nomArc: arc.nom,
				episode: prochain,
				titre: meilleurTitre(groupe.versions),
				vignette: premiereVignette(groupe.versions),
				vus: Math.min(vus.size, arc.numeros.length),
				total: arc.numeros.length,
				// Un membre sans historique se voit proposer le PREMIER épisode,
				// avec le mot juste : « Commencer », pas « Reprendre ».
				commence: dernier !== null,
			};
		}

		return null;
	}

	/**
	 * L'épisode qui SUIT strictement le dernier regardé.
	 *
	 * ── CE N'EST PAS `reprise()` ───────────────────────────────────────────
	 * `reprise()` propose le premier NON VU, qui peut être un épisode ancien
	 * laissé de côté. Celle-ci enchaîne après le dernier visionnage, même si
	 * des trous subsistent derrière — c'est le geste « je continue ma série »,
	 * distinct de « je rattrape ce qui me manque ».
	 *
	 * Quand l'arc est fini, elle passe au premier épisode de l'arc suivant.
	 * Rend `null` si le membre n'a rien regardé, ou s'il est au bout.
	 */
	apresDernierVu(membre: string): CleEpisode | null {
		const dernier = this.options.progression.dernierVu(membre);
		if (!dernier) return null;

		const suivantDansArc = voisins(this.chargerArc(dernier.saison).numeros, dernier.episode).suivant;
		if (suivantDansArc !== null) return { saison: dernier.saison, episode: suivantDansArc };

		const saisons = this.options.catalogue.saisonsDisponibles();
		const rang = saisons.indexOf(dernier.saison);
		for (const saison of saisons.slice(rang + 1)) {
			const numeros = this.chargerArc(saison).numeros;
			if (numeros.length > 0) return { saison, episode: numeros[0]! };
		}
		return null;
	}

	/** L'avancement du membre, arc par arc, plus ses derniers visionnages. */
	progressionGlobale(membre: string) {
		const arcs = this.arcs(membre);
		const noms = this.options.catalogue.nomsDeSaisons();
		return {
			arcs,
			vus: arcs.reduce((total, arc) => total + arc.vus, 0),
			total: arcs.reduce((total, arc) => total + arc.total, 0),
			marque: this.options.marque,
			recents: this.options.progression.derniersVus(membre, 5).map((visionnage) => {
				const versions = this.options.catalogue.episode(visionnage.saison, visionnage.episode);
				return {
					saison: visionnage.saison,
					nomArc: noms.get(visionnage.saison)?.trim() || `Saison ${visionnage.saison}`,
					episode: visionnage.episode,
					titre: versions.length > 0 ? meilleurTitre(versions) : `Épisode ${visionnage.episode}`,
				};
			}),
		};
	}

	/**
	 * Propositions d'arcs pour l'autocomplétion.
	 *
	 * Le membre tape « chrono » et choisit « Chrono Stones » : il n'a jamais à
	 * savoir que cet arc porte le numéro 5. La valeur envoyée reste le numéro,
	 * puisque c'est lui qui indexe le catalogue.
	 */
	autocompleterArcs(texte: string, membre?: string): { nom: string; valeur: number }[] {
		const requete = texte.trim().toLowerCase();
		const avancements = membre ? new Map(this.arcs(membre).map((arc) => [arc.saison, arc])) : null;

		return this.options.catalogue
			.saisonsDisponibles()
			.map((saison) => ({ saison, nom: this.nomArc(saison) }))
			.filter(
				(arc) =>
					requete === "" ||
					arc.nom.toLowerCase().includes(requete) ||
					String(arc.saison) === requete
			)
			.slice(0, 25)
			.map((arc) => {
				const etat = avancements?.get(arc.saison);
				const nom = etat ? `${arc.nom} · ${etat.vus}/${etat.total}` : arc.nom;
				return { nom: nom.length > 100 ? `${nom.slice(0, 99)}…` : nom, valeur: arc.saison };
			});
	}

	accueil(membre: string): VueAccueil {
		const resume = this.options.catalogue.resume();
		return {
			stats: {
				episodes: resume.stats.episodes,
				sources: resume.stats.channels,
				parLangue: resume.stats.byLanguage,
			},
			arcs: this.arcs(membre),
			reprise: this.reprise(membre),
			tailleListe: this.options.progression.liste(membre, 100).length,
			rafraichiLe: resume.dernierRafraichissement,
			marque: this.options.marque,
		};
	}

	/** Numéros confirmés introuvables pour un arc, croissants. */
	private introuvablesDe(saison: number): number[] {
		const prefixe = `${saison}:`;
		return [...this.options.lacunesConfirmees()]
			.filter((cle) => cle.startsWith(prefixe))
			.map((cle) => Number(cle.slice(prefixe.length)))
			.filter((numero) => Number.isFinite(numero))
			.sort((a, b) => a - b);
	}

	arc(membre: string, saison: number, page: number): VueArc {
		const charge = this.chargerArc(saison);
		const vus = this.options.progression.vusDeSaison(membre, saison);
		const pages = Math.max(1, Math.ceil(charge.groupes.length / PAR_PAGE));
		const pageBornee = Math.min(Math.max(0, page), pages - 1);
		const tranche = charge.groupes.slice(pageBornee * PAR_PAGE, (pageBornee + 1) * PAR_PAGE);

		return {
			saison,
			nom: charge.nom,
			page: pageBornee,
			total: charge.groupes.length,
			vus: Math.min(vus.size, charge.numeros.length),
			introuvables: this.introuvablesDe(saison),
			marque: this.options.marque,
			episodes: tranche.map((groupe) => ({
				numero: groupe.numero ?? 0,
				titre: meilleurTitre(groupe.versions),
				langues: [...new Set(groupe.versions.map((version) => version.language))],
				vignette: premiereVignette(groupe.versions),
				vu: groupe.numero !== null && vus.has(groupe.numero),
				dansListe:
					groupe.numero !== null &&
					this.options.progression.estDansListe(membre, { saison, episode: groupe.numero }),
			})),
		};
	}

	maListe(membre: string): VueMaListe {
		const noms = this.options.catalogue.nomsDeSaisons();
		return {
			marque: this.options.marque,
			entrees: this.options.progression.liste(membre, 25).map((entree) => {
				const versions = this.options.catalogue.episode(entree.saison, entree.episode);
				return {
					saison: entree.saison,
					nomArc: noms.get(entree.saison)?.trim() || `Saison ${entree.saison}`,
					episode: entree.episode,
					titre: versions.length > 0 ? meilleurTitre(versions) : `Épisode ${entree.episode}`,
					vignette: premiereVignette(versions),
					vu: this.options.progression.vusDeSaison(membre, entree.saison).has(entree.episode),
					absent: versions.length === 0,
				};
			}),
		};
	}

	/**
	 * L'écran de lecture d'un épisode. `null` quand il n'existe pas au
	 * catalogue — l'appelant répond alors « introuvable » plutôt que d'afficher
	 * un lecteur vide.
	 */
	lecture(membre: string, cle: CleEpisode): VueLecture | null {
		const versions = this.options.catalogue.episode(cle.saison, cle.episode);
		if (versions.length === 0) return null;

		const arc = this.chargerArc(cle.saison);
		const encadrement = voisins(arc.numeros, cle.episode);
		const principal =
			versions.find((version) => version.description && version.description.trim() !== "") ??
			versions[0]!;

		return {
			saison: cle.saison,
			nomArc: arc.nom,
			episode: cle.episode,
			titre: meilleurTitre(versions),
			titreOriginal: titreOriginal(principal),
			resume: principal.description,
			vignette: premiereVignette(versions),
			diffuseLe: principal.publishDate,
			vu: this.options.progression.vusDeSaison(membre, cle.saison).has(cle.episode),
			dansListe: this.options.progression.estDansListe(membre, cle),
			precedent: encadrement.precedent,
			suivant: encadrement.suivant,
			marque: this.options.marque,
			versions: versions.map((version) => ({
				langue: version.language,
				source: version.channel ?? null,
				url: version.url,
				jouable: estLisibleEnLigne(version.url),
			})),
		};
	}

	/**
	 * Un épisode au hasard, de préférence NON VU.
	 *
	 * Tirer dans tout le catalogue proposerait surtout du déjà-vu à qui a
	 * beaucoup regardé. On tire donc parmi les non-vus, et on ne retombe sur le
	 * catalogue entier que lorsqu'il n'en reste aucun.
	 */
	hasard(membre: string): CleEpisode | null {
		const tous: CleEpisode[] = [];
		const inedits: CleEpisode[] = [];

		for (const saison of this.options.catalogue.saisonsDisponibles()) {
			const vus = this.options.progression.vusDeSaison(membre, saison);
			for (const numero of this.chargerArc(saison).numeros) {
				const cle = { saison, episode: numero };
				tous.push(cle);
				if (!vus.has(numero)) inedits.push(cle);
			}
		}

		const bassin = inedits.length > 0 ? inedits : tous;
		if (bassin.length === 0) return null;
		return bassin[Math.floor(this.options.tirage() * bassin.length)] ?? bassin[0]!;
	}

	/**
	 * Propositions d'autocomplétion pour la recherche.
	 *
	 * Discord n'accepte que vingt-cinq choix et impose une réponse en moins de
	 * trois secondes : la requête est bornée en base, jamais filtrée après coup
	 * sur tout le catalogue.
	 */
	autocompleter(texte: string, limite = 25): { nom: string; valeur: string }[] {
		const requete = texte.trim();
		const episodes =
			requete === ""
				? this.options.catalogue.rechercher({ limite })
				: this.options.catalogue.rechercher({ texte: requete, limite: limite * 2 });

		const vus = new Set<string>();
		const choix: { nom: string; valeur: string }[] = [];

		for (const episode of episodes) {
			if (episode.season === null || episode.episode === null) continue;
			const cle = `${episode.season}:${episode.episode}`;
			if (vus.has(cle)) continue;
			vus.add(cle);

			const nom = `${this.nomArc(episode.season)} E${String(episode.episode).padStart(2, "0")} · ${titreCourt(episode.title)}`;
			choix.push({ nom: nom.length > 100 ? `${nom.slice(0, 99)}…` : nom, valeur: cle });
			if (choix.length >= limite) break;
		}

		return choix;
	}
}
