# Famille de données : menus

Glob : `data/common/gamedata/menu/**/*.json` — **456 fichiers** (décodages `*.cfg.bin` → JSON).

Deux schémas coexistent dans cette famille :

- **Schéma `entries`** (arbre RDBN générique) : 450 fichiers. Chaque nœud = `{name, variables[]:{type,value}, children[]}`. Les listes sont introduites par un nœud `*_LIST_BEG_0` dont la 1re variable `Int` donne le nombre d'éléments, suivi des éléments en `children`. Aucun bloc `TEXT_INFO [Int hash, Int, String]` n'existe dans cette famille (les libellés texte vivent ailleurs ; ici les nœuds référencent des objets UI par hash CRC).
- **Schéma `lists`** (structs typées à champs nommés) : 6 fichiers — `{version, lists[]:{name, typeName, values[]}}`.

## Répartition par répertoire

| Répertoire | Fichiers |
|---|---:|
| `cfg` | 440 |
| `(racine)` | 15 |
| `GroupCapture` | 1 |

## Schéma `entries` — types de nœuds (corpus entier)

Stems de `name` (suffixe `_N` retiré), tous fichiers `entries` confondus. Les `*_LIST_BEG` sont les en-têtes de liste ; les autres sont les enregistrements.

| Stem du nœud | Occurrences | Fichiers |
|---|---:|---:|
| `MENU_LAYER_GROUP_BASE` | 4965 | 440 |
| `MENU_LAYER_INFO` | 4367 | 440 |
| `MENU_CMD_INFO` | 4280 | 302 |
| `MENU_RES` | 1434 | 304 |
| `MENU_FOCUS_BASE_INFO` | 1023 | 302 |
| `MENU_FOCUS_GROUP` | 900 | 306 |
| `MENU_FOCUS_GROUP_REF_FOCUS_BASE_INFO` | 900 | 306 |
| `MENU_CREATE_INFO` | 678 | 2 |
| `MENU_LAYER_GROUP` | 605 | 440 |
| `MENU_LAYER_GROUP_REF_LAYER_GROUP_BASE` | 605 | 440 |
| `MENU_LAYER_INFO_LIST_BEG` | 440 | 440 |
| `MENU_CMD_INFO_LIST_BEG` | 440 | 440 |
| `MENU_RES_LIST_BEG` | 440 | 440 |
| `MENU_LAYER_GROUP_BASE_LIST_BEG` | 440 | 440 |
| `MENU_LAYER_GROUP_LIST_BEG` | 440 | 440 |
| `MENU_FOCUS_SHIFT_BASE_INFO` | 405 | 69 |
| `MENU_FOCUS_GROUP_LIST_BEG` | 306 | 306 |
| `MENU_FOCUS_BASE_INFO_LIST_BEG` | 302 | 302 |
| `MENU_FOCUS_SHIFT` | 192 | 69 |
| `MENU_FOCUS_SHIFT_REF_FOCUS_SHIFT_BASE_INFO` | 192 | 69 |
| `MENU_POS_INFO` | 105 | 1 |
| `MENU_POS_INFO_REF_MAP_DATA` | 105 | 1 |
| `CHARA_MENU_RESOURCE_INFO` | 92 | 1 |
| `MENU_FOCUS_SHIFT_BASE_INFO_LIST_BEG` | 69 | 69 |
| `MENU_FOCUS_SHIFT_LIST_BEG` | 69 | 69 |
| `GROUP_CAPTURE_INFO` | 52 | 1 |
| `MENU_POPUP_INFO` | 52 | 1 |
| `MENU_TALK_ICON_IDX_LIST` | 36 | 1 |
| `MENU_TALK_ICON_INFO` | 35 | 1 |
| `GROUP_CAPTURE_CUSTOM_PARAM` | 31 | 1 |

## Anatomie d'un écran de menu (`cfg/*_setting.cfg.bin.json`)

Les 440 fichiers de `cfg/` décrivent chacun un écran. Structure type (ordre des variables observé dans les vrais fichiers) :

- **`MENU_RES`** : ressource graphique. `var[0]`=String chemin (`#/menu/...g4tx`), `var[1]`=Int.
- **`MENU_LAYER_INFO`** : un calque/objet UI. `var[0]`=Int(hash CRC du calque), `var[1]`=String(nom logique ex. `title00_01_title_top`), `var[2]`=String(chemin `.objbin`), puis 7 Int (ordre/parent/flags).
- **`MENU_LAYER_GROUP_BASE`** / **`MENU_LAYER_GROUP`** : regroupements de calques (par hash).
- **`MENU_CMD_INFO`** : action/commande. `var[0..1]`=Int(hash), `var[2]`=String(nom de commande ex. `CMD_ENTER`), `var[3..4]`=Int.
- **`MENU_FOCUS_BASE_INFO`** / **`MENU_FOCUS_GROUP`** / **`MENU_FOCUS_SHIFT`** : navigation au pad (focus initial, groupes de focus, décalages directionnels).
- **`MENU_CREATE_INFO`** : ordre de création des objets.

### Écrans les plus riches (par nombre de calques)

| Écran (`cfg/…_setting`) | Calques | Cmds | Ressources | Focus | Groupes |
|---|---:|---:|---:|---:|---:|
| `rpg_battle_menu_setting` | 130 | 3 | 8 | 1 | 359 |
| `soccer_formation_menu_setting` | 75 | 73 | 15 | 10 | 93 |
| `shop_menu_setting` | 70 | 36 | 13 | 8 | 56 |
| `network_menu_setting` | 67 | 146 | 14 | 27 | 72 |
| `ability_learning_board_menu_setting` | 63 | 49 | 9 | 10 | 64 |
| `general_window_setting` | 62 | 24 | 10 | 8 | 62 |
| `team_dock_menu_setting` | 58 | 163 | 13 | 19 | 92 |
| `players_universe_menu_setting` | 54 | 24 | 11 | 3 | 54 |
| `popup_menu_setting` | 46 | 0 | 11 | 0 | 47 |
| `special_training_menu_setting` | 44 | 40 | 7 | 21 | 44 |
| `soccer_summon_menu_setting` | 43 | 56 | 7 | 12 | 43 |
| `enjoy_team_select_menu_setting` | 40 | 43 | 8 | 10 | 67 |
| `equip_medalset_menu_setting` | 39 | 30 | 5 | 7 | 55 |
| `information_top_menu_setting` | 39 | 32 | 10 | 11 | 40 |
| `soccer_result_menu_setting` | 39 | 17 | 20 | 6 | 40 |
| `sub_window_setting` | 37 | 88 | 3 | 21 | 37 |
| `kizuna_menu_setting` | 36 | 70 | 8 | 18 | 36 |
| `soccer_team_dock_menu_setting` | 36 | 112 | 13 | 11 | 36 |
| `personal_plate_menu_for_mode_change_setting` | 35 | 20 | 8 | 2 | 35 |
| `soccer_command_action_menu_setting` | 35 | 0 | 4 | 0 | 69 |
| `kizuna_town_avatar_menu_setting` | 33 | 59 | 10 | 7 | 50 |
| `map_menu_setting` | 33 | 24 | 5 | 4 | 33 |
| `players_universe_search_menu_setting` | 33 | 60 | 13 | 7 | 48 |
| `map_menu_raimon_setting` | 32 | 24 | 5 | 4 | 32 |
| `personal_plate_menu_for_datafile_setting` | 32 | 9 | 9 | 1 | 32 |

Totaux corpus écrans : 440 écrans, 4367 calques, 4280 commandes.

## Noms de commandes réels (`MENU_CMD_INFO` var[2])

| Commande | Occurrences (corpus) |
|---|---:|
| `CMD_FUNCTION` | 1447 |
| `CMD_BACK` | 707 |
| `CMD_ENTER` | 547 |
| `CMD_FCS_NEXT` | 394 |
| `CMD_FCS_BACK` | 388 |
| `CMD_FCS_CHANGE` | 153 |
| `CMD_FCS_PAGE_BACK` | 84 |
| `CMD_FCS_PAGE_NEXT` | 84 |
| `CMD_SUB_ENTER` | 6 |
| `CMD_FCS_MTX_UP` | 6 |
| `CMD_FCS_MTX_DOWN` | 6 |
| `CMD_FCS_MTX_LEFT` | 4 |
| `CMD_FCS_MTX_RIGHT` | 4 |
| `CMD_CANCEL` | 2 |

## Objets UI référencés (`.objbin`)

2071 chemins `.objbin` distincts référencés par `MENU_LAYER_INFO` (`common/gamedata/menu/obj/*.objbin`). Exemples :

| Chemin objbin | Réfs |
|---|---:|
| `common/gamedata/menu/obj/cmn05_01_cursor.objbin` | 182 |
| `common/gamedata/menu/obj/mainmenu01_07_button_guide.objbin` | 62 |
| `common/gamedata/menu/obj/mainmenu01_06_base_button_guide.objbin` | 58 |
| `common/gamedata/menu/obj/mainmenu01_10_return_arrow_button_guide.objbin` | 56 |
| `common/gamedata/menu/obj/cmn01_10_new_icon.objbin` | 53 |
| `common/gamedata/menu/obj/team00_01_chara_card_for_soccer.objbin` | 52 |
| `common/gamedata/menu/obj/cmn06_20_list_tab_item.objbin` | 39 |
| `common/gamedata/menu/obj/avatar01_10_edit_window.objbin` | 38 |
| `common/gamedata/menu/obj/team00_01_p1_chara_card_blank.objbin` | 36 |
| `common/gamedata/menu/obj/mainmenu90_05_content_guide_line01.objbin` | 34 |
| `common/gamedata/menu/obj/cmn02_01_blackbg.objbin` | 33 |
| `common/gamedata/menu/obj/mainmenu90_00_background.objbin` | 33 |
| `common/gamedata/menu/obj/avatar01_13_gauge_bar.objbin` | 25 |
| `common/gamedata/menu/obj/avatar01_13_p1_gauge_bar_button.objbin` | 25 |
| `common/gamedata/menu/obj/team00_30_p2_armed_chara_list_item.objbin` | 24 |
| `common/gamedata/menu/obj/cmn06_01_list_tab_attach.objbin` | 24 |
| `common/gamedata/menu/obj/mainmenu90_01_header.objbin` | 24 |
| `common/gamedata/menu/obj/cmn01_40_list_base_empty.objbin` | 23 |
| `common/gamedata/menu/obj/cmn05_01_inventory.objbin` | 21 |
| `common/gamedata/menu/obj/avatar01_36_color_preset_list_item.objbin` | 20 |

## Atlas / textures d'icônes (`MENU_RES`)

394 chemins de ressources distincts. Exemples :

| Chemin ressource | Réfs |
|---|---:|
| `#/menu/200_icon/100_num/num_menu01.g4tx` | 165 |
| `#/menu/200_icon/100_num/num_menu02.g4tx` | 95 |
| `#/menu/200_icon/15_icon_common/icon_common.g4tx` | 70 |
| `#/menu/200_icon/15_icon_common2/<LG>/icon_common2.g4tx` | 57 |
| `#/menu/200_icon/15_icon_common/<LG>/icon_common.g4tx` | 46 |
| `#/menu/200_icon/100_num/num_lucky7.g4tx` | 45 |
| `#/menu/200_icon/100_num/num_at.g4tx` | 36 |
| `#/menu/200_icon/16_icon_list_tab/<LG>/icon_list_tab.g4tx` | 36 |
| `#/menu/200_icon/05_icon_rarity/<LG>/icon_rarity.g4tx` | 30 |
| `#/menu/200_icon/100_num/num_lv.g4tx` | 20 |
| `#/menu/100_topmenu/100_topmenu01/topmenu01_01/<LG>/gtxt_title01.g4tx` | 17 |
| `#/menu/200_icon/08_icon_teambuff/<LG>/icon_teambuff.g4tx` | 16 |
| `#/menu/200_icon/100_num/num_ver.g4tx` | 15 |
| `ega1400a_1` | 14 |
| `#/menu/200_icon/07_icon_rank/<LG>/icon_rank.g4tx` | 13 |
| `ega1400a_2` | 13 |
| `#/menu/200_icon/100_num/num_tech.g4tx` | 12 |
| `#/menu/200_icon/18_icon_list_tab/icon_list_tab.g4tx` | 12 |
| `#/menu/200_icon/100_num/<LG>/num_menu01.g4tx` | 11 |
| `ega1450a_1` | 11 |

## Fichiers de configuration globaux (racine, schéma `entries`)

### `menu_icon_manage_config.cfg.bin.json`
Gestion des icônes de menu. Chemin de base : `#/menu/`.

Préfixes d'ID d'icône (27) : `num`, `tk`, `test_tk`, `tr`, `tk_si`, `tk_ki`, `tk_vi`, `tk_bb`, `tk_st`, `eq_sh`, `eq_mi`, `eq_ac`, `eq_sp`, `gd`, `btl_re`, `icon_star01`, `ex`, `abl`, `perf`, `uni`, `ke`, `cos`, `coi`, `coa`, `icon_cate_animal`, `ds`, `mini`.

Noms de fichiers d'atlas (19) : `icon_common.g4tx`, `icon_item10.g4tx`, `icon_item03.g4tx`, `icon_item04.g4tx`, `icon_item05.g4tx`, `icon_item08.g4tx`, `icon_item01.g4tx`, `icon_item02.g4tx`, `icon_test.g4tx`, `icon_item01.g4tx`, `icon_item01.g4tx`, `icon_item07.g4tx`, `icon_item02.g4tx`, `icon_item09.g4tx`, `icon_town.g4tx`, `icon_animal.g4tx`, `icon_cate_animal01.g4tx`, `icon_deco.g4tx`, `icon_minimap.g4tx`.

### `menu_talk_icon_config_0.04.94.cfg.bin.json`
Icônes de dialogue / lignes de bulle. Nœuds : `MENU_TALK_LINE_MESH`×6, `MENU_TALK_LINE_LINE`×7, `MENU_TALK_LINE_LINE_REF_MESH`×7, `MENU_TALK_ICON_INFO`×35, `MENU_TALK_ICON_IDX_LIST`×36.

### `menu_map_pos_config_0.00.00.cfg.bin.json`
Positions de menus sur carte. Nœuds : `MENU_POS_MAP_DATA`×25, `MENU_POS_INFO`×105, `MENU_POS_INFO_REF_MAP_DATA`×105.

### `cmd_tag_config_2.00.17.00.cfg.bin.json`
Tags de commande pad / clavier-souris (icônes de boutons d'aide). Nœuds : `CMD_TAG_PAD`×11, `CMD_TAG_KEYBOARD_MOUSE`×27, `CMD_TAG_INFO`×13, `CMD_TAG_INFO_REF_PAD`×13, `CMD_TAG_INFO_REF_KEYBOARD_MOUSE`×13.

### `menu_pop_manage_config_0.01.92.cfg.bin.json`
Nœuds : `MENU_POPUP_INFO_LIST_BEG`×1, `MENU_POPUP_INFO`×52.

### `menu_group_capture_config.cfg.bin.json`
Nœuds : `GROUP_CAPTURE_INFO_LIST_BEG`×1, `GROUP_CAPTURE_INFO`×52, `GROUP_CAPTURE_CFG_LIST_BEG`×1, `GROUP_CAPTURE_CFG`×5, `GROUP_CAPTURE_CFG_REF_INFO`×5.

### `menu_create_setting_1.03.56.00.cfg.bin.json`
Nœuds : `MENU_CREATE_INFO_LIST_BEG`×1, `MENU_CREATE_INFO`×336, `MENU_RES_PATH_INFO_LIST_BEG`×1, `MENU_RES_PATH_INFO`×3.

### `menu_create_setting_5.00.27.00.cfg.bin.json`
Nœuds : `MENU_CREATE_INFO_LIST_BEG`×1, `MENU_CREATE_INFO`×342, `MENU_RES_PATH_INFO_LIST_BEG`×1, `MENU_RES_PATH_INFO`×3.

## Fichiers à schéma `lists` (structs typées à champs nommés)

### `chara_menu_motion_1.03.50.00.cfg.bin.json` (version 100)

- **`CHARA_MENU_MOTION_DATA`** (`m_charaMenuMotionDataList`) — 74 entrées. Champs : `motionNameCrc`, `motionNameTeamDockCrc`, `motionNameEnjoyVsLeftCrc`, `motionNameEnjoyVsRightCrc`, `motionNameCaptureFace`, `motionNameCaptureBustup`, `motionNameCaptureOverview`, `motionNameSoccerVsLeftCrc`, `motionNameSoccerVsRightCrc`, `personalityType`, `performanceType`.
- **`CHARA_MENU_MOTION_INFO`** (`m_charaMenuMotionList`) — 39 entrées. Champs : `charaID`, `motionData`.

  Exemples (`CHARA_MENU_MOTION_DATA`) :
  ```json
  {"motionNameCrc":"0x86F0C191","motionNameTeamDockCrc":"0x301504D6","motionNameEnjoyVsLeftCrc":"0xD2CA5B71","motionNameEnjoyVsRightCrc":"0xF9E708B2","motionNameCaptureFace":"0x61B638A0","motionNameCaptureBustup":"0x4A9B6B63","motionNameCaptureOverview":"0x53805A22","motionNameSoccerVsLeftCrc":"0x00000000","motionNameSoccerVsRightCrc":"0x00000000","personalityType":1,"performanceType":0}
  {"motionNameCrc":"0x86F0C191","motionNameTeamDockCrc":"0x301504D6","motionNameEnjoyVsLeftCrc":"0xD2CA5B71","motionNameEnjoyVsRightCrc":"0xF9E708B2","motionNameCaptureFace":"0x61B638A0","motionNameCaptureBustup":"0x4A9B6B63","motionNameCaptureOverview":"0x53805A22","motionNameSoccerVsLeftCrc":"0x00000000","motionNameSoccerVsRightCrc":"0x00000000","personalityType":2,"performanceType":0}
  {"motionNameCrc":"0x86F0C191","motionNameTeamDockCrc":"0x301504D6","motionNameEnjoyVsLeftCrc":"0xD2CA5B71","motionNameEnjoyVsRightCrc":"0xF9E708B2","motionNameCaptureFace":"0x61B638A0","motionNameCaptureBustup":"0x4A9B6B63","motionNameCaptureOverview":"0x53805A22","motionNameSoccerVsLeftCrc":"0x00000000","motionNameSoccerVsRightCrc":"0x00000000","personalityType":3,"performanceType":0}
  ```

### `chara_uniform_menu_resource_1.00.25.cfg.bin.json` (version 100)

- **`CHARA_UNIFORM_MENU_RESOURCE_INFO`** (`m_CharaUniformMenuResourceList`) — 506 entrées. Champs : `uniform_id`, `isCollar`.

  Exemples (`CHARA_UNIFORM_MENU_RESOURCE_INFO`) :
  ```json
  {"uniform_id":"0x55CB3260","isCollar":false}
  {"uniform_id":"0x7EE661A3","isCollar":false}
  {"uniform_id":"0xD35F40CE","isCollar":false}
  ```

### `emblem_resource_0.04.18.cfg.bin.json` (version 100)

- **`EMBLEM_RESOURCE_INFO`** (`m_EmblemResourceInfoList`) — 2 entrées. Champs : `emblemId`, `emblemName`, `s_filePath`, `s_texName`, `l_filePath`, `l_texName`.
- **`EMBLEM_RESOURCE_BASE_PATH`** (`m_EmblemResourceBasePathList`) — 1 entrées. Champs : `basePath`.

  Exemples (`EMBLEM_RESOURCE_INFO`) :
  ```json
  {"emblemId":"0xE35E00DF","emblemName":"default","s_filePath":"200_icon/01_icon_emblem/<resourceID>_s.g4tx","s_texName":"<resourceID>_s01","l_filePath":"200_icon/01_icon_emblem/<resourceID>.g4tx","l_texName":"<resourceID>"}
  {"emblemId":"0xD5ABE1F0","emblemName":"em010001","s_filePath":"200_icon/01_icon_emblem/em010001_s.g4tx","s_texName":"em010001_s01","l_filePath":"200_icon/01_icon_emblem/em010001.g4tx","l_texName":"em010001"}
  ```

### `menu_chara_model_pose_config_1.02.38.cfg.bin.json` (version 100)

- **`MENU_CHARA_POSE`** (`m_MenuCharaPoseList`) — 431 entrées. Champs : `id`, `posX`, `posY`, `posZ`, `rotX`, `rotY`, `rotZ`, `minAspectPosX`, `minAspectPosY`, `minAspectPosZ`, `maxAspectPosX`, `maxAspectPosY`, `maxAspectPosZ`, `minAspectRotX`, `maxAspectRotX`, `minAspectRotY`, `maxAspectRotY`, `minAspectRotZ`, `maxAspectRotZ`, `isEnableMinAspect`, `isEnableMaxAspect`, `scale`, `minAspectScale`, `maxAspectScale`.
- **`MENU_CHARA_BODY_TYPE_POSE_DATA`** (`m_BodyTypePoseDataList`) — 1728 entrées. Champs : `menuCharaPoseId`, `bodyType`.
- **`MENU_CHARA_BODY_TYPE_POSE_INFO`** (`m_MenuCharaBodyTypePoseList`) — 96 entrées. Champs : `id`, `poseData`.

  Exemples (`MENU_CHARA_POSE`) :
  ```json
  {"id":"0x61CE6C02","posX":-2,"posY":0.81,"posZ":3.7,"rotX":0,"rotY":38.9,"rotZ":0,"minAspectPosX":0,"minAspectPosY":0,"minAspectPosZ":0,"maxAspectPosX":0,"maxAspectPosY":0,"maxAspectPosZ":0,"minAspectRotX":0,"maxAspectRotX":0,"minAspectRotY":0,"maxAspectRotY":0,"minAspectRotZ":0,"maxAspectRotZ":0,"isEnableMinAspect":false,"isEnableMaxAspect":false,"scale":1,"minAspectScale":1,"maxAspectScale":1}
  {"id":"0xA89C40E0","posX":-2,"posY":1.15,"posZ":3.4,"rotX":0,"rotY":38.9,"rotZ":0,"minAspectPosX":0,"minAspectPosY":0,"minAspectPosZ":0,"maxAspectPosX":0,"maxAspectPosY":0,"maxAspectPosZ":0,"minAspectRotX":0,"maxAspectRotX":0,"minAspectRotY":0,"maxAspectRotY":0,"minAspectRotZ":0,"maxAspectRotZ":0,"isEnableMinAspect":false,"isEnableMaxAspect":false,"scale":1,"minAspectScale":1,"maxAspectScale":1}
  {"id":"0xD5967A77","posX":-2,"posY":0.62,"posZ":3.6,"rotX":0,"rotY":38.9,"rotZ":0,"minAspectPosX":0,"minAspectPosY":0,"minAspectPosZ":0,"maxAspectPosX":0,"maxAspectPosY":0,"maxAspectPosZ":0,"minAspectRotX":0,"maxAspectRotX":0,"minAspectRotY":0,"maxAspectRotY":0,"minAspectRotZ":0,"maxAspectRotZ":0,"isEnableMinAspect":false,"isEnableMaxAspect":false,"scale":1,"minAspectScale":1,"maxAspectScale":1}
  ```

### `menu_preset_config_0.06.07.cfg.bin.json` (version 100)

- **`SCENE_MENU_PRESET_DATA`** (`m_sceneMenuPresetDataList`) — 16 entrées. Champs : `initEnterType`, `initLeaveType`, `initCaptureType`, `initCaptureReflectType`, `endType`, `endStartType`, `endWaitType`, `enableChangeVariableResolution`.
- **`SCENE_MENU_PRESET_INFO`** (`m_sceneMenuPresetInfoList`) — 16 entrées. Champs : `menuPresetType`, `presetData`.

  Exemples (`SCENE_MENU_PRESET_DATA`) :
  ```json
  {"initEnterType":0,"initLeaveType":0,"initCaptureType":1,"initCaptureReflectType":0,"endType":0,"endStartType":0,"endWaitType":0,"enableChangeVariableResolution":true}
  {"initEnterType":0,"initLeaveType":0,"initCaptureType":2,"initCaptureReflectType":0,"endType":0,"endStartType":0,"endWaitType":0,"enableChangeVariableResolution":false}
  {"initEnterType":0,"initLeaveType":0,"initCaptureType":2,"initCaptureReflectType":0,"endType":0,"endStartType":0,"endWaitType":0,"enableChangeVariableResolution":false}
  ```

### `virtual_pad_button_config_1.04.17.01.cfg.bin.json` (version 100)

- **`VIRTUAL_PAD_LAYOUT_INFO`** (`m_virtualPadLayoutInfoList`) — 37 entrées. Champs : `id`, `posBodyHorV`, `posBodyHorH`, `posBodyVertV`, `posBodyVertH`, `screenAnchorBodyHorV`, `screenAnchorBodyHorH`, `screenAnchorBodyVertV`, `screenAnchorBodyVertH`, `autoScale`.
- **`VIRTUAL_PAD_DRAW_INFO`** (`m_virtualPadDrawInfoList`) — 54 entrées. Champs : `id`, `menuName`, `menuLayerName`, `menuLayerIndex`, `colBoneName`, `drawWidth`, `drawHeight`, `colWidth`, `colHeight`, `path`, `texName`.
- **`VIRTUAL_PAD_BUTTON_INFO`** (`m_virtualPadButtonInfoList`) — 54 entrées. Champs : `id`, `drawInfoId`, `layoutInfoId`, `drawInfoIndex`, `layoutInfoIndex`, `analogInfoIdx`, `keyIdx`, `inputCmd`, `padViewFlag`, `activePadViewFlag`, `inactivePadViewFlag`, `buttonFunc`, `analogVecLengthMax`, `isActionTouchRelease`, `playDecideAnime`, `inputCmd2`.

  Exemples (`VIRTUAL_PAD_LAYOUT_INFO`) :
  ```json
  {"id":"0x1F440795","posBodyHorV":"00C028440000AFC3","posBodyHorH":"00C028440000AFC3","posBodyVertV":"0000000000000000","posBodyVertH":"0000000000000000","screenAnchorBodyHorV":65,"screenAnchorBodyHorH":65,"screenAnchorBodyVertV":0,"screenAnchorBodyVertH":0,"autoScale":true}
  {"id":"0xE54B3AF6","posBodyHorV":"00C028C40000AFC3","posBodyHorH":"00C028C40000AFC3","posBodyVertV":"0000000000000000","posBodyVertH":"0000000000000000","screenAnchorBodyHorV":68,"screenAnchorBodyHorH":68,"screenAnchorBodyVertV":0,"screenAnchorBodyVertH":0,"autoScale":true}
  {"id":"0xE1E9E962","posBodyHorV":"008089430080D4C3","posBodyHorH":"008089430080D4C3","posBodyVertV":"0000000000000000","posBodyVertH":"0000000000000000","screenAnchorBodyHorV":65,"screenAnchorBodyHorH":65,"screenAnchorBodyVertV":0,"screenAnchorBodyVertH":0,"autoScale":true}
  ```

### Emblèmes : 2 entrées

Noms (échantillon) : `default`, `em010001`.

