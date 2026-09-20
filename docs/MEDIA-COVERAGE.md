# Ce que le jeu contient, et ce que le web en montre — mesuré le 2026-09-20

Toutes les valeurs de cette page ont été relevées, aucune n'est citée. La commande qui les rend
est donnée à chaque fois ; elles se re-mesurent, elles ne se recopient pas.

Le VFS n'est PAS celui que `NIE_GAME_DIR` désigne par défaut dans un shell du dépôt — là, il
pointe sur le dépôt lui-même et `niers vfs stats` rend 156 876 fichiers et **0 CPK**, ce qui se
lit comme un corpus alors que c'est une arborescence de sources. L'installation réelle est celle
que déclare `deploy/systemd/nie-site.service` :

```sh
export NIE_GAME_DIR=/home/ubuntu/.local/share/Steam/iecode/inazuma
niers vfs stats            # 255 342 fichiers, 936 CPK
```

## Textures — la galerie couvre désormais le corpus entier

`niers vfs find ".g4tx"`, 54 203 fichiers, par arborescence :

| Arborescence | `.g4tx` |
| --- | ---: |
| `data/dx11/menu` | 41 191 |
| `data/dx11/chr` | 9 727 |
| `data/dx11/effect` | 1 995 |
| `data/dx11/map` | 1 240 |
| `data/dx11/font` | 34 |
| `data/dx11/event` | 16 |

La galerie partitionne désormais ce tableau : ses six domaines (`TEXTURE_DOMAINS`,
`apps/nie-web/src/pages/WebGallery.tsx`) portent ces six préfixes et rien d'autre, et
`WebGallery.test.ts` vérifie que leurs comptes **somment à 54 203** et que leurs préfixes sont
disjoints. Le corpus entier est donc atteignable.

Ce qui l'a été en dernier : les **4 620** textures qui ne sont ni sous `220_img` ni sous
`200_icon` — les 44 dossiers d'écran de `data/dx11/menu` (match 1 133, équipe 412, combat 398,
univers 367, victoire 281, Victory Road 239…), plus `font` 34 et `event` 16. Deux domaines de
premier rang nommés « Illustrations » et « Icônes » ne pouvaient pas les nommer, et aucune
combinaison de filtres ne les atteignait. `?domaine=illustrations` et `?domaine=icons` restent
des URL valides : `DOMAIN_ALIASES` les traduit en catégorie du domaine `menu`.

C'est aussi d'où vient le littéral figé dans
`packages/inacord-ui/src/components/wiki/wiki/MediaShell.tsx`. Il annonçait `54 203 fichiers`,
ce qui n'était pas un nombre de fichiers mais **de textures** ; l'étiquette a été corrigée le
2026-09-20 et la tuile dit maintenant `54 203 textures`. Le chiffre, lui, reste écrit à la main :
il se re-mesure par `niers vfs find --ext g4tx`, et le test de la galerie est ce qui le tient.

## Modèles — dix-sept familles, et le listage qui en servait trois à vide

`GET /api/v1/3d` déclare **dix-sept** familles. Mesure du 2026-09-20 sur le VFS de référence,
via un `nie-site` local branché sur un `nie-model-serve` local :

| Famille | Modèles | Famille | Modèles |
| --- | ---: | --- | ---: |
| perso (miroir, `verifie: false`) | 5 490 | map_ar | 576 |
| uniform | 1 022 | map_s | 1 092 |
| waza | 273 | map_w | 712 |
| item | 237 | map_k | 177 |
| keshin | 100 | map_b | 54 |
| armd | 89 | map_sky | 11 |
| animal | 2 | effect_battle | 473 |
| event | 14 | effect_event | 1 507 |
| | | menu | 1 688 |

Soit **8 027 modèles vérifiés** dans le VFS, plus les 5 490 codes déclarés par le miroir.

Deux choses ont été corrigées pour y arriver, et la première ne se voyait dans aucune réponse.

**Le listage ne descendait que d'un niveau.** `codes_vfs` lisait les sous-dossiers *directs* de
la racine d'une famille et y cherchait `<code>/<code>.g4mg`. Les pièces d'un stade vivent deux
niveaux plus bas (`s01g001/s01g001g02/s01g001g02.g4mg`) : `map_s` rendait donc **2 modèles sur
1 092**, `map_w` **1 sur 712** et `map_k` **0 sur 177** — trois familles servies vides, sans
erreur, sans trace. `codes_arbre` parcourt le sous-arbre entier (`IndexVfs::sous_arbre`, deux
recherches dichotomiques sur les chemins triés) et applique le même critère à toute profondeur.

**Un code de famille arborescente est un chemin.** Il est encodé avec `-` plutôt que `/`, parce
que l'URL du catalogue est `/model/{famille}/{code}.glb` et qu'un `/` y ouvrirait un segment de
plus, donc une route de plus. Le codage est sans ambiguïté : aucun des 3 705 dossiers de modèle
des quatre arbres ne contient de tiret (vérifié sur l'index).

Côté amont, les quatre arbres partagent **une** route, `GET /model-tree/<racine>/<rel>.glb`
(`map`, `effect`, `menu`, `event`). Ils ont exactement la même disposition —
`data/common/<rel>/<base>.g4mg` et sa texture voisine `data/dx11/<rel>/<base>.g4tx` — et ne
diffèrent que par là : une map prend le `.g4tx` du *stade*, partagé par tout un groupe.
`/model-map/<rel>.glb` reste servi comme alias. Échantillon du 2026-09-20 : **48 assemblages sur
48**, six par famille, du quad de 1 172 octets au bâtiment de 4,6 Mio.

Deux réserves mesurées, qui valent mieux qu'une promesse : un objet 3D de menu est le plus
souvent un **billboard** — `00_soccer/soccer00/soccer00_01` rend 1 mesh, 1 primitive, 8 sommets,
0 image — et **17 modèles de menu localisés** (`…/soccer10_05/fr/soccer10_05.g4mg`) restent hors
catalogue, leur dossier ne portant pas le nom de leur `.g4mg`.

`niers vfs find ".g4md"`, 8 956 fichiers, par famille :

| Famille | `.g4md` |
| --- | ---: |
| `data/common/chr/_face` | 6 067 |
| `data/common/chr/_uniform` | 2 622 |
| `data/common/chr/_armd` | 144 |
| `data/common/chr/_item` | 88 |
| `data/common/chr/_test` | 12 |
| `data/common/map/s` | 9 |
| `data/common/chr/_waza` | 5 |
| `data/common/chr/_keshin` | 5 |
| `data/common/map/w` | 2 |
| `data/common/chr/_animal` | 1 |

`niers vfs find --ext g4mg`, 15 876 fichiers, par arbre : `chr` 9 542, `map` 2 629,
`effect` 1 986, `menu` 1 705, `event` 14. Les quatre derniers sont ceux que `/model-tree` sert.

Restent hors catalogue les **6 067 visages** de `_face`, qui ne sont pas des modèles autonomes :
c'est `chara_model`/`chara_parts` qui les relie à un personnage, et `/model-full` les assemble
déjà par ce chemin.

## Animations — le décodeur existe, l'export ne les écrit pas

`GET /model/perso/c01000010.glb` rend 3 210 944 octets contenant 1 `skin`, 167 nœuds,
11 matériaux, 36 images — et **0 `animations`**.

Le mouvement, lui, est décodé depuis longtemps :

- `crates/engine/nie-formats/src/g4mt.rs` (1 206 lignes) rend `DecodedMotionClip` →
  `DecodedMotionTrack { bone_index, keyframes }` → `DecodedMotionKeyframe { time_seconds, pose }`,
  avec résolution des cibles par CRC-32 (`resolve_targets`).
- `GET /api/v1/motion/clips/<chemin>` rend déjà la table des clips : nom, `start_frame`,
  `end_frame`, `frame_count`, `fps`, `additive`, `target_count`.

Le viewer n'a donc rien à réimplémenter : glTF sait jouer des animations nativement. Ce qui
manque est l'écriture des pistes dans le GLB, côté `nie-model-serve`.

Attention au volume réel : seuls **71 `.g4mt`** sont des fichiers nus ; le mouvement vit dans les
**45 591 `.g4pk`**, ce que `motion/clips` reflète en nommant l'archive porteuse.

## Conversion et téléchargement — servis, jamais appelés

`GET /api/v1/export/formats/<chemin>` déclare les formats par fichier, `available` et
`unavailableReason` compris ; `GET /api/v1/export/file/<chemin>?format=png` rend les octets
convertis (vérifié sur un `.g4tx` : PNG 308×180 RGBA, 126 006 octets). Sans `format`, la réponse
est le fichier brut.

## Les fiches du wiki — treize cartes sans adresse, et pourquoi

Relevé le 2026-09-20 : `packages/inacord-ui/src/components/wiki/` porte **18 composants
`*Card`/`*Detail`**, et **5** seulement étaient rendus par une route servie (`AuraCard`,
`GalleryCard`, `ItemCard`, `MoveCard`, `TacticCard`, tous par `GameDataView`). `StadiumCard`
existait en double : le partagé n'était importé par personne, et `GameDataView` rendait une copie
locale.

Ce n'était pas de l'abandon. Six cartes avaient été écrites contre des routes `/api/v1/wiki/*`
qui répondaient **`503 Wiki resource unavailable` en production**, parce que le miroir range ses
entiers en TEXT et que `row.get::<_, i64>` rendait `InvalidColumnType` (cf.
`nie_wiki::mirror::entier_souple`). Neuf routes ont été réparées, chacune vérifiée par HTTP
contre `var/mirror.sqlite` :

| Route | Lignes | Route | Lignes |
| --- | ---: | --- | ---: |
| `/api/v1/wiki/auras` | 460 | `/api/v1/wiki/coaches` | 102 |
| `/api/v1/wiki/tactics` | 81 | `/api/v1/wiki/costumes` | 577 |
| `/api/v1/wiki/drops` | 98 | `/api/v1/wiki/invocation` | 30 |
| `/api/v1/wiki/stadiums` | 81 | `/api/v1/wiki/quests` | 182 |
| | | `/api/v1/wiki/shops` | 15 |

`/wiki` monte **neuf** de ces familles sur leurs cartes existantes — jamais une réécriture, et par
l'adaptateur `desktop/components/wiki/` quand il en existe un, puisque c'est lui qui sait résoudre
une image dans le VFS.

Deux familles restent volontairement dehors. `DropsCard` décrit un butin d'OBJET
(`win_treasure`/`item_emission`) là où `/api/v1/wiki/drops` rend des **bonus passifs par équipe** :
les brancher l'un sur l'autre remplirait la carte de champs vides, ce qui se lit comme une donnée
manquante et non comme un modèle qui ne s'applique pas. `/trophies` (347 lignes) n'en avait aucune ; elle en a une
depuis le 2026-09-20 (`TrophyCard`, neuvième onglet), et la page monte donc **neuf** familles.
La carte n'est pas un lien : un trophée n'a pas de route de détail, et pointer vers une page
qui n'existe pas se lit comme un défaut de navigation. La description est facultative parce
que le miroir écrit littéralement `\N` pour une absence — l'hôte l'efface, la carte rend le
nom seul plutôt qu'une ligne vide.

## L'autorité de l'interface

`data/menu/` porte **47 captures** du jeu réel, suivies par git. Une reconstruction d'écran se
compare à elles, pas à une idée de ce que l'écran devrait montrer. `filters_bonus.png` décrit le
dialogue FILTRES de `chara_bank_filter_menu` : bande de neuf icônes-onglets, libellé de la
catégorie courante encadré des touches `W` et `C`, sections titrées, case maîtresse « Tout »,
une icône-sprite par ligne, libellé sur deux lignes, compteur de sélection (`13/13`), et le pied
`Tab` Réinitialiser / `Alt` Confirmer.

## Les familles de modèles 3D et ce que chacune reçoit — mesuré le 2026-09-20

Le catalogue expose **17 familles** (`Famille`, `crates/tools/nie-site/src/routes/modeles3d.rs:130`,
segment `?famille=`) ; l'assembleur, lui, n'en connaît que **deux régimes**. Le tableau dit
lequel, parce que la différence explique la plupart des modèles ternes ou nus.

| Famille | Discriminant | Textures | Squelette | Cartes auxiliaires |
| --- | --- | --- | --- | --- |
| `perso` | code en `c` (`nie-model-serve/src/main.rs:2355`) | liaison **par matériau** (`bind_piece_textures`, `main.rs:1326`) | oui (`main.rs:1264`) | oui (`main.rs:1459`) |
| `keshin` | code en `k` (`main.rs:2350`) | **un seul atlas** pour tout le modèle (`main.rs:1159`) | non | non |
| `armd` | code en `ka` (`main.rs:2345`) | un seul atlas (`main.rs:1176`) | non | non |
| `waza`, `item`, `animal`, `uniform` | `CHR_GENERIC_SUBS` (`main.rs:2364`) | un seul atlas sondé en `{c}`, `{c}_10`, `{c}_00` (`main.rs:2416`) | non | non |
| `map_*` | `RACINES_ARBRE` + `racine == "map"` (`main.rs:2459`, `:2518`) | liaison par matériau via l'index au `+0x43` (`main.rs:2482`) | non | non |
| `effect_*`, `menu`, `event` | `RACINES_ARBRE` (`main.rs:2459`) | atlas voisin du `.g4mg` | non | non |

Trois conséquences mesurées, à traiter comme des chantiers et non comme des propriétés :

1. **`resolve_texture_uris` ne résout RIEN** pour `Keshin | Armed | Generic` — elle rend une
   chaîne vide (`assemble.rs:928`). Ces familles ne tiennent que par la tentative d'atlas
   embarqué ; quand elle échoue, la route rend `to_glb()`, c'est-à-dire une géométrie **nue**
   (`main.rs:2438` pour les génériques, `:2590` pour les arbres, `:3201` pour `/model-edit`).
2. **Un atlas unique est appliqué à TOUTES les primitives du composant** (`comp_to_mat`,
   `assemble.rs:3819`). Un `waza` à plusieurs matériaux reçoit donc la même planche partout —
   exactement l'erreur que le régime `perso` a été écrit pour éviter.
3. **`uniform` sonde un nom qui n'existe pas.** Les conteneurs réels portent l'identifiant de la
   **tenue**, pas celui du modèle (`u000101/u117401_10.g4tx`), donc la sonde `{code}.g4tx` manque
   presque toujours et la famille sort en géométrie nue.

Deux surfaces d'assemblage ne sont **pas** exposées par `/api/v1/3d/modeles` : `/model-avatar/`
(le seul chemin non-`perso` qui remplit `aux_textures`) et `/model-edit/` (une pièce isolée).
