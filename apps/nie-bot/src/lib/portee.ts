/**
 * PORTÉE PUBLIQUE — ce qui rend ce bot utilisable partout, y compris en privé.
 *
 * ── LES TROIS DÉCLARATIONS, ET CE QUE CHACUNE OUVRE ────────────────────────
 * Elles sont indépendantes ; en oublier une ferme une porte sans message
 * d'erreur, et la panne se manifeste comme « la commande n'apparaît pas », ce
 * qui ressemble à tout sauf à un oubli de déclaration.
 *
 *  1. **Portée globale** — décidée dans `index.ts` par l'ABSENCE de `botGuilds`.
 *     Les commandes appartiennent à l'application, donc à tout serveur qui
 *     l'invite, présent comme futur. C'est la seule portée qui tienne pour un
 *     bot public : par guilde, chaque nouvelle invitation demanderait un
 *     déploiement.
 *
 *  2. **`contexts`** — OÙ la commande peut être invoquée. Sans elle, Discord
 *     retient le défaut historique (serveurs seuls) et la commande n'apparaît
 *     tout simplement pas en message privé.
 *       - `Guild` : dans un serveur ;
 *       - `BotDM` : dans le message privé AVEC LE BOT ;
 *       - `PrivateChannel` : dans un groupe privé ou le MP d'un tiers, ce que
 *         seule une installation sur le COMPTE rend possible.
 *
 *  3. **`integrationTypes`** — À QUOI le bot peut être ajouté.
 *       - `GuildInstall` : à un serveur, le mode classique ;
 *       - `UserInstall` : à un COMPTE, si bien que la personne emporte ses
 *         commandes partout, même là où le bot n'est pas invité.
 *     `PrivateChannel` sans `UserInstall` est une contradiction : le contexte
 *     serait déclaré et jamais atteignable.
 *
 * ── CE QUI EST NULL EN MESSAGE PRIVÉ ───────────────────────────────────────
 * C'est LE piège de ce chantier, et il ne se voit ni au type-check ni en
 * recette sur un serveur. En message privé, l'interaction ne porte AUCUN
 * contexte de serveur :
 *
 *     interaction.guild      → null
 *     interaction.guildId    → null
 *     interaction.member     → null
 *     interaction.channel    → null quand le MP n'a jamais été ouvert
 *     interaction.appPermissions → une permission de DM, pas celle d'un salon
 *
 * Tout code hérité qui lit un rôle, une permission de salon ou un identifiant
 * de guilde LÈVE (`Cannot read properties of null`) ou refuse l'accès, et le
 * membre voit « L'application n'a pas répondu ». Les commandes de ce bot ne
 * lisent donc jamais que `interaction.user` — présent dans les trois contextes,
 * c'est la seule identité garantie.
 *
 * `setDefaultMemberPermissions` ne s'applique PAS en message privé : une
 * commande qu'on voudrait réserver ne peut pas l'être par ce moyen. C'est une
 * des raisons pour lesquelles aucune commande d'exploitation n'entre ici — un
 * bot public ne doit rien porter dont l'accès dépende d'une garde que Discord
 * n'applique pas partout.
 */
import { ApplicationIntegrationType, InteractionContextType } from "discord.js";

/**
 * Les trois contextes d'invocation, ouverts.
 *
 * Déclarés sur la COMMANDE RACINE uniquement : Discord refuse `contexts` sur
 * une sous-commande (`Invalid Form Body`), et le type de discordx le dit déjà
 * (`SlashGroupSubRoot` force `contexts?: undefined`).
 */
export const CONTEXTES: readonly InteractionContextType[] = Object.freeze([
	InteractionContextType.Guild,
	InteractionContextType.BotDM,
	InteractionContextType.PrivateChannel,
]);

/** Installation sur un serveur ET sur un compte. */
export const INSTALLATIONS: readonly ApplicationIntegrationType[] = Object.freeze([
	ApplicationIntegrationType.GuildInstall,
	ApplicationIntegrationType.UserInstall,
]);

/**
 * Le bloc à étaler dans chaque `@SlashGroup({...})` racine.
 *
 * Les tableaux sont RECOPIÉS à chaque appel : discordx conserve la référence
 * qu'on lui passe, et une constante gelée partagée entre huit commandes
 * deviendrait un état global — exactement ce qu'un bot destiné au sharding ne
 * doit pas porter.
 */
export function porteePublique(): {
	contexts: InteractionContextType[];
	integrationTypes: ApplicationIntegrationType[];
} {
	return {
		contexts: [...CONTEXTES],
		integrationTypes: [...INSTALLATIONS],
	};
}
