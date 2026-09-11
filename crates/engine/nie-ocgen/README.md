# nie-ocgen — la chaîne de génération 3D d'un personnage original

Un OC existe sous forme de dessins et de texte. Le jeu, lui, ne connaît que des documents
`cfg.bin` et des maillages `20_EDIT`. Ce crate est le chaînon entre les deux, et il est découpé
en étapes qui produisent chacune un fichier qu'un humain peut relire.

**Aucune image n'est générée.** Chaque couleur est le groupe dominant, en Oklab, d'un rectangle
qu'un humain a posé sur une planche de l'auteur ; chaque hash de slot est recopié d'un document
livré par le jeu. Rien n'est inventé, rien n'est synthétisé.

## Les étapes

| Étape | Entrée | Sortie |
|---|---|---|
| [`sources`](src/sources.rs) | dumps `data/common/`, `data/oc/<slug>/source/` | tables de l'éditeur, planches décodées |
| [`palette`](src/palette.rs) | planches + régions déclarées | couleurs mesurées, avec leur provenance |
| [`morphology`](src/morphology.rs) | les 16 `mdl_editpreview_avatar_*` | un modèle de départ |
| [`recipe`](src/recipe.rs) | modèle de départ + mesures + liaisons | un document `CHARA_EDIT_PARAM` |
| [`plan`](src/plan.rs) | le document + le checkout | ce qui manque encore pour assembler un maillage |

## Ce que le crate affirme

Que le document émis est **au format du jeu**. [`param`](src/param.rs) relit les 33 documents
`CHARA_EDIT_PARAM` du dépôt — 16 presets `mdl_edit_avatar*`, 16 morphologies
`mdl_editpreview_avatar*`, le gabarit de sauvegarde `edit_parameter` — et les réémet **à
l'identique**. C'est ce que vérifie `tests/format_roundtrip.rs`, et c'est la seule affirmation de
ce module : il ne fabrique jamais un hash de slot.

Que chaque changement est justifié. Le rapport d'exécution liste, pour chaque valeur écrite, la
planche, le rectangle, le pourcentage du groupe dominant et le nombre de pixels retenus.

## Ce qu'il n'affirme pas

Qu'un personnage rend, ressemble à ses planches, ou se charge dans le jeu. **Aucun maillage n'est
assemblé ici** : l'assemblage a besoin des archives `20_EDIT`, et [`plan`](src/plan.rs) signale
leur absence au lieu d'y substituer quoi que ce soit.

## Comment on lie un rôle à un slot

Les slots de couleur sont des hashes dont le dépôt n'a pas retrouvé les préimages. On ne peut donc
ni les nommer ni deviner lequel est la peau. La liaison est donc **déclarée** dans la recette, et
`ocgen slots` est l'évidence sur laquelle on la déclare :

```bash
nie-ocgen slots
```

```
17 documents inspectés, 3 slots de couleur
     -94281841  221 lignes  17 documents  #ab876d #ab8b74 #d2a697 #e4ad6d …
   -1640576332  153 lignes  17 documents  #000000 #1f62a0 #222222 #532900 …
    -795152863  153 lignes  17 documents  #000000 #0a4552 #212121 #292929 …
```

Le premier slot porte, dans chacun des 17 documents, un teint clair et chaud différent : c'est le
slot de peau, et c'est le relevé qui le dit, pas une supposition.

## Un piège déjà payé

**Le premier rejet de fond était générique** — « clair et peu saturé, donc c'est du papier ». Il a
mangé la chevelure la plus pâle d'Astro Lor, qui se tient à 0,017 d'Oklab du papier, et la sonde a
alors rendu le trait d'encre. Le fond est désormais **mesuré sur les coins de chaque planche** et
le rejet est un rayon autour de cette couleur-là. Effet mesuré : `hair_pale` est passé de
`#1c150d` à 32 % à `#ffede3` à 96 %, et la peau de 42 % à 99 % — l'ancienne règle mangeait aussi
la moitié éclairée du corps.

## Du iecode au fichier

`t2b_to_iecode_json` existait ; **son inverse, non**. Tout ce que le dépôt produit sortait donc en
JSON, sans chemin vers un fichier. `nie_formats::cfgbin::encode_iecode_t2b` le fournit, et
`nie-ocgen` ne l'utilise qu'après avoir **relu ses propres octets** : un `cfg.bin` que le dépôt ne
sait pas redécoder à l'identique n'est jamais écrit.

Deux pièges que ce chemin ferme, trouvés en écrivant son test :

- `nie_explore::bridge::json_to_t2b_entries` inverse `t2b_to_json`, **pas** la forme iecode : il
  aurait écrit `CHARA_EDIT_PARAM_0` dans la table de clés au lieu de `CHARA_EDIT_PARAM`.
- Un conteneur T2B se reconnaît à son **nom** (`_BEG`, `_BEGIN`, `PTREE`). Un parent nommé
  autrement voyait ses enfants disparaître en silence ; c'est refusé maintenant.

Ce que cela ne dit pas : `encode_t2b` rogne encore face aux fichiers du jeu (4/152 octet-identiques
sur le corpus `chara_`). Un fichier produit ici se relit, il n'est pas prouvé chargeable.

## Icônes de portrait

Le seul asset cœur qu'aucun verrou ne bloque. La référence mesurée porte deux sous-textures
256×256 ; ce qui les distingue dans le jeu n'est **pas** mesuré, donc chaque slot reçoit son propre
cadrage déclaré plutôt qu'une image écrite deux fois. Le conteneur est reparsé, puis chaque
sous-texture est **redécodée en PNG** — une structure valide n'est pas la preuve que les bons
pixels sont dedans, et cette dernière-là demande des yeux.

Le payload par défaut est du BGRA8 non compressé, quatre fois le poids du fichier mesuré. Le BC7
(le format du jeu) est derrière la feature `bc7` : `intel_tex_2` ne livre ses noyaux ISPC que pour
MSVC, et le link échoue sur la cible `windows-gnu`.

## Commandes

```bash
nie-ocgen morphologies              # les 16 documents de départ, leur body type, leurs traits
nie-ocgen slots                     # le relevé des slots de couleur, l'évidence des liaisons
nie-ocgen measure astro-lor         # les couleurs, sans rien générer
nie-ocgen run astro-lor             # la chaîne complète → var/ocgen/ (JSON + cfg.bin)
nie-ocgen icons astro-lor           # les conteneurs G4TX de portrait + leurs PNG relus
nie-ocgen encode <dossier> --out X  # tout iecode *.cfg.bin.json → cfg.bin
```

`niers ocgen <sous-commande>` fait exactement la même chose : les deux surfaces appellent
[`cli::run`](src/cli.rs). La logique reste dans la bibliothèque — une deuxième implémentation
finirait par diverger, et ce dépôt l'a déjà payé sur keeper, menu et match-sim.
