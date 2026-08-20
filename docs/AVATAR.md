# Éditeur d'avatar (`chara_edit`) — état du pilier

> Mesures de ce document : **2026-08-20**, relevées sur la machine (VPS), binaire `nie.exe`
> sha256 `b1fa04ea3658…` / 33 918 464 o, données de jeu `1.03.75.00`.
> Tout chiffre est régénérable par la commande citée en regard. Aucun n'est recopié d'un document.

L'éditeur d'avatar est l'écran de création de personnage d'*Inazuma Eleven: Victory Road*.
Le pilier couvre **la donnée** (les 16 listes du catalogue), **la résolution** (modèle 3D, icône,
libellé traduit pour chaque part), **le rendu** (assemblage 3D des pièces, layouts d'écran) et
**la façade** (l'éditeur jouable de `azalee`).

Série de travail : 12 commits consécutifs, `9b3ee6e` → `04656b8`.

---

## 1. Les sources — aucune ne se suffit

| Fichier | Ce qu'il apporte |
|---|---|
| `gamedata/character/chara_edit_1.03.75.00.cfg.bin` | les **16 listes** : parts, curseurs, couleurs, voix, personnalités, tenues, recettes de presets, code de partage |
| `gamedata/character/chara_edit_parts_type_config_1.03.75.00.cfg.bin` | modèles de base par morphologie (42 visages, 24 accessoires) |
| `chr/_face/20_EDIT/center.cfg.bin` | centre `(u, v, w, h)` de chaque texture de part dans l'atlas de visage — 5 centres |
| `chr/_face/20_EDIT/texPartsDefaultPose.cfg.bin` | pose par défaut : 201 translations, 200 échelles |
| `chr/_face/20_EDIT/editCharaMdlParts.cfg.bin` | règles de modèle : décalage de visage, oreilles masquées par les cheveux |
| `gamedata/menu/cfg/chara_edit_*_setting.cfg.bin` | **42 écrans** de l'éditeur (structure d'interface) |
| bytecode Lua (`nie_lua::bytecode`) | les **13 rubriques** de l'éditeur, dans l'ordre du jeu |
| `menu_text` | les libellés traduits (fr) |

Les trois `20_EDIT/` vivent **à côté des modèles**, pas dans `gamedata/` : la table de pose est
indexée par nom de ressource de modèle, pas par identifiant de part.

## 2. Les trois familles de hachage — le nom des champs induit en erreur

Tout est CRC-32 (`nie_formats::cfgbin::crc32`), mais les cibles diffèrent :

- **`resourceName1` / `resourceName2`** → un **modèle 3D** du VFS.
  `hairF001` → `_hairF/hairF001.g4md` + `.g4mg`. C'est aussi la clé des tables de pose de `20_EDIT`.
- **`textureName`** → **pas** une texture de modèle, mais l'**icône d'interface** de la vignette
  dans la grille (`icon_ava_face06_004`), résolue par `hash_name` de `var/niers.sqlite`
  (source `vfs-ui`, cf. `niers seed-ui`).
- **`presetID`** d'une recette → le hash du nom d'une part de la catégorie « preset »
  (`preset_01_normal`). Le même identifiant est **à la fois** une vignette sélectionnable **et**
  une recette de 62 à 72 lignes.

Confondre les trois est la source d'erreur principale : `textureName` cherché dans les textures de
modèle ne résout jamais, et le taux d'icônes tombe à 0.

## 3. Le parseur — `crates/engine/nie-data/src/chara_edit.rs` (730 l.)

Branché sur le dispatch typé (`nie_data::typed`, commit `dedba2a`). Structures publiques :

| Structure | Rôle |
|---|---|
| `CharaEditPartsData` / `PartsInfo` | une part et sa catégorie (`face_setting_type`, `data_offset`, `data_count`) |
| `CharaEditPartsParamData` / `ParamInfo` | un curseur : `param_type`, `default`/`min`/`max`, `apply[8]` |
| `CharaEditPresetData` / `RecipeInfo` | une recette de preset : `recipe_type`, `recipe_no`, `bit_num`, `category*` |
| `CharaEditCodeInfo` | le **code de partage** : `code_char`, `num` |
| `CharaEditVoiceInfo` | voix : `chara_se_name`, `gender`, `personality`, `voice_type` |
| `CharaEditPersonalityInfo` | personnalité : `performance_type`, `personality_type`, `view_text_id` |
| `CharaEditFashionInfo` | tenue |
| `CharaEditPresetFileInfo` | avatar-fichier : `chara_id`, `id_string`, `view_no` |
| `CharaEditFaceTypeData` / `FaceTypeInfo` | modèle de base par morphologie : `nose_type`, `face_pattern_id[8]`, `resource[8]` |
| `CharaEditPartsBodyData` / `BodyInfo` | corps par `parts_type` |

Le motif `info` (offset + count) → `data` est celui de tout le format : chaque liste `*Info`
découpe une plage dans la liste `*Data` correspondante. Aucun index n'est deviné.

## 4. Le catalogue, chiffré — `niers avatar catalog`

```
502 parts, 20 catégories, 218 curseurs, 470 couleurs, 38 recettes (2704 lignes)
96 voix, 24 personnalités, 5 tenues, 31 avatars-fichiers
code de partage : 410 bits sur un alphabet de 64 caractères (86 emplacements)
modèles de base : 42 visages × morphologie, 24 accessoires
tables de 20_EDIT : 5 centres d'atlas, 201 translations, 200 échelles
résolu : 381/502 modèles dans le VFS, 493/502 icônes dans hash_name
```

### Les 20 catégories

| cat | parts | modèles | icônes | préfixe des ressources |
|---:|---:|---:|---:|---|
| 1 | 36 | 0 | 36 | `preset_0` |
| 2 | 6 | 0 | 6 | *(non dérivable)* |
| 3 | 1 | 1 | 0 | `face_00` |
| 4 | 98 | 53 | 98 | `hairF0` |
| 5 | 63 | 62 | 62 | `hairF0` |
| 6 | 72 | 72 | 72 | `eye_` |
| 7 | 49 | 49 | 49 | `pupil_` |
| 8 | 16 | 16 | 15 | `highlight_` |
| 9 | 7 | 0 | 7 | *(non dérivable)* |
| 10 | 23 | 23 | 23 | `mouth_` |
| 11 | 40 | 40 | 39 | `eyebrow_` |
| 12 | 6 | 6 | 6 | `ear00` |
| 13 | 35 | 35 | 34 | `face_` |
| 14 | 25 | 24 | 24 | `accessory0` |
| 16 | 2 | 0 | 2 | *(non dérivable)* |
| 17 | 13 | 0 | 13 | `edit_body_` |
| 18 | 3 | 0 | 0 | `加算胸` *(non traduit)* |
| 19 | 2 | 0 | 2 | `fashion_` |
| 20 | 2 | 0 | 2 | `fashion_` |
| 21 | 3 | 0 | 3 | `fashion_` |

**La catégorie 15 n'existe pas** dans les données — le trou est dans le fichier, pas dans le port.

Les libellés de catégorie ne sont pas inventés : ils sont dérivés du **plus long préfixe commun**
des noms de ressources de la catégorie. Trois catégories (2, 9, 16) n'ont pas de préfixe commun
exploitable et restent sans libellé dérivé.

### Les 13 rubriques (ordre du jeu, extraites du bytecode Lua — `96d3bfd`)

Échantillon de visage · Forme de visage · Couleur de peau · Coupe de cheveux · Yeux · Nez ·
Bouche · Sourcils · Oreilles · Extras · Stats de base · Personnalité · Voix

Le rapprochement **rubrique ↔ `faceSettingType`** (commit `2b3c82c`) se fait par proximité
lexicale stricte entre le nom de la rubrique et le préfixe de la catégorie. Il **n'est pas
confirmé côté binaire** (cf. §9).

## 5. Ce qui est outillé

### CLI — `niers avatar` (`crates/tools/nie-cli/src/avatar_cmd.rs`, 1 048 l.)

| Sous-commande | Effet |
|---|---|
| `catalog` | vue d'ensemble : 16 listes, catégories, taux de résolution |
| `parts [--category N] [--limit N]` | les parts d'une catégorie, modèle et icône résolus |
| `preset [<id>]` | les visages prédéfinis ; avec argument, la recette décodée |
| `export -o <fichier>` | le catalogue résolu complet en JSON (**856 064 o**) |
| `icons [-o <dir>] [--atlas-prefix …]` | localise les vignettes dans les atlas, les extrait en PNG |

### CLI — `niers icons` (`icons_cmd.rs`, 180 l.)

Index des icônes du jeu, **sans les matérialiser** : plus de 5 000 conteneurs sous
`menu/200_icon/` (dont 4 195 pour les seuls portraits), soit des dizaines de gigaoctets si on les
décodait tous — alors que `nie-model-serve` sait déjà décoder n'importe quelle région à la demande.

- `index` → `{ "<nom>": { atlas, x, y, w, h } }` — **`var/icons-index.json`, 11,8 Mio**
- `extract --prefix <p>` → PNG dans le dump servi en statique par le CDN
- `dict` → fusionne `data/re/menu-crc32-dictionary.json` (hachage → nom) et
  `data/re/menu-region-index.json` (nom → atlas), les deux dictionnaires que le rendu de menu
  consomme déjà. **215 477 entrées, 0 collision** après balayage de `menu/` puis `font/`.

### Service — `nie-model-serve` (port 8790)

| Route | État |
|---|---|
| `/avatar/catalog.json` | **200**, 856 Ko |
| `/avatar/layout/<ecran>.json` | 200 pour les 42 écrans exportés |
| `/avatar/icon/<nom>.png` | atlas **dérivé du nom** (`icon_ava_face05_001` → `icon_ava_face05.g4tx`), aucun index à maintenir |
| `/model-avatar/<pièces>.glb` | assemblage 3D des pièces (`nie_formats::assemble`) |
| `/ui/theme.json` | **200**, 6 765 o — palette `FONT_COLOR` du jeu |
| `/ui/text.png` | rendu de texte avec la vraie police |

### Façade — `azalee` `/avatar` (**200** en production)

`app/avatar/` : 2 870 lignes sur 10 fichiers — `Editeur.tsx` (590), `panneaux.tsx` (842),
`ui.tsx` (500), `types.ts`, `structure.ts`, `libelles.ts`, `LayoutRender.tsx`, `Modele3D.tsx`,
`page.tsx`, `actions.ts`.

## 6. Le rendu d'écran

- **42 fichiers** `chara_edit_*_setting.cfg.bin` dans `gamedata/menu/cfg` (menu principal, parts,
  couleurs 10×4 / 12×5 / 13×5 déclinées par organe, listes, recettes, modèle, statut, voix).
- **42 layouts exportés** dans `var/avatar-ui/layouts/`, produits par
  `nie-game --menu <ecran> --from-setting --runtime --export-layout`.
  Canvas 1280×720, positions issues des **points d'attache** `CMenuAttachLocator`
  (`nie_formats::menu::attach_slots`) — donc **des fichiers du jeu**, pas d'un relevé sur capture.
  `chara_edit_menu` : 18 objets. `chara_edit_parts_menu` : 63 objets.
- **Rectangles de sprite résolus : 950** (2026-08-20), contre 13 auparavant, et **plus aucun
  hachage de région non résolu** (937 occurrences réparées). Deux causes, corrigées séparément :
  le dictionnaire hachage → nom ignorait les noms qui vivent dans les `.g4tx` (`niers icons dict`),
  et la résolution ne voyait que les sous-textures alors qu'une icône peut être une **texture
  entière** du conteneur (`g4tx::named_rect`). Sans elles, ces sprites étaient blités en atlas
  complet — 2640×1364 à la place d'une icône de 56×56.
- **18 captures de référence** du vrai jeu dans `var/refs-avatar/`, 2560×1440.
- **491 icônes** extraites dans `var/avatar-icons/`.
- `var/avatar-ui/png/` est **vide** : aucun écran de l'éditeur n'a encore été composé en image.

## 7. Vérifications

| Vérification | Résultat (2026-08-20) |
|---|---|
| `cargo clippy -p nie-cli --bins --tests` | **0 warning** |
| `cargo test -p nie-data --test chara_edit_golden` | **4/4** — `fixture_catalogue_complet`, `fixture_parts_avatar`, `golden_catalogue_reel`, `golden_dump_reel` |
| `cargo test -p nie-data --test font_color_golden` | **2/2** — `fixture_palette`, `golden_palette_reelle` |

Les golden « réels » s'exécutent (corpus présent) — ce ne sont pas des sauts silencieux.

## 8. Travail non commité

`crates/tools/nie-cli/src/main.rs` (+13 l.) : le **câblage de `niers icons`**.
`icons_cmd.rs` a été commité dans `cf19cfb` **sans son `mod icons_cmd;`** — dans l'arbre commité le
fichier n'est donc pas compilé et la commande n'existe pas. Le diff local le répare (module,
variante `Cmd::Icons`, dispatch). Il compile et ne produit aucun warning.

## 9. Ce qui n'est pas prouvé

Trois affirmations du pilier reposent sur autre chose qu'un fichier du jeu. Elles sont utilisables
mais ne doivent jamais être présentées comme acquises :

1. **Ordre du radar de statistiques** (`STATS_RADAR`, commit `04656b8`) — les 7 axes (Frappe,
   Contrôle, Pression, Physique, Agilité, Intelligence, Technique) sont ordonnés d'après une
   **capture d'écran**, pas d'après un fichier de l'éditeur. C'est la seule liste du module dans ce
   cas ; le code le signale lui-même. Elle est en production dans le catalogue.
2. **Codec du code de partage** — la *géométrie* est mesurée (410 bits, alphabet de 64 caractères,
   86 emplacements) ; l'**encodage** ne l'est pas. Aucun code n'a été produit ni relu.
3. **Rubrique ↔ `faceSettingType`** — rapprochement lexical strict, jamais confirmé sur le binaire.

## 10. Les trous

| Trou | Chiffre |
|---|---|
| Parts sans modèle 3D | **121/502** — catégories 1, 2, 9, 16, 17, 18, 19, 20, 21 à **0 modèle** |
| Parts sans icône | 9/502 |
| Catégories sans libellé dérivable | 3 (2, 9, 16) |
| Catégorie 18 | préfixe `加算胸` non traduit |
| Shaders `chr_edit_toon*` | **97 fichiers, 1 419,7 Kio** — identifiés par nom, **DXBC jamais désassemblé** : la composition matérielle de l'avatar n'est pas reproduite |
| Écrans composés en image | **0/42** |

Les catégories à 0 modèle sont presets / curseurs de corps / tenues : soit elles ne portent pas de
`.g4md` (recettes pures), soit leur nom de ressource ne se résout pas comme les autres familles.
La question n'est pas tranchée — c'est le seul écart qui bloque un avatar complet côté
`/model-avatar/`.

## 11. La mesure pixel-perfect — état du backbone

Le gate de rendu existe : `crates/engine/nie-game/tests/menu_render_gate.rs` (pilier D1.f),
15 tests, SSIM implémenté sur place (fenêtres 8×8, luma, sans dépendance externe).
Exécuté le 2026-08-20 : **13 passés, 2 ignorés** (VFS de référence), 93,9 s.

Deux étages :

1. **Déterminisme** — deux rendus du même écran doivent être **octet-identiques**. *Hard gate*, acquis.
2. **SSIM vs capture réelle** — informatif + plancher de non-régression. Références actuelles :
   `start.png` (title02) et `menu.png` (mainmenu01), 2560×1440 → 1280×720.

| Écran | Voie | Baseline | Plancher |
|---|---|---:|---:|
| `title02` vs `start.png` | rendu direct | 0,2511 | 0,24 |
| `mainmenu01` vs `menu.png` | rendu direct | — | 0,003 |
| `mainmenu01` | compose-runtime | 0,4059 | 0,39 |
| `mainmenu01` | via `menu_setting` (placement `attach_slots`) | **0,6227** | 0,60 |

La progression 0,0011 → 0,004 → 0,4059 → **0,6227** est celle du **placement** : elle est venue du
reverse des `CMenuAttachLocator`, pas d'un travail sur les pixels. C'est le meilleur score du
dépôt, et c'est le point de départ réaliste pour un écran de l'éditeur.

**Aucun écran `chara_edit` n'est dans ce gate.** Les 18 captures de `var/refs-avatar/` ne sont
adossées à aucun test : elles ont servi de référence visuelle, jamais de référence mesurée.

> **Rappel de doctrine** : « pixel-perfect » est le **nom d'une cible**, pas un état atteint.
> Le byte-exact du dépôt porte sur les **données**, jamais sur les pixels.

---

## Régénérer chaque chiffre de ce document

```bash
niers avatar catalog                          # §4 — catalogue, catégories, rubriques, résolution
niers avatar export -o var/avatar-resolved.json
niers icons index                             # §5 — var/icons-index.json
cargo test -p nie-data --test chara_edit_golden --test font_color_golden   # §7
cargo test -p nie-game --test menu_render_gate                             # §11
ls data/common/gamedata/menu/cfg | grep '^chara_edit' | grep -c '\.cfg\.bin$'   # 42 écrans
ls var/avatar-ui/layouts | wc -l                                               # 42 layouts
ls var/refs-avatar | wc -l                                                     # 18 captures
```
