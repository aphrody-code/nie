/**
 * L'ARBRE DES COMMANDES — la seule source des noms, descriptions et localisations.
 *
 * ── POURQUOI UNE TABLE, ET PAS DES CHAÎNES DANS LES DÉCORATEURS ────────────
 * Discord impose des règles DURES sur cette surface, et il les fait respecter
 * au moment de l'enregistrement — c'est-à-dire au démarrage du service, en
 * production, par un `Invalid Form Body` qui ne dit pas quoi corriger :
 *
 *   - un nom doit valider `^[-_'\p{L}\p{N}]{1,32}$` en minuscules, sans espace ;
 *   - une description fait de 1 à 100 caractères ;
 *   - une commande porte AU PLUS 25 sous-commandes ;
 *   - la profondeur maximale est de 2 (commande → groupe → sous-commande) ;
 *   - une localisation obéit aux mêmes règles que la valeur qu'elle traduit.
 *
 * Écrites en dur dans soixante décorateurs, ces règles ne sont vérifiées par
 * personne avant Discord lui-même. Écrites ICI, elles sont vérifiées par
 * `arbre.test.ts`, hors ligne, sans jeton, en quelques millisecondes — et la
 * 26ᵉ sous-commande ajoutée dans six mois fait rougir la suite au lieu de
 * rendre le bot muet.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucun import, aucune E/S, aucun effet de bord. `commands/*.ts` en tire ses
 * décorateurs par `racine()` et `sous()`, si bien qu'un nom absent de cette
 * table lève À L'IMPORT du module de commande, avant toute connexion.
 *
 * ── ANGLAIS PAR DÉFAUT, FRANÇAIS EN LOCALISATION ───────────────────────────
 * Le bot est public et international : le nom canonique est anglais, et c'est
 * lui que voient un joueur japonais, brésilien ou allemand. Le français passe
 * par `nameLocalizations` / `descriptionLocalizations`, si bien qu'un membre
 * dont le client est en français lit `/personnage fiche` là où un autre lit
 * `/character profile` — la MÊME commande, le même identifiant côté API.
 *
 * Discord n'accepte qu'une seule locale française (`fr`), pas de variante
 * régionale : `fr-FR` et `fr-CA` seraient refusés.
 */

/** Locale française telle que Discord la nomme. Il n'en existe pas d'autre. */
export const LOCALE_FR = "fr" as const;

/** Une entrée traduite — le couple que Discord attend partout. */
export interface Traduit {
	/** Nom canonique, en anglais, conforme à la regex de Discord. */
	readonly nom: string;
	/** Description canonique, en anglais, de 1 à 100 caractères. */
	readonly description: string;
	/** Nom vu par un client en français. */
	readonly nomFr: string;
	/** Description vue par un client en français. */
	readonly descriptionFr: string;
}

/** Une sous-commande, et ce qu'elle remplace côté Rose Griffon. */
export interface SousCommande extends Traduit {
	/**
	 * La commande d'origine dans `apps/bot` du dépôt rg, telle qu'un membre la
	 * tapait. Sert la documentation et la table de bascule de `docs/BOT.md` —
	 * jamais le code.
	 */
	readonly remplace: string;
}

/** Une commande racine et ses sous-commandes. */
export interface Racine extends Traduit {
	readonly sous: Readonly<Record<string, SousCommande>>;
}

/**
 * Le plafond de Discord, cité une fois pour être vérifié partout.
 * Source : Application Commands — « Each command can have up to 25 options ».
 */
export const MAX_SOUS_COMMANDES = 25;

/** Longueur maximale d'une description de commande ou d'option. */
export const MAX_DESCRIPTION = 100;

/** Longueur maximale d'un nom de commande, d'option ou de choix. */
export const MAX_NOM = 32;

/**
 * Regex officielle des noms de commande.
 *
 * `u` est obligatoire : sans lui, `\p{L}` n'est pas une classe Unicode mais la
 * lettre `p` suivie d'accolades, et la regex accepterait n'importe quoi.
 */
export const REGEX_NOM = /^[-_'\p{L}\p{N}]{1,32}$/u;

/**
 * L'arbre.
 *
 * ── LE DÉCOUPAGE, ET POURQUOI CELUI-CI ─────────────────────────────────────
 * Le point de départ n'était pas tenable tel quel : `/azalee` portait 19
 * sous-commandes, `/cpk` 3, `/cdn` 4 et `/rag` 3, soit 29 entrées réparties
 * selon le SERVICE qui les sert (le wiki, l'index CPK, le CDN, le moteur de
 * recherche). Un joueur ne sait pas ce qu'est un CPK ; il sait qu'il cherche
 * un personnage, une technique, un objet.
 *
 * Le découpage retenu suit donc le VOCABULAIRE DU JEU, pas l'architecture :
 * huit racines, chacune nommée par ce dont elle parle. Aucune ne dépasse cinq
 * sous-commandes, ce qui laisse vingt places libres par racine — la contrainte
 * des 25 cesse d'être un plafond qu'on frôle pour devenir une marge.
 *
 * Deux racines gardent un vocabulaire technique assumé, `/media` et `/file` :
 * elles servent les fichiers du jeu tels qu'ils sont, et les renommer en
 * « images » ou « archives » promettrait une abstraction qui n'existe pas.
 */
export const ARBRE: Readonly<Record<string, Racine>> = Object.freeze({
	character: {
		nom: "character",
		description: "Character sheets from Inazuma Eleven: Victory Road",
		nomFr: "personnage",
		descriptionFr: "Fiches de personnages d'Inazuma Eleven: Victory Road",
		sous: {
			profile: {
				nom: "profile",
				description: "Full sheet for a player: stats, element, techniques and 3D model",
				nomFr: "fiche",
				descriptionFr: "Fiche complète d'un joueur : stats, élément, techniques et modèle 3D",
				remplace: "/azalee perso",
			},
			coach: {
				nom: "coach",
				description: "Sheet for a coach: role, play style, bonuses and requirements",
				nomFr: "entraineur",
				descriptionFr: "Fiche d'un entraîneur : rôle, style de jeu, bonus et prérequis",
				remplace: "/azalee entraineur",
			},
			coordinator: {
				nom: "coordinator",
				description: "Sheet for a coordinator: role, element and progression",
				nomFr: "coordinateur",
				descriptionFr: "Fiche d'un coordinateur : rôle, élément et progression",
				remplace: "/azalee coordinateur",
			},
			outfit: {
				nom: "outfit",
				description: "Outfits and costumes available in the game",
				nomFr: "costume",
				descriptionFr: "Costumes et tenues disponibles dans le jeu",
				remplace: "/azalee costume",
			},
			recruit: {
				nom: "recruit",
				description: "Recruitment odds by zodiac sign, tier by tier",
				nomFr: "invocation",
				descriptionFr: "Taux de recrutement par signe du zodiaque, palier par palier",
				remplace: "/azalee invocation",
			},
		},
	},

	move: {
		nom: "move",
		description: "Techniques, auras, tactics and passive skills",
		nomFr: "technique",
		descriptionFr: "Techniques, auras, tactiques et compétences passives",
		sous: {
			technique: {
				nom: "technique",
				description: "Sheet for a special move (hissatsu): power, element, TP cost",
				nomFr: "special",
				descriptionFr: "Fiche d'une technique spéciale (hissatsu) : puissance, élément, coût TP",
				remplace: "/azalee technique",
			},
			aura: {
				nom: "aura",
				description: "Sheet for an aura: armed, spirit or totem, and its linked move",
				nomFr: "aura",
				descriptionFr: "Fiche d'une aura : armure, esprit ou totem, et sa technique liée",
				remplace: "/azalee aura",
			},
			tactic: {
				nom: "tactic",
				description: "Sheet for a tactic: effects, duration, cooldown and where to buy it",
				nomFr: "tactique",
				descriptionFr: "Fiche d'une tactique : effets, durée, recharge et où l'acheter",
				remplace: "/azalee tactique",
			},
			passive: {
				nom: "passive",
				description: "Sheet for a passive skill: effect, value and rarity",
				nomFr: "passif",
				descriptionFr: "Fiche d'une compétence passive : effet, valeur et rareté",
				remplace: "/azalee passif",
			},
		},
	},

	item: {
		nom: "item",
		description: "Items, shops, drop rates and capsules",
		nomFr: "objet",
		descriptionFr: "Objets, magasins, taux de drop et capsules",
		sous: {
			info: {
				nom: "info",
				description: "Sheet for an item: equipment, consumable or material",
				nomFr: "fiche",
				descriptionFr: "Fiche d'un objet : équipement, consommable ou matériau",
				remplace: "/azalee objet",
			},
			shop: {
				nom: "shop",
				description: "Contents of a shop, by category",
				nomFr: "magasin",
				descriptionFr: "Contenu d'un magasin, par catégorie",
				remplace: "/azalee magasin",
			},
			drop: {
				nom: "drop",
				description: "Drop rates: victory chests and item emissions",
				nomFr: "drop",
				descriptionFr: "Taux de drop : coffres de victoire et émissions d'objet",
				remplace: "/azalee drops",
			},
			capsule: {
				nom: "capsule",
				description: "Capsule lots (gacha): draw pools and their contents",
				nomFr: "capsule",
				descriptionFr: "Lots de capsules (gacha) : pools de tirage et contenus",
				remplace: "/azalee capsule",
			},
		},
	},

	team: {
		nom: "team",
		description: "Teams, rosters, emblems and stadiums",
		nomFr: "equipe",
		descriptionFr: "Équipes, effectifs, emblèmes et stades",
		sous: {
			info: {
				nom: "info",
				description: "Sheet for a team: emblem, series appearances and roster",
				nomFr: "fiche",
				descriptionFr: "Fiche d'une équipe : emblème, présences par série et effectif",
				remplace: "/azalee equipe",
			},
			stadium: {
				nom: "stadium",
				description: "Sheet for a stadium, with its pitch artwork",
				nomFr: "stade",
				descriptionFr: "Fiche d'un stade, avec son visuel de terrain",
				remplace: "/azalee stade",
			},
		},
	},

	quest: {
		nom: "quest",
		description: "Quests and achievements",
		nomFr: "quete",
		descriptionFr: "Quêtes et succès",
		sous: {
			info: {
				nom: "info",
				description: "Sheet for a quest: kind, phase and artwork",
				nomFr: "fiche",
				descriptionFr: "Fiche d'une quête : genre, phase et illustration",
				remplace: "/azalee quete",
			},
			achievement: {
				nom: "achievement",
				description: "Sheet for an achievement: category, group and how to unlock it",
				nomFr: "succes",
				descriptionFr: "Fiche d'un succès : catégorie, groupe et condition d'obtention",
				remplace: "/azalee succes",
			},
		},
	},

	media: {
		nom: "media",
		description: "Artwork, textures and 3D models decoded from the game",
		nomFr: "media",
		descriptionFr: "Illustrations, textures et modèles 3D décodés depuis le jeu",
		sous: {
			illustration: {
				nom: "illustration",
				description: "Artwork catalogued by the wiki: story, chronicles, telops",
				nomFr: "illustration",
				descriptionFr: "Illustrations cataloguées par le wiki : histoire, chroniques, télops",
				remplace: "/azalee galerie",
			},
			gallery: {
				nom: "gallery",
				description: "Browse the game's artwork page by page",
				nomFr: "galerie",
				descriptionFr: "Parcourt les illustrations du jeu, page par page",
				remplace: "/cdn galerie",
			},
			image: {
				nom: "image",
				description: "Show a game texture as a lightweight resized WebP",
				nomFr: "image",
				descriptionFr: "Affiche une texture du jeu en WebP léger redimensionné",
				remplace: "/cdn image",
			},
			model: {
				nom: "model",
				description: "Full 3D model of a character, keshin or armed aura",
				nomFr: "modele",
				descriptionFr: "Modèle 3D complet d'un personnage, d'un keshin ou d'une armure",
				remplace: "/cdn modele",
			},
		},
	},

	file: {
		nom: "file",
		description: "Browse the files packed inside the game's CPK archives",
		nomFr: "fichier",
		descriptionFr: "Parcourt les fichiers empaquetés dans les archives CPK du jeu",
		sous: {
			browse: {
				nom: "browse",
				description: "Walk the game's file tree, folder by folder",
				nomFr: "parcourir",
				descriptionFr: "Parcourt l'arborescence des fichiers du jeu, dossier par dossier",
				remplace: "/cpk parcourir",
			},
			find: {
				nom: "find",
				description: "Search a pattern across the game's file paths",
				nomFr: "chercher",
				descriptionFr: "Cherche un motif dans les chemins de fichiers du jeu",
				remplace: "/cpk chercher",
			},
			info: {
				nom: "info",
				description: "Sheet for a game file: source archive, type and content preview",
				nomFr: "fiche",
				descriptionFr: "Fiche d'un fichier du jeu : archive d'origine, type et aperçu",
				remplace: "/cpk fichier",
			},
		},
	},

	search: {
		nom: "search",
		description: "Search across the game's data, in plain words",
		nomFr: "recherche",
		descriptionFr: "Cherche dans les données du jeu, en langage courant",
		sous: {
			all: {
				nom: "all",
				description: "Search characters, techniques and items at once",
				nomFr: "tout",
				descriptionFr: "Cherche à la fois dans les personnages, techniques et objets",
				remplace: "/azalee recherche",
			},
			ask: {
				nom: "ask",
				description: "Ask a question about the game and get the matching excerpts",
				nomFr: "question",
				descriptionFr: "Pose une question sur le jeu et reçois les extraits correspondants",
				remplace: "/rag question",
			},
			text: {
				nom: "text",
				description: "Find a game string, or one text id across the three languages",
				nomFr: "texte",
				descriptionFr: "Trouve une chaîne du jeu, ou un identifiant dans les trois langues",
				remplace: "/rag texte",
			},
		},
	},
});

/** Toutes les racines, dans l'ordre de déclaration. */
export const RACINES: readonly Racine[] = Object.freeze(Object.values(ARBRE));

/**
 * Options de `@SlashGroup({...})` pour une racine.
 *
 * Lève quand la racine est inconnue : une faute de frappe dans un décorateur
 * doit tuer l'import du module, pas produire une commande fantôme que Discord
 * publiera sous un nom que personne n'a voulu.
 */
export function racine(cle: string): {
	name: string;
	description: string;
	nameLocalizations: { fr: string };
	descriptionLocalizations: { fr: string };
} {
	const entree = ARBRE[cle];
	if (!entree) {
		throw new Error(
			`[arbre] racine inconnue : « ${cle} ». Racines déclarées : ${Object.keys(ARBRE).join(", ")}.`
		);
	}
	return {
		name: entree.nom,
		description: entree.description,
		nameLocalizations: { [LOCALE_FR]: entree.nomFr },
		descriptionLocalizations: { [LOCALE_FR]: entree.descriptionFr },
	};
}

/**
 * Options de `@Slash({...})` pour une sous-commande.
 *
 * `contexts` et `integrationTypes` ne sont PAS posés ici : Discord ne les
 * accepte que sur la commande de premier niveau, jamais sur une sous-commande.
 * Les poser produirait un `Invalid Form Body` à l'enregistrement. Ils vivent
 * dans `lib/portee.ts`, appliqués à la racine.
 */
export function sous(
	cleRacine: string,
	cleSous: string
): {
	name: string;
	description: string;
	nameLocalizations: { fr: string };
	descriptionLocalizations: { fr: string };
} {
	const entree = ARBRE[cleRacine];
	if (!entree) {
		throw new Error(
			`[arbre] racine inconnue : « ${cleRacine} ». Racines déclarées : ${Object.keys(ARBRE).join(", ")}.`
		);
	}
	const feuille = entree.sous[cleSous];
	if (!feuille) {
		throw new Error(
			`[arbre] sous-commande inconnue : « ${cleRacine} ${cleSous} ». ` +
				`Sous-commandes de « ${cleRacine} » : ${Object.keys(entree.sous).join(", ")}.`
		);
	}
	return {
		name: feuille.nom,
		description: feuille.description,
		nameLocalizations: { [LOCALE_FR]: feuille.nomFr },
		descriptionLocalizations: { [LOCALE_FR]: feuille.descriptionFr },
	};
}

/**
 * Options d'une `@SlashOption`, traduites.
 *
 * Les options ne vivent pas dans `ARBRE` : elles sont propres au corps de la
 * commande, changent avec lui, et une table les tiendrait loin du code qui les
 * lit. Ce helper ne fait qu'imposer la même FORME — nom anglais, description
 * anglaise, localisation française — et laisse `arbre.test.ts` les valider en
 * les relisant dans les sources.
 */
export function option(
	nom: string,
	description: string,
	nomFr: string,
	descriptionFr: string
): {
	name: string;
	description: string;
	nameLocalizations: { fr: string };
	descriptionLocalizations: { fr: string };
} {
	return {
		name: nom,
		description,
		nameLocalizations: { [LOCALE_FR]: nomFr },
		descriptionLocalizations: { [LOCALE_FR]: descriptionFr },
	};
}
