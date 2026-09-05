# Azalée — le wiki de référence Inazuma Eleven

**Objectif fixé par l'utilisateur le 2026-09-05 :** Azalée devient le wiki de référence
francophone et internationale d'Inazuma Eleven, à la place de
`inazuma-eleven.fandom.com/fr`. Un slug unique par joueur, équipe et technique ; les noms
français, anglais et japonais affichés en écriture latine **et** japonaise ; les corrections
et contributions de la communauté ; et le référencement d'un vrai wiki.

Ce document est le **programme**. Il ne tient pas dans la semaine J1–J7 de
[`/PLAN.md`](../../PLAN.md), qui reste la migration, et il ne la retarde pas : tout ce qu'il
décrit s'appuie sur le socle serverless qu'elle livre.

## Ce qui est mesuré au départ (2026-09-05)

| Fait | Valeur | Conséquence |
|---|---|---|
| Lignes `inagle_characters` | 6 168 | ce n'est pas le nombre de pages |
| `internal_code` distincts | **5 723** | c'est le nombre de **concepts**, donc de pages |
| `chara_id` distincts | 5 737 | variantes de fiche d'un même concept |
| `base_slug` distincts | 5 199 | **969 collisions** — `unknown` ×65, `kr-k9` ×20, `shawn-froste` ×17 |
| `slug` distincts | 6 168 | unique, mais de la forme `mark-evans-0x3055CF22` : illisible, non partageable, sans valeur SEO |
| `is_primary = 1` | 5 260 lignes | une ligne canonique est **déjà désignée** |
| `name_ja` renseigné | 6 103 / 6 168 (99 %) | le japonais existe déjà |
| Colonne romaji / kana latin | **0** | à produire |
| `slug` sur `inagle_teams`, `_skills`, `_items` | **inexistant** | tout est à créer pour ces trois entités |
| Pages Next.js | 91, dont **31** avec `generateMetadata` | 60 pages sans métadonnées propres |
| Poids de `/chara` | 2 355 397 o, 404 `<img>` sans `srcset` | incompatible avec un bon Core Web Vitals mobile |

**Le cas d'école, mesuré.** Dix-sept lignes portent `mark-evans`. Onze sont le code
`c01000010` — le personnage, plus ses variantes `hero_type` *black* et *pink* et une `_5000`.
Les six autres sont `c05024610`, `c05029460`, `c07110020`, `c11500500`, `c11901150` : des
**personnages différents** qui partagent un nom traduit. Un wiki qui crée 17 pages perd ;
un wiki qui crée 6 pages, dont une riche avec ses variantes, gagne.

## Décisions

### 1. Une page par concept, jamais par ligne

L'unité éditoriale est le **concept**, identifié par `internal_code` — le même code que celui
qui nomme les fichiers du VFS, donc le même identifiant qu'Aphrody utilise en chemin
(amendement A3). Les deux sites décrivent le même objet avec la même identité ; l'un l'affiche
en chemin, l'autre en slug lisible. Les variantes (`hero_type`, `_5000`, doublons de fiche)
sont des **sections** de la page du concept, pas des pages.

### 2. Le slug est lisible, unique, et désambiguïsé par le sens

Jamais un hash dans une URL. La règle, appliquée dans cet ordre :

1. `azalee.rosegriffon.fr/chara/mark-evans` quand le nom ne désigne qu'un concept ;
2. sinon un qualificatif **signifiant**, à la manière d'un vrai wiki :
   `/chara/mark-evans-inazuma-eleven`, `/chara/mark-evans-victory-road` — la série, puis
   l'équipe, puis le code du jeu **en dernier recours seulement** ;
3. le choix est **stable et versionné** dans une table de slugs dédiée, jamais recalculé au
   vol : un slug publié ne change plus, et un renommage laisse un `301` permanent.

Une page de **désambiguïsation** liste les homonymes (`/chara/mark-evans` quand cinq
personnages différents portent ce nom). Les 969 collisions deviennent une fonctionnalité au
lieu d'un défaut. Les entités sans slug aujourd'hui — équipes, techniques, objets — reçoivent
le même traitement.

### 3. Trois langues, deux écritures, une seule page

Chaque fiche affiche le nom **français**, **anglais**, **japonais en kanji/kana** et sa
**translittération latine** (romaji). Le japonais est déjà là (6 103 / 6 168) ; le romaji est
à produire — `kuroshiro` + `kuroshiro-analyzer-kuromoji` sont déjà au catalogue Bun, utilisés
par `packages/inagle`. La translittération est **calculée une fois et stockée**, jamais à la
volée : c'est une donnée, pas un rendu, et elle doit être corrigeable par la communauté
(les noms propres japonais sont le cas où un analyseur morphologique se trompe le plus).

Les trois langues vivent sur **une seule page** avec `hreflang` : `fr`, `en`, `ja`,
`x-default`. Une page par langue serait trois fois le travail éditorial pour un contenu
identique à 90 %, et diluerait l'autorité du domaine.

### 4. La communauté corrige et contribute

- **Comptes** : `better-auth`, déjà en place, sur le Supabase Cloud. Les 1 931 lignes
  `auth.users` du VPS **ne sont pas migrées** (décision inchangée) : on repart de comptes
  neufs, et la réinscription vaut consentement.
- **Deux niveaux** : une **correction** (un champ, une faute, une traduction) et une
  **contribution** (un paragraphe, une page d'article, une image). La première doit coûter
  deux clics depuis la fiche ; c'est elle qui fait vivre un wiki.
- **Révisions** : chaque modification est une ligne immuable — auteur, horodatage, avant,
  après, source invoquée. Rien n'écrase directement une donnée du jeu : une correction
  humaine est une **surcouche** qui s'applique par-dessus la valeur extraite, et la valeur
  extraite reste visible. C'est ce qui permet de rejouer un import de données de jeu sans
  détruire le travail de la communauté — le mode d'échec qui tue les wikis adossés à des
  données.
- **Modération** : file d'attente, rôles (visiteur, contributeur, modérateur),
  auto-publication au-dessus d'un seuil de réputation, journal public des changements.
- **RLS** : `anon` reste en lecture seule ; `authenticated` écrit **uniquement** dans les
  tables de propositions et de révisions, jamais dans `inagle_*`. Aucune écriture anonyme.
- **Invalidation** : une contribution acceptée déclenche
  `POST /api/ops/revalidate/wiki` — l'ISR déjà en place, rien de neuf à construire.

### 5. Le référencement d'un vrai wiki

L'objectif « premier sur tous les mots-clés Inazuma Eleven » est un **cap**, pas une case à
cocher : Fandom a quinze ans d'antériorité et une autorité de domaine qu'aucune optimisation
technique ne renverse en un mois. Ce qui se pilote, ce sont des causes mesurables :

| Levier | Départ mesuré | Cible |
|---|---|---|
| Pages avec métadonnées propres | 31 / 91 | **100 %**, titre et description uniques, jamais générés à l'identique |
| Données structurées | partielles | JSON-LD sur chaque fiche (`Article`, `VideoGame`, `Person` pour les joueurs), fil d'Ariane, `SearchAction` |
| `hreflang` | absent | `fr`, `en`, `ja`, `x-default` sur toute fiche |
| Poids de `/chara` | 2 355 397 o | **< 250 Ko**, `srcset` partout (lot J3 de la semaine) |
| Sitemaps | 1 fichier | index de sitemaps segmenté par entité, `lastmod` réel issu des révisions |
| URL stables | slugs à hash | slugs lisibles + `301` permanents à chaque renommage |
| Contenu unique | fiches générées | chaque fiche gagne du texte humain : c'est la contribution communautaire qui crée la différence avec un dump de base |
| Fraîcheur | import périodique | `lastmod` bougé par les contributions, ce que Fandom ne fait pas mieux |

Le seul avantage structurel réel sur Fandom : **nos données viennent du jeu**, décodées et
vérifiables, là où un wiki communautaire recopie. Le référencement doit exposer cette
exactitude — sources citées, date d'extraction, version du jeu — plutôt que d'imiter Fandom.

## Ce qu'il faut construire, dans l'ordre

1. **Table de slugs** : concept ↔ slug ↔ historique, avec les `301`. Rien d'autre ne peut
   commencer avant, parce que toute URL en dépend.
2. **Romaji** stocké et corrigeable, `hreflang`, affichage des quatre formes de nom.
3. **Pages de désambiguïsation** et regroupement des variantes par concept.
4. **Métadonnées et JSON-LD** sur les 91 pages, sitemaps segmentés.
5. **Comptes, corrections, révisions, modération.**
6. **Contributions longues** : articles, images, relecture.

Les étapes 1 à 4 sont du travail sur des données et du rendu : elles n'exigent aucun compte
et peuvent suivre immédiatement la semaine de migration. Les étapes 5 et 6 introduisent
l'écriture, donc la modération, donc une charge humaine : elles ne démarrent pas avant que
quelqu'un accepte de modérer.

## Gates

- **Slugs** : chaque concept a exactement un slug ; `select count(*) from slugs` = nombre de
  concepts ; aucun slug ne contient `0x` ; deux imports successifs ne changent aucun slug
  publié ; chaque ancien slug répond `301`.
- **Noms** : 100 % des fiches affichent les quatre formes quand la donnée existe, et disent
  laquelle manque quand elle manque — jamais un champ vide silencieux.
- **Contributions** : une correction acceptée survit à un réimport complet des données du
  jeu. C'est **le** test ; il se rejoue.
- **SEO** : 100 % des pages ont un titre et une description uniques (mesuré par comptage de
  doublons, pas à l'œil) ; `/chara` sous 250 Ko ; JSON-LD valide au validateur de Google.
- **Position** : suivi mensuel d'un panier de mots-clés fixé à l'avance, publié avec sa date.
  Aucune promesse de rang — une mesure, et sa tendance.
