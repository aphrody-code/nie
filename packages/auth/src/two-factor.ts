/**
 * Double authentification — la configuration, une seule fois pour les deux apps.
 *
 * ── CE QUI MANQUAIT, ET CE QUI ÉTAIT PIRE QUE MANQUANT ─────────────────────
 * Le plugin `twoFactor` était déclaré des deux côtés (serveur et client) depuis
 * longtemps, et la carte « Double authentification » de la page de compte
 * affichait un bouton grisé « Bientôt disponible ». Trois pièces sur quatre : il
 * manquait la table `two_factor` (le schéma du plugin a changé de version — il
 * n'écrit plus dans `user.two_factor_secret`), l'interface d'activation, et la
 * page `/2fa`. Or `auth-client.ts` redirigeait DÉJÀ vers `/2fa` après une
 * connexion à second facteur : un compte qui aurait réussi à armer sa 2FA
 * serait tombé sur un 404, sans champ où saisir son code. La promesse creuse
 * était donc doublée d'un piège.
 *
 * ── `allowPasswordless`, SANS QUOI PERSONNE NE POURRAIT L'ACTIVER ──────────
 * Le plugin exige par défaut le mot de passe du compte pour armer ou désarmer
 * la 2FA. Sur rosegriffon.fr, `emailAndPassword` n'est même pas activé : on ne
 * s'y connecte que par Discord, Google, Twitch ou Patreon, et AUCUN de ces
 * comptes n'a de mot de passe à donner — la carte aurait donc refusé tout le
 * monde avec « INVALID_PASSWORD », ce qui est la pire façon de tenir une
 * promesse. Avec cette option, le mot de passe reste exigé de ceux qui en ont
 * un (c'est le cas sur Azalée, qui ouvre l'inscription par e-mail) et n'est pas
 * réclamé aux autres. La garde n'est pas perdue pour autant : l'endpoint exige
 * une session valide, et l'activation n'est effective qu'après vérification
 * d'un premier code.
 *
 * ── LE NOM DES COLONNES N'EST PAS UNE PRÉFÉRENCE ──────────────────────────
 * Tout le schéma de ce dépôt est en `snake_case` (`user_id`, `created_at`), et
 * Better Auth écrit en `camelCase` s'il n'est pas détrompé. Le mapping ci-dessous
 * est ce qui fait que le plugin trouve la table posée par la migration
 * `20260831_two_factor.sql` — sans lui, il chercherait `twoFactor.userId` et
 * échouerait à l'écriture, une fois le premier QR code déjà affiché.
 */
import { twoFactor } from "better-auth/plugins";

/**
 * Le plugin `twoFactor`, configuré pour ce dépôt.
 *
 * @param issuer Nom affiché dans l'application d'authentification (« Rose
 *   Griffon », « Azalée ») — c'est ce que l'utilisateur lira à côté du code.
 */
export function deuxFacteurs(issuer: string) {
	return twoFactor({
		issuer,
		// Comptes OAuth sans mot de passe : voir l'en-tête.
		allowPasswordless: true,
		schema: {
			twoFactor: {
				modelName: "two_factor",
				fields: {
					userId: "user_id",
					backupCodes: "backup_codes",
					failedVerificationCount: "failed_verification_count",
					lockedUntil: "locked_until",
				},
			},
		},
	});
}
