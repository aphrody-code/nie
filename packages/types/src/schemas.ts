import { z } from "zod";
import { ARTICLE_STATUS } from "./article";
import { ALL_ROLES } from "./roles";

// ============================================================================
// Rôles & authentification
// ============================================================================

/**
 * Rôle Rose Griffon, validé à l'exécution.
 *
 * Dérivé de `ALL_ROLES` et non recopié : la liste avait divergé (elle acceptait
 * `member` et `guest`, qui n'existent nulle part ailleurs, et refusait
 * `superadmin`, `staff`, `premium`, `banned`, qui sont bien des rôles réels).
 * Un schéma de validation qui contredit l'union TypeScript ne protège de rien.
 */
export const rgRoleSchema = z.enum(ALL_ROLES);

// ============================================================================
// Articles & chroniques
// ============================================================================

/** Validation d'un article / d'une chronique en entrée. */
export const articleSchema = z.object({
	author_id: z.string().optional().nullable(),
	category: z.string().optional().nullable(),
	content: z.string().min(1, "Le contenu est requis"),
	excerpt: z.string().optional().nullable(),
	featured_image_url: z.string().optional().nullable(),
	slug: z
		.string()
		.min(1, "Le slug est requis")
		.regex(
			/^[a-z0-9-]+$/,
			"Le slug ne doit contenir que des lettres minuscules, des chiffres et des tirets"
		),
	status: z.enum(ARTICLE_STATUS).default("draft"),
	title: z.string().min(1, "Le titre est requis"),
});

export type ArticleInput = z.infer<typeof articleSchema>;

// ============================================================================
// Tweets
// ============================================================================

/** Validation d'un tweet. */
export const tweetSchema = z.object({
	author_name: z.string().min(1, "Nom requis"),
	author_username: z.string().min(1, "Nom d'utilisateur requis"),
	id: z.string().optional(),
	text: z.string().min(1, "Le contenu ne peut pas être vide"),
});

export type TweetInput = z.infer<typeof tweetSchema>;

// ============================================================================
// Contact
// ============================================================================

/** Sujets proposés par le formulaire de contact. */
export const CONTACT_SUBJECTS = [
	"Information sur l'association",
	"Collaboration",
	"Don et soutien",
	"Événements à venir",
	"Adhésion",
	"Bénévolat",
	"Demande de presse",
	"Témoignage",
	"Support technique",
	"Autres",
] as const;

/** Validation du formulaire de contact. */
export const contactFormSchema = z.object({
	description: z.string().min(10, {
		message: "La description doit contenir au moins 10 caractères.",
	}),
	subject: z.enum(CONTACT_SUBJECTS, {
		message: "Veuillez sélectionner un sujet.",
	}),
	title: z.string().min(2, {
		message: "Le titre doit contenir au moins 2 caractères.",
	}),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;
