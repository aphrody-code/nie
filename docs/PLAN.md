# Plan maître

## L'objectif

**Un moteur de jeu complet en Rust, et une chaîne qui produit `nie.exe` identique à l'original au
byte près.** Deux faces d'un même but, qui se valident l'une l'autre :

1. **Le moteur** — réécrire *Inazuma Eleven: Victory Road* en Rust pur, jouable en natif, headless
   et WebAssembly, sans le binaire Windows ni le moteur propriétaire.
2. **La forge** — `crates/forge/` **génère** le binaire depuis le dépôt et vérifie à chaque
   construction qu'il est byte-identique. Elle mesure, à l'octet, la part que le workspace produit
   réellement ; le reste est recopié de la référence, et dit comme tel.

La forge est le **juge** du moteur : tant qu'un octet n'est pas produit par du code du dépôt, ce
qu'il contient n'est pas compris. Elle transforme « on a porté beaucoup de choses » en un nombre
falsifiable. Document dédié : [`FORGE.md`](FORGE.md).

Le reverse-engineering est **l'échafaudage**, pas la fin : il sert à résoudre la logique de
`nie.exe` pour la porter. Les vérités terrain de portage sont iecode (C#), inagle (TS) et le réel
(`.pdata`, les dumps du VFS) — ce ne sont pas des dépendances permanentes.

## L'état, mesuré

| Couverture | Ce qu'elle mesure | État |
|---|---|---|
| **Forge** | part de `nie.exe` produite par le dépôt | **51,86 %** du fichier · **66,09 %** du `.text` — mesure du 2026-08-10, cible byte-identique au binaire installé au 2026-08-15 (même sha256, `.pdata` identique à l'octet), mais `var/forge/` absent sur ce VPS donc non rejouable ici. **Toujours pas rejouable le 2026-08-28** : `var/forge/` est absent de la machine Windows aussi (`nie-forge report` → « recouvrement absent : var/forge\cover.json »). Le chiffre tient parce que la cible n'a pas bougé, pas parce qu'on l'a revérifié |
| **Formats** | fichiers du VFS dans un format parsé | **87,93 %** réellement décodés (224 497 / 255 316) — mesure du 2026-08-28 sur le dump complet, `niers vfs formats --parse`, 0 fichier illisible. S'y ajoutent **4,39 %** (11 215) dont le magic est connu sans décodeur autonome (`@UTF` 5 513, `AWB` 5 512, `USM` 190 : des conteneurs média), soit **92,32 % identifiés**. Restent **7,68 %** (19 604) sans magic ni parseur, dont ~15 900 `.g4mg` — des tampons de sommets bruts décrits par leur `.g4md` frère, donc non décodables seuls **par construction**. L'ancien chiffre de 99,56 % n'était adossé à aucune commande : il n'est pas « tombé », il n'a jamais été rejouable |
| **Données** | familles `cfg.bin` typées et recalculées au bit | 117 modules, **121 familles routées**, 127 fichiers golden |
| **Logique** | fonctions de gameplay portées **et** validées byte-exact | **43** validations dans la suite oracle — non rejouées le 2026-08-15 ; le binaire cible n'a pas changé (cf. Forge ci-dessus) donc rien n'indique qu'elles soient tombées, mais elles n'ont pas non plus été reconfirmées cette session |
| **RE** | fonctions classifiées / nommées | **La KB n'est pas la même d'une machine à l'autre — citer la machine avec le chiffre.** Sur la machine Windows le 2026-08-28, `niers coverage --db var/niers.sqlite` donne **87,63 %** (48 503 / 55 351) et **257 nommées** : cette base-là n'a pas les noms du VPS (table `symbol` vide), elle est à réindexer avant d'en tirer quoi que ce soit. Mesures du VPS ci-dessous. Mesure du 2026-08-10 : 93,36 % (49 280 / 52 783) · 6 429 nommées (12,18 %). **Revérifié 2026-08-15** (`niers rebuild` sur le binaire actuellement installé, byte-identique à celui du 2026-08-10) : **91,22 %** classées (97 006 / 106 340) · 6 429 nommées (**6,05 %**, même compte brut sur un dénominateur qui a grossi — le VPS a transité par un AUTRE build entre le 2026-08-14 soir et le 2026-08-15, cf. `docs/RE.md`, ce qui a pu affecter l'indexation entre-temps) |
| **Rendu** | Δpixel contre capture de référence | gaté sur le driver de menu runtime |

Ces chiffres se régénèrent : `nie-forge report`, `niers vfs stats`, `niers vfs formats --parse`,
`niers coverage`, `uv run scripts/validate_re.py`. La ligne **Formats** n'avait justement aucune
commande derrière elle jusqu'au 2026-08-28 — un chiffre que personne ne pouvait falsifier, dans un
document qui n'accepte que des chiffres falsifiables ; `niers vfs formats` a été écrite pour ça.
**Piège vécu le 2026-08-15** : une doc « corrigée » sur une
installation Steam locale transitoirement sur un autre build (`docs/RE.md`, commit du
2026-08-14) s'est révélée elle-même périmée dès que le build de référence est revenu — ne jamais
« corriger » un chiffre de cible sans citer le sha256 mesuré, sinon la correction se périme au
download suivant sans que rien ne le signale.

## Ce que « validé » veut dire

**Aucun FAIT sans validation bout-en-bout sur le réel.** Le dépôt a connu plusieurs faux FAIT —
des fixtures synthétiques qui passaient pendant que les vrais fichiers cassaient. La règle qui en
découle :

- Un format est porté quand il parse **tout son corpus réel**, pas un échantillon.
- Une donnée est portée quand elle est **recalculée au bit** contre le dump du jeu.
- Une fonction est portée quand elle est **byte-exacte contre un oracle** — l'émulation Unicorn
  d'une fonction isolée du vrai binaire (`scripts/uemu.py`), ou la forge elle-même.
- Une pièce dont la validation est impossible se marque **INCOMPLET**, jamais FAIT.

L'oracle uemu est ce qui a levé le verrou « pas d'oracle → pas portable » : il exécute une
fonction du binaire réel avec des entrées fixées et capture mémoire et registres, sans faire
tourner le jeu. La validation **multi-frames** est requise pour toute physique à état : le
single-step cache les branches non exercées — c'est ainsi qu'un clamp de bord absent du port de
`BallMoveLerp` avait échappé aux tests.

## Les piliers

### Formats — `nie-formats`

38 modules, 237 tests. Tous les conteneurs binaires structurés du jeu parsent : CPK (clé
CRC32(nom), 936/936), `cfg.bin` dans ses deux formes (T2B et RDBN), @UTF, CRILAYLA, la famille G4*
(TX, MG, MD, SK, MT, MA, PK, PKM, CM, VS, LA), PXCL (collision), G4NV (navmesh), MEVBIN, OBJB,
DXBC (shaders), et l'audio Criware (ADX/AWB/ACB/USM, HCA décodé avec la clé IEVR).

`cpk_list.cfg.bin` est chiffré en **AES-256-CBC**, clé et IV reversés statiquement du binaire —
un déchiffrement qu'iecode n'a pas.

**Deux montages du VFS, mêmes chemins logiques** (2026-08-28). `nie_formats::vfs` sert
indifféremment l'installation du jeu (`cpk_list.cfg.bin` + `packs/*.cpk`) et un **dump extrait**
(`data/common/`, `data/dx11/`) : `Vfs::init` bascule seule sur le dump quand l'index chiffré
manque, `open_game()` monte ce qui est disponible, `NIE_DUMP_DIR` force le dump. Un dump local
couvre **255 308 / 255 308** chemins de l'index (100,000 %, `example dump_couverture`), et les
deux montages rendent des octets identiques (`test dump_vs_packs`) — jusqu'au PNG d'un écran de
menu et aux 170 frames d'un playthrough, au sha256 près. Conséquence pour le plan : le moteur, ses
goldens et l'explorateur tournent sur une machine sans installation, et une mesure qui exigeait
d'extraire 255 000 fichiers d'archives devient une lecture de fichiers.

Reste : la hiérarchie d'os `g4sk` garde un fallback heuristique sur certains fichiers (les
matrices, elles, sont byte-exactes) ; 1 121 fichiers en formats non structurés (`.ptlb`, `.fxbin`,
`.clobin`, `.g4tg`, blobs hash-nommés).

**Huit parseurs n'étaient branchés nulle part** (constaté et corrigé le 2026-08-28). `g4sk`,
`navm`, `g4mt`, `g4cm`, `g4la`, `g4ma`, `g4vs` et `col` existaient, testés, mais absents de
`decode` — la table de dispatch que partagent la FFI, `niers decode`, l'explorateur et le MCP.
Un parseur qu'elle ignore est invisible à tout le monde. Ils y sont, et un test
(`decode_dispatch`) vérifie la correspondance extension → parseur sur de vrais fichiers, pour que
le prochain n'y échappe pas : `.g4nv` → `navm`, `.col` → `col (PXCL)`, etc. Effet mesuré :
1 217 `.g4cm`, 1 150 `.col`, 339 `.g4sk`, 160 `.g4nv`, 70 `.g4mt` et 43 `.g4la`/`.g4ma`/`.g4vs`
passent de « non reconnu » à décodé. `.g4la` et `.g4vs` ne comptent que **4 fichiers chacun** dans
tout le jeu, tous décodés : un échantillon de cette taille ne prouve pas grand-chose sur la
robustesse du parseur, il prouve seulement que ces fichiers-là passent.

### Données — `nie-data`

117 modules, 1 431 tests, 127 fichiers golden. Le système de **conditions** est décodé et validé
sur tout le corpus (17 788 blobs) : cadrage binaire plus sémantique story/event-flag. Le
**résolveur de texte universel** débloque la résolution de tout texte localisé par hash, ce qui a
permis les jointures nom/description sur personnages, objets, quêtes, auras, équipes, trophées.

La chaîne personnage est complète de bout en bout : `chara_base` → nom, biographie, équipe, série.

Le typage n'est pas la condition de l'accès : les familles non typées sont déjà lisibles en
générique. Ce qui reste est du polissage sur de petites tables.

### Logique — `nie-core`

35 modules, 262 tests. Portés et validés byte-exact contre l'oracle : le PRNG `lives::CRand`
(MT19937 avec bornage de Lemire), les physiques de ballon (parabole, lerp avec son clamp, suivi de
cible, dribble, Bézier, taux, intégration normale, filet), la géométrie d'arrêt du gardien, le
décodeur de valeurs typées d'objet-menu, le conteneur de list-view intrusif (template C++ prouvé
sur trois instanciations), et un ensemble de primitives — composition affine, produit de
quaternions, multiplication 4×4, tables à clé, viewport letterbox, `strcmp`/`strncmp`/`strlen`.

**Limite assumée** : `match_sim` reste **nominal**. Le RE établit que la résolution tir/but n'est
pas une formule inline mais un évaluateur data-driven ; `GOAL_RATE_BASE` n'a aucun fondement
binaire et c'est écrit dans le code. Voir [`modele-de-match.md`](modele-de-match.md).

### Rendu et menu

Le rendu fidèle du menu est **gaté sur le driver de menu runtime**. Le vrai menu n'est pas dans
les fichiers : il est construit à l'exécution par le menu-manager C++, qui lit les
`*_menu_setting.cfg.bin`, crée les objets, et pilote le Lua via `funcLuaMenuCommand` — le script
appelle alors `SetSprite`/`SetText`/`SetIconSprite`.

Ce qui existe déjà : le compositeur f32 de `nie-formats::menu`, l'hôte Lua `nie-lua` avec ses
commandes mappées, l'arbre d'écrans validé (100 % des ~3 300 layers vérifient
`layer_id == CRC32(name)`), et les données de texte FR complètes.

Ce qui manque : la boucle de build moteur→Lua. C'est la priorité, parce que tout le visuel du menu
et le contenu des sous-menus en dépendent.

**Les callbacks ne sont plus devinés** (2026-08-27). `OnInit`, `OnSetupLayer` et `OnOpenLayer`
existent littéralement dans le binaire, aux côtés de **141 chaînes `On*`** dont 12 sur les layers
(`OnCloseLayer`, `OnUpdateLayer`, `OnOpenEndLayer`, `OnChangeLayerGroup`…). Le nom n'était donc pas
le problème : c'est la boucle qui les invoque qui manquait. Ses points d'entrée sont localisés,
tous dans un même bloc — le menu-manager :

| callback | adresse | | callback | adresse |
|---|---|---|---|---|
| `OnInit` | `0x1410C7F60` | | `OnOpenEndLayer` | `0x1410C69A0` |
| `OnSetupLayer` | `0x1410C6F70` | | `OnCloseLayer` | `0x1410C7290` |
| `OnOpenLayer` | `0x1410C70C0` | | `OnUpdateLayer` | `0x1410C8B60` |

`OnSetupLayer` et `OnOpenLayer` partagent le **même squelette d'appels** : l'invocation Lua est
centralisée, et passe par `0x1410C5BE0`, la fonction qui référence `CLuaComponent`. Le RTTI nomme
le reste de la chaîne — **353 classes `*Menu*`, toutes avec vtable résolue** :

| classe | vtable | rôle |
|---|---|---|
| `CLuaComponent` | `0x141A50090` | pont moteur↔Lua |
| `CLuaMenuObject` | `0x141A00E90` | objet menu piloté par script |
| `?$LuaMenuWithStateMachine` | `0x141A051A0` | menu Lua à machine à états |
| `?$MenuStateMachine` / `?$IMenuState` | `0x141A05190` / `0x141A24EA8` | états |
| `CObjLuaManager` | `0x141A50410` | gestion des objets Lua |

**La boucle est identifiée.** Les callbacks ne sont pas des fonctions libres : ce sont les
**méthodes virtuelles de `CLuaMenuObject`**, à des slots fixes de sa vtable (55 entrées). `OnInit`
(slot 9, 1 665 o) porte les deux chaînes qui ferment la chaîne de bout en bout —
**`common/script/lua/menu/%s.lua.bin`** (le script est chargé depuis le VFS par nom d'écran) et
**`__menuObjPtr`** (la globale Lua qui reçoit le pointeur de l'objet menu). Le VFS contient bien
**552 scripts** sous ce préfixe, sur 1 197 `.lua.bin` au total.

Interface à implémenter, par slot (24 des 55 se nomment par les chaînes qu'ils référencent) :

| rôle | slots |
|---|---|
| pas de simulation | `2 PreStep` · `3 Step` · `4 PostStep` · `5 SceneStep` |
| cycle de vie | `9 OnInit`/`FinalizeMenu` |
| **cycle d'un layer** | `29 OnSetupLayer` → `30 OnOpenLayer` → `31 OnCloseLayer` → `32 OnOpenEndLayer` → `33 OnCloseEndLayer` · `36 OnUpdateLayer` |
| focus | `38 MoveFocusDec` · `39 MoveFocusInc` · `40 MoveFocusMtx` · `41 OnChangeFocus` · `43 OnDecideFocus` |
| entrée | `25 OnEnter` · `26 OnSubEnter` · `27 OnFunction` · `44 OnChangeLayerGroup` |
| souris | `49 OnMouseMove` · `50 OnMouseLDown` · `51 OnMouseLOn` · `52 OnMouseLUp` |

Les slots 8, 47 et 48 pointent tous vers le même stub : méthodes non implémentées, à ne pas porter.

Deux pièges pour qui relit une vtable ici : `rtti_class.vtable_vaddr` désigne le **pointeur COL**,
la table commence à **`+8`** ; et arrêter la lecture au premier pointeur absent de `.pdata` tronque
la table (`CLuaComponent` : 2 méthodes au lieu de 55), parce que les méthodes feuilles n'ont pas
d'entrée `.pdata`. Le bon critère de fin est « le qword ne pointe plus dans `.text` ».

#### État mesuré côté hôte Lua (2026-08-27)

`examples/probe_menu_script` exécute un vrai script de menu dans la VM. Deux verrous s'y
enchaînaient ; **le premier est levé** :

1. *(levé)* `OnInit()` échouait systématiquement sur
   « attempt to index field `MAIN_MENU` (a nil value) ». Cause : la sonde indexait les scripts par
   **basename brut** et résolvait `INCLUDE` sur ce basename, alors que `INCLUDE` reçoit un **nom
   logique** (`LUA_MENU_DEF`) et que les fichiers portent un suffixe de version
   (`menu_def_7.01.06.00.lua.bin`). Les inclusions échouaient **en silence** — `INCLUDE` introuvable
   renvoie vide, par choix — et le défaut ne se manifestait que bien plus loin, par un champ nil.
   `nie-lua` exposait déjà les deux helpers corrects (`include_logical_base`,
   `script_logical_base`) : la sonde ne les appelait pas. Depuis, les 8 inclusions de `main_menu`
   se résolvent, `OnInit() -> ok()`, et la surface de globales définies par le script passe
   d'environ 80 à plus de 250 fonctions.
2. *(levé)* `OnSetupLayer`/`OnOpenLayer` s'exécutaient sans erreur mais n'émettaient rien. Ce
   n'était **pas** un manque côté hôte : une trace des globals absents pendant la construction en
   relève **zéro**. La cause est l'**identifiant passé** — `OnSetupLayer` est un dispatcher qui
   compare le layerId à ses propres constantes, et le CRC32 du nom de l'**écran** (`main_menu` =
   `0x9DB608F1`) n'est pas celui d'un **layer**. En balayant les 2 628 `menu_layer` de la KB,
   **8 layers construisent** :

   `mainmenu90_01_header` · `mainmenu90_02_header_tab` · `mainmenu90_31_doc_item` ·
   `mainmenu01_06_base_button_guide` · `cmn01_40_list_base_empty` · `cmn01_12_new_icon` ·
   `cmn01_13_new_icon_red` · `rpg00_07_weekday_timezone_guide`

   Résultat : `layers=2 objects=9`, **60 commandes** émises (contre 1), dont `SetIconSprite`,
   `SetNodeSprite`, `SetText`, `SetNodeParam`, `SetObjectVisible`, `SetChildVisible`,
   `SetListItemValues`. Quatre objets portent un hash de sprite, deux un texte. **Le menu
   construit** — il reste à brancher le renderer et à résoudre 2 cmdIds inconnus
   (`0x555E4093`, `0xE57428CF`).

**La méthode généralise** — 6 écrans essayés, 6 construisent (balayage des 2 628 `menu_layer`) :

| écran | layers qui construisent | objets | commandes |
|---|---|---|---|
| `main_menu` | 8 | 9 | 60 |
| `formation_menu` | 18 | 21 | 427 |
| `item_menu` | 7 | 7 | 56 |
| `ability_list_menu` | 6 | 7 | 27 |
| `chara_edit_menu` | 5 | 7 | 25 |
| `equip_menu` | 4 | 6 | 14 |

**Les hashes de sprite sont résolus** (2026-08-27) — c'est le verrou du rendu qui tombe.

Un `sprite_texture_hash` est le **CRC-32 du chemin logique** de la texture : `#/` + le chemin VFS
privé de `data/dx11/`. Exemple vérifié :

    crc32("#/menu/200_icon/15_icon_common/icon_common.g4tx") = 0x8A4A118B
    crc32("#/menu/20_cmn/cmn01/cmn01_40/cmn01_40.g4tx")      = 0x500A6B35

Le second confirme la convention par recoupement : `cmn01_40` est exactement le layer
`cmn01_40_list_base_empty` relevé pendant la construction du `main_menu`.

Chaîne complète prouvée de bout en bout — `sprite_hash` → chemin logique → chemin VFS → `.g4tx` →
**PNG décodé** (`niers decode`, 592 766 o sur `icon_common`). La table des **54 203** chemins
`.g4tx` est ingérée dans `hash_name` sous `kind='texture_path'` (`source='crc32-logique'`), donc
résoluble par tout le pipeline.

Comment la convention a été trouvée, la méthode valant pour la suite : quatre pistes ont échoué
(`hash_name` après `seed-ui --textures`, CRC32 des chemins **disque** en 9 variantes × 3 casses,
constantes de tables Lua via `_G`, interception d'un nom côté hôte — le RE de `0x140CE74D0` prouve
que les arguments arrivent en nombres). Ce qui a payé : chercher les hashes dans le **pool de
constantes du bytecode** (`examples/hunt_sprite_hash`), puis corréler `crc32(constante chaîne)`
avec les hashes cherchés. Le script portait le nom *et* le hash ; la corrélation a livré les deux
d'un coup. Tester la forme **disque** d'un chemin ne pouvait pas marcher — le jeu hache une forme
**logique**.

Restent 2 valeurs non résolues par un chemin (`0xA30165ED`, présente dans 616 scripts sur 651, et
`0x32A55794`) : cohérent avec la double sémantique du champ — `SetSprite` y écrit un `cell_id`,
pas un hash de nom. Séparer les deux champs reste à faire.

L'explication est dans `menu_host.rs` : le champ `sprite_texture_hash` a **deux sémantiques
selon la commande qui l'écrit** — `SetSprite` y met un `cell_id` (index de cellule d'atlas,
arg 2), tandis que `SetIconSprite` y met `h1`, annoté « chemin g4tx » mais **INFÉRÉ**. Chercher
un nom de fichier pour des valeurs qui sont parfois des index ne pouvait pas aboutir.

Le RE du handler tranche une partie de la question. `0x140CE74D0` tombe dans un **trou de racines**
`.pdata` (fonction chaînée) ; ses vraies bornes sont `0x140CE7468..0x140CE75B4` (332 o), obtenues en
fusionnant toutes les entrées `.pdata` du fichier — pas la table des racines de la KB. Le corps est
une **boucle de lecture d'arguments** : trois fois le même motif (`[rdi+8]` = index courant,
incrément, `call 0x1405E88C0` qui rend un `double` dans `xmm0`, puis `cvttsd2si` avec branche sur
le signe) rangeant les résultats dans `r14`, `rsi`, `r12`.

Fait établi : `SetIconSprite` reçoit ses trois hashes en **valeurs numériques**, jamais en chaînes.
Le nom de texture n'existe donc nulle part côté hôte — c'est le script Lua qui porte déjà des
hashes. Inutile de chercher à intercepter un nom en clair au niveau des commandes ; la source des
valeurs est en amont, dans les tables Lua (`MENU_DEF` et consorts) ou dans une fonction de hachage
Lua. C'est là qu'il faut regarder, en instrumentant `_G` côté script plutôt que l'hôte.

Troisième piste éliminée : ces hashes ne sont **pas** des constantes de table Lua. Un parcours en
profondeur de `_G` (4 niveaux, tables déjà visitées ignorées) après `OnInit` ne retrouve aucune des
valeurs observées. Elles sont donc calculées à la volée, ou littérales dans le **pool de constantes
du bytecode** — c'est là qu'il faut aller les chercher (`bytecode.rs` sait déjà lire un `.lua.bin`).

Prochaine étape avant de brancher `nie_formats::menu::compose` : séparer les deux sémantiques du
champ (garder `cell_id` distinct d'un hash de nom), puis extraire le pool de constantes des scripts
de menu pour voir si les valeurs y figurent en littéral.

Deux leçons de méthode, toutes deux payantes ici :
- une inclusion non résolue est **silencieuse** (`INCLUDE` introuvable renvoie vide, par choix) et
  ne se manifeste que bien plus loin par un champ nil : tracer résolu/non-résolu avant de
  soupçonner le script ;
- devant un callback qui « ne fait rien », vérifier d'abord ce qui **manque** (globals absents),
  puis ce qu'on lui **passe**. Ici le premier était vide et c'est le second qui était faux ; la
  bonne source d'identifiants est `hash_name` (`kind='menu_layer'`), pas le nom de l'écran.

### Autres crates

`nie-save` déchiffre, lit et édite les saves (XOR à clé CRC32). `nie-steam` porte l'acquisition
Steam native. `nie-wiki` expose game-data depuis le miroir SQLite. `nie-camera` porte le modèle et
les contrôleurs de caméra. `nie-lua` exécute les vrais scripts et les analyse statiquement.
`nie-viola` porte les opérations de modding LEVEL-5 — dump, pack, merge, chiffrement Criware —
dont la fusion **au champ** des `.cfg.bin`, que les outils amont ne peuvent pas faire faute de
comprendre les formats.

### L'application — `apps/nie-explorer`

Explorateur du VFS, éditeur de données, atelier de modding et boîte à outils de reverse, en Tauri.
Elle ne réimplémente rien : elle appelle les mêmes crates que `niers`, en process. C'est aussi le
banc d'essai le plus exigeant du portage — un format mal parsé s'y voit immédiatement.

État, limites assumées et écarts restants : [`apps/nie-explorer/ROADMAP.md`](../apps/nie-explorer/ROADMAP.md).

`crates/archive/nie-engine` est **hors du workspace** : 15 000 lignes portées des fichiers C
décompilés, mais consommées par aucune crate vivante et redondantes avec les crates byte-exactes.
Conservé en lecture seule comme carte du flux d'orchestration C++ ; ses 434 marqueurs `// EXTERN:`
disent l'ampleur de ce qui n'y est pas connecté. Ne jamais replier son code dans les crates
wasm-portables ou byte-exactes sans re-validation.

## Priorités

1. **Le driver de menu runtime** — débloque le menu et tous les sous-menus visuels.
2. **La forge** — continuer à monter la part produite ; la cible se choisit par le chiffre
   (`nie-forge candidates --no-reloc`, les lignes `blocker` de `lift`), jamais à l'intuition.
   Préalable devenu bloquant : `var/forge/` n'existe sur aucune des deux machines, donc *aucune*
   mesure de forge n'est rejouable aujourd'hui. Relancer `just forge` avant de citer un chiffre.
3. **La physique de match byte-fidèle** — poursuivre les ports validés par oracle.
4. **Le dialogue du mode Histoire** — résoudre la source du texte au runtime.
5. **Rendre les mesures rejouables** — la ligne Formats l'est depuis le 2026-08-28
   (`niers vfs formats`) ; restent la forge (§2) et la KB de la machine Windows (`symbol` vide,
   257 noms contre 6 429 sur le VPS). Un chiffre qu'aucune commande ne régénère finit par
   décrire un état que plus personne n'a sous les yeux.
