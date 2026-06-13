# Cartographie des données du jeu (VFS IEVR)

Inventaire **exhaustif** des 250 800 fichiers du VFS live (`iev:file:index`, redis db3 —
miroir des CPK sous `~/.local/share/Steam/iecode/inazuma/data/`). Objectif : savoir, dossier
par dossier et format par format, **ce que niers exploite déjà** et **ce qui reste à croiser**
pour renforcer le moteur et azalee.

Généré/recoupé le 2026-06-13. Source : `redis-cli -n 3 hkeys iev:file:index` + grep `nie-formats`.

## Vue d'ensemble

- **250 800** fichiers indexés.
- **232 323 (92,6 %)** dans un format déjà parsé **et** servi (g4tx, g4pk/g4pkm, g4mg/g4md,
  g4sk, audio acb/awb/adx/hca, usm, cfg.bin, **p3lip lip-sync**).
- **18 477 (7,4 %)** dans un format **non encore exploité** (détail plus bas).

## Dossiers de niveau 2 (`data/<root>/<groupe>`) par volume

| Fichiers | Dossier | Contenu | Statut niers |
|---:|---|---|---|
| 55 501 | `common/event` | scènes/cutscenes (texte, caméra g4cm, motion mevbin, g4pk d'effets) | partiel (texte ✓, caméra/motion ✗) |
| 43 701 | `common/text` | textes localisés ja/fr/en/de/es/it/pt/zh (cfg.bin) | ✓ parsé (cfgbin, skill/chara/item/event) |
| 40 158 | `dx11/menu` | UI : icônes, telop, atlas (g4tx) | ✓ servi (`/tex`, décodage g4tx→png) |
| 20 580 | `common/chr` | modèles perso/waza/keshin (g4md/g4mg/g4sk), motion | ✓ assemblé (`/model-*`) |
| 20 460 | `common/sound` | **lip-sync `.p3lip`** par langue (voix) | ✓ parsé + servi (`nie-formats::lip`, `/lip`) |
| 12 479 | `common/map` | maps : objets objbin, navmesh g4nv, modèles | ✗ (objbin/g4nv non lus) |
| 10 807 | `common/sound_asset` | voix/SE (acb/awb) | ✓ servi (`/audio`→WAV) |
| 9 810 | `common/event_cfg` | config d'events (son, séquences) | partiel (`snd` cfg.bin ✓) |
| 9 722 | `dx11/chr` | textures perso/waza (g4tx) | ✓ servi |
| 9 490 | `common/gamedata` | **tables de jeu** (cfg.bin) | ✓ porté (nie-data, 37+ familles) |
| 6 740 | `common/effect` | effets : ptlb, fxbin, objbin, pfxo | ✗ non exploité |
| 3 118 | `common/menu` | données menu (cfg.bin) | partiel |
| 2 869 | `dx11/shader` | shaders compilés (vfxo/pfxo/gfxo/cfxo) | ✗ non exploité |
| 2 352 | `dx11/map` | textures + collision `.col` map | partiel (tex ✓, col ✗) |
| 1 996 | `dx11/effect` | textures d'effets | ✓ (g4tx) |
| 616 | `common/script` | **scripts Lua/logique** (bin) | ✗ **non décompilé** |
| 104 | `common/property` | propriétés objets | ✗ |
| 94 + 94 | `common/movie` + `dx11/movie` | **vidéos `.usm`** (188) | ✓ démuxé (H.264→MP4) |
| 34 / 14 | `dx11/font` / `common/font` | polices | ✗ (non requis) |
| 10 | `common/craft` | artisanat (cfg.bin) | ✓ (nie-data craft) |
| 10 | `common/action` | tables d'action | partiel (nie-core action-ctrl) |

## Formats non exploités (le gap de 15,5 %)

| Count | Ext | Nature (déduite de l'emplacement) | Valeur pour le jeu jouable |
|---:|---|---|---|
| ~~20 357~~ | ~~`.p3lip`~~ | **lip-sync** voix — **✓ FAIT** : `nie-formats::lip` (visèmes datés) + route `/lip` | — |
| 11 920 | `.objbin` | objets de scène / lumières (`map/_light`, `effect`, `gamedata`) | moyenne — rendu de map, éclairage |
| 1 335 | `.vfxo` | shaders d'effet vertex (`dx11/shader`) | moyenne — rendu d'effets |
| 1 210 | `.g4cm` | **caméra de cutscene** (`event/<ev>/<ev>_camera.g4cm`) | **haute** — mise en scène des events |
| 1 143 | `.col` | **collision** de map (`dx11/map/.../<id>.col`) | **haute** — physique/déplacement |
| 1 113 | `.pfxo` | shaders pixel d'effet | moyenne |
| 655 | `.ptlb` | tables de particules (`effect/battle`) | moyenne — effets de hissatsu |
| 372 | `.fxbin` | binaire d'effet | moyenne |
| 328 | `.mevbin` | **motion-events** (anim liée à un code chr, `event`/`chr`) | haute — animation des cutscenes |
| 156 | `.g4nv` | **navmesh** (`common/map/<id>.g4nv`) | haute — pathfinding IA |
| 63 | `.g4mt` | matériau (`g4material`) | basse |
| 39 | `.clobin` | **cloth/tissu** (physique de vêtement) | basse |
| 35 | `.g4ma` | animation/matériau | basse |

## Croisements prioritaires (exploiter → renforcer niers + azalee)

Classés par rapport valeur/effort, ancrés sur la finalité « jeu jouable WASM » + « nourrir azalee ».

1. ~~**`.p3lip` lip-sync** (20 357)~~ — **✓ FAIT** : `nie-formats::lip::parse` (magic/durée/visèmes
   datés, validé byte-à-byte sur échantillons réels) + route serve `/lip/<vfs>.json`. Reste à
   croiser côté azalee (timeline voix↔texte↔visèmes) et à piloter les morphs faciaux en jeu.
2. **`.g4cm` caméra** (1 210) — parser les courbes de caméra d'event ; rejoue la mise en scène des
   cutscenes (croisement avec les dialogues déjà cartographiés par event).
3. **`.col` collision** (1 143) — meshes de collision de map : prérequis du déplacement/physique du
   joueur sur le terrain et hors-match.
4. **`.g4nv` navmesh** (156) — pathfinding des PNJ/IA hors-match.
5. **`.mevbin` motion-events** (328) — déclencheurs d'animation indexés par code chr (croisement
   direct avec le système de modèles déjà assemblés).
6. **`common/script` (Lua)** (616) — la logique d'event/quête ; décompilation = scénarisation réelle.
7. **`.ptlb`/`.fxbin`/`.objbin` effets & scène** — rendu visuel des hissatsu et des maps.

## Ce qui est déjà fortement exploité (rappel)

- **Textures** g4tx → png live + in-browser WASM (`/tex`, `g4tx_to_png`).
- **Modèles** g4md+g4mg(+g4sk) → GLB assemblé live + in-browser (`/model-*`, `model_to_glb`).
- **Audio** acb/awb/adx/hca → WAV live + in-browser (`/audio`, `audio_to_wav`).
- **Vidéo** usm → MP4 (démuxeur Sofdec2).
- **Archives** g4pk/g4pkm → listing + extraction in-browser (`g4pk_parse_json`).
- **Tables** cfg.bin (RDBN) → 37+ familles typées (nie-data) + `/typed` JSON + UI azalee.
- **Texte** localisé → skill/chara/item/event, dialogues trilingues (cf. dossier Aphrody).

> Maintenir cette carte à jour quand un format passe de ✗ à ✓ (et refléter le % d'exploitation).
