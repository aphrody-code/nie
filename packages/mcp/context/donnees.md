# Données du jeu — d'où elles viennent et comment les interroger

Les données proviennent de la **rétro-ingénierie des fichiers d'Inazuma
Eleven: Victory Road** (Level-5). Rien n'est saisi à la main : un extracteur
(`packages/inagle`) lit les archives CPK du jeu, en tire des tables typées,
les pousse dans Supabase, et un miroir SQLite local sert le wiki.

## Chaîne de traitement

```
archives CPK du jeu → packages/inagle (extraction) → Supabase (tables inagle_*)
                    → miroir SQLite apps/azalee/data/backups/mirror.sqlite
                    → @rosegriffon/azalee → wiki, API headless, ce serveur MCP
```

Le miroir est rafraîchi chaque jour par `azalee-mirror-sync.timer` (échange
atomique du fichier puis redémarrage du wiki). Il ne contient **que** les
tables `inagle_*`, sans donnée personnelle.

## Volumétrie réelle du miroir

66 tables. Les principales, comptées dans la base :

| Table | Lignes | Contenu |
| --- | --- | --- |
| `inagle_characters` | 6 148 | personnages et leurs variantes |
| `inagle_game_assets` | 40 471 | assets référencés du jeu |
| `inagle_rag_edges` | 41 491 | graphe de liens entre entités et assets |
| `inagle_shops` | 2 331 | inventaires de boutiques |
| `inagle_items` | 1 668 | objets |
| `inagle_skills` | 1 002 | techniques |
| `inagle_lua_scripts` | 666 | scripts de jeu |
| `inagle_uniforms` | 384 | uniformes |
| `inagle_keshins` | 282 | keshins |
| `inagle_trophies` | 228 | trophées |
| `inagle_teams` | 208 | équipes |
| `inagle_quests` | 182 | quêtes |
| `inagle_passives` | 128 | compétences passives |
| `inagle_stadiums` | 81 | stades |

À côté du miroir : l'index des **250 800 fichiers** extraits des archives CPK
(`cpk_*`) et l'index de **259 000 entrées de texte** du jeu en français,
anglais et japonais (`game_text_search`).

## Comment interroger, dans l'ordre

1. **Outils métier** — `azalee_search` puis `azalee_get` / `azalee_list`.
   Ils appliquent les règles du jeu (résolution des variantes, calcul des
   statistiques, traductions) que le SQL brut ne connaît pas.
2. **SQL** — `db_tables` → `db_schema` → `db_query`, pour un agrégat, une
   jointure ou une colonne que les outils n'exposent pas.
3. **Fichiers du jeu** — `cpk_search` puis `cpk_file` ; le CDN décode à la
   volée (texture `.g4tx` → PNG, modèle `.g4md` → GLB texturé, `cfg.bin` →
   JSON).

## Pièges de modélisation

- **`inagle_skills` : `category_id` et `element_id` sont NULL** dans toute la
  base. Filtrer et regrouper sur les colonnes textuelles françaises
  `category` et `element` (voir `docs/wiki-filters.md`).
- Un personnage a plusieurs **variantes** (formes, tenues, versions
  événementielles). `azalee_get` résout dans l'ordre : slug canonique
  (`mark-evans`), slug de variante (`mark-evans-0x…`), identifiant de ligne.
- Les noms existent en trois langues et les identifiants internes sont des
  hash : quand une valeur ressemble à `0x3055CF22`, chercher sa traduction
  avec `azalee_get` sur la collection `text` ou avec `game_text_search`.
- Les statistiques affichées par le wiki sont **interpolées** selon le niveau
  (courbe niveau 1 → 30 → 50 → 99) : une valeur brute de la base n'est pas la
  valeur affichée en jeu.
