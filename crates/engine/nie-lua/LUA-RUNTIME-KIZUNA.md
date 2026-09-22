# Couverture Lua runtime — Kizuna

Date de clôture : 2026-09-06.

## Résultat

Le chemin Lua brut VFS → décodage → VM Lua 5.2 unsafe → hôte de menu → état de
runtime est opérationnel pour le menu `kizuna_town_mainmenu`.

- Scripts réels décodés : **1 197/1 197**, soit **1 053 252 instructions** (remesuré
  2026-09-19 ; la clôture de 2026-09-06 annonçait 1 143 et 985 971 — le corpus a grossi, ces
  chiffres ne sont pas comparables d’une version du jeu à l’autre).
- Audit ciblé Kizuna : **25/25 scripts exécutés**, 0 erreur, 0 include manquant,
  0 appel hôte manquant.
- Décodage ciblé Kizuna : **25/25 chunks décodés**, 0 erreur, **31 957
  instructions** parcourues par le décodeur Rust.
- Audit VFS complet : **1 197/1 197 scripts exécutés**, 0 erreur, 0 include
  manquant.
- Runtime Kizuna : **102 commandes connues**, 0 commande menu inconnue,
  0 commande générale inconnue.
- Trace `INCLUDE` Kizuna : **25 modules distincts résolus**, 0 include manquant
  (les 25 scripts audités partagent bien les modules dans la résolution VFS).
- `lua-run` sur le chunk primaire Kizuna : `decoded=true`, **1 933
  instructions**, erreur de décodage nulle et aucune invocation hôte inconnue.
- Export runtime : 21 objets de layout, 8 objets Lua, 12 objets mutés,
  10 masqués, 9 sprites et 9 textes mis à jour.

## Travaux réalisés

`LuaSession` conserve désormais le même état de menu lors de l’exécution et du
rechargement de VM. `drive_menu_for_frames` permet d’exécuter plusieurs frames
avec le même résolveur d’include et le même hôte.

La sélection d’un include versionné compare ses composants de version
numériquement, afin qu’un fichier `..._10...` ne soit pas devancé par
`..._9...` selon l’ordre ASCII.

`ExecOutput` expose désormais `loaded_includes`, dans l’ordre réel de chargement.

Le décodage live est maintenant mesuré sur toute la chaîne : `decoded_instructions` compte le
chunk principal, `decoded_include_instructions` agrège les instructions de chaque include binaire
effectivement validé dans la VM, et `decoded_instructions_total` additionne les deux (pour un
chunk principal binaire). Le CLI expose ces valeurs sous `liveDecodedIncludeInstructions` et
`liveDecodedInstructionsTotal`, afin qu’un audit ne puisse pas déclarer un succès en ne mesurant
que l’entrée principale.
`lua-run` le rend dans `loadedIncludes` et `lua-audit` l’agrège par nom de module,
ce qui rend la résolution VFS observable et vérifiable.

`lua-audit` compte aussi séparément les chunks décodés et le nombre total
d’instructions, afin qu’un succès VM ne masque pas une divergence du décodeur.

La même instrumentation est maintenant disponible sur `LuaSession` via
`take_loaded_includes()`. Elle survit à `reload()` et se prélève séparément,
ce qui permet à une console ou à un pilotage live de distinguer un module
réellement chargé d’un simple état global déjà présent.

`LuaSession::with_script_paths` fournit désormais le branchement VFS standard :
il construit l’index physique/logique, sélectionne la version numérique correcte
et délègue la lecture au reader brut de l’appelant. Un test vérifie la sélection
de `module_10` devant `module_9`.
`LuaSession::exec_vfs` réutilise ce même résolveur pour le chunk principal : le caller n’a plus
à lire séparément le fichier avant de l’envoyer à la VM persistante.
Ce chemin applique par défaut une limite de 20 millions d’instructions (`exec_vfs_with_limit` permet
de la régler) ; le hook est retiré après chaque appel, y compris lorsqu’une boucle est interrompue,
afin de ne pas contaminer les événements live suivants.
La même protection couvre désormais `LuaSession::drive_menu_for_frames` via
`drive_menu_for_frames_with_limit` : le budget englobe le top-level, les callbacks de layers et les
frames, puis la VM reste disponible pour l’événement suivant.
Le driver bas niveau positionne aussi le layer courant avant chaque groupe de callbacks via son
pont interne host→driver ; les commandes d’objet sans layer explicite ciblent ainsi le même layer
que dans le pilotage événementiel de la session.

`RuntimeContext` fournit l’injection typée des globals primitifs que le manager
natif pose avant un callback (nombres, booléens, chaînes). Le contexte est
appliqué après les stubs, conservé par la session et réappliqué au `reload()` ;
il permet donc de fournir les valeurs de scène/save réellement connues sans
transformer un manque de contexte en table Lua truthy.
Lorsqu’un écran remplace le contexte, les anciennes clés absentes du nouveau
contexte sont supprimées de la VM avant injection ; aucun slot de scène ne fuit
ainsi dans le menu suivant.
Le même type est désormais porté par `ExecOptions` : `execute` et
`execute_with_include` utilisent ainsi ce contexte sur le chunk principal comme
sur les modules VFS inclus.
`LuaSession::call_menu_callback` expose aussi les événements host→Lua de
navigation (`OnSetupLayer`, `OnOpenLayer`, `OnCloseLayer`, `OnCloseEndLayer`,
`OnChangeLayerGroup`) sur la même VM, avec injection de contexte par événement.
`call_menu_callback_typed` conserve en plus les booléens, chaînes et `nil` explicites du pont
natif, ainsi que leur arité Lua observable.
`DriveReport` expose désormais `frames_requested`, `frames_executed` et le
compteur par callback ; l’ordre et la couverture de la boucle de frames sont
ainsi vérifiables sans déduire le résultat de l’état final seul.
`LuaSession::drive_menu_for_frames` injecte automatiquement les comptes de scène absents dans
`MenuState.object_attr` (sans écraser une valeur déjà fournie), de sorte que
`GetObjectAttr`/`GetItemButtonNum` fonctionne aussi pour un appelant VFS brut minimal.

`execute_with_script_paths` centralise désormais le chemin brut VFS → index des
scripts → résolution logique/versionnée → VM. `lua-run` et `lua-audit` l’utilisent
directement, ce qui supprime leurs résolveurs divergents et vérifie la sélection
numérique des versions au même endroit.
`ExecOutput.decoded_instructions` expose en plus la mesure du chunk principal
décodé dans le même appel que son exécution ; le CLI la publie sous
`liveDecodedInstructions`.

Le driver `nie-game --runtime` utilise maintenant cette session persistante
plutôt qu’une VM et des index d’include reconstruits à la main. La vérification
Kizuna réelle termine avec `on_init=true`, `on_open=true`, 102 commandes
connues et 0 inconnue.
L’export `runtimeSummary.loadedIncludes` conserve aussi les modules chargés et
leur fréquence (notamment `LUA_KIZUNA_TOWN_MENU_INC`, `LUA_MENU_DEF` et
`LUA_PROG_BASE`).
Le même export contient désormais `decodedScripts`, `decodeErrors` et
`decodedInstructions` ; Kizuna vérifie `1/1`, `0` et `1 933` respectivement.

`menu_host` couvre les commandes Kizuna de visibilité, couleur RGBA, paramètres,
texture et application de flags. Les commandes générales identifiées par le RE
sont décodées avec leur protocole de retour ; les requêtes d’état sans donnée
native disponible renvoient un neutre explicite et déterministe.

Les espaces de noms et constantes observés dans les scripts sont injectés avec
leurs valeurs CRC32 connues, notamment les recettes de Chara Edit, les os,
les types de tutoriel, les types d’onglet et les constantes de texture/texte.
L’état `partVisible` et `partColorRgba` est propagé jusqu’à l’export du layout.
Les mutations Kizuna `SetPartTexture`, `SetPartParam` et `ApplyPartFlags` conservent
également leurs arguments numériques bruts par partie, exportés sous
`partTextureArgs`, `partParamArgs` et `partFlagArgs` sans leur attribuer un sens
non prouvé.

## Vérifications

```text
cargo test -p nie-lua --lib
97 passed, 0 failed, 1 ignored

cargo clippy -p nie-lua --lib --tests -- -D warnings
cargo clippy -p nie-game --bins --tests -- -D warnings
success, 0 warning sur les deux cibles
```

Les audits ont été lancés avec `NIE_GAME_DIR`/`--game-dir` vers l’installation
locale du jeu, sans chemin machine écrit dans le code ou dans ce rapport.

Le désassembleur résout aussi les cibles de saut avec la règle Lua
`pc + 1 + sBx` et affiche les arités réelles de `CALL`, `TAILCALL` et `RETURN`
(`B-1`/`C-1`, `vararg` et `multret` inclus). Un test VM généré vérifie ce listing.
Il rejette désormais explicitement les formats, tailles C et endianess d’en-tête
incohérents, au lieu de tenter un décodage ambigu.
`LOADKX` est également résolu avec l’`EXTRAARG` suivant, comme dans le
bytecode Lua 5.2, au lieu d’être présenté à tort comme `K0`.
Les lectures bornées du décodeur vérifient désormais les additions de curseur
et les conversions `size_t` avant tout accès mémoire ; le corpus réel confirme
toujours **1 143/1 143 scripts** et **985 971 instructions** décodés.
Le chargement live appelle maintenant ce même décodeur avant `mlua` pour le
chunk principal de `execute`, `LuaSession::exec/attach`, le pilotage de menu,
**et chaque `INCLUDE` binaire**. Un test de régression vérifie
qu’un conteneur malformé est refusé avant son exécution et qu’un include invalide
remonte son nom logique dans l’erreur.

## Limites connues

L’audit conserve la provenance de chaque manque. Les paramètres de pièce viennent de
`ability_learning_board_menu_7.00.00.00.lua.bin`, les coordonnées `x/y` de quatre menus de
recherche/summon, et `MENU_LINIT_NONE` de `soccer_top_menu_1.03.98.00.lua.bin`.

La classification runtime confirme que ces 13 résidus sont des **lectures uniquement** :
l’audit global rend `missingHostInvocations={}`. Aucun appel de fonction hôte inconnue ne reste
dans le corpus.

### Douze des treize ne sont PAS du contexte natif — mesuré 2026-09-19

Ce document a longtemps désigné « l’injection documentée du contexte natif des 13 lectures
résiduelles » comme la prochaine étape RE. **C’est faux pour douze d’entre elles**, et le
vérifier coûtait un désassemblage.

`nie lua-audit` rend maintenant `missingHostReadSinks` : pour chaque lecture indéfinie, ce que
devient sa valeur, relevé statiquement par `nie_lua::bytecode::global_reads`. Sur le corpus
complet, **les 13 noms sortent tous en `tableArrayItem`** — la valeur n’alimente que la partie
TABLEAU d’un constructeur de table :

```text
pieceIdx layerIdx pieceType isEffectPiece relativeType effectIdx
isGreenMesh isGrayout rarityGatePieceType isSendInfoOnly   tableArrayItem ×1 chacun
x  y                                                       tableArrayItem ×4 chacun
MENU_LINIT_NONE                                            tableArrayItem ×1
```

C’est l’idiome Lua d’une **liste de noms de champs écrite sans valeur**. Les dix premiers sont
lus en dix `GETTABUP` contigus (pc 79-88 du chunk principal) qui alimentent un `NEWTABLE B=10`
refermé par `SETLIST` :

```lua
LiberationPieceInfo = { pieceIdx, layerIdx, pieceType, isEffectPiece, relativeType,
                        effectIdx, isGreenMesh, isGrayout, rarityGatePieceType, isSendInfoOnly }
```

Cette partie tableau **n’est jamais indexée**. Les seuls autres usages de la table sont
`LiberationPieceInfo.new = <closure>` et deux `:new()`, et `new` repose les dix MÊMES noms en
**champs nommés** avec leurs défauts (`pieceIdx = -1`, `layerIdx = -1`, `pieceType = 0`,
`isEffectPiece = false`, `relativeType = -1`, `effectIdx = -1`, `isGreenMesh = false`,
`isGrayout = false`, `rarityGatePieceType = 0`, `isSendInfoOnly = false`). Les consommateurs ne
touchent ces champs que par `TEST` (véracité) et `EQ` (égalité), jamais par arithmétique : un
`nil` y est sans effet. Injecter un contexte natif pour ces dix noms ne changerait donc **rien
d’observable** — seulement le contenu d’un tableau que rien ne lit.

`x` et `y` suivent le même idiome (`{ x, y }` au niveau supérieur, dans quatre menus). Leurs
vraies valeurs sont posées à l’exécution par un autre prototype, en champs nommés
(`Up2["x"] := param`), puis relues par nom. Là encore la partie tableau n’est pas le chemin
d’accès.

### Le seul résidu réel est `MENU_LINIT_NONE`, et sa portée est bornée

Il est unique dans tout le corpus : **une occurrence sur 1 197 chunks**, jamais assignée nulle
part en Lua. Son tableau, lui, **est indexé** — contrairement aux douze autres, ses six voisins
sont des `0` littéraux :

```lua
local linit = { MENU_LINIT_NONE, 0, 0, 0, 0, 0, 0 }   -- un élément par calque
```

Le seul consommateur (`main:18` de `soccer_top_menu`, la seule closure qui capture ce registre)
lit `linit[idx + 1]` et le compare à **1, 2 et 3** ; le résultat choisit entre un identifiant de
texte fixe et celui du calque. Toute valeur **hors de `{1, 2, 3}`** — dont `nil` — produit donc
exactement le même comportement. Le manque est réel mais borné à cette branche, et la valeur ne
doit pas être devinée : un nom se terminant par `_NONE` vaut conventionnellement `0`, ce qui
serait une supposition, pas une mesure.

### Deux garde-fous que cette session a payés

**L’absence d’un nom dans `nie.exe` ne prouve rien.** `MENU_LINIT_NONE` et les dix noms de
`LiberationPieceInfo` sont absents des chaînes du binaire — mais `SetPartTexture`,
`GetObjectAttr`, `IsExistFocusItem` et `UpdateNamePop` le sont aussi, alors que ce sont de vraies
fonctions. Le jeu clé ses commandes par CRC-32 : seuls les globals posés par `lua_setglobal`
(`INCLUDE`, `funcLuaMenuCommand`) apparaissent en clair. Cette piste a été ouverte puis
abandonnée ; ne pas la rouvrir.

**`missingHostReads` ne voit que les lectures EXÉCUTÉES**, c’est-à-dire le niveau supérieur des
chunks et les callbacks effectivement pilotés. Le corpus porte quatre autres noms `MENU_*`
lus une seule fois chacun — `MENU_TITLE_TEX_RES_NAME`, `MENU_PRIO_OPTION`,
`MENU_PRIO_OPTION_BUTTON`, `MENU_OBJ_NAME_HELP_WINDOW` — que l’audit ne signale jamais parce
qu’ils sont lus dans des closures qu’aucun pilotage n’atteint. « 13 » est donc le compte des
lectures atteintes, pas celui des lectures existantes.

Un build workspace complet n’a pas été lancé, conformément à la règle du dépôt
qui le déconseille lorsque l’espace disque est contraint.

## Clôture de session — 2026-09-06

Le lot de reproduction Lua/Kizuna est versionné et poussé sur `main` jusqu’à
`cbe5fde` (`feat: validate live Lua bytecode before execution`). Il couvre le
décodeur Lua 5.2, l’index VFS à versions numériques, les includes persistants,
le pilotage live du menu, les hôtes Kizuna, les métriques d’audit et leur
provenance.

Les modifications concurrentes de formatage présentes dans l’arbre de travail
ne sont pas incluses dans ce lot et restent à arbitrer par leur auteur. Aucun
chemin machine, secret ou dump hors périmètre n’a été ajouté.

**Cette clôture désignait comme prochaine étape RE « l’injection documentée du contexte natif
des 13 lectures résiduelles ». Elle est close par la négative** (voir « Limites connues ») :
douze de ces lectures n’attendent aucune valeur, et la treizième n’en attend aucune qu’on
puisse mesurer. Ce qui reste ouvert est ailleurs — les lectures que l’audit n’atteint jamais,
faute de piloter les closures qui les portent.

## RE anchors

Knowledge base (`var/nie.sqlite`) tables:
- `hash_name` — CRC32 and string hashes for Lua commands, modules and functions
- `function` — Lua host functions and dispatch loop in `nie.exe`
- `xref` — call-graph topology for Lua host functions
- `rtti_class` — `game::CMapNpcController`, `game::VCraftMapStatus`
- `coverage` — Lua command interpreter coverage

Key binary reference addresses:
- `0x1404aadb8` — Lua host command interpreter
- `0x1406d5840` — Core game state tick loop
