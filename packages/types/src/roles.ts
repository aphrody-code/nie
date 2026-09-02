/**
 * Rôles unifiés Rose Griffon — source unique pour bot/azalee/website.
 *
 * La colonne Postgres `profiles.role` est `text | null` (pas un enum côté DB),
 * donc cette union TypeScript est la SEULE garantie de cohérence cross-app.
 *
 * Union = somme de tous les rôles utilisés historiquement :
 *  - admin       : full access (commun bot + web)
 *  - superadmin  : peut promouvoir d'autres admins (web uniquement)
 *  - editor      : édite news/articles (azalee)
 *  - moderator   : modère commentaires + bannit (commun bot + web)
 *  - staff       : équipe RG (cards/photos staff — bot uniquement)
 *  - premium     : abonné Patreon actif (bot)
 *  - user        : défaut, utilisateur authentifié
 *  - banned      : interdit (bot)
 */
export const ALL_ROLES = [
	"admin",
	"superadmin",
	"editor",
	"moderator",
	"staff",
	"premium",
	"user",
	"banned",
] as const;

export type RgRole = (typeof ALL_ROLES)[number];

/**
 * Le nom qu'on donne à un rôle devant quelqu'un.
 *
 * La carte du compte affichait la valeur BRUTE de la colonne — « member »,
 * « superadmin », « moderator » — à côté du pseudo. Ce sont des clés de base de
 * données, pas des mots destinés à être lus : elles sont en anglais sur un site
 * entièrement français, et « superadmin » ne dit rien à personne. Azalée avait
 * déjà sa propre table de traduction, dans un composant de page ; celle-ci est
 * partagée pour que les deux surfaces disent la même chose.
 */
export const LIBELLES_ROLES: Readonly<Record<RgRole, string>> = Object.freeze({
	admin: "Administrateur",
	banned: "Banni",
	editor: "Rédacteur",
	moderator: "Modérateur",
	premium: "Patron",
	staff: "Équipe",
	superadmin: "Administrateur principal",
	user: "Membre",
});

/** Libellé lisible d'un rôle, y compris quand la colonne dit autre chose. */
export function libelleRole(role: string | null | undefined): string {
	if (!role) {
		return LIBELLES_ROLES.user;
	}
	return (LIBELLES_ROLES as Record<string, string>)[role] ?? LIBELLES_ROLES.user;
}

/** Roles qui peuvent accéder au dashboard editorial (azalee + website). */
export const ADMIN_ROLES = [
	"admin",
	"superadmin",
	"editor",
	"moderator",
] as const satisfies readonly RgRole[];
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Roles qui peuvent gérer les utilisateurs (changer rôle, bannir). */
export const USER_MANAGEMENT_ROLES = ["admin", "superadmin"] as const satisfies readonly RgRole[];
export type UserManagementRole = (typeof USER_MANAGEMENT_ROLES)[number];

/** Roles autorisés à exécuter les slash commands admin du bot Discord. */
export const BOT_ADMIN_ROLES = ["admin", "staff"] as const satisfies readonly RgRole[];
export type BotAdminRole = (typeof BOT_ADMIN_ROLES)[number];

/** Roles "modérateurs" — accès commentaires, signalements (commun bot + web). */
export const MODERATOR_ROLES = [
	"admin",
	"superadmin",
	"moderator",
] as const satisfies readonly RgRole[];
export type ModeratorRole = (typeof MODERATOR_ROLES)[number];

// --- Helpers --------------------------------------------------------------

export function isRgRole(value: unknown): value is RgRole {
	return typeof value === "string" && (ALL_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: string | null | undefined): role is AdminRole {
	return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

export function isUserManagementRole(role: string | null | undefined): role is UserManagementRole {
	return !!role && (USER_MANAGEMENT_ROLES as readonly string[]).includes(role);
}

export function isBotAdminRole(role: string | null | undefined): role is BotAdminRole {
	return !!role && (BOT_ADMIN_ROLES as readonly string[]).includes(role);
}

export function isModeratorRole(role: string | null | undefined): role is ModeratorRole {
	return !!role && (MODERATOR_ROLES as readonly string[]).includes(role);
}

export function isBannedRole(role: string | null | undefined): boolean {
	return role === "banned";
}
