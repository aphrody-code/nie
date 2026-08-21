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
| `roi <écran> [-o <json>]` | dérive les régions de mesure d'un écran **depuis son layout**, et déclare non dérivables celles dont la géométrie est un repli |

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
- **Les 42 écrans sont composés en image** (2026-08-20) — `var/avatar-ui/png/`, 24 Mio. Le dossier
  était vide jusque-là : aucun écran de l'éditeur n'avait jamais été rendu.
- Un écran du jeu est une **pile de calques**, pas un layout (`chara_edit_menu` en touche 2,
  `chara_edit_parts_menu` 3, `..._hair_list` 1). `--compose-layout` est donc répétable : les objets
  de tous les calques sont triés ensemble par priorité de dessin, l'ordre des options départageant
  à priorité égale. Sur les trois calques de l'éditeur : 10 → **31 éléments** composés.

## 6 bis. Ce qui bloque encore le rendu : la visibilité

Sur les **950 rectangles résolus, 34 seulement portent un objet visible — 916 attendent**. Les
sprites sont donc prêts ; ce qui manque est la décision d'affichage, prise par les scripts Lua.

Les 42 écrans totalisent **12 `cmdId` non gérés pour 1 254 appels**, dont `0x5245F000` à lui seul
1 062 (85 %). Chacun a un handler dans `data/re/funclua-cmdid-handlers.json` (3 659 entrées).

**Ces adresses sont valides pour le binaire courant** — vérifié le 2026-08-20 en régénérant la table
par `uv run scripts/extract_funclua_table.py` : **0/12 handlers ont bougé**, la table est identique
à celle du 2026-08-15. Le doute venait d'un contrôle mal posé contre `pdata_func`, table qui est
vide pour ce binaire dans `var/niers.sqlite` — l'absence d'index n'est pas une adresse périmée.
(Le script, lui, localise la table par un cmdId d'ancrage stable, précisément parce que les
handlers se déplacent d'un build à l'autre.)

Première lecture du handler `0x52BD4EDC` (42 appels, `0x140CDF730`) : prologue de fonction normal,
`cmp edx, 6` — il exige **6 arguments**, ce qui correspond exactement à la forme observée dans les
appels — puis `comisd` / `cvttsd2si`, soit des arguments **flottants convertis en entiers**. C'est
la signature d'un setter de couleur, ce que la forme des appels laissait déjà supposer
(`(objId, 1, 0.5, 0.5, 0.5, 1)`).

### Ce que le port du cmdId dominant a appris — le verrou n'est pas là

`0x5245F000` est porté (2026-08-20). Les appels non gérés de `chara_edit_parts_menu` tombent de
**364 à 7** (−98 %), les appels reconnus montent de 5 068 à 5 425. Et pourtant : **objets visibles
10 → 10, sprites mutés 46 → 46**. Le rendu ne bouge pas d'un pixel.

C'est le résultat le plus utile de cette phase, parce qu'il **déplace le verrou**. Les 916 sprites
en attente ne le sont pas à cause des `cmdId` non implémentés : le driver exécute déjà les vrais
scripts et applique leurs mutations. Implémenter les 11 restants fermerait des compteurs, pas des
pixels.

### Et ce n'est pas non plus la couche d'état — mesuré

Hypothèse suivante, naturelle : les scripts interrogeraient un état de jeu (scène, sauvegarde) que
le dépôt ne fournit pas, et renonceraient à afficher. La ventilation des commandes reconnues la
**réfute**. Sur les trois écrans les plus fournis, ~5 800 appels reconnus se répartissent ainsi :

| commande | appels |
|---|---:|
| `SetPartVisible` | 4 409 |
| retours constants (`=>1`) | 732 |
| `SetIconSprite` · `SetChildVisible` · `SetText` · … | ~600 |
| **toutes les lectures d'état réunies** | **14** |

Quatorze appels, dont dix seulement retournent la valeur par défaut. Les scripts de l'éditeur
**n'interrogent quasiment pas l'état** : ils commandent. La couche scène/sauvegarde n'est donc pas
ce qui les retient ici.

### Le verrou réel : les items de liste ne sont pas instanciés

`listItemsRecorded` vaut **0** sur `chara_edit_parts_menu` comme sur `chara_edit_recipe_menu`, alors
que ces écrans sont, à l'écran, des **grilles d'items** — c'est tout leur contenu. Les objets du
layout sont des *gabarits* ; le jeu les réplique une fois par item, à des positions que les
`CMenuAttachLocator` portent déjà. Tant que cette réplication n'a pas lieu, un gabarit reste un
objet unique, masqué, et ses 916 rectangles résolus n'ont rien à peindre.

Précision obtenue en la gravissant : les exemplaires **existent bien** dans le layout (51, 32, 16 —
issus des slots d'attache), mais ils partageaient un unique état, indexé par `crc32(nom)`. Masquer
le troisième les masquait tous, ce que les comptes montraient en bloc. La visibilité est désormais
retenue **par index** quand une commande en nomme un (2ᵉ argument de `SetObjectVisible` /
`SetPartVisible`, jusque-là ignoré) : `chara_edit_parts_menu` passe de 10 à 11 objets visibles,
`..._hair_list` de 10 à 11.

Le gain s'arrête là, et la mesure dit pourquoi : sur `chara_edit_parts_menu`, **6 objets seulement**
reçoivent une visibilité nommée, sur **2 index distincts** ; sur `chara_edit_recipe_menu`, un objet
et un index. Les scripts ne distinguent donc pas les 51 exemplaires par cet argument — il désigne
autre chose (un sous-nœud de l'objet), et les exemplaires ne sont pas commandés un par un.

### La population des listes marche — elle n'est simplement pas jouée sur ces écrans

Dernière inconnue levée. Les commandes qui peuplent une liste ont été tracées à l'exécution :

- sur **`chara_edit_menu`**, elles sont appelées et portent de vraies tables —
  `SetListItemValuesMulti` avec 3 colonnes, `SetListItemValues` avec 1, **5 items** chacune. Le
  `runtimeSummary` de cet écran affiche bien `listItemsRecorded = 5` ;
- sur `chara_edit_parts_menu`, `chara_edit_recipe_menu`, `..._hair_list` et `chara_edit_list_menu`,
  elles ne sont **jamais appelées**.

Le mécanisme n'est donc pas cassé : il fonctionne là où un script l'exerce. Ce qui manque sur les
écrans de grille n'est ni une commande à porter, ni une donnée à trouver, c'est un **scénario** :
l'export exécute `OnInit` → `OnSetupLayer` → `OnOpenLayer` sans jamais *entrer* dans une rubrique.
Les scripts qui peuplent la grille sont derrière cette navigation.

`listItemsRecorded = 0` ne signalait donc pas un défaut d'implémentation, mais une exécution qui
s'arrête avant l'endroit où le contenu apparaît.

Une piste a été essayée et **mesurée sans effet** : ajouter `OnDecideFocus` à la séquence pilotée
(le driver joue `OnInit`, `OnSetupLayer`, `OnOpenLayer`, `OnEnter`, `Step` ; l'inventaire des
callbacks connaît aussi `OnDecideFocus`, `OnFunction`, `OnBack`, `OnCloseLayer`, jamais appelés).
`listItemsRecorded` reste 0 sur `chara_edit_parts_menu` et `chara_edit_recipe_menu`, objets visibles
inchangés. Le changement a été retiré : un appel de callback qui ne produit rien n'a pas sa place
dans le driver.

L'inventaire est désormais publié par écran (`callbacksDefinis`, `callbacksNonJoues`), et il est
identique sur les trois écrans testés. Les scripts définissent neuf callbacks ; le driver en joue
cinq. Les quatre autres sont nommés :

| callback non joué | essayé ? | résultat |
|---|---|---|
| `OnDecideFocus` | oui | `listItemsRecorded` reste 0, objets visibles inchangés |
| `OnFunction` | oui | idem — il s'exécute (+134 appels reconnus) mais ne peuple pas |
| `OnBack`, `OnCloseLayer` | non | ce sont des **sorties** d'écran, pas des entrées |

Les deux seuls candidats plausibles ont donc été essayés et mesurés sans effet ; les deux autres
ferment un écran au lieu de l'ouvrir.

### La fonction qui peuple est identifiée — et elle refuse de s'exécuter hors contexte

Le driver ne joue que les callbacks `OnXxx`. Or l'énumération des fonctions globales réellement
définies par les scripts d'un écran de grille en montre bien davantage, dont les noms disent le
rôle : `SetupListInfo`, `UpdateListInfo`, `UpdateLargeItemIcon`, `UpdateItemParts`,
`UpdateListFocusIdx`, `CommonListFocusFunction`. Le peuplement est là, pas dans un callback de
cycle de vie.

Appelées directement, après ouverture, sur chacun des identifiants de calque de l'écran, et dans
les deux formes (sans argument, puis avec `(layerId, 0)`) : **toutes échouent**. La fonction existe,
elle est nommée, et elle refuse de s'exécuter — elle attend un contexte que le driver ne pose pas.

C'est plus qu'un constat d'absence : cela **prouve** que ce qui manque est l'état, pas l'appel.
Ajouter ces appels au driver produirait des erreurs Lua silencieuses et aucun item ; le diagnostic
a donc été retiré.

L'erreur exacte le nomme : `attempt to perform arithmetic on field 'listRowNum' (a nil value)`. Le
script inclut `LUA_LISTVIEW_CTRL_INC` — le module de contrôle de liste, présent dans le VFS
(`listview_ctrl_inc_0.00.00.lua.bin`) et correctement résolu par l'index d'inclusions — et son pool
de constantes porte les trois champs de configuration : `listNum`, `listRowNum`, `listLineNum`.

Or le script s'exécute **intégralement** : `top_level_ok`, `OnInit` et `OnOpenLayer` réussissent
tous les trois, 297 commandes reconnues. Il ne pose donc pas ces champs lui-même. Ils viennent de
la couche que le moteur tient entre les écrans — celle qui sait quelle rubrique est ouverte et
combien d'entrées elle contient.

Une hypothèse plus simple a été testée puis écartée : `SetupListInfo` est définie par le module
inclus, pas par le script d'écran, ce qui pouvait en faire une **méthode** attendant sa table de
contexte en argument. Appelée avec une table portant les trois champs, elle échoue exactement de
la même manière — `listRowNum` reste nul. Elle ne lit donc pas son argument : la table qu'elle
consulte est une variable du module que rien, dans notre exécution, ne renseigne.

La **définition d'écran** a été inspectée en dernier recours : c'est elle qui décrit les calques,
les commandes, les ressources et le focus (`MENU_LAYER_INFO`, `MENU_CMD_INFO`, `MENU_RES`,
`MENU_FOCUS_BASE_INFO`, `MENU_FOCUS_GROUP`). Sur `chara_edit_parts_menu_hair_list`, les deux nœuds
de focus ne portent qu'un identifiant et des zéros — **aucune dimension de grille**. La
configuration de liste n'y est pas.

Voilà donc où s'arrête ce qui est atteignable depuis les fichiers, cinq sources ayant été
épuisées : le script d'écran (s'exécute intégralement, ne pose pas le champ), le module inclus (le
déclare, ne le pose pas), l'appel direct de la fonction (échoue identiquement avec et sans
argument), les callbacks non joués (essayés, sans effet), et la définition d'écran (ne le contient
pas). La fonction de peuplement est nommée, le champ qui lui manque est nommé, et il est établi
qu'aucun fichier lisible ne le fournit.

Le remplir demanderait de fabriquer une valeur que le jeu lit de son moteur. La voie honnête pour
l'obtenir existe et sort du cadre statique : `niers mem`, qui lit la mémoire d'un `nie.exe` vivant.
Relever ces trois champs sur l'écran de grille donnerait la valeur réelle plutôt qu'une valeur
plausible.

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
| Écrans composés en image | **42/42** depuis le 2026-08-20 (`var/avatar-ui/png/`, 24 Mio) |
| Ancre des objets | codée 0,5/0,5 en dur, **contredite par la géométrie** (voir ci-dessous) |

Les catégories à 0 modèle sont presets / curseurs de corps / tenues : soit elles ne portent pas de
`.g4md` (recettes pures), soit leur nom de ressource ne se résout pas comme les autres familles.
La question n'est pas tranchée — c'est le seul écart qui bloque un avatar complet côté
`/model-avatar/`.

### L'ancre : elle est dans les fichiers, et elle ne vaut pas 0,5

`place_on_canvas` pose 0,5/0,5 pour tous les objets, et `g4pkm.rs` note « Toujours 0.5 ». La
géométrie dit autre chose : le quad d'un objet de menu porte les sommets
`(1, 0) (0, 0) (0, −1) (1, −1)` — un carré unitaire dont **le coin haut-gauche est à l'origine**,
pas un carré centré. C'est vérifié de longue date par le gate lui-même
(`bg_mesh_geometry_decodes`), sans que la conséquence en ait été tirée.

Restait à savoir comment elle se compose avec la pose d'os. **Tranché par la mesure** (2026-08-20),
en composant `chara_edit_menu` sous quatre hypothèses d'ancre et en le comparant à sa capture :

| ancre | T0 | ΔE moyen | SSIM |
|---|---:|---:|---:|
| **0,5 / 0,5** (le codage actuel) | 0,56 % | **36,88** | 0,2295 |
| 0 / 0 — coin haut-gauche, ce que dit le quad | 0,21 % | 69,75 | 0,0383 |
| 0 / 1 — coin bas-gauche | 0,68 % | 65,56 | 0,0868 |
| 0,5 / 1 | 1,74 % | 39,89 | 0,2302 |

Les deux hypothèses que la géométrie du quad suggère **dégradent nettement** (ΔE 66 à 70 contre 37).
La conclusion est donc l'inverse de l'intuition : le 0,5/0,5 n'est pas une approximation qu'on
traînerait faute de mieux — **la pose d'os porte déjà le centrage**, et le quad unitaire n'est pas
l'ancre de composition. La question est fermée.

(`0,5/1` triple le T0 tout en dégradant le ΔE : un compromis ambigu, et surtout un réglage qu'aucun
fichier ne dicte. Le retenir serait caler le rendu sur la capture — la béquille que ce document
proscrit ailleurs.)

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

### La métrique — `niers img diff`

Depuis le 2026-08-20, la comparaison est un outil du dépôt (`nie_formats::imgmetric`, sans
dépendance externe : `dssim-core` est en AGPL, incompatible). Trois niveaux, dans l'ordre de la
doctrine « égalité d'octets d'abord » : **T0** identité (les trois canaux égaux), **T1**
imperceptibilité (ΔE2000 ≤ 1), **T2** structure (SSIM). Sortie **par région**, plus une carte SSIM
par bloc, une image d'écart et un rapport JSON.

Les quatre biais du SSIM historique sont corrigés et verrouillés par un test chacun : luma seule
(→ trois canaux linéaires, score = le pire), alpha ignoré (→ couverture opaque publiée), downscale
non gamma-corrigé qui faussait la **référence** (→ moyenne en lumière linéaire), fenêtres disjointes
moyennées aussitôt (→ chevauchantes, carte conservée).

### Baselines de l'éditeur (2026-08-20)

Premières mesures chiffrées du pilier — il n'en existait aucune.

| Rendu | vs | T0 | ΔE moyen | SSIM | couverture |
|---|---|---:|---:|---:|---:|
| `chara_edit_menu`, voie `--menu --from-setting` | capture `125312` | 0,56 % | 36,88 | 0,2295 | 93,89 % |
| 3 calques empilés, voie `--compose-layout` | capture `125312` | 0,00 % | 54,61 | 0,1132 | 47,56 % |

L'écart entre les deux voies est structurel : `--compose-layout` porte le contenu runtime mais
laisse plus de la moitié du cadre en canvas vide, et son compositeur est le plus faible des trois
(plus proche voisin, rotation ignorée).

### Tentatives mesurées négatives — à ne pas refaire

- **Crop du fond par la région désignée, seul** : `chara_edit_menu` passe de ΔE 36,88 à 37,73 et de
  SSIM 0,2295 à 0,2213. Le crop ne paie pas tant que la position et la luminosité du fond ne sont
  pas corrigées avec lui. La primitive (`menu::taille_designee`) reste, le branchement attend.
- **Visibilité fusionnée par ET entre calques** : soupçonnée d'effacer des objets qu'un seul calque
  cache, elle n'en efface que 0, 1 et 0 sur trois écrans (contre 8, 53 et 62 objets masqués). Les
  scripts cachent réellement ces objets ; la sémantique n'est pas en cause.
- **Apparier les captures aux écrans par le ΔE moyen global** : résultat **dégénéré**, les 18
  captures s'apparient toutes au même écran, `chara_edit_recipe_menu` — celui qui a le plus
  d'objets (89 sur 42 écrans). Avec des rendus aussi incomplets, un score global récompense
  **la couverture, pas la ressemblance** : le rendu qui remplit le plus de pixels gagne quelle que
  soit la capture. Les marges au second (1,8 à 3,8) confirment que rien ne se détache. Aucun
  manifeste d'appariement n'a donc été produit : un appariement faux vaut moins que pas
  d'appariement. Il faudra un oracle local (recherche de motif région par région) et non un score
  d'image entière.

### Les 12 `cmdId` de l'éditeur, classés définitivement

Six sont portés (`0x5245F000`, `0xFDA36F2F`, `0xCA2E6A00`, `0x23AD77AE`, `0xD8EE0E5B`,
`0x940EE4C3`). Les six autres **ne relèvent pas de cette liste**, et ce n'est pas une prudence
d'attente : la nature de la fonction qui précède chaque `ret` le décide.

Trois fonctions terminales reviennent, et les distinguer suffit à classer :

| fonction | ce qu'elle fait | ce que le `ret` qui la suit signifie |
|---|---|---|
| `0x1405E7DB0` | rapport d'erreur | sortie d'échec — le zéro n'est pas une décision |
| `0x1405E8060` | **pousse un nombre de retour** : convertit en double, pose le type 3, avance la pile Lua de 16 octets | le handler **rend une valeur calculée** |
| `0x140565560` | recherche dans les sous-nœuds d'un objet (compare un index à `[obj+0x14]`) | retour métier |

D'où le classement : `0x39C1BB84` et `0xBB3BB79B` ont des `ret` qui suivent la poussée de nombre —
ce sont des **getters**, les porter en « renvoie 1 » serait faux. `0x222B5EEE` rend un résultat de
recherche. `0x3B842D73` était déjà classé getter par le triage. `0xDB1FD4EB` et `0x52BD4EDC` sont
des setters à six arguments dont des flottants — le compositeur sait désormais teinter, mais quel
argument porte quelle composante n'est pas établi.

### La position du fond n'est pas un défaut de calcul

Le fond de l'éditeur sort à `x = 1040` sur le canvas, là où un centrage exact le mettrait à 640 —
400 pixels d'écart, qu'on pouvait prendre pour une erreur de placement. Le squelette dit autre chose.
L'os `_bg01` de `avatar01_00` porte **`pos = (600, −540)`** et **`scale = (2640, 1080)`**, et la
conversion vers le canvas redonne exactement ce qui est observé :

```
x = 640 + 600 × (1280/1920) = 1040
y = 360 − (−540) × (720/1080) = 720
```

Notre chaîne restitue donc **fidèlement ce que le fichier contient** : le repère est centré, l'axe Y
monte, et l'os est bien celui du fond (sa taille est au pixel près le rectangle de `bg01`). Aucune
ancre simple ne recentre ce sprite depuis cette position — le décalage est dans la donnée, et c'est
le driver qui le corrige à l'exécution.

La question « la position du fond est-elle mal calculée ? » est donc fermée : **non**. Ce qui reste
est la même inconnue que pour les widgets animés — ce que le driver fait de la position qu'il lit.

### sRGB ou lumière linéaire — mesuré, pas encore tranchable

Le compositeur mélange en octets sRGB ; l'hypothèse concurrente est un mélange en lumière linéaire.
Les deux ont été comparés en composant les mêmes écrans sous chaque formule :

| écran | espace | T0 | ΔE moyen | SSIM |
|---|---|---:|---:|---:|
| `chara_edit_menu` | linéaire | 0,58 % | **36,65** | **0,2333** |
| `chara_edit_menu` | sRGB (actuel) | 0,56 % | 36,88 | 0,2295 |
| `main_menu` | linéaire | 10,85 % | 14,81 | 0,5234 |
| `main_menu` | sRGB (actuel) | 10,85 % | 14,81 | 0,5234 |

Le linéaire est très légèrement meilleur là où il y a de la semi-transparence, et **strictement
identique** ailleurs — ce qui est attendu, les deux formules coïncidant exactement à alpha plein.
L'écart (0,23 de ΔE sur un seul écran) est trop faible pour trancher une décision qui touche tout
le rendu, et le rendu est encore trop incomplet pour que le test le soit : il faudrait une zone de
chevauchement semi-transparent déjà juste pour que l'écart devienne discriminant. Aucun changement
n'est appliqué ; l'expérience a été retirée du dépôt.

> **Rappel de doctrine** : « pixel-perfect » est le **nom d'une cible**, pas un état atteint.
> Le byte-exact du dépôt porte sur les **données**, jamais sur les pixels.

---

## 13. Le champ manquant est relevé — le jeu tourne, sa mémoire répond

Les cinq sources de fichiers épuisées (§ précédent) disaient toutes la même chose : `listRowNum`
est **déclaré** par le chunk Lua et **jamais affecté** par lui. La conclusion restait suspendue à
une lecture qu'aucun fichier ne pouvait fournir. Elle est faite.

### 13.1 Le jeu tourne sur ce VPS, sans GPU

`scripts/nie-wine-setup.sh` + `scripts/nie-wine-run.sh`. Cinq blocages, chacun mesuré avant d'être
contourné — le détail vit dans l'en-tête des deux scripts. En résumé :

| Blocage | Symptôme exact | Levée |
|---|---|---|
| Wine du système | wine 10.0 n'a ni DXVK ni vkd3d | le Wine du **Proton livré avec le jeu** (wine-11.0), en natif |
| Préfixe créé par `wineboot` | `Library D3DCOMPILER_47.dll not found` (il dépend de wined3d → libvkd3d) | copie **déréférencée** (`cp -aL`) de `files/share/default_pfx` |
| `default_pfx` sans `dosdevices` | `could not load kernel32.dll` | `c:` → `drive_c`, `z:` → `/` |
| Xvfb sans taux de rafraîchissement | `Unhandled division by zero` **dans dxgi**, avant la 1re image (`xrandr` : 0.00 Hz, dotclock 0) | bureau virtuel Wine (`explorer /desktop=`) |
| Pas de gestionnaire de fenêtres | le jeu cesse de recevoir la souris après quelques secondes | `openbox` sur le display |

Un dernier piège, propre au rendu logiciel : à quelques images par seconde, **tout appui
instantané est raté**. `xdotool click` ne fait rien ; `mousedown` … `mouseup` séparés d'une à
trois secondes passent. Idem au clavier.

Écrans traversés et rendus en 1920×1080 sur lavapipe : réglage de langue, *Button Setting*, logo,
avertissement de sauvegarde, **écran-titre** (`ver.7.1.2 0.90 301`), invite *Create Avatar*, puis
l'**Avatar Editor** lui-même — onglets *Style*, *Body Type*, *Face & Hairstyle*, panneau
*Face Presets*, panneau *Hairstyle / Bangs / Hair Color*.

### 13.2 `niers mem lua-field` — du nom de champ à sa valeur

Nouvelle sous-commande (`crates/tools/nie-cli/src/mem_lua.rs`). La chaîne, en trois pas :

1. Lua interne les chaînes courtes. Une `TString` x86-64 est
   `next(8) | tt(1) marked(1) extra(1) pad(1) hash(4) | len(8) | données…` : chercher `len`
   suivi du nom et de son NUL identifie l'objet, et `TString* = addr(len) − 16`.
2. Une entrée de table est un `Node { TValue i_val; TKey i_key; }` de **40 octets**
   (`TValue` 16 ; `TKey` = `value_(8) tt_(4) pad(4) next(8)` 24). Chercher le pointeur vers la
   `TString` donne la position de `i_key.value_` ; **la valeur est 16 octets avant**.
3. `i_key.tt_` doit valoir `LUA_TSTRING`. Le runtime observé marque en plus le bit collectable
   `0x40` (d'où `0x44`) — d'où le masque `0x3f`.

`--radius` balaie les `Node` voisins du même tableau de hachage : c'est ce qui rend la table
d'état complète plutôt qu'un champ isolé. `--numeric` écarte le seul bruit notable de la méthode
(le pointeur d'une chaîne se retrouve aussi en position de clé dans `_LOADED`, les tables de
globales, les pools de constantes).

### 13.3 Ce que la mémoire dit

```
niers mem lua-field listRowNum --numeric -r 6
```

| Écran (repéré par la table voisine) | `listNum` | `listRowNum` | `listLineNum` | `pageNum` |
|---|---:|---:|---:|---:|
| `chara_edit_parts_menu` (`LUA_CHARA_EDIT_PARTS_MENU_INC`) | 9 | **3** | **3** | 2 |
| `chara_edit_menu` (`LUA_CHARA_EDIT_MENU_INC`) | 40 | **2** | **6** | 4 |

Les deux relevés sont **croisés par une source indépendante** : la capture de l'écran *Face
Presets* montre exactement neuf vignettes numérotées `01`…`09` disposées en **trois colonnes sur
trois rangées**, ce que la table donne à l'octet près. Pour le second, l'arithmétique se referme
seule : 40 éléments à 2 × 6 par page ⇒ 4 pages, et `pageNum` vaut 4.

`listRowNum` est donc le **nombre d'éléments par rangée**, `listLineNum` le **nombre de rangées
visibles**. Ce n'est plus une hypothèse : c'est un relevé, deux fois recoupé.

> Ce qui reste non établi, et ne doit pas être extrapolé : la relation exacte entre `listNum` et
> le total réel d'une rubrique. Sur `chara_edit_menu` les 40 éléments et les 4 pages se referment ;
> sur `chara_edit_parts_menu`, `listNum = 9` vaut exactement une page pleine, donc rien ne permet
> de trancher entre « total » et « éléments par page » à partir de ce seul cas.

### 13.4 Captures de référence

`var/refs-avatar/live/` (hors dépôt — assets © LEVEL-5) : `chara_edit_style_01.png`,
`chara_edit_body_type.png`, `chara_edit_hair_tab.png`, `chara_edit_face_presets.png`. Contrairement
aux 18 captures antérieures, celles-ci sont produites ici, à résolution connue, sur un état
d'écran choisi — c'est ce qui manquait pour adosser une mesure au vrai jeu.

---

## 14. La page publique mesurée contre le vrai écran

Le pilier avait une chaîne complète en production (`/avatar` sur azalée) mais **aucune mesure** :
rien ne disait à quelle distance du jeu elle se tenait. Le jeu tournant maintenant ici (§13), la
distance se chiffre.

Protocole : capture de la page à la **même résolution** que la référence
(`apps/azalee/scripts/shot.ts`, 1920 × 1080, Playwright sur le chromium du système), puis
`niers img diff … --roi` sur cinq régions nommées — un score global masque toujours une zone
parfaite et une zone fausse.

| Région | px | avant | après | ΔE moy. après |
|---|---:|---:|---:|---:|
| **global** | 2 073 600 | 0,6482 | **0,7074** | 10,40 |
| `scene_avatar` | 980 100 | 0,6212 | **0,7347** | 9,53 |
| `panneau_droit` | 542 500 | 0,6801 | 0,6801 | 10,05 |
| `barre_haut` | 249 600 | 0,5612 | **0,5733** | 16,01 |
| `barre_bas` | 172 800 | 0,5537 | **0,5967** | 9,90 |
| `ergot_onglet` | 26 660 | 0,4971 | 0,4978 | 8,41 |

Trois corrections, chacune adossée à une source :

1. **L'emprise du modèle était estimée**, elle est maintenant relevée. Deux captures du même écran
   — avant et après le chargement de l'avatar — différenciées puis seuillées donnent sa boîte
   englobante : **215 × 609 px à (533, 381)**, stable du seuil 25 % au seuil 35 %. L'ancienne boîte
   (730 × 907) faisait cadrer le visualiseur sur toute la hauteur.
2. **Les boutons du bandeau du bas n'étaient pas les bons.** `cmn03/cmd_back_base01` et
   `cmd_press_btn_base_on01` sont des **fonds cyan** ; le layout exporté de `chara_edit_menu`
   désigne `mainmenu01_10_return_arrow_button_guide` et `mainmenu01_12_next_button_guide`. Leçon
   générale : **le layout est l'autorité, pas la ressemblance d'un nom de sprite.**
3. **La tuile de l'onglet actif** (`icon_base01`, parallélogramme 352 × 264 dont ~64 % de la hauteur
   est opaque) manquait.

Un quatrième essai a été **retiré parce que la mesure l'a contredit** : recaler la languette du
libellé d'onglet sur l'emprise relevée à l'œil fait tomber `ergot_onglet` de 0,4971 à 0,4860.

### Deux plafonds du modèle 3D, tous deux constatés et non contournés

- **Pas de corps.** Le corps vit dans `_base/` (11 fichiers, 97 os référencés, contre 44 pour un
  visage). Mais rien ne relie les 8 morphologies du catalogue à ces 11 fichiers : aucune catégorie
  ne référence `_base/`, le CRC-32 de `base_normal_00` (`4C0FC910`) n'apparaît nulle part dans
  `data/common/gamedata/`, et relever le corps actif en mémoire ne tranche pas — les onze noms y
  sont chargés ensemble.
- **Pas de texture.** Le GLB rendu contient 0 image et 0 texture. Les matériaux des pièces
  (`hairF_10`, `base_eye_10`, `parts_mouth_10`, `eye_10_normal_00`…) n'ont **aucun `.g4tx`
  correspondant dans le VFS**, et `customTex` n'y rend rien : la texture d'un avatar est composée à
  l'exécution depuis les couleurs choisies.

Prochaine cible chiffrée : `panneau_droit` (0,6801, 542 500 px — le plus gros gisement restant) puis
`barre_haut` (0,5733).

---

## 15. L'assembleur de modèle et de texture

L'éditeur ne montre plus un modèle figé : il assemble, à la demande, le personnage que le jeu
compose lui-même. Trois chaînes, chacune établie par mesure.

### 15.1 Le corps — et pourquoi `_base/` n'en est pas un

`_base/base_*.g4md` **n'est pas un corps**, malgré son nom et malgré ce qu'affirmait la doc
d'`assemble.rs` : ces mailles ne portent que l'œil et la bouche, à hauteur de tête
(y ∈ [1,29 ; 1,60] m, 2 sous-mailles, matériaux `eye_10_*` / `mouth_10_*`). Le corps habillé de
l'éditeur est `_uniform/u000101` (haut et short, cheville → cou) plus `_uniform/s000201`
(chaussures) : les 32 recettes `common/chr/_test/default/mdl_edit_avatar*.cfg.bin` portent toutes,
sans exception, la même tenue `u117401_10` / `s117401_10`.

Piège de nommage : le conteneur de texture porte l'identifiant de la **tenue**, pas celui du
modèle — `u000101/u117401_10.g4tx` contient les textures nommées `u000101_20` et `u000101_30`.

### 15.2 L'attache — la tête ne se pose pas toute seule

Les pièces de `20_EDIT` sont exprimées **dans le repère de leur os** (boîte centrée sur l'origine,
y ∈ [−0,07 ; 0,23]) ; les mailles d'uniforme sont déjà en **espace monde** (y ∈ [0 ; 1,30]).
Empilées telles quelles, la tête se pose sur les chaussures. `AvatarPiece::attach` porte la pose
de repos de l'os `c_head_1_0`, résolue par `bone_rest_world()` sur le squelette
`_bodySK/<code>_edit.g4sk`.

### 15.3 L'appariement corps ↔ squelette, mesuré

Le genre et la taille ne changeaient rien parce que le corps était figé : rien ne disait quelle
variante `u0001NN` va avec quel squelette. La mesure tranche. Pour les 32 combinaisons, on compare
le haut du corps au bas de la tête une fois celle-ci attachée :

| squelette | corps | écart | taille obtenue |
|---|---|---|---|
| `c000101_edit` | `u000101`, `u000102` | 11 mm, 10 mm | 1,60 m |
| `c000201_edit` | `u000103`, `u000104` | 16 mm, 19 mm | 1,25 m |
| `c000301_edit` | `u000105`, `u000108` | 33 mm, 13 mm | 1,88 m |
| `c000401_edit` | `u000106`, `u000107` | 28 mm, 4 mm | 2,08 m |

Tout autre appariement dépasse **194 mm** : le fossé est net. Le test data-gated
`chaque_corps_epouse_son_squelette` rejoue la mesure à chaque build.

La route choisit le corps elle-même d'après le squelette demandé ; le client n'a pas à connaître
cette table. Le squelette, lui, vient du catalogue : `modeles2` de la catégorie 17.

### 15.4 La texture de visage est COMPOSÉE

C'est le point qui explique que tant de rubriques semblaient sans effet. La maille de tête ne
dépend que de **la morphologie et du nez** (42 entrées = 7 nez × 6 blocs, 7 ressources distinctes
par morphologie). **Tout le reste du visage est de la texture** : le jeu n'a pas une planche par
combinaison, il empile des planches de `_facetex/` au même dépliage UV —
`00_face` (35), `01_eye` (80), `02_pupil` (50), `03_highlight` (16), `04_eyebrow` (40),
`05_mouth` (24). Les familles sont numérotées **dans leur ordre de superposition**.

`composer_couches()` les mélange en alpha. Deux règles, chacune verrouillée par un test :

- la toile prend la taille de la **plus grande** couche, pas de la première — la peau fait 512×512
  et les traits 2048×1024, se caler sur la première jetait silencieusement tout le reste ;
- seules les couches de **même rapport** sont composées : un autre rapport est un autre dépliage,
  et le plaquer placerait les traits n'importe où.

### 15.5 Résolution des textures — jamais par le nom du matériau

`hairF001M.g4tx` porte une texture nommée `hair_10` alors que le matériau du G4MD s'appelle
`hairF_10` : **aucun** des noms de matériau de l'éditeur n'existe comme fichier ni comme texture
nommée. La résolution passe par le **chemin** de la pièce (arbre `dx11` parallèle à `common`), et
le nom de la texture se choisit en deux temps : celui que le matériau désigne une fois son suffixe
de niveau de détail retiré (`u000101_30_LOD1` → `u000101_30`, ce qui vaut pour les tenues), puis
la couleur de base du conteneur. `base_color_texture_name()` écarte les planches techniques
(`line`, `msk`, `oc`, `sp`, `spm`) qu'une sélection « la plus grande » choisissait à tort.

### 15.6 Le cache doit connaître la version de la logique

`AVATAR_CACHE_VERSION` entre dans la clé. Sans elle, un GLB produit par l'ancienne logique reste
servi indéfiniment et le correctif paraît sans effet — constaté en direct lors de l'ajout du corps
automatique.

### 15.7 Ce qu'une revue adversariale a trouvé

Quatre relecteurs indépendants, chaque constat soumis à un réfutateur avant d'être retenu :
**12 défauts confirmés**. Les principaux, et ce qu'ils ont coûté :

| Défaut | Effet réel | État |
|---|---|---|
| `composer_couches` écartait les couches d'un autre **rapport** | peau, pupilles et reflets (512×512) jetés en silence — changer de peau ne changeait pas un octet du GLB | corrigé : un visage **par dépliage** |
| Une coiffure n'était envoyée qu'à moitié | 45 coiffures sur 98 rendaient un crâne **chauve**, les 53 autres perdaient leur nuque | corrigé : `modeles` + `modeles2` |
| `?face=` sans borne | chaque couche décode jusqu'à 8 Mio ; un seul GET mettait le service à genoux | corrigé : 12 couches au plus |
| Clé de cache ambiguë | une pièce `d/n` et une couche `d/n` donnaient le même fragment `d-n` — la seconde requête recevait le GLB de la première | corrigé : les deux familles séparées |
| `est_uniforme` classait sur « pas de souligné » | 124 dossiers de `20_EDIT` portent un code de personnage : la pièce était cherchée dans `_uniform/`, échouait en silence | corrigé : les deux racines sont **essayées** |
| `pieces` non dédoublonné | une maille pouvait être incorporée deux fois, superposée à elle-même | corrigé |

Un constat a été **réfuté par la mesure** : « la rubrique *Forme de visage* n'atteint jamais le
modèle ». Les 42 entrées de `visages` ne portent que **7 ressources distinctes** par morphologie
(les 6 blocs de 7 donnent tous `face51_nose01` pour la morphologie 0) : la forme de visage n'agit
pas sur la géométrie de la tête, elle agit sur la **texture** `00_face` — ce qui fonctionne depuis
le correctif ci-dessus. Indexer la maille par le seul nez est donc juste.

### 15.8 Ce que l'assemblage ne fait pas encore

### La règle de composition, trouvée

Deux règles, chacune vérifiée, ont fait passer le visage de **2 familles actives sur 6 à 5** :

1. **Le canal dominant sélectionne la teinte, il ne s'additionne pas.** Additionner saturait
   systématiquement — la teinte par défaut du canal bleu est blanche, et blanc + quoi que ce soit
   donne blanc. C'est pourquoi la teinte n'avait aucun effet observable. À égalité, l'ordre
   rouge > vert > bleu tranche, ce qui donne à une planche neutre (blanche partout, comme
   `face_00`) la carnation du canal rouge.
2. **Le canal rouge est le FOND.** Une planche neutre l'a partout : `eye_00`, `highlight_00` et
   `eyebrow_00` sont uniformément rouges, **écart-type nul** — c'est ainsi que le jeu dit « rien à
   ajouter ici ». Posée sur une autre, une telle zone doit laisser voir ce qui est dessous ; seule
   la planche de fond garde son opacité.

Piège de méthode, à retenir : **les variantes `_00` de chaque famille sont des planches neutres,
uniformes.** Les prendre comme témoin de test faisait conclure à tort à l'absence d'effet — c'est
ce qui a masqué le vrai comportement pendant plusieurs itérations. Un témoin valable doit porter du
dessin, ce qui se vérifie par son écart-type.

La **teinte agit** : quatre couleurs de peau donnent quatre empreintes distinctes, et
`?tint=RRGGBB,RRGGBB,RRGGBB` la pilote.

### Ce qui reste

- **Les reflets (`03_highlight`) : RÉSOLUS — 6 familles sur 6 agissent.** Une planche dont la
  **couleur est muette** et dont le **masque porte la forme** ne doit PAS être teintée. Les reflets
  sont blancs par nature (`highlight_L_00` et `highlight_L_09` valent tous deux R = G = B = 255,
  écart-type nul ; seuls leurs masques diffèrent) : les teinter revenait à les peindre en
  carnation, donc à les rendre invisibles sur une peau déjà de cette couleur. Ces planches gardent
  leur couleur et l'alpha de leur masque.

  Le chemin jusqu'à cette règle a produit trois enseignements qui valent d'être gardés :
  - la famille **agissait déjà servie seule** — ce n'était donc pas un défaut de décodage, mais un
    défaut de composition en présence d'un fond ;
  - un test où `?tint=` rendait la peau ET les reflets blancs m'avait fait conclure à tort « ce
    n'est pas la teinte » : le test était mal construit, l'hypothèse était bonne ;
  - mes « 2 % de dessin sur le vert », qui m'avaient fait soupçonner un écrasement, étaient des
    artefacts d'interpolation de mon propre redimensionnement de mesure. **Ne jamais mesurer la
    répartition des canaux sur une image redimensionnée.**

- **Les valeurs RGB des palettes : RELEVÉES.** Elles n'existaient nulle part sous forme de valeur —
  `m_CharaEditColorDataList` ne porte que des identifiants, le binaire ne contient pas le motif
  d'une entrée connue, et contrairement aux canaux `red`/`green`/`blue`, **aucun** des 165
  identifiants ne s'y résout depuis les chaînes (0 sur 165). Seule la mémoire du jeu les porte, et
  c'est de là qu'elles viennent désormais : `niers mem palettes` les relève sur le jeu lancé sous
  Wine. Forme de la table : par entrée, l'identifiant CRC-32 en little-endian sur 4 octets, puis la
  couleur **ARGB** sur 4 octets. La recherche est bornée par les identifiants attendus, et les
  entrées non opaques sont écartées — un balayage libre produit des coïncidences à coup sûr.
  **165 / 165**, toutes opaques, fusionnées dans le catalogue sous `couleursRgb` et servies.

  Reste à relier le sélecteur de couleur de l'interface à `?tint=`, que la route accepte déjà :
  c'est du travail d'interface, plus un verrou de données.
- **Le PLACEMENT des pièces de texture.** Les recettes
  `common/chr/_test/default/mdl_edit_avatar*.cfg.bin` décrivent chaque pièce ainsi :
  `CHARA_EDIT_PARAM_TEX_PARTS [famille, variante, offX, offY, offZ, échelleX, échelleY]`, suivie
  de trois `..._COLOR` dont les identifiants sont les CRC-32 de **`red`**, **`green`** et
  **`blue`** (retrouvés dans les chaînes du binaire). Une planche de `_facetex` est donc un
  **masque à trois canaux**, chaque canal désignant une zone qui reçoit sa couleur — et le jeu
  **place** chaque pièce à un offset et une échelle donnés dans un atlas de destination, au lieu
  de les empiler. `teinter_par_canaux()` porte la partie couleur, testée ; le placement, lui,
  n'est pas porté, et sans lui la teinte ne peut pas se voir. Les pièces latéralisées ont en plus
  leur `..._LEFT` / `..._RIGHT` avec leurs propres offsets.
- **Conséquence mesurée, à ne pas maquiller :** avec les six familles présentes, **deux seulement**
  font varier le rendu (`01_eye`, `05_mouth`), et la teinte n'a **aucun** effet observable — les
  empreintes d'une peau claire et d'une peau foncée sont identiques. Dans un groupe, la dernière
  planche opaque masque les précédentes.
- **Quatre hypothèses de composition ont été essayées et RÉFUTÉES par la mesure**, ce qui vaut
  d'être écrit pour qu'on ne les retente pas : l'alpha des planches (elles sont opaques), le
  compagnon `msk` comme alpha (uniforme à 0,5, écart-type nul), le groupement par dépliage seul,
  et la teinte par canaux sans placement.
- **La règle de composition du visage.** Les six familles ne s'empilent PAS en alpha simple :
  `eyebrow_00` est entièrement transparente, `face_00`, `eye_00` et `mouth_00` entièrement
  opaques, seule `pupil_00` porte un vrai canal alpha. Dans un même dépliage, la dernière planche
  opaque masque donc les précédentes. La règle réelle reste à établir.
- **La teinte.** Le compagnon `<nom>msk` **n'est pas un masque d'opacité**, contrairement à ce que
  son nom laisse croire : `face_00msk` comme `pupil_L_00msk` sont uniformes à 0,5, écart-type
  **nul**. Le poser en alpha rend la planche uniformément semi-transparente et efface les
  variations — essayé, mesuré, abandonné. Sa nature exacte reste à établir, et avec elle les
  couleurs de peau, d'yeux et de cheveux.
- **`HIDE_EAR_HAIR_INFO`.** `editCharaMdlParts.cfg.bin` déclare 8 coiffures qui **cachent les
  oreilles**. L'assemblage les empile toujours.
- **Le départage des corps : RÉSOLU.** Ma mesure précédente était trop grossière — un rayon moyen
  au buste ne dit rien. Deux grandeurs séparent nettement les corps d'une même paire : la **largeur
  d'épaules** et le **tour de taille**, dont le rapport signe la morphologie.

  | morphologie | corps | taille | épaules | tour de taille | rapport |
  |---|---|---:|---:|---:|---:|
  | `male` | `u000101` | 1,304 | 0,653 | 0,328 | 1,99 |
  | `female` | `u000102` | 1,303 | 0,615 | 0,354 | 1,73 |
  | `small` | `u000103` | 0,960 | 0,496 | 0,311 | 1,59 |
  | `smallfat` | `u000104` | 0,963 | 0,507 | 0,389 | 1,30 |
  | `tall` | `u000105` | 1,545 | 0,774 | 0,385 | 2,01 |
  | `tallmuscle` | `u000108` | 1,565 | 0,774 | 0,370 | 2,09 |
  | `muscle` | `u000106` | 1,804 | 1,367 | 0,649 | 2,11 |
  | `big` | `u000107` | 1,772 | 1,413 | **0,994** | 1,42 |

  L'affectation ne repose sur aucune convention : **deux contraintes indépendantes se recoupent**.
  Le squelette, apparié par la jointure cou/tête, réduit chaque morphologie à deux corps ; la
  corpulence départage la paire et concorde avec le nom — `female` a les épaules plus étroites et
  le tour de taille plus large que `male`, `smallfat` est plus large que `small` à taille égale,
  `big` atteint 0,99 m de tour de taille quand `muscle`, aussi grand, garde 0,65. L'ordre des
  fichiers, lui, ne suit pas les morphologies : `u000108` sert `tallmuscle`, avant `u000106`.

  Le test `chaque_morphologie_recoit_un_corps_de_son_squelette` verrouille le recoupement des deux
  tables : si l'une bouge sans l'autre, il le dit. Le premier est servi,
  donc **4 des 8 corps ne sont jamais rendus** et le genre ne change pas la carrure. C'est le plus
  gros reste identifié par la revue.

---

## 16. Le corps, la chevelure et les zones neutres — quatre défauts, quatre mesures

L'avatar servi montrait un casque blanc sur la tête, un bandeau sombre en travers du visage et un
corps entièrement turquoise barré de blanc au torse et aux genoux. La référence est l'écran du jeu
capturé ici (§13) : maillot **crème à col turquoise**, short et chaussettes turquoise, chevelure
brune, visage en carnation. Quatre causes distinctes, toutes tranchées par une mesure.

### 16.1 Trois niveaux de détail rendus l'un sur l'autre

`u000101` range ses LOD comme des sous-mailles ordinaires : huit sous-mailles, `material_index = 0`
sur toutes. Rien dans le G4MD ne les distingue — mais la géométrie, si :

| emprise | triangles | pièce |
|---|---|---|
| `y ∈ [0,895 ; 1,264]` | 778, 404, 298 | haut du corps |
| `y ∈ [0,088 ; 0,895]` | 802, 400, 314 | bas du corps |
| `y ∈ [0 ; 0,150]` | 868, 390, 274 | chaussures |

`assemble::retenir_niveau_detail_max` regroupe les primitives consécutives de même boîte (à 2 %
près) et ne garde que la plus fine. L'uniforme passe de **11 à 5 primitives**, ses cinq pièces
réelles. Les trois sous-mailles du visage ont trois emprises différentes : aucune n'est touchée.

### 16.2 La planche résolue par le nom du matériau

Le G4MD déclare `u000101_30_LOD1` et `u000101_30_LOD2`, mais le conteneur porte **deux** planches :
`u000101_20` (moyenne 242,240,238 — le maillot) et `u000101_30` (165,226,236 — le short). Les deux
matériaux visaient donc la même planche turquoise, et le carré blanc de celle-ci ressortait au
torse et aux genoux. La n-ième planche de base va maintenant au n-ième matériau, et les huit
sous-mailles se répartissent en deux groupes de rangs égaux — un par matériau.

Les 80 conteneurs de `_uniform/u000101/` sont **80 uniformes d'équipe** sur la même géométrie ;
leurs couleurs diffèrent (`u010101_10` donne 151,181,115 et 107,148,166). Le conteneur employé,
`u117401_10`, est bien celui de l'éditeur.

### 16.3 Les planches neutres

`hair_10` fait 64 × 32 et vaut 255,255,255 partout : elle est **neutre**, et c'est la couleur
choisie qui la colore. `image_out::g4tx_vignette_teintee` la multiplie et lui applique son masque
`<nom>msk` en alpha quand il varie. La teinte doit s'appliquer au nom **finalement retenu** : le
G4MD déclare `hairF_10` quand le conteneur porte `hair_10`, donc c'est le repli qui fournit la
planche — la teinter sur le seul nom visé laissait le casque blanc.

Deux couleurs par défaut, relevées sur l'écran du jeu faute d'exister dans un fichier :

| rôle | relevés | retenu |
|---|---|---|
| chevelure | 118,93,78 / 113,88,74 / 117,92,77 | **116,91,76** |
| iris (canal vert) | 106,81,81 / 73,51,51 / 77,56,56 / 88,61,61 | **83,59,59** |

Ce sont des couleurs **rendues**, éclairage compris, non des albédos : le brun servi sort un peu
plus sombre que celui du jeu. `?hair=` et `?tint=` les remplacent dès que le joueur choisit.

### 16.4 Une dominance d'une unité ne désigne rien

`eye_L_01` est blanche à 255 sur les trois canaux, sauf des ovales à peine plus gris où un canal
passe devant d'un ou deux crans. La sélection par canal dominant y basculait d'un bloc sur la
couleur de l'iris : deux blobs opaques par-dessus les yeux. En deçà de **8 crans** d'écart, le
pixel est désormais traité comme du fond.

### 16.5 Ce qui reste faux

**Les yeux ne sont pas composés.** Le globe est noir dans `eye_L_01msk`, et cette zone sort sombre
au lieu de porter blanc de l'œil et iris. Les couches `02_pupil` et `03_highlight` vont bien sur la
maille du visage — leur dépliage 512 × 512 le prouve (§15) — ce n'est donc pas un défaut de
rangement.

> **Tentative mesurée NÉGATIVE, à ne pas refaire.** Traiter `eye_L_01msk` comme un masque de
> *zones* — le passer comme sélecteur à la teinte au lieu de le poser en alpha, le noir gardant la
> couleur de la planche — a été implémenté (`masque_de_zones`, `decoder_planches_et_masques`,
> `teinter_par_zones`) puis **annulé** : le visage sortait délavé avec une large bande noire sous
> les yeux, nettement pire que l'état précédent. L'idée n'est pas absurde, mais elle demande de
> reprendre l'empilement entier des six familles, pas de substituer un sélecteur.

> **Deuxième tentative, mesurée NÉGATIVE elle aussi.** La chaîne a pourtant été comprise plus
> finement : `01_eye` est **seule sur son rang de matériau**, donc tenue pour un fond qui garde son
> opacité, alors que la maille des yeux se pose DEVANT celle du visage et doit la laisser voir.
> Réserver le fond au seul rang 0 supprime bien l'aplat — mais supprime les yeux avec, parce que
> `decoder_planches` ne consulte le masque que si la couleur est « muette », ce que `eye_L_01`
> n'est pas : ses ovales gris varient. La teinte se décide alors sur une planche blanche où le
> canal rouge l'emporte partout, et toute la couche part en fond, donc en transparent.
>
> Faire du masque le sélecteur (`teinter_par_zones`, globe laissé transparent cette fois) a donné
> un visage noir massif taché de blanc — pire que les deux états précédents. Les deux essais ont
> été annulés.
>
> Ce que ces deux mesures établissent : le défaut n'est pas dans le choix du sélecteur ni dans le
> traitement du fond pris isolément, mais dans **l'empilement des six familles**, qui suppose des
> planches opaques composées par alpha alors que l'information vit tantôt dans la couleur, tantôt
> dans un masque gris, tantôt dans un masque coloré. Y revenir demande de reprendre `face_layer_slot`,
> `decoder_planches` et `teinter_par_canaux` ensemble, contre une capture de l'écran du jeu — pas
> de retoucher l'un des trois.

Restent aussi, inchangés : les bras en pose de repos (T-pose, faute de skinning dans cette chaîne
d'export), les avant-bras absents, et les oreilles sans matériau propre — elles retombent sur
`Default`.

### 16.6 L'alpha était calculé puis jeté

Un champ manquait dans chaque matériau du GLB : `alphaMode`. Absent, il vaut **OPAQUE** en glTF,
et le canal alpha de la texture est purement et simplement ignoré au rendu. Toute la composition
du visage repose pourtant sur lui — la couche des yeux ne couvre que 17 % de sa planche — et les
mèches de chevelure sont découpées par leur masque. Ces alphas étaient donc calculés, puis jetés.

Les matériaux à texture embarquée déclarent maintenant `MASK` avec un seuil à 0,5. MASK plutôt que
BLEND : la découpe de ces planches est franche, et MASK évite le tri par profondeur que BLEND
impose entre mailles qui s'interpénètrent — celle des yeux est posée juste devant celle du visage.
Une texture opaque n'est pas affectée, son alpha valant 255 partout.

Gain mesuré : la chevelure passe de deux taches noires massives à des mèches découpées. Le corps
est inchangé.

### 16.7 Pourquoi les yeux ne viennent pas — la cause est enfin établie

Les planches empilées **ne portent pas les traits du visage**. C'est ce que trois relevés montrent,
et cela clôt les hypothèses précédentes :

| couche composée | écart-type | contenu réel |
|---|---:| --- |
| `base_eye_10` (visage, 512 × 512) | 10 | un aplat de carnation |
| `parts_eye_10` (yeux, 1024 × 512) | 78 | **cinq aplats de peau**, alpha binaire, aucun dessin |
| `02_pupil/pupil_01` seule | 104 | un grand ovale de carnation cerné d'un liseré — la forme du visage, pas un œil |

Autrement dit, la famille nommée `02_pupil` ne contient pas de pupille, et `01_eye` pas d'œil : ces
noms viennent du rangement des dossiers, pas du contenu. Le dessin de l'œil du jeu — iris brun,
blanc, cils noirs, tel qu'on le relève sur la capture — n'est dans aucune des six familles de
`_facetex` telles qu'elles sont empilées aujourd'hui.

Il ne sert donc à rien de continuer à régler l'empilement : **la source des traits reste à
trouver**, et c'est elle qu'il faut chercher avant d'écrire une ligne de composition de plus.

### 16.8 Ce que les masques disent vraiment — et la troisième voie réfutée

Les masques de `_facetex` sont bien des masques de **zones**, peints en couleurs franches :

| planche | fond | zone peinte |
|---|---|---|
| `eye_L_01msk` | rouge | un mince croissant **vert** — le contour de paupière |
| `pupil_L_01msk` | rouge | un grand ovale **bleu** |

Le grand ovale bleu de `pupil_L_01msk` ne cerne **pas** un œil : il couvre la forme du visage
entier, et sa planche `pupil_L_01` n'est qu'un contour ovale gris sur fond blanc. Une troisième
tentative l'a confirmé par l'image — faire du masque le sélecteur, avec l'iris sur le canal bleu,
peint tout le visage d'un ovale brun massif. Annulée comme les deux précédentes.

Les trois essais convergent donc vers le même constat, et il est désormais solide : **la famille
`02_pupil` ne contient pas de pupille, `01_eye` pas d'œil.** Ces noms viennent du rangement des
dossiers, pas de leur contenu. Le dessin que montre le jeu — iris brun, blanc de l'œil, cils noirs,
relevé sur la capture de l'onglet « Face & Hairstyle » — n'est dans aucune des six familles telles
qu'on les empile.

**Prochaine étape, et une seule : retrouver la source des traits**, avant d'écrire une ligne de
composition de plus. Trois pistes non explorées, par ordre de coût : les 245 fichiers de `_facetex`
dont seuls quelques-uns ont été ouverts ; les conteneurs du modèle `_facebase` lui-même, dont on
sait seulement qu'ils portent des vignettes 32 × 32 ; et le relevé en mémoire du jeu vivant, qui a
déjà tranché la question des palettes (§13).

### 16.9 La source des traits existe — `mouth_01` en est la preuve

Le constat de §16.8 était trop large. Une planche au moins porte bel et bien un dessin :
**`mouth_01`** (2048 × 1024) montre quatre bouches complètes — contour noir, lèvres, dents — et son
masque les cerne en **noir sur fond rouge**. Pour cette famille, le dessin vit donc dans la
COULEUR, et le noir du masque veut dire « garde ce qui est peint ici ».

C'est un acquis : la source des traits n'est pas ailleurs, elle est dans `_facetex`. Reste que les
familles n'y logent pas leur information au même endroit — la bouche dans sa couleur, l'œil dans
son masque — et c'est cette hétérogénéité qui fait échouer tout empilement uniforme.

Deux essais de plus l'ont vérifié, tous deux **annulés** :

| essai | résultat mesuré |
|---|---|
| noir du masque → garder la couleur de la planche | visage recouvert de blanc : `face_00` est blanche et son masque a de larges zones noires |
| idem, mais seulement si la planche n'est pas muette | inchangé — `face_00` n'est pas « muette » au sens de `canal_uniforme`, elle porte un liseré |

**Cinq voies ont maintenant été essayées et mesurées négatives.** Elles partagent le même défaut :
elles cherchent UNE règle pour six familles qui n'obéissent pas à la même. Ce qu'il faut n'est pas
une sixième règle, mais une table par famille, établie planche par planche — quelle information
porte la couleur, laquelle porte le masque, et ce que chaque canal désigne — avant d'écrire la
moindre ligne de composition. `mouth_01` en donne la première entrée.

### 16.10 La composition est juste — c'est le PLACEMENT qui manque

Une planche qui porte déjà un dessin ne doit pas être teinte, seulement **découpée** : sa couleur
est le trait, et son masque ne sert qu'à retirer le fond. C'est ce que fait `decouper_par_zones`,
et le résultat se vérifie sur l'artefact intermédiaire — la texture composée pour
`05_mouth/mouth_01` montre **huit bouches nettes**, contour, lèvres et dents, sur fond transparent,
là où la teinte par canaux les effaçait (le contour noir n'a aucun canal dominant, donc passait en
transparent, et les lèvres tombaient sur le canal du fond).

Deux relevés de plus expliquent le reste :

| planche | couleur | masque |
|---|---|---|
| `face_00` | blanc pur, opaque | **uniformément rouge** |
| `highlight_00` | blanc pur, opaque | uniformément rouge |
| `eyebrow_00` | entièrement **transparente** | uniformément rouge |

Les variantes `_00` sont donc les variantes **vides** — « aucun sourcil », « aucun reflet » — et un
masque tout rouge ne désigne aucune zone. La page demande justement ces trois-là par défaut : elles
ne peuvent rien produire, et c'est normal.

Reste le point dur, désormais isolé : la texture est juste, mais **la maille n'y échantillonne
rien**. `mouth_01` contient huit bouches côte à côte — vraisemblablement huit expressions du même
style — et la maille des lèvres doit en viser une seule.

**Un fait mesuré, et une hypothèse qui n'est pas validée.** La maille des lèvres échantillonne
`u 0,019–0,232`, `v 0,325–0,493`. Reporté sur la planche, ce rectangle tombe **dans le vide**,
juste sous la première bouche, entre les deux rangées de variantes. La maille ne vise donc aucune
des huit : elle vise un emplacement **fixe**, où le jeu attend qu'on ait recopié la variante
choisie.

L'explication la plus naturelle serait que la composition du visage n'est pas un empilement de
planches entières mais un **report de sous-régions** : extraire la variante retenue et la recopier
à l'emplacement que la maille échantillonne. Cette hypothèse a été **testée et n'a pas été
confirmée** — décaler la planche de bouche pour amener sa première variante dans le rectangle visé
ne fait apparaître aucune bouche sur le modèle. Le décalage employé était estimé à l'œil, ce qui
n'en fait pas une réfutation ; mais en l'état l'hypothèse ne tient que par le raisonnement, pas par
la mesure, et elle ne doit pas être traitée comme acquise.

Ce que cela suppose de connaître, et qui reste à établir : la sous-région source de chaque variante
(les huit bouches ne sont pas indexées dans le fichier) et l'emplacement cible, qui se lit dans les
UV du G4MG de chaque maille de trait. Les deux sont accessibles ; l'architecture actuelle, en
revanche, compose les textures AVANT d'assembler les mailles, et devra donc voir cet ordre inversé.

`FACE_MDL_OFFSET_INFO` a été ouverte et **écartée** : ses deux valeurs sont `70B13199` et
`64C35FEC`, soit des CRC-32 et non des décalages, et la liste n'a qu'**une seule entrée** — elle ne
peut donc pas sélectionner parmi huit. Le mécanisme reste à trouver ; les candidats non encore
examinés sont les UV du G4MG de chaque maille de trait, qui pourraient viser directement leur
variante, et le relevé en mémoire du jeu vivant.

C'est la différence entre ce qui est fait et ce qui reste : la composition des traits fonctionne et
se voit sur la texture ; leur placement sur le modèle, non.

### 16.11 La maille est bien là — elle échantillonne du vide

Trois expériences ferment successivement les hypothèses restantes.

**La maille de traits est exportée et bien placée.** En l'avançant de 5 cm le long de sa normale —
un décalage énorme pour une tête de 30 cm — ses bornes passent bien de `z ≤ 0,122` à `z ≤ 0,174`,
donc devant la surface du visage (`z ≤ 0,139`). Et elle reste **invisible**. Ce n'est donc ni un
problème de tampon de profondeur, ni une primitive absente : elle affiche du transparent.

**La composition atteint bien son matériau.** Les trois textures du visage sont distinctes dans le
GLB (empreintes et tailles différentes), et celle de `parts_mouth_10` contient les **huit bouches**.
Le chaînage famille → emplacement → matériau fonctionne.

**Mais elle échantillonne du vide.** La maille vise `u 0,019–0,232`, `v 0,325–0,493` ; les bouches
occupent `v 0,18–0,31` en première rangée et `v 0,72–0,84` en seconde. Le rectangle visé tombe
exactement dans l'interligne.

Un défaut réel a été identifié au passage : **`eyebrow_00`, planche vide, est traitée comme le fond
de son emplacement** et le peint en carnation opaque sur toute sa surface, sous les bouches. Une
planche entièrement transparente ne devrait pas tenir lieu de fond.

Ce qui reste à trouver n'est donc plus « où sont les traits » ni « la maille rend-elle », mais une
seule chose : **ce qui doit occuper la zone que la maille vise**. Deux essais de report — décaler la
planche, puis recopier une cellule dans la boîte mesurée — n'ont rien donné, ce qui suggère que la
correspondance ne se calcule pas comme on l'a supposé.

### 16.12 La bouche apparaît — et pourquoi rien ne marchait avant

Un défaut de méthode a faussé une longue série d'essais : `AVATAR_CACHE_VERSION` était restée à 38
après un `git checkout`, et plusieurs `sed` d'incrément ne correspondaient plus. Le serveur
resservait donc son **cache** — des GLB produits par une version antérieure du code. Plusieurs
« mesures négatives » ne mesuraient rien du tout. Toute conclusion tirée d'une capture doit
désormais s'accompagner d'une vérification que la version de cache a bien changé.

Une fois le cache réellement invalidé, une **texture témoin** — huit cellules opaques de couleurs
distinctes posées sur l'emplacement des lèvres — a répondu à la question restée ouverte : la maille
**rend**, et elle sort **rouge**, la couleur de la cellule 0. Elle échantillonne donc la première
cellule de l'atlas, dans sa moitié basse (`v 0,325–0,493`), alors que la bouche y est peinte en haut
(`v 0,18–0,31`). En descendant la planche de la différence des centres, **0,164**, la bouche
apparaît sur le modèle — le premier trait de visage jamais rendu.

Restait un effet de bord : le visage sortait entièrement blanc. `decouper_par_zones` s'appliquait à
toute planche non muette, or `eye_L_01` est blanche avec de pâles ovales gris — elle ne dessine
rien, elle marque une zone, et son masque la rendait opaque par-dessus la peau. Le critère est
maintenant la présence d'**encre** (`porte_un_trait` : au moins 0,5 % de pixels franchement sombres
et opaques), ce qui sépare `mouth_01`, au trait noir, de `eye_L_01`, qui n'en a aucun.

> Le décalage de 0,164 est une **constante mesurée pour cette famille**, pas une règle générale.
> Elle se retrouve ainsi : poser la texture témoin, lire la cellule visée, comparer la boîte UV de
> la maille à la position du trait dans sa cellule. Le rendre général demande de connaître les UV
> de la maille au moment de composer, donc d'inverser l'ordre actuel — composer après avoir
> assemblé.

### 16.13 Les traits sont des MAILLES, et elles vivent dans `_base`

Aucune planche de `_facetex` ne dessine l'œil — vingt variantes mesurées, toutes à 0,000 %
d'encre. La raison est ailleurs : **les traits du visage ne sont pas des textures, ce sont des
mailles**, et elles sont rangées dans `_base`, dont le nom trompe.

`base_normal_00` déclare deux sous-mailles, `eye_10_normal_00` (480 triangles) et
`mouth_10_normal_00`, et elles sortent déjà à hauteur de tête, `y ∈ [1,291 ; 1,599]` — sans avoir
besoin d'être attachées à un os, contrairement aux pièces de `20_EDIT`.

Deux défauts réels ont été corrigés à cette occasion, indépendamment du reste :

| défaut | correction |
|---|---|
| `_base` recevait l'attache à l'os et montait à `y = 2,66`, une tête trop haut | exclue de l'attache, comme l'uniforme |
| `mouth_10_normal_00` porte des positions à ±3,4 × 10³⁸ — `FLT_MAX`, un tampon jamais rempli | `ecarter_positions_aberrantes` écarte toute primitive hors d'échelle |

**Mais la monter EN PLUS du visage ne convient pas.** `eye_10_normal_00` mesure `x ± 0,147` et
descend à `z = −0,146` quand le visage `base_eye_10` fait `± 0,123` et `−0,139` : ce n'est pas une
paire d'yeux posée sur un visage, c'est une **coquille de tête** qui l'englobe. Montée en plus,
elle déborde en blanc aux tempes — sa texture n'étant qu'une vignette 32 × 32 non résolue. L'essai
a été annulé.

Ce que cela indique pour la suite : `_base` n'est pas un complément de `_facebase`, c'en est
vraisemblablement le **support alternatif**, celui sur lequel la composition de `_facetex` devrait
être posée. Le vérifier demande de substituer l'un à l'autre et de comparer, pas de les additionner.

### 16.14 La substitution `_base` ↔ `_facebase` : testée, non retenue

Le câblage posé en §16.13 permet d'habiller `_base` de la composition de `_facetex`. Substitué à
`_facebase` comme support de tête, il donne un rendu **différent mais pas meilleur** : les oreilles
ressortent nettement et deux barres sombres occupent la place des yeux, mais la bouche disparaît.
Ces barres ne ressemblent pas aux yeux du jeu — iris brun, blanc, cils — relevés sur la capture.

Le compte est donc défavorable : on perd un trait acquis pour en gagner un qui n'est pas juste.
La substitution n'est pas retenue ; le câblage, lui, reste, puisqu'il est correct en soi et sans
effet sur la page.

La référence, elle, ne manque pas : `chara_edit_hair_tab` cadre le visage d'assez près pour qu'on
y relève l'iris en quatre points (§16.3), et elle montre nettement ce que le jeu affiche — iris
brun-mauve, blanc de l'œil, cils et contour noirs, sourcils bruns. Ce qui manque est en amont :
**aucune source lue ne fournit ce dessin**. `_facetex` n'a pas d'encre dans ses vingt variantes
d'œil, et la maille `eye_10_normal_00` de `_base` n'a pour texture qu'une vignette 32 × 32.

Tant que cette source n'est pas trouvée, la produire reviendrait à dessiner des yeux — donc à
inventer une donnée de jeu.

### 16.15 Les yeux existent — dans un conteneur, et sous forme de cible

La maille `eye_10_normal_00` consomme un matériau nommé `face_10`. Or les conteneurs de `_base`
se répartissent en deux formes, et une seule porte quelque chose :

| forme | exemple | `face_10` |
|---|---|---|
| avec suffixe numérique | `base_normal_00.g4tx`, `base_small_00.g4tx` (4,4 Ko) | **32 × 32** — un bouchon |
| sans suffixe | `base_elderlywoman.g4tx` (700 Ko) | **512 × 512** — un vrai dessin |

Onze des treize conteneurs sont de la première forme. C'est pour cela que la maille des yeux n'a
jamais rien eu à afficher : sa texture est un bouchon de 32 pixels de côté.

Et `base_elderlywoman/face_10` montre exactement ce qu'il faudrait produire — **deux yeux dessinés**,
contour, iris, sourcils — avec **1,530 %** d'encre, la même densité que les bouches de `mouth_01`
(1,494 %). Ce n'est pas la texture à poser telle quelle : la coller sur tous les avatars leur
donnerait le visage d'un personnage précis. C'est une **référence de forme**.

Ce que cela change : la cible cesse d'être « faire apparaître des yeux » pour devenir « produire,
depuis les planches de `_facetex`, une texture `face_10` de 512 × 512 comparable à celle-là ».
Comparable se mesure — densité d'encre, position des tracés, boîte englobante — contre un fichier
du jeu, et non contre une impression.

Cela réhabilite partiellement la piste de la composition par zones (§16.8, §16.14) : le dessin
attendu — contour de paupière, globe clair, iris — correspond bien aux trois régions que les
masques d'`01_eye` et `02_pupil` désignent. Les essais précédents échouaient sur le calibrage, pas
sur le principe. Ils sont à reprendre **contre cette référence**, qui manquait jusqu'ici.

### 16.16 Ce que dit la recette de l'avatar par défaut

`common/chr/_test/default/mdl_edit_avatar01.cfg.bin` décrit l'avatar que l'éditeur montre au
démarrage. Ses chaînes confirment trois choses et en corrigent une :

| donnée de la recette | état de la page |
|---|---|
| `u117401_10` / `s117401_10` | conforme — c'est bien l'uniforme et les chaussures assemblés |
| `body_type_02` | conforme au corps apparié |
| **`face55_nose02`** | **écart** : la page démarre sur `face51_nose01` |

Le catalogue range les 42 visages par type de nez, chaque entrée listant `face51`, `face53`,
`face55`… : la recette choisit donc le troisième style avec le nez de type 2, la page le premier
style avec le nez de type 1. L'avatar de départ n'est pas celui du jeu.

La recette nomme aussi les clés de composition — `CHARA_EDIT_PARAM_TEX_PARTS` avec ses variantes
`LEFT`, `RIGHT` et `COLOR` — ce qui confirme que les traits se composent bien depuis les planches
gauche/droite de `_facetex`, avec une couleur. Elle ne nomme en revanche **aucune texture de
visage** : `face_mdl_type_01` est un nom de paramètre, pas une ressource, et n'existe nulle part
dans le VFS. `face55_nose02` n'a pas plus de `.g4tx` que `face51_nose01` — aucun modèle de tête
n'en a.

La boucle est donc fermée : les traits doivent venir de la composition, et la composition n'a pas
d'encre à poser pour l'œil.

### 16.17 La voie mémoire : praticable, mais elle demande de piloter le jeu

Le processus tourne toujours (`nie_eacpatched.exe`), et `niers mem scan` s'y attache. Mais aucune
des chaînes attendues n'y figure — ni `face_10`, ni `chara_edit`, ni `hairF001`, ni `u117401`,
toutes à zéro occurrence. Le jeu n'est pas sur l'écran de l'éditeur : ses ressources ne sont pas
chargées, et il n'y a donc rien à y lire.

Lire la texture de visage composée par le moteur reste la seule voie ouverte quand les fichiers se
taisent — c'est elle qui avait tranché la question des palettes (§13). Elle suppose au préalable
de **piloter le jeu jusqu'à `chara_edit`**, ce qui, à environ une image par seconde et avec des
événements d'entrée maintenus, est un travail en soi. Le relevé lui-même n'a rien d'automatique :
il faut d'abord trouver l'ancrage, comme il avait fallu le faire pour la table des palettes.

C'est le prochain pas, et il est réaliste — pas un vœu. Mais il se mène comme une session dédiée,
avec le jeu amené sur le bon écran, et non en fin de parcours.

### 16.18 Piloter le jeu : ce qui marche, et où ça bute

Le pilotage par `xdotool` sur le display `:99` fonctionne, à condition de connaître deux règles que
les essais ont dégagées :

- **le clavier ne passe pas** — `Return`, `space`, `z`, `x`, `KP_Enter`, maintenus ou non, avec ou
  sans `--window`, n'ont eu aucun effet sur l'écran titre ;
- **la souris passe, si le clic est MAINTENU longtemps.** Un `mousedown` / `mouseup` séparés de
  0,5 s valide une modale ; il faut **1,8 s** pour réveiller l'écran titre. Un clic instantané est
  ignoré, et un maintien trop court aussi.

Avec cela, trois écrans ont été franchis : l'avertissement de sauvegarde automatique, l'écran titre
(qui fait alors apparaître `START GAME`), puis la validation de ce menu. Le jeu entre ensuite dans
un écran blanc de chargement où il reste plus de douze secondes — le rendu logiciel plafonne à
environ une image par seconde.

Le trajet est **plus court qu'on ne le croyait** : au quatrième écran, le jeu propose lui-même
« Create an avatar to represent you in all game modes », avec un bouton `Create Avatar`. C'est
l'entrée directe dans `chara_edit`, et sans risque pour une sauvegarde puisqu'il s'agit de la
création initiale — il n'y a donc ni sélection de fichier, ni monde à traverser.

Cet écran-là résiste cependant au clic maintenu : le curseur se pose bien sur le bouton (la flèche
verte s'y déplace) mais la validation ne passe pas, même à 2,5 s de maintien. Il attend une forme
d'entrée qui reste à trouver — vraisemblablement une manette, le jeu étant un portage console.
C'est le seul obstacle qui sépare encore du relevé mémoire.

### 16.19 Trois verrous levés : l'éditeur du jeu est atteignable, et sa mémoire lisible

**1. Les entrées passent par XTEST, pas par la fenêtre.** `xdotool key --window <id>` utilise
`XSendEvent`, que le jeu ignore — d'où l'impression tenace que « le clavier ne passe pas ». Sans
`--window`, après `windowactivate` + `windowfocus`, les touches passent. C'est ce qui a ouvert
l'écran de création d'avatar, resté sourd à tous les clics.

**2. `niers mem scan` se limite au module `nie.exe` par défaut.** Les noms de ressources vivent dans
le tas : il faut `--all`. Sans lui, `face_10` donnait zéro occurrence alors que le jeu était sur
l'écran ; avec lui, huit.

**3. La mémoire porte les chemins ET les tables de noms.** On y lit en clair
`/_face/20_EDIT/_facetex/00_face/face_10.g4tx`, et plus loin des tables contiguës — `face_10`,
`face_11`, … `face_15` — ainsi que la liste des textures d'un conteneur, `face_10`, `face_10line`,
`face_10msk`, `face_10oc`. **On n'a donc plus à deviner quelles planches le jeu compose : on peut
lire celles qu'il charge.**

Ce que cela n'a pas résolu : les variantes hautes de `00_face` — `face_10` à `face_15`, `face_20`,
`face_30` — sont **toutes à 0,000 % d'encre**, comme les basses. La famille du visage ne dessine
rien, quelle que soit sa variante, et `_facetex/00_face/face_10.g4tx`, que le jeu charge pourtant,
n'en porte que 0,153 % — un tracé isolé, pas un visage.

**Le pas suivant est maintenant à portée** : scanner `--all` les chemins `_facetex/` et `_base/`
pendant que l'éditeur est affiché donne la **liste exacte** des planches composées. Quarante
occurrences de `_facetex/` sont déjà repérées. C'est cette liste — et non une hypothèse sur les
familles — qui dira d'où viennent les yeux.

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
niers mem lua-field listRowNum --numeric -r 6   # §13 — jeu lancé (scripts/nie-wine-setup.sh)
niers img diff <page.png> var/refs-avatar/live/chara_edit_style_01.png --roi <roi.json>  # §14
```
