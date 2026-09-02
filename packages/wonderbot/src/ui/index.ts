/** Point d'entrée unique de la charte visuelle. */

export {
	COULEURS,
	ICONES,
	LIMITES,
	MARQUE_PAR_DEFAUT,
	type Intention,
	type Marque,
} from "./theme.ts";

export {
	Fiche,
	echec,
	fiche,
	succes,
	tailleEmbed,
	vide,
	type Embed,
	type OptionsFiche,
	type Reponse,
} from "./embed.ts";

export {
	bornerTexte,
	codeEpisode,
	dateLisible,
	grouperParEpisode,
	echapperMarkdown,
	formaterDuree,
	horodatageRelatif,
	libelleLangue,
	ligneEpisode,
	ligneSaison,
	listerEpisodes,
	listerSaison,
	premiereVignette,
	repartitionLangues,
	meilleurTitre,
	titreCourt,
	titreOriginal,
	trierEpisodes,
	type EpisodeCatalogue,
} from "./format.ts";
