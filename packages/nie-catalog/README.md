# `@niers/catalog`

La façade unique des données Inazuma Eleven du dépôt.

Quatre gisements vivaient côte à côte sans se parler, chacun avec son client, son chemin en dur
et sa façon de rater :

| Gisement | Ce qu'il porte | Où il vit maintenant |
|---|---|---|
| **jeu** | les fichiers du jeu, décodés à la volée | `nie-model-serve` — `NIE_CDN_URL`, défaut `https://cdn.rosegriffon.fr` |
| **extrait** | 66 tables `inagle_*` tirées de ces fichiers | `var/mirror.sqlite` (lien daté, republié par `scripts/donnees/miroir-inagle.sh`) |
| **re** | le reverse de `nie.exe` | `var/niers.sqlite` |
| **anime** | les épisodes de la série | `data/anime/episodes.db` |

Aucun n'est obligatoire : chacun se résout à `null` quand il est absent, et l'état le dit.

## Ce que ce paquet apporte

Les gisements savaient déjà répondre chacun sur son domaine. Aucun ne connaissait **le lien** —
et c'est ce lien qui manquait : le bot Discord répondait sur l'anime sans savoir que le jeu porte
le même personnage, le wiki servait des fiches sans savoir quelle cinématique les montre.

```ts
import { catalogue } from "@niers/catalog";

catalogue.etat();                    // ce que cette machine peut répondre
catalogue.chercher("Mark");          // les quatre gisements d'un seul appel
catalogue.personnage("mark-evans-0x06E25622");
catalogue.film("ev01_00050");        // la cinématique, son événement, ses répliques
catalogue.technique("whs00030");
```

En ligne de commande :

```bash
bun --bun packages/nie-catalog/src/cli.ts etat
bun --bun packages/nie-catalog/src/cli.ts cherche "Mark Evans"
bun --bun packages/nie-catalog/src/cli.ts personnage mark-evans-0x06E25622 --json
```

## Les jointures, et ce sur quoi elles reposent

Chaque rapprochement porte sa `confiance` — jamais implicite :

| Jointure | Charnière | `confiance` |
|---|---|---|
| personnage → ses fichiers | `internal_code` préfixe les chemins VFS (`/vfs/find`) | `prefixe` |
| cinématique → son événement | le nom de fichier **est** l'`event_id` | `cle` |
| technique → ses vidéos, son télop | `skill_id` | `cle` |
| donnée → le code qui la lit | `func_str_ref` cite la chaîne | `cle` |
| personnage → épisode de la série | le **nom**, rien d'autre | `texte` |

La dernière ligne est la raison d'être du champ : il n'existe aucune clé partagée entre le jeu et
la série. Le rapprochement est utile, il n'est pas un fait, et il ne doit jamais être présenté
comme tel.

## Pièges intégrés

* **`inagle_game_assets` n'est pas l'index des fichiers du jeu.** Ses 40 471 lignes sont presque
  toutes des PNG de menu (40 469 `png`, 2 `usm`) : ni modèles, ni banques sonores. Le seul index
  complet est celui du VFS, d'où l'aller-retour réseau de `fichiersDe`.
* **Un gisement présent peut être vide.** `etat()` mesure le contenu, pas l'existence du fichier :
  une base qui s'ouvre et rend zéro ligne est indiscernable d'une absence de données.
* **Le miroir est un lien symbolique daté**, rebasculé à chaque republication : on suit le lien,
  sinon on ouvre un instantané figé en croyant lire le courant.
* **Le binaire de référence du reverse est le `2`** (`#pdata`). Le `1` est un index Ghidra
  désaligné et figé ; citer ses adresses reviendrait à nommer des octets qui n'existent pas.
