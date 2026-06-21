# Famille de données : soccer-match

Glob : `data/common/gamedata/soccer/**/*.json` — **441 fichiers** JSON (tous des `*.cfg.bin.json`, dump RDBN décodé du jeu *Inazuma Eleven: Victory Road*). Ce sont les configs de la **FSM de match de foot** (nie-core) : commandes/effets, suggestions, passifs d'équipe, focus-battle, caméras, drops, et les scénarios de match individuels.

Répartition :

| Emplacement | Fichiers | Contenu |
|---|---|---|
| `soccer/*.cfg.bin.json` (racine) | 49 | Configs globales (effets, suggest, drop, caméra, rank…) |
| `soccer/game/*.cfg.bin.json` | 392 | Scénarios de match : `*_trigger_*` (210) + `*_phase_set_*` (182) |

## Deux schémas JSON

Tous les fichiers décodent vers l'un de deux schémas (aucun « autre ») :

1. **`version/lists` — RDBN typé** (34 fichiers racine). Structure :
   `{ "version": 100, "lists": [ { "name": "m_…List", "typeName": "…", "values": [ {champs nommés} ] } ] }`.
   Les valeurs ont des **champs nommés**, les IDs/hashes sont des strings hex `"0x….."`, les nombres sont de vrais nombres JSON (`2.5`, `0.6`), les références inter-listes sont des paires d'index `[début, nombre]`.
2. **`entries` — RDBN brut clé/var** (15 fichiers racine + les 392 de `game/`). Structure :
   `{ "entries": [ { "name": "NOM_N", "variables": [ {"type":"Int|Float|String","value":"…"} ], "children": [ …même forme… ] } ] }`.
   Les `variables` sont **typées et stringifiées** ; les `Float` utilisent la **virgule décimale** (locale FR du dumper, ex. `"0,5"`). Les `Int` à grande valeur signée sont en réalité des **hashes CRC32** (ex. `"-778368270"`). Les blocs `*_LIST_BEG_N` portent les vraies données dans `children`.

Aucun fichier n'utilise le format `TEXT_INFO [Int hash, Int, String]` : `soccer_common_text.cfg.bin.json` a `version:100, lists:[]` (vide) ; les libellés in-game sont référencés par `textId` hashés (`0x…`) pointant vers une autre table de texte hors de cette famille.

---

## 1. Effets de commande & FSM (schéma `entries`, racine)

Famille de fichiers « `*_effect_config` » partageant le même gabarit : un bloc `…_INFO_LIST_BEG` dont chaque entrée logique est éclatée en 4 enregistrements parallèles `…_INFO` (déclaration), `…_EXEC_TIMING_DATA` (quand), `…_TARGET_DATA` (cible), `…_EXEC_DATA` (quoi/params).

| Fichier | Bloc racine | Nb effets | Enregistrements/effet |
|---|---|---|---|
| `soccer_command_effect_config_1.01.79.00` | `SC_COMMAND_EFFECT_INFO_LIST_BEG` | **142** | INFO + EXEC_TIMING + TARGET + EXEC |
| `passive_skill_effect_config_1.01.48.00` | `PASSIVE_SKILL_EFFECT_INFO_LIST_BEG` | **87** | + GRAND_TOTAL_INFO (x80) |
| `special_tactics_effect_config_1.01.29.00` | `SPECIAL_TACTICS_EFFECT_INFO_LIST_BEG` | **120** | (116 timing/target/exec) |
| `super_tactics_effect_config_0.07.00` | `SUPER_TACTICS_EFFECT_INFO_LIST_BEG` | **3** | + END_TIMING_DATA (x1) |
| `team_build_effect_config_0.00.00` | `TEAM_BUILD_EFFECT_INFO_LIST_BEG` | **12** | |
| `studium_gimmick_effect_config_0.00.00` | `STUDIUM_GIMMICK_EFFECT_INFO_LIST_BEG` | **17** | |
| `soccer_add_status_1.01.30.00` | `ADD_STATUS_TYPE_INFO_LIST_BEG` (65) + `ADD_STATUS_INFO_LIST_BEG` (135) | — | + INFO_ATTR (111), INFO_FUNC (20) |

Forme réelle (extrait de `soccer_command_effect_config`) :

```
SC_COMMAND_EFFECT_INFO_0              -> I:1570573587  I:0  I:0        (cmdId hashé, flags)
SC_COMMAND_EFFECT_INFO_EXEC_TIMING_DATA_0 -> I:1                       (timing)
SC_COMMAND_EFFECT_INFO_TARGET_DATA_0      -> I:2                       (cible)
SC_COMMAND_EFFECT_INFO_EXEC_DATA_0   -> I:2  I:-992181094 ×4          (op + 4 paramètres hashés)
```

Autres configs `entries` racine :

| Fichier | Données réelles (children) |
|---|---|
| `soccer_game_config_1.04.08.00` | `CPU_BEANS_RATE_INFO` ×7, `SOCCER_GAME_DIFFICULTY` ×**1772**, `SOCCER_GAME_INFO` ×**325** (+REF_DIFFICULTY ×325) |
| `soccer_game_config_plus_1.04.08.00` | mêmes blocs, 1 entrée chacun (override) |
| `soccer_game_option` | `SOCCER_OPTION_BGM_INFO` ×**59**, `SOCCER_OPTION_FIELD_INFO` ×**81**, `SOCCER_OPTION_COMMENTATOR_INFO` ×8 |
| `soccer_prize_config_0.04.68` | `ITBL_ITEMS` ×**1288**, `ITBL_BASE` ×529 (tables de récompenses) |
| `soccer_rankmatch_prize_config_0.04.68` | `ITBL_ITEMS` ×2, `ITBL_BASE` ×2 |
| `soccer_quick_action_config_0.04.04` | `SC_QA_ICON_INFO` ×4 + `SC_QA_CMD_BEHAVIOR_SEQ_INFO` |
| `soccer_studium_gimmick_config_1.03.19` | 10 sous-tables (menu/limit/gimmick/place/timing/effect), ex. `STUDIUM_GIMMICK_EFFECT_EFFECT` ×45 |
| `soccer_common_trigger_0.04.78` | `DATA_COUNT`=4, `DATA_ITEM` ×4 (cf. §4) |

`SOCCER_GAME_INFO` relie un match à son scénario : `I:hash  S:"fbtl_st_0101"  I:1  I:hash  I:hash  …` — la string est l'ID de scénario présent dans `game/` (voir §4). `SOCCER_OPTION_FIELD_INFO` référence des textures stade, ex. `#/menu/220_img/stadium/img_room_s90g001.g4tx`.

---

## 2. Configs de match typées (`version/lists`, racine)

Tables à champs nommés. Valeurs réelles ci-dessous.

### Suggestions (« suggest » — commandes proposées au joueur pendant le match)

`soccer_suggest_config_*` existe en 6 versions (0.00.00 → 0.01.92), schéma qui s'enrichit : `0.00.00` a `{id, cmdId, textId, type, isSpProd}` ; `0.01.92` a `{id, cmdId, textId, requestTextId, category, subCategory, type, iconId, icon_on_Id, icon_off_Id, isDefElected, cost, connectType, isSpProd, spProdCamera, counterSuggest, connectSuggest}`. La 0.01.92 ajoute aussi `m_soccerSuggestPassExtensionDataList` (**132** extensions de passe par zone) + `m_soccerSuggestPredict*` (motion/phase/objet).

Valeurs réelles de `m_soccerSuggestInfoList` (0.01.92, 5 entrées) :

| id | cmdId | textId | cat/sub | type | cost |
|---|---|---|---|---|---|
| 0xEC13A97C | 0x9178C3FE | 0xF321EEC8 | 1/1 | 0 | 1 |
| 0x9B1499EA | 0x8863F2BF | 0x8426DE5E | 1/1 | 0 | 1 |
| 0xABB3D3AC | 0xA9E96428 | 0xF126BA32 | 2/3 | 0 | 1 |
| 0xDCB4E33A | 0x82C437EB | 0x86218AA4 | 2/3 | 0 | 1 |
| 0x038964AA | 0x00000000 | 0xDDA3908A | 0/0 | 2 | 3 |

(`counterSuggest` chaîne 0xEC13A97C → 0xABB3D3AC.)

### Passifs d'équipe — `soccer_team_passive_config_0.00.00`

`m_soccerTeamPassiveDataList` (**21**) : `{teamPassiveId, effectId, effectValueMax, effectValueMin, teamPassiveTextId}`.
Ex. `{teamPassiveId:0x2A7D4552, effectId:0xBEBB2EE8, effectValueMax:8, effectValueMin:0, teamPassiveTextId:0x44FECFAB}`.

### Focus-battle — `soccer_focus_battle_effect_config`

4 listes parallèles de **10** entrées, recombinées par `m_soccerFocusBattleEffectInfoList` `{id, range:[i,n], activatedEffect:[i,n], demoTrigger:[i,n]}`.

| Liste | Champs | Valeur représentative |
|---|---|---|
| `…EffectRangeList` | rangeType, rangeParam1-3 | `{rangeType:1, p1:30, p2:10, p3:0}` (sinon type 0/0/0/0) |
| `…ActivatedEffectList` | effectId, effectParam1-8 | `{effectId:0xBEBB2EE8, params:0…}` |
| `…DemoTriggerList` | demoTriggerType, param1-3, demoTriggerTextId | `{type:3, textId:0x8901F53D}`, `{type:2, textId:0xFE06C5AB}` |

### Techniques — `soccer_technic_config`

`m_soccerTechnicInfoList` (**8**) `{id, nameTextId, descTextId, recastTime, usableCondition:[i,n], focusBattleEffectId}`.
Ex. `{id:0x07857A3F, nameTextId:0x7B5D17D1, recastTime:5, usableCondition:[0,2], focusBattleEffectId:0x8A6BFF0D}`.
`m_soccerTechnicUsableConditionList` (**15**) `{type, param1-3}` : ex. `{type:1, p1:3, p2:30}`, `{type:2, p1:1}`.

### Effets de base — `soccer_basic_effect_config_1.01.79.00`

`m_soccerBasicEffectInfoList` (**102**) `{id, funcName, buildIconType}` : `id`/`funcName` sont des hashes (`{id:0x83DB0758, funcName:0xC9D604D4, buildIconType:6}`).

### Commandes conditionnelles — `soccer_condition_cmd_config_0.05.94`

`m_updateTimingInfoList` (**158**) `{updateTimingId}` + `m_conditionCommandInfoList` (**145**) `{conditionId, updateTimingInfo:[i,n]}`.

### « Tricks » (hissatsu liés aux events) — `trick_config`

`m_trickInfoList` (**9**) — seul fichier avec des **noms lisibles en clair** (japonais) :

| trickIDName | trickName | category | eventIDName |
|---|---|---|---|
| whs0010 | ファイアトルネード | 1 (shoot) | ev60_0010 |
| whs0110 | シャイニングバード（アレス） | 1 | — |
| who0010 | そよかぜステップ | 2 (dribble) | — |
| who0020 | イナビカリダッシュ（アレス） | 2 | — |
| whd0010 | 旋風陣 | 3 (defense) | — |
| whd0050 | ザ・ミスト | 3 | — |
| whk0010 | ゴッドハンド | 4 (keeper) | — |
| whk0020 | ギガントウォール | 4 | — |
| whk0030 | 王家の盾（アレス） | 4 | — |

### Caméras — `soccer_camera_config_1.03.21`

13 listes. Principales : `m_soccerCameraInfoDataList` (**138** jeux de paramètres : length/rotX/rotY/fov/refOffset/interpRate…), `m_soccerCameraInfoList` (54), `m_scAerialCameraMapInfoList` (108), `m_scGoalnetCameraInfoList` (8), `m_soccerFixPosCameraInfoDataList` (21), `m_cinematicCameraInfoDataList` (15). Valeur réelle (goalnet) : `{id:0x596C1326, camPosX:14, camPosY:2.5, camPosZ:50, fov:45, chaseMaxSpeed:0.6, notFollowAfterBouncing:true, isInitRefGoalLine:false}`.

### Config additionnelle de partie — `soccer_game_additional_config_1.04.14.00`

19 listes. Notables :
- `m_SoccerGameEx` (**302**) — règles de match exhibition : `{id, ownNum, oppNum, exRule:[i,n], ownPlacement, oppPlacement, ownScore, oppScore, startPhase, startMin, entering*Event, halfTimeEvent, endWin/Lose/DrawEventId, isSkip…}`. Ex. `{ownNum:1, oppNum:3, ownScore:0, oppScore:0, endWinEventId:0xB254F239}`.
- `m_ExRule` (**94**) `{type, target, value, id}` ; `m_ExOppPlacement` (7), `m_ExOwnPlacement` (2) `{pos}`.
- `m_SoccerCasterList` (**10**) — commentateurs, **noms en clair** : `{idStr, charaId, prefix, charaNameTextSubId}` :

| idStr | charaId | prefix | subId |
|---|---|---|---|
| sc0001 | 0xD5C68103 | Tabe | 11 |
| sc0002 | 0x525E9DCC | Keita | 11 |
| sc0003 | 0x1B7A4C2A | Osyo | 12 |
| sc0004 | 0x1DC6CBAD | Maxter | 12 |
| sc0005 | 0xCF5065D3 | Igo | 0 |
| sc0006 | 0x7BCFBDD3 | Ayumu | 12 |
| sc0007 | 0x370AFF7A | Yajima | 11 |
| sc0008 | 0x61A76258 | Dakusu | 11 |
| sc0009 | 0xB17384A1 | Revin | 12 |
| sc0010 | 0x667203A0 | Kanemasa | 0 |

- `m_SoccerCasterSettingList` (24), `m_SoccerTeamAIDataList` (9 : `{id, quoteId, paramData, strategyId}`), `m_SoccerGetExpDataTable` (17), `m_SoccerNicePlayExpDataList` (7 : `{shootExp, skillExp, focusExp, scrambleExp}`), `m_SoccerGrowth*` (10/20), `m_SoccerTrainingEndEvent` (events de fin d'entraînement).

### Placement & joueurs

- `soccer_chara_placement_1.01.97.00` : `m_charaPlacementData` (**2269** : `{charaParameterId, posX, posZ, rotY, isSetCtrlChara, catchBallType, actionId}`), `m_placementCategory` (798), `m_placementData` (398).
- `soccer_chara_unique_rarity_config_1.03.00.00` : `m_soccerCharaUniqueRarityList` (**71** : variantes Hero Fire/Black/Pink par perso).
- `soccer_costume_config_1.03.97.00` : `m_costumeInfo` (**275** : `{uniformId, directorCostumeType, managerCostumeType, directorCharaId, playerCharaId, cond}`), `m_soccerCostumeConfig` (266).

### Drops & récompenses

- `soccer_drop_config_*` (2 versions, **1.03.20.00** et **5.00.27.00**) : tables de loot. `m_spiritTableDataList` (484 → 568 selon version : `{charaId, weight, runCond}`), `m_itemDropDataList` (94), `m_rarityDecideTableList` (6 : normal/growing/advanced/top/legendary/hero), `m_spiritCharaTableList` (30→34). La 5.00.27.00 ajoute `m_exceptionDropCharaList` (113).
- `soccer_fixed_reward_spirit_config_1.02.11.00` : `m_soccerFixedRewardSpiritDataList` (42 : `{charaId, rarity, num, desableFlagId}`), `m_victoryBoxEmmitSpiritDataList` (3).

### Rank / rankmatch / scramble / quêtes

- `soccer_rank_config_0.00.00` : `m_SoccerRankInfoList` (4 : `{id, soccerRankType, nameTextId, nextRankPoint}`, ex. `{rankType:1, nextRankPoint:400}`), `m_SoccerRankRateList` (4), `m_SoccerPrizePriceList` (3).
- `soccer_rankmatch_config_0.00.00` : `m_SoccerRankmatchInfoList` (2 : périodes datées begin/end year-month-day-hour-minute), `m_SoccerRankmatchPrizeItemInfoList` (4).
- `soccer_scramble_config_0.00.00` : `m_soccerScrambleUIMovePosDataList` (14), `m_soccerScrambleUIMoveInfoList` (4 : `{movePosList, bezierSplitNum, moveSpeed, moveLimitTime}`).
- `game_quest_config_1.02.33` : `m_questDataList` (**948**), `m_gameQuestInfoList` (**175**), `m_gameInfoList` (175), `m_iconList` (713).
- `soccer_opponent_info_0.00.00` : `m_soccerOpponentInfoList` (**154** : `{category, battleId, sortOrder, cond1-4}`) ; catégories : `{0: 22, 1: 132}` ; `cond1-4` sont des blobs base64 (cf. §4).

### Autres tables typées

`geoglyph_config_1.03.76` (`m_GeoglyphInfoList` 86), `soccer_game_map_enviroment_config` (`m_soccerGameMapEnvList` 29 : hour/weather/groundAttr), `soccer_game_overwrite_config` (2), `soccer_game_restart_config` (`m_restartPhaseList` 11, `m_clearSoccerCommonTmpBitFlags` 88), `soccer_perfomance_genre_config` (21), `soccer_performance_config` (16 : `{performanceId, eventId, eventNameTextId, textureFilePath, validCond}`), `soccer_player_record_config` (20 flags cpu_difficulty/rank/room/enjoy), `soccer_tutorial_config` (`m_telop` 14, `m_phase` 13), `kizuna_link_config` (`m_LabelConfigList` **0** — vide).

---

## 3. Scénarios de match — `soccer/game/` (392 fichiers, schéma `entries`)

Chaque scénario de match se compose de **deux fichiers appariés** :

| Suffixe | Nb | Rôle |
|---|---|---|
| `*_trigger_0.04.78` | 210 | Conditions/événements déclenchés pendant le match |
| `*_phase_set_0.00.00` | 182 | Timeline des phases du match |

Tous suivent le même gabarit : un `DATA_COUNT_0` (Int = nombre d'items) suivi de N `DATA_ITEM_i`.

**Triggers** — 5398 `DATA_ITEM` au total, **tous à 7 variables**. Deux layouts :

| Layout (types) | Occurrences | Forme |
|---|---|---|
| `Int,Int,Int,String,Int,Int,Int` | 5098 | la String est un **blob base64** (condition/script encodé) |
| `Int,Int,Int,Int,Int,Int,Int` | 300 | 7 entiers |

Le 1er Int (catégorie de trigger) — valeurs les plus fréquentes : `207` (×643), `250` (×456), `201` (×348), `214` (×338), `252` (×274), `251` (×253), `203` (×244), `232` (×238), `257` (×235), `230` (×230).

**Phase_set** — 1096 `DATA_ITEM`, **tous à 3 variables**, 1er Int **toujours `1`**. Deux layouts : `Int,Int,String` (938, ex. `[1, 10, "<base64>"]`) et `Int,Int,Int` (158, ex. `[1, 90, 0]`). Le 2e Int est une **minute de match** (10, 90…).

Exemple de blob base64 (champ String d'un trigger) : `AAAAAA8FNbkZNtoAAQAyAAAnang=` — données binaires sérialisées du moteur (non décodées ici).

### Préfixes des scénarios (groupes de matchs)

Par nombre de fichiers `*_trigger_*` :

| Préfixe | Fichiers | Nature |
|---|---|---|
| `fbtl_cro01` … `fbtl_cro08`, `cro12` | 13+20+19+22+35+16+13+12+5 | « focus battle chronicle » (matchs de chronique) |
| `fbtl_st_*` | 17 | matchs « story » (`fbtl_st_0101`, `0301`, `0401`…) |
| `test_fbtl_trng_*` | 13 | matchs de test/training |
| `fbtl_qs_*` / `sbtl_qs_*` | 4 / 3 | quick-start / scenario battle |
| `chroniclebtl_ie1_*` | 2 | chronique IE1 |
| `sbtl_*` (eiai, kamome, shopkeeper) | — | scenario battles nommés |
| `fbtl_eiai/ikokukan/keizen/nicogawa/teikoku` | 1 ch. | matchs vs équipes nommées |
| `btl_trial`, `btl_trial2/3`, `tutorial_fbtl_001`, `tgs24` | 1 ch. | trial / tutorial / démo salon |
| `debug_*` | 2 | scénarios de debug |

Exemple apparié `fbtl_st_0101` :
- `…_trigger_*` : `DATA_COUNT=2`, `DATA_ITEM_0 = [201,0,0,0,0,0,1]`, `DATA_ITEM_1 = [80,0,0,"AAAAAA8FNbkZ…",0,0,2]`.
- `…_phase_set_*` : `DATA_COUNT=2`, `DATA_ITEM_0 = [1,10,"AAAAABgFNSo9…"]`, `DATA_ITEM_1 = [1,90,0]` (minute 10 → minute 90).

---

## 4. Notes de portage (FSM nie-core)

- Les **`cmdId`/`effectId`/`textId`/`charaId` sont des CRC32** (string `0x…` en schéma typé, Int signé en schéma `entries`) ; le mapping hash→nom se résout via la base RE / inagle, hors de cette famille.
- Les **références inter-listes** du schéma typé sont des paires `[indexDébut, nombre]` dans la liste cible (pas des IDs).
- Les **champs `cond*` et les `String` des triggers/phase_set sont des blobs base64** (bytecode de condition/événement du moteur Lives) — à décoder séparément pour reproduire la logique de déclenchement.
- Locale du dumper : `Float` en virgule décimale (`"0,5"`) dans le schéma `entries` ; nombres JSON normaux dans le schéma typé.
