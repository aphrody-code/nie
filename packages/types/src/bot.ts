/**
 * Contrat du bot Discord Rose Griffon — réglages, profils, état d'exécution.
 *
 * ── POURQUOI CE FICHIER VIT DANS `@rosegriffon/types` ──────────────────────
 * Le schéma des réglages de communauté (`bot_reglages_guilde.valeurs`, un
 * `jsonb`) était défini dans `apps/bot/src/lib/reglages-communaute.ts`, et il y
 * était bien : une colonne `jsonb` n'a aucun schéma, le contrepoids doit exister
 * quelque part. Mais à partir du moment où le SITE édite ces réglages depuis son
 * interface d'administration, deux écrivains partagent la même colonne. Recopier
 * le schéma côté site, c'est garantir qu'un jour le formulaire écrira une valeur
 * que le bot refusera de relire — et le bot, qui ne lève jamais à la lecture,
 * retomberait silencieusement sur ses défauts en effaçant tout.
 *
 * Le schéma vit donc ici, une fois, et il s'applique DANS LES DEUX SENS et pour
 * LES DEUX ÉCRIVAINS : à l'écriture (refuser une valeur aberrante), à la lecture
 * (un document ancien ou corrompu retombe sur les défauts au lieu de faire
 * tomber une commande).
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Zod et rien d'autre : aucune E/S, aucun `discord.js`, aucun `Bun.*`. Il
 * s'importe donc aussi bien dans un composant React (`"use client"`) que dans
 * une commande Discord ou une route Next.
 *
 * ⚠ Les identifiants réels de la guilde Rose Griffon ne sont PAS ici : ils sont
 * semés en base par la migration `20260814_bot_communaute_reglages.sql`. Un
 * réglage est une donnée, pas une constante de code — le staff doit pouvoir
 * déplacer un salon sans déploiement.
 */
import { z } from "zod";

// ─── Gain d'expérience ──────────────────────────────────────────────────────

/**
 * Réglage d'XP par défaut, partagé par le bot et par le formulaire du site.
 *
 * Les valeurs reprennent la convention des bots de niveaux (15–25 XP par
 * message, 60 s de délai anti-spam) : partir d'ailleurs rendrait toute
 * comparaison avec l'historique Noctaly fausse.
 */
export const GAIN_XP_DEFAUT = Object.freeze({
	/**
	 * XP d'un message éligible — 20, fixe.
	 *
	 * C'est la règle de Noctaly, écrite noir sur blanc sur son classement :
	 * « Toutes les 60 secondes, tu peux envoyer un message pour obtenir 20 XP ».
	 * La fourchette 15–25 d'avant venait de la convention des bots du marché ;
	 * elle rendait la progression légèrement plus rapide en moyenne et, surtout,
	 * elle empêchait de retrouver le compte exact d'un membre. Minimum et
	 * maximum sont donc égaux : le tirage aléatoire existe toujours dans le code
	 * (il suffit d'écarter les deux bornes pour le réactiver), il ne tire juste
	 * plus rien.
	 */
	minimum: 20,
	maximum: 20,
	/** Délai avant qu'un nouveau message rapporte. */
	delaiSecondes: 60,
	/** Jetons Kizuna offerts à chaque montée de niveau, multipliés par le niveau. */
	jetonsParNiveau: 10,
} as const);

// ─── Briques de schéma ──────────────────────────────────────────────────────

/** Un flocon Discord, tel qu'il arrive d'une option de commande ou de la base. */
const flocon = z.string().regex(/^\d{15,25}$/, "identifiant Discord attendu");

/** Liste de flocons, dédoublonnée — deux fois le même rôle n'a aucun sens. */
const flocons = z
	.array(flocon)
	.default([])
	.transform((liste) => [...new Set(liste)]);

/**
 * Où annoncer une montée de niveau.
 *
 * ── LE DÉFAUT EST « AUCUNE », ET C'EST VOLONTAIRE ──────────────────────────
 * `place` (dans le salon où le message a été envoyé) est le défaut des bots du
 * marché. Sur un serveur de deux mille membres, il transforme chaque salon en
 * flux d'annonces : c'est LA raison pour laquelle les communautés finissent par
 * couper leur bot de niveaux. `salon` centralise le bruit, `prive` l'envoie en
 * message direct, `aucune` n'en fait aucun.
 *
 * Ici le défaut est `aucune` : un bot qui s'installe ne doit RIEN publier tant
 * que le staff n'a pas dit où. Le membre voit sa progression avec `/profil`,
 * quand il la demande.
 */
export const LIEUX_ANNONCE = ["salon", "place", "prive", "aucune"] as const;

export type LieuAnnonce = (typeof LIEUX_ANNONCE)[number];

/** Libellés d'interface des lieux d'annonce de niveau. */
export const LIBELLES_LIEU_ANNONCE: Readonly<Record<LieuAnnonce, string>> = Object.freeze({
	salon: "Dans un salon dédié",
	place: "Dans le salon du message",
	prive: "En message privé",
	aucune: "Aucune annonce",
});

const reglagesNiveaux = z
	.object({
		actif: z.boolean().default(true),
		/** Salon d'annonce quand `annonce = "salon"`. */
		salonAnnonce: flocon.nullable().default(null),
		annonce: z.enum(LIEUX_ANNONCE).default("aucune"),
		/**
		 * N'annoncer QUE les niveaux multiples de cette valeur.
		 *
		 * Sans ce filtre, un membre actif déclenche une annonce tous les deux ou
		 * trois jours en début de courbe — et deux mille membres actifs, c'est un
		 * salon inutilisable. À 5, on ne fête que ce qui se fête : les paliers
		 * ronds. `1` rétablit l'annonce à chaque niveau.
		 */
		palierAnnonce: z.number().int().min(1).max(100).default(5),
		/**
		 * Annoncer aussi les CHANGEMENTS DE RANG (Normal → Expérimenté → Héros →
		 * BASARA), même hors palier. Trois fois dans une vie de membre : c'est le
		 * genre d'événement qui mérite un message.
		 */
		annoncerRang: z.boolean().default(true),
		/** Salons qui ne rapportent aucune XP (bots, journaux, vitrines). */
		salonsExclus: flocons,
		/** Rôles qui ne gagnent pas d'XP (bots, comptes de service). */
		rolesExclus: flocons,
		gain: z
			.object({
				minimum: z.number().int().min(0).max(1_000).default(GAIN_XP_DEFAUT.minimum),
				maximum: z.number().int().min(0).max(1_000).default(GAIN_XP_DEFAUT.maximum),
				delaiSecondes: z.number().int().min(0).max(3_600).default(GAIN_XP_DEFAUT.delaiSecondes),
			})
			.prefault({}),
	})
	.prefault({});

const reglagesTickets = z
	.object({
		actif: z.boolean().default(true),
		/** Salon qui porte le panneau d'ouverture, et parent des fils de tickets. */
		salonPanneau: flocon.nullable().default(null),
		/** Salon où part la carte de fermeture. */
		salonHistorique: flocon.nullable().default(null),
		/** Catégorie de salons « Support » — utile en mode `salon` seulement. */
		categorieSupport: flocon.nullable().default(null),
		/** Rôles qui prennent en charge les tickets ordinaires. */
		rolesStaff: flocons,
		/** Rôles qui voient AUSSI les tickets sensibles (signalements). */
		rolesDirection: flocons,
		/**
		 * `fil` reprend le fonctionnement en place (ticketsbot crée des fils) ;
		 * `salon` crée un vrai salon dans la catégorie Support. Le défaut est `fil` :
		 * un serveur est plafonné à 500 salons, jamais aux fils.
		 */
		mode: z.enum(["fil", "salon"]).default("fil"),
	})
	.prefault({});

/**
 * Où souhaiter la bienvenue.
 *
 * `aucune` par défaut, comme les annonces de niveau : un bot fraîchement
 * installé ne publie rien tant que le staff ne lui a pas dit où. Un serveur qui
 * reçoit vingt arrivées par jour n'a peut-être aucune envie de vingt messages.
 */
export const LIEUX_BIENVENUE = ["salon", "prive", "aucune"] as const;

export type LieuBienvenue = (typeof LIEUX_BIENVENUE)[number];

/** Libellés d'interface des lieux de bienvenue. */
export const LIBELLES_LIEU_BIENVENUE: Readonly<Record<LieuBienvenue, string>> = Object.freeze({
	salon: "Dans un salon dédié",
	prive: "En message privé",
	aucune: "Aucun message",
});

const reglagesAccueil = z
	.object({
		actif: z.boolean().default(true),
		lieu: z.enum(LIEUX_BIENVENUE).default("aucune"),
		/** Salon d'accueil quand `lieu = "salon"`. */
		salon: flocon.nullable().default(null),
		/**
		 * Texte du message. `{membre}` est remplacé par la mention, `{serveur}` par
		 * le nom du serveur, `{compte}` par le nombre de membres.
		 * `null` = le texte par défaut du bot.
		 */
		texte: z.string().max(1_000).nullable().default(null),
		/**
		 * Rôle posé à l'arrivée. Il passe par la MÊME garde stricte que les
		 * récompenses de niveau : un rôle d'arrivée est distribué automatiquement à
		 * tout le monde, c'est la surface la plus large qui existe.
		 */
		roleArrivee: flocon.nullable().default(null),
		/** Joindre la carte image d'accueil. */
		carte: z.boolean().default(true),
	})
	.prefault({});

/**
 * Boîte à suggestions.
 *
 * `salon` à `null` par défaut : la boîte est FERMÉE tant qu'un administrateur
 * n'a pas dit où les suggestions doivent atterrir. C'est la règle d'activation
 * manuelle — une commande publique qui publie dans un salon ne s'ouvre pas
 * toute seule.
 */
const reglagesSuggestions = z
	.object({
		actif: z.boolean().default(true),
		salon: flocon.nullable().default(null),
	})
	.prefault({});

const reglagesKizuna = z
	.object({
		actif: z.boolean().default(true),
		/** Salon où annoncer les recrutements remarquables (Héros, BASARA). */
		salonAnnonce: flocon.nullable().default(null),
	})
	.prefault({});

/**
 * Journal de modération — la trace, là où le staff la lit.
 *
 * ── LE JOURNAL EXISTAIT DÉJÀ, PERSONNE NE POUVAIT LE LIRE ──────────────────
 * Chaque avertissement, exclusion ou bannissement passé par le bot s'écrit dans
 * `admin_audit_log`. C'est une table Postgres : pour savoir qu'un membre vient
 * d'être averti, il fallait ouvrir la base — autant dire que ça n'arrivait
 * jamais, et que le reste du staff apprenait la sanction par la personne
 * sanctionnée. Le salon de journal ferme cette boucle : la ligne d'audit reste
 * la source, le salon en est la lecture.
 *
 * `salonJournal` à `null` par défaut, comme toute publication de ce bot : rien
 * n'est publié tant qu'un administrateur n'a pas dit où. Le défaut ne parle
 * pas.
 */
const reglagesModeration = z
	.object({
		actif: z.boolean().default(true),
		/** Salon où publier chaque action de modération. `null` = rien n'est publié. */
		salonJournal: flocon.nullable().default(null),
	})
	.prefault({});

export const SchemaReglages = z
	.object({
		niveaux: reglagesNiveaux,
		tickets: reglagesTickets,
		kizuna: reglagesKizuna,
		accueil: reglagesAccueil,
		suggestions: reglagesSuggestions,
		moderation: reglagesModeration,
	})
	.prefault({});

export type ReglagesCommunaute = z.infer<typeof SchemaReglages>;

/** Les six sections réglables, dans l'ordre d'affichage de l'interface. */
export const SECTIONS_REGLAGES = [
	"niveaux",
	"tickets",
	"moderation",
	"accueil",
	"suggestions",
	"kizuna",
] as const;

export type SectionReglages = (typeof SECTIONS_REGLAGES)[number];

/** Libellé et rôle de chaque section — la même phrase dans Discord et sur le site. */
export const LIBELLES_SECTIONS: Readonly<
	Record<SectionReglages, { readonly titre: string; readonly role: string }>
> = Object.freeze({
	niveaux: {
		titre: "Niveaux",
		role: "Expérience gagnée par message, annonces de montée et exclusions.",
	},
	tickets: {
		titre: "Tickets",
		role: "Panneau d'ouverture, prise en charge et historique des tickets.",
	},
	moderation: {
		titre: "Modération",
		role: "Salon où publier les avertissements, exclusions et bannissements.",
	},
	accueil: {
		titre: "Accueil",
		role: "Message de bienvenue et rôle posé à l'arrivée d'un membre.",
	},
	suggestions: {
		titre: "Suggestions",
		role: "Boîte à suggestions publique et salon de dépôt.",
	},
	kizuna: {
		titre: "Jetons Kizuna",
		role: "Monnaie de communauté et annonce des recrutements remarquables.",
	},
});

/** Le document par défaut — celui d'une guilde qui n'a jamais rien réglé. */
export const REGLAGES_DEFAUT: ReglagesCommunaute = SchemaReglages.parse({});

/**
 * Lit un document venu de la base.
 *
 * Ne lève JAMAIS. Un `jsonb` illisible ou obsolète rend les défauts : une
 * commande de profil ne doit pas tomber parce qu'un réglage de tickets a été
 * mal écrit il y a six mois. Le problème se voit dans le journal, pas dans la
 * figure du membre.
 */
export function lireReglages(brut: unknown): ReglagesCommunaute {
	const resultat = SchemaReglages.safeParse(brut ?? {});
	if (resultat.success) {
		return resultat.data;
	}
	console.warn(
		"[reglages] document illisible, retour aux défauts :",
		resultat.error.issues
			.map((probleme) => `${probleme.path.join(".")} ${probleme.message}`)
			.join(" · ")
	);
	return REGLAGES_DEFAUT;
}

/**
 * Valide un document AVANT écriture. Ici, on lève : une écriture est un acte
 * volontaire, et la refuser en disant pourquoi vaut mieux que d'enregistrer une
 * valeur qui sera silencieusement ignorée à la relecture.
 */
export function validerReglages(brut: unknown): ReglagesCommunaute {
	return SchemaReglages.parse(brut);
}

/**
 * Modification partielle, telle qu'un formulaire ou une commande l'envoie.
 *
 * Écrit à la main plutôt que déduit de `SchemaModificationReglages` : le type
 * doit être lisible dans un éditeur (`Partial` d'une section, `Partial` de
 * `gain`), et il doit exister AVANT le schéma pour typer `fusionnerReglages`.
 * Un test vérifie que les deux ne divergent pas.
 */
export type ModificationReglages = {
	[K in SectionReglages]?: K extends "niveaux"
		? Partial<Omit<ReglagesCommunaute["niveaux"], "gain">> & {
				gain?: Partial<ReglagesCommunaute["niveaux"]["gain"]>;
			}
		: Partial<ReglagesCommunaute[K]>;
};

/**
 * Fusionne une modification partielle dans un document existant.
 *
 * Fusion PROFONDE sur les six sections ET sur `niveaux.gain`, superficielle
 * partout ailleurs : régler `niveaux.annonce` ne doit pas effacer
 * `niveaux.salonsExclus`, mais remplacer `niveaux.salonsExclus` doit bien le
 * remplacer et non l'additionner (sinon on ne pourrait jamais retirer une
 * exclusion).
 *
 * `gain` fait exception à la règle « superficiel en dessous » parce qu'il est
 * le seul sous-objet réglable : un formulaire qui n'expose que le délai
 * anti-spam enverrait `{ gain: { delaiSecondes: 90 } }` et remettrait la
 * fourchette d'XP à 15–25 sans que personne ne l'ait demandé.
 */
export function fusionnerReglages(
	actuels: ReglagesCommunaute,
	modification: ModificationReglages
): ReglagesCommunaute {
	const { gain: gainModifie, ...niveauxModifies } = modification.niveaux ?? {};
	return validerReglages({
		accueil: { ...actuels.accueil, ...modification.accueil },
		suggestions: { ...actuels.suggestions, ...modification.suggestions },
		kizuna: { ...actuels.kizuna, ...modification.kizuna },
		niveaux: {
			...actuels.niveaux,
			...niveauxModifies,
			gain: { ...actuels.niveaux.gain, ...gainModifie },
		},
		tickets: { ...actuels.tickets, ...modification.tickets },
		moderation: { ...actuels.moderation, ...modification.moderation },
	});
}

/**
 * Rend chaque champ d'un objet zod facultatif SANS conserver sa valeur par
 * défaut.
 *
 * ── POURQUOI PAS `.partial()` ──────────────────────────────────────────────
 * `.partial()` rend les clés facultatives mais laisse les `.default()` en
 * place : `SchemaNiveaux.partial().parse({ actif: false })` rend
 * `{ actif: false, palierAnnonce: 5, annonce: "aucune", … }`. Appliqué comme
 * modification partielle, ce document REMET aux défauts tout ce que le
 * formulaire n'a pas envoyé — c'est-à-dire qu'un simple basculement d'un
 * interrupteur efface le salon d'annonce configuré six mois plus tôt.
 *
 * On déballe donc chaque `ZodDefault` / `ZodPrefault` avant de rendre le champ
 * facultatif, et on RECOMMENCE sur les sous-objets — `niveaux.gain` est le seul
 * aujourd'hui, mais c'est exactement là que le piège se referme : un formulaire
 * qui n'expose que le délai anti-spam remettrait la fourchette d'XP à 15–25.
 * Absent veut alors dire absent, et `fusionnerReglages` garde la valeur en
 * place. Vérifié : `{ niveaux: { actif: false } }` ressort tel quel.
 */
function partielSansDefauts(objet: z.ZodObject): z.ZodObject {
	const forme: Record<string, z.ZodType> = {};
	for (const [clef, champ] of Object.entries(objet.shape as Record<string, z.ZodType>)) {
		const nu = deballer(champ);
		forme[clef] = (nu instanceof z.ZodObject ? partielSansDefauts(nu) : nu).optional();
	}
	return z.object(forme).strict();
}

/** Retire l'enveloppe `.default()` / `.prefault()` d'un champ, s'il en a une. */
function deballer(champ: z.ZodType): z.ZodType {
	if (champ instanceof z.ZodDefault || champ instanceof z.ZodPrefault) {
		return champ.unwrap() as z.ZodType;
	}
	return champ;
}

/**
 * Schéma d'une modification partielle — celui qu'une route HTTP applique au
 * corps reçu.
 *
 * `.strict()` à tous les niveaux : un champ inconnu est une erreur, pas un
 * silence. Sans ce schéma, la route devrait faire confiance au corps reçu,
 * c'est-à-dire à n'importe quel client porteur d'une session administrateur.
 */
export const SchemaModificationReglages = z
	.object({
		niveaux: partielSansDefauts(reglagesNiveaux.unwrap()).optional(),
		tickets: partielSansDefauts(reglagesTickets.unwrap()).optional(),
		kizuna: partielSansDefauts(reglagesKizuna.unwrap()).optional(),
		accueil: partielSansDefauts(reglagesAccueil.unwrap()).optional(),
		suggestions: partielSansDefauts(reglagesSuggestions.unwrap()).optional(),
		moderation: partielSansDefauts(reglagesModeration.unwrap()).optional(),
	})
	.strict();

/**
 * Les réglages sont-ils exploitables pour les tickets ?
 *
 * Rendu comme une liste de manques plutôt qu'un booléen : le staff a besoin de
 * savoir CE QU'IL RESTE à poser, pas seulement que ça ne marche pas.
 */
export function manquesTickets(reglages: ReglagesCommunaute): string[] {
	const manques: string[] = [];
	if (!reglages.tickets.salonPanneau) {
		manques.push("le salon du panneau (`salon-panneau`)");
	}
	if (!reglages.tickets.salonHistorique) {
		manques.push("le salon d'historique (`salon-historique`)");
	}
	if (reglages.tickets.rolesStaff.length === 0 && reglages.tickets.rolesDirection.length === 0) {
		manques.push("au moins un rôle de prise en charge (`role-staff`)");
	}
	if (reglages.tickets.mode === "salon" && !reglages.tickets.categorieSupport) {
		manques.push("la catégorie Support (`categorie`), obligatoire en mode salon");
	}
	return manques;
}

/**
 * Manques par section — ce que l'interface affiche en pastille « à configurer ».
 *
 * Une section sans manque est prête ; une section désactivée n'a aucun manque
 * (on ne réclame pas un salon d'annonce à quelqu'un qui a coupé les annonces).
 */
export function manquesParSection(
	reglages: ReglagesCommunaute
): Readonly<Record<SectionReglages, string[]>> {
	const niveaux: string[] = [];
	if (reglages.niveaux.actif) {
		if (reglages.niveaux.annonce === "salon" && !reglages.niveaux.salonAnnonce) {
			manquePousse(niveaux, "le salon d'annonce des montées de niveau");
		}
		if (reglages.niveaux.gain.maximum < reglages.niveaux.gain.minimum) {
			manquePousse(niveaux, "un gain maximum au moins égal au minimum");
		}
	}

	const accueil: string[] = [];
	if (reglages.accueil.actif && reglages.accueil.lieu === "salon" && !reglages.accueil.salon) {
		manquePousse(accueil, "le salon d'accueil");
	}

	const suggestions: string[] = [];
	if (reglages.suggestions.actif && !reglages.suggestions.salon) {
		manquePousse(suggestions, "le salon de dépôt des suggestions");
	}

	const moderation: string[] = [];
	if (reglages.moderation.actif && !reglages.moderation.salonJournal) {
		manquePousse(moderation, "le salon du journal de modération");
	}

	return Object.freeze({
		niveaux,
		moderation,
		tickets: reglages.tickets.actif ? manquesTickets(reglages) : [],
		accueil,
		suggestions,
		// Le salon d'annonce des recrutements est facultatif : sans lui, les
		// recrutements remarquables ne sont simplement pas annoncés.
		kizuna: [],
	});
}

function manquePousse(liste: string[], texte: string): void {
	liste.push(texte);
}

// ─── Profils du bot ─────────────────────────────────────────────────────────

/** Les deux identités Discord servies par le même programme. */
export const NOMS_PROFILS_BOT = ["rg", "azalee"] as const;

export type NomProfilBot = (typeof NOMS_PROFILS_BOT)[number];

/** Vrai si la chaîne est un nom de profil connu. */
export function estNomProfilBot(valeur: unknown): valeur is NomProfilBot {
	return typeof valeur === "string" && (NOMS_PROFILS_BOT as readonly string[]).includes(valeur);
}

/**
 * Description d'exploitation d'un profil — ce qu'une interface doit savoir sans
 * charger `discord.js`.
 *
 * Le registre complet (jetons, intents, modules) reste dans
 * `apps/bot/src/lib/profil.ts` : il dépend de `discord.js` et n'a rien à faire
 * dans un bundle navigateur.
 */
export interface ProfilBotPublic {
	readonly nom: NomProfilBot;
	readonly titre: string;
	/** Unité systemd qui fait tourner ce profil. */
	readonly unite: string;
	/** Couleur d'accent de la marque, en hexadécimal CSS. */
	readonly couleurHex: `#${string}`;
	/** Domaine que le profil représente. */
	readonly domaine: string;
	/** Port de son serveur d'administration en boucle locale. */
	readonly portAdmin: number;
	/** Ce que ce profil sert, en une phrase. */
	readonly role: string;
}

/**
 * Les deux profils, tels que l'interface d'administration les affiche.
 *
 * Les ports sont FIXES et distincts : les deux services tournent sur la même
 * machine, un port partagé ferait échouer le démarrage du second sans que
 * personne ne comprenne pourquoi le tableau de bord montre deux fois le même
 * bot.
 */
export const PROFILS_BOT: Readonly<Record<NomProfilBot, ProfilBotPublic>> = Object.freeze({
	rg: Object.freeze({
		nom: "rg",
		titre: "Rose Griffon",
		unite: "rg-bot.service",
		couleurHex: "#a14b3f",
		domaine: "rosegriffon.fr",
		portAdmin: 3007,
		role: "communauté, modération, tickets, niveaux et administration du serveur",
	}),
	azalee: Object.freeze({
		nom: "azalee",
		titre: "Azalée",
		unite: "azalee-bot.service",
		couleurHex: "#F89C5A",
		domaine: "azalee.rosegriffon.fr",
		portAdmin: 3008,
		role: "données du jeu, fichiers extraits, recherche sémantique et annonces X",
	}),
});

export const TOUS_LES_PROFILS_BOT: readonly ProfilBotPublic[] = Object.freeze(
	Object.values(PROFILS_BOT)
);

// ─── État d'exécution, tel que le serveur d'administration du bot le rend ────

/** Une guilde où le bot est présent. */
export interface GuildeBot {
	readonly id: string;
	readonly nom: string;
	readonly membres: number;
	/** Les commandes du profil y sont-elles enregistrées ? */
	readonly servie: boolean;
	readonly icone: string | null;
}

/** Une option de slash command, telle que Discord la décrit. */
export interface OptionCommandeBot {
	readonly nom: string;
	readonly description: string;
	readonly type: string;
	readonly requise: boolean;
}

/** Une commande — racine, sous-groupe ou sous-commande, à plat. */
export interface CommandeBot {
	/** Chemin complet tel qu'un membre le tape, sans la barre oblique. */
	readonly chemin: string;
	/** Nom de la commande racine. */
	readonly racine: string;
	/** Sous-groupe, quand il y en a un. */
	readonly groupe: string | null;
	/** Nom de la sous-commande, quand il y en a une. */
	readonly sousCommande: string | null;
	readonly description: string;
	readonly options: readonly OptionCommandeBot[];
	/** Profil qui sert cette commande. */
	readonly profil: NomProfilBot;
	/** Fichier source, relatif à `apps/bot/src`. */
	readonly source: string | null;
	/**
	 * Réservée au staff ?
	 *
	 * Déduit de la racine (`administration`, `staff`) : c'est la garde
	 * `requireRgAdmin` qui décide réellement, mais l'interface doit pouvoir
	 * distinguer une commande publique d'une commande d'exploitation.
	 */
	readonly reservee: boolean;
}

/** Réponse de `GET /etat` du serveur d'administration du bot. */
export interface EtatBot {
	readonly profil: NomProfilBot;
	readonly titre: string;
	/** Étiquette Discord du bot connecté (`nom#0000`), `null` avant `ready`. */
	readonly etiquette: string | null;
	readonly identifiantApplication: string | null;
	/** Secondes depuis le démarrage du processus. */
	readonly uptimeSecondes: number;
	/** Latence de la passerelle Discord, en millisecondes. `-1` avant le premier battement. */
	readonly latenceMs: number;
	readonly guildes: readonly GuildeBot[];
	/** Guildes configurées mais non rejointes — la panne la plus silencieuse. */
	readonly guildesAbsentes: readonly string[];
	readonly nombreCommandes: number;
	readonly modulesCharges: number;
	/** Mémoire résidente du processus, en octets. */
	readonly memoireOctets: number;
	/** ISO 8601. */
	readonly mesureLe: string;
}

/** État agrégé des deux profils, tel que le site l'affiche. */
export interface EtatBotAgrege {
	readonly profil: ProfilBotPublic;
	readonly joignable: boolean;
	readonly etat: EtatBot | null;
	readonly erreur: string | null;
	readonly latenceSondeMs: number;
}

/** Réponse de `GET /sante` — volontairement minuscule, sondée toutes les minutes. */
export interface SanteBot {
	readonly ok: boolean;
	readonly profil: NomProfilBot;
	readonly pret: boolean;
	readonly uptimeSecondes: number;
}
