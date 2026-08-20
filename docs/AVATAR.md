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
