/**
 * Le profil public — ce qu'un membre peut écrire sur lui-même, et ce qu'il ne
 * peut pas.
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────
 * Le même schéma était écrit deux fois, dans `apps/website/.../account/actions.ts`
 * et dans `apps/azalee/app/settings/actions.ts`, et les deux acceptaient
 * `badges: z.array(z.string())` — c'est-à-dire n'importe quoi. Deux
 * conséquences, l'une visible et l'autre pas :
 *
 *   - un badge inventé s'écrivait en base et n'apparaissait nulle part (la
 *     table de rendu ne connaît que cinq identifiants) : l'enregistrement
 *     répondait « profil mis à jour » et le membre ne voyait rien ;
 *   - surtout, **« Staff » et « Patreon » étaient auto-attribuables**. Le
 *     formulaire les proposait à tout le monde, le serveur les écrivait sans
 *     rien vérifier, et le profil public affichait « Membre de l'équipe
 *     d'administration du site » à côté du pseudo de qui le demandait.
 *
 * Le contrat vit donc ici, une fois, comme celui du bot dans `bot.ts`.
 */
import { z } from "zod";

/**
 * Les badges de profil : les quatre éléments d'Inazuma Eleven.
 *
 * ── CE QU'ILS REMPLACENT ───────────────────────────────────────────────────
 * Avant, c'étaient cinq distinctions — « Fondateur », « VIP », « Bêta-testeur »,
 * « Patreon », « Staff » — dont deux affirmaient quelque chose de vérifiable que
 * personne ne vérifiait : n'importe quel compte pouvait porter « Membre de
 * l'équipe d'administration » à côté de son pseudo. Les éléments, eux, ne
 * prétendent à rien : ce sont des couleurs d'appartenance, exactement comme
 * dans le jeu où chaque joueur en a un. Il n'y a donc plus rien à mériter, et
 * plus rien à usurper.
 *
 * Les identifiants restent en anglais, comme partout où le jeu est indexé
 * (`inagle_*`, `GALLERY_CATEGORIES`, les icônes `spirit_type/*.webp`) ; les
 * libellés français vivent côté interface.
 */
export const BADGES_PROFIL = ["fire", "wind", "forest", "mountain"] as const;

export type BadgeProfil = (typeof BADGES_PROFIL)[number];

/**
 * Badges que l'on ne s'attribue pas soi-même — aucun, désormais.
 *
 * La liste reste (et la vérification avec elle) parce que la question se
 * reposera le jour où un badge dira de nouveau quelque chose de vérifiable :
 * mécène, membre de l'équipe, vainqueur d'un tournoi. La retirer obligerait à
 * réécrire la garde à ce moment-là, c'est-à-dire à l'oublier.
 */
export const BADGES_MERITES = [] as const satisfies readonly BadgeProfil[];

/**
 * Nombre de badges affichables à la fois.
 *
 * Trois sur quatre éléments : on choisit une affinité, on n'aligne pas la
 * collection complète — un profil qui porte les quatre ne dit plus rien.
 */
export const MAX_BADGES_PROFIL = 3;

/** Longueur maximale de la biographie. */
export const MAX_BIO_PROFIL = 500;

/** Les schémas d'URL qu'un navigateur doit suivre — et rien d'autre. */
const SCHEMAS_LIEN = new Set(["http:", "https:"]);

/**
 * Un lien de profil, rendu en `href` sur une page publique.
 *
 * `z.string().url()` ne suffit PAS : `javascript:alert(1)` est une URL valide au
 * sens de la norme, et elle était acceptée telle quelle puis posée en `href`
 * sur `/profil/<pseudo>`. Un clic d'un visiteur exécutait alors le script de
 * quelqu'un d'autre, dans sa propre session.
 */
export const SchemaLienPublic = z
	.string()
	.url("URL invalide")
	.refine((valeur) => {
		try {
			return SCHEMAS_LIEN.has(new URL(valeur).protocol);
		} catch {
			return false;
		}
	}, "Le lien doit commencer par http:// ou https://");

/**
 * Ce qu'une page de compte a le droit d'écrire sur `profiles`.
 *
 * `badges` est déclaré en `string[]` EN ENTRÉE — le formulaire partagé n'a pas
 * de raison de connaître le type littéral — et restreint aux badges connus en
 * sortie. Les actions serveur doivent donc typer leur paramètre avec
 * `z.input<typeof SchemaProfilPublic>`, jamais `z.infer`.
 */
/**
 * Les quatre postes du jeu, par leur abréviation.
 *
 * Ce sont les valeurs de `inagle_characters.position` (Gardien, Défenseur,
 * Milieu, Attaquant) abrégées comme le jeu les affiche sur une fiche de joueur.
 * `null` reste possible : on n'attribue pas un poste par défaut à quelqu'un qui
 * n'en a pas choisi.
 */
export const POSTES_PROFIL = ["GAR", "DEF", "MIL", "ATT"] as const;

export type PosteProfil = (typeof POSTES_PROFIL)[number];

/** Nom complet d'un poste, tel que le wiki le nomme. */
export const LIBELLES_POSTES: Readonly<Record<PosteProfil, string>> = Object.freeze({
	ATT: "Attaquant",
	DEF: "Défenseur",
	GAR: "Gardien",
	MIL: "Milieu",
});

export const SchemaProfilPublic = z.object({
	/**
	 * Les badges inconnus sont ÉCARTÉS, pas refusés.
	 *
	 * Un `z.enum` strict paraît plus sûr, et c'est un piège : le catalogue change
	 * (les cinq distinctions d'hier sont devenues les quatre éléments du jeu), et
	 * les profils qui portaient un badge disparu renvoient cette valeur au premier
	 * enregistrement — le formulaire répondait alors « Données invalides » sur un
	 * champ que la personne ne voit même plus, sans aucun moyen de s'en sortir.
	 * On filtre donc : ce qui n'est plus au catalogue s'efface en silence, et
	 * l'enregistrement passe.
	 */
	badges: z
		.array(z.string())
		.max(MAX_BADGES_PROFIL)
		.transform((liste) =>
			liste.filter((badge): badge is BadgeProfil =>
				(BADGES_PROFIL as readonly string[]).includes(badge)
			)
		),
	banner_url: z.string().optional().or(z.literal("")),
	/**
	 * Cadrage vertical de la bannière, de 0 (haut de l'image) à 100 (bas).
	 *
	 * Une illustration du jeu fait 3840×2160 et la bannière n'en montre qu'une
	 * bande : sans ce réglage, `object-cover` prenait toujours le centre, et un
	 * visage placé dans le tiers supérieur se retrouvait coupé sans recours.
	 * 50 reproduit exactement l'ancien comportement.
	 */
	banner_position: z.coerce.number().int().min(0).max(100).default(50),
	/** Poste affiché sur la carte, ou rien. */
	/**
	 * Poste affiché sur la carte, ou rien.
	 *
	 * La chaîne vide est traduite en `null` : un `<select>` sans choix renvoie
	 * `""`, que l'enum refuserait — le formulaire afficherait alors une erreur
	 * sur un champ que l'on vient justement de vider.
	 */
	poste: z
		.string()
		.nullable()
		.default(null)
		// Même règle que les badges : ce qui n'est pas au catalogue est ÉCARTÉ, pas
		// refusé. Un `<select>` vide renvoie `""`, et le jour où un poste
		// disparaîtra du jeu, les profils qui le portaient doivent rester
		// enregistrables.
		.transform((valeur) =>
			valeur && (POSTES_PROFIL as readonly string[]).includes(valeur)
				? (valeur as PosteProfil)
				: null
		),
	bio: z.string().max(MAX_BIO_PROFIL).optional(),
	full_name: z.string().optional(),
	twitter_handle: z.string().optional(),
	username: z
		.string()
		.min(3, "Le nom d'utilisateur doit faire au moins 3 caractères.")
		.max(20, "Le nom d'utilisateur ne peut pas dépasser 20 caractères."),
	website: SchemaLienPublic.optional().or(z.literal("")),
});

export type ProfilPublic = z.infer<typeof SchemaProfilPublic>;
export type ProfilPublicSaisi = z.input<typeof SchemaProfilPublic>;

/** Un badge doit-il être mérité pour être ajouté ? */
export function badgeMerite(badge: string): boolean {
	return (BADGES_MERITES as readonly string[]).includes(badge);
}

/**
 * Filtre les badges demandés selon ce que le compte peut prouver.
 *
 * Les badges DÉJÀ posés sont conservés : cette fonction filtre les ajouts. Sans
 * cette nuance, une simple modification de biographie retirerait le badge
 * « Staff » d'un administrateur le jour où la lecture de son rôle échoue — un
 * effet de bord silencieux, et dans le sens le plus difficile à diagnostiquer.
 */
export function filtrerBadges(
	demandes: readonly string[],
	droits: { estStaff: boolean; estMecene: boolean; dejaPoses: readonly string[] }
): string[] {
	const deja = new Set(droits.dejaPoses);
	return demandes.filter((badge) => {
		if (!badgeMerite(badge)) {
			return true;
		}
		if (deja.has(badge)) {
			return true;
		}
		return badge === "staff" ? droits.estStaff : droits.estMecene;
	});
}
