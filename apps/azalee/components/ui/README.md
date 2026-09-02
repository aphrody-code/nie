# Composants UI spécifiques au wiki

Ce dossier ne duplique pas `@rosegriffon/ui` : il ne contient que les
composants **propres au wiki**, ceux qui n'ont de sens qu'avec les données du
jeu et qui n'ont donc pas leur place dans le design system partagé.

| Composant | Rôle |
| --- | --- |
| `SpriteIcon` · `CommonSpriteIcon` · `GameSpriteIcon` | Icônes découpées dans les atlas de sprites du jeu (masque CSS sur une sous-texture) |
| `SpriteIcon.module.css` | Feuille de style associée aux sprites |
| `Icon` | Enveloppe d'icône générique du wiki |
| `SafeImage` | Image tolérante aux assets manquants du CDN |
| `rarity-badge` | Badge de rareté d'une entité du jeu |
| `search-bar` | Barre de recherche du wiki |
| `wiki-loading-skeleton` | Squelettes de chargement des pages de fiche |
| `fade-in` · `pull-to-refresh` | Deux primitives d'interaction propres à l'app |

Tout le reste — boutons, cartes, dialogues, champs, navigation — vient de
**`@rosegriffon/ui`**, importé directement (`import { Button } from
"@rosegriffon/ui"`). Ajouter ici un composant générique serait une
régression : il doit aller dans le paquet partagé, où les deux sites en
profitent.
