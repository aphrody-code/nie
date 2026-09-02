# Recherche du wiki

Recherche floue multilingue sur les entités d'*Inazuma Eleven: Victory Road*.
Les noms existent en français, anglais et japonais : une requête doit trouver
« Mark Evans », « 円堂 守 » et une faute de frappe sur l'un des deux.

## Modules

| Fichier | Rôle |
| --- | --- |
| `fuzzy-match.ts` | distance de Levenshtein, score de similarité, normalisation (accents, casse), variations de nom, détection de la langue qui a matché, surlignage |
| `smart-search.ts` | `smartSearch()` : recherche contextuelle sur toutes les collections, cache de résultats, suggestions « vouliez-vous dire » |
| `utils.ts` | normalisation de texte partagée |
| `search-ui-config.ts` | libellés de type et styles de badge de langue (client-safe) |
| `manifest.json` | index figé embarqué dans le paquet |

## Utilisation

```ts
import { smartSearch } from "@rosegriffon/azalee/search";

const resultats = await smartSearch("tornade", { limit: 10, minScore: 0.5 });
```

Chaque résultat porte le type de l'entité, son slug, son score et la langue
qui a produit la correspondance — c'est ce qui permet d'afficher un badge
`FR` / `EN` / `JA` à côté du nom.

## Pièges

- La **clé de cache doit inclure toutes les options** (`minScore`,
  `enableSuggestions`…) : sans cela deux appels aux paramètres différents se
  répondent l'un l'autre.
- Les noms japonais sont sous `names.ja`, pas `names.jp`.
- Les suggestions se construisent sur les noms **bruts**, pas sur leur forme
  normalisée : proposer « mark evans » sans accent ni majuscule là où le wiki
  affiche « Mark Evans » donne une suggestion qui a l'air fausse.

Ce module est **client-safe** : il ne touche ni au disque ni à la base, et se
bundle dans un navigateur.
