# gamedata-rest — données de gameplay & système (`data/common/gamedata/**`)

Résumé factuel de **386 fichiers JSON** (dumps `.cfg.bin.json` du conteneur Level-5 **cfg.bin / RDBN**) couvrant 55 sous-familles de `common/gamedata` — hors familles documentées à part (`menu`, `event`, `soccer`). Toutes les valeurs proviennent directement des JSON.

## Deux formats de conteneur

| Format | Forme JSON | Effectif |
|---|---|---|
| **`lists`** (RDBN typé) | `{ version, lists:[ { name, typeName, values:[ {champs typés} ] } ] }` | 169 fichiers |
| **`entries`** (arbre RDB) | `{ entries:[ { name, variables:[{type,value}], children:[…] } ] }` | 217 fichiers |

Total : **≈ 88 709 entrées** (`values`) côté `lists`, **≈ 161 795 enfants** côté `entries`.

**Conventions de champs** : identifiants = **CRC32** notés `0x........` (`charaId`, `*Id`, `*IdCrc`) ; `*NameId`/`textId`/`*TextId` = clés de texte localisé ; `0x00000000` = nul ; `cond`/`condition`/`openCond`/`enableCond`/`validCond` = **bytecode de condition en base64** (ex. `AAAAAA8FNbkZNtoAAQAyAAAng3E=`) ; les paires `[off,len]` (ex. `[0,2]`) sont des **références (offset,longueur)** vers une autre liste du fichier ; chemins d'assets avec jetons `<LG>`/`<VLG>` (langue), `<TYPE>`, `<CHARA_ID>`. Les positions/vecteurs apparaissent en hex little-endian (ex. `"pos":"000040C00000A0C0"`).

> Artefact de décodage : un champ chaîne **vide** se relit parfois comme le `typeName` voisin (`" OPPONENT_TEAM_INFO"`, `"STAFFROLL_PAGE_INFO"`) ou des octets parasites (`\uFFFD`). Ces valeurs sont filtrées et ne sont pas du vrai contenu.

---

## quest  (66 fichiers)

### `quest/quest_config_1.04.11.00.cfg.bin.json`  _(entries=8)_
- listes : `QUEST_DATA_PPS_INFO_LIST_BEG_0`×259, `QUEST_DATA_PROG_INFO_LIST_BEG_0`×155, `QUEST_DATA_PPS_TEXT_INFO_LIST_BEG_0`×372, `QUEST_DATA_PHASE_LIST_BEG_0`×1888, `QUEST_DATA_REWARD_ITEM_LIST_BEG_0`×112, `QUEST_DATA_CFG_LIST_BEG_0`×546, `QUEST_PURPOSE_CFG_LIST_BEG_0`×261
- chaînes : `story_img001_l01`, `story_img001_l01.g4tx`, `story_img001_s01`, `story_img001_s01.g4tx`, `story_img001_s02`, `story_img001_s02.g4tx`, `story_img001_s03`, `story_img001_s03.g4tx`, `story_img001_s04`, `story_img001_s04.g4tx`, `story_img001_s05`, `story_img001_s05.g4tx`, `quest_img006_s01`, `quest_img006_s01.g4tx`, `story_img001_s06`, `story_img001_s06.g4tx`

### Triggers `DATA_COUNT_0` / `DATA_ITEM_n`  (65 fichiers)
- Même forme : 1 entrée `DATA_COUNT_0` (Int = nombre d'items) suivie de `DATA_ITEM_0..n` (≈ 4–25 items/fichier). Données de scénario d'événement compilées par instance.
- Fichiers : `qsa000000_trigger`, `qsa000001_trigger`, `qsa000002_trigger`, `qsa000003_trigger`, `qsa000004_trigger`, `qsa000005_trigger`, `qsa000006_trigger`, `qsa000007_trigger`, `qsa000008_trigger`, `qsa000009_trigger`, `qsa000010_trigger`, `qsa000011_trigger`, `qsa000012_trigger`, `qsa000013_trigger`, `qsb000000_trigger`, `qsb010100_trigger`, `qsb010200_trigger`, `qsb010300_trigger`, `qsb010400_trigger`, `qsb010500_trigger`, `qsb010600_trigger`, `qsb010700_trigger`, `qsb020100_trigger`, `qsb020200_trigger`, `qsb020300_trigger`, `qsb020400_trigger`, `qsb030100_trigger`, `qsb030200_trigger`, `qsb030300_trigger`, `qsb030400_trigger`, `qsb030500_trigger`, `qsb030600_trigger`, `qsb040100_trigger`, `qsb040200_trigger`, `qsb040300_trigger`, `qsb040400_trigger`, `qsb040500_trigger`, `qsb050100_trigger`, `qsb050200_trigger`, `qsb050300_trigger`, `qsb050400_trigger`, `qsb050500_trigger`, `qsb050600_trigger`, `qsb060100_trigger`, `qsb060200_trigger`, `qsb060300_trigger`, `qsb060400_trigger`, `qsb060500_trigger`, `qsb070100_trigger`, `qsb070200_trigger`, `qsb070300_trigger`, `qsb070400_trigger`, `qsb070500_trigger`, `qsb070600_trigger`, `qsb070700_trigger`, `qsb080100_trigger`, `qsb080200_trigger`, `qsb080300_trigger`, `qsb080400_trigger`, `qsb080500_trigger`, `qsb090100_trigger`, `qsb090200_trigger`, `qsb090300_trigger`, `qsb090400_trigger`, `qsb090500_trigger`

---

## staffroll  (56 fichiers)

_Localisé : sous-dossiers par langue (de, en, es, fr, it, ja, pt, zh_hans, zh_hant). Le contenu textuel réel vit dans les refs `textId`/`texName` (CRC), pas en clair ici._

### `staffroll/de/staffroll_ed_01_1.03.74.00.cfg.bin.json`
- **`m_staffrollPageInfo`** `STAFFROLL_PAGE_INFO` (n=2) — champs : `pageId` `type` `beginTime` `endTime` `beginPositionY` `lineWidth` `textIn` `textOut` `scrollIn` `scrollOut`
- **`m_staffrollStaffData`** `STAFFROLL_STAFF_DATA` (n=2297) — champs : `staffId` `pageNum` `lineNumber` `positonX` `font` `textId` `texName` `menuId` `menuGroupId` `texPath1` `texPath2` `texPath3` `texPath4` `texPath5` `movieId`
- _même structure (55)_ : `de/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `de/staffroll_ev01_00200_1.03.74.00.cfg.bin.json`, `de/staffroll_ev20_00010_1.03.74.00.cfg.bin.json`, `de/staffroll_op_01_1.03.74.00.cfg.bin.json`, `en/staffroll_ed_01_1.03.74.00.cfg.bin.json`, `en/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `en/staffroll_ev01_00200_1.03.74.00.cfg.bin.json`, `en/staffroll_ev20_00010_1.03.74.00.cfg.bin.json`, `en/staffroll_op_01_1.03.74.00.cfg.bin.json`, `es/staffroll_ed_01_1.03.74.00.cfg.bin.json`, `es/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `es/staffroll_ev01_00200_1.03.74.00.cfg.bin.json`, `es/staffroll_ev20_00010_1.03.74.00.cfg.bin.json`, `es/staffroll_op_01_1.03.74.00.cfg.bin.json`, `fr/staffroll_ed_01_1.03.74.00.cfg.bin.json`, `fr/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `fr/staffroll_ev01_00200_1.03.74.00.cfg.bin.json`, `fr/staffroll_ev20_00010_1.03.74.00.cfg.bin.json`, `fr/staffroll_op_01_1.03.74.00.cfg.bin.json`, `it/staffroll_ed_01_1.03.74.00.cfg.bin.json`, `it/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `it/staffroll_ev01_00200_1.03.74.00.cfg.bin.json`, `it/staffroll_ev20_00010_1.03.74.00.cfg.bin.json`, `it/staffroll_op_01_1.03.74.00.cfg.bin.json`, `ja/staffroll_cp_02_1.03.74.00.cfg.bin.json`, `ja/staffroll_ed_01_1.03.74.00.cfg.bin.json`, `ja/staffroll_ed_02_1.03.74.00.cfg.bin.json`, `ja/staffroll_ed_03_1.03.74.00.cfg.bin.json`, `ja/staffroll_ed_04_1.03.74.00.cfg.bin.json`, `ja/staffroll_ed_05_1.03.74.00.cfg.bin.json` … +25 autres

---

## phase  (49 fichiers)

### `phase/c31/c31_trigger_0.04.78.cfg.bin.json`  _(entries=0)_
- _même structure (6)_ : `c90/c90_trigger_0.04.78.cfg.bin.json`, `c91/c91_trigger_0.04.78.cfg.bin.json`, `c92/c92_trigger_0.04.78.cfg.bin.json`, `c93/c93_trigger_0.04.78.cfg.bin.json`, `c94/c94_trigger_0.04.78.cfg.bin.json`, `c96/c96_trigger_0.04.78.cfg.bin.json`

### `phase/phase_set_layout_c01_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `LAYOUT_BASE_LIST_BEG_0`×9
- _même structure (8)_ : `phase_set_layout_c02_0.00.00.cfg.bin.json`, `phase_set_layout_c03_0.00.00.cfg.bin.json`, `phase_set_layout_c04_0.00.00.cfg.bin.json`, `phase_set_layout_c05_0.00.00.cfg.bin.json`, `phase_set_layout_c06_0.00.00.cfg.bin.json`, `phase_set_layout_c07_0.00.00.cfg.bin.json`, `phase_set_layout_c08_0.00.00.cfg.bin.json`, `phase_set_layout_c09_0.00.00.cfg.bin.json`

### `phase/phase_title_config_0.08.56.cfg.bin.json`  _(entries=2)_
- listes : `PHASE_TITLE_TEX_INFO_LIST_BEG_0`×9, `PHASE_TITLE_CFG_LIST_BEG_0`×18
- chaînes : `#/menu/220_img/chapter_title/<LG>/chapter01.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter02.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter03.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter04.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter05.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter06.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter07.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter08.g4tx`, `#/menu/220_img/chapter_title/<LG>/chapter09.g4tx`

### Triggers `DATA_COUNT_0` / `DATA_ITEM_n`  (32 fichiers)
- Même forme : 1 entrée `DATA_COUNT_0` (Int = nombre d'items) suivie de `DATA_ITEM_0..n` (≈ 2–124 items/fichier). Données de scénario d'événement compilées par instance.
- Fichiers : `c01_trigger`, `c02_trigger`, `c03_trigger`, `c04_trigger`, `c05_trigger`, `c06_trigger`, `c07_trigger`, `c08_trigger`, `c09_trigger`, `c21_trigger`, `c95_trigger`, `c97_trigger`, `phase_set_c01_0.00.00`, `phase_set_c02_0.00.00`, `phase_set_c03_0.00.00`, `phase_set_c04_0.00.00`, `phase_set_c05_0.00.00`, `phase_set_c06_0.00.00`, `phase_set_c07_0.00.00`, `phase_set_c08_0.00.00`, `phase_set_c09_0.00.00`, `phase_set_c21_0.00.00`, `phase_set_c31_0.00.00`, `phase_set_c90_0.00.00`, `phase_set_c91_0.00.00`, `phase_set_c92_0.00.00`, `phase_set_c93_0.00.00`, `phase_set_c94_0.00.00`, `phase_set_c95_0.00.00`, `phase_set_c96_0.00.00`, `phase_set_c97_0.00.00`, `phase_set_dbg_0.00.00`

---

## character  (45 fichiers)

### `character/academic_year_config.cfg.bin.json`
- **`m_academicYearInfoList`** `ACADEMIC_YEAR_INFO` (n=3) — champs : `academicYearId` `academicYearType` `academicYearNameTextId`

### `character/add_model_config.cfg.bin.json`
- **`m_addModelDataList`** `ADD_MODEL_DATA` (n=7) — champs : `addModelType` `addModelId`
- **`m_addModelInfoList`** `ADD_MODEL_INFO` (n=7) — champs : `baseCharaId` `addModel`

### `character/basara_chara_config_0.00.00.00.cfg.bin.json`
- **`m_basaraBuildTypeList`** `BASARA_BUILD_TYPE` (n=426) — champs : `type` `boardId`
- **`m_basaraBuildInfoList`** `BASARA_BUILD_INFO` (n=71) — champs : `charaParamId` `typeInfo`

### `character/belong_team_config_0.00.00.cfg.bin.json`
- **`m_belongTeamInfoList`** `BELONG_TEAM_INFO` (n=208) — champs : `belongTeamId` `binderTeamOrderType` `teamNameTextId` `teamEmblemId_IE` `teamEmblemId_GO` `teamEmblemId_AREORI` `teamEmblemId_V` `teamNumber_IE1` `teamNumber_IE2` `teamNumber_IE3` `teamNumber_GO1` `teamNumber_GO2` `teamNumber_GO3` `teamNumber_ARES` `teamNumber_ORION` `teamNumber_V` `teamKit_IE` `teamKit_GO` `teamKit_AREORI` `teamKit_V`

### `character/chara_action.cfg.bin.json`  _(entries=2)_
- listes : `CHARA_ACTION_BASE_PATH_LIST_BEG_0`×1, `CHARA_ACTION_INFO_LIST_BEG_0`×16
- chaînes : `common/action/`, `base_act.cfg.bin`, `npc_act.cfg.bin`, `human_npc_child_act.cfg.bin`, `human_npc_lady_act.cfg.bin`, `human_npc_man_act.cfg.bin`, `yokai_base_act.cfg.bin`, `human_base_act.cfg.bin`, `x01010000_act.cfg.bin`, `x01010000.lua.bin`, `x02010000_act.cfg.bin`, `x02010000.lua.bin`, `x02020000_act.cfg.bin`, `x02020000.lua.bin`, `y00110000_act.cfg.bin`, `x22010000.lua.bin`

### `character/chara_add_desc.cfg.bin.json`
- **`m_charaDescDataList`** `CharaDescData` (n=1) — champs : `descId` `commandCond`
- **`m_charaAddDescDataList`** `CharaAddDescData` (n=1) — champs : `charaId` `descData`

### `character/chara_base_1.03.98.00.cfg.bin.json`  _(entries=2)_
- listes : `CHARA_BASE_BATTLE_LIST_BEG_0`×5887, `CHARA_BASE_INFO_LIST_BEG_0`×14420
- chaînes : `npc0010`, `npc0011`, `npc0012`, `npc0013`, `npc0014`, `npc0015`, `npc0016`, `npc0017`, `npc0018`, `npc0019`, `npc0070`, `npc0071`, `npc0072`, `npc0073`, `npc0074`, `npc0075`

### `character/chara_change_1.02.38.00.cfg.bin.json`  _(entries=1)_
- listes : `CHARA_MODE_CHANGE_LIST_BEG_0`×13

### `character/chara_cloth_change_0.00.00.cfg.bin.json`  _(entries=0)_
- _même structure (3)_ : `chara_cloth_change_0.08.74.cfg.bin.json`, `chara_cloth_change_1.00.29.cfg.bin.json`, `chara_model_preset_0.00.00.cfg.bin.json`

### `character/chara_costume_1.02.28.00.cfg.bin.json`  _(entries=3)_
- listes : `CHARA_COSTUME_MODEL_LIST_BEG_0`×576, `CHARA_COSTUME_DATA_LIST_BEG_0`×1052, `CHARA_COSTUME_INFO_LIST_BEG_0`×780

### `character/chara_details_config_0.00.00.00.cfg.bin.json`
- **`m_charaDetailsList`** `CHARA_DETAILS` (n=550) — champs : `chara_id` `personality_type` `first_person` `second_person_male` `second_person_female`
- **`m_avatarDetailsGenderList`** `AVATAR_DETAILS_GENDER` (n=46) — champs : `gender_type` `first_person` `second_person_male` `second_person_female`
- **`m_avatarDetailsList`** `AVATAR_DETAILS` (n=23) — champs : `personality_type` `gender_info`

### `character/chara_edit_1.03.75.00.cfg.bin.json`
- **`m_CharaEditRecipeInfoList`** `CHARA_EDIT_RECIPE_INFO` (n=86) — champs : `id` `type` `num` `bitNum` `category` `categoryParam` `categoryParamSub`
- **`m_CharaEditCodeInfoList`** `CHARA_EDIT_CODE_INFO` (n=64) — champs : `id` `num` `codeChar`
  - `codeChar` : `3`, `4`, `5`, `6`, `7`, `8`
- **`m_CharaEditVoiceInfoList`** `CHARA_EDIT_VOICE_INFO` (n=96) — champs : `id` `charaSeName` `itemNo` `gender` `personality` `type`
  - `charaSeName` : `scoutMAA01`, `scoutMAA02`, `scoutMAB01`, `scoutMAB02`, `scoutMAC01`, `scoutMAC02`
- **`m_CharaEditFashionInfoList`** `CHARA_EDIT_FASHION_INFO` (n=5) — champs : `id` `fashionNameCrc`
- **`m_CharaEditPersonalityInfoList`** `CHARA_EDIT_PERSONALITY_INFO` (n=24) — champs : `id` `personalityType` `performanceType` `viewTextId`
- **`m_CharaEditPresetFileInfoList`** `CHARA_EDIT_PRESET_FILE_INFO` (n=31) — champs : `id` `idString` `charaId` `viewTextId` `viewNo`
  - `idString` : `mdl_edit_avatar01`, `mdl_edit_avatar02`, `mdl_edit_avatar03`, `mdl_edit_avatar04`, `mdl_edit_avatar05`, `mdl_edit_avatar06`
- **`m_CharaEditPartsDataList`** `CHARA_EDIT_PARTS_DATA` (n=502) — champs : `id` `gender` `textureName` `resourceName1` `resourceName2` `resourceNameStr1` `resourceNameStr2` `viewNo` `itemNo`
  - `resourceNameStr1` : `preset_01_normal`, `preset_02_normal`, `preset_03_normal`, `preset_04_normal`, `preset_05_normal`, `preset_06_normal`
  - `resourceNameStr2` : `hairB001`, `hairB002`, `hairB003`, `hairB004`, `hairB005`, `hairB006`
- **`m_CharaEditPartsInfoList`** `CHARA_EDIT_PARTS_INFO` (n=20) — champs : `faceSettingType` `partsData`
- **`m_CharaEditPartsParamDataList`** `CHARA_EDIT_PARTS_PARAM_DATA` (n=218) — champs : `partsID` `paramType` `paramDefault` `paramMax` `paramMin` `resourceName` `isApplyMale` `isApplyFemale` `isApplySmall` `isApplySmallfat` `isApplyTall` `isApplyTallmuscle` `isApplyMuscle` `isApplyBig`
- **`m_CharaEditPartsParamInfoList`** `CHARA_EDIT_PARTS_PARAM_INFO` (n=8) — champs : `partsType` `partsParamData`
- **`m_CharaEditPresetDataList`** `CHARA_EDIT_PRESET_DATA` (n=2704) — champs : `recipeType` `recipeNo` `partsId` `colorValue`
- **`m_CharaEditPresetInfoList`** `CHARA_EDIT_PRESET_INFO` (n=38) — champs : `presetID` `presetData` `isApplyMale` `isApplyFemale` `isApplySmall` `isApplySmallfat` `isApplyTall` `isApplyTallmuscle` `isApplyMuscle` `isApplyBig`
- **`m_CharaEditColorDataList`** `CHARA_EDIT_COLOR_DATA` (n=470) — champs : `colorPresetID`
- **`m_CharaEditColorInfoList`** `CHARA_EDIT_COLOR_INFO` (n=8) — champs : `faceSettingType` `colorPresetData`
- **`m_CharaEditFashionBodyDataList`** `CHARA_EDIT_FASHION_BODY_DATA` (n=50) — champs : `bodyType`
- **`m_CharaEditFashionBodyInfoList`** `CHARA_EDIT_FASHION_BODY_INFO` (n=5) — champs : `id` `enableBodyType`

### `character/chara_edit_parts_type_config_1.03.75.00.cfg.bin.json`
- **`m_CharaEditFaceTypeDataList`** `CHARA_EDIT_FACE_TYPE_DATA` (n=42) — champs : `noseType` `noseTypeCrc` `facePatternID_male` `facePatternID_female` `facePatternID_small` `facePatternID_smallfat` `facePatternID_tall` `facePatternID_tallmuscle` `facePatternID_muscle` `facePatternID_big` `resource_male` `resource_female` `resource_small` `resource_smallfat` `resource_tall` `resource_tallmuscle` `resource_muscle` `resource_big`
  - `noseType` : `nose_type_01`, `nose_type_02`, `nose_type_03`, `nose_type_04`, `nose_type_05`, `nose_type_06`
  - `resource_male` : `face51_nose01`, `face51_nose02`, `face51_nose03`, `face51_nose04`, `face51_nose05`, `face51_nose06`
  - `resource_female` : `face51_nose01`, `face51_nose02`, `face51_nose03`, `face51_nose04`, `face51_nose05`, `face51_nose06`
  - `resource_small` : `face53_nose01`, `face53_nose02`, `face53_nose03`, `face53_nose04`, `face53_nose05`, `face53_nose06`
  - `resource_smallfat` : `face53_nose01`, `face53_nose02`, `face53_nose03`, `face53_nose04`, `face53_nose05`, `face53_nose06`
  - `resource_tall` : `face55_nose01`, `face55_nose02`, `face55_nose03`, `face55_nose04`, `face55_nose05`, `face55_nose06`
  - `resource_tallmuscle` : `face55_nose01`, `face55_nose02`, `face55_nose03`, `face55_nose04`, `face55_nose05`, `face55_nose06`
  - `resource_muscle` : `face56_nose01`, `face56_nose02`, `face56_nose03`, `face56_nose04`, `face56_nose05`, `face56_nose06`
  - `resource_big` : `face56_nose01`, `face56_nose02`, `face56_nose03`, `face56_nose04`, `face56_nose05`, `face56_nose06`
- **`m_CharaEditFaceTypeInfoList`** `CHARA_EDIT_FACE_TYPE_INFO` (n=6) — champs : `faceType` `faceTypeCrc` `faceTypeData`
  - `faceType` : `face_mdl_type_01`, `face_mdl_type_02`, `face_mdl_type_03`, `face_mdl_type_04`, `face_mdl_type_05`, `face_mdl_type_06`
- **`m_CharaEditPartsBodyTypeDataList`** `CHARA_EDIT_PARTS_BODY_TYPE_DATA` (n=24) — champs : `presetID` `resource_male` `resource_female` `resource_small` `resource_smallfat` `resource_tall` `resource_tallmuscle` `resource_muscle` `resource_big`
  - `resource_male` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_female` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_small` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_smallfat` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_tall` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_tallmuscle` : `accessory001`, `accessory002`, `accessory003`, `accessory004`, `accessory005`, `accessory006`
  - `resource_muscle` : `accessory001_07`, `accessory002_07`, `accessory003_07`, `accessory004_07`, `accessory005_07`, `accessory006_07`
  - `resource_big` : `accessory001_07`, `accessory002_07`, `accessory003_07`, `accessory004_07`, `accessory005_07`, `accessory006_07`
- **`m_CharaEditPartsBodyTypeInfoList`** `CHARA_EDIT_PARTS_BODY_TYPE_INFO` (n=1) — champs : `partsType` `partsTypeData`

### `character/chara_exp_table_config_0.00.00.00.cfg.bin.json`
- **`m_charaExpTableList`** `CHARA_EXP_TABLE` (n=100) — champs : `level` `needExp`
- **`m_expRarityRateList`** `EXP_RARITY_RATE` (n=9) — champs : `rarity` `rate`

### `character/chara_expression_1.00.51.cfg.bin.json`
- **`m_charaExpressionInfoList`** `CharaExpressionInfo` (n=13) — champs : `charaId` `expressionIdList`

### `character/chara_face_1.03.00.00.cfg.bin.json`  _(entries=5)_
- listes : `CHARA_FACIAL_DATA_LIST_BEG_0`×68, `CHARA_FACIAL_MOTION_INFO_LIST_BEG_0`×139, `CHARA_FACIAL_LIPSYNC_DATA_LIST_BEG_0`×19, `FACIAL_MOT_GROUP_LIST_BEG_0`×2, `CHARA_FACIAL_PRECEDE_DATA_LIST_BEG_0`×1

### `character/chara_mesh_change_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `GENERAL_LIMIT_INFO_LIST_BEG_0`×1

### `character/chara_mesh_mask_config.cfg.bin.json`  _(entries=2)_
- listes : `MESH_MASK_COND_LIST_BEG_0`×7, `MESH_MASK_INFO_LIST_BEG_0`×2

### `character/chara_mesh_type.cfg.bin.json`
- **`m_charaMeshAttrList`** `CHARA_MESH_ATTR` (n=6) — champs : `index` `tag` `attrBit`
  - `tag` : `_50`, `_51`, `_wc010`, `_wc011`, `_wc040`, `_wc041`
- **`m_charaMeshAttrIndexList`** `CHARA_MESH_ATTR_INDEX` (n=16) — champs : `index`
- **`m_charaMeshTypeList`** `CHARA_MESH_TYPE` (n=10) — champs : `id` `attrIndexList`

### `character/chara_model_1.03.49.00.cfg.bin.json`  _(entries=3)_
- listes : `CHARA_MODEL_BASE_PATH_LIST_BEG_0`×1, `CHARA_MODEL_INFO_LIST_BEG_0`×7668, `CHARA_BODY_INFO_LIST_BEG_0`×76
- chaînes : `common/chr/`, `_face/11_VICTORY/c11010017/c11010017.objbin`, `_face/11_VICTORY/c11010027/c11010027.objbin`, `_face/11_VICTORY/c11010037/c11010037.objbin`, `_face/11_VICTORY/c11010047/c11010047.objbin`, `_face/11_VICTORY/c11010057/c11010057.objbin`, `_face/11_VICTORY/c11010068/c11010068.objbin`, `_face/11_VICTORY/c11010067/c11010067.objbin`, `_face/11_VICTORY/c11010070/c11010070.g4md`, `_face/11_VICTORY/c11010079/c11010079.objbin`, `_face/11_VICTORY/c11020017/c11020017.objbin`, `_face/11_VICTORY/c11500019/c11500019.objbin`, `_face/11_VICTORY/c11010019/c11010019.objbin`, `_face/11_VICTORY/c11010029/c11010029.objbin`, `_face/11_VICTORY/c11010039/c11010039.objbin`, `_face/11_VICTORY/c11010049/c11010049.objbin`

### `character/chara_model_change_1.00.92.00.cfg.bin.json`  _(entries=2)_
- listes : `CHARA_MDL_CHANGE_DATA_LIST_BEG_0`×139, `CHARA_MDL_CHANGE_INFO_LIST_BEG_0`×150

### `character/chara_motion_1.02.91.00.cfg.bin.json`  _(entries=4)_
- listes : `CHARA_MOTION_BASE_PATH_LIST_BEG_0`×1, `CHARA_MOTION_INFO_LIST_BEG_0`×60, `CHARA_MOTION_PRESET_DATA_LIST_BEG_0`×259, `CHARA_MOTION_PRESET_INFO_LIST_BEG_0`×202
- chaînes : `common/chr/`, `c000101/c000101_p<TYPE>.g4pk`, `c000102/c000102_p<TYPE>.g4pk`, `c000111/c000111_p<TYPE>.g4pk`, `c000131/c000131_p<TYPE>.g4pk`, `c000142/c000142_p<TYPE>.g4pk`, `c000201/c000201_p<TYPE>.g4pk`, `c000202/c000202_p<TYPE>.g4pk`, `c000301/c000301_p<TYPE>.g4pk`, `c000321/c000321_p<TYPE>.g4pk`, `c000302/c000302_p<TYPE>.g4pk`, `c000401/c000401_p<TYPE>.g4pk`, `c000411/c000411_p<TYPE>.g4pk`, `c000402/c000402_p<TYPE>.g4pk`, `c000109/c000109_p<TYPE>.g4pk`, `_face/11_VICTORY/c11080500/c11080500_p<TYPE>.g4pk`

### `character/chara_name_tag_1.03.38.00.cfg.bin.json`
- **`m_charaNameTagConfigList`** `CHARA_NAME_TAG_CONFIG` (n=654) — champs : `tagId` `charaId` `overloadNameId`

### `character/chara_param_1.03.66.00.cfg.bin.json`  _(entries=1)_
- listes : `CHARA_PARAM_INFO_LIST_BEG_0`×6151

### `character/chara_param_table_config_0.00.00.00.cfg.bin.json`
- **`m_charaParamPresetTableParamList`** `CHARA_PARAM_PRESET_TABLE_DATA` (n=8) — champs : `param_min_kick` `param_min_control` `param_min_technic` `param_min_pressure` `param_min_physical` `param_min_agility` `param_min_intelligence` `param_max_kick` `param_max_control` `param_max_technic` `param_max_pressure` `param_max_physical` `param_max_agility` `param_max_intelligence` `param_max2_kick` `param_max2_control` `param_max2_technic` `param_max2_pressure` `param_max2_physical` `param_max2_agility` `param_max2_intelligence`
- **`m_charaParamPresetTableGrowTypeList`** `CHARA_PARAM_PRESET_TABLE_GROW` (n=2) — champs : `growType` `data`
- **`m_charaParamPresetTablePlayStyleList`** `CHARA_PARAM_PRESET_TABLE_PLAY` (n=1) — champs : `playStyle` `data`
- **`m_charaParamPresetTableInfoList`** `CHARA_PARAM_PRESET_TABLE_INFO` (n=1) — champs : `position` `data`
- **`m_charaParamPersonalityTableDataList`** `CHARA_PARAM_PERSONALITY_TABLE_DATA` (n=8) — champs : `param_min_kick` `param_min_control` `param_min_technic` `param_min_pressure` `param_min_physical` `param_min_agility` `param_min_intelligence` `param_max_kick` `param_max_control` `param_max_technic` `param_max_pressure` `param_max_physical` `param_max_agility` `param_max_intelligence`
- **`m_charaParamPersonalityTablePlayStyleList`** `CHARA_PARAM_PERSONALITY_TABLE_PLAYSTYLE` (n=2) — champs : `playStyle` `data`
- **`m_charaParamPersonalityTableInfoList`** `CHARA_PARAM_PERSONALITY_TABLE_INFO` (n=1) — champs : `position` `data`
- **`m_charaParamAddRateTableDataList`** `CHARA_PARAM_ADD_RATE_TABLE_DATA` (n=1) — champs : `param_kick` `param_control` `param_technic` `param_pressure` `param_physical` `param_agility` `param_intelligence`
- **`m_charaParamAddRateTablePlayStyleList`** `CHARA_PARAM_ADD_RATE_TABLE_PLAY` (n=1) — champs : `playStyle` `data`
- **`m_charaParamAddRateTableInfoList`** `CHARA_PARAM_ADD_RATE_TABLE_INFO` (n=1) — champs : `position` `data`

### `character/chara_parent_bone_sync_0.00.00.00.cfg.bin.json`
- **`m_CharaParentBoneSyncInfoList`** `CharaParentBoneSyncInfo` (n=52) — champs : `targetBoneNameCrc`

### `character/chara_parts_0.07.22.cfg.bin.json`  _(entries=13)_
- listes : `CHARA_PARTS_COLOR_LIST_BEG_0`×1116, `CHARA_PARTS_CLOTHES_BASE_PATH_LIST_BEG_0`×2, `CHARA_PARTS_CLOTHES_INFO_LIST_BEG_0`×15249, `CHARA_PARTS_CLOTHES_MODEL_LIST_BEG_0`×7100, `CHARA_PARTS_SHOES_BASE_PATH_LIST_BEG_0`×2, `CHARA_PARTS_SHOES_INFO_LIST_BEG_0`×1754, `CHARA_PARTS_SHOES_MODEL_LIST_BEG_0`×1126, `CHARA_PARTS_GLOVE_BASE_PATH_LIST_BEG_0`×2, `CHARA_PARTS_GLOVE_INFO_LIST_BEG_0`×1227, `CHARA_PARTS_GLOVE_MODEL_LIST_BEG_0`×618, `CHARA_PARTS_EXMESH_BASE_PATH_LIST_BEG_0`×2, `CHARA_PARTS_EXMESH_INFO_LIST_BEG_0`×204, `CHARA_PARTS_EXMESH_MODEL_LIST_BEG_0`×408
- chaînes : `common/chr/`, `#/chr/`, `_uniform/u11010018/u11010018.g4md`, `_uniform/u11010018/u11010018.g4tx`, `_uniform/u11010019/u11010019.g4md`, `_uniform/u11010019/u11010019.g4tx`, `_uniform/u11010029/u11010029.g4md`, `_uniform/u11010029/u11010029.g4tx`, `_uniform/u11010039/u11010039.g4md`, `_uniform/u11010039/u11010039.g4tx`, `_uniform/u11010049/u11010049.g4md`, `_uniform/u11010049/u11010049.g4tx`, `_uniform/u11010058/u11010058.g4md`, `_uniform/u11010058/u11010058.g4tx`, `_uniform/u11010059/u11010059.g4md`, `_uniform/u11010059/u11010059.g4tx`

### `character/chara_scale_0.11.12.cfg.bin.json`
- **`m_charaScaleList`** `CHARA_SCALE_INFO` (n=2700) — champs : `charaID` `field` `soccer` `menu` `menuLooksFirst` `follower` `offset` `addchara` `addchara_offset_y` `rpgBattle` `charaSize` `menuLooksVS` `addchara_offset_y_for_vs`

### `character/chara_series_config.cfg.bin.json`
- **`m_charaSeriesInfoList`** `CHARA_SERIES_INFO` (n=9) — champs : `charaSeriesId` `charaSeriesType` `charaSeriesNameTextId`

### `character/chara_texture_1.02.01.00.cfg.bin.json`  _(entries=3)_
- listes : `EX_CHARA_FACIAL_TEXTURE_RESOURCE_LIST_BEG_0`×289, `EX_CHARA_FACIAL_TEXTURE_INFO_LIST_BEG_0`×290
- chaînes : `#/chr/`, `_face/01_IE1/c01000010/c01000010_06.g4tx`, `_face/01_IE1/c01000010/c01000010_13.g4tx`, `_face/01_IE1/c01000100/c01000100_13.g4tx`, `_face/01_IE1/c01000300/c01000300_04.g4tx`, `_face/01_IE1/c01010910/c01010910_00.g4tx`, `_face/02_IE2/c02021500/c02021500_00.g4tx`, `_face/02_IE2/c02021500/c02021500_01.g4tx`, `_face/02_IE2/c02021450/c02021450_00.g4tx`, `_face/02_IE2/c02021490/c02021490_00.g4tx`, `_face/02_IE2/c02021420/c02021420_00.g4tx`, `_face/02_IE2/c02021430/c02021430_00.g4tx`, `_face/02_IE2/c02021440/c02021440_00.g4tx`, `_face/02_IE2/c02021470/c02021470_00.g4tx`, `_face/02_IE2/c02023290/c02023290_03.g4tx`, `_face/02_IE2/c02024510/c02024510_00.g4tx`

### `character/general_battle_voice_0.00.00.cfg.bin.json`
- **`m_generalBattleVoice`** `GENERAL_BATTLE_VOICE` (n=108) — champs : `voiceId` `voiceIdString`
  - `voiceIdString` : `scoutFAA01`, `scoutFAA02`, `scoutFAB01`, `scoutFAB02`, `scoutFAC01`, `scoutFAC02`

### `character/growth_table_config_0.00.00.00.cfg.bin.json`
- **`m_growthTableLv1List`** `GROWTH_TABLE_LV1` (n=36) — champs : `mainPosition` `subPosition` `playStyle` `Kc_1` `Cr_1` `Tc_1` `Pr_1` `Ps_1` `Ag_1` `It_1`
- **`m_growthTableLv30List`** `GROWTH_TABLE_LV30` (n=144) — champs : `mainPosition` `subPosition` `growthPattern` `charaRank` `Kc_30` `Cr_30` `Tc_30` `Pr_30` `Ps_30` `Ag_30` `It_30`
- **`m_growthTableMainList`** `GROWTH_TABLE_MAIN` (n=48) — champs : `mainPosition` `growthPattern` `charaRank` `Kc_50` `Cr_50` `Tc_50` `Pr_50` `Ps_50` `Ag_50` `It_50` `Kc_99` `Cr_99` `Tc_99` `Pr_99` `Ps_99` `Ag_99` `It_99`
- **`m_growthTableSubList`** `GROWTH_TABLE_SUB` (n=48) — champs : `subPosition` `growthPattern` `charaRank` `Kc_50` `Cr_50` `Tc_50` `Pr_50` `Ps_50` `Ag_50` `It_50` `Kc_99` `Cr_99` `Tc_99` `Pr_99` `Ps_99` `Ag_99` `It_99`

### `character/mob_npc_type_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `MOB_NPC_PERSONALITY_INFO_LIST_BEG_0`×1

### `character/mob_npc_type_preset_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `MOB_NPC_TYPE_PRESET_INFO_LIST_BEG_0`×12

### `character/npc_motlist_info.cfg.bin.json`
- **`m_NpcMotList`** `NPC_MOTLIST` (n=7) — champs : `groupId` `type`
- **`m_NpcMotGroupList`** `NPC_MOTGROUP_LIST` (n=4) — champs : `m_Id` `m_List`
- **`m_NpcMotion`** `NPC_MOT` (n=11) — champs : `motionId` `weight`
- **`m_NpcMotGroup`** `NPC_MOTGROUP` (n=7) — champs : `motGroupId` `motionInfo`

### `character/performance_config.cfg.bin.json`
- **`m_performanceInfoList`** `PERFORMANCE_INFO` (n=6) — champs : `performanceId` `performanceType` `performanceNameTextId`

### `character/personality_scout_phase_text_0.00.00.cfg.bin.json`
- **`m_scoutPhaseTextList`** `SCOUT_PHASE_TEXT` (n=2) — champs : `strangerText` `introductionText` `presentText` `presentBattleText` `presentCancelText` `encountText` `questClearText` `questNotClearText` `inviteText` `notInviteText` `disinviteText` `inviteAgainText` `notInviteAgainText` `strangerVoice` `strangerVoice_en` `introductionVoice` `introductionVoice_en` `presentVoice` `presentVoice_en` `presentBattleVoice` `presentBattleVoice_en` `presentCancelVoice` `presentCancelVoice_en` `encountVoice` `encountVoice_en` `questClearVoice` `questClearVoice_en` `questNotClearVoice` `questNotClearVoice_en` `inviteVoice` `inviteVoice_en` `notInviteVoice` `notInviteVoice_en` `disinviteVoice` `disinviteVoice_en` `inviteAgainVoice` `inviteAgainVoice_en` `notInviteAgainVoice` `notInviteAgainVoice_en`
- **`m_pesronalityScoutPhaseTextDataList`** `PERSONALITY_SCOUT_PHASE_TEXT_DATA` (n=15) — champs : `gender` `personality` `scoutPhaseTextList`

### `character/scout_phase_text_setting_1.03.25.cfg.bin.json`
- **`m_scoutPhaseTextList`** `SCOUT_PHASE_TEXT` (n=586) — champs : `strangerText` `introductionText` `presentText` `presentPassText` `presentBattleText` `encountText` `questClearText` `questNotClearText` `inviteText` `inviteDecideText` `notInviteText` `disinviteText` `disinviteDecideText` `inviteAgainText` `notInviteAgainText` `notInviteAgainDecideText` `strangerVoice` `strangerVoice_en` `introductionVoice` `introductionVoice_en` `presentVoice` `presentVoice_en` `presentPassVoice` `presentPassVoice_en` `presentBattleVoice` `presentBattleVoice_en` `encountVoice` `encountVoice_en` `questClearVoice` `questClearVoice_en` `questNotClearVoice` `questNotClearVoice_en` `inviteVoice` `inviteVoice_en` `inviteDecideVoice` `inviteDecideVoice_en` `notInviteVoice` `notInviteVoice_en` `disinviteVoice` `disinviteVoice_en` `disinviteDecideVoice` `disinviteDecideVoice_en` `inviteAgainVoice` `inviteAgainVoice_en` `notInviteAgainVoice` `notInviteAgainVoice_en` `inviteAgainDecideVoice` `inviteAgainDecideVoice_en` `strangerMotion` `introductionMotion` `presentMotion` `presentPassMotion` `presentBattleMotion` `encountMotion` `questClearMotion` `questNotClearMotion` `inviteMotion` `inviteDecideMotion` `notInviteMotion` `disinviteMotion` `disinviteDecideMotion` `inviteAgainMotion` `notInviteAgainMotion` `inviteAgainDecideMotion`
- **`m_scoutPhaseTextDataList`** `SCOUT_PHASE_TEXT_DATA` (n=586) — champs : `gender` `personality` `charaid` `scoutPhaseTextList`

### `character/team_passive_lot_table_config_0.00.00.cfg.bin.json`
- **`m_teamPassiveLotDataList`** `TEAM_PASSIVE_LOT_DATA` (n=653) — champs : `id` `lotWeight` `condition` `rarityEnableFlag`
- **`m_teamPassiveLotTableDataList`** `TEAM_PASSIVE_LOT_TABLE_DATA` (n=132) — champs : `id` `teamPassiveLotDataList`

### `character/uniform_config_1.03.52.00.cfg.bin.json`
- **`m_UniformModelInfoList`** `UNIFORM_MODEL_INFO` (n=760) — champs : `uniformFielderModelIdCrc` `uniformKeeperModelIdCrc` `uniformDirectorModelIdCrc` `uniformManagerModelIdCrc` `uniformFielderShoulderBaringModelIdCrc` `uniformKeeperShoulderBaringModelIdCrc` `uniformFielderShortSleeveRollUpArmModelIdCrc` `uniformKeeperShortSleeveRollUpArmModelIdCrc` `uniformFielderShoulderBaringPatternedModelIdCrc` `uniformKeeperShoulderBaringPatternedModelIdCrc` `uniformFielderHalfSleeveModelIdCrc` `uniformKeeperHalfSleeveModelIdCrc` `uniformFielderLongSleeveRollUpArmModelIdCrc` `uniformKeeperLongSleeveRollUpArmModelIdCrc` `uniformFielderLongSleeveRollUpSleeveModelIdCrc` `uniformKeeperLongSleeveRollUpSleeveModelIdCrc` `uniformFielderNavelBaringModelIdCrc` `uniformKeeperNavelBaringModelIdCrc` `shoesFielderModelIdCrc` `shoesKeeperModelIdCrc` `shoesDirectorModelIdCrc` `shoesManagerModelIdCrc` `gloveModelIdCrc` `typeId` `shoesModelAttr` `uniformNgModelAttr` `shoesModelIdLocked`
- **`m_UniformInfoList`** `UNIFORM_INFO` (n=384) — champs : `nameId` `modelInfo`
- **`m_UniformExModelInfoList`** `UNIFORM_EX_MODEL_INFO` (n=751) — champs : `uniformFielderModelIdCrc` `uniformKeeperModelIdCrc` `shoesFielderModelIdCrc` `shoesKeeperModelIdCrc` `gloveModelIdCrc` `fielderExModelId1` `keeperExModelId1` `fielderExModelId2` `keeperExModelId2` `fielderExModelId3` `keeperExModelId3` `typeId` `charaModelIdCrc` `faceIconCharaIdCrc`
- **`m_UniformExInfoList`** `UNIFORM_EX_INFO` (n=378) — champs : `nameId` `tmpFlagIdCrc` `modelInfo`
- **`m_CharaUniformExInfoList`** `CHARA_UNIFORM_EX_INFO` (n=234) — champs : `charaId` `uniformInfo`

### `character/vehicle_config.cfg.bin.json`  _(entries=2)_
- listes : `VEHICLE_PARAM_INFO_LIST_BEG_0`×7
- chaînes : `d010000`, `d010040`, `streetcar`

### `character/youguru_consume_config.cfg.bin.json`
- **`m_charaConsumeInfo`** `CHARA_CONSUME_NUM_INFO` (n=0)
- **`m_rankConsumeInfo`** `RANK_CONSUME_NUM_INFO` (n=6) — champs : `rank` `saboriRank` `personality` `slotNum` `humanChange`

---

## system  (28 fichiers)

### `system/activity_config.cfg.bin.json`  _(entries=1)_
- listes : `ACTIVITY_CONFIG_LIST_BEG_0`×13
- chaînes : `StoryMode`, `StoryMode_SubTask_01`, `StoryMode_SubTask_02`, `StoryMode_SubTask_03`, `StoryMode_SubTask_04`, `StoryMode_SubTask_05`, `StoryMode_SubTask_06`, `StoryMode_SubTask_07`, `StoryMode_SubTask_08`, `StoryMode_SubTask_09`

### `system/add_content_equip_config.cfg.bin.json`
- **`m_aocEquipConfigInfo`** `AOC_EQUIP_CONFIG_INFO` (n=22) — champs : `aocCondition` `equipID`

### `system/ai_type_config.cfg.bin.json`  _(entries=2)_
- listes : `AI_HOBY_LIST_BEG_0`×4, `AI_AI_INFO_LIST_BEG_0`×10

### `system/autosave_info_chara_limit_config.cfg.bin.json`  _(entries=1)_
- listes : `GENERAL_LIMIT_INFO_LIST_BEG_0`×1
- _même structure (7)_ : `dungeon_gimmick_limit_config_0.00.00.cfg.bin.json`, `follower_limit_config.cfg.bin.json`, `follower_set_config.cfg.bin.json`, `map_name_limit_config.cfg.bin.json`, `map_name_world_limit_config.cfg.bin.json`, `tbox_look_change_limit_config.cfg.bin.json`, `weather_time_zone_limit_config.cfg.bin.json`

### `system/behavior_trigger_common.cfg.bin.json`  _(entries=1)_
- listes : `BEHAVIOR_AI_INFO_LIST_BEG_0`×2

### `system/common_limit_config.cfg.bin.json`  _(entries=5)_
- listes : `MENU_DISCLOSURE_DATA_LIST_BEG_0`×44, `MENU_DISCLOSURE_CFG_LIST_BEG_0`×70, `GENERAL_CONDITION_DATA_LIST_BEG_0`×595, `GENERAL_CONDITION_INFO_LIST_BEG_0`×302

### `system/common_sosimen_club_config_0.00.00.cfg.bin.json`  _(entries=3)_
- listes : `COMMON_AREA_INFO_LIST_BEG_0`×30, `CONDITIONAL_VARIANT_INFO_LIST_BEG_0`×298, `CONDITIONAL_TYPE_TYPE_LIST_BEG_0`×6

### `system/cond_text_preset_config.cfg.bin.json`
- **`m_condTextPresetInfoList`** `COND_TEXT_PRESET` (n=0)

### `system/extend_story_setting.cfg.bin.json`  _(entries=3)_
- listes : `STORY_FLAG_INFO_LIST_BEG_0`×2, `NONE_ID_FLAG_INFO_LIST_BEG_0`×1, `TBOX_FLAG_INFO_LIST_BEG_0`×7

### `system/flag_config_1.03.92.00.cfg.bin.json`  _(entries=4)_
- listes : `FLAG_INFO_LIST_BEG_0`×15, `FLAG_TBOX_INFO_LIST_BEG_0`×1, `FLAG_TBOX_REPOP_INFO_LIST_BEG_0`×1, `FLAG_MAP_DOOR_INFO_LIST_BEG_0`×1

### `system/general_talk_trigger_0.00.00.cfg.bin.json`  _(entries=0)_

### `system/guide_config.cfg.bin.json`  _(entries=1)_
- entrées : `GUIDE_INFO_LIST_BEG_0`

### `system/happen_event_npc_common.cfg.bin.json`
- **`m_EventWeaponInfo`** `NPC_EVENT_WEAPON_INFO` (n=24) — champs : `weapon_id` `weight`
- **`m_EventWeaponAnotherInfo`** `NPC_EVENT_WEAPON_INFO` (n=24) — champs : `weapon_id` `weight`
- **`m_EventAimedInfo`** `NPC_EVENT_AIMDE_INFO` (n=14) — champs : `npc_type_id` `on_loop_mot_id` `face_id` `ow_charaparam_id` `weapon_info` `on_loop_npc_act_type` `is_not_battle_in`
- **`m_EventCommonInfo`** `HAPPEN_EVENT_NPC_COMMON_INFO` (n=15) — champs : `event_id` `event_type` `limit_num` `recast_max` `recast_min` `nice_point_max` `nice_point_min` `event_name_text_id` `on_loop_mot_id` `face_id` `ow_charaparam_id` `aimed_info` `weapon_info` `on_loop_npc_act_type` `cond` `y_times_text_id`

### `system/level_limit_config_0.00.00.00.cfg.bin.json`
- **`m_LevelLimitInfoList`** `LEVEL_LIMIT_DATA` (n=2) — champs : `id` `level` `cond`
- **`m_RareLimitInfoList`** `RARE_LIMIT_DATA` (n=2) — champs : `id` `rarity` `cond` `for_story`

### `system/naviwan_int_type.cfg.bin.json`
- **`m_NaviwanIntTypeList`** `NAVIWAN_INT_TYPE` (n=2) — champs : `m_ID` `m_Priority` `m_DiffOnArrive` `m_DiffOnStep` `m_ActType`

### `system/safe_pos_setting.cfg.bin.json`  _(entries=1)_
- listes : `SAFE_POS_INFO_LIST_BEG_0`×202

### `system/situation_talk_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `TALK_TALK_ID_LIST_BEG_0`×1184

### `system/system_unlock_window_config_0.00.00.00.cfg.bin.json`
- **`m_systemUnlockWindowInfoList`** `SYSTEM_UNLOCK_WINDOW_INFO` (n=98) — champs : `textId` `tagTypeId` `replaceId` `gaijiIconCrc`
- **`m_systemUnlockWindowSetDataList`** `SYSTEM_UNLOCK_WINDOW_SET_DATA` (n=26) — champs : `systemUnlockWindowIdCrc` `systemUnlockWindowInfoList`

### `system/talk_select_config.cfg_1.01.41.00.cfg.bin.json`
- **`m_TalkSelectConfigList`** `TALK_SELECT_CONFIG` (n=9) — champs : `id` `textId` `type` `cursorInitPos` `cursorCancelPos` `specifyTalkCharaId` `additionalDispMenuNameCrc` `afterDecisionParam`

### `system/trial_take_over_config.cfg.bin.json`
- **`m_trialTakeOverInfoList`** `TRIAL_TAKE_OVER_INFO` (n=5) — champs : `id` `flagNo` `itemId` `condition`
- **`m_trialPartTakeOverInfoList`** `TRIAL_PART_TAKE_OVER_INFO` (n=9) — champs : `id` `flagNo`

### Triggers `DATA_COUNT_0` / `DATA_ITEM_n`  (1 fichiers)
- Même forme : 1 entrée `DATA_COUNT_0` (Int = nombre d'items) suivie de `DATA_ITEM_0..n` (≈ 140–140 items/fichier). Données de scénario d'événement compilées par instance.
- Fichiers : `common_trigger`

---

## rpg_battle  (27 fichiers)

### `rpg_battle/ai/rpg_battle_ai_condition_config_0.08.96.cfg.bin.json`
- **`m_RpgBattleAiCondInfoList`** `RPG_BTL_AI_COND_INFO` (n=38) — champs : `condId` `runCond`

### `rpg_battle/ai/rpg_battle_ai_config_0.08.85.cfg.bin.json`
- **`m_RpgBattleAiPhaseJumpInfoList`** `RPG_BTL_AI_PHASE_JUMP_INFO` (n=7) — champs : `jumpNo` `condId1` `condId2` `condId3`
- **`m_RpgBattleAiPhaseAiInfoList`** `RPG_BTL_AI_PHASE_AI_INFO` (n=14) — champs : `aiId` `phaseNo` `jumpInfo`
- **`m_RpgBattleAiPhaseInfoList`** `RPG_BTL_AI_PHASE_INFO` (n=10) — champs : `aiPhaseId` `phaseInfo`
- **`m_RpgBattleAiCmdInfoList`** `RPG_BTL_AI_CMD_INFO` (n=55) — champs : `cmdId` `aiCmdAttr` `groupNo` `runNo` `priority` `jumpNo` `weight` `turnRecast` `enableRunNum` `condId1` `condId2` `condId3`
- **`m_RpgBattleAiInfoList`** `RPG_BTL_AI_INFO` (n=16) — champs : `aiId` `cmdInfo`

### `rpg_battle/rpg_battle_add_status_config_0.00.00.cfg.bin.json`  _(entries=2)_
- listes : `RPG_BTL_ADD_STATUS_TYPE_INFO_LIST_BEG_0`×11, `RPG_BTL_ADD_STATUS_INFO_LIST_BEG_0`×7

### `rpg_battle/rpg_battle_chara_swap_motion_config_1.04.06.00.cfg.bin.json`
- **`m_SwapMotionDataList`** `SWAP_MOTION_DATA` (n=10) — champs : `bodyType` `motionId`
- **`m_RpgBattleCharaSwapMotionDataList`** `RPG_BATTLE_CHARA_SWAP_MOTION_DATA` (n=2) — champs : `modelAttribute` `openCond` `swapMotion`

### `rpg_battle/rpg_battle_cmd_config_1.02.82.00.cfg.bin.json`  _(entries=3)_
- listes : `RPG_BTL_SP_EFF_INFO_LIST_BEG_0`×2, `RPG_BTL_CMD_HIT_RESULT_INFO_LIST_BEG_0`×1144, `RPG_BTL_CMD_INFO_LIST_BEG_0`×3127
- chaînes : `c11010010_0031`, `c11010010_0032`, `c11010020_0031`, `c11010020_0032`, `c11010050_0031`, `c11010050_0032`, `<CHARA_ID>_0003`, `<CHARA_ID>_0004`, `c11010010_0012`, `Unmei_part0034`, `c11010010_0019`, `c11010020_0029`, `c11010020_0028`, `c11010020_0038`, `c11010050_0027`, `c11010060_0034`

### `rpg_battle/rpg_battle_cmd_event_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `RPG_BTL_CMD_EVENT_INFO_LIST_BEG_0`×1

### `rpg_battle/rpg_battle_cmd_obj_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `RPG_BTL_CMD_OBJ_INFO_LIST_BEG_0`×1

### `rpg_battle/rpg_battle_cmd_set_config_1.01.31.00.cfg.bin.json`  _(entries=2)_
- listes : `RPG_BTL_CMD_SET_CMD_DATA_LIST_BEG_0`×1128, `RPG_BTL_CMD_SET_INFO_LIST_BEG_0`×375

### `rpg_battle/rpg_battle_dance_battle_config_1.01.78.00.cfg.bin.json`  _(entries=5)_
- listes : `NOTES_DATA_LIST_BEG_0`×210, `NOTES_INFO_LIST_BEG_0`×24, `DANCE_NOTES_LIST_BEG_0`×12, `DANCE_TURN_LIST_BEG_0`×24, `DANCE_INFO_LIST_BEG_0`×12

### `rpg_battle/rpg_battle_dribble_training_config_1.02.85.00.cfg.bin.json`  _(entries=4)_
- listes : `RPG_DRIBBLE_BATTLE_NOTE_LIST_BEG_0`×5, `RPG_DRIBBLE_BATTLE_INFO_LIST_BEG_0`×10, `RPG_DRIBBLE_BATTLE_NOTE_POSITION_POSITION_LIST_BEG_0`×20, `RPG_DRIBBLE_BATTLE_NOTE_POSITION_INFO_LIST_BEG_0`×2

### `rpg_battle/rpg_battle_food_config_1.02.98.00.cfg.bin.json`  _(entries=6)_
- listes : `BODY_TYPE_INFO_LIST_BEG_0`×8, `FOOD_CHARA_OFFSET_PARAM_LIST_BEG_0`×96, `FOOD_CHARA_MOT_EFFECT_OFFSET_LIST_BEG_0`×192, `FOOD_CHARA_INFO_LIST_BEG_0`×32, `OFFSET_PARAM_OFFSET_LIST_BEG_0`×68, `OFFSET_PARAM_INFO_LIST_BEG_0`×68

### `rpg_battle/rpg_battle_formation_config_1.02.21.00.cfg.bin.json`  _(entries=2)_
- listes : `RPG_BTL_FORMATION_PLACEMENT_DATA_LIST_BEG_0`×233, `RPG_BTL_FORMATION_INFO_LIST_BEG_0`×88

### `rpg_battle/rpg_battle_lifting_training_config.cfg.bin.json`
- **`m_LiftingSmartphoneInfoList`** `LIFTING_SMARTPHONE_INFO` (n=33) — champs : `chara_id_crc` `smartphone_mdl_id_crc`

### `rpg_battle/rpg_battle_message_config_1.00.11.cfg.bin.json`
- **`m_btlMsgSubInfoList`** `RPG_BTL_MSG_SUBINFO` (n=289) — champs : `subId` `isRight` `waitNext` `waitStart` `waitEnd` `condition`
- **`m_btlMsgTextList`** `RPG_BTL_MSG_TEXT` (n=289) — champs : `messageId` `subinfo`
- **`m_btlMsgTextGroupList`** `RPG_BTL_MSG_TEXT_GROUP` (n=150) — champs : `idx` `condition` `textInfo`
- **`m_btlMsgInfoList`** `RPG_BTL_MSG_INFO` (n=148) — champs : `btlMsgId` `textGroupInfo` `waitSound`

### `rpg_battle/rpg_battle_party_config_0.00.00.cfg.bin.json`  _(entries=2)_
- listes : `RPG_BTL_PARTY_DISABLE_ACTION_UNIQUE_INFO_LIST_BEG_0`×4, `RPG_BTL_PARTY_INFO_LIST_BEG_0`×20

### `rpg_battle/rpg_battle_reaction_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `RPG_BTL_REACTION_INFO_LIST_BEG_0`×31

### `rpg_battle/rpg_battle_result_config_.cfg.bin.json`
- **`m_btlResultDataInfoList`** `RPG_BTL_RESULT_DATA_INFO` (n=285) — champs : `resultId` `probability` `isLose` `partyNum`
- **`m_btlResultInfoList`** `RPG_BTL_RESULT_INFO` (n=27) — champs : `battleId` `resultInfo`

### `rpg_battle/rpg_battle_result_config_1.00.08.cfg.bin.json`  _(entries=5)_
- listes : `RPG_BTL_RESULT_WIN_DATA_INFO_ASSIGN_MEMBER_INFO_LIST_BEG_0`×4, `RPG_BTL_RESULT_LOSE_DATA_INFO_ASSIGN_MEMBER_INFO_LIST_BEG_0`×4, `RPG_BTL_RESULT_WIN_DATA_INFO_LIST_BEG_0`×632, `RPG_BTL_RESULT_LOSE_DATA_INFO_LIST_BEG_0`×166, `RPG_BTL_RESULT_INFO_LIST_BEG_0`×144

### `rpg_battle/rpg_battle_rule_config_1.02.84.00.cfg.bin.json`
- **`m_StartRuleList`** `RpgBattleStartRuleInfo` (n=2) — champs : `type` `param` `trg` `paramId`
- **`m_BattleRuleList`** `RpgBattleRuleInfo` (n=13) — champs : `ruleId` `start` `end` `result`

### `rpg_battle/rpg_battle_scramble_config_1.02.50.cfg.bin.json`  _(entries=12)_
- listes : `RPG_BTL_SCRAMBLE_MOTION_TABLE_COND_CHARA_INFO_LIST_BEG_0`×3, `RPG_BTL_SCRAMBLE_MOTION_TABLE_MOVE_MOTION_INFO_LIST_BEG_0`×84, `RPG_BTL_SCRAMBLE_MOTION_TABLE_MIRACLE_SLIDE_MOVE_MOTION_INFO_LIST_BEG_0`×28, `RPG_BTL_SCRAMBLE_MOTION_TABLE_MIRACLE_SLIDE_DAMAGE_MOVE_MOTION_INFO_LIST_BEG_0`×56, `RPG_BTL_SCRAMBLE_MOTION_TABLE_INFO_LIST_BEG_0`×35, `RPG_BTL_SCRAMBLE_MOTION_EX_PARAM_CORE_COND_MOTION_INFO_LIST_BEG_0`×12, `RPG_BTL_SCRAMBLE_MOTION_EX_PARAM_CORE_INFO_LIST_BEG_0`×14, `RPG_BTL_SCRAMBLE_MOTION_EX_PARAM_INFO_LIST_BEG_0`×4, `RPG_BTL_SCRAMBLE_COMPETITION_POS_COND_CHARA_BODY_TYPE_LIST_BEG_0`×10, `RPG_BTL_SCRAMBLE_COMPETITION_POS_INFO_LIST_BEG_0`×4, `RPG_BTL_SCRAMBLE_CAMERA_OVERWRITE_COND_CHARA_INFO_LIST_BEG_0`×16, `RPG_BTL_SCRAMBLE_CAMERA_OVERWRITE_INFO_LIST_BEG_0`×32

### `rpg_battle/rpg_battle_sled_dash_training_config_1.03.73.00.cfg.bin.json`
- **`m_SledDashSpeedDataList`** `SLED_DASH_SPEED_DATA` (n=30) — champs : `speedPoint` `inputKeyInterval` `successSpeedPoint` `failedSpeedPoint`

### `rpg_battle/rpg_battle_special_training_config_1.04.08.00.cfg.bin.json`  _(entries=29)_
- listes : `RPG_SP_TRAINING_TYPE_LIST_BEG_0`×13, `TRAINING_BGM_INFO_LIST_BEG_0`×19, `PRACTICE_MATCH_BGM_INFO_LIST_BEG_0`×19, `TRAINING_DIFFICULTY_LEVEL_INFO_LIST_BEG_0`×41, `TRAINING_PARAM_CHARA_LIST_BEG_0`×64, `TRAINING_PARAM_MANAGER_LIST_BEG_0`×3, `TRAINING_PARAM_SWAP_COMMAND_LIST_BEG_0`×5, `TRAINING_PARAM_BORDER_LIST_BEG_0`×9, `TRAINING_PARAM_INFO_LIST_BEG_0`×60, `TRAINING_CAMERA_SCHEDULE_CAM_LIST_BEG_0`×30, `TRAINING_CAMERA_SCHEDULE_INFO_LIST_BEG_0`×36, `CHARA_CHASE_CAMERA_CAM_LIST_BEG_0`×15, `CHARA_CHASE_CAMERA_INFO_LIST_BEG_0`×18, `TRAINING_MODEL_CHARA_MOT_LIST_BEG_0`×72, `TRAINING_MODEL_SYNC_MODEL_LIST_BEG_0`×16, `TRAINING_MODEL_SYNC_MODEL_MOT_LIST_BEG_0`×918, `TRAINING_MODEL_BODY_TYPE_LIST_BEG_0`×144, `TRAINING_MODEL_INFO_LIST_BEG_0`×20, `TRAINING_MOB_SYNC_MODEL_LIST_BEG_0`×242, `TRAINING_MOB_CHARA_LIST_BEG_0`×204, `TRAINING_MOB_INFO_LIST_BEG_0`×8, `FOOD_TRAINING_MOTIONS_LIST_BEG_0`×16, `FOOD_TRAINING_INFO_LIST_BEG_0`×12, `FOOD_MODEL_EFFECT_CMD_EFF_MOTION_LIST_BEG_0`×6, `FOOD_MODEL_EFFECT_STANDARD_EFF_MOTION_LIST_BEG_0`×9, `FOOD_MODEL_EFFECT_EFFECT_LIST_BEG_0`×9, `FOOD_MODEL_EFFECT_INFO_LIST_BEG_0`×6, `MANAGER_CHARA_MOT_LIST_BEG_0`×4, `MANAGER_CHARA_INFO_LIST_BEG_0`×8

### `rpg_battle/rpg_battle_stairs_race_training_config_1.03.84.00.cfg.bin.json`
- **`m_StairsRaceRunStyleDataList`** `STAIRS_RACE_RUN_STYLE_DATA` (n=3) — champs : `runStyleType` `textId` `landingMotionId` `landingSpeed` `landingStepScale` `landingStamina` `landingSpeedIndicator` `upMotionId` `upSpeed` `upStepScale` `upStamina` `upSpeedIndicator` `downMotionId` `downSpeed` `downStepScale` `downStamina` `downSpeedIndicator`

### `rpg_battle/rpg_battle_status_pattern_config_1.03.17.00.cfg.bin.json`
- **`m_statusPatternInfoList`** `RPG_BTL_STATUS_PATTERN_INFO` (n=28) — champs : `id` `hpAddRate` `attackAdd` `defenseAdd`

### `rpg_battle/rpg_battle_tire_training_config_1.03.51.00.cfg.bin.json`  _(entries=5)_
- listes : `TIRE_RATE_LIST_BEG_0`×30, `TIRE_INFO_LIST_BEG_0`×10, `TIRE_TRAINING_SHOOT_LIST_BEG_0`×7, `TIRE_TRAINING_TIRE_LIST_BEG_0`×38, `TIRE_TRAINING_INFO_LIST_BEG_0`×21

### `rpg_battle/rpg_battle_voice_config_0.00.00.cfg.bin.json`
- **`m_rpgBtlVoiceDataList`** `RPG_BTL_VOICE_DATA` (n=106) — champs : `voiceId` `charaId`
- **`m_rpgBtlVoiceSetList`** `RPG_BTL_VOICE_SET` (n=18) — champs : `id` `data`

### `rpg_battle/rpg_battle_zigzagdribble_training_config_1.03.96.00.cfg.bin.json`
- **`m_EnemyInfoList`** `RpgBattleZigzagDribbleTrainingEnemyInfo` (n=10) — champs : `enemyId` `colorMotName` `moveSpeed` `perceptionRadius` `behaviorType`
- **`m_TrainingInfoIdList`** `RpgBattleZigzagDribbleTrainingInfoId` (n=12) — champs : `trainingId`
- **`m_RuleInfoList`** `RpgBattleZigzagDribbleTrainingRuleInfo` (n=4) — champs : `ruleId` `trainingInfoIdRef`
- **`m_EnemyPlaceInfoList`** `RpgBattleZigzagDribbleTrainingEnemyPlaceInfo` (n=69) — champs : `enemySetId` `offsetPos` `rotateY`
- **`m_CheckPointInfoList`** `RpgBattleZigzagDribbleTrainingCheckPointInfo` (n=66) — champs : `pos` `enemyPlaceRef`
- **`m_TrainingInfoList`** `RpgBattleZigzagDribbleTrainingInfo` (n=12) — champs : `trainingId` `charaInitPos` `damageRate` `checkPointRef`
- **`m_EnemySetPartInfoList`** `RpgBattleZigzagDribbleTrainingEnemySetPartInfo` (n=234) — champs : `enemyId` `offsetPos`
- **`m_EnemySetInfoList`** `RpgBattleZigzagDribbleTrainingEnemySetInfo` (n=60) — champs : `enemySetId` `partRef`

---

## skill  (24 fichiers)

### `skill/ability_learning_config_1.03.63.00.cfg.bin.json`  _(entries=7)_
- listes : `ABILITY_LEARNING_TYPE_INFO_LIST_BEG_0`×72, `ABILITY_LEARNING_SHAPE_TABLE_INFO_LIST_BEG_0`×39, `ABILITY_LEARNING_LOCK_LEVEL_INFO_LIST_BEG_0`×19, `ABILITY_LEARNING_BEANS_INFO_LIST_BEG_0`×5, `ABILITY_LEARNING_LOT_PASSIVE_LV_INFO_LIST_BEG_0`×5, `ABILITY_LEARNING_BOARD_EFFECT_LIST_BEG_0`×23790, `ABILITY_LEARNING_BOARD_INFO_LIST_BEG_0`×1757

### `skill/aura_skill_config_1.04.09.00.cfg.bin.json`  _(entries=4)_
- listes : `AURA_CMD_UNIQUE_EFFECT_LIST_BEG_0`×213, `AURA_CMD_EFFECT_LIST_BEG_0`×1785, `AURA_CMD_CHARA_LIST_BEG_0`×214, `AURA_CMD_INFO_LIST_BEG_0`×1548
- chaînes : `wks00020`, `wks00030`, `wks00040`, `wks00050`, `wks00080`, `wks00100`, `wks00120`, `wks00130`, `wks00140`, `wks00190`, `wks00220`, `wks00240`, `wks00280`, `wks00290`, `wks00300`, `wks00310`

### `skill/change_aura_skill_config_1.01.73.00.cfg.bin.json`
- **`m_ChangeAuraSkillDataList`** `CHANGE_AURA_SKILL_DATA` (n=165) — champs : `id` `charaParamId`
- **`m_ChangeAuraSkillInfoList`** `CHANGE_AURA_SKILL_INFO` (n=76) — champs : `id` `data`

### `skill/override_skill_config_3.00.21.00.cfg.bin.json`
- **`m_OverrideConditionSkillInfoList`** `OverrideConditionSkillInfo` (n=61) — champs : `skillId` `num`
- **`m_OverrideConditionInfoList`** `OverrideConditionInfo` (n=33) — champs : `conditionType` `refConditionSkillData`
- **`m_OverrideSkillInfoList`** `OverrideSkillInfo` (n=33) — champs : `overrideSkillId` `refConditionData`

### `skill/passive_skill_config_0.08.86.cfg.bin.json`  _(entries=3)_
- listes : `PASSIVE_SKILL_EFFECT_LIST_BEG_0`×1679, `PASSIVE_SKILL_BUFF_ICON_LIST_BEG_0`×114, `PASSIVE_SKILL_INFO_LIST_BEG_0`×5085
- _même structure (1)_ : `passive_skill_config_5.00.07.00.cfg.bin.json`

### `skill/passive_skill_effect_config.cfg.bin.json`
- **`m_soccerPassiveSkillEffectRangeList`** `ScPassiveSkillEffectRange` (n=1) — champs : `rangeType`
- **`m_soccerPassiveSkillEffectList`** `ScPassiveSkillEffect` (n=8) — champs : `effectId` `effectParam1` `effectParam2` `effectParam3` `effectParam4` `effectParam5` `effectParam6` `effectParam7` `effectParam8`
- **`m_soccerPassiveSkillEffectInfoList`** `ScPassiveSkillEffectInfo` (n=5) — champs : `id` `range` `effect`

### `skill/passive_skill_rarity_table_config_4.00.14.00.cfg.bin.json`
- **`m_passiveSkillRarityTableList`** `PASSIVE_SKILL_RARITY_TABLE` (n=453) — champs : `idList`

### `skill/real_skill_config_1.03.74.00.cfg.bin.json`
- **`m_RealSkillShootCourseInfoList`** `RealSkillShootCourseInfo` (n=6) — champs : `targetRate` `isGroundTarget` `targetHeightOffset` `targetHoriOffset` `curveRate` `curveHeightRate` `curveAngle` `moveTimeRate`
- **`m_RealSkillInfoList`** `RealSkillInfo` (n=19) — champs : `id` `loseType` `formationType` `formationCharaLen` `shootLimitBallHeightAttr` `shootGroundingEffectName` `shootGroundingEffectIntervalTime` `shootGroundingEffectScale` `shootGroundingEffectScatteringPos` `shootCourseInfoRef`

### `skill/skill_by_event_id_config_1.02.21.cfg.bin.json`
- **`m_skillByEventIdList`** `SkillByEventId` (n=1001) — champs : `eventId` `skillId`
- **`m_skillByEventIdFailList`** `SkillByEventIdFail` (n=1001) — champs : `eventId` `skillId`

### `skill/skill_config_4.00.17.00.cfg.bin.json`
- **`m_skillOptionInfoList`** `SKILL_OPTION_INFO` (n=4) — champs : `optionId` `isMiddleBattle` `isCloseBattle` `isTechnic`
- **`m_skillInfoList`** `SKILL_INFO` (n=2627) — champs : `skillID` `skillIDStr` `eventID` `eventIDName` `failEventID` `failEventIDName` `skillNameId` `skillDescId` `cmdOptIdx` `skillEffectBitFlag` `power_min` `power_max` `element` `colorIdx` `category` `growthType` `foulRate` `consumeTp` `focusBattleEffectId` `recastTime` `partnerType` `partner1` `partner2` `partner3` `telopInfoId` `eldorado` `seriesIdCrc` `isDisablePlayableUntilNextPatch`
  - `skillIDStr` : `whs00010`, `whs00020`, `whs00030`, `whs00040`, `whs00050`, `whs00060`
  - `eventIDName` : `ev60_00010`, `ev60_00020`, `ev60_00030`, `ev60_00040`, `ev60_00050`, `ev60_00060`
  - `failEventIDName` : `ev62_00010_2`, `ev62_00110_2`, `ev62_00130_2`, `ev62_00190_2`, `ev62_00230_2`, `ev62_00270_2`
- **`m_btlCmdInfoList`** `BTL_CMD_INFO` (n=12) — champs : `btlCmdID` `eventID` `eventIDName` `failEventID` `failEventIDName` `skillNameId` `skillDescId` `cmdOptIdx` `power` `category` `foulRate`
- **`m_skillColorInfoList`** `SKILL_COLOR_INFO` (n=10) — champs : `colorIdx` `gradationX` `effectTag` `skillShootEffStatus` `skillShootChainEffStatus` `skillLongShootEffStatus`
  - `effectTag` : `01`, `02`, `03`, `04`, `05`
- **`m_skillExConditionList`** `SKILL_EX_CONDITION` (n=589) — champs : `condGameId` `condTeamId` `condExeId` `chainOverrideCondSkill` `condGameAttr` `isAnimationSetting`
- **`m_skillExSettingList`** `SKILL_EX_SETTING` (n=589) — champs : `exeId` `partnerId1` `partnerId2` `partnerId3` `modelChangeId` `condExeId` `exeSetSkill` `partnerSetSkill1` `partnerSetSkill2` `partnerSetSkill3` `exeType` `partnerType1` `partnerType2` `partnerType3` `exePreferentialPos` `partnerPreferentialPos1` `partnerPreferentialPos2` `partnerPreferentialPos3` `exeBodyType1` `partnerBodyType1_1` `partnerBodyType1_2` `partnerBodyType1_3` `exeBodyType2` `partnerBodyType2_1` `partnerBodyType2_2` `partnerBodyType2_3` `priority`
- **`m_skillExInfoList`** `SKILL_EX_INFO` (n=151) — champs : `id` `cond` `setting`
- **`m_sameCharaDataList`** `SAME_CHARA_DATA` (n=130) — champs : `same_charaId`
- **`m_sameCharaInfoList`** `SAME_CHARA_INFO` (n=74) — champs : `charaId` `data`
- **`m_skillSpVoiceConditionList`** `SKILL_SP_VOICE_CONDITION` (n=89) — champs : `charaId`
- **`m_skillSpVoiceInfoList`** `SKILL_SP_VOICE_INFO` (n=12) — champs : `id` `cond`

### `skill/skill_config_5.00.07.00.cfg.bin.json`
- **`m_skillOptionInfoList`** `SKILL_OPTION_INFO` (n=4) — champs : `optionId` `isMiddleBattle` `isCloseBattle` `isTechnic`
- **`m_skillInfoList`** `SKILL_INFO` (n=1001) — champs : `skillID` `skillIDStr` `eventID` `eventIDName` `failEventID` `failEventIDName` `skillNameId` `skillDescId` `cmdOptIdx` `skillEffectBitFlag` `power_min` `power_max` `element` `colorIdx` `category` `growthType` `foulRate` `consumeTp` `recastTime` `partnerType` `partner1` `partner2` `partner3` `telopInfoId` `eldorado` `seriesIdCrc` `isDisablePlayableUntilNextPatch`
  - `skillIDStr` : `whs00010`, `whs00020`, `whs00030`, `whs00040`, `whs00050`, `whs00060`
  - `eventIDName` : `ev60_00010`, `ev60_00020`, `ev60_00030`, `ev60_00040`, `ev60_00050`, `ev60_00060`
  - `failEventIDName` : `ev62_00010_2`, `ev62_00110_2`, `ev62_00130_2`, `ev62_00190_2`, `ev62_00230_2`, `ev62_00270_2`
- **`m_skillColorInfoList`** `SKILL_COLOR_INFO` (n=10) — champs : `colorIdx` `gradationX` `effectTag` `skillShootEffStatus` `skillShootChainEffStatus` `skillLongShootEffStatus`
  - `effectTag` : `01`, `02`, `03`, `04`, `05`
- **`m_skillExConditionList`** `SKILL_EX_CONDITION` (n=671) — champs : `condGameId` `condTeamId` `condExeId` `chainOverrideCondSkill` `condGameAttr` `isAnimationSetting`
- **`m_skillExSettingList`** `SKILL_EX_SETTING` (n=671) — champs : `exeId` `partnerId1` `partnerId2` `partnerId3` `modelChangeId` `condExeId` `exeSetSkill` `partnerSetSkill1` `partnerSetSkill2` `partnerSetSkill3` `exeType` `partnerType1` `partnerType2` `partnerType3` `exePreferentialPos` `partnerPreferentialPos1` `partnerPreferentialPos2` `partnerPreferentialPos3` `exeBodyType1` `partnerBodyType1_1` `partnerBodyType1_2` `partnerBodyType1_3` `exeBodyType2` `partnerBodyType2_1` `partnerBodyType2_2` `partnerBodyType2_3` `priority`
- **`m_skillExInfoList`** `SKILL_EX_INFO` (n=172) — champs : `id` `cond` `setting`
- **`m_sameCharaDataList`** `SAME_CHARA_DATA` (n=130) — champs : `same_charaId`
- **`m_sameCharaInfoList`** `SAME_CHARA_INFO` (n=74) — champs : `charaId` `data`
- **`m_skillSpVoiceConditionList`** `SKILL_SP_VOICE_CONDITION` (n=173) — champs : `charaId`
- **`m_skillSpVoiceInfoList`** `SKILL_SP_VOICE_INFO` (n=13) — champs : `id` `cond`

### `skill/skill_info_replace_config_0.00.00.00.cfg.bin.json`
- **`m_SkillInfoReplaceDataList`** `SkillInfoReplaceData` (n=16) — champs : `condSkillId` `condGameId` `skillEventId` `failSkillEventId` `skillColorIdx`
- **`m_SkillInfoReplaceList`** `SkillInfoReplace` (n=8) — champs : `charaParamId` `dataRef`
- **`m_SkillGoalEventReplaceDataList`** `SkillGoalEventReplaceData` (n=9) — champs : `condSkillId` `condGameId` `goalEventId`
- **`m_SkillGoalEventReplaceList`** `SkillGoalEventReplace` (n=4) — champs : `charaParamId` `dataRef`

### `skill/skill_technic_config_0.00.00.cfg.bin.json`
- **`m_SkillTechnicInfoList`** `SkillTechnicInfo` (n=6) — champs : `id` `winCommandId` `winSubCommandId` `loseCommandId` `loseSubCommandId` `formationType` `formationCharaLen`
- _même structure (4)_ : `skill_technic_config_1.01.28.00.cfg.bin.json`, `skill_technic_config_1.01.29.00.cfg.bin.json`, `skill_technic_config_1.01.31.00.cfg.bin.json`, `skill_technic_config_1.01.34.00.cfg.bin.json`

### `skill/skill_telop_info_config_.cfg.bin.json`
- **`m_blankSizeInfoList`** `BlankSizeInfo` (n=117) — champs : `ja_left` `ja_right` `en_left` `en_right` `pt_left` `pt_right` `fr_left` `fr_right` `it_left` `it_right` `de_left` `de_right` `es_left` `es_right` `zh_hant_left` `zh_hant_right` `zh_hans_left` `zh_hans_right`
- **`m_skillTelopInfoList`** `SkillTelopInfo` (n=117) — champs : `id` `blankSizeInfo`
- _même structure (1)_ : `skill_telop_info_config_0.00.00.cfg.bin.json`

### `skill/special_tactics_config_1.04.09.10.cfg.bin.json`  _(entries=4)_
- listes : `SPECIAL_TACTICS_EFFECT_LIST_BEG_0`×187, `SPECIAL_TACTICS_COND_ID_LIST_BEG_0`×126, `SPECIAL_TACTICS_SUCCESS_COND_ID_LIST_BEG_0`×2, `SPECIAL_TACTICS_INFO_LIST_BEG_0`×340
- chaînes : `wht10010`, `wht10020`, `wht10030`, `wht10040`, `wht10050`, `wht10060`, `wht10070`, `wht10080`, `wht10090`, `wht20010`, `wht20020`, `wht20040`, `wht20050`, `wht20060`, `wht20070`, `wht20070_st0801`

### `skill/super_tactics_config_0.08.86.cfg.bin.json`  _(entries=2)_
- listes : `SUPER_TACTICS_EFFECT_LIST_BEG_0`×11, `SUPER_TACTICS_INFO_LIST_BEG_0`×12

### `skill/team_build_config_5.00.23.cfg.bin.json`  _(entries=5)_
- listes : `TEAM_BUILD_EFFECT_DATA_LIST_BEG_0`×35, `TEAM_BUILD_EFFECT_INFO_LIST_BEG_0`×60, `TEAM_BUILD_UP_DATA_LIST_BEG_0`×9, `TEAM_BUILD_DOWN_DATA_LIST_BEG_0`×6, `TEAM_BUILD_INFO_LIST_BEG_0`×24

### `skill/trick_config.cfg.bin.json`
- **`m_trickInfoList`** `TRICK_INFO` (n=9) — champs : `trickID` `trickIDName` `eventID` `eventIDName` `failEventID` `failEventIDName` `trickName` `trickCategory`
  - `trickIDName` : `whs0010`, `whs0110`, `who0010`, `who0020`, `whd0010`, `whd0050`
  - `eventIDName` : `ev60_0010`, `ev60_0110`, `ev61_0010`, `ev61_0020`, `ev62_0010_1`, `ev62_0050`
  - `failEventIDName` : `ev62_0010_2`, `ev63_0010_2`, `ev63_0020_2`, `ev63_0030_2`
  - `trickName` : `ファイアトルネード`, `シャイニングバード（アレス）`, `そよかぜステップ`, `イナビカリダッシュ（アレス）`, `旋風陣`, `ザ・ミスト`

---

## chat_emote  (6 fichiers)

### `chat_emote/chat_emote_config_0.00.00.cfg.bin.json`
- **`m_ChatEmoteInfoList`** `CHAT_EMOTE_CONFIG` (n=8) — champs : `id` `sort_id` `text_id` `type` `motion_id` `motion_loop` `se_id` `se_sub_id` `enable_cond`
- _même structure (2)_ : `chat_emote_config_1.02.03.00.cfg.bin.json`, `chat_emote_config_1.03.17.00.cfg.bin.json`

### `chat_emote/chat_emote_def_set_config_0.00.00.cfg.bin.json`
- **`m_ChatEmoteDefSetInfoList`** `CHAT_EMOTE_DEF_SET_CONFIG` (n=3) — champs : `page_idx` `chat_id_array`
- _même structure (2)_ : `chat_emote_def_set_config_1.02.03.00.cfg.bin.json`, `chat_emote_def_set_config_1.03.17.00.cfg.bin.json`

---

## ai  (5 fichiers)

### `ai/soccer_ai_cmd_config_0.00.00.cfg.bin.json`
- **`m_updateTimingInfoList`** `UPDATE_TIMING_INFO` (n=73) — champs : `updateTimingId`
- **`m_conditionInfoList`** `AI_CMD_INFO` (n=71) — champs : `conditionId` `updateTimingInfo`
- _même structure (1)_ : `soccer_ai_cmd_config_0.05.91.cfg.bin.json`

### `ai/soccer_user_ai_config_1.01.50.cfg.bin.json`
- **`m_userParam`** `SoccerUserAIParam` (n=26) — champs : `id` `param`
- **`m_coachEffect`** `SoccerCoachAIEffect` (n=20) — champs : `type` `calc` `value`
- **`m_coachChoise`** `SoccerCoachAIChoise` (n=11) — champs : `idx` `textId` `timing` `geoId` `cameraId` `time` `offsetX` `offsetZ` `speachId` `effect`
- **`m_coachInfo`** `SoccerCoachAIInfo` (n=4) — champs : `id` `textId` `choise`
- **`m_titleEffect`** `SoccerTitleAIEffect` (n=13) — champs : `type` `calc` `value`
- **`m_titleConditionId`** `SoccerTitleAICondId` (n=6) — champs : `conditionId` `condition`
- **`m_titleInfo`** `SoccerTitleAIInfo` (n=4) — champs : `id` `textId` `type` `limitType` `limitParam` `condition` `conditionId` `effect`

### `ai/strategy_ai_config_1.01.50.cfg.bin.json`
- **`m_StrategyAITacticsInfoList`** `STRATEGY_AI_TACTICS_INFO` (n=66) — champs : `tacticsId` `tacticsParam`
- **`m_StrategyAIInfoList`** `STRATEGY_AI_INFO` (n=62) — champs : `strategyId` `nameId` `descId` `phaseId` `evaluationAdjustId` `isConfirm` `tacticsInfo`
- **`m_ConditionIdList`** `CONDITION_ID_INFO` (n=182) — champs : `conditionId` `condition`
- **`m_ConditionIdList2`** `CONDITION_ID_INFO` (n=74) — champs : `conditionId` `condition`
- **`m_PhaseCheckInfoList`** `PHASE_CHECK_INFO` (n=60) — champs : `phaseId` `phaseStateId` `condition` `condition2` `conditionIdList` `conditionIdList2`
- **`m_EvaluationAdjustParamInfoList`** `EVALUATION_ADJUST_PARAM_INFO` (n=15) — champs : `adjustType` `param`
- **`m_EvaluationAdjustInfoList`** `EVALUATION_ADJUST_INFO` (n=14) — champs : `evaluationAdustId` `adjustInfo`
- **`m_TeamStrategyAIDataInfoList`** `TEAM_STRATEGY_AI_DATA_INFO` (n=56) — champs : `strategyId` `enableLv`
- **`m_TeamStrategyAIInfoList`** `TEAM_STRATEGY_AI_INFO` (n=5) — champs : `groupId` `strategyInfo`

### `ai/tactics_ai_config_0.06.44.cfg.bin.json`
- **`m_TacticsAITargetInfoList`** `TACTICS_AI_TARGET_INFO` (n=52) — champs : `targetId` `funcName`
  - `funcName` : `CalcTargetChara_None`, `CalcTargetChara_Shoot`, `CalcTargetChara_Pass`, `CalcTargetChara_Press`, `CalcTargetChara_Centering`, `CalcTargetChara_PassBack`
- **`m_TacticsAIActionInfoList`** `TACTICS_AI_ACTION_INFO` (n=60) — champs : `actionId` `targetCharaType` `targetPosType` `targetId`
- **`m_TacticsAIInfoList`** `TACTICS_AI_INFO` (n=60) — champs : `tacticsId` `nameId` `descId` `actionInfo`
- **`m_CharaTacticsAIDataInfoList`** `CHARA_TACTICS_AI_DATA_INFO` (n=30) — champs : `tacticsId` `enableLv`
- **`m_CharaTacticsAIInfoList`** `CHARA_TACTICS_AI_INFO` (n=5) — champs : `groupId` `tacticsInfo`

---

## item  (5 fichiers)

### `item/common_item_table_0.04.68.cfg.bin.json`  _(entries=2)_
- listes : `ITBL_ITEMS_LIST_BEG_0`×727, `ITBL_BASE_LIST_BEG_0`×162
- _même structure (1)_ : `win_treasure_lot_table_config_0.00.00.cfg.bin.json`

### `item/item_config_1.03.65.00.cfg.bin.json`  _(entries=1)_
- listes : `ITEM_CONSUME_INFO_LIST_BEG_0`×72
- chaînes : `btl_re000001`, `btl_re000002`, `btl_re000003`, `spirit`, `spirit_growing`, `spirit_advanced`, `spirit_top`, `spirit_legendary`, `spirit_hero`, `spirit_basara`, `tk_hr000001`, `tk_hr000002`, `tk_hr000003`, `tk_hr000004`, `tk_hr000005`, `tk_hr000006`

### `item/item_emission_rarity_table_config_0.00.00.cfg.bin.json`
- **`m_itemEmissionRarityTableConfigInfoList`** `ITEM_EMISSION_RARITY_TABLE_CONFING_IFNO` (n=10) — champs : `tableId` `emitRarity` `weight`
- **`m_itemEmissionRarityTableConfigList`** `ITEM_EMISSION_RARITY_TABLE_CONFING` (n=4) — champs : `itemId` `tableInfo`

### `item/uniform_config_0.00.00.cfg.bin.json`
- **`m_UniformModelInfoList`** `UNIFORM_MODEL_INFO` (n=4) — champs : `uniformFielderModelIdCrc` `uniformKeeperModelIdCrc` `shoesModelIdCrc` `gloveModelIdCrc`
- **`m_UniformInfoList`** `UNIFORM_INFO` (n=4) — champs : `nameId` `modelInfo`

---

## post  (5 fichiers)

### `post/advent_calendar_config_2.00.17.00.cfg.bin.json`
- **`m_AdventCalendarInfoList`** `ADVENT_CALENDAR_INFO` (n=5) — champs : `id_crc` `cell_type` `flag_no` `time_start` `time_end` `repeat_type` `data_id_crc` `item_info_id_crc` `valid_cond`
  - `valid_cond` : `d_crc`, `cell_type`, `rc`, `l_type`
- **`m_NewsInfoList`** `NEWS_INFO` (n=6) — champs : `id_crc` `headline_small_text_id` `headline_large_text_id` `detail_text_id` `banner_start_res_name` `banner_end_res_name` `news_type` `detail_window_res_name`
  - `banner_start_res_name` : `calendar_update_img_01_001`, `calendar_update_img_01_002`, `calendar_update_img_01_003`, `calendar_update_img_01_004`
  - `detail_window_res_name` : `box_win_update_img01_001`, `box_win_update_img01_002`, `box_win_update_img01_003`, `box_win_update_img01_004`
- **`m_LoginBonusRewardItem`** `LOGIN_BONUS_REWARD_ITEM` (n=1) — champs : `item_id` `item_num`
- **`m_LoginBonusReward`** `LOGIN_BONUS_REWARD` (n=1) — champs : `day_count` `reward_item_list`
- **`m_LoginBonusInfo`** `LOGIN_BONUS_INFO` (n=1) — champs : `id_crc` `reward_list`

### `post/delivery_config_1.03.63.00.cfg.bin.json`
- **`m_DeliveryContentsDataList`** `DELIVERY_CONTENTS_DATA` (n=73) — champs : `contents_type` `itemIdCrc` `charaParamIdCrc` `rarity` `num` `aocIdCrc` `replaceItemIdCrc` `isPassphrase`
- **`m_DeliveryInfoList`** `DELIVERY_INFO` (n=30) — champs : `idCrc` `title` `receivedFlag` `newFlag` `sendTargetType` `deliveryContents` `openCond`
- **`m_PasswordCodesList`** `PASSWORD_CODES` (n=14) — champs : `japanese` `english`
  - `japanese` : `カハワヒコツイノモメオサ`, `モトネタヤイカントリキノ`, `ヤホンイヨメイシントアワ`
- **`m_PasswordDataList`** `PASSWORD_DATA` (n=14) — champs : `id` `text_id` `flag_id` `codes`

### `post/delivery_list_config.cfg.bin.json`  _(entries=1)_
- listes : `DELIVERY_INFO_LIST_BEG_0`×20

### `post/password_list_config.cfg.bin.json`
- **`m_Codes`** `PASSWARD_CODES` (n=1) — champs : `japanese` `english` `portuguese` `french ` `italian` `german` `spanish` `traditionalChinese` `simplifiedChinese`
- **`info`** `PASSWARD_DATA` (n=1) — champs : `id` `text_id` `flag_id` `conditions` `codes`

### `post/post_notice_config_1.03.93.00.cfg.bin.json`
- **`m_PostNoticeBannerImgInfoList`** `POST_NOTICE_BANNER_IMG_INFO` (n=44) — champs : `id_crc` `banner_bg_id_crc` `banner_badge_id_crc` `banner_icon_id_crc`
- **`m_PostNoticeBannerBgInfoList`** `POST_NOTICE_BANNER_BG_INFO` (n=16) — champs : `id_crc` `banner_bg_texture_name_crc` `banner_bg_texture_path_crc` `banner_bg_texture_path`
  - `banner_bg_texture_path` : `#/menu/220_img/banner_img/banner01_0001.g4tx`, `#/menu/220_img/banner_img/banner01_0002.g4tx`, `#/menu/220_img/banner_img/banner_img_early.g4tx`, `#/menu/220_img/banner_img/banner_img_beta.g4tx`, `#/menu/220_img/banner_img/banner_img_preorder.g4tx`, `#/menu/220_img/banner_img/banner_img_deluxe.g4tx`
- **`m_PostNoticeBannerBadgeInfoList`** `POST_NOTICE_BANNER_BADGE_INFO` (n=3) — champs : `id_crc` `banner_badge_texture_name_crc`
- **`m_PostNoticeBannerIconInfoList`** `POST_NOTICE_BANNER_ICON_INFO` (n=9) — champs : `id_crc` `banner_icon_texture_name_crc`
- **`m_PostNoticeBannerGraphicsTextInfo`** `POST_NOTICE_BANNER_GRAPHICS_TEXT_INFO` (n=8) — champs : `id_crc` `banner_graphics_text_texture_name_crc` `banner_graphics_text_texture_path_crc` `banner_graphics_text_texture_path`
  - `banner_graphics_text_texture_path` : `#/menu/220_img/banner_img/banner02_0001.g4tx`, `#/menu/220_img/banner_img/<LG>/banner02_0002.g4tx`, `#/menu/220_img/banner_img/<LG>/gtxt_banner01_deluxe01.g4tx`, `#/menu/220_img/banner_img/<LG>/gtxt_banner01_early01.g4tx`, `#/menu/220_img/banner_img/<LG>/gtxt_banner01_victoryroad01.g…`, `#/menu/220_img/banner_img/<LG>/gtxt_banner02_chronicle01_pre…`
- **`m_PostNoticeInfoList`** `POST_NOTICE_INFO` (n=9) — champs : `id_crc` `flag_no` `is_advance_notice` `banner_img_id_crc` `banner_graphics_text_id_crc` `banner_title_text_id_crc` `banner_title_text_font_style_type` `banner_overview_two_line_text_id_crc` `banner_overview_two_line_text_font_style_type` `banner_overview_one_line_text_id_crc` `banner_overview_one_line_text_font_style_type` `detail_window_title_txt_id_crc` `detail_window_main_txt_id_crc` `is_use_utc` `start_enable_time` `end_enable_time` `valid_cond`

---

## command  (5 fichiers)

### `command/chara_cmd_event_common_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `CHARA_ACTION_CMD_DATA_LIST_BEG_0`×32

### `command/rpg_cmd_action_1.03.53.00.cfg.bin.json`  _(entries=1)_
- listes : `CMD_ACTION_INFO_LIST_BEG_0`×229
- _même structure (1)_ : `soccer_cmd_action_0.07.70.cfg.bin.json`

### `command/rpg_cmd_event_1.02.75.00.cfg.bin.json`  _(entries=2)_
- listes : `ALL_CMD_EVENT_INFO_LIST_BEG_0`×231, `CHARA_CMD_EVENT_FUNC_LIST_BEG_0`×39
- _même structure (1)_ : `soccer_cmd_event_0.07.70.cfg.bin.json`

---

## vsroute  (4 fichiers)

### `vsroute/chronicle_vs_route_config_2.00.16.cfg.bin.json`
- **`m_unlockPieceInfoList`** `UNLOCK_PIECE_INFO` (n=220) — champs : `unlockPieceId` `unlockEvent` `dlcNo`
- **`m_pieceMoveRouteInfoList`** `PIECE_MOVE_ROUTE_INFO` (n=222) — champs : `moveRouteLU` `moveRouteLD` `moveRouteRU` `moveRouteRD`
- **`m_pieceEventInfoList`** `PIECE_EVENT_INFO` (n=151) — champs : `paramCrc1` `paramCrc2` `paramNum1` `paramNum2` `bustupEventPreSoccer` `bustupEventPostWinSoccer`
  - `bustupEventPreSoccer` : `ev21_01000`, `ev21_02000`, `ev21_03000`, `ev21_04000`, `ev21_05000`, `ev21_06000`
  - `bustupEventPostWinSoccer` : `ev21_01100`, `ev21_02100`, `ev21_03100`, `ev21_04100`, `ev21_05100`, `ev21_06100`
- **`m_pieceInfoList`** `PIECE_INFO` (n=223) — champs : `routeType` `pieceId` `eventType` `statusFlagIndex` `routeProgressIndex` `addDlcNo` `piecePos` `piecePosOffset` `IconInfoId` `IconInfoIndex` `bgmId` `canObtainGateKey` `gateKeyUsePieceId` `gateOpenInfoId` `gateOpenInfoIndex` `condition` `moveRouteInfo` `unlockPieceInfo` `eventInfoRef` `showNewRouteEffect` `needUpdate` `updateLockPieceId` `lockedGlobalBitFlagId`
- **`m_chronicleVsRouteInfoList`** `CHRONICLE_VS_ROUTE_INFO` (n=8) — champs : `id` `pieceInfo`
- **`m_pieceIconInfoList`** `PIECE_ICON_INFO` (n=136) — champs : `id` `textureName` `texturePath`
- **`m_gateOpenInfoList`** `GATE_OPEN_INFO` (n=1) — champs : `id` `unlockFlag1` `unlockFlag2` `unlockFlag3` `condition1` `condition2` `condition3`
- _même structure (1)_ : `chronicle_vs_route_config_5.00.30.cfg.bin.json`

### `vsroute/chronicle_vs_route_opponent_info_0.00.00.cfg.bin.json`
- **`m_vsRouteOpponentInfoList`** `VS_ROUTE_OPPONENT_INFO` (n=4) — champs : `category` `battleId` `sortOrder` `cond1` `cond2` `cond3` `cond4`

### Triggers `DATA_COUNT_0` / `DATA_ITEM_n`  (1 fichiers)
- Même forme : 1 entrée `DATA_COUNT_0` (Int = nombre d'items) suivie de `DATA_ITEM_0..n` (≈ 64–64 items/fichier). Données de scénario d'événement compilées par instance.
- Fichiers : `chronicle_vs_route_trigger`

---

## team  (4 fichiers)

### `team/enjoy_mode_team_config_1.04.02.00.cfg.bin.json`  _(entries=1)_
- listes : `ENJOY_MODE_TEAM_INFO_LIST_BEG_0`×28
- chaînes : `ev_chronicle_img/ev_bb_s10g001_01.g4tx`, `ev_bb_s10g001_01`, `ev_chronicle_img/ev_bb_s11g001_01.g4tx`, `ev_bb_s11g001_01`, `ev_chronicle_img/ev_bb_s33g001_01.g4tx`, `ev_bb_s33g001_01`, `ev_chronicle_img/ev_bb_s14g001_01.g4tx`, `ev_bb_s14g001_01`, `ev_chronicle_img/ev_bb_s09g001_01.g4tx`, `ev_bb_s09g001_01`, `ev_chronicle_img/ev_bb_s52g001_01.g4tx`, `ev_bb_s52g001_01`, `ev_chronicle_img/ev_bb_s13g001_01.g4tx`, `ev_bb_s13g001_01`, `ev_chronicle_img/ev_bb_s68g001_01.g4tx`, `ev_bb_s68g001_01`

### `team/opponent_team_config_1.03.05.00.cfg.bin.json`
- **`m_OpponentTeamInfoList`** `OPPONENT_TEAM_INFO` (n=17) — champs : `id` `type` `teamId` `descTextId` `pointTextId` `meetingtEventId` `flagNo` `openCond` `formationCond` `meetingCond` `menuBaseColor` `menuTextColor` `menuPlateColor` `bgTextureName` `bgTextureNameCrc` `gameId` `difficultyType`
  - `bgTextureName` : `opp110005`, `opp110003`, `opp110006`, `opp110007`, `opp110008`, `opp110012`
- **`m_MatchDifficultyInfoList`** `PRACTICE_MATCH_DIFFICULTY` (n=404) — champs : `difficulty` `openCond`
- **`m_PracticeMatchGameInfoList`** `PRACTICE_MATCH_GAME_INFO` (n=101) — champs : `gameId` `openCond` `difficultyInfo`
- **`m_PracticeMatchInfoList`** `PRACTICE_MATCH_INFO` (n=101) — champs : `id` `category` `gameInfo` `newFlag`

### `team/rpg_team_name_0.08.47.cfg.bin.json`
- **`m_TeamNameInfoList`** `RPG_TEAM_NAME_INFO` (n=9) — champs : `id` `textId` `condition` `descTextId` `pointTextId`

### `team/team_config_1.04.06.00.cfg.bin.json`  _(entries=1)_
- listes : `TEAM_MEMBER_SKILL_CONFIG_INFO_LIST_BEG_0`×2760
- chaînes : `tm_st_game_0101a`, `tm_st_scbattle_0301`, `tm_st_game_0102`, `tm_st_game_0107`, `tm_st_game_0106a`, `tm_st_game_0106b`, `tm_st_game_0108_st0701`, `tm_st_game_0108`, `tm_st_game_0109_st0801`, `tm_st_game_0109`, `tm_st_game_0110a`, `tm_st_game_0110c`, `tm_st_game_0110b`, `tm_st_game_0903b`, `tm_st_game_1001a`, `tm_prc_040100`

---

## mission  (4 fichiers)

### `mission/mission_config_0.00.00.cfg.bin.json`  _(entries=1)_
- listes : `MISSION_CONFIG_INFO_LIST_BEG_0`×1
- chaînes : `msa999999`

### `mission/msa999999_layout_config.cfg.bin.json`  _(entries=1)_
- entrées : `LAYOUT_BASE_LIST_BEG_0`

### `mission/msa999999_oneplace_setting.cfg.bin.json`  _(entries=7)_
- entrées : `OP_TBOX_LIST_BEG_0`, `OP_FUNC_LIST_BEG_0`, `COLLISION_COL_LIST_BEG_0`, `OP_EFFECT_CFG_LIST_BEG_0`, `EXCEPTION_OP_INFO_LIST_BEG_0`, `WATCH_LOCK_INFO_LIST_BEG_0`, `VENDING_MACHINE_INFO_LIST_BEG_0`

### Triggers `DATA_COUNT_0` / `DATA_ITEM_n`  (1 fichiers)
- Même forme : 1 entrée `DATA_COUNT_0` (Int = nombre d'items) suivie de `DATA_ITEM_0..n` (≈ 2–2 items/fichier). Données de scénario d'événement compilées par instance.
- Fichiers : `msa999999_trigger`

---

## party  (4 fichiers)

### `party/ctrl_chara_config_1.04.17.00.cfg.bin.json`  _(entries=2)_
- listes : `CTRL_CHR_DATA_LIST_BEG_0`×155, `CTRL_CHR_INFO_LIST_BEG_0`×54

### `party/guest_limit_config.cfg.bin.json`  _(entries=1)_
- listes : `GENERAL_LIMIT_INFO_LIST_BEG_0`×1

### `party/party_departure_0.00.00.cfg.bin.json`
- **`m_partyDeparture`** `PartyDeparture` (n=7) — champs : `charaId` `textureId`

### `party/supecify_party0.00.00.cfg.bin.json`
- **`m_PartyRefCharaList`** `SPECIFY_PARTY_CHARA_DATA` (n=18) — champs : `slot` `type` `paramId` `lv` `lvType` `lvParamId` `equip`
- **`m_SpecifyPartyList`** `SPECIFY_PARTY_DATA` (n=7) — champs : `partyId` `chara`

---

## dungeon  (3 fichiers)

### `dungeon/gimmick_system_num_config.cfg.bin.json`  _(entries=1)_
- listes : `DUNGEON_NUM_TABLE_GROUP_LIST_BEG_0`×1

### `dungeon/z01_debug/z01_debug_gimmick_layout.cfg.bin.json`  _(entries=1)_
- listes : `LAYOUT_BASE_LIST_BEG_0`×24

### `dungeon/z01_debug/z01_debug_gimmick_oneplace_0.00.00.cfg.bin.json`
- **`m_GimmickOneplaceList`** `GIMMICK_ONEPLACE_INFO` (n=8) — champs : `oneplaceId` `layoutId` `gimmickType` `paramCrc0` `paramCrc1` `paramNum0` `paramNum1` `cond`

---

## input  (3 fichiers)

### `input/adaptive_trigger_def_0.00.00.cfg.bin.json`
- **`m_ModeItemList`** `MODE_ITEM_INFO` (n=7) — champs : `fd_startPosition` `fd_strength` `wp_startPosition` `wp_endPosition` `wp_strength` `vb_startPosition` `vb_amplitude` `vb_frequency` `mpfd_strength` `sl_startPosition` `sl_endPosition` `sl_startStrength` `sl_endStrength` `mpvb_frequency` `mpvb_amplitude` `triggerEffectMode` `triggerType`
- **`m_InfoAdaptiveTriggerDataList`** `INFO_ADAPTIVE_TRIGGER_DATA_CONFIG` (n=3) — champs : `id` `id_name` `mask` `modeItemList`
  - `id_name` : `feedback01`, `feedback02`, `feedback03`

### `input/haptic_feedback_def_0.00.00.cfg.bin.json`
- **`m_ModeItemList`** `MODE_ITEM_INFO` (n=7) — champs : `fd_startPosition` `fd_strength` `wp_startPosition` `wp_endPosition` `wp_strength` `vb_startPosition` `vb_amplitude` `vb_frequency` `mpfd_strength` `sl_startPosition` `sl_endPosition` `sl_startStrength` `sl_endStrength` `mpvb_frequency` `mpvb_amplitude` `triggerEffectMode` `triggerType`
- **`m_InfoHapticFeedbackDataList`** `INFO_HAPTIC_FEEDBACK_DATA_CONFIG` (n=3) — champs : `id` `id_name` `mask` `modeItemList` `resPath`
  - `id_name` : `feedback01`, `feedback02`, `feedback03`
  - `resPath` : `#/debug/input/vibration/HandGun_Vibration.wav`, `#/debug/input/vibration/MachineGun_Vibration.wav`, `#/debug/input/vibration/ShotGun_Vibration.wav`

### `input/vibration_def_0.00.09.cfg.bin.json`
- **`m_vibrationDefList`** `VIBRATION_DEF_INFO` (n=63) — champs : `vibrationId` `highFrequency` `lowFrequency` `amplitudeHigh` `amplitudeLow` `powerParam` `inTime` `loopTime` `outTime` `holdMinLimitPower` `largeRate` `smallRate` `bLoopHold` `priority` `wavPath`
  - `wavPath` : `#/debug/input/vibration/HandGun_Vibration.wav`, `#/debug/input/vibration/MachineGun_Vibration.wav`, `#/input/vibration/normalshot_vibration.wav`, `#/input/vibration/keepersaved_vibration.wav`, `#/input/vibration/criticalshot_vibration.wav`, `#/input/vibration/criticalcatch_vibration.wav`

---

## weather  (2 fichiers)

### `weather/weather_convert_0.00.00.cfg.bin.json`
- **`m_weatherConvertList`** `WEATHER_CONVERT` (n=8) — champs : `detailWeather` `gameWeather` `mapWeather`

### `weather/weather_schedule_0.00.00.cfg.bin.json`  _(entries=2)_
- listes : `WEATHER_SCHEDULE_INFO_LIST_BEG_0`×2, `WEATHER_REGION_INFO_LIST_BEG_0`×1

---

## font  (2 fichiers)

_Localisé : sous-dossiers par langue (zh_hans, zh_hant). Le contenu textuel réel vit dans les refs `textId`/`texName` (CRC), pas en clair ici._

### `font/zh_hans/code_sort.cfg.bin.json`  _(entries=1)_
- listes : `ZH_CODE_SORT_KEY_LIST_BEG_0`×7127
- _même structure (1)_ : `zh_hant/code_sort.cfg.bin.json`

---

## skill_view  (2 fichiers)

### `skill_view/skill_view_preset_config_0.00.28.cfg.bin.json`
- **`m_SkillViewPresetDataList`** `SKILL_VIEW_PRESET_DATA` (n=17) — champs : `charaId` `skillType` `uniformId` `shoesId` `gloveId` `bAway` `bKeeper` `uniformNumber`
- **`m_SkillViewPresetInfoList`** `SKILL_VIEW_PRESET_INFO` (n=5) — champs : `presetId` `presetName` `presetData` `bDefault`
  - `presetName` : `プリセット【base01】`, `プリセット【普通02】`, `プリセット【チビ01】`, `プリセット【チビ02】`, `プリセット【発動者0人テスト】`
- _même structure (1)_ : `skill_view_preset_config.cfg.bin.json`

---

## players_universe  (2 fichiers)

### `players_universe/players_universe_config_1.03.59.00.cfg.bin.json`
- **`m_universeInfoList`** `UNIVERSE_INFO` (n=1) — champs : `universeIdCrc` `universeNameId` `universeInfoTextId` `universeLockTextId` `locatorNameHash` `enableCond`
- **`m_starKeyRouteInfoList`** `STAR_KEY_ROUTE_INFO` (n=240) — champs : `starKeyNameHash` `starKeyNameHashLinkUp` `starKeyNameHashLinkDown` `starKeyNameHashLinkLeft` `starKeyNameHashLinkRight`
- **`m_starInfoList`** `STAR_INFO` (n=30) — champs : `starNameHash` `starLocatorNameHash` `starTextureNameHash` `starAfterTextureNameHash` `rareStarTextureNameHash` `starSignLayerNameHash` `starLayerNameHash` `numTextureNameHash` `starKeyInfoList`
- **`m_starKeyInfoList`** `STAR_KEY_INFO` (n=240) — champs : `starKeyNameHash` `starKeyLocatorNameHash` `winContentTextureNameHash` `isRarePackStar` `lotteryStarSignIdCrc` `flagIndex`
- **`m_universeStarSignInfoList`** `UNIVERSE_STAR_SIGN_INFO` (n=30) — champs : `starSignIdCrc`
- **`m_universeStarSignSetDataList`** `UNIVERSE_STAR_SIGN_SET_DATA` (n=1) — champs : `universeIdCrc` `universeStarSignInfoList`
- **`m_starSignInfoList`** `STAR_SIGN_INFO` (n=30) — champs : `starSignIdCrc` `starSignNameId` `starSignInfoTextId` `starSignNo` `keyItemId` `keyItemNum` `dropCharacterNum` `starKeyNameHash` `clearFlagIndex` `enableCond`
- **`m_starSignCharaInfoList`** `STAR_SIGN_CHARA_INFO` (n=5010) — champs : `charaParamId` `charaRarity` `charaRateDefault` `charaRateBoostA` `charaRateBoostB` `charaRateBoostC` `charaRateBoostD` `isRemarkable` `enableCond`
- **`m_starSignRarityRateInfoList`** `STAR_SIGN_RARITY_RATE_INFO` (n=90) — champs : `rarityType` `rarityRateDefault` `rarityRateBoostA` `rarityRateBoostB` `rarityRateBoostC` `rarityRateBoostD` `starSignCharaInfoList`
- **`m_starSignCharaSetDataList`** `STAR_SIGN_CHARA_SET_DATA` (n=30) — champs : `starSignIdCrc` `starSignRarityRateInfoList`

### `players_universe/players_universe_event_config.cfg.bin.json`
- **`m_playersUniverseResultEffectInfoList`** `PLAYERS_UNIVERSE_RESULT_EFFECT_INFO` (n=12) — champs : `id` `targetLocatorCrc` `moveDegree` `moveDistance`

---

## search_word  (2 fichiers)

### `search_word/info_bookmark_config_0.00.00.cfg.bin.json`
- **`m_TexBasePathList`** `TEX_BASE_PATH` (n=1) — champs : `basePath`
  - `basePath` : `#/menu/220_img/bookmark_img/<LG>/`
- **`m_BookmarkFolderItemList`** `BOOKMARK_FOLDER_INFO` (n=55) — champs : `searchWordId` `wordTextId` `descTextId` `thumbnailTexName` `thumbnailTexFileName` `isNecessaryStory` `enableCond`
  - `thumbnailTexFileName` : `bookmark_img01_s01.g4tx`, `bookmark_img01_s02.g4tx`, `bookmark_img01_s03.g4tx`, `bookmark_img01_s04.g4tx`, `bookmark_img50_s02.g4tx`, `bookmark_img50_s03.g4tx`
- **`m_InfoBookmarkDataList`** `INFO_BOOKMARK_DATA_CONFIG` (n=11) — champs : `bookmarkId` `baseNo` `folderNameId` `thumbnailTexName` `thumbnailTexFileName` `bookmarkFolderItemList`
  - `thumbnailTexFileName` : `bookmark_img01_l01.g4tx`, `bookmark_img02_l01.g4tx`, `bookmark_img03_l01.g4tx`, `bookmark_img04_l01.g4tx`, `bookmark_img05_l01.g4tx`, `bookmark_img06_l01.g4tx`

### `search_word/search_word_config.cfg.bin.json`  _(entries=1)_
- listes : `SEARCH_WORD_INFO_LIST_BEG_0`×55

---

## craft  (2 fichiers)

### `craft/craft_obj_config_1.04.10.00.cfg.bin.json`  _(entries=6)_
- listes : `CRAFT_OBJ_INTERREST_LOTTERY_UNIQUE_CHARA_INFO_LIST_BEG_0`×1005, `CRAFT_OBJ_INTERREST_SOCKET_INFO_LIST_BEG_0`×87, `CRAFT_OBJ_NPC_STICK_POINT_INFO_LIST_BEG_0`×105, `CRAFT_OBJ_VISUAL_INFO_LIST_BEG_0`×187, `CRAFT_OBJ_VISUAL_GROUP_INFO_LIST_BEG_0`×334, `CRAFT_OBJ_INFO_LIST_BEG_0`×786

### `craft/craft_theme_config_0.00.00.cfg.bin.json`  _(entries=2)_
- listes : `CRAFT_THEME_TYPE_INFO_LIST_BEG_0`×9, `CRAFT_THEME_INFO_LIST_BEG_0`×6

---

## formation  (1 fichier)

### `formation/formation_config_0.02.16.cfg.bin.json`
- **`m_SoccerPositionInfoList`** `SOCCER_POSITION_INFO` (n=10) — champs : `positionId` `centerLineWight` `offenseLineWeight` `defenseLineWeight`
- **`m_SoccerFormPlacementInfoList`** `SOCCER_FORM_PLACEMENT_INFO` (n=1073) — champs : `defensePos` `offensePos` `startPos` `ckDefenseLeftPos` `ckDefenseRightPos` `ckOffenseLeftPos` `ckOffenseRightPos` `pkDefensePos` `pkOffensePos` `bustupPos` `positionNo` `positionId` `passNo` `bKickoff` `bFollow`
- **`m_SoccerFormationInfoList`** `SOCCER_FORMATION_INFO` (n=115) — champs : `formId` `placementInfo` `powerOffense` `powerDefense` `nounId` `descId`
- **`m_SoccerCurvePointInfoList`** `SOCCER_CURVE_POINT_INFO` (n=32) — champs : `rate` `point`
- **`m_SoccerLineCurveInfoList`** `SOCCER_LINE_CURVE_INFO` (n=7) — champs : `lineCurveId` `curveInfo`

---

## help  (1 fichier)

### `help/help_list_config_1.04.08.00.cfg.bin.json`  _(entries=2)_
- listes : `HELP_LIST_IMAGE_LIST_BEG_0`×322, `HELP_LIST_INFO_LIST_BEG_0`×491
- chaînes : `hlp_controls.g4tx`, `hlp_0010.g4tx`, `hlp_0020.g4tx`, `hlp_0030.g4tx`, `hlp_0040.g4tx`, `hlp_0050.g4tx`, `hlp_0060.g4tx`, `hlp_0070.g4tx`, `hlp_0080.g4tx`, `hlp_0090.g4tx`, `hlp_0100.g4tx`, `hlp_0110.g4tx`, `hlp_0120.g4tx`, `hlp_0130.g4tx`, `hlp_0140.g4tx`, `hlp_0150.g4tx`

---

## boost_grp  (1 fichier)

### `boost_grp/boost_player_group_config_0.00.00.cfg.bin.json`  _(entries=3)_
- listes : `BOOST_PLAYER_GRP_SPRIT_TABLE_INFO_LIST_BEG_0`×4, `BOOST_PLAYER_GRP_CONFIG_LIST_BEG_0`×5, `BOOST_PLAYER_GRP_INFO_LIST_BEG_0`×2

---

## fast_travel  (1 fichier)

### `fast_travel/fast_travel_config_0.00.00.cfg.bin.json`
- **`m_fastTravelMapInfoList`** `FAST_TRAVEL_MAP_INFO` (n=6) — champs : `id` `mapId` `mapTextId` `pos` `charaRotateY`

---

## music_app  (1 fichier)

### `music_app/music_app_config.cfg.bin.json`  _(entries=1)_
- listes : `MUSIC_APP_INFO_LIST_BEG_0`×4

---

## record  (1 fichier)

### `record/record_config.cfg.bin.json`  _(entries=1)_
- listes : `RECORD_INFO_LIST_BEG_0`×31

---

## light  (1 fichier)

### `light/light_overwrite_config_1.03.21.00.cfg.bin.json`  _(entries=2)_
- listes : `LIGHT_OVERWRITE_PARAM_LIST_BEG_0`×20, `LIGHT_OVERWRITE_INFO_LIST_BEG_0`×6

---

## w17  (1 fichier)

### `w17/tgs_npc_talk_00_01.cfg.bin.json`  _(entries=3)_
- entrées : `ACT_TYPE_BEGIN_0`, `POINT_MAX_0`, `POINT_0`
- chaînes : `action name`

---

## dictionary  (1 fichier)

### `dictionary/dictionary_config_0.00.00.cfg.bin.json`
- **`m_HabitatList`** `DICTIONARY_HABITAT_DATA` (n=43) — champs : `habitatID` `mapID` `mapNameID` `fileName` `textureNameCrc` `isShowAreaTexture`
- **`m_ObservationDataList`** `DICTIONARY_OBSERVATION_REF_DATA` (n=280) — champs : `charaid` `actiontype_id`
- **`m_ParamList`** `DICTIONARY_PARAM_DATA` (n=280) — champs : `charaID` `medalID` `weaponItemID` `habitatID` `descTextID` `viewDictNo` `viewType` `isButtle` `category` `sub_category` `cond2` `cond3` `observation_data`
- **`m_ObservationActionIdList`** `DICTIONARY_OBSERVATION_ACTIONID_REF_DATA` (n=178) — champs : `action_id` `emotion_id` `disable_repeat_se`
- **`m_ObservationActionPlayList`** `DICTIONARY_OBSERVATION_ACTIONPLAY_REF_DATA` (n=94) — champs : `play_no` `acttion_list`
- **`m_ObservationActionDataList`** `DICTIONARY_OBSERVATION_ACTION_DATA` (n=28) — champs : `actiontype_id` `playlist`

---

## chronicle_top  (1 fichier)

### `chronicle_top/chronicle_top_caravan_config.cfg.bin.json`
- **`m_chronicleTopCaravanInfoList`** `CHRONICLE_TOP_CARAVAN_INFO` (n=5) — champs : `id` `moveType` `amplitudeMaxX` `amplitudeEasingTypeX` `amplitudePeriodTimeX` `amplitudeStrengthX` `amplitudeMaxY` `amplitudeEasingTypeY` `amplitudePeriodTimeY` `amplitudeStrengthY` `amplitudeMaxZ` `amplitudeEasingTypeZ` `amplitudePeriodTimeZ` `amplitudeStrengthZ` `rotationMaxX` `rotationEasingTypeX` `rotationPeriodTimeX` `rotationStrengthX` `rotationMaxY` `rotationEasingTypeY` `rotationPeriodTimeY` `rotationStrengthY` `rotationMaxZ` `rotationEasingTypeZ` `rotationPeriodTimeZ` `rotationStrengthZ`

---

## chara_bank  (1 fichier)

### `chara_bank/soccer_club_room_config.cfg.bin.json`
- **`m_soccerClubRoomCharaRestrictionInfoList`** `SOCCER_CLUB_ROOM_CHARA_RESTRICTION_INFO` (n=41) — champs : `character_id` `is_remove_club_disabled` `is_chara_bank_move_disabled` `is_team_dock_change_disabled`

---

## data_file  (1 fichier)

### `data_file/data_file_config_1.04.07.cfg.bin.json`
- **`m_MenuDataFileAppearanceConfigList`** `DATA_FILE_APPEARANCE_PARAM_DATA` (n=18) — champs : `id` `map_area_id` `text_id`
- **`m_MenuDataFileAffiliationList`** `DATA_FILE_AFFILIATIONS` (n=590) — champs : `id`
- **`m_MenuDataFileConfigList`** `DATA_FILE_PARAM_DATA` (n=590) — champs : `index` `character_id` `chara_param_id` `party_join_flgindex` `affiliation_list` `condition` `appearance_id` `appearance_day` `appearance_time` `viewing_id` `scout_id` `encount_id` `personality_type` `first_person` `second_person_male` `second_person_female` `scout_condition`
- **`m_MenuDataFileStandardClotheList`** `DATA_FILE_STANDARD_CLOTHES` (n=11) — champs : `clothing_id` `condition`
  - `condition` : `AAAAAAYCMgQowRA=`, `AAAAAAYCMpEQYCQ=`, `AAAAAAYCNH5R354=`
- **`m_MenuDataFileUniformClotheList`** `DATA_FILE_UNIFORM_CLOTHES` (n=18) — champs : `clothing_id` `condition`
  - `condition` : `AAAAAAYCNCUs4RM=`, `AAAAAAYCNNar27Q=`, `AAAAAAYCNLWQ8GY=`, `AAAAAAYCNJEeY6w=`, `AAAAAAYCNH5R354=`
- **`m_MenuDataFileAppreciationConfigList`** `DATA_FILE_APPRECIATION_PARAM_DATA` (n=22) — champs : `id` `standard_clothes` `uniform_clothes` `action_type_id`
- **`m_MenuDataFileRequestPresentList`** `DATA_FILE_REQUEST_PRESENT` (n=555) — champs : `id` `num` `isUseCategory`
- **`m_MenuDataFileRewardPresentList`** `DATA_FILE_REWARD_PRESENT` (n=555) — champs : `id` `num`
- **`m_MenuDataFileScoutConfigList`** `DATA_FILE_SCOUT_PARAM_DATA` (n=555) — champs : `id` `requests` `rewards` `destiny_appearance_id` `scoutQuestArray`
- **`m_MenuDataFileAffiliationGroupMemberList`** `DATA_FILE_AFFILIATION_GROUP_MEMBER` (n=590) — champs : `character_id`
- **`m_MenuDataFileAffiliationGroupList`** `DATA_FILE_AFFILIATION_GROUP` (n=48) — champs : `group_id` `menber_s` `name_text_id` `desc_text_id`
- **`m_MenuDataFileAffiliationConfigList`** `DATA_FILE_AFFILIATION_PARAM_DATA` (n=6) — champs : `classification` `groups`
- **`m_MenuDataFileScoutQuestConfigList`** `DATA_FILE_SCOUT_QUEST_PARAM_DATA` (n=361) — champs : `id` `questType` `baseTextId` `textParamArray` `textParamCountId` `clearCond`

---

## scene_archive  (1 fichier)

### `scene_archive/scene_archive_config_4.00.18.00.cfg.bin.json`
- **`m_sceneArchiveFlags`** `SCENE_ARCHIVE_FLAGS` (n=6) — champs : `activeTempBitFlagCrc`
- **`m_sceneArchiveDataList`** `SCENE_ARCHIVE_LIST_DATA` (n=112) — champs : `id` `category` `flag_num` `text_id_title` `text_id_explain` `event_type` `event_id_text` `map_id` `map_tag_id` `map_jump_pos_x` `map_jump_pos_y` `map_jump_pos_z` `chapter_no` `is_full_screen_view` `thumbnail_texture_name` `thumbnail_texture_path` `condition` `activeFlags`
  - `event_id_text` : `ev01_00050`, `ev01_00150`, `ev01_00200`, `ev01_00400`, `ev01_00410`, `ev01_00500`
  - `thumbnail_texture_path` : `#/menu/220_img/theater_img/theater_img01_02.g4tx`, `#/menu/220_img/theater_img/theater_img01_03.g4tx`, `#/menu/220_img/theater_img/theater_img01_04.g4tx`, `#/menu/220_img/theater_img/theater_img01_05.g4tx`, `#/menu/220_img/theater_img/theater_img01_06.g4tx`, `#/menu/220_img/theater_img/theater_img01_07.g4tx`

---

## motion  (1 fichier)

### `motion/talk_motion_group_config_0.00.00.00.cfg.bin.json`
- **`m_talkMotionGroupList`** `TALK_MOTION_GROUP` (n=5) — champs : `groupNameCrc` `motionNameCrc`

---

## inacode  (1 fichier)

### `inacode/inacode_config_1.01.57.00.cfg.bin.json`
- **`m_InacodeStampDataList`** `INACODE_STAMP_DATA` (n=15) — champs : `idCrc` `imgNameCrc` `imgPathCrc`
- **`m_InacodeAuthorNameDataList`** `INACODE_AUTHOR_NAME_DATA` (n=29) — champs : `authorCrc` `authorNameTextIdCrc`
- **`m_InacodePhotoImgDataList`** `INACODE_PHOTO_IMG_DATA` (n=10) — champs : `idCrc` `imgNameCrc` `imgPathCrc`
- **`m_InacodeMemberDataList`** `INACODE_MEMBER_DATA` (n=33) — champs : `idCrc` `memberCond`
- **`m_InacodeCommentSetIdDataList`** `INACODE_COMMENT_SET_ID_DATA` (n=74) — champs : `idCrc`
- **`m_InacodeRoomDataList`** `INACODE_ROOM_DATA` (n=2) — champs : `idCrc` `orderby` `name` `openBitFlag` `newBitFlag` `newCommentBitFlag` `readedCommentFlagIndex` `openCond` `member` `comment`
- **`m_InacodeSelectionDataList`** `INACODE_SELECTION_DATA` (n=8) — champs : `index` `text`
- **`m_InacodeMentionDataList`** `INACODE_MENTION_DATA` (n=6) — champs : `charaIdCrc`
- **`m_InacodeCommentDataList`** `INACODE_COMMENT_DATA` (n=968) — champs : `author` `overwriteAuthor` `text` `isMentionAll` `mention` `hour` `minutes` `selectionFlagIndex` `selection` `disableReplyCond` `stamp` `photoImg` `needSeparatorLine`
- **`m_InacodeCommentSetDataList`** `INACODE_COMMENT_SET_DATA` (n=83) — champs : `idCrc` `openCond` `openedFlagIndex` `comment`

---

## extend_story  (1 fichier)

### `extend_story/extend_story_data_config_0.00.02.00.cfg.bin.json`
- **`m_exStoryDataConfigList`** `EXTEND_STORY_DATA_CONFIG` (n=1) — champs : `extendStoryId` `titleTextId` `explanationTextId` `validCond` `extendStoryType` `extendStoryDataId` `extendStoryClearFlgId`
- **`m_exStoryGameEnterEvConfigList`** `EXTEND_STORYGAME_ENTER_EV_CONFIG` (n=2) — champs : `enterEventId`
- **`m_exStoryGameWinEvConfigList`** `EXTEND_STORYGAME_WIN_EV_CONFIG` (n=1) — champs : `winEventId`
- **`m_exStoryGameLoseEvConfigList`** `EXTEND_STORYGAME_LOSE_EV_CONFIG` (n=1) — champs : `loseEventId`
- **`m_exStoryGameDataConfigList`** `EXTEND_STORYGAME_DATA_CONFIG` (n=1) — champs : `extendStoryGameId` `gameId` `enterEvConfig` `winEvConfig` `loseEvConfig`

---

## user_name_plate  (1 fichier)

### `user_name_plate/user_name_plate_config_1.03.50.00.cfg.bin.json`
- **`m_userNamePlateInfoList`** `USER_NAME_PLATE_INFO` (n=54) — champs : `userNamePlateId` `userNamePlateNameId` `sortNo` `textureFileNameText` `textureFileNameCrc` `mainTextureNameCrc` `shadowTextureNameCrc` `nameFontStyle` `flagIndex` `enableCond`
  - `textureFileNameText` : `#/menu/200_icon/25_icon_nameplate/nm00001.g4tx`, `#/menu/200_icon/25_icon_nameplate/nm00002.g4tx`, `#/menu/200_icon/25_icon_nameplate/nm00101.g4tx`, `#/menu/200_icon/25_icon_nameplate/nm00102.g4tx`, `#/menu/200_icon/25_icon_nameplate/nm00103.g4tx`, `#/menu/200_icon/25_icon_nameplate/nm00104.g4tx`

---

## gallery  (1 fichier)

### `gallery/gallery_config_1.03.71.00.cfg.bin.json`
- **`m_GalleryInfoList`** `GALLERY_INFO` (n=360) — champs : `galleryId` `imgPath` `thumbPath` `needTokenNum` `flgNo` `openCond`
  - `imgPath` : `img_story_ev01_main_0010`, `img_story_ev02_main_0010`, `img_story_ev02_main_0020`, `img_story_ev02_main_0030`, `img_story_ev02_main_0040`, `img_story_ev03_main_0010`
  - `thumbPath` : `thumb_story_ev01_main_0010`, `thumb_story_ev02_main_0010`, `thumb_story_ev02_main_0020`, `thumb_story_ev02_main_0030`, `thumb_story_ev02_main_0040`, `thumb_story_ev03_main_0010`

---

## trophy  (1 fichier)

### `trophy/trophy_config_0.00.00.00.cfg.bin.json`  _(entries=5)_
- listes : `TROPHY_REWARD_LIST_BEG_0`×384, `TROPHY_TIER_LIST_BEG_0`×872, `TROPHY_INFO_LIST_BEG_0`×460
- chaînes : `#/menu/220_img/activity_photo/<LG>/`, `activity_story_miniquest_001`, `鍵をなくしたおじいさん`, `activity_photo_01_001.g4tx`, `activity_note_01_001.g4tx`, `activity_story_miniquest_002`, `今日は大漁`, `activity_photo_01_002.g4tx`, `activity_note_01_002.g4tx`, `activity_story_miniquest_003`, `幸せはすぐそばに`, `activity_photo_01_003.g4tx`, `activity_note_01_003.g4tx`, `activity_story_miniquest_004`, `ホールインワン`, `activity_photo_01_004.g4tx`

---

## photo_mode  (1 fichier)

### `photo_mode/photo_mode_random_pose_config.cfg.bin.json`
- **`m_randomPoseList`** `RANDOM_POSE` (n=91) — champs : `charaBodyType` `motionNameCrc`

---

## common  (1 fichier)

### `common/npc_common.cfg.bin.json`  _(entries=11)_
- listes : `ACT_TYPE_BEGIN_0`×12, `ACT_TYPE_BEGIN_1`×5, `ACT_TYPE_BEGIN_2`×5
- chaînes : `action name`, `立ち1L`, `歩き1L`, `立ち1会話1L`, `走り1L`, `立ち1アイドリング1`, `旋回左1`, `旋回右1`, `旋回左2`, `旋回右2`, `common1`, `立ち2L`, `立ち2会話1L`, `立ち2アイドリング1入`, `common2`, `立ち3L`

---

## friendmap  (1 fichier)

### `friendmap/friendmap_config_0.00.00.cfg.bin.json`
- **`m_friendMapLineInfo`** `FRIENDMAP_LINE_INFO` (n=39) — champs : `lineNo` `lineElemAry`
- **`m_friendMapBaseInfo`** `FRIENDMAP_BASE_INFO` (n=4) — champs : `friendMapID` `startY` `startX` `lineInfo`

---

## movie  (1 fichier)

### `movie/movie_playing_config_1.02.28.cfg.bin.json`
- **`m_MovieSubtitleMenuDataList`** `MOVIE_SUBTITLE_MENU_DATA` (n=3) — champs : `subtitleId` `menuCrc` `layerCrc` `textLocateCrc` `usedGroupCrc` `layerBGCrc` `meshBGLocateCrc`
- **`m_MovieSongCaptionDataList`** `MOVIE_SONG_CAPTION_DATA` (n=0)
- **`m_MoviePlayingInfoList`** `MOVIE_PLAYING_INFO` (n=218) — champs : `movieId` `menuId` `captionId` `moviePath` `bgmName` `fedeInTime` `fedeOutTime` `staffrollDataName` `subtitleTextPath` `subtitleSettingPath` `notStopBgmOnMovieEnd` `fadeMethodType`
  - `moviePath` : `common/movie/ev90_00100.usm`, `common/movie/ev90_00150.usm`, `common/movie/ev01_04600.usm`, `common/movie/ev01_00100.usm`, `common/movie/ev01_00150.usm`, `common/movie/ev01_00200.usm`
  - `staffrollDataName` : `ed_01`, `ed_02`, `ed_03`, `ev01_00200`, `ev01_04800`, `cp_02`
  - `subtitleTextPath` : `common/text/<LG>/event/ev01_00150.cfg.bin`, `common/text/<LG>/event/ev01_00200.cfg.bin`, `common/text/<LG>/event/ev01_00400.cfg.bin`, `common/text/<LG>/event/ev01_00500.cfg.bin`, `common/text/<LG>/event/ev01_00800.cfg.bin`, `common/text/<LG>/event/ev01_01000.cfg.bin`
  - `subtitleSettingPath` : `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_00150.cfg…`, `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_00200.cfg…`, `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_00400.cfg…`, `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_00500.cfg…`, `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_00800.cfg…`, `common/gamedata/event/subtitle/<VLG>/Subtitle_ev01_01000.cfg…`

---

## capsule  (1 fichier)

### `capsule/capsule_config_0.00.00.cfg.bin.json`  _(entries=5)_
- listes : `CPSL_LOT_WEAPON_COLOR_TABLE_INFO_LIST_BEG_0`×1, `CPSL_PRIZE_INFO_LIST_BEG_0`×740, `CPSL_PRIZE_TABLE_INFO_LIST_BEG_0`×20, `CPSL_LOT_RANK_RATE_INFO_LIST_BEG_0`×4, `CPSL_CONFIG_INFO_LIST_BEG_0`×4

---

## setting_menu  (1 fichier)

### `setting_menu/setting_list_config_3.00.18.cfg.bin.json`  _(entries=11)_
- listes : `SETTING_INFO_LIST_BEG_0`×73, `KEYCONFIG_SETTING_INFO_LIST_BEG_0`×72, `SETTING_PLATFORM_TYPE_INFO_LIST_BEG_0`×7, `SETTING_OBJ_DATA_LIST_BEG_0`×58, `SETTING_OBJ_INFO_LIST_BEG_0`×58, `KEYCONFIG_MAPPING_LIST_MAPPING_DATA_LIST_BEG_0`×268, `KEYCONFIG_MAPPING_LIST_INFO_LIST_BEG_0`×172, `EXPLANATION_TEXT_LIST_TEXT_DATA_LIST_BEG_0`×91, `EXPLANATION_TEXT_LIST_INFO_LIST_BEG_0`×180, `PAD_GROUPKEY_LIST_DATA_LIST_BEG_0`×41, `PAD_GROUPKEY_LIST_INFO_LIST_BEG_0`×22

---

## live2d  (1 fichier)

### `live2d/live2d_res_info_0.00.00.cfg.bin.json`  _(entries=2)_
- listes : `L2D_RES_BASE_PATH_LIST_BEG_0`×1, `L2D_RES_INFO_LIST_BEG_0`×31
- chaînes : `common/live2d/`, `event/l2da/c00100000_l2da/c00100000_l2da/c00100000_l2da.…`, `event/l2df/c00100000_l2df/c00100000_l2df.objbin`, `event/l2da/c00200000_l2da/c00200000_l2da/c00200000_l2da.…`, `event/l2df/c00200000_l2df/c00200000_l2df.objbin`, `event/l2da/c00300000_l2da/c00300000_l2da/c00300000_l2da.…`, `event/l2df/c00300000_l2df/c00300000_l2df.objbin`, `event/l2da/c00400000_l2da/c00400000_l2da/c00400000_l2da.…`, `event/l2df/c00400000_l2df/c00400000_l2df.objbin`, `event/l2da/c00500000_l2da/c00500000_l2da/c00500000_l2da.…`, `event/l2df/c00500000_l2df/c00500000_l2df.objbin`, `event/l2da/c00600000_l2da/c00600000_l2da/c00600000_l2da.…`, `event/l2df/c00600000_l2df/c00600000_l2df.objbin`, `event/l2da/c00700000_l2da/c00700000_l2da/c00700000_l2da.…`, `event/l2df/c00700000_l2df/c00700000_l2df.objbin`, `event/l2da/c00800000_l2da/c00800000_l2da/c00800000_l2da.…`

---

## nfc  (1 fichier)

### `nfc/nfc_lottery_config.cfg.bin.json`  _(entries=4)_
- listes : `NFC_LOTTERY_INFO_LIST_BEG_0`×3, `NFC_QUANTITY_INFO_LIST_BEG_0`×33, `NFC_INFO_LIST_BEG_0`×617

---

## banner  (1 fichier)

### `banner/tutorial_banner_config_0.00.00.cfg.bin.json`
- **`m_tutorialBannerInfoList`** `TUTORIAL_BANNER_INFO` (n=3) — champs : `id` `titleTextId` `explainTextId` `iconTextureName` `count` `flagNum`

---

## shop  (1 fichier)

### `shop/shop_config_3.00.22.cfg.bin.json`  _(entries=5)_
- listes : `SHOP_INFO_LIST_BEG_0`×15, `SHOP_TOKEN_GROUP_LIST_BEG_0`×7, `SHOP_BASARA_SPIRIT_LIST_BEG_0`×84, `SHOP_BASARA_GROUP_LIST_BEG_0`×12
- chaînes : `shop_market_04.g4tx`, `shop_market_03.g4tx`, `shop_market_01.g4tx`, `shop_market_02.g4tx`, `shop_story_01.g4tx`, `shop_story_02.g4tx`, `shop_story_03.g4tx`, `shop_story_04.g4tx`, `shop_story_05.g4tx`, `shop_story_06.g4tx`, `shop_story_07.g4tx`, `shop_market_05.g4tx`, `shop_market_06.g4tx`, `#/menu/220_img/shop_img/`

---

## debug  (1 fichier)

### `debug/map/map_route_config_dbg.cfg.bin.json`  _(entries=2)_
- listes : `MAP_ROUTE_INFO_LIST_BEG_0`×166, `MAP_ROUTE_CFG_LIST_BEG_0`×26
- chaînes : `MJ_w01_to_d01__1`, `マップジャンプ`, `エリア1`, `d01`, `MJ_d01_to_w01__1`, `MJ_w01_to_d01__2`, `MJ_d01_to_w01__2`, `エリア19`, `MJ_w01_to_d01__3`, `MJ_d01_to_w01__3`, `エリア13`, `MJ_w01_to_d01__4`, `エリア2`, `MJ_d01_to_w01__4`, `エリア6`, `MJ_w01_to_d01__5`

---

## update_notice  (1 fichier)

### `update_notice/update_notice_config_0.00.00.cfg.bin.json`
- **`m_updateNoticeDataList`** `UPDATE_NOTICE_DATA` (n=26) — champs : `textureName` `textId`
- **`m_updateNoticeInfoList`** `UPDATE_NOTICE_INFO` (n=4) — champs : `updateId` `globalBitFlagId` `updateNoticeData` `enableCond`

---
