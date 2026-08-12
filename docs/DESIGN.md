# niers — DESIGN : rendu pixel-perfect des écrans START et MENU

> Conception du **rendu pixel-perfect** des deux écrans de référence du repo — `start.png`
> (écran START « COMMENCER ») et `menu.png` (menu principal) — d'*Inazuma Eleven: Victory Road*
> (`nie.exe`, moteur Level-5 « Lives ») réimplémenté en Rust.
>
> Cap et état : `docs/PLAN.md` (pilier Rendu). Stack : `docs/STACK.md`.
> Boucle RE : `docs/RE.md`.
> Règle d'or : **aucun « FAIT » sans validation end-to-end sur le réel** (byte-exact vs
> iecode/inagle, pixel-exact vs capture du vrai jeu). Chaque affirmation factuelle cite un
> `file:line` réel.

## 0. Le problème en bref

Les couches de placement (ancêtre-fallback) et de sélection de texture non-dummy sont **faites** :
`title02` rend ses 18 sprites on-écran. Ce qui reste sépare « écran cartographié » de « écran rendu
identique » : le texte et la police, le driver de menu runtime, et la 3D in-menu.

Les deux écrans sont **données-présentes** dans le VFS et niers sait *composer* en CPU/GPU — le
rendu était **quasi vide** au départ parce qu'il manquait les couches **runtime** que le moteur
applique par-dessus les fichiers statiques :

- `title02` (start.png) : les objbin étaient placés à leur **bind pose** (souvent hors-écran), et le
  compositeur **piochait la 1ʳᵉ texture DDS de l'atlas — souvent un dummy 4×4** → sprites
  invisibles. Les deux couches correctives sont portées.
- `mainmenu01` (menu.png) : **22/31 objbin** rendus (textures co-localisées du Groupe B ;
  placement encore au centre, bloqué sur le DRIVER C++/Lua D1.c — cf. §5/§6). Les 8 panneaux du Groupe A (AVATAR / VICTOIRES /
  VOTRE ÉQUIPE) n'ont **ni g4pkm ni g4tx statiques** : ce sont des **compositions runtime** (primitives + modèles
  3D + texte Lua). Qualitativement plus dur que title02.
- La position visible **n'est PAS** un frame de keyframe : les slide-in **n'ont pas de keyframes dans
  les fichiers** (RE iecode). La solution réelle est une **heuristique d'ancêtre on-écran**
  (`GetMotionFinalPose`), un port borné — niers a déjà toutes les structures (`is_off_screen_1920`,
  `parent_index`, `world_bind_pose`).
- Le texte visible (COMMENCER, Deluxe Edition, légal…) est en grande partie **pré-rendu par locale**
  (textures `gtxt_*` / `title02_*` sous `<LG>/`) — pas besoin de moteur de police pour celui-là ; seul
  le texte **composé** (ver 6.0.2, 212, 99) exige une police (`font_def.g4tx` + métriques `.g4tg`,
  ce dernier non parsé, à reverser).
- `nie-game` **ne dépend même pas** de `nie-lua` : le `MenuState` (visible/sprite/texte/nombre) n'est
  jamais construit ni appliqué.
- Les `.png` de référence sont des **frames du vrai jeu en 2560×1440** (vérifié `file`) — c'est le
  golden de l'étage SSIM, mais l'égalité-octet vs screenshot est impossible (raster GPU ≠, contenu
  dynamique).

> **MISE À JOUR D'ÉTAT (2026-06-16, re-vérifiée).** Les couches **1 et 2 sont désormais FAITES**
> (le snapshot « 10/18 quasi vide » ci-dessous est superseded) : `nie-game --menu title02 --capture`
> rend **18/18 sprites ON-écran** (SSIM **0.2511** vs start.png) et `--menu main_menu --from-setting`
> rend les 13 layers à SSIM **0.4180** vs menu.png. Planchers de non-régression RELEVÉS en conséquence
> (`menu_render_gate` : title02 ≥0.24, compose-runtime ≥0.39, via-setting ≥0.40). Le gap restant n'est
> plus le placement grossier (couche 1) ni le dummy 4×4 (couche 2) mais : **branchement du texte
> dans le compositeur** (couche 4 — la primitive police/blitter est FAITE, cf. §7), **placement FIN
> par driver D1.c** et **modèles 3D** (couche 5).

| # | Couche | Effet visible | État (2026-06-16) |
|---|---|---|---|
| 1 | **Placement ancêtre-fallback** (`GetMotionFinalPose`) | éléments hors-écran (bind pose) | **FAIT** — `g4pkm_motion::motion_final_pose` câblé `menu.rs:63`, 7 tests verts ; raffinement fin = driver D1.c |
| 2 | **Sélection texture/atlas** (éviter le dummy 4×4) | sprites invisibles / mauvaise sous-image | **FAIT (non-dummy)** — `g4tx::select_main_texture` (D1.b) ; reste le fenêtrage UV sous-région |
| 3 | **Runtime Lua** (`OnOpenLayer` → MenuState) | visibilité/sprite/texte/nombre | **INCOMPLET** (driver branché en export-layout ; cmds connus, placement partiel) |
| 4 | **Texte + police** | aucun texte composé (ver, 212, 99) ; locale non substituée | **PRIMITIVE FAITE** — `font.rs` parse `font.cfg.bin` + `glyph_blitter`/`draw_text` (validé 'A'/'AW' pixel) ; exposé FFI+Bun (`renderText`). PAS de `.g4tg` à reverser. **Reste** : kerning, balises couleur, branchement compositeur (cf. §7) |
| 5 | **Modèles 3D in-menu** | AVATAR / VOTRE ÉQUIPE vides | **NON_FAIT** |
| 6 | **Blend par draw_type + GATE** | glows additifs faux | **FAIT(over)** — les 13 layers main_menu sont `drawType=0` (cf. §5) ; additif non requis ici |

## 1. Objectif et portée

**Cible littérale** : `nie-game --menu title02` et `nie-game --menu mainmenu01` produisent un
framebuffer **identique** à ce que `nie.exe` affiche — gate à deux étages (§10) : **égalité octet**
du RGBA8 dé-paddé (déterminisme/régression interne) puis **SSIM ≥ 0,99 / PSNR** vs capture du vrai jeu
(identité visuelle, hors régions dynamiques).

**Mapping vérifié (live, 2026-06-14)** : `start.png` ⇒ écran **`title02`** ; `menu.png` ⇒ écran
**`mainmenu01`**. Assets sous `data/dx11/menu/{50_title/title02,100_mainmenu/mainmenu01}/` ; les
objbin vivent à part sous `data/common/gamedata/menu/obj/` (`main.rs:1155`). (`title00` = écran
d'avertissement santé, **pas** start.png ; `mainmenu` large = 117 objbin couvrant des sous-écrans.)

**Hors scope** (suivis ailleurs) : le reste des écrans, les cinématiques, la scène de match. Ce
design est la **tête de pont** : les six couches ci-dessus, portées et gatées sur ces deux écrans,
généralisent à tout le système de menu.

## 2. Architecture cible du rendu d'un écran de menu

```
A. VFS              cpk_list.cfg.bin (AES) -> 254 202 fichiers logiques        [FAIT  vfs.rs]
   |
B. OBJET (quoi)     objbin -> MenuObject { g4pkm, g4tx, components[] }          [FAIT  objbin.rs]
   |                  Render(z,draw_type,cam) Animation(mot_open) Text Primitive
   |                  Collision Sound MeshVisible AttachLocator
   |
C. POSE VISIBLE     g4pkm -> G4SK bind pose (ou, souvent CACHE hors-ecran)      [FAIT  g4pkm.rs]
   (ou)         +   GetMotionFinalPose : fallback vers ancetre on-ecran         [NON_FAIT <- couche 1]
   |                -> ScreenTransform (px canvas 1280x720)                      [menu.rs::place_on_canvas]
   |
D. ETAT RUNTIME     Lua OnOpenLayer -> funcLuaMenuCommand                       [INCOMPLET <- couche 3]
   (mutations)        SetObjectVisible / SetSprite(texHash,frame) / SetText / SetNumber ...
   |                -> MenuState { layer->object-> {visible, sprite, text, number} }  [nie-lua::MenuState]
   |
E. CONTENU          g4tx : choisir la BONNE texture (pas le dummy) + region UV  [INCOMPLET <- couche 2]
   (pixels)     +   texte pre-rendu <LG> (gtxt_) OU compose (police g4tg)       [INCOMPLET <- couche 4]
   |            +   modele 3D (assemble.rs) -> vignette (camera, pose)          [NON_FAIT  <- couche 5]
   |
F. COMPOSITION      tri draw_priority + blend par draw_type (over / additif)    [FAIT(over)/INCOMPLET(add)]
   |                CPU (menu.rs::compose) ou GPU (nie-game cmd_menu_gpu)        [couche 6]
   |
G. GATE             egalite octet (regression) -> SSIM >= 0,99 vs vrai jeu      [INCOMPLET <- couche 6]
```

**Principe directeur** (`docs/STACK.md`) : chaque couche transporte *exactement* ce que le décompilé
produit — aucune dépendance qui réinjecte son propre raster/mixeur/ordre. La couche D (Lua) n'est pas
optionnelle : elle décide *quels* objets sont visibles, *quel* sprite/frame et *quel* texte/nombre ils
portent (212 victoires, niveau 99, icône de chaque tuile), et **masque** les widgets non pertinents
(DLC, bannières save) — ce que le rendu statique ne sait pas faire.

## 3. État actuel mesuré (le point de départ honnête)

Binaire prébuild `target/release/nie-game`, jeu monté par défaut :

- `--menu title02 --capture` : **10/18 objbin rendus**, à leur bind pose (souvent hors champ) ; la
  plupart piochent un **dummy 4×4** → invisibles ; 8 skip « pas de g4tx_path » (widgets texte). Canvas
  quasi vide (`/tmp/niers-shots/title02.png`).
- `--menu mainmenu01 --capture` : **22/31 rendus** depuis D1.c (textures co-localisées du Groupe B ;
  8 du Groupe A = compositions runtime sans assets ; placement centre, bloqué sur le driver C++/Lua D1.c).

Le compositeur 2D (CPU `menu.rs::compose` + GPU `cmd_menu_gpu`) est **correct et auto-cohérent**
(`--verify` : CPU vs GPU ≤ 1-2 LSB/canal). Le problème n'est **pas** le compositeur : ce sont les
couches C/D/E qui ne fournissent ni la bonne position, ni la bonne texture, ni le contenu runtime.

## 4. Écran START (`title02`) — décomposition exhaustive

`start.png` = écran `title02`. Les assets de l'écran (g4pkm / g4mg / g4pk / g4tx) vivent sous
`data/dx11/menu/50_title/title02/` ; les **18 objbin** vivent à part sous
`data/common/gamedata/menu/obj/` (sélectionnés par filtre `/menu/obj/` + préfixe `title02`, `main.rs:1155`).
Source de vérité : **113 assets VFS** (18 objbin + 18 g4pkm + 18 g4mg + 1 g4pk + **58 g4tx**), dont
**5 jeux g4tx localisés** seulement (`01/07/10/11/12`, chacun base + `de/en/es/fr/it/pt/zh_hans/zh_hant`),
parsés en live via `nie_formats::{objbin,g4pkm,g4tx}` (mêmes parseurs que `nie-game`). Aucun asset de
modèle/scène 3D (chr/scène) sous `title02/` : **tout** l'écran est produit par le système de menu 2D
(objbin + squelette g4pkm + meshes g4md/g4mg + atlas g4tx).

### FAIT — inventaire visuel de start.png

Fond terrain top-down (champ vert) ; petits persos top-down (cluster haut-gauche) ; 2 grands persos centraux
(garçon turquoise au ballon + perso renversé orange) ; logo « INAZUMA ELEVEN Victory Road » bas-gauche ;
« COMMENCER » centré (flanqué de triangles verts = sélecteur) ; « Quitter le jeu » + icône bouton (bas-centre) ;
« ver 6.0.2  0.79  240 » haut-droite ; triangle vert haut-droite ; « ©2025 LEVEL-5 Inc. » bas-droite.

### FAIT — les 18 objbin de title02 (vérité parseur)

Chaque objbin déclare `SkeletonAnime`→g4pkm et (optionnellement) `Texture`→g4tx
(`objbin.rs:546-547`). 10 portent un `g4tx_path`, 8 non (widgets bg/locator/texte-runtime → skip
`main.rs:1234`) — vérifié par `RUST_LOG=info ... --menu title02` : 18 objbin trouvés, 8 skip
« pas de g4tx_path » (`00,02,03,04,04_ps,06,09,20`), 10 sprites rendus (`01,07,08,10,11,12,21,22,23,24`).
La position de niers vient de la **bind pose** du squelette g4pkm (`menu.rs:57` `place_on_canvas`,
`menu.rs:78` `pick_best_pose`) ; pour la quasi-totalité des éléments cette bind pose est **hors-écran**
(template caché), la position visible réelle venant de l'animation d'ouverture (chunk G4MA du g4pkm) que niers
**n'applique pas**. Toutes les positions ci-dessous (`x,y` css 1280×720) sont reproduites via `place_on_canvas`.

| Élément visible start.png | objbin | g4tx (texture réelle / pioche niers, localisé) | Classe | Statut niers actuel | Besoin pixel-perfect |
|---|---|---|---|---|---|
| Fond terrain + persos top-down (+ 2 héros centraux, cf. open) | `title02_00_title_bg_2` | `Texture`=None ; atlas `title02_00.g4tx` 3 tex : `bg_title02_02` **2640×1200** (⚠ **PAS le champ vert** — vérifié par dump PNG 2026-06-15 : c'est un **motif décoratif pâle quasi-transparent** d'icônes [ballons/crampons/maillots] sur blanc), `title02_00` 2660×1200 (subs `bg_title02` 800×1200, `bg_title02_par` 1856×1036 parallax), `bg_title02_01` 12×12 | SPRITE-STATIQUE multi-couches | **SKIP** « pas de g4tx_path » → fond totalement absent. Base pose on-écran (x=400,y=320) | **Le CHAMP VERT top-down de start.png n'est PAS dans `title02_00.g4tx`** — vérifié par dump des **3** textures : `bg_title02_02` = motif d'icônes pâle, l'atlas `title02_00` = gradient bleu pâle + particules, `bg_title02_01` = 12×12. **TOUTES des overlays pâles/UI.** Le champ vert + les persos animés du fond de start.png sont une **SCÈNE 3D rendue par le moteur** (le titre montre des persos jouant sur un terrain top-down), **pas des textures de menu**. ⇒ **Plafond SSIM par textures-menu SEULES ≈ 0,25** : le fond dominant exige le système de **scène 3D / skinning / animation** (D2/D3, le plus profond du plan). Le travail de textures-menu (placement, sélection, texte statique) ne peut PAS, à lui seul, dépasser ce plafond sur `title02`. |
| Logo INAZUMA ELEVEN (bas-gauche) | `title02_01_title_logo_2` | `title02_01.g4tx` **1600×1200**, localisé | SPRITE-ANIMÉ | **RENDU mais hors-écran** : bind pose x=1628.5,y=486.4, scale 0.213 → OFF-SCREEN (x>1280) | Placement motion-aware : remonter à l'ancêtre on-écran (cf. iecode `GetMotionFinalPose`), absent du port `menu.rs` |
| « COMMENCER » (texte item courant) | `title02_03_item_name_2` | `Texture`=None ; bone `_text_mode01`, comp. `Text(_text_mode01)` + `MenuRateSetting` | TEXTE-RUNTIME | **SKIP** « pas de g4tx_path » (base pose on-écran 542.7,337.3) | Police + dict texte localisé |
| Triangles/sélecteur autour de COMMENCER | `title02_02_item_atc_locator_2` | `Texture`=None ; `AttachLocator` + bones `_atc_btn01.._atc_btn07` | LOCATOR | **SKIP** (correct : aucun sprite propre) | Utiliser comme points d'attache des sprites flèche/item (assets communs attachés) |
| « Quitter le jeu » + icône bouton (bas-centre) | `title02_08_explanation_button_guide` | `title02_08.g4tx` **60×52** (icône bouton, 1 tex), non-localisé | SPRITE-ANIMÉ (icône) + TEXTE-RUNTIME | **RENDU mais hors-écran** : bind pose x=2560.7,y=1752.7 | Motion-aware pour l'icône + texte runtime « Quitter le jeu » |
| « ver 6.0.2  0.79 240 » (haut-droite) | `title02_04_version` | `Texture`=None ; `Primitive(6 numbers)`, bones `_num_ver01..`, `_gtxt_ver01` | TEXTE-RUNTIME / PRIMITIVE | **SKIP** ; bind pose hors-écran (`place_on_canvas` x≈2552) | Système de nombres/primitives + glyphes gtxt |
| (variante PlayStation de la version) | `title02_04_version_ps` | `Texture`=None ; idem ci-dessus | TEXTE-RUNTIME / PRIMITIVE | **SKIP** ; non affiché sur PC (bind pose x≈2468 hors-écran) | Gating plateforme (ne dessiner qu'une des deux) |
| Compteur de victoires (masqué, save) | `title02_07_victory_counter` | `title02_07.g4tx` **réel 312×104** (subs `count_v_base01` 312×56 + `gtxt_victory01` 292×44 = texte VICTORY localisé) + 2 dummies 4×4 (`num_victory_dmy01/02`), localisé | SPRITE-ATLAS + PRIMITIVE | **RENDU invisible** : niers pioche la 1ʳᵉ tex DDS = `num_victory_dmy01` **4×4** (`main.rs:1263`) ; placement x=1830.7,y=1030.7 hors-écran | Compteur de victoires : visible seulement avec save ; sélection texture + numbers system |
| Bannière info (masquée) | `title02_06_information_banner` | `Texture`=None ; `Text(_text_info01,_text_btn01)`+`AttachLocator` | TEXTE-RUNTIME | **SKIP** (base pose on-écran 699,466) ; masqué | Texte runtime + gating |
| Ballon de flavor text (masqué) | `title02_09_flavor_balloon` | `Texture`=None ; `Text(_text_explain01)` | TEXTE-RUNTIME | **SKIP** ; bind pose hors-écran (x=1599,y=1231) | Texte runtime + gating |
| Bannière MON ÉQUIPE (save, masquée) | `title02_10_my_team_banner` | atlas `title02_10.g4tx` **2192×1744**, 11 subs (`gtxt_myteam01` 480×80 + `gtxt_teamlevel01` 280×40 texte localisé, `myteam_msk01` 1164², `myteam_base01/02/03` 1024×288) + 5 dummies 4×4, localisé | SPRITE-ATLAS (save UI) | **RENDU invisible** : niers pioche la 1ʳᵉ tex DDS = `myteam_a_dmy01` **4×4** (`main.rs:1263`) ; hors-écran (x=2525) | Sélection de la bonne tex/atlas + UV sous-tex + gating save |
| Bannière AVATAR (save, masquée) | `title02_11_avatar_banner` | atlas `title02_11.g4tx` **1724×1732**, subs dont `gtxt_avatar01` **440×80** (label « AVATAR » localisé incrusté) + tex `title02_11_base` 1028×392, localisé | SPRITE-ATLAS (save UI) | **RENDU mal placé** : niers pioche `avatar_base02` 1028×288 (1ʳᵉ DDS), bind pose x=744,y=764.7 hors-écran | idem 10 + gating save |
| Détail compteur victoires (masqué) | `title02_12_victory_counter_detail` | atlas `title02_12.g4tx` : tex `title02_12` 1124×240 + `count_v_focus01_atl` **236×104** (1ʳᵉ DDS piochée) + dummies 4×4, localisé | SPRITE-ATLAS + PRIMITIVE | **RENDU mal placé** ; bind pose x=1599 hors-écran | Atlas/UV + numbers + gating |
| Locator bouton achat DLC (masqué) | `title02_20_dlc_buy_btn_atc_locator` | `Texture`=None ; `AttachLocator` | LOCATOR | **SKIP** (base pose on-écran 640,360) ; masqué | Attach + gating DLC |
| Bouton « acheter DLC » (masqué) | `title02_21_dlc_buy_btn` | `title02_21.g4tx` **réel 456×368** (`buy_btn_base01/ok01/ol01` 456×104 + icônes 44×44) + dummy `buy_btn_dmy01` 4×4 | SPRITE-ANIMÉ (DLC) | **RENDU ON-SCREEN** (bind pose 496.7,333.3) mais niers pioche `buy_btn_dmy01` 4×4 ⇒ **invisible** — **NE DEVRAIT PAS apparaître** | Gating DLC (masquer si non pertinent) |
| Logo DLC (masqué) | `title02_22_dlc_logo` | `title02_22.g4tx` **4×4** (unique tex `title02_22`, sub `logo_dlc_dmy01`) | SPRITE (DLC) | **RENDU ON-SCREEN** (525.3,336.0), tex 4×4 ⇒ invisible | Gating DLC |
| Logo DLC simple (masqué) | `title02_23_dlc_logo_simple` | `title02_23.g4tx` : 1ʳᵉ DDS `icon_logo_dlc_200` **156×80** (réel, piochée) ; atlas aussi `title02_23_icon` 156×248 (dlc_300/400/500), localisé | SPRITE (DLC) | **RENDU ON-SCREEN VISIBLE** (612.0,348.7) — **FAUX** : dessine un sprite DLC au centre | Gating DLC |
| Logo DLC simple + ballon (masqué) | `title02_24_dlc_logo_simple_balloon` | `title02_24.g4tx` **380×124** (réel, 1ʳᵉ DDS piochée), localisé | SPRITE (DLC) | **RENDU ON-SCREEN VISIBLE** (513.3,342.7) — **FAUX** | Gating DLC |

> Constat clé : les seuls objbin **rendus et placés on-écran** sont les 4 widgets **DLC** (`title02_21/22/23/24`),
> qui ne doivent PAS apparaître sur le title vierge. Parmi eux, **seuls 23 et 24 sont effectivement visibles**
> (1ʳᵉ tex DDS réelle) ; **21 et 22 piochent un dummy 4×4 → invisibles**. Tout ce qui doit être visible
> (fond, logo, COMMENCER, version, Quitter) est soit skip (pas de `g4tx_path`), soit placé hors-écran à la bind pose,
> soit rendu avec une mauvaise texture d'atlas (dummy 4×4 pioché en 1ʳᵉ position). D'où
> `/tmp/niers-shots/title02.png` quasi vide.

### FAIT — élucidation de title02_10 / title02_11 « localisés » (étape 5)

Les deux gros g4tx localisés ne sont **PAS** des renders de personnage : ce sont des **bannières d'info UI**
(atlas multi-textures) affichées quand une sauvegarde existe.
- `title02_11_avatar_banner` (1724×1732) contient la sous-texture **`gtxt_avatar01` 440×80** = le label
  « AVATAR » en **texte dégradé pré-rendu par langue** (preuve directe de l'incrustation texte) ; d'où la localisation.
- `title02_10_my_team_banner` (2192×1744) = bannière « MY TEAM » : subs `gtxt_myteam01` 480×80 et
  `gtxt_teamlevel01` 280×40 (textes baked localisés), masque `myteam_msk01` 1164², `myteam_base01/02/03` 1024×288 ;
  localisée pour la même raison (labels baked par langue).

Hypothèse « art avec texte incrusté » → **CONFIRMÉE** (gtxt_avatar01 / gtxt_myteam01 / gtxt_victory01).
Hypothèse « splash promo » → **REJETÉE**. Ces bannières sont des panneaux save-data (coin d'écran), absents de
`start.png` (title vierge) et dont la bind pose est de toute façon hors-écran.

### Résumé du gap title02 (ce qu'il manque pour pixel-perfect)

1. **Fond (title02_00)** : binding texture via **matériau g4md** (`material_base_names`, `g4md.rs:108`), pas via `Texture` objbin → résoudre `bg_title02_02`/`bg_title02`/`_par` et composer les couches. Gap #1 (canvas vide).
2. **Placement motion-aware** : porter `G4pkmMotion.GetMotionFinalPose` d'iecode (défini `G4pkmMotion.cs:84` ;
   consommé par `ReadBoneTransformAsync`, `MenuLayoutExporter.cs:213-247`, fallback vers le 1ᵉʳ ancêtre on-écran
   quand la bind pose est hors-écran). `menu.rs` n'a que `pick_best_pose` sur la bind pose → logo 01 / guide 08 /
   version / bannières mal placés.
3. **Sélection de texture d'atlas** : `build_sprite_list` pioche la **1ʳᵉ tex DDS** (`main.rs:1263`,
   `.find(|t| t.is_dds)`) → souvent un dummy 4×4 (07, 10, 21, 22) ou une sous-texture arbitraire ; il faut
   sélectionner la texture nommée par matériau/mesh et découper les sous-textures (UV g4md/g4mg).
4. **Système texte + nombres runtime** : widgets sans g4tx → 03 (COMMENCER), 04/04_ps (version), 06 (info),
   09 (flavor) en texte/primitive ; 00 (bg, via g4md), 02/20 (locators). + le texte « Quitter le jeu » (08, dont
   l'objbin porte l'icône g4tx 60×52). Besoin : police + glyphes gtxt + table de texte localisée + système Primitive/numbers.
5. **Gating d'état (Lua)** : masquer les widgets DLC (20–24) et bannières save (07,10,11,12) sur title vierge ;
   choisir version vs version_ps selon la plateforme. Actuellement niers dessine les logos DLC 23/24.
6. **Rendu par mesh** : chaque objet-menu se dessine via des meshes g4md/g4mg (UV→atlas), pas un blit de texture
   entière ; les 18 `.g4mg` sont la géométrie (pas de la motion — `g4mg.rs:1`, « Extraction de géométrie G4MG »).

> **FAIT (2026-06-15) — BLOQUEUR DU FOND PRÉCISÉ (probe `examples/probe_bg_mesh`)** : le fond
> `title02_00` est composé de **5 quads** (`g4mg = title02_00.g4mg`, 5 submeshes × 4 verts / 6 indices)
> — donc **rastérisable en principe** (quads texturés UV → atlas). **MAIS** `g4mg::extract_geometry`
> sur les meshes de MENU produit des **positions corrompues** (`pos.y ≈ 5.76e17 ≈ 2^59`, x∈[0,1]) et un
> **`uv0` VIDE**. Le décodage d'attributs de vertex g4md/g4mg **marche pour les meshes de PERSO**
> (`assemble.rs`) et de menu **mono-submesh** (`title02_01` : `face_data_base 128 / 4 verts` = stride 32 ✓).
>
> **Diagnostic précis (probe `probe_g4md_attrs`, 2026-06-15)** : les attributs g4md de `title02_00`
> sont sains — POSITION@0 dt=3 (float3, 12o), NORMAL@12 dt=20 (snorm16, 6o), UV0@24 dt=2 (float2, 8o)
> → un vertex fait **≥ 32 o**. Le bug est le **STRIDE** : `extract_geometry` le dérive par
> `face_data_base / total_verts` = `384/20` = **19** (< 32 → UV ne tient pas → `uv0` vide ; positions
> lues au pas 19 → `pos.y` corrompu dès le vert 1). Le calcul par offsets consécutifs
> (`submesh[1].vertex_offset 124 / 4` = 31) ne tient pas non plus, ET **`submesh[1]@124` < fin de
> `submesh[0]` (128)** → régions de vertices **chevauchantes**. ⇒ le buffer de vertices des meshes de
> menu **multi-submesh** est **structurellement différent** (streams non-entrelacés, ou buffer partagé
> entre submeshes), pas le modèle entrelacé mono-stride.
>
> **VERDICT (recoupé iecode `G4mgParser.cs`, 2026-06-15)** : `nie-formats::g4mg::extract_geometry` est
> un **port 1:1 FIDÈLE** d'iecode — même taille d'enregistrement submesh (`0x50`), même champ stride
> (`+0x2E`), mêmes `FindAttribute(vtype 2/10)`, même `derivedStride = faceDataBase / totalVerts`. Le
> champ `+0x2E` vaut **0** pour ces meshes de menu → iecode ET niers retombent tous deux sur
> `derivedStride` = `384/20` = 19 et **échouent IDENTIQUEMENT**. ⇒ **le layout g4mg menu multi-submesh
> est NON RÉSOLU dans la référence iecode elle-même** (ses parseurs/tests visent les meshes de perso +
> quads mono-submesh). Le rendu de fond exige donc une **RE ORIGINALE au-delà d'iecode** (reverser le
> vrai buffer de vertices d'un mesh menu multi-submesh depuis les octets — comme le déchiffrement AES
> `cpk_list` qui a dépassé iecode). Ce n'est PAS un bug de portage. `material_base_names` reste vide.
>
> **CORRIGÉ (2026-06-15, RE originale > iecode)** : dump octets du buffer g4mg → **vrai stride = 32**
> (submesh[0] décode le quad propre `(1,0)(0,0)(0,-1)(1,-1)`). Cause du `19` : `total_verts` (20)
> **double-compte les vertices PARTAGÉS** (offsets répétés `[0,124,236,236,124]`). **Fix** dans
> `g4mg::extract_geometry` : `stride = sm.stride>0 ? sm.stride : derived_stride.max(attr_extent)` où
> `attr_extent` = max(offset+taille) des attributs (un stride ne peut être < l'extent ; UV0@24+8=32).
> **Divergence ASSUMÉE d'iecode.** Vérifié sur le vrai `title02_00` (submesh[0] = quad + `uv0` rempli ;
> test gardé `menu_render_gate::bg_mesh_geometry_decodes`). 4 tests g4mg + meshes perso INCHANGÉS
> (`derived >= extent`). **La GÉOMÉTRIE de fond se décode désormais.** Vérifié sur les 5 submesh : **submesh[0]
> (vt_off=0) = le QUAD de champ principal** `(1,0)(0,0)(0,-1)(1,-1)` + `uv0` rempli ✓. Les submesh[1-4]
> (vt_off répétés 124/236) décodent **dégénérés** (collapse à l'origine après v0) — soit des slots de
> couche placeholder (parallax `bg_title02_par` etc.), soit un offset encore à reverser. **Restant** :
> (a) les couches parallax submesh ≥ 1 (vertex partagé/dégénéré, à reverser) ; (b) le **chemin de rendu
> mesh-UV** dans `build_sprite_list` (actuellement blit de texture, pas de rastérisation de quad UV→atlas)
> + l'interprétation des UV (valeurs non-`[0,1]` observées, ex. `(221,-100)` — espace texel ou attribut
> `vtype 11` co-localisé @24 à départager). **Le quad de fond principal est néanmoins décodable.**

## 5. Écran `mainmenu01` (menu.png) — décomposition exhaustive

### Résumé exécutif (FAIT, vérité-terrain)

`menu.png` = écran **mainmenu01** (`data/dx11/menu/100_mainmenu/mainmenu01/`). Verdict de rendu actuel, mesuré :

> **MISE À JOUR — DÉFINITION D'ÉCRAN (menu_setting, 2026-06-16).** L'écran « menu principal » n'est PAS
> « tous les objbin `mainmenu01_*` ». Sa composition exacte se lit dans **`gamedata/menu/cfg/main_menu_setting.cfg.bin`**
> → liste `MENU_LAYER_INFO` (13 layers), portée `nie-data/src/menu_setting.rs` (`{layer_id=CRC32(name), name, objbin_path,
> params}`, validé end-to-end `layer_id==CRC32(name)` sur 4 écrans). **Les 13 layers de `main_menu` mêlent
> `mainmenu90_*` (fond/en-tête/onglets), `cmn01_*` (icônes new/list), `mainmenu01_06/07/10/11` (button-guides) et
> `rpg00_07` (guide timezone)** — PAS la série complète `mainmenu01_00..19`. ⇒ Le filtre `basename.starts_with("mainmenu01")`
> de `build_sprite_list` est À LA FOIS trop large (prend `mainmenu01_00..19` dont beaucoup ne sont pas dans l'écran)
> et trop étroit (rate `mainmenu90_*`/`cmn01_*`/`rpg00_*`). **La composition correcte = itérer `MenuSetting.layers`**
> (CÂBLÉ : `--from-setting` rend `main_menu` à SSIM **0,418** vs `menu.png`, > title02). Brique (a) « parseur de SCÈNE » du driver D1.c.
>
> **PLAFOND DE COMPOSITION STATIQUE CONFIRMÉ (2026-06-16).** Les raffinements de rendu tractables sont
> SYSTÉMATIQUEMENT testés et NÉGATIFS pour `main_menu` : (a) **placement** — préférer un bone « base »
> non-trivial monte `main_menu` (0,418→0,446) mais régresse title02 → reverté (non universel = driver) ;
> (b) **blend** — les **13 layers sont tous `drawType=0`** (alpha-over droit), aucun additif `draw_type==1`
> → blend déjà correct ; (c) **uv0/atlas** — confondu par le placement (driver). ⇒ Le plafond ~0,42 par
> composition STATIQUE est réel ; le gap restant (~60 % de `menu.png`) = **contenu RUNTIME** (panneaux
> AVATAR/VICTOIRES/VOTRE ÉQUIPE + tuiles catégories) instancié par le driver (briques b/c, RE C++/Lua),
> pas un détail réglable. Monter vers 0,99 EXIGE le driver.
>
> **MISE À JOUR D1.c (2026-06-16) — le Groupe B est RÉSOLU côté textures.** Le verdict « 0/31 » ci-dessous
> est SUPERSÉDÉ : le **fallback co-localisé** (`build_sprite_list`, dériver `<mesh>.g4tx` du `g4pkm` quand
> l'objbin n'a pas de param `Texture`) rend désormais **22 sprites de textures RÉELLES** (boutons-guides,
> icônes) — `--menu mainmenu01 --capture` passe de 0 sprite / PNG 5209 o (blanc) à 22 sprites / PNG 11482 o.
> Le binding texture des 23 objbin du Groupe B est donc la **CONVENTION co-localisée** (texture nommée comme
> le conteneur du mesh), PAS le matériau g4pkm ni Lua `SetSprite` (hypothèse §5 ci-dessous, désormais écartée).
> Confirmé : iecode a la MÊME limite (sprite gated sur `obj.G4txPath`, `MenuLayoutExporter.cs:127`) → il rend
> aussi mainmenu01 vide ; **niers le dépasse ici.** Le bloqueur restant est le **PLACEMENT** : ces widgets sont
> ANIMÉS (bind pose g4pkm hors-écran, ex. `_save_base01` @ y≈-3044) → leur position réelle vient de la **motion
> d'ouverture** (mevbin), pas de la bind pose ; le fallback bind-pose les regroupe au centre → SSIM mainmenu01
> reste ≈ 0,004 (gate `mainmenu01_ssim_vs_reference`) jusqu'à l'émulation du **driver C++/Lua** (**D1.c**ⁱ — les
> motions n'ont PAS de keyframes de position en fichier, cf. §6 ; la position finale est calculée par le moteur). Le
> Groupe A (8 objbin) reste lui un vrai gap d'**assets runtime** (ni g4pkm ni g4tx statiques). Détail ↓.

- `nie-game --menu mainmenu01` → **31 objbin** correspondants. Avant D1.c : **0 sprite rendu** (canvas blanc).
  Après D1.c (fallback co-localisé) : **22 sprites de textures réelles** rendus (placement encore au centre,
  bloqué sur le driver C++/Lua D1.c). Le Groupe A (8 objbin runtime) reste à 0.
- `nie-game --menu mainmenu` (préfixe large) → **117 objbin**, **22 sprites rendus** mais MAL placés (cf. `/tmp/niers-shots/mainmenu.png` : « TEAM DOCK », blob vert, « CH » = débris de sous-écrans). Ces 22 sprites proviennent EXCLUSIVEMENT des sous-écrans `mainmenu02/03/04/90/99`, pas de mainmenu01.
- Cause du sur-pull : le filtre d'écran de `build_sprite_list` (`crates/engine/nie-game/src/main.rs:1151-1168`) fait `basename.starts_with(screen)` ; avec `screen="mainmenu"` il avale tous les `mainmenu*` (02 formation-list, 04 formation, 90 listes partagées). **Bug** : pour cet écran le filtre devrait être `mainmenu01` + les partagés réellement actifs (`mainmenu90_*` background/header), pas tous les sous-écrans.

**Conclusion (RÉVISÉE D1.c) :** le gap mainmenu01 se scinde en deux. **Groupe B (23 objbin)** = textures
co-localisées RÉSOLUES (22 sprites rendus) ; gap restant = **placement par motion** (D1.a), exactement
comme title02. **Groupe A (8 objbin)** = vrai gap d'**absence d'assets statiques** (conteneurs runtime).
L'ancienne conclusion « gap total 0/31, absence d'assets » ne valait que faute du fallback co-localisé.

### Pourquoi 0/31 : les deux familles de skip (FAIT)

Le pipeline `build_sprite_list` (`main.rs:1143`) exige, dans l'ordre : objbin parsé → `g4pkm_path` présent ET résolu au VFS (`main.rs:1198-1214`) → `g4tx_path` présent (`main.rs:1231-1237`) → DDS décodé. Les 31 objbin mainmenu01 échouent en deux groupes (source : `/tmp/mainmenu.log`) :

**Groupe A — « g4pkm absent du VFS » (8 objbin)** : `mainmenu01_00_background`, `_01_base_info`, `_02_base_chara_status`, `_03_chara_status`, `_03_2_chara_status`, `_04_menu_list`, `_05_menu_list_button`, `_16_left_bottom_with_attach_button_guide`. Le `SkeletonAnime` pointe vers `.../mainmenu01_00/mainmenu01_00.g4pkm` etc. qui **n'existe dans aucun CPK** (résolution par basename, `main.rs:1117-1127`, donc le préfixe de chemin est indifférent). Vérifié en corollaire : **aucun g4tx non plus** pour `mainmenu01_00..05` dans `/tmp/vfs_g4tx.txt` (premier g4tx mainmenu01 = `mainmenu01_06`). Ces objets sont donc des **conteneurs runtime sans squelette ni texture statiques** : le moteur C++ construit leur layout (et leur contenu) en mémoire.

**Groupe B — « pas de g4tx_path » (23 objbin) — RÉSOLU D1.c** : tous les `mainmenu01_06_*` (6 variantes), `_07_*`/`_07c`, `_08_chara_3d_shadow`, `_10`, `_11`, `_12`/`_12b`, `_13_*` (4), `_14_*` (2), `_15`, `_17`, `_18`, `_19`. Le g4pkm EST résolu, mais l'objbin ne déclare **pas de `SETUP_PARAM("Texture", …)`** (`objbin.rs` : `g4tx_path` = `None`). Or les g4tx physiques EXISTENT, **co-localisés avec le mesh** (`common/.../mainmenu01_06/mainmenu01_06.g4pkm` ↔ `dx11/.../mainmenu01_06/mainmenu01_06.g4tx` ; le chemin g4pkm est AUTORITAIRE — l'objbin `mainmenu01_07` pointe le mesh `mainmenu01_07c`). **Mécanisme confirmé = convention co-localisée** (texture nommée comme le conteneur), car le g4md de menu ne porte **pas** de `material_base_names` (vérifié vide). L'ancienne hypothèse « matériau G4MT ou Lua `SetSprite` » est **écartée**. Le fallback `build_sprite_list` (dériver `<mesh-stem>.g4tx`, résoudre par basename) rend ces 22 sprites. Reste à placer correctement (**driver C++/Lua D1.c** — bind pose hors-écran, aucune keyframe de position en fichier, cf. §6) et, en raffinement, à fenêtrer par `uv0` (régions d'atlas — les meshes sont des quads unité `[0,1]×[0,1]` avec `uv0` ⊂ [0,1], cf. probe 2026-06-16).

### Mapping élément menu.png → objbin/asset → cause → classe

Classes (comme start-screen) : SPRITE-STATIQUE / SPRITE-RUNTIME (sprite réel mais assigné/sélectionné à l'exécution) / TEXTE-RUNTIME / 3D / HINT / LOCATOR / PRIMITIVE.

| Élément visuel (menu.png) | objbin mainmenu01 | Asset g4tx réel | Statut niers | Pourquoi | Classe |
|---|---|---|---|---|---|
| Fond ciel bleu + traînées lumineuses | `_00_background` | aucun (g4pkm+g4tx absents) | NON_FAIT | conteneur runtime ; fond = scène 3D ou atlas partagé `mainmenu90_00` (2640×1100) sélectionné runtime | 3D / SPRITE-RUNTIME |
| Barre haut « Ver 6.0.2 » + « 0.79 240 » | `_01_base_info` | aucun (g4pkm+g4tx absents) | NON_FAIT | widget runtime ; texte injecté par `SetText` (menu_host.rs:351) | TEXTE-RUNTIME |
| Panneau AVATAR (bleu, perso fille) | `_02_base_chara_status` | aucun | NON_FAIT | panneau composite runtime + **modèle 3D** du perso joueur | 3D + SPRITE-RUNTIME |
| Panneau central VICTOIRES « 212 » | `_03_chara_status` / `_03_2_chara_status` | aucun | NON_FAIT | primitive/gradient runtime + nombre via `CMenuCreatePrimitiveComponent`/`SetText` | PRIMITIVE + TEXTE-RUNTIME |
| Panneau VOTRE ÉQUIPE (vert) + « NIVEAU DE L'ÉQUIPE 99 » + icônes persos | `_02`/`_03_chara_status` | aucun | NON_FAIT | panneau runtime + **modèles 3D** miniatures de l'équipe + texte | 3D + TEXTE-RUNTIME |
| Rangée 7 tuiles iso (éclair, voiture, antenne, ballon, BB, trophée, panier) + rangée 3 tuiles (livre+!, engrenage, info+1) | `_04_menu_list` + `_05_menu_list_button` | aucun | NON_FAIT | géométrie de liste construite runtime ; **icônes par item assignées via Lua `SetSprite`** (frame d'atlas, probable `mainmenu90_01` 2044×2012) | SPRITE-RUNTIME (Lua) |
| Logo central INAZUMA ELEVEN Victory Road | — (hors objbin mainmenu01) | `220_img/logo_title/…` | NON_FAIT | sprite partagé assigné runtime (pas un objbin mainmenu01) | SPRITE-RUNTIME |
| Carte notif « Joueurs saisonniers disponibles » + bouton X « Informations » | partagé `mainmenu90_*` / `_01_base_info` | indéterminé | NON_FAIT | bannière runtime + invite bouton | TEXTE-RUNTIME + HINT |
| Bouton « Alt : Inazuma Post » + badge Victory Road (haut-droite) | partagé `mainmenu90_02_header_tab_*` | `mainmenu90_02` (5280×520, atlas onglets) | NON_FAIT | onglet d'en-tête ; objbin sans Texture | SPRITE-RUNTIME / HINT |
| Hints bas : « Guide joueur » + icône perso + « Y ? » + « X » | `_06..._19` button_guide (23) | `mainmenu01_06..19.g4tx` (existent) | NON_FAIT | g4pkm OK mais pas de `Texture` dans l'objbin → icône liée runtime | HINT |
| Ombre sous le perso 3D | `_08_chara_3d_shadow` | `mainmenu01_08.g4tx` (64×64) | NON_FAIT | blob d'ombre du modèle 3D ; texture non liée dans l'objbin | HINT / 3D-shadow |
| Badge « Deluxe Edition » (bas-gauche) | — | `220_img/logo_dlc/logo_dlc_deluxe_edition.g4tx` (360×76) | NON_FAIT | sprite partagé assigné runtime | SPRITE-RUNTIME |
| « DLC Nouveau Coup d'envoi » + « ©2025 LEVEL-5 Inc. » (bas-droite) | — | `220_img/logo_dlc/logo_dlc_*.g4tx` (720×152) + texte | NON_FAIT | sprite partagé runtime + texte copyright | SPRITE-RUNTIME + TEXTE-RUNTIME |

### Les 3 panneaux et la rangée d'icônes (analyse demandée)

- **AVATAR / VICTOIRES / VOTRE ÉQUIPE** ne sont PAS des sprites d'atlas statiques : leurs objbin (`mainmenu01_02_base_chara_status`, `_03_chara_status`, `_03_2`) **n'ont ni g4pkm ni g4tx** (Groupe A). Ce sont des **compositions runtime** : cadre/dégradé via primitives (`CMenuCreatePrimitiveComponent`, modélisé dans `objbin.rs:151-169`), **modèles 3D** pour les personnages (fille avatar, miniatures d'équipe), et **texte runtime** (212, NIVEAU 99) via `SetText`. Aucun asset 2D figé à charger — d'où l'impossibilité de les rendre par le compositeur sprite actuel.
- **Rangée des tuiles catégories** (`mainmenu01_04_menu_list` + `_05_menu_list_button`, Groupe A) = **liste runtime**. Le gabarit de tuile iso est généré, et chaque icône (éclair…panier) est un **sprite assigné par Lua `SetSprite(objectId, texHash, frame, …)`** — `texHash`/`frame` sont des hashes calculés à l'exécution (menu_host.rs:339-346, `MenuObjectState.sprite_texture_hash`/`frame` lignes 52-54). Donc : sprites réels, mais frame d'atlas choisie runtime, non déductible des fichiers statiques.

### Classification synthèse mainmenu01

- **SPRITE-STATIQUE (via convention co-localisée)** : 22 (Groupe B, D1.c). Les objbin `_06..._19` n'ont pas de param `Texture` mais leur g4tx est co-localisé avec le mesh → rendus. Reste le placement (driver C++/Lua D1.c, cf. §6).
- **SPRITE-RUNTIME (Lua/atlas)** : tuiles catégories (`_04`/`_05`), logo central, badges Deluxe/DLC (assets partagés `220_img/`), onglet header (`mainmenu90_02`).
- **TEXTE-RUNTIME** : base_info (Ver/build), VICTOIRES 212, NIVEAU 99, notif saisonnier, ©2025.
- **3D** : perso avatar + miniatures d'équipe (panneaux `_02`/`_03`), fond ciel probable, ombre `_08`.
- **PRIMITIVE** : cadres/dégradés des 3 panneaux (`CMenuCreatePrimitiveComponent`).
- **HINT** : toute la rangée de button-guides bas (`_06..._19`, Y?/X/Guide joueur).
- **LOCATOR** : `CMenuAttachLocator` (`objbin.rs:171-178`) sur `_16`/`_17` (points d'attache d'icônes).

### Gap pixel-perfect mainmenu01 (à combler)

1. **NON_FAIT — résolution des assets runtime** : 8 objbin du Groupe A n'ont aucun g4pkm/g4tx statique. Rendre mainmenu01 exige de reproduire la **construction runtime** (layout C++ + primitives + 3D + Lua), pas seulement le pipeline objbin→g4pkm→g4tx. C'est qualitativement plus dur que title02 (où 10/18 objbin ont leurs assets g4tx — les 8 autres sont des widgets texte sans g4tx — et le gap restant est surtout le placement par keyframes).
2. **FAIT (textures) / NON_FAIT (placement) — Groupe B (D1.c)** : 23 objbin ont leur g4tx **co-localisé** avec le mesh (PAS via matériau G4MT ni Lua — hypothèse écartée, le g4md de menu n'a pas de `material_base_names`). Le fallback co-localisé de `build_sprite_list` les rend (22 sprites). **Reste** : (a) placement réel par le **driver C++/Lua** (D1.c — les widgets ont une bind pose hors-écran et les motions n'ont PAS de keyframes de position en fichier ; la position finale est calculée par le moteur, cf. §6) ; (b) raffinement `uv0` (fenêtrage des régions d'atlas).
3. **NON_FAIT — modèles 3D** : avatar, équipe, fond — nécessitent le pipeline 3D (skinning/render), hors périmètre du compositeur 2D.
4. **INCOMPLET — filtre d'écran** : `build_sprite_list` (`main.rs:1151-1168`) doit cibler `mainmenu01` + partagés actifs ; aujourd'hui il pollue le rendu avec 22 sprites de sous-écrans placés à leur bind pose (cf. caveat bind-pose `crates/engine/nie-formats/src/menu.rs:11-15`, `g4pkm.rs:18`). Le fallback ancêtre hors-écran d'iecode (`G4pkmMotion.cs:84`, `MenuLayoutExporter.cs:126-138`) n'est pas porté.
5. **FAIT — parsing** : objbin/g4pkm/g4tx parsent correctement les fichiers qui existent ; le blocage est l'absence d'assets statiques, pas un défaut de parseur.

## 6. Couche animation/motion — placement final des éléments animés

### Le verrou, reformulé par la vérité-terrain iecode

La prémisse « la position visible = frame final de la motion d'ouverture, donc il faut parser les
motions » est **partiellement fausse** au regard de la référence de portage. La RE iecode établit
que les **keyframes de position d'os des animations de glissement n'existent PAS dans les fichiers** :

- `Formats/Menu/G4pkmMotion.cs:56-67` et `:209-211` : « Le G4MT/G4MA du G4PKM contient uniquement des
  animations de *matériau* (alpha fade, décalage UV). Les animations de position d'os ("slide depuis
  hors-écran") ne sont PAS encodées dans le fichier G4PKM — elles sont pilotées par le moteur C++ du
  jeu via un système d'état. »

Conséquence : il n'y a **aucun interpolateur de keyframes à porter** pour obtenir la position. La
solution réelle d'iecode pour « la position finale » est une **heuristique de fallback d'ancêtre**,
pas une lecture de motion. C'est `G4pkmMotion.GetMotionFinalPose` (`G4pkmMotion.cs:84-155`) :

1. trouver le bone de placement (`FindPlacementBoneIndex`, `:172-192` : dernier bone `pos_scl`, sinon
   premier bone `base`, sinon bone 0) ;
2. si sa `world_bind_pose` est dans l'écran (`!IsOffScreen1920`) → la retourner telle quelle ;
3. si elle est **hors-écran** (ex. `_pos_scl_base01` à tx=1873) → **remonter la hiérarchie de bones**
   jusqu'au premier ancêtre dans l'écran (en pratique `_pos_base01` à l'origine 0,0 = centre écran),
   en **conservant la scale du bone feuille hors-écran** (`:113-115`, `:131-138`).

Le caveat niers correspond exactement à ce gap : `crates/engine/nie-formats/src/menu.rs:12-15`
(« Les éléments **animés** (glissement d'entrée) ont une bind pose hors-écran ; leur position finale
dépend des keyframes runtime (absentes des fichiers) — non couverts ici. ») et
`crates/engine/nie-formats/src/g4pkm.rs:18` (« `title00_09` / `_pos_scl_base01` : tx=1873 ty=-39 → hors-écran
(bind = caché) »).

### Mapping `mot_open_hash` → placement (ce qu'il fait et ne fait PAS)

`AnimationComponent.mot_open_hash` est **déjà parsé** côté niers
(`crates/engine/nie-formats/src/objbin.rs:120-128`, alimenté par `build_animation_component` `:693-717` depuis
la propriété `m_nameMotOpen`). Mais il ne pilote **aucune** logique de position :

- côté iecode, `MenuLayoutExporter.cs:133` calcule `hasOpenMotion = anim?.MotOpenHash != 0` puis le passe
  à `GetMotionFinalPose(layout, hasOpenMotion)` ; la doc de l'API précise (`G4pkmMotion.cs:79-82`) :
  « Utilisé uniquement pour annoter le résultat (**pas de logique différente**) ». Le flag ne fait que
  renseigner `HasOpenMotion`/`UsedAncestorFallback` sur le résultat ;
- le hash ne se résout qu'en **nom** de motion matériau via le dictionnaire de hash
  (`MenuLayoutExporter.cs:151` `ResolveName`), pour le champ cosmétique `MenuLayoutAnim`, jamais en
  transform.

Chaîne réelle : `objbin AnimationComponent.mot_open_hash` (≠0 ⇒ objet animé) → flag `has_open_motion`
→ `GetMotionFinalPose(layout, has_open_motion)` choisit le bone de placement et applique le fallback
d'ancêtre → `PickBestPoseForSprite` raffine la scale au sprite (`MenuLayoutExporter.cs:237-238`) →
`ToCss1280x720` → `ScreenTransform`. Le hash n'intervient **pas** dans la pose ; seule la géométrie
bind-pose du squelette + la hiérarchie parent comptent.

### Format des motions dans le VFS

Les blocs d'animation sont des **sous-fichiers du container G4PK** (`.g4pkm`), pas des fichiers
`.g4ma`/`.g4mt` séparés dans le VFS :

- `crates/engine/nie-formats/src/g4pkm.rs:22-23` : « Container G4PK … contenant plusieurs sous-fichiers :
  G4SK (squelette), G4MD (géométrie), G4MA (animation), G4MT (matériau) » ;
- `G4pkmMotion.cs:200-211` (G4MA = bone animation, G4MT = material animation ; header 0x40 partagé) ;
- niers sait déjà extraire n'importe quel sous-fichier par magic : `extract_sub_file`
  (`g4pkm.rs:253-299`, fn privée générique, actuellement appelée seulement pour `MAGIC_G4SK`
  via `parse` `:185`). Le container générique est aussi exposé par `g4pk.rs:87-106`
  (`G4pkFile`/`G4pk`).
- Note : `G4MA`/`G4MT` ne livrent que des **noms** de motions matériau (ex. `_sma_fade_in_mat_01`),
  via `G4maParser.ParseMotionNames` (`G4pkmMotion.cs:234-271`) — confirmé par
  `G4pkmMotionTests.cs:242-257`. Le runtime des positions est un G4RA (resource archive à refcount,
  RE de `FUN_1404ce260`, `Formats/Level5/G4raParser.cs:9-14`) chargé par le moteur, hors fichiers menu.

Vérification VFS : le listing `/tmp/vfs_g4tx.txt` ne contient que des `.g4tx` (grep `.g4ma|.g4mt|
.g4pkm` = 0 hit ; seule une ligne d'en-tête de log INFO n'est pas un `.g4tx`) ; c'est cohérent —
les motions ne sont pas des entrées VFS distinctes mais des blocs internes aux `.g4pkm` déjà résolus
par `resolve_vfs_basename` + `vfs.read` puis `g4pkm::parse`
(`crates/engine/nie-game/src/main.rs:1198-1228`).

### État de l'art côté niers

**FAIT**
- Toutes les **structures de données** requises pour le fallback existent déjà : `Transform2D`
  (x, y, scale, rot, anchor) + `is_off_screen_1920` (`g4pkm.rs:70-127`, seuil `|x|>960 || |y|>540`
  `:124-126`), `G4pkmBone` avec `parent_index` (`:132-144`, parent `:138`) et `world_bind_pose`,
  `G4pkmLayout` (`:151-156`). C'est l'équivalent exact des types attendus par les golden iecode
  (`G4pkmMotionTests.cs:171-237`).
- Parsing `mot_open_hash`/`mot_close_hash`/`mot_select_hash` (`objbin.rs:120-128`, `:693-717`).
- Primitive d'extraction de sous-fichier par magic (`g4pkm.rs:253-299`).
- Point d'intégration câblé : `build_sprite_list` → `menu::assemble_object(&obj, &layout, w, h)`
  (`main.rs:1278`) ; `obj` porte déjà l'`AnimationComponent` (variante `MenuComponent::Animation`,
  `objbin.rs:88`).

**INCOMPLET**
- `menu.rs::place_on_canvas` (`:57-75`) + `pick_best_pose` (`:78-119`) n'utilisent que la **bind pose**
  et choisissent la base comme « premier bone à scale>1 » — **pas** le bone de placement nommé
  d'iecode (`FindPlacementBoneIndex`), et **sans** fallback d'ancêtre pour les hors-écran. C'est la
  cause directe du « canvas quasi vide » de title02 (10/18 objbin rendus, tous à leur bind pose,
  souvent hors-écran ; les 8 autres skippés faute de `g4tx_path`).
  `pick_best_pose` correspond bien à `PickBestPoseForSprite` (tolérance 0.30, `:106-114`) mais s'applique
  à une mauvaise pose de base.

**NON_FAIT**
- Aucun module `g4pkm_motion`/`g4ma`/`g4mt` (`ls crates/engine/nie-formats/src/` : pas de `g4ma.rs`/`g4mt.rs`;
  `mevbin.rs` est sans rapport — c'est le *Motion Event Binary* des personnages, `mevbin.rs:1`).
- Aucun port de `GetMotionFinalPose` / `FindPlacementBoneIndex` (recherche `GetMotionFinalPose|ancestor|
  fallback` dans `nie-formats/src/` = 0 hit hors `mevbin`).
- Aucun test golden adossé à `G4pkmMotionTests.cs`.

### Travail de portage (précis)

**1. Nouveau module `crates/engine/nie-formats/src/g4pkm_motion.rs`** (port de `G4pkmMotion.cs:84-192`).
Ce n'est **pas** un interpolateur de keyframes (la donnée n'existe pas) mais le fallback d'ancêtre.
API proposée, alignée sur la struct iecode `G4pkmMotionPose` (`G4pkmMotion.cs:29-48`) :

```rust
pub struct MotionFinalPose {
    pub bone_name: String,
    pub pose: Transform2D,          // world, espace 1920×1080 centre=0
    pub used_ancestor_fallback: bool,
    pub has_open_motion: bool,
}
pub fn motion_final_pose(layout: &G4pkmLayout, has_open_motion: bool) -> MotionFinalPose;
fn find_placement_bone_index(layout: &G4pkmLayout) -> usize; // dernier "pos_scl", sinon 1er "base", sinon 0
```

Logique stricte (copie de `:94-155`) : (a) `find_placement_bone_index` ; (b) si pose candidate
`!is_off_screen_1920()` → retourner ; (c) sinon remonter via `parent_index` jusqu'au premier ancêtre
dans l'écran, en **gardant `scale_x/scale_y/rot` du candidat** mais `x/y/anchor` de l'ancêtre
(`:128-141`) ; (d) si tous hors-écran → bind pose telle quelle. `world_pose_by_name` n'est pas requis.
Note : `extract_sub_file` étant privée à `g4pkm.rs`, prévoir de l'exposer (ou loger le nouveau module
dans le même crate) pour réutiliser la primitive par magic.

**2. (Optionnel, cosmétique) `g4ma`/`g4mt`** : port de `G4maParser.ParseMotionNames`
(`G4pkmMotion.cs:234-271`) via `extract_sub_file(.., MAGIC_G4MA/MAGIC_G4MT)` (ces constantes restent
à ajouter — seules `MAGIC_G4PK`/`MAGIC_G4SK` existent, `g4pkm.rs:43-45`). Ne fournit que des noms
(alpha/UV fade) — utile plus tard pour le fade d'apparition, **inutile** pour le placement. À classer
hors chemin critique pixel-perfect du placement.

**3. Intégration dans `menu.rs`** — restructurer `place_on_canvas` pour suivre l'ordre iecode
(`MenuLayoutExporter.cs:237-248`) :
- threader `has_open_motion` : `assemble_object` (`menu.rs:141-162`) lit
  `obj.components` → `AnimationComponent.mot_open_hash != 0` et le passe à `place_on_canvas` ;
- dans `place_on_canvas` : remplacer la sélection de base actuelle (`:81-87`) par
  `let mp = motion_final_pose(layout, has_open_motion); let pose = pick_best_pose_for_sprite(layout,
  mp.pose, w, h);` — c'est-à-dire **d'abord** le fallback d'ancêtre, **ensuite** le scale-matching
  existant (renommer `pick_best_pose` → `pick_best_pose_for_sprite`, prenant la pose de placement en
  entrée au lieu de la recalculer). Conserver le calcul de scale `:61-72` (déjà conforme à
  `MenuLayoutExporter.cs:245-247`).

**4. Gate de validation** — porter `G4pkmMotionTests.cs` en `#[cfg(test)]` (gated `NIE_GAME_DIR`,
même schéma que `objbin.rs:919-929`) :
- synthétique `OffScreenBaseWithOnScreenParent` (`:195-237`) : parent `_pos_base01` (0,0) + enfant
  `_pos_scl_base01` (1873,-39, sx=0.65, sy=0.9) ⇒ résultat bone=`_pos_base01`,
  `used_ancestor_fallback==true`, `!is_off_screen_1920`, **scale conservée 0.65/0.9**, CSS dans
  `[0..1280]×[0..720]` ;
- `SingleOnScreenBone` (`:171-192`) ⇒ pas de fallback, x≈100 ;
- `EmptyLayout` (`:159-169`) ⇒ pose zéro, bone="" ;
- réels gated : `title00_09` hors-écran→ancêtre `|x|<960` (`:53-68`, `:83-93`) ; `title00_01` sans
  fallback, bone `*base*`/`*pos_scl*` (`:111-138`) ; `option01_02` = 66 bones, dans l'écran
  (`:143-154`).

Critère de sortie : title02 ne doit plus avoir d'objbin placé hors-écran ; le panneau version
`title00_09`-like revient au centre. Vérifier ensuite via le binaire prébuild
`nie-game --menu title02 --capture` (compositeur CPU de référence) puis SSIM vs `start.png`.

## 7. Texte + police (rendu des libellés de menu)

> 🔴 **CORRECTION MAJEURE (2026-06-16) — le « bloqueur principal `.g4tg` » est un MYTHE.**
> Les métriques de glyphes ne sont **PAS** dans un fichier `.g4tg` à reverser. **Aucun `.g4tg`
> de police n'existe dans le VFS** (les seuls `.g4tg` sont des textures d'effets `effect/…`).
> Les métriques vivent dans **`data/common/font/font/font_def/font.cfg.bin`** — un **T2B** que
> `cfgbin::parse_t2b` décode déjà. **PORTÉ + VALIDÉ** : `nie-formats/src/font.rs`
> (`parse_metrics` → `FontMetrics{atlas 4096×2048, glyphs: BTreeMap<cp, GlyphMetric{x,y,width,
> bearing_x,advance,page,font,base}>}`, 2 polices, 7638 glyphes). Layout `CHR =
> [font, base, codepoint, atlasX, atlasY, width, bearingX, advance, page]` — **le codepoint est
> col[2]**, pas col[1]. Golden gated `font::tests::real_font_metrics_match` (A=1157,1,38,39 ;
> W=47/48 ; i=7/12 ; tout l'ASCII imprimable). Le `g4.rs` calcule bien un chemin `"%s.g4tg"`,
> mais c'est un format de **texture-group d'effets**, sans rapport avec la police.
> ⇒ Reste pour le texte composé : (a) décoder l'atlas `font_def/font.g4tx` (DDS 4096×2048, le
> g4tx decoder le fait déjà), (b) un **blitter de glyphes** (rect atlas → dest, avance/bearing),
> (c) interpréter la table `KERN` (315 entrées). **PLUS de RE de format à faire** pour les métriques.

> Périmètre : pourquoi aucun texte (COMMENCER, ver 6.0.2, VICTOIRES 212, NIVEAU DE
> L'ÉQUIPE 99, AVATAR, VOTRE ÉQUIPE, Quitter le jeu, Guide joueur, Deluxe Edition…)
> n'apparaît sur `title02` (start.png) et `mainmenu01` (menu.png), et plan pour le rendre
> pixel-perfect.

### Vue d'ensemble : le jeu a TROIS mécanismes de texte distincts

L'investigation (objbin + g4pkm + arbo VFS + g4.rs + iecode) montre que « le texte de menu »
n'est pas un seul système mais trois, à traiter séparément :

1. **Libellés pré-rendus par locale** (la grande majorité du texte visible des deux écrans
   de référence). Chaque phrase est une **texture DDS** déjà composée, rangée dans un
   sous-dossier de locale du VFS. Exemples vérifiés (`/tmp/vfs_g4tx.txt`) :
   - `data/dx11/menu/50_title/title02/title02_01/{de,en,es,fr,it,pt,zh_hans,zh_hant}/title02_01.g4tx` 1600×1200 (overlay « COMMENCER / PRESS START » + mentions légales) ;
   - `.../title02_07/<lg>/title02_07.g4tx` 312×104, `.../title02_10/<lg>/…` 2192×1744, `.../title02_11/<lg>/…` 1724×1732 (panneaux texte légaux) ;
   - `data/dx11/menu/220_img/banner_img/<lg>/gtxt_banner01_deluxe01.g4tx` 664×248 (« Deluxe Edition ») ;
   - `data/dx11/menu/100_topmenu/.../{,<lg>/}gtxt_title02.g4tx` 1604×884.
   Le préfixe `gtxt_` = *game text* pré-rendu. Le dossier **sans** sous-locale est la
   valeur par défaut (japonais) ; `de/en/es/fr/it/pt` et `zh_hans/zh_hant` sont des overrides.
   Le chemin logique dans l'objbin contient le marqueur `<LG>` substitué à l'exécution
   (`crates/engine/nie-formats/src/objbin.rs:30,76` ; test `:967`).

2. **Texte composé à l'exécution depuis un atlas de glyphes** (police bitmap) : valeurs
   dynamiques impossibles à pré-rendre — compteurs « VICTOIRES 212 », « NIVEAU 99 », chaîne
   de version « ver 6.0.2 », noms de joueur/équipe. Positionnées sur des os nommés du squelette
   g4pkm (`_gtxt_ver01`, `_gtxt_dot01`, `_header_gtxt_title02_01` — vérifiés sur le jeu réel par
   le golden `crates/engine/nie-formats/src/g4pkm.rs`
   (`golden_g4pkm_option02_02_win00_04_title00_09`), qui asserte les 20 noms d'os de
   `title00_09` et l'échelle héritée de `_gtxt_ver01`).

3. **Texte localisé résolu par hash** (`MenuTextSetting`) : libellés de widgets runtime
   (button-guide, listes, statut perso) dont le contenu est une **chaîne** issue d'une table
   de texte localisée, puis rastérisée via l'atlas de glyphes (mécanisme 2).

Les mécanismes 2 et 3 reposent sur le **même moteur de glyphes** (police), aujourd'hui absent.

### 1. Chaîne de résolution `MenuTextSetting` : slot → hash → table localisée → chaîne

`MenuTextSetting` est parsé par `crates/engine/nie-formats/src/objbin.rs:131-149`
(`TextComponent` :131-140, `TextEntry` :142-149) ; construction en `objbin.rs:646-647` puis `:721-739`.
Structure : `TextEntry { key: String, hashes: Vec<u32> }` où :
- `key` = nom du **slot** (ex. `"_text_choice01_on"`) — chaîne littérale lue de `PROP_PARAM` ;
- `hashes` = **CRC-32** (les `vals` de la prop, castés `as u32`, `objbin.rs:729`).

Sémantique confirmée par la vérité-terrain iecode (`Formats/Menu/ObjbParser.cs:73-74,585`) :
« MenuTextSetting — clés de texte localisées (lookup dans `common/text/<locale>/`). Les clés
et valeurs sont des hash CRC-32 de noms. » La résolution est donc :

```
slot (key)  ─┐
hash (CRC32)─┴─►  table localisée  common/text/<locale>/<table>.cfg.bin
                  (entrée hash == hashes[0])  ─►  chaîne UTF-8  ─►  rasteriser via police
```

**Modèle de résolution déjà porté (FAIT) pour un AUTRE domaine** : `crates/engine/nie-data/src/passives.rs`
(1022 lignes — fichier **distinct** de `passive.rs`, ce dernier (317 l.) étant le classifieur
scope/boost : `detect_scope`/`detect_boost_type`/`parse_passives`) résout `effectId(hash) → texte`
via `load_noun_texts` (`passives.rs:269-308`) sur `common/text/{fr,en,ja}/skill_text.cfg.bin.json`
(en-tête `passives.rs:11`). Format générique `NOUN_INFO_N = [hash(Int), …, texte(String)]` :
`vars[0]` = hash, `vars[5]` = texte. Variante `TEXT_INFO` (`passives.rs:320-353`, `vars[2]` = texte).
Même schéma pour `chara_text.cfg.bin`, `event/*.cfg.bin` (cf. `crates/engine/nie-data/src/bin/export_aphrody.rs:151-161`).

**Tables de texte du jeu (où) :** `data/common/text/<locale>/…` (CPK), une arbo par locale
(`de en es fr it ja ko pt zh_hans zh_hant` selon le contexte ; menu = `<LG>` substitué).
Fichiers de type `*_text.cfg.bin` (`skill_text`, `chara_text`, `soccer_team_passive_text`,
sous-dossier `event/`). Le modèle hash→chaîne est identique partout.

**FAIT (2026-06-15) — `menu_text` POSITIVEMENT identifié comme source de libellés UI de menu, via
le résolveur universel `nie_data::text::parse_text_file`.** Probe live (objbin title02 `TextComponent`
`hashes[0]` → `find_text(menu_text_fr)`) : `menu_text.cfg.bin` (**2624 entrées fr**) résout p.ex.
`0x40687BAD` → **« Informations »** (= `title02_06 _text_info01`). La table contient bien des libellés
UI (`Avatar`, `Équipement`, `Victoire par avantage`, …).

**Précision du modèle (insight de la probe)** : la résolution se fait sur le **hash de TEXTE parmi
`hashes`**, qui n'est **pas toujours `hashes[0]`**. Ex. `title02_06 _text_info01` :
`hashes = [0x17CA5988 (→ None), 0x40687BAD (→ « Informations »)]` — c'est le **2ᵉ** hash qui porte le
libellé ; le `[0]` est vraisemblablement un hash de **slot/setting**. Les entrées **mono-hash**
non résolues correspondent aux libellés **RUNTIME** : `title02_03 _text_mode01` (« COMMENCER ») a
`hashes = [0xD09D3787]` non présent dans `menu_text` car c'est le **nom de l'item courant**, posé
**dynamiquement par le driver** (cf. classification « TEXTE-RUNTIME » de `title02_03` §4) — pas un
libellé statique. **Donc** : libellés **statiques** → `menu_text` (résolveur universel, FONCTIONNE) ;
libellés **runtime** (noms d'items : COMMENCER…) → posés par le driver de menu (D1.c), pas une table.
Le verrou des libellés d'action n'est **pas** « quelle table », mais le **driver runtime**.

État du dispatch runtime : `crates/engine/nie-lua/src/menu_host.rs:352-363` (`CMD_SET_TEXT`, hash
`0x4096E67E`, constante `:164`) **stocke** la chaîne/hash dans `obj.text` (champ `:60`, écriture
`:363`) mais **ne la rend pas** (aucun consommateur en aval). Côté iecode la résolution est
laissée à un callback non implémenté (`MenuLayoutExporter.cs:139-147` : `TextResolver`/`HashResolver`,
fallback = clé brute), et un dico inverse hash→nom existe (`Util/Level5HashDictionary.cs`, source
`re/menu/hash-dictionary.json`).

### 2. Format de police réel identifié

**Il n'y a pas de g4tx nommé « font » dans le listing** (`grep -ic font /tmp/vfs_g4tx.txt` = 0)
parce que ce listing ne contient que les textures DDS du sous-arbre menu, et que le listing
a été capturé avant intégration des polices (font_def/gaiji absents de `/tmp/vfs_g4tx.txt`).
La police existe bel et bien :

- **`font_def.g4tx`** — atlas principal, **DDS 4096×2048**, `texture_count=1`,
  `total_count=1`, **`sub_texture_count=0`** (aucune région d'atlas dans le g4tx lui-même),
  ~44 Mo (`crates/engine/nie-formats/src/g4tx.rs:7-8`).
- **`gaiji_game.g4tx`** — *gaiji* (外字 = caractères externes : pictos boutons, symboles
  spéciaux), **DDS**, `total_count=118`, **`sub_texture_count=117`** régions d'atlas
  **nommées** (`g4tx.rs:9-10`), ~736 Ko.

Confirmation côté moteur décompilé : le chargeur `g4tx_load_cached`
(`crates/archive/nie-engine/src/g4.rs`) calcule pour chaque police DEUX chemins :
`"%s.g4tx"` ET **`"%s.g4tg"`** (`g4.rs:656-662` `g4tx_build_request` — champ `path_g4tg` :661,
snprintf `:789`), avec fixtures de test `gaiji_game` (`g4.rs:868`) / `font_def`
(`g4.rs:858`, `:1066`). Le `.g4tg` est le **fichier compagnon de métriques de glyphes**
(codepoint → rect d'atlas + avance/bearing).

**Verdict : police = atlas bitmap (BCn/DDS) + table de glyphes externe**, PAS une police
vectorielle (pas de TTF/OTF/FreeType embarqué : `find … -iname '*.ttf' -o '*.otf' -o '*.fnt'`
= 0). Deux niveaux :
- `font_def.g4tx` : grand atlas 4096×2048, glyphes positionnés par la table `.g4tg`
  (le g4tx n'a aucune sous-région — les rects viennent du `.g4tg`).
- `gaiji_game.g4tx` : 117 sous-régions **dans** le g4tx (structs déjà présentes
  `g4tx.rs:84-116` `G4txSubEntry{entry_id,x,y,w,h}` / `G4txSubTexture{id,name,…}` ; parsing
  réel dans `g4tx.rs:167-272` `parse()`, sous-entrées :204, sous-textures :253).

État formats : le **container G4TX est parsé (FAIT)** y compris les sous-régions d'atlas
(`g4tx.rs:167-272`), et le déswizzle **NXTCH** Switch est porté mais **INCOMPLET** (bug offsets
en-tête off-by-4, aucun fichier NXTCH réel pour valider —
`crates/engine/nie-formats/src/nxtch.rs`). **Les `.g4tx` police observés sont DDS, pas NXTCH**,
donc le décodage DDS existant suffit pour eux. **Le parseur `.g4tg` (métriques de glyphes)
n'existe NI dans niers NI dans iecode** (`grep g4tg` iecode = 0) → format à reverser
(NON_FAIT).

### 3. Multi-script et conséquences pixel-perfect

Le jeu est **multi-script** : japonais (base, sans sous-locale), latin
(`de/en/es/fr/it/pt`) et **CJK chinois** (`zh_hans`, `zh_hant`) — overrides de texture
vérifiés dans `/tmp/vfs_g4tx.txt` (ex. `title02_01/`, `gtxt_title02`, banners). Conséquences :

- Pour les **libellés pré-rendus** (mécanisme 1), le multi-script est résolu **à la source** :
  une texture par locale. Le moteur n'a qu'à choisir la bonne locale (`<LG>`) — pas de
  rasterisation. C'est la voie la plus courte vers le pixel-perfect des deux écrans de réf,
  car « COMMENCER », « Deluxe Edition », « Quitter le jeu », « Guide joueur », « VOTRE
  ÉQUIPE » sont presque tous des `gtxt_`/`title02_*` pré-rendus.
- Pour le **texte composé** (mécanismes 2/3), `font_def.g4tx` doit contenir un jeu de glyphes
  CJK (cohérent avec un atlas 4096×2048 ~44 Mo) : le rasteriseur devra gérer des codepoints
  larges, l'avance par glyphe issue du `.g4tg`, et le shaping minimal (pas de ligatures Latin,
  mais positionnement CJK monochasse). Bit-exactness exigée : positionnement entier, couleur
  (balises `[CPASSIVE01]…[C]` déjà gérées pour skills, `passives.rs:223-257` `remove_color_tags`),
  pas d'AA ajouté.

### 4. Spécification du travail

#### (a) Résolution de texte (table + locale) — INCOMPLET
- FAIT : moteur générique hash→chaîne (`nie-data` `load_noun_texts`/`load_team_passive_texts`,
  `passives.rs:269-353`) + nettoyage balises couleur (`passives.rs:223-257`).
- NON_FAIT : (i) identifier le(s) fichier(s) `common/text/<locale>/*.cfg.bin` des libellés UI
  de menu et charger leur table hash→chaîne ; (ii) résolveur `MenuTextSetting`
  (`TextEntry.key` + `hashes[0]`) → chaîne, branché sur `menu_host.rs` `CMD_SET_TEXT`
  (`:352-363`) à la place du simple stockage ; (iii) sélection de locale (paramètre
  `--locale`, défaut depuis Steam — `scripting.rs:424`) propagée jusqu'à la substitution `<LG>`.

#### (b) Parseur de police — **FAIT (2026-06-16)** — l'hypothèse `.g4tg` était fausse
- **Correction de fond** : le « bloquant principal » supposé (« reverser le format `.g4tg` »)
  **n'existait pas**. Vérification VFS : **aucun `.g4tg` de police** n'est monté (les seuls
  `.g4tg` sont des textures d'effets `effect/…`). Les métriques de glyphes vivent dans
  **`data/common/font/font/font_def/font.cfg.bin`** — un **T2B** que `cfgbin::parse_t2b`
  décodait déjà. Le chemin `"%s.g4tg"` calculé par `g4.rs:789` pointe sur un fichier absent
  pour `font_def` (le moteur retombe sur le `.cfg.bin` / métriques internes).
- **Porté** : `crates/engine/nie-formats/src/font.rs` (`parse`) lit les entrées `INF`
  (`[font, ascent, cell_height, descent, nGlyphs, atlasW, atlasH]`) et une `CHR` par glyphe
  (`[font, base, codepoint, atlasX, atlasY, width, bearingX, advance, page]`). **Piège
  identifié** : le point de code est la **colonne 2**, pas la 1 (col[1] = id de groupe partagé
  entre variantes CJK). Validé contre des largeurs ASCII connues : `A` 38/39, `W` 47/48,
  `i` 7/12, `0` 31/38, espace 1/16.
- Réutilisé : container G4TX + sous-régions (`g4tx.rs:167-272`) et décodage DDS
  (`nie-game/src/main.rs:204`). L'atlas police = `data/dx11/font/font_def/font.g4tx`
  (DDS BGRA8 non compressé 4096×2048 ; pixels à `data_offset + 128`). **Reste** : la table
  `KERN`/`KERNINF` (présente, non encore interprétée).

#### (c) Rasteriseur de glyphes bit-exact — **FAIT (2026-06-16)**
- `font.rs` `glyph_blitter` mappe `atlas(ay+row, ax+col) → canvas(dst_y+row, dst_x+col)`,
  masqué par l'alpha de l'atlas, composition **src-over** (la couleur RGB remplace la
  destination, `out_a = atlas_a · color_a / 255`) — **aucun AA ajouté** (l'AA est cuit dans
  l'atlas). `draw_text` enchaîne les glyphes : `dst_x = pen_x + bearing_x`,
  `dst_y = pen_y − ascent`, `pen_x += advance`. Validé pixel : glyphe 'A' réel α=251 à
  (row 20, col 0), 'A' à pen rendu 39×71, 'AW' à 87×71 (avance 39+48).
- **Reste** : couleur/teinte par balise (`[CPASSIVE01]…`), alignement (centre/droite),
  échelle issue de l'os `_gtxt_*` du g4pkm, et le kerning `KERN`. La primitive de blit, elle,
  est bit-exacte vs l'atlas.

#### (d) Intégration compositeur (`menu.rs` / `nie-game`) — INCOMPLET
- FAIT : pipeline sprite (objbin→g4pkm→g4tx→DDS→blit trié par `draw_priority`,
  `main.rs:1143-1289`).
- NON_FAIT : (i) `build_sprite_list` **substituer `<LG>`** dans `resolve_vfs_basename`
  (`main.rs:1117-1126`) qui aujourd'hui matche par **basename seul** (jamais de substitution de
  `<LG>`) → choisit le **premier** chemin VFS finissant par ce basename, donc une locale **non
  contrôlée** (déterministe selon l'ordre d'itération du VFS, mais pas la locale voulue) ;
  (ii) pour les objbin **sans `g4tx_path`** (76 skips « pas de g4tx_path » sur mainmenu —
  `/tmp/mainmenu.log` ; ex. `mainmenu01_12_next_button_guide`, `_chara_status`,
  `_week_rank_score`, `chara_code_input`), générer un sprite texte via (b)+(c) au lieu de les
  ignorer ; (iii) brancher la sortie de `CMD_SET_TEXT` dans le compositeur. NB : le filtre
  `is_dds` (`main.rs:1263`) n'élimine pas `font_def`/`gaiji` (qui sont DDS) ; il les éliminerait
  s'ils étaient NXTCH.

### Récapitulatif statut

| Brique | Statut | Preuve |
|---|---|---|
| Parse `MenuTextSetting` (slot/hash) | FAIT | `objbin.rs:131-149,721-739` |
| Modèle résolution hash→chaîne localisée | FAIT (skills) | `passives.rs:269-353` |
| Identification table texte UI menu | NON_FAIT | open_questions |
| Sélection locale `<LG>` au rendu | NON_FAIT (bug basename) | `main.rs:1117-1126`, `objbin.rs:76` |
| Container G4TX + sous-régions atlas | FAIT | `g4tx.rs:167-272` (structs :84-116) |
| Décodage DDS police (`font_def`/`gaiji`) | FAIT | `g4tx.rs:7-10`, `main.rs:204` |
| Déswizzle NXTCH | INCOMPLET (off-by-4) | `nxtch.rs`, `avancement.md:64` |
| Parseur métriques glyphes (`font.cfg.bin` T2B, **pas** `.g4tg`) | **FAIT (2026-06-16)** | `font.rs` (`parse` INF/CHR → `GlyphMetric`) |
| Rasteriseur de glyphes (blit atlas DDS) | **FAIT (2026-06-16)** | `font.rs` `glyph_blitter`/`draw_text` ; validé 'A' (α=251) |
| Exposition FFI + Bun du rendu texte | **FAIT (2026-06-17)** | `nie-ffi` `nie_font_render_text` ; `packages/nie` `FontHandle.renderText` |
| Intégration compositeur texte | NON_FAIT | `menu_host.rs:352-363` stocke sans rendre |

## 8. Runtime Lua — construction du menu réel

Le vrai moteur Level-5 « Lives » ne dessine pas un layout figé : pour chaque écran il exécute un script Lua 5.2 (`.lua.bin`) qui définit des callbacks (`OnSetupLayer`, `OnOpenLayer`, …). À l'ouverture, le moteur appelle ces callbacks, qui émettent des `funcLuaMenuCommand(cmdId, layerId, …args)`. Chaque commande mute l'état en mémoire des objets du layer (visible, sprite, texte, nombre…). Le rendu final = layout statique `objbin + g4pkm/G4SK + g4tx` **muté par-dessus** par ces commandes. C'est exactement pourquoi `title02` (8 widgets « pas de g4tx_path ») et `mainmenu01` (panneaux texte/nombre) apparaissent vides en rendu statique : leur contenu est posé par le script, pas par l'asset.

`niers` a déjà la VM et le modèle d'état (`nie-lua`), mais **le renderer (`nie-game`) ne les utilise pas**.

### Flux cible complet

```
Vfs::init(data/)                                  nie-formats/src/vfs.rs (254202 fichiers montés)
  │  résoudre écran → script   data/common/script/lua/menu/<screen>.lua.bin   (lib.rs:249)
  ▼
new_vm()  (mlua, PUC-Rio Lua 5.2.4 vendored)      nie-lua/src/lib.rs:52   (unsafe_new :55)
  ├─ install_include(resolver = VFS basename)     nie-lua/src/lib.rs:93   → global INCLUDE (lib.rs:114)
  └─ install_menu_host()  → Rc<RefCell<MenuState>> nie-lua/src/menu_host.rs:251
       (funcLuaMenuCommand + funcLuaCommand/Action/Camera/SpTactics + NameSetting* + stubs)
  ▼
run_menu(lua, script_bytes, name, layer_id)       nie-lua/src/menu_host.rs:397
   load_bytecode (404) → exec top-level → OnSetupLayer(layer_id) (409) → OnOpenLayer(layer_id) (415)
  ▼
MenuState { layers: { layerId → { objects: { objHash → MenuObjectState } } } }   menu_host.rs:138
   MenuObjectState: visible / sprite_texture_hash+frame / text / number / …      menu_host.rs:42
  ▼
[CIBLE, NON FAIT] renderer applique ces mutations PAR-DESSUS build_sprite_list   nie-game/src/main.rs:1143
   join objbin.name → objHash via crc32(name)  (cfgbin.rs:625)
```

Le moteur expose ~616 scripts sous `data/common/script/lua/` (`lib.rs:10`). `niers` exécute le **bytecode d'origine** dans sa VM exacte (mlua `lua52`+`vendored`) — supérieur à iecode qui décompile via `unluac` puis réinterprète sous MoonSharp (chemin lossy, `LuaRuntime.cs:13-16`).

### Référence iecode (vérité terrain de la sémantique)

`LuaRuntime.cs` injecte les mêmes globals (`funcLuaMenuCommand` `:258`, `INCLUDE` `:298`, `NameSetting*` `:311-333`) et récupère les callbacks `OnSetupLayer`/`OnOpenLayer`/`OnCloseLayer`/`OnCloseEndLayer`/`OnChangeLayerGroup` (`:242-246`). `GameLuaHost.cs:41-110` est le dispatch sémantique de référence (~28 commandes). Tests qui ancrent les hash et la convention (note : `FuncLuaCommands_LoadsReversedMenuCommands` et les `MenuCommand_*` sont gardés par `if (!File.Exists(CmdIdsPath)) return;` — ils encodent les hash dans la source mais sont SKIPPÉS ici faute du JSON) :

- `GameLuaHostTests.cs:49-51` — hash confirmés `SetSprite=0xE15FD945`, `SetObjectVisible=0x2A64B198`, et `FuncLuaCommands` charge **≥ 20** commandes `funcLuaMenuCommand`.
- `GameLuaHostTests.cs:119` — `SetText=0x4096E67E`.
- `LuaRuntimeTests.cs:80-114` — `qrcode_menu.lua.bin` : `OnSetupLayer(292844459)` (= `general_win`) émet ≥ 2 commandes ; décompilé : `funcLuaMenuCommand(1018283794, 1189944233, 0)` puis `funcLuaMenuCommand(1848885328, 292844459, …)`.
- `LuaRuntimeTests.cs:202-239` — `savedata…` : `OnOpenLayer(536044352,1)` émet `cmdId 711242136` (= `0x2A64B198` = `SetObjectVisible`) ; `OnChangeLayerGroup` émet `711242136` + `532421851`.

Le mapping `cmdId → nom` complet vit dans `re/lua/funclua-cmdids.json` (chargé par `FuncLuaCommands.Load` `:36`, recherché par `LoadDefault` `:67`) **+** `re/menu/hash-dictionary.json` (résolution `hash → nom`). **Ces deux fichiers sont absents de ce checkout iecode et du repo `niers`** (vérifié : `find … funclua-cmdids.json / hash-dictionary.json` → vide ; l'arbre `iecode/re/` ne contient qu'un `re/rag/` vide). `cmdId = CRC32(nom C++ interne)` mais le forward-lookup n'est **pas** confirmé — les noms sont inférés des patterns d'arguments (`FuncLuaCommands.cs:9-12`).

### État du portage

#### FAIT

- **Modèle `MenuState`** (`menu_host.rs:138`) / `MenuLayerState` (`:96`) / `MenuObjectState` (`:42`) — miroir exact champ-pour-champ de `MenuState.cs` iecode (visible, active, sprite_texture_hash, frame, color_hash, color_rgba, text, number, scroll_index, scale, badge, progress ; layer : visible/enabled/focus/current_item ; groups). Objets keyés par hash CRC32 (`MenuLayerState::obj` `:127`).
- **`install_menu_host`** (`menu_host.rs:251`) — enregistre `funcLuaMenuCommand` (dispatch `:262`) + `funcLuaCommand/Action/Camera/SpTactics` (stubs `0`) + `NameSettingBegin/AddNames/NameSettingEnd` + `IsCloseEndListLayer→false` + `waitTrue/waitFalse/SetGuideStatusToLua` + stubs observés (`UpdateDetailWindowAttachBase`, `SaveAndShowWaitWindow`, `UploadSaveData`, `OnCloseEndLayerCommon`, `OnChangeLayerGroupCommon`). Aligné sur `LuaRuntime.InjectGlobals`.
- **`install_include`** (`lib.rs:93`) — système de modules `INCLUDE(name)` adossé au VFS (résolveur `name → bytecode`), exécuté dans la MÊME VM (global posé `:114`).
- **`run_menu`** (`menu_host.rs:397`) — `load_bytecode` → exec top-level → `OnSetupLayer` (tolérant aux erreurs, `:409`) → `OnOpenLayer` (`:415`).
- **VM réelle** — `load_bytecode` (`lib.rs:66`) charge le bytecode Lua 5.2 PUC-Rio du jeu dans la VM `new_vm` (`lib.rs:52`) qui appelle `mlua::Lua::unsafe_new` (`:55`). Outil de bring-up `discover_host_calls` (`:129`) pour révéler l'API hôte.
- **Preuve bout-en-bout** — `loading_menu_trial_1.03.64.lua.bin` peuple réellement le `MenuState` (≥ 1 layer, ≥ 1 objet, ≥ 1 commande connue) ; assertion forte `lib.rs:444-501`.
- **Hash Level-5** disponible — `crc32` (poly IEEE `0xEDB88320`) `nie-formats/src/cfgbin.rs:625` — c'est la fonction qui relie `objbin.name` → `objHash` du `MenuState`.

#### INCOMPLET — 3 cmdId sur ~28

`dispatch_menu_command` (`menu_host.rs:323`) ne connaît que **3** hash (constantes `:162-164`) :

| Hash | Commande | Arm |
|:--|:--|:--|
| `0x2A64B198` | `SetObjectVisible(obj, visible)` | `:331` |
| `0xE15FD945` | `SetSprite(obj, texHash, frame?, colorHash?)` | `:339` |
| `0x4096E67E` | `SetText(obj, hash|string)` | `:352` |

Tout autre `cmdId` tombe dans `unknown_cmd_log` (`:367`, champ `:145`) sans crash. Les champs `active/frame/color_rgba/number/scroll_index/scale/badge/progress` et `layer.focus/current_item/groups` **existent** dans le modèle mais **aucun arm ne les renseigne**. iecode en gère ~28 (`GameLuaHost.cs:60-107`) : `SetGroupVisible, SetLayerVisible/Enabled, SetFocus, SetCurrentItem, ClearLayer, SetObjectActive/Flag, SetButtonEnabled, SetIconTexture, SetColorTint, SetObjectColorRGBA, SetTextMulti, SetNumericDisplay, SetObjectNum, SetBadge, SetProgressBar, SetObjectScale, SetScrollIndex` (+ journalisés `RegisterLayer, PlayAnimation, LoadSubLayer, SetSortKey, SetObjectParam, SetObjectPosition, SetListItemData`).

Aussi incomplet : `SetSprite` stocke `tex_hash` brut sans résolution `texHash → .g4tx` ; `SetText` stocke le hash en hex (`menu_host.rs:359`, branche numérique `:357`) sans résolution vers la table de texte (pas d'équivalent du `TextResolver` iecode — propriété `GameLuaHost.cs:26`, logique de résolution `TextValue` `:117`).

**Comment reverser les cmdId manquants** (par ordre de coût) :
1. **Porter** `re/lua/funclua-cmdids.json` + `re/menu/hash-dictionary.json` depuis l'arbre iecode complet (le travail de reverse est déjà fait là-bas ; il manque juste les données dans ce checkout) ; ajouter un chargeur Rust et un `dispatch` table-driven plutôt que 3 constantes.
2. **Découverte runtime** — exécuter les scripts `title02`/`mainmenu01` avec le host actuel et lire `unknown_cmd_log` (agrégé global `lib.rs:428-436`) : donne exactement les `cmdId` distincts que CES deux écrans émettent, à mapper en priorité.
3. **nie-trace live** — lire le handler C++ `funcLuaMenuCommand` dans `nie.exe` (table de dispatch `switch(cmdId)`) pour la sémantique byte-exacte, ou lire le `MenuState` directement en mémoire process (`nie-mem.exe`, cf. mémoire « RE mémoire live »).

#### NON_FAIT — branchement renderer + chargement des scripts

- **`nie-game` ne dépend pas de `nie-lua`** : `crates/engine/nie-game/Cargo.toml` (section `[dependencies]` `:17`) ne liste comme crate interne que `nie-formats` (`:18`) ; `grep nie-lua` sur tout le crate `nie-game` = vide. Le `MenuState` n'est donc **jamais construit ni consommé** par le rendu. `build_sprite_list` (`main.rs:1143`) compose le pur layout statique : itère objbin (`:1152`) → g4pkm → g4tx → `menu::assemble_object` (`:1278`, `nie-formats/src/menu.rs:141`) → tri par `draw_priority` (`:1283`). Aucune visibilité/sprite/texte n'est appliquée. C'est la cause directe du gap (bind-pose, widgets vides).
- **Mapping écran → script absent** : aucune logique ne relie `title02`/`mainmenu01` à leur `.lua.bin`. La convention de chemin VFS `data/common/script/lua/menu/*.lua.bin` est confirmée (`lib.rs:249,324,541`), mais **les basenames exacts** des scripts de ces deux écrans ne sont pas encore énumérés (index VFS `cpk_list.cfg.bin` chiffré AES — 12,9 Mo sur disque ; packs `.cpk` = 933 fichiers / 57 Go compressés CRILAYLA via `crilayla.rs` → noms non grep-ables sur disque ; les dossiers `data/dx11/menu/.../title02|mainmenu01` n'existent pas sur disque, ce sont des chemins virtuels VFS). À obtenir en énumérant le VFS monté (filtre `script/lua/menu/` + match `title`/`mainmenu`).
- **Join `crc32(objbin.name) → objHash`** non implémenté (la brique `crc32` existe pourtant, `cfgbin.rs:625`).
- **Rendu des widgets texte/nombre** non fait : les objets `title02` qui skippent « pas de g4tx_path » sont des widgets de texte/runtime ; leur contenu vient de `SetText`/`SetNumericDisplay`, pas d'une texture statique.

### Plan de travail (ordre conseillé)

1. **Brancher** `nie-lua` dans `nie-game` (`Cargo.toml`), puis dans `build_sprite_list` (`main.rs:1143`) : après `Vfs::init`, charger le `.lua.bin` de l'écran, `install_menu_host` + `install_include`, `run_menu(OnSetupLayer→OnOpenLayer)` avec le `layerId` de l'écran, récupérer le `MenuState`.
2. **Join** : pour chaque objbin object, calculer `crc32(obj.name)` (`cfgbin.rs:625`) = `objHash` ; chercher `MenuState.layer(layerId).objects[objHash]`.
3. **Appliquer l'overlay** dans l'assemblage/compose :
   - `visible == false` → ne pas blitter (skip du sprite) ; idem `layer.visible` / `groups`.
   - `sprite_texture_hash = Some(h)` → résoudre `h → .g4tx` via VFS (par hash de nom) et décoder le DDS au lieu du `Texture` statique de l'objbin ; appliquer `frame` (atlas) et `color_*`.
   - `text = Some(...)` → rendre le widget texte (objets sans g4tx) ; résoudre `hash → texte` via table de texte localisée.
   - `number = Some(n)` → rendre le numérique (ex. `212`/`99`) via `PrimitiveComponent.number_setting_hashes` de l'objbin (`objbin.rs:153`/`:157`).
4. **Étendre les cmdId** : remplacer les 3 constantes de `dispatch_menu_command` (`menu_host.rs:323`) par une table `cmdId → handler` chargée de `funclua-cmdids.json` (portée d'iecode), couvrant les ~28 noms de `GameLuaHost.cs:60-107` ; renseigner les champs déjà présents du modèle.
5. **Résolveurs** : `SetSprite(texHash) → g4tx` (VFS par hash) ; `SetText(hash) → table texte` (équivalent `TextResolver`/`TextValue`, `GameLuaHost.cs:26`/`:117`).
6. **Énumérer** les scripts `title02`/`mainmenu01` dans le VFS monté + fixer le `layerId` d'ouverture (iecode utilise `general_win=292844459` pour `qrcode_menu` ; le hash de layer de title/mainmenu reste à déterminer).

## 9. Atlas / 3D in-menu / blend / GPU

### A. Region d'atlas (g4tx sub-textures)
Parseur : FAIT. `G4txSubTexture {id,name,x,y,w,h}` (`crates/engine/nie-formats/src/g4tx.rs:103-116`), champ `sub_textures` (`:137`), boucle `entry_id==i` (`:244-262`), golden gaiji 117 regions (`:401-405`).
Compositeur : NON_FAIT. `build_sprite_list` prend la 1re texture DDS (`crates/engine/nie-game/src/main.rs:1263`, `find(|t| t.is_dds)`), `decode_texture_rgba` decode le DDS ENTIER (`main.rs:204-240`), UV quad en dur (`main.rs:1404-1418`) ; `sub_textures` jamais consomme hors g4tx.rs (grep). Index region non resolu (candidat `CSetupMeshVisible.meshNameCrc` `objbin.rs:222-238`).
Travail : resoudre l'index, cropper `[x..x+w]x[y..y+h]`, remap UV (`build_sprite_quad` `main.rs:1387` / `menu.rs:234-235`).

### B. Modeles 3D dans le menu
Skippes : `mainmenu04_03_chara_model` / `mainmenu01_08_chara_3d_shadow` = `pas de g4tx_path` (`/tmp/mainmenu.log:64,:97`), skip `main.rs:1233-1234` -> vignettes perso absentes.
Assemblage 3D : FAIT hors menu. `assemble_character_model` -> GLB (`crates/engine/nie-formats/src/assemble.rs:882-927`) ; mailles STATIQUES zero skinning (`:52-59`) ; non importe par nie-game.
Rendu 3D host : NON_FAIT. 2D pur, pas de depth/camera (`main.rs:1516`). Port D3D11 `render.rs:1-34` reference RE Windows-only (`:26-28`) non cable = INCOMPLET.
Travail : router objbin `g4tx_path==None`+`g4pkm_path!=None` -> passe 3D offscreen (depth, camera `camera_name_hash`, pose g4pkm/g4sk, RT) -> sprite selon `draw_priority` ; `chara_3d_shadow` = passe ombre.

### C. draw_type / blend / camera / GPU wgpu
RenderComponent FAIT : `draw_priority`, `draw_type` (0=normal,1=additif `objbin.rs:113`), `camera_name_hash` (`objbin.rs:107-116,668-691`).
Consommation INCOMPLET : seul `draw_priority` utilise (`menu.rs:147-154`, tri `main.rs:1283`) ; draw_type+camera ignores -> glows neons en alpha-over normal.
Pipeline wgpu FAIT (1 mode) : blend premult-alpha over One/OneMinusSrcAlpha (`main.rs:1491-1502`), premultiply/unpremultiply (1584/1601), Rgba8Unorm sans sRGB (1683,1691), sampler lineaire ClampToEdge (1567-1578), NDC 640/360 (1373-1375).
--verify FAIT : CPU vs GPU pre-multiplie, seuil >=99% a +-4/255 (`main.rs:1815-1854`).
Pixel-perfect : (1) blend par sprite NON_FAIT (2e pipeline additif One/One si draw_type==1, propager draw_type perdu apres tri 1283) ; (2) camera NON_FAIT ; (3) sRGB open question (`render.rs:145` = format DXGI sRGB ; host fenetre choisit explicitement un format non-sRGB `main.rs:1988-1993`, RT headless Rgba8Unorm `main.rs:1683`) ; (4) bump wgpu 22->29 NON_FAIT (`crates/engine/nie-game/Cargo.toml:23`, `docs/STACK.md:13,24-28,33`).

--- open_questions ---
index de region d'atlas par objbin non resolu (candidat meshNameCrc)
backbuffer nie.exe sRGB ou non (`render.rs:145` sRGB DXGI vs host : RT headless Rgba8Unorm `main.rs:1683` + surface fenetre forcee non-sRGB `main.rs:1988-1993`)
semantique draw_type>=2 ; resolution camera_name_hash->matrice

## 10. Gate pixel-perfect + référence

But du gate : prouver que le rendu niers d'un écran est **identique au vrai `nie.exe`**, pas seulement
auto-cohérent. La doctrine est un gate **à deux étages** : égalité octet d'abord, SSIM ensuite. Cette
section sépare ce qui est conçu (papier), ce qui est codé (auto-cohérence interne), et ce qui manque
réellement (la capture de référence du jeu) pour transformer le gate en *preuve* d'identité.

### Le gate conçu (FAIT sur le papier, NON_FAIT en code)

`docs/STACK.md:20` (ligne « Gate pixel-diff » du tableau) et `docs/PLAN.md` (pilier Rendu)
définissent le même gate à deux étages :

1. **Égalité octet d'abord** — hash (`sha2`/`blake3`) du **RGBA8 dé-paddé**. C'est désigné comme « la
   **vraie preuve d'identité** » (`STACK.md:20`). Le padding à retirer est l'alignement
   `wgpu::COPY_BYTES_PER_ROW_ALIGNMENT` = **256 o/ligne** du readback `texture→buffer`.
2. **Tolérance ensuite** — **SSIM ≥ 0,99 / PSNR** via `image-compare 0.5.0`, qui exige des dimensions
   identiques (d'où le dé-paddage en amont) et fournit `to_color_map()` → diff-map PNG pour **localiser
   l'écart** (`STACK.md:20`).

Choix de briques figés (`STACK.md:20`) : `dssim-core` **rejeté** (AGPL-3.0, incompatible MIT) ;
`image-compare` retenu ; `cargo-nextest` en **process-per-test** pour isoler le device wgpu ; goldens
à `crates/engine/nie-game/tests/golden/<scene>.png` ; **mode bless `UPDATE_GOLDEN=1`**. Doctrine générale
(`STACK.md:36`) : l'égalité octet est la preuve, SSIM/PSNR n'est qu'un filet de régression.

**État réel du code (vérifié)** :
- `image-compare`, `blake3`, `nextest.toml` : **absents** du repo (grep `Cargo.toml`, `.config` : 0
  occurrence). `sha2 = "0.10"` existe (`Cargo.toml:61`) mais n'est utilisé que pour hasher des
  binaires (`crates/tools/nie-cli/src/main.rs:12,1015`), **pas** des pixels.
- L'alias `cargo xt = nextest run --workspace --all-features` existe (`.cargo/config.toml`) mais
  `cargo-nextest` **n'est pas installé** sur la machine.
- Aucun répertoire `crates/engine/nie-game/tests/` ni `golden/` (FAIT : inexistants).
- `crates/engine/nie-game/Cargo.toml` épingle encore **`wgpu = "22"`** : le bump D1 22→29 de `STACK.md:13`
  n'est **pas** fait.
- En revanche le **dé-paddage 256 o est déjà implémenté** côté capture : `cmd_capture`
  (`crates/engine/nie-game/src/main.rs:908-948`) et le readback GPU de menu
  (`crates/engine/nie-game/src/main.rs:1762,1789-1800`) reconstruisent un buffer RGBA8 dé-paddé.

→ Le gate est **entièrement spécifié mais à 0 % câblé** ; le seul morceau présent est le dé-paddage
du readback.

### `--verify` est de l'auto-cohérence, PAS une comparaison au jeu (FAIT)

`nie-game --menu <SCREEN> --gpu --capture out.png --verify` (`crates/engine/nie-game/src/main.rs:20-22,
100-104`) compare le rendu **GPU** au **compositeur CPU `menu::compose`** (`main.rs:1816-1830`), en
espace pré-multiplié, via `comparer_cpu_gpu` (`main.rs:1623-1646`) : échec si < 99 % des pixels sont
dans une tolérance de **4/255 par canal** (`main.rs:1846-1853`). Canvas de référence : 1280×720
effacé en **transparent** (`main.rs:1739-1744`).

Les **deux côtés sont produits par niers** (GPU wgpu vs compositeur CPU maison). `--verify` prouve
donc l'**équivalence du pipeline CPU↔GPU** — un filet de régression interne utile — et ne dit
**rien** sur la conformité à `nie.exe`. Ce n'est pas le gate pixel-perfect.

### Capture de référence : la vérité manquante (partiellement résolue)

La vérité = une frame du vrai `nie.exe`. Sans elle, **aucun SSIM n'est calculable**
(`docs/PLAN.md` : « nécessite une capture de référence du vrai jeu — aucune mesure SSIM encore,
pas de prétention pixel-perfect »). Options évaluées :

- **(a) Screenshot WSLg/Windows du jeu lancé directement** — **FAISABLE et déjà fait**. Le jeu tourne
  (nie.exe Steam, lancé directement et non via EACLauncher, cf. `crates/forge/nie-trace/scripts/boot-nie-windows.sh`) ;
  EAC ne bloque pas la capture d'écran (seulement `ReadProcessMemory`). C'est manifestement la source
  de `start.png`/`menu.png`.
- **(b) Backbuffer via `nie-trace`** — **NON viable aujourd'hui**. `nie-trace` est un **lecteur de
  mémoire** (`OpenProcess`+`ReadProcessMemory`, sous-commandes find-pid/maps/base/read/dump/scan/patch-eac,
  cf. `crates/forge/nie-trace/Cargo.toml`, `src/win_memory.rs`), **pas** un grabber de framebuffer. Le
  backbuffer D3D11 réside en VRAM, non pageable et non lisible par RPM ; il faudrait hooker `Present()`
  ou une staging texture — hors périmètre de la crate. Coût élevé, non implémenté.
- **(c) Les `.png` fournis** — **meilleure référence disponible**. ATTENTION : la résolution réelle
  est **2560×1440 RGBA8** (`file start.png menu.png`), **pas** 600×340 comme l'indiquait la consigne ;
  ils ont été **re-capturés le 2026-06-14 (18:15/18:16)**. Contenu vérifié visuellement :
  `start.png` = **title02** (logo IEVR + « COMMENCER » + « ver 6.0.2 0.79 240 ») ; `menu.png` =
  **mainmenu01** (AVATAR / VICTOIRES 212 / VOTRE ÉQUIPE, panneau d'icônes, « Guide joueur »). Ce sont
  bien des frames du **vrai jeu** (niers ne sort que du 1280×720 et ne rend pas ces écrans complets).
  Ils ne sont **référencés nulle part** dans le code/docs/scripts (grep : 0 occurrence).

**Verdict** : (a) et (c) désignent **le même artefact** — les deux PNG 2560×1440 sont le **seul golden
exploitable** aujourd'hui. (b) est écarté faute d'outil de capture de framebuffer.

Limites de ce golden : (1) résolution = **2× la résolution canonique** niers (voir plus bas), donc
ré-échantillonnage obligatoire ; (2) **frame unique choisie à la main**, phase d'animation idle non
contrôlée ; (3) **contenu dynamique** spécifique au compte (« VICTOIRES 212 », « NIVEAU DE L'ÉQUIPE
99 », bandeau « Joueurs saisonniers », badge « Deluxe Edition », overlay « ver 6.0.2 0.79 240ʼ») qui
ne matchera **jamais** un layout statique.

### Scaffolding de test (NON_FAIT — spécification)

Résolution canonique : **1280×720** (`crates/engine/nie-game/src/main.rs:1670-1671`, `CW=1280`/`CH=720`).
Les références sont **2560×1440** = **exactement 2×**, et les deux sont en **16:9** (1,778) — donc
**même aspect, aucun letterbox** (l'ancien 600×340 ≈ 1,765 du prompt n'est plus d'actualité).
Politique de ré-échantillonnage à figer : soit downscale box ×½ de la réf vers 1280×720, soit rendre
niers à 2560×1440 ; tout resampling **casse l'égalité octet** (réservé à l'étage SSIM).

Deux **baselines distinctes** à ne pas confondre :
- **Golden de régression** = sortie niers *blessée* (`UPDATE_GOLDEN=1`) → cible de l'**étage 1 octet**
  (détecte les régressions niers, CPU==GPU, déterminisme run-to-run).
- **Référence jeu** = `start.png`/`menu.png` ré-échantillonnés → cible de l'**étage 2 SSIM** (seule
  chose qui prouve l'identité au jeu).

Spec proposée, alignée sur `STACK.md:20` :
1. Déposer les références canoniques `crates/engine/nie-game/tests/golden/{title02,mainmenu01}.png` (1280×720,
   downscalées 2× depuis les refs 2560×1440).
2. Test `#[test]` par écran, **un test = un process** (nextest process-per-test) pour isoler le device
   wgpu ; lancé par `cargo xt`. Prérequis : installer `cargo-nextest`, ajouter `image-compare` (et
   `blake3`) en `[dev-dependencies]` de `nie-game`.
3. **Étape 1** — `blake3`/`sha2` du RGBA8 dé-paddé vs le golden de régression ; bless `UPDATE_GOLDEN=1`.
4. **Étape 2** — SSIM `image-compare` vs la référence jeu (ré-échantillonnée), seuil **≥ 0,99** ; si
   échec, écrire la diff-map `to_color_map()` pour localiser l'écart.
5. **Masques ROI** sur les régions dynamiques (compteurs, version, bandeau saisonnier) exclues du SSIM
   et **jamais** soumises à l'étage octet.

### Ce qui bloque la preuve pixel-perfect (honnêteté)

- **L'égalité octet vs un screenshot du jeu est IMPOSSIBLE** pour l'écran composé : (1) mismatch de
  résolution + resampling, (2) **rasterizer différent** (GPU réel du jeu vs wgpu/lavapipe niers : AA,
  filtrage, arrondis ≠ bit-à-bit), (3) contenu dynamique. L'étage octet reste la preuve pour les
  **formats/données** (cf. `docs/PLAN.md`) et pour le **déterminisme interne** de niers, **pas** face
  au screenshot. La phrase « égalité octet = vraie preuve d'identité » (`STACK.md:20`) ne vaut donc
  que contre un golden produit par niers, pas contre la réf jeu.
- **Le SSIM est le gate réaliste vs le jeu, mais inatteignable aujourd'hui** car le rendu est
  incomplet : `title02` = sprites en **bind pose** (canvas quasi vide, `/tmp/niers-shots/title02.png`
  = 44987 o, surtout transparent) ; `mainmenu` = **22/117** sprites mal placés, fonds absents (« g4pkm
  absent du VFS ») et widgets texte ignorés (« pas de g4tx_path ») (`/tmp/mainmenu.log`). SSIM actuel
  ≈ 0.
- **Aucun harnais golden n'est câblé** (ni test, ni dép, ni nextest installé).
- `docs/PLAN.md` classe le pilier **Rendu** comme gaté sur le driver de menu (Δpixel non mesuré).

→ **État du gate aujourd'hui : filet de régression interne (CPU==GPU via `--verify` + déterminisme),
PAS une preuve d'identité au jeu.** La preuve pixel-perfect reste **NON_FAIT** ; son déblocage exige,
dans l'ordre : (1) compléter le placement/fonds du rendu, (2) câbler le harnais à deux étages, (3)
geler une frame de référence déterministe (état de sauvegarde contrôlé) à la résolution canonique.

## 11. Plan d'exécution (vagues gatées)

> S'insère dans le pilier Rendu de `docs/PLAN.md`. Chaque vague = livrable réel + **gate vérifiable**.
> Ordre choisi pour maximiser le signal visible : les deux premières vagues (placement + sélection de
> texture) débloquent à elles seules la majorité des sprites **statiques** de `title02`.

**Vague D1.a — Placement ancêtre-fallback (couche 1).** Porter `GetMotionFinalPose` +
`FindPlacementBoneIndex` (réf iecode `G4pkmMotion.cs:84-192`) dans un module
`nie-formats/src/g4pkm_motion.rs` ; **ce n'est pas un interpolateur de keyframes** (la donnée n'existe
pas dans les fichiers) mais le fallback : si le bone de placement est hors-écran (`is_off_screen_1920`,
`g4pkm.rs:124`), remonter via `parent_index` (`g4pkm.rs:138`) au premier ancêtre on-écran en
**conservant la scale du bone feuille**. Toutes les structures existent déjà. Brancher dans
`menu.rs::place_on_canvas` (utiliser cette pose au lieu de la bind pose brute). *Gate* : golden byte
vs `G4pkmMotionTests.cs` (cas `OffScreenBaseWithOnScreenParent`) + `--menu title02` ne place plus aucun
objbin hors-écran.

**Vague D1.b — Sélection de texture + région d'atlas (couche 2).** Ne plus piocher la 1ʳᵉ DDS
(`main.rs:1263`, souvent un dummy 4×4) : sélectionner la texture **nommée par le matériau/mesh**
(`g4md.rs:108`) et **cropper la sous-région** (`g4tx::G4txSubTexture`, déjà parsée `g4tx.rs:167-272`)
en remappant l'UV (`build_sprite_quad`, `main.rs:1387`). *Gate* : title02 (07/10/11/12/21) rendent
leur vraie texture, pas un carré invisible ; sous-image correcte recoupée iecode.

**Vague D1.c — Runtime Lua branché (couche 3).** Ajouter `nie-lua` aux deps de `nie-game` ; après
`Vfs::init`, charger le `.lua.bin` de l'écran (`data/common/script/lua/menu/<screen>.lua.bin`),
`install_menu_host` + `install_include`, `run_menu(OnSetupLayer→OnOpenLayer)` → `MenuState`. Join
`crc32(objbin.name)` (`cfgbin.rs:625`) → `objHash`, puis appliquer dans `build_sprite_list` :
`visible=false` → skip ; `sprite_texture_hash` → texture VFS+frame ; `text`/`number` → widget ;
**masquer** les widgets DLC/save non pertinents. Étendre `dispatch_menu_command` (3 → ~28 cmdId,
table-driven depuis `funclua-cmdids.json` à rapatrier d'iecode ; sinon découverte via
`unknown_cmd_log` sur ces 2 écrans). *Gate* : la rangée d'icônes catégories de mainmenu01 apparaît ;
objets cachés masqués ; aucun widget DLC sur title vierge.

**Vague D1.d — Texte (couche 4).** (i) Voie rapide : substituer `<LG>` dans `resolve_vfs_basename`
(`main.rs:1117-1126`, bug : matche par basename seul) → libellés **pré-rendus** corrects (Deluxe
Edition, légal, gtxt_). (ii) Voie police : reverser le format **`.g4tg`** (métriques glyphes, chemin
`g4.rs:789`, NON parsé ni dans niers ni iecode) + rasteriseur de glyphes depuis `font_def.g4tx`
(4096×2048) / `gaiji_game.g4tx` (117 régions) ; résoudre `MenuTextSetting` (hash → table
`common/text/<locale>/`, modèle déjà porté `passives.rs:269-353`). *Gate* : COMMENCER / ver 6.0.2 /
VICTOIRES 212 / NIVEAU 99 corrects, bonne locale.

**Vague D1.e — Modèles 3D in-menu (couche 5).** Router les objbin `g4tx_path==None && g4pkm_path!=None`
vers une passe 3D offscreen (`assemble.rs` corps+visage+uniforme, déjà FAIT hors menu ; caméra
`camera_name_hash`, pose g4pkm, depth) → vignette composée selon `draw_priority` ; `chara_3d_shadow` =
passe ombre. *Gate* : silhouette/pose AVATAR + VOTRE ÉQUIPE recoupées au jeu.

**Vague D1.f — Blend par draw_type + GATE pixel (couche 6/G).** 2ᵉ pipeline blend **additif**
(`One/One`) quand `draw_type==1` (propager `draw_type`, perdu après le tri `main.rs:1283`) — glows/néons
verts. Puis câbler le **harnais à deux étages** : installer `cargo-nextest`, ajouter `image-compare` +
`blake3` en `[dev-dependencies]` de `nie-game` ; goldens `crates/engine/nie-game/tests/golden/{title02,
mainmenu01}.png` (réf jeu 2560×1440 downscalée ×½ en 1280×720) ; étage 1 = hash RGBA8 dé-paddé
(régression interne) ; étage 2 = SSIM ≥ 0,99 vs réf jeu avec **masques ROI** sur les régions dynamiques
(compteurs, version, bandeau saisonnier). *Gate* : SSIM ≥ 0,99 hors ROI sur les deux écrans =
**objectif pixel-perfect atteint pour la tête de pont**.

### Dépendances entre vagues

```
D1.a (placement) ──┐
D1.b (texture)   ──┼─► title02 sprites STATIQUES visibles & bien placés ─► D1.f (gate) sur title02
D1.c (lua)       ──┘                                                         (hors texte composé)
D1.d (texte) ─────────► COMMENCER/ver/labels      ┐
D1.c (lua) + D1.e (3D) ─► mainmenu01 panneaux      ┴─► D1.f (gate) sur mainmenu01
```

`title02` atteint le gate **avant** `mainmenu01` (statique-dominant vs runtime-dominant). C'est la
trajectoire la plus courte vers une première preuve SSIM.

## 12. Honnêteté (limites tenues)

- L'**égalité octet vs un screenshot du jeu est impossible** pour l'écran composé (résolution 2×,
  raster GPU réel ≠ wgpu/lavapipe, contenu dynamique par compte). L'étage octet reste la preuve pour
  les **formats/données** et le **déterminisme interne** de niers ; vs le jeu, seul le **SSIM hors ROI**
  prouve l'identité.
- Tant que le placement/fonds ne sont pas complétés, le SSIM réel ≈ 0 : la preuve pixel-perfect est
  **NON_FAIT** ; son déblocage suit l'ordre D1.a → D1.f.
- `mainmenu01` dépend de sous-systèmes lourds (Lua + 3D + primitives + police) : son gate arrive
  **après** celui de `title02`. Ne pas confondre « écran cartographié » et « écran rendu identique ».

