/**
 * Trousse de présentation des deux bots Discord.
 *
 * Une commande n'importe QUE ce module : `import { fiche, succes, differer }
 * from "../lib/ui"`. Les cinq fichiers derrière lui sont la seule source de
 * couleurs, d'icônes, de limites, de bornage, de pieds de page, de chiffres et
 * de pagination — c'est l'équivalent, côté Discord, de ce qu'est
 * `@rose-griffon/ui` pour les deux apps Next : aucune commande n'écrit une
 * couleur, une émoji d'état ou une limite d'API en dur.
 *
 * Le pattern d'une commande, dans l'ordre :
 *
 *     1. différer (privé pour /staff et /administration, public sinon) ;
 *     2. lire les données (lib/, services/, API internes) ;
 *     3. construire une `fiche(...)` — elle tient le budget de 6 000 caractères ;
 *     4. poser le pied avec `piedDeCommande(embed, interaction)` ;
 *     5. paginer avec `rangeePagination(...)` si la liste dépasse une page ;
 *     6. rattraper les pannes en `echec(titre, quoi-faire)`, jamais en texte nu.
 *
 * Voir `docs/bot-format.md` pour la charte complète et ses exemples.
 */
export * from "./theme";
export * from "./texte";
export * from "./etat";
export * from "./embed";
export * from "./nombres";
export * from "./pagination";
export * from "./reponse";
