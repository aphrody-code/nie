# `mainmenu01` — mesures et analyse visuelle

Pour l'implémentation complète du rendu pixel-perfect du moteur, voir [DESIGN.md](DESIGN.md).

## Sources et décisions

| Décision | Source mesurée | État au 2026-09-07 |
|---|---|---|
| Nom VFS du fond | `data/common/gamedata/menu/obj/mainmenu01_00_background.objbin` | conservé verbatim |
| Géométrie de la rangée | `data/menu/main_menu.png`, mesurée par `scripts/validation/measure-mainmenu.py` | figée dans `packages/inacord-ui/src/shell/main-menu-geometry.ts` |
| Construction dynamique | `*_menu_setting.cfg.bin` + appels Lua `funcLuaMenuCommand` | driver typé branché ; composition incomplète |
| Référence pixel | `data/menu/main_menu.png`, 2560×1440, réduite à 1280×720 par le comparateur | référence suivie ; la surimpression de capture en bas à droite reste dans l'image |
| Rendu candidat | `/tmp/nie-main-menu-after.png`, produit localement par `target/release/nie-game` | 2 sprites principaux, 8/8 icônes de tuiles et le badge Deluxe Edition VFS placés |

## Layout runtime servi par le navigateur (2026-09-08)

Le layout embarqué par `apps/nie-web` provient désormais de l'exécution réelle du menu, et non
d'une liste statique d'assets : `nie-game --menu main_menu --from-setting --runtime
--export-layout … --screen-name mainmenu01`. Le fichier contient **30 objets**, dont **22
visibles**, **21 sprites**, **19 valeurs de texte affichables**, **13 textures distinctes**,
**7** positions encore au centre par défaut et **2** points d'ancrage hors canevas. Les valeurs
directes établies par `SetText` et `SetObjectNum` sont normalisées par `lireLayout()` afin que le
même rendu fonctionne dans nie-web et Inacord.

Cet export reste l'oracle runtime du navigateur, mais le composant actuellement servi
(`apps/nie-web/src/pages/MainMenu.tsx`) reconstruit encore la composition en React à partir des
textures VFS. Il ne monte plus `LayoutRender`. Les 7 placements par défaut et la traduction des
mutations C++/Lua vers le renderer restent donc des limites connues ; cette intégration ne les
présente pas comme une fidélité pixel-perfect.

## Couverture des commandes runtime du menu principal (2026-09-08)

Le script VFS exact `main_menu_1.02.92.00.lua.bin` émettait encore deux commandes menu inconnues.
La table de dispatch du `nie.exe` local les relie aux handlers `0x140CCC800` et `0x140CE84A0` :

- `0x555E4093` est appelé par le wrapper Lua exact `MAIN_MENU.SetUseSaveButton`. Le handler
  résout le layer et le composant de guide, écrit le booléen à `+0xED` et son dirty flag à
  `+0xEF` ;
- `0xE57428CF` résout `(objectId, value, index, layerId)`, écrit l'entier à `object+0x124` puis
  invalide `object+0x168`. Aucun wrapper nommé n'est livré pour cette commande : le modèle Rust
  conserve donc le nom neutre `native_field_0x124_by_index` au lieu d'inventer sa sémantique.

Après portage dans `nie-lua`, le même export compte **105 événements demandés / 102 dispatchés /
102 réussis**, **128 commandes menu connues**, **0 commande menu inconnue**, **10 objets mutés**
et **26 correspondances runtime**. La baseline précédente donnait respectivement 126, 2, 9 et
25. Les **15 identifiants de commandes générales** encore inconnus sont une frontière distincte
et restent visibles dans `runtimeSummary.unknownGeneralCmds`.

Mesure rejouée depuis `/home/ubuntu/niers` le 2026-09-08 :

```text
cargo run -p nie-game --release -- --menu main_menu --from-setting --runtime --export-layout /tmp/mainmenu-runtime-after.json --screen-name mainmenu01
cargo test -p nie-lua --lib
cargo clippy -p nie-lua --lib --tests -- -D warnings
```

La suite `nie-lua` rend **112 tests passés / 0 échec / 1 ignoré** et Clippy **0 avertissement**.

## Synthèse des mesures d'angle et de géométrie (2026-09-06)

- **Angle des tuiles de la rangée** : pente mesurée à **dx/dy = -0,400** (angle exact -21,80°, R² = 1,000).
- **Panneau droit** : pente mesurée à **dx/dy = -0,546** (angle -28,63°, R² = 1,000).
- **Palette mesurée sur capture 2048×1159** :
  - Fond dominant (69,0%) : `#F9FDF9` (Oklch 0,990 0,007 145°)
  - Bleu bandeau (10,4%) : `#93D3F0` (Oklch 0,834 0,077 228°)
  - Bleu nuit tuiles (7,7%) : `#2C497C` (Oklch 0,409 0,093 261°)
  - Bleu icônes (7,1%) : `#4B8DD5` (Oklch 0,633 0,128 252°)

Script d'extraction : `scripts/validation/measure-mainmenu.py`.
Valeurs figées dans `packages/inacord-ui/src/shell/main-menu-geometry.ts`.

## Baseline de fidélité rejouable (2026-09-07)

La capture et sa comparaison ont été produites dans le checkout `/home/ubuntu/niers` avec :

```text
target/release/nie-game --menu main_menu --from-setting --capture /tmp/nie-main-menu-from-setting.png
target/release/niers img diff /tmp/nie-main-menu-from-setting.png data/menu/main_menu.png --downscale-ref -o /tmp/nie-main-menu-current-diff
```

Le VFS a monté **255 308 assets**. Le setting a fourni **13 layers** ; le moteur a exclu 10
layers parasites, produit 2 sprites principaux et placé les **8/8** icônes de la rangée. Sur la
sortie normalisée à 1280×720, soit **921 600 pixels** :

| Mesure | Avant | Après |
|---|---:|---:|
| Pixels exactement identiques | 11,49 % | **11,73 %** |
| Pixels avec ΔE ≤ 1 | 14,27 % | **14,54 %** |
| ΔE moyen | 14,26 | **13,98** |
| ΔE p99 | 92,50 | **92,42** |
| SSIM global | 0,5266 | **0,5373** |
| Pixels opaques | 100 % | 100 % |

La comparaison après modification a été rejouée depuis `/home/ubuntu/niers` avec :

```text
target/release/nie-game --menu main_menu --from-setting --capture /tmp/nie-main-menu-after.png
target/release/niers img diff /tmp/nie-main-menu-after.png data/menu/main_menu.png --downscale-ref -o /tmp/nie-main-menu-after-diff
```

Le gain de SSIM est de **+0,0107** sur la même référence et les mêmes 921 600 pixels. Trois
corrections mesurées l'expliquent :

- la rangée part maintenant de `(109,383)`, avec des tuiles `120×84`, un pas de `135`, une
  inclinaison de `30` et des glyphes `100×67`. L'ancien pas de `114` terminait la huitième
  tuile 139 pixels trop tôt. Ces valeurs viennent de la référence ramenée à 1280×720 ;
- quatre glyphes ont une correspondance visuelle directe dans l'atlas VFS
  `#/menu/200_icon/16_icon_list_tab/<LG>/icon_list_tab.g4tx` :
  `icon_list_tab_option01` (foudre), `icon_list_tab_help02` (voiture),
  `icon_list_tab_help03` (tour) et `icon_list_tab_vroad01` (trophée). Les noms sont les stems
  exacts du VFS, même lorsque leur sémantique n'est pas intuitive ; les quatre autres glyphes ne
  sont pas déclarés résolus sans preuve ;
- le badge est la texture VFS autonome
  `#/menu/220_img/logo_dlc/logo_dlc_deluxe_edition.g4tx` (360×76), ramenée à `239×50` et posée
  à `(41,603)` par recherche pondérée sur son alpha. Le check d'entitlement voisin reste un
  widget runtime distinct et n'est pas dessiné.

Cette baseline prouve que le rendu n'est **pas pixel-perfect** : la rangée de huit tuiles est
présente, mais le bandeau d'information, le logo, l'avatar, les panneaux d'équipe et les trois
actions inférieures de la référence manquent encore. La chaleur d'erreur couvre donc l'essentiel
des structures du menu. La surimpression de l'outil de capture dans le coin inférieur droit de la
référence rend le score global légèrement pessimiste ; aucune ROI n'a été exclue dans ce nombre.

Le binaire de capture reconstruit mesure **13 997 648 octets** et porte le SHA-256
`06d3d567b2765386c92871e83eaefc0775b4d053281112dade5aff7c9b16b184`. Sur une frame runtime,
le seul script `main_menu` pertinent produit **105 événements demandés / 102 dispatchés / 102
réussis**, sans erreur de callback. Les trois non-dispatchés (`PreStep`, `Step`, `PostStep`) ne
sont pas définis par le script. L'histogramme confirme 34 appels pour chacun de `OnSetupLayer`,
`OnOpenLayer` et `OnEnter`.

Le filtre précédent incluait aussi
`victory_road_main_menu_0.00.00.00.lua.bin` par simple sous-chaîne. Ce fichier VFS de **71 octets**
est un chunk Lua vide réduit à une instruction `RETURN`. Le filtrage par préfixe de basename le
retire : scripts 2→1 et événements demandés 210→105, sans changer les 102 callbacks utiles ni un
seul des 921 600 pixels. C'est une correction de travail parasite, pas une hausse de fidélité.

L'inventaire VFS ferme aussi la piste d'un simple sprite oublié : les sept OBJBIN des familles
`mainmenu01_00..05` sont présents, mais aucun G4PKM ni G4TX co-localisé n'existe pour leurs stems.
Le layout runtime expose donc `g4pkmPathStatus: "missing"` pour les composants primitifs et
`modelStatus: "runtime-model-id-required"` pour le personnage, puis compte ces deux frontières
séparément dans `runtimeSummary`. Ce diagnostic prouve ce qui manque sans appeler « géométrie
résolue » un simple chemin VFS trouvé. La suite exige la construction C++ des primitives et
l'identifiant de modèle fourni par la scène 3D ; empiler le setting d'un autre écran serait faux.

Le driver typé `MenuEvent` de `nie-lua` est maintenant branché dans `nie-game` et son scénario
standard vit dans la bibliothèque partagée. Le prochain gate conserve exactement les mêmes
commandes et la même référence après matérialisation des objets encore absents : un progrès
exige une hausse mesurée du SSIM et un rapport de callbacks
demandés, dispatchés et réussis ; un simple PNG produit ne suffit pas.
