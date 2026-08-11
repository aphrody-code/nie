# Données de jeu IEVR — index maître

> Référence des **vraies données** d'*Inazuma Eleven: Victory Road* (IEVR, moteur Level-5 « Lives »)
> et de ses sources satellites. Chaque fiche de ce dossier est **factuelle** : tous les comptes, schémas,
> identifiants et libellés y sont extraits directement des fichiers (dumps `cfg.bin` RDBN, JSON, scrapes,
> artefacts RE), jamais supposés.

**But anti-hallucination.** Avant d'affirmer qu'un mode, un menu, une table, un champ ou un libellé existe
dans le jeu, vérifier ici. Les fiches notent explicitement les pièges constatés (ex. *les libellés de
dialogue ne sont PAS dans `event/subtitle` — ce sont des hash CRC32 + timing* ; *`chara_text`/`shop_text`
ont leurs String VIDES dans ce build* ; *les écrans de menu référencent l'UI par hash CRC, pas par texte*).

Conventions transverses récurrentes :
- **Identifiants = CRC32** (`0x........` en typé, Int signé en `entries`) ; reverse-lookup via
  `re-derived` / `lua-analysis` (dictionnaire de 160 513 noms).
- **`textId` / `*NameId`** = clé de texte localisé (résolue dans `text-labels`).
- **`cond` / `openCond`** = bytecode moteur en **base64** ; paires `[offset, nombre]` = réfs intra-fichier.
- Deux schémas de dump `cfg.bin.json` : `version/lists` (RDBN typé) et `entries/children` (arbre RDB brut) ;
  les blocs `TEXT_INFO` plats vivent uniquement dans la famille `text-labels`.

## Familles

### Données de jeu réelles (dumps `cfg.bin` RDBN d'IEVR)

| Famille | Fiche | Résumé factuel |
|---|---|---|
| **text-labels** | [text-labels.md](./text-labels.md) | 16 713 fichiers, 324 128 entrées, langues ja/en/fr. 4 blocs : `TEXT_INFO_BEGIN` (texte localisé), `TEXT_WASHA_MAP_BEGIN` (maps script/voix), `NOUN_INFO_BEGIN`, `TEXT_MOTION_MAP_BEGIN`. Seule famille avec le **texte en clair**. Macros cataloguées (`<FLC:>`, `<CHARA_NAME>`, `<VALUE>`, couleurs `[C]`, furigana). Constat : `chara_text`, `shop_text`, `medal`, `quest_title` ont leurs String VIDES dans ce build. |
| **event-scripts** | [event-scripts.md](./event-scripts.md) | 1375 JSON — cœur du **mode histoire** : 1321 `subtitle` (9 langues, 15 scènes ev01..ev90), 34 `bustup_talk_data` (portraits parlants, chemins `.g4pk`), + configs (movie `.usm`, env de scène, caméras, timezone). Constat clé : le subtitle ne porte **que** hash CRC32 + 4 marqueurs de timing, **aucun texte**. |
| **menus** | [menus.md](./menus.md) | 456 fichiers ; 440 écrans `cfg/*_setting` (atlas `MENU_RES`, 4367 calques → 2071 `.objbin`, 4280 commandes, navigation pad). 14 noms de commandes réels (`CMD_FUNCTION`, `CMD_BACK`, `CMD_ENTER`, `CMD_FCS_*`). Listes typées : poses chara, `CHARA_UNIFORM` (506), pad virtuel tactile, transitions de scène. UI référencée par hash CRC, pas par texte. |
| **soccer-match** | [soccer-match.md](./soccer-match.md) | 441 fichiers = FSM de **match de foot** (nie-core). `game/` = scénarios appariés (`*_trigger_*` 5398 items, `*_phase_set_*`). Configs racine : `soccer_command_effect` (142), `passive_skill_effect` (87), `special_tactics` (120), caméras (138), drop. Seuls noms en clair (JP) : `trick_config` (9 hissatsu : ファイアトルネード…) et casters sc0001-0010. |
| **gamedata-rest** | [gamedata-rest.md](./gamedata-rest.md) | 386 fichiers (le reste de `common/gamedata/`). skill (2627 SKILL_INFO + 23 790 effets de board), character (chara_model 7668, chara_param 6151, chara_base 14 420, chara_edit avatar), players_universe (gacha), item/spirit/capsule/shop, formation (115), quest, staffroll 9 langues. Libellés JP réels conservés (trophées, motions). |

### Artefacts dérivés du reverse-engineering de `nie.exe`

| Famille | Fiche | Résumé factuel |
|---|---|---|
| **re-derived** | [re-derived.md](./re-derived.md) | `funclua-cmdids.json` (15 dispatchers Lua natifs : funcLuaMenuCommand 1026 cmds, funcLuaCommand 2389…) ; `funclua-cmdid-handlers.json` (3471 paires hash32→handler_va) ; `menu-crc32-dictionary.json` (160 513 reverse-lookups CRC32, 11 familles `prefix_NNNN`) ; `menu-region-index.json` (694 symboles UI → 11 atlas). |
| **lua-analysis** | [lua-analysis.md](./lua-analysis.md) | 13 JSON d'analyse Lua décompilé × C de `nie.exe`. `game-constants.json` (séries IE1..Victory Road, éléments, raretés, builds, stats), `resolved-skills.json`, `nie-c-index.json` (51 221 fonctions), `crc32-dictionary.json` (160 513). Classes moteur réelles (`SoccerActionCtrl`, `CCameraCtrl*`, `CMenuRender`), codes d'erreur de démarrage Steam. |
| **camera** | [camera.md](./camera.md) | Modèle **caméra** complet reversé sur le `nie.exe` local : hiérarchie RTTI prouvée (`CCameraCtrl` → `CGameCameraCtrl` → 17 contrôleurs : ChaseSoccer, Shake, Shooting, Rail, Selfie, Event, FixPos…), 12 structs de données (`SOCCER_CAMERA_INFO_DATA` 138, `ScAerialCameraMapInfo` 108, `CINEMATIC_CAMERA_INFO` 15…), 21 chemins de configs (`common/property/camera/*` par contexte), ~250 paramètres typés par domaine (poursuite, shake de tir, fade/clipping, post-effects, input, mode photo), commandes `CMD_CAMERA_*`, dispatch `funcLuaCameraCommand` (46 cmds, table `0x1422B3380`). **Codec G4CM** : les 1 215 animations de cutscene décodées et ré-encodées byte-exact (`nie-camera`). **Indexé en SQL** : 22 tables `cam_*` + 5 vues dans `var/niers.sqlite` (2,6 M échantillons de keyframes) via `nie-cam index`. **Corrige `re-derived`** : sur ce build les tables de dispatch sont en BSS (runtime), le bloc `.data` `0x141CB5500` est un réservoir global non segmenté. |
| **misc-derived** | [misc-derived.md](./misc-derived.md) | Dumps de schéma SQL miroir (118 tables, 1010 colonnes, RLS), scrapes Twitter Azalee, glossaire inagle (10 626), patch-notes FR (43, modes confirmés : menu Esprits, mode Histoire, menu adversaire), `story_text_database.json` (25 261 dialogues du mode Histoire). |
| **dump-exploitation** | [dump-exploitation.md](./dump-exploitation.md) | RE dérivé d'un **dump mémoire live de `nie.exe`** (2.97 Go, full memory, hors match). Census RTTI de **1592 vtables** (60 classes nommées : rendu `lives::*`, DB `game::CGDD{NormalSpirit,HumanChara,InventorySkill}`, système de commandes `CCallback{Play,Judge}Command`/`ExecPassiveSkillEffectInfo` = frontière C3 `FUN_1412C0970`), avec statut **NOUVEAU vs ancré** (`anchors.rs`) et **dérive binaire** confirmée (vtable live ≠ `var/niers.sqlite`). Singletons globaux typés, **22 hooks AOB→RVA** validés, table movesets (record 0x34, sentinelle `0xFB997A80`), ~192k chemins d'assets chargés. Outil : `nie-re::dump` (+ exemples `dump_scan`/`dump_census`). |
| **live-memory-editor** | [live-memory-editor.md](./live-memory-editor.md) | **Éditeur mémoire live** `nie-edit` (crate `nie-trace`) : lit **et écrit** le vrai `nie.exe` pour valider les structures reversées (poser une valeur → observer l'effet). **Catalogue de 25 localisateurs** dérivés du dump (`catalog.rs`) : AOB à masque + RVA validée + offset décodé/chaîne de pointeurs, par concept (tension `entity+0x1058`, rang `[singleton+0x69A0]+0x5C`, cooldowns, gels, esprits…). Natures `Toggle`/`StructField`/`Value` ; écritures gardées `--force` ; `VirtualProtectEx`+`WriteProcessMemory`+restauration ; auto-check des RVAs live vs dump (mesure la dérive de build). |

### Manifestes d'assets et exports consolidés

| Famille | Fiche | Résumé factuel |
|---|---|---|
| **root-manifests** | [root-manifests.md](./root-manifests.md) | Index/manifestes racine de `data/` : asset-cross-reference (17 353 assets), face-manifest (5 677), model-manifest (6 028), item-image-manifest (1 459), miximax-icon (36), glossary trilingue (24 001), zukan-audit. |
| **exports-inagle** | [exports-inagle.md](./exports-inagle.md) | 7 JSON consolidés inagle/azalee. character_fr (14 389), inagle_enriched (5132 persos enrichis stats+movesets+passifs), noun_fr (20 908 crc32→libellé), orion-report (DLC Orion), sheet_data (14 tables : hissatsu/auras/tactics/items/kizuna), sheet_export (25 feuilles brutes). Énumérations : 5 éléments, 4 positions, 6 playstyles. |
| **zukan** | [zukan.md](./zukan.md) | Caches de l'ingesteur zukan.inazuma.jp (8 JSON). db_consolidated (5137 persos JA), param_en/ja (5407), mapping CRC32→zukanHash (5948), skill-videos (883). Médias sur CDN `dxi4wb638ujep.cloudfront.net`, pivot `zukanHash` `k/<a>/<b>/<slug>`. |

### Veille / archives web (non consommées par les crates)

| Famille | Fiche | Résumé factuel |
|---|---|---|
| **official-jp-scrape** | [official-jp-scrape.md](./official-jp-scrape.md) | 1067 JSON de scrapes officiels Level-5. inazuma.jp (1048 : news/topics 9 langues, patchnotes), inazuma-cross.jp, blog level5.co.jp. Métadonnée éditoriale (titres/dates/URLs) — pas de tables de jeu. Source des **noms de modes** officiels. |
| **cross-apk** | [cross-apk.md](./cross-apk.md) | 356 JSON de RE de *Inazuma Eleven Cross* (mobile Unity IL2CPP, `jp.co.level5.inazumacross`) — moteur **distinct** d'IEVR (pas de CPK/g4tx/cfg.bin). Master data en `*Master` (CharacterMaster, GachaMachineMaster…), enums Soccer. Stock d'archive. |
| **discord** | [discord.md](./discord.md) | Scrape du serveur Discord FR « Rose Griffon » (198 segments, 38 salons, 2618 messages, 244 auteurs, 2023→2026). Conversation communautaire, **pas** de données de jeu. |

## Modes & menus du jeu

Modes et écrans **réellement attestés** dans les sources ci-dessus (avec leur fiche d'origine).

### Modes principaux

Confirmés par la page `story` du site officiel (`official-jp-scrape`) — `「ストーリーモード」「クロニクルモード」「対戦」「キズナステーション」「キャラクター」` — et par les libellés en clair de `text-labels` :

| Mode | Libellé réel (source) | Fiche |
|---|---|---|
| **Story Mode** (ストーリーモード) | `text-labels` system_text hash `-1456863546` = « Story Mode » | text-labels, event-scripts, misc-derived |
| **Chronicle Mode** (クロニクルモード) | hash `1078567923` = « Chronicle Mode » ; matchs `fbtl_cro01..08`, `cro12` | text-labels, soccer-match |
| **Competition Mode** (対戦) | hash `807622524` = « Competition Mode » ; page `competition` officielle | text-labels, official-jp-scrape |
| **Kizuna Station** (キズナステーション) | hash `-650055095` = « Kizuna Station » (help_list) ; ville Kizuna/Bond Town | text-labels, exports-inagle, menus |
| **Victory Road** | série `chara_series_victory` 0xE177FC30 (titre du jeu) | lua-analysis |

Sous-tâches du mode histoire : `StoryMode_SubTask_01..09` (`gamedata-rest`). Trame : l'équipe Inazuma Japan
embarque sur l'*Inazuma Big Ferry* (`official-jp-scrape`).

### Écrans de menu (440 `cfg/*_setting`, fiche `menus`)

Les plus riches (calques / commandes) :

| Écran | Rôle | Calques | Cmds |
|---|---|---:|---:|
| `rpg_battle_menu_setting` | menu de combat RPG | 130 | 3 |
| `soccer_formation_menu_setting` | formation de l'équipe en match | 75 | 73 |
| `shop_menu_setting` | **boutique** | 70 | 36 |
| `network_menu_setting` | en ligne / lobby réseau | 67 | 146 |
| `ability_learning_board_menu_setting` | board d'apprentissage (talents) | 63 | 49 |
| `team_dock_menu_setting` | **gestion d'équipe (dock)** | 58 | 163 |
| `players_universe_menu_setting` | recherche de joueurs (univers) | 54 | 24 |
| `special_training_menu_setting` | entraînement spécial | 44 | 40 |
| `soccer_summon_menu_setting` | invocation en match (keshin/armes) | 43 | 56 |
| `equip_medalset_menu_setting` | **équipement / set de médailles** | 39 | 30 |
| `kizuna_menu_setting` | menu Kizuna Station | 36 | 70 |
| `soccer_team_dock_menu_setting` | dock d'équipe en contexte match | 36 | 112 |
| `kizuna_town_avatar_menu_setting` | éditeur d'avatar (ville Kizuna) | 33 | 59 |
| `map_menu_setting` / `map_menu_raimon_setting` | carte | 33 / 32 | 24 |
| `players_universe_search_menu_setting` | recherche en ligne de persos | 33 | 60 |
| `soccer_result_menu_setting` | écran de résultat de match | 39 | 17 |
| `personal_plate_menu_*` | plaque/profil (mode change, datafile) | 32-35 | 9-20 |
| `information_top_menu_setting` | informations | 39 | 32 |

Familles d'écrans transverses : `general_window_setting`, `popup_menu_setting`, `sub_window_setting`
(fenêtres génériques). Atlas/objets UI clés : `cmn05_01_cursor.objbin` (182 réfs),
`mainmenu01_07_button_guide`, `mainmenu90_00_background`. Le menu principal porte le préfixe `mainmenu*`.

Flux Lua attesté (`lua-analysis`) : `mainmenu → dock_select → play/avatar/chat/edit` ; includes UI réels
`chara_bank_menu`, `shop_menu_buy`, `rpg_battle_menu_*`, `soccer_*`, `team_dock_*`, `vs_route_town_*`,
`kizuna_town_*`. Dispatcher réseau dédié `funcLuaMenuNetworkCommand` (`re-derived`).

### Boutiques (shops)

Noms en clair des magasins (`exports-inagle`, recoupé `misc-derived`) :

- **Spirit Market** (esprits) — **Chronicle Department Store** — **Vs Store** — **BB Mart** —
  **Bond Shop** — **Magic Moves (Odaiba Branch)** — **Special Training Booth** — **Legendary Chest** —
  **Extended Story Zeus** — **Ranked Reward**.

Tables liées : `inagle_items`/`shop` (15 SHOP_INFO, `gamedata-rest`), `kizuna_items` (125 objets de ville,
9 shops, `exports-inagle`), capsule/gacha 740 lots. Le menu Esprits et le « menu de l'adversaire » sont
confirmés par les patch-notes FR (`misc-derived`).

### Onglets / sous-systèmes d'équipe et de personnage

- **Team dock** (`team_dock_menu`, `soccer_team_dock_menu`) : composition, cartes perso
  (`team00_01_chara_card_for_soccer.objbin`).
- **Formation** : `soccer_formation_menu` ; 115 formations / 1073 placements (`gamedata-rest`).
- **Équipement** : `equip_medalset_menu`, médailles ; `CHARA_UNIFORM` (506 uniform_id, `menus`).
- **Board de talents** : `ability_learning_board_menu` (1757 boards, 23 790 effets, `gamedata-rest`).
- **Avatar / édition perso** : `kizuna_town_avatar_menu`, `chara_edit` (parts `hairB001`, `face51_nose01`,
  voix `scoutMAA01`, `gamedata-rest`).
- **En ligne / univers** : `network_menu`, `players_universe_(search_)menu`, `UNIVERSE_SEARCH_HISTORY`.

### Paramètres & UI tactile

- Pad virtuel tactile (mobile/Switch) : `VIRTUAL_PAD_BUTTON` (54), `VIRTUAL_PAD_DRAW` (54),
  `VIRTUAL_PAD_LAYOUT` (37) — fiche `menus`.
- Transitions d'écran : `SCENE_MENU_PRESET` (16 presets enter/leave/capture).
- Plateformes attestées (`official-jp-scrape`, `misc-derived`) : Steam, PlayStation 5/4, Xbox Series X|S,
  Switch / Switch 2. DLC attestés : **Orion** (`exports-inagle`), **Rising Bond** (v5.0.0, `misc-derived`).
