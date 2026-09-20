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

## Textures — la galerie en montre moins du tiers

`niers vfs find ".g4tx"`, 54 203 fichiers, par arborescence :

| Arborescence | `.g4tx` |
| --- | ---: |
| `data/dx11/menu` | 41 191 |
| `data/dx11/chr` | 9 727 |
| `data/dx11/effect` | 1 995 |
| `data/dx11/map` | 1 240 |
| `data/dx11/font` | 34 |
| `data/dx11/event` | 16 |

La galerie ne liste que `data/dx11/menu/220_img/` : **17 085 fichiers, soit 32 % des textures du
jeu et 41 % des seules textures de menu**. Les textures de personnage, d'effet et de carte n'ont
aucune surface web.

C'est aussi d'où vient le littéral `"54 203 fichiers"` figé dans
`packages/inacord-ui/src/components/wiki/wiki/MediaShell.tsx` : ce n'est pas un nombre de
fichiers, c'est le nombre de **textures**, affiché sous une autre étiquette.

## Modèles — le catalogue expose six familles, le VFS en porte bien plus

`GET /api/v1/3d` déclare six familles, 6 191 modèles en tout : perso 5 490 (source « miroir »,
`verifie: false`), waza 273, item 237, keshin 100, armd 89, animal 2.

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

`niers vfs find ".g4mg"`, 15 876 fichiers, ajoute des domaines que le catalogue n'a pas du tout :
`effect/event` 1 507, `map/s` 1 092, `map/w` 712, `map/ar` 576, `effect/battle` 473,
`menu/00_soccer` 301, `menu/102_team` 164, `menu/10_win` 145, `map/k` 177.

Autrement dit : **aucune carte, aucun effet et aucun objet 3D de menu n'est atteignable**, et les
6 067 visages et 2 622 tenues — les pièces dont un personnage est assemblé — ne sont pas
parcourables en tant que telles.

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

## L'autorité de l'interface

`data/menu/` porte **47 captures** du jeu réel, suivies par git. Une reconstruction d'écran se
compare à elles, pas à une idée de ce que l'écran devrait montrer. `filters_bonus.png` décrit le
dialogue FILTRES de `chara_bank_filter_menu` : bande de neuf icônes-onglets, libellé de la
catégorie courante encadré des touches `W` et `C`, sections titrées, case maîtresse « Tout »,
une icône-sprite par ligne, libellé sur deux lignes, compteur de sélection (`13/13`), et le pied
`Tab` Réinitialiser / `Alt` Confirmer.
