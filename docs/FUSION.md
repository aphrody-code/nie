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
  ✓ extrait  66 tables, 165 244 lignes    var/miroir/inagle-2026-09-02T02-27-54.sqlite
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
`deploy/systemd/nie-miroir.{service,timer}` (04:10 UTC, le créneau de l'ancien
`azalee-mirror-sync`). Le script refuse de basculer sur un dump invalide : un dump vide laisse
l'ancien miroir en place, au lieu de faire répondre « aucun résultat » à tout le site.

`@niers/catalog` résout `var/mirror.sqlite` **en premier**, et retombe sur celui de `rg` s'il
n'existe pas encore : les deux dépôts peuvent coexister pendant la bascule.

## Ce qui reste dehors, et pourquoi

* **Le site `rg/apps/azalee` et ses services de production** (`azalee-web`, `azalee-api`,
  `rg-postgrest`, `rg-realtime`, `rg-storage`, `rg-cdn`, `cdn-variants`). Ce sont des services
  vivants servant un domaine public ; les déplacer casserait la production sans rien prouver. Ils
  consomment désormais les mêmes données, par le même miroir.
* **`rg/packages/azalee`** (99 Mo) — la couche web du wiki. Elle n'a de sens qu'avec le site.
* **`aphrody/`** — bibliothèques Material Design 3, sans rapport avec Inazuma Eleven.
* **Les autres services `bxc`** (`bxc.service`, les deux crawlers, `bxc-x-*`) rendent des
  services au-delà d'Inazuma Eleven : ils restent où ils sont.

## Bascule des services

| Service | État | Remplaçant |
|---|---|---|
| `azalee-mirror-sync.timer` | à désarmer | `nie-miroir.timer` (unités écrites, non installées) |
| `rg-cron.service` | **actif**, `WorkingDirectory=/home/ubuntu/rg/packages/cron` | le code est ici ; l'unité reste à écrire et à basculer |
| `bxc-wonderbot.service` | **actif**, `WorkingDirectory=/home/ubuntu/bxc` | `nie-wonderbot` |

Rien n'a encore été arrêté ni installé : le code est rapatrié et vérifié, la bascule est une
opération de production qui se fait sciemment, unité par unité, en vérifiant que la nouvelle
répond avant de désarmer l'ancienne. Un seul bot par jeton Discord — deux instances sur le même
jeton se battent et répondent en double.

## Vérifier

```bash
bun install                                   # depuis la racine, jamais dans un sous-paquet
bun test packages/nie-catalog                 # 13 cas, dont les jointures réelles
bun --bun packages/nie-catalog/src/cli.ts etat
bun --bun packages/nie-catalog/src/cli.ts personnage mark-evans-0x06E25622
```

Les tests qui exigent un gisement peuplé **s'annoncent quand ils se sautent** : un test muet qui
ne s'exécute pas est un faux vert.
