# lua-analysis

Artefacts RE dérivés des scripts Lua décompilés du jeu (`data/lua_scripts/analysis/`) croisés avec le décompilé C de `nie.exe`. La famille couvre le glob `data/lua_scripts/**/*.json` : **13 fichiers JSON**. Ce sont des index/dictionnaires/résumés produits par un pipeline d'analyse, pas des données de gameplay brutes — mais ils contiennent énormément de vraies valeurs du jeu (labels UI, séries, éléments, raretés, builds, stats, IDs de skills/auras, noms de classes RTTI, triggers de scénario).

Tous les comptes et valeurs ci-dessous viennent **uniquement** du contenu des JSON.

| Fichier | Taille | Structure top-level | Contenu |
|---|---|---|---|
| `game-constants.json` | 16.6 KB | objet, 18 clés | Constantes UI/gameplay résolues (séries, éléments, raretés, builds, stats…) |
| `resolved-skills.json` | 23.2 KB | `{resolved, unresolved, summary}` | 138 IDs CRC32 → skill/aura |
| `lua-summary.json` | 141 KB | `{stats, topStrings, topCRC32, topTableFields, gameDataStrings…}` | Statistiques globales du corpus Lua |
| `lua-global-index.json` | 4.1 MB | objet, 13 clés | Index complet des 676 fichiers Lua |
| `nie-c-index.json` | 18.5 MB | objet, 11 clés | Index du décompilé C de `nie.exe` (51 221 fonctions) |
| `nie-c-summary.json` | 157 KB | objet, 6 clés | Résumé du décompilé C (classes RTTI, strings game-data) |
| `crc32-dictionary.json` | 5.0 MB | objet, 160 513 entrées | Dictionnaire de reverse-lookup CRC32 → nom |
| `cross-refs.json` | 224 KB | objet, 5 clés | Croisement CRC32 résolus / Lua↔C |
| `all-strings.json` | 2.9 MB | objet, 944 clés | Strings extraites par fichier Lua |
| `constellation-refs.json` | 13.1 KB | objet, 4 clés | Refs « constellation » (universe search) Lua↔C |
| `filter-menu-match.json` | 18 KB | objet, 5 clés | Résolution des CRC32 du menu de filtre chara |
| `decompile-errors.json` | 34.8 KB | array(278) | Fichiers Lua non décompilés (strings-only) |
| `engine-commands.json` | 2 o | objet vide `{}` | Vide |

---

## game-constants.json

Le fichier le plus dense en vraies valeurs de jeu. 18 clés. Chaque entrée porte typiquement `name`, `crc32`, un `label` (FR), souvent `textJa` (japonais d'origine) et un id interne.

### Séries (`series`, 9) — apparence/origine d'un personnage

| index | name | label | crc32 |
|---|---|---|---|
| 1 | chara_series_ie1 | Inazuma Eleven | 0x62E8448F |
| 2 | chara_series_ie2 | Inazuma Eleven 2 | 0xFBE11535 |
| 3 | chara_series_ie3 | Inazuma Eleven 3 | 0x8CE625A3 |
| 4 | chara_series_go1 | Inazuma Eleven GO | 0x9299810F |
| 5 | chara_series_go2 | Inazuma Eleven GO Chrono Stone | 0x0B90D0B5 |
| 6 | chara_series_go3 | Inazuma Eleven GO Galaxy | 0x7C97E023 |
| 7 | chara_series_ares | Inazuma Eleven Ares | 0x6461BCB4 |
| 8 | chara_series_orion | Inazuma Eleven Orion | 0xE43DAFA3 |
| 9 | chara_series_victory | Inazuma Eleven Victory Road | 0xE177FC30 |

### Éléments (`elements`, 4)

| elementId | internalName | label | textJa | crc32 |
|---|---|---|---|---|
| 1 | Wind | Vent | [風/かぜ] | 0x0EB943B3 |
| 2 | Forest | Forêt | [林/はやし] | 0x6E59C889 |
| 3 | Fire | Feu | [火/ひ] | 0x776C1E82 |
| 4 | Mountain | Montagne | [山/やま] | 0x9097CD4A |

### Positions (`positions`, 4) — format runtime `icon_cmd_position0%1u`

| name | label | crc32 |
|---|---|---|
| icon_cmd_position01 | Avant | 0x8F29B456 |
| icon_cmd_position02 | Milieu de terrain | 0x1620E5EC |
| icon_cmd_position03 | Gardien | 0x6127D57A |
| icon_cmd_position04 | Défenseur | 0xFF4340D9 |

### Raretés (`rarities`, 9) — format runtime `gtxt_rarity01_%02u`

| rarityId | name | label | crc32 |
|---|---|---|---|
| 0 | gtxt_rarity01_01 | Normal | 0xF4E9FBFC |
| 1 | gtxt_rarity01_02 | En Progression | 0x6DE0AA46 |
| 2 | gtxt_rarity01_03 | Expérimenté | 0x1AE79AD0 |
| 3 | gtxt_rarity01_04 | Émérite | 0x84830F73 |
| 4 | gtxt_rarity01_05 | Légendaire | 0xF3843FE5 |
| 5 | gtxt_rarity01_06 | Légendaire+ | 0x6A8D6E5F |
| 6 | gtxt_rarity01_07 | Légendaire++ | 0x1D8A5EC9 |
| 7 | gtxt_rarity01_08 | Légendaire+++ | 0x8D354358 |
| 10 | gtxt_rarity01_10 | Hero | 0x9AF5FA2B |

### Genres (`genders`, 3)

| genderId | label | textJa | crc32 |
|---|---|---|---|
| 1 | Masculin | [男/おとこ] | 0x3EEBF867 |
| 2 | Féminin | [女/おんな] | 0x0C61839C |
| 3 | Inconnu | [不明/ふめい]・その[他/た] | 0x10DD40D2 |

### Morphologies (`bodyTypes`, 6)

| internalName | label | textJa | crc32 |
|---|---|---|---|
| normal | Normal | [普通/ふつう] | 0x38DF4CEA |
| small | Petit gabarit | [小柄/こがら] | 0x43579585 |
| big | Grand gabarit | [大柄/おおがら] | 0xE7901492 |
| tall | Élancé | のっぽ | 0x107520B2 |
| muscle | Musclé | [筋肉/きんにく] | 0xEA4B3DE1 |
| smallfat | Petit et rond | [小太/こぶと]り | 0x8652E263 |

### Types de build d'équipe (`buildTypes`, 6) — stratégie

| buildTypeId | internalName | label | textJa | crc32 |
|---|---|---|---|---|
| 0 | force_win | Force Win (Breach) | [必殺/ひっさつ] | 0x1EA47A48 |
| 1 | counter | Counter | カウンター | 0xBD233DFA |
| 2 | kizuna | Kizuna (Bond) | キズナ | 0x0DE6836C |
| 3 | tension | Tension | テンション | 0xF19211EB |
| 4 | rough_play | Rough Play | ラフプレー | 0xF317B216 |
| 5 | fair_play | Fair Play (Justice) | [正義/せいぎ] | 0xEEC42D61 |

`teamBuildNameTextIds` (7) ré-indexe ces builds + un index 6 = « Total (aucun build spécifique) » (crc32 0x8C735594, non résolu).

### Rôles (`roles`, 3)

| internalName | label | textJa | crc32 |
|---|---|---|---|
| player | Joueur | [選手/せんしゅ] | 0x63074D2E |
| coach | Entraîneur | [監督/かんとく] | 0xF5224393 |
| manager | Manager | マネージャー | 0x1BD1A396 |

### Stats joueur (`stats`, 7)

| name | label | crc32 |
|---|---|---|
| kick | Tir | 0x1ED5DF05 |
| control | Contrôle | 0xEDDB2C4B |
| technique | Technique | 0xD73B9841 |
| pressure | Pression | 0x5FAFA067 |
| physical | Physique | 0xD7293008 |
| agility | Vitesse | 0x65027F8F |
| intelligence | Intelligence | 0xD7D8E6C3 |

### Catégories de skill (`skillCategories`, 4)

| categoryId | name | label | crc32 |
|---|---|---|---|
| 1 | shoot | Tir | 0x7044FCBE |
| 2 | dribble | Dribble | 0x1EB19FC4 |
| 3 | block | Blocage | 0x831B9722 |
| 4 | catch | Arrêt | 0xC56B7B64 |

### Onglets de filtre (`filterTabs`, 7) + icônes

7 onglets du menu de filtre personnage : `belong_team` (チーム), `position` (ポジション), `element` (属性), `rarity` (レアリティ), `appearance` (見た目), `build` (ビルド), `role` (役割). Chacun mappé à un `tabIconType` (0,1,2,4,6 dans `filterTabsUniverse`) et un couple d'icônes on/off (`icon_list_tab_filter0N` / `…_off`).

### Mapping `listItemType` (11) — sémantique des catégories de liste de filtre

`1`=série/apparence · `2`=équipe d'appartenance (spécial) · `3`=poste · `4`=élément · `5`=rareté (interne offset +1) · `6`=genre · `7`=morphologie · `8`=slot réservé jamais peuplé (favoris/DLC futur) · `9`=« tout sélectionner » · `10`=type de build (interne offset +1) · `11`=rôle.

### Pistes (`engineClasses`, `engineCallbacks`)

- `engineClasses` (3) : `CMenuListViewCharaFilter`, `CMenuListViewCharaBankFilter`, `CMenuListViewSoccerSpiritFilter` (avec leurs `FUN_…`).
- `engineCallbacks` (3) : `OnBeforeReceiveFilterParam`, `OnReceiveFilterParam`, `OnAfterReceiveFilterParam`.
- `playstyles` (3) : `play_style_offensive`/`defensive`/`balanced` — **marqués « non confirmé dans les Lua, extrapolé des configs binaires »** dans le JSON.

---

## resolved-skills.json

138 IDs CRC32 résolus depuis les configs de skills/auras. `summary` : `total=138`, `resolvedAsSkill=21`, `resolvedAsAura=117`, `stillUnresolved=0`. Note du fichier : bug initial de comparaison décimal-signé (aura v1) vs hex-string (skill v5) maintenant corrigé.

Forme d'une entrée (clé = CRC32) :

- **type `aura`** : `{stringId, childName, source}` — ex. `0xBFB0BB04 → {wsd000110, AURA_CMD_INFO_341, aura_skill_config_1.04.09.00}`. Les `stringId` suivent un schéma `w<XX>NNNNN` (`wsd…`, `wsk…`, `wks…`, `wko…`, `wkd…`, `wmm…`, `wso…`, `wss…`, `wkk…`). `childName` = `AURA_CMD_INFO_<n>`. Toutes sources = `aura_skill_config_1.04.09.00`.
- **type `skill`** : `{stringId, nameHash, descHash, source}` — ex. `0x0FFB2761 → {whs03240, nameHash 0x6BEB7B74, descHash 0xEBED107C, skill_config_5.00.07.00}`. `stringId` en `whs03NNN`, source = `skill_config_5.00.07.00`.

Une entrée de test présente : `0x52B2CACA → stringId test_awakening_power` (aura).

---

## lua-summary.json

`stats` du corpus Lua : **676 fichiers · 557 647 lignes · 9 995 fonctions · 4 610 strings uniques · 13 632 candidats CRC32 · engineCalls=0**. `bridgeSummary` est vide (`{}`).

### topStrings (les includes/macros les plus partagés)

| string | nb fichiers |
|---|---|
| LUA_MENU_DEF | 118 |
| LUA_SOCCER_COMMON | 95 |
| npc_talk_with_only_event_text | 43 |
| sy0101 | 43 |
| LUA_PROG_BASE | 40 |
| LUA_LISTVIEW_INC | 38 |
| LUA_GENERAL_WINDOW_INC | 38 |
| LUA_SOCCER_FORMATION_MENU_INC | 33 |
| LUA_CHARA_EDIT_MENU_INC | 32 |
| LUA_CHARA_EDIT_PARTS_MENU_INC | 30 |
| LUA_MAIN_MENU_INC | 27 |
| text_charaname | 23 |
| locator_base_pos_L | 23 |

### topTableFields (champs de table Lua les plus utilisés)

| champ | count |
|---|---|
| funcLuaMenuCommand | 18 362 |
| funcLuaCommand | 8 939 |
| coroutine | 1 355 |
| AddName | 1 331 |
| yield | 958 |
| resume | 339 |
| waitTrue | 238 |
| g_obj_hdl | 237 |
| create | 208 |
| funcLuaEffectCommand | 199 |
| waitFalse | 176 |
| CRC32 | 161 |
| g_teamNo | 159 |
| funcLuaActionCommand | 148 |
| UpdateButtonGuide | 130 |

(Les pseudo-champs `java`, `decompile`, `NullPointerException` sont du bruit du décompileur Lua en échec.)

`topCRC32` liste les valeurs CRC32 les plus fréquentes (ex. `0xA93816BC` dans 192 fichiers, `0xE15FD945` dans 182). `gameDataStrings` (401) cartographie chaque include/symbole game-data → liste exhaustive des fichiers qui le référencent (ex. `LUA_MENU_DEF` apparaît dans 118 fichiers menu : `chara_bank_menu`, `shop_menu_buy`, `rpg_battle_menu_*`, `soccer_*`, `team_dock_*`, `vs_route_town_*`, `kizuna_town_*`…).

---

## lua-global-index.json

Index complet des fichiers Lua. Totaux : `totalFiles=676`, `totalLines=557647`, `totalFunctions=9995`, `totalUniqueStrings=4610`, `totalCRC32Numbers=13632`, `totalEngineCalls=0`.

`files` = array(676), chaque entrée `{file, tier, lines, functions, calls, strings, …}`. Exemple `chara_bank_menu_5.00.27.00.lua` : `tier="root"`, 256 lignes. Les `functions`/`allFunctions` sont essentiellement des locales du décompileur (`L21_1`, `L18_1`…). `allTableFields` contient les vrais champs métier (`tabType`, `seriesId`, `seriesType`, `tabIconType`, `lang`…). `allCRC32` / `bridgeCalls` complètent.

---

## nie-c-index.json & nie-c-summary.json

Index du **décompilé C de `nie.exe`** (pas du Lua). Totaux identiques dans les deux : `totalLines=4 155 104`, `totalFunctions=51 221`, `totalGlobals=11 119`, `totalStrings=6 573`.

- `nie-c-index.json` : `functions` = objet de 51 221 entrées `FUN_<vaddr> → {name, returnType, params, startLine, endLine, callees, strings, hexConstants, datRefs}` ; `hexConstants` = 20 858 entrées ; `rttClasses` = 369.
- `nie-c-summary.json` : `rttClasses` (369) mélange vrais noms de classes/méthodes moteur et messages d'erreur (`CMainComponent::CpuOcclusionDraw`, `CSceneRpg010::Door`, `CSceneRpg020::MapGimic`, `CSceneRpg025::FadeMapPl`, `Adjacencies::CreateDatabase…`, `CMemoryPool<CObject>::Initialize`…). `gameDataStrings` (999) = symbole → fonctions qui l'utilisent.

Échantillon `gameDataStrings` (noms de classes moteur réels et leurs `FUN_`) : `SoccerActionCtrl` (FUN_140026b10), `CCameraCtrlMenu`, `CCameraCtrlChaseSoccer`, `CCameraCtrlSoccerMenu`, `CCharaFacial`, `CCharaAlphaState`, `CMenuRender`, `CharaAction`, `CCharaActParam`, `CCharaMotEvent`, `CCharaParam`. Codes d'erreur de démarrage : `ErrorCode_PreInit_AppConfig`, `ErrorCode_PreInit_Steam_NotLaunchClient`, `ErrorCode_PreInit_Steam_NotLogin`, `ErrorCode_PreInit_Steam_TicketError`, `ErrorCode_Env_KillSteamClient`, + messages utilisateur (« Failed to load game files… VERIFY INTEGRITY OF GAME FILES », « INAZUMA ELEVEN: Victory Road wurde bereits gestartet. », erreurs Steam/sauvegarde).

---

## crc32-dictionary.json

Dictionnaire de **reverse-lookup CRC32 → nom** : 160 513 entrées (clé hex `0x........`, valeur = chaîne). Mélange de deux natures :

1. **Candidats d'ID énumérés** (espace de noms brute-forcé, ~10 000 chacun, `0000`→`9999`) : `chr_` (personnages), `itm_` (items), `skl_` (skills), `aur_` (auras), `psk_` (passifs), `shp_` (shoots), `stg_` (stages), `fm_` (formations), `bsr_`, `npc_`, `team_`.
2. **Vrais mots/symboles extraits** (~43 202 « mots » sans underscore + préfixes métier) : noms de fonctions moteur (`UpdateCharaPos`, `MoveJump`, `GetSelectStarKeyPos`), paramètres de config (`goalnetSimBoundDeclRateHori`, `soccerBattleVsSelfChara2ScaleY`, `MotionConstraintBias`), flags (`ChrSpiritLegendaryNewFlag`).

Distribution des préfixes (top) :

| préfixe | count |
|---|---|
| (mot simple) | 43 202 |
| team_ | 10 025 |
| npc_ | 10 019 |
| shp_ | 10 000 |
| fm_ | 10 000 |
| itm_ | 10 000 |
| stg_ | 10 000 |
| psk_ | 10 000 |
| aur_ | 10 000 |
| chr_ | 10 000 |
| skl_ | 10 000 |
| bsr_ | 9 999 |
| m_ | 1 688 |
| dev_ | 1 068 |
| fbtl_ | 710 |

---

## cross-refs.json

Croisement des CRC32. `resolvedCRC32` = 719 entrées `{decimal, hex, name, files}` ; `unresolvedCRC32 = 12 913` ; `engineCommandCount = 0`. Les noms résolus révèlent des **triggers de scénario / events** : `ev01_02500`, `ev04_02160`, `ev50_00025`, `cro05_01_para_c05020500` (référencé dans `fbtl_cro05_170_*_trigger`), positions (`_pos_lv01`), widgets UI (`win07_11_button_default_setting`).

`luaNieCOverlap` (8) = symboles partagés Lua↔C : `#/menu/200_icon/15_icon_common/<LG>/icon_common.g4tx`, `PlayOffsetAnimCharaBankPersonalPlate`, `win07_04_chara_filter_list_item_text`, `SwapSoccerTopCommonHeaderByHeaderType`, `UpdateSoccerTopCommonHeaderTeamDocLayerInfo`, `SetSoccerTopCommonHeaderTeamDocLayerVisible`, `UpdateItem`, `SetVisibleStampInputMenu`.

`constellationRefs` reprend le contenu de `constellation-refs.json`.

---

## filter-menu-match.json

Résolution ciblée des CRC32 du **menu de filtre personnage**. `stats` : `totalConstants=65`, `resolvedViaMenuText=29`, `unresolvedViaMenuText=36`, `foundInNieC=24`, `nieCFilterWidgets=24`, `menuTextDictSize=2482`. Note du fichier : les CRC32 non résolus via `menu_text` sont des IDs de ressources textures/icônes (séries, positions, raretés, tabIcons), absents de `menu_text` qui ne contient que des labels.

- `menuTextMatches` : les 7 `filterTabs` + leurs textes JA (チーム, ポジション, [属性/ぞくせい]…).
- `nieCMatches` (24) : widgets du décompilé C, ex. `win07_04_chara_filter_list_item_text` (« item texte générique du filtre chara », référencé par 18 `FUN_`), `win07_03_chara_filter_list_item_title`, `win07_05_chara_filter_list_item_position`.
- `unresolvedCrc32` (36) = les CRC32 de ressources (ex. `0x62e8448f` = `chara_series_ie1`, etc.).

---

## constellation-refs.json

Refs liées à l'« universe search » (recherche de joueurs en ligne). `luaStrings` (6) : `UNIVERSE_SEARCH_HISTORY`, `players_universe_search_menu`, `[CUNIVERSE01]`… `nieCStrings` (93) inclut `CMenuListViewUniverseSearchChara` (FUN_14002c000, FUN_1400abe30) et des messages de démarrage Steam. `luaFunctions` et `nieCFunctions` sont vides.

---

## all-strings.json

Strings extraites **par fichier Lua** : 944 clés (nom de fichier sans extension) → array de strings. Exemples :

- `chara_filter_menu_4.00.01.00` (26 strings) : `INCLUDE`, `LUA_PROG_BASE`, `LUA_LISTVIEW_INC`, `LUA_CHARA_FILTER_MENU_INC`, `tabIconType`, `tabTextName`, `CRC32`, `chara_filter_menu_tab_text_belong_team`, `bgIconTextureName`, `filter_symbol01`…
- `soccer_common_5.00.32.00` : API soccer — `IsInvalidSoccerCharaHdl`, `IsBallOwnerChara`, `GetSoccerTeamInfo`, `GetSoccerBtlParam`, `GetSoccerCharaInfo`, `GetSoccerCharaParam`, `GetSoccerCharaNickName`, `GetAnalogInputVal`, `GetCharaPos`, `CharaPosDist2`, `WaitLoadResTexture`, `LoadSoccerCharaIconTex`, `SwapLayerFaceIconTexBySoccerCharaHdl`…

---

## decompile-errors.json

Array de 278 entrées `{file, priority, status, lines}`. **Tous** ont `status="strings-only"`, `priority="p2"`, `lines=0` : ce sont les `.lua.bin` que le décompileur n'a pas pu reconstruire en code (seules les strings ont été extraites), ex. `ability_learning_beans_lump_use_window.lua.bin`, `ability_learning_report_menu_1.02.40.00.lua.bin`.

---

## engine-commands.json

Objet **vide** (`{}`, 2 octets). Cohérent avec `engineCalls=0`/`engineCommandCount=0` ailleurs : aucun appel de commande moteur n'a été extrait.
