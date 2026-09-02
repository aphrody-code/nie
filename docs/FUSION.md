# Fusion — tout ce qui touche Inazuma Eleven vit dans ce dépôt

Le travail était réparti sur quatre dépôts et une douzaine de services. Un même personnage
existait quatre fois : une fiche dans la base du wiki, des fichiers dans le VFS, des chaînes dans
le binaire reversé, un épisode dans le catalogue de la série. Rien ne reliait ces quatre
existences, et chaque outil réimplémentait sa moitié du chemin.

Ce document dit ce qui a été rapatrié, ce qui reste dehors et pourquoi, et où en est la bascule
des services.

## Ce qui est entré

| Origine | Devenu | Contenu |
|---|---|---|
| `rg/packages/inagle` | `packages/inagle` | le pipeline de données `inagle_*` — parsers, entités, push, 38 Mo d'entrées JSON |
| `rg/packages/inagle-cross` | `packages/inagle-cross` | les recoupements entre entités |
| `rg/packages/cron` | `packages/cron` | le démon de tâches, **dont `src/tasks/ie-crawl/`** (43 modules : X, RAG, zukan, Level-5, news, Reddit) |
| `rg/packages/db` `types` `auth` `config` | idem | ce dont `cron` et `inagle` dépendent |
| `rg/apps/azalee/scripts/ops/backup-supabase-to-sqlite.ts` | `scripts/donnees/dump-inagle-sqlite.ts` | le dump Postgres → SQLite |
| `rg/apps/azalee/scripts/ops/mirror-sync.sh` | `scripts/donnees/miroir-inagle.sh` | la republication du miroir, **vers `var/` d'ici** |
| `bxc/packages/{ietv,ietv-client,wonderbot,zukan}` | `packages/*` | le catalogue d'épisodes et son bot Discord |
| `bxc/` (app) | `apps/bxc` | l'automatisation de navigateur dont dépend le crawler |
| `~/.cache/ietv/episodes.db` | `data/anime/episodes.db` | 355 épisodes, 10 saisons, 3 chaînes |
| `rg/apps/azalee` | `apps/azalee` | le site du wiki (Next.js 15) — sans `.next` ni `data/` |
| `rg/packages/azalee` | `packages/azalee` | sa bibliothèque — sans `bin/azalee`, 79 Mo de binaire recompilable |
| `rg/packages/{ui,assets,mcp}` | `packages/*` | le socle d'interface, les images, le serveur MCP |
| *(généré depuis la base)* | `supabase/migrations/` | le schéma des 66 tables `inagle_*`, qui n'existait nulle part |
| *(nouveau)* | `packages/nie-catalog` | **la façade** — voir plus bas |

Le catalogue de versions de `rg` (183 entrées) a été fusionné dans celui d'ici. Deux conflits,
tranchés en faveur de niers pour ne pas faire cohabiter deux TypeScript :

* `typescript` : **5.9.3** (rg voulait `^6.0.3`) ;
* `@types/bun` : **1.3.14**.

`@aphrody-code/x` est mappé sur `npm:@aphrody/x` par les `overrides`, comme `bxc` et `zukan`
l'étaient déjà : le registre GitHub Packages exige un jeton que ce dépôt n'a pas à porter.

## La façade — `@niers/catalog`

C'est la pièce qui manquait, et la seule qui soit neuve. Elle résout les quatre gisements à
l'exécution, les interroge en lecture seule, et surtout **les joint** :

```bash
bun --bun packages/nie-catalog/src/cli.ts etat
```

```
Gisements Inazuma Eleven
  ✓ jeu      https://cdn.rosegriffon.fr
  ✓ extrait  66 tables, 165 244 lignes    var/miroir/inagle-2026-09-02T05-54-13.sqlite
  ✓ re       108 650 fonctions, 13 653 nommées    var/niers.sqlite
  ✓ anime    355 épisodes, 10 saisons, 3 chaînes  data/anime/episodes.db
```

Chaque jointure porte sa `confiance` : `cle` quand les deux gisements partagent un identifiant,
`prefixe` quand un chemin commence par un code, `texte` quand seul le nom relie — le cas du jeu et
de la série, qui n'ont aucune clé commune. Détail dans `packages/nie-catalog/README.md`.

## Le miroir a déménagé

Il vivait sous `rg/apps/azalee/data/backups/mirror.sqlite`. Tout ce qui n'était pas le site web
devait aller le chercher là-bas par un chemin absolu vers un autre dépôt.

Il est maintenant republié dans `var/miroir/` d'ici, avec `var/mirror.sqlite` comme lien daté
basculé atomiquement — `scripts/donnees/miroir-inagle.sh`, planifié par
`deploy/systemd/nie-miroir.{service,timer}` à 04:10 UTC, dix minutes après le créneau de
`azalee-mirror-sync`. Ces unités sont **installées et armées** depuis le 2026-09-02. Le script
refuse de basculer sur un dump invalide : un dump vide laisse l'ancien miroir en place, au lieu de
faire répondre « aucun résultat » à tout le site.

`@niers/catalog` résout `var/mirror.sqlite` **en premier**, et retombe sur celui de `rg` s'il
n'existe pas encore : les deux dépôts peuvent coexister pendant la bascule.

## Le schéma SQL, qui n'existait nulle part

Les 66 tables `inagle_*` avaient été créées par le pipeline de push, au fil des familles portées :
une base neuve n'était pas reconstructible, et rien ne disait quel schéma le code attend.
`supabase/migrations/` le pose — **généré depuis la base réelle**, pas écrit de mémoire.

Trois propriétés, mesurées :

* **rejouables à froid** — les quatre fichiers passent sur une base vide, dans l'ordre ;
* **idempotentes** — ils repassent sur la base qu'ils viennent de créer. Les séquences et les vues
  manquaient aux deux premiers essais ; c'est le rejeu qui l'a dit, pas la relecture ;
* **fidèles** — le schéma reconstruit porte **les 811 colonnes de la production, sans exception**
  (comparaison de `information_schema.columns`).

Les politiques RLS sont à part : elles interrogent `public.profiles` et `auth.uid()`, donc le
socle Supabase. Une base qui ne porte que les tables du jeu se construit sans lui — la migration
le détecte et passe son tour en le disant. Détail dans `supabase/README.md`.

## La bibliothèque du wiki lit maintenant le miroir du dépôt

`resolveMirrorPath()` ne cherchait que sous `apps/azalee/data/backups`. Elle remonte désormais
jusqu'au dossier qui porte `Cargo.toml` **et** `crates/` — la même signature que côté Rust, pour
qu'un `var/` homonyme rencontré en chemin ne soit jamais pris pour la racine — et y lit
`var/mirror.sqlite`. Vérifié : 6 166 personnages, 1 002 techniques, lus depuis le miroir d'ici.

## Ce qui reste dehors, et pourquoi

* **Les services de production qui servent le site** (`azalee-web`, `azalee-api`,
  `rg-postgrest`, `rg-realtime`, `rg-storage`, `rg-cdn`, `cdn-variants`) tournent encore depuis
  `rg`. Le **code** est ici ; ce sont les unités systemd qui restent à basculer, et c'est une
  opération de production, pas une copie de fichiers.
* **`rg/apps/website`** (le site vitrine Rose Griffon), **`rg/apps/bot`** (le bot Discord de la
  communauté) et **`rg/packages/patreon-bun`** ne portent pas sur Inazuma Eleven.
* **`aphrody/`** — bibliothèques Material Design 3, sans rapport avec Inazuma Eleven.
* **Les autres services `bxc`** (`bxc.service`, les deux crawlers, `bxc-x-*`) rendent des
  services au-delà d'Inazuma Eleven : ils restent où ils sont.

## Bascule des services

| Service | État | Remplaçant |
|---|---|---|
| `bxc-wonderbot.service` | **désarmé** | `niers-wonderbot.service`, **actif** — même guilde, même jeton |
| `nie-miroir.timer` | **installé et armé** depuis le 2026-09-02 | republie `var/mirror.sqlite` à 04:10 UTC |
| `azalee-mirror-sync.timer` | **toujours armé**, et il doit l'être | quatre services de production sont épinglés en dur sur le miroir de `rg` |
| `rg-cron.service` | **actif**, `WorkingDirectory=/home/ubuntu/rg/packages/cron` | `deploy/systemd/nie-cron.service` est **écrite et prête**, pas armée |
| `azalee-web`, `azalee-api`, `rg-mcp` | **actifs** depuis `rg` | à basculer une fois le site vérifié ici |

Deux bascules ont eu lieu, toutes deux vérifiées.

`bxc-wonderbot` est désarmé, `niers-wonderbot` tourne depuis ce dépôt, connecté à la même guilde
avec le même jeton (les secrets vivent dans `~/.config/niers/wonderbot.env`, en 600, hors du
dépôt). **Un seul bot par jeton Discord** : deux instances sur le même jeton se battent et
répondent en double — c'est la raison pour laquelle on désarme l'ancienne avant d'armer la
nouvelle, jamais l'inverse.

`nie-miroir` a été lancé à la main avant tout armement, et son résultat contrôlé par la façade :
`var/mirror.sqlite` pointe sur un instantané frais (165 244 lignes, `quick_check` à `ok`) et les
quatre gisements répondent. Son `DATABASE_URL` vient de `~/.config/niers/donnees.env`, en 600,
hors du dépôt.

**`azalee-mirror-sync` n'a pas été désarmé pour autant**, contrairement à ce qui était prévu :
`azalee-web`, `azalee-api`, `rg-mcp` et — c'est le plus surprenant — `nie-model-serve`, un service
de `niers`, lisent tous le miroir de `rg` par un chemin épinglé dans leur unité. Le désarmer sans
les repointer n'aurait rien cassé de visible : cela aurait figé les données du site sans aucun
signal. Les deux timers cohabitent donc, à dix minutes d'écart.

Les autres attendent : le code est rapatrié et vérifié, mais basculer `azalee-web` ou `rg-cron`
coupe un service public. Cela se fait unité par unité, en vérifiant que la nouvelle répond avant
de désarmer l'ancienne — sauf pour un service à instance unique, comme un bot ou le démon de cron,
où l'ordre s'inverse.

**L'état réel de la machine, unité par unité, avec ce qui reste dehors et pourquoi, vit dans
`docs/EXPLOITATION.md`.**

## Vérifier

```bash
bun install                                   # depuis la racine, jamais dans un sous-paquet
bun test packages/nie-catalog                 # 13 cas, dont les jointures réelles
bun --bun packages/nie-catalog/src/cli.ts etat
bun --bun packages/nie-catalog/src/cli.ts personnage mark-evans-0x06E25622
```

Les tests qui exigent un gisement peuplé **s'annoncent quand ils se sautent** : un test muet qui
ne s'exécute pas est un faux vert.
