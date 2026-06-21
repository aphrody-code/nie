# event-scripts

Famille `data/common/gamedata/event/**/*.json` — **1375 fichiers JSON** (dumps des `*.cfg.bin` RDBN du jeu). C'est le cœur du **mode histoire / scènes de dialogue / cinématiques** d'IEVR : sous-titres temporisés, données de portraits parlants (bustup), environnements de scène, presets caméra, films, replacements de tags, etc.

Tous ces JSON sont des dumps d'un même conteneur Level-5 (RDBN cfg.bin) qui se présente sous **deux schémas de sérialisation** :

| Schéma | Forme JSON | Fichiers |
|---|---|---|
| **entries / children** (brut, non typé) | `{ "entries": [ { "name", "variables":[{type,value}], "children":[…] } ] }` — 1ʳᵉ entrée = `*_LIST_BEG_*` portant le compte ; lignes réelles = ses `children` ; types `Int` / `Float` / `String` | 1321 subtitle + 34 bustup_talk_data + 12 configs |
| **version / lists / values** (typé, champs nommés) | `{ "version":100, "lists":[ { "name", "typeName", "values":[ {champ:valeur} ] } ] }` ; hashes en `"0x…"`, vecteurs en tableaux | 8 configs |

Répartition des 1375 fichiers :

| Groupe | Nb fichiers | Contenu |
|---|---|---|
| `subtitle/<lang>/Subtitle_*` | 1321 | timing des sous-titres par scène, 9 langues |
| `event_bustup_talk_data_config_c<NNN>` | 34 | données de portrait parlant, par personnage |
| `event_general_bustup_talk_data_config_c40` | 1 | bustup générique (PNJ) |
| autres configs (`event_*`, `scenario_*`, `select_member_*`) | 19 | environnements, caméra, films, tags, timezone… |

> **Constat anti-hallucination important** : le **texte des dialogues n'est PAS dans cette famille**. Les sous-titres référencent leur texte par **hash CRC32** (champ `Int`) ; aucun nœud `TEXT_INFO [Int, Int, String]` n'existe dans tout l'arbre `event/` (scan : 0 trouvé), et aucun fichier subtitle ne contient de `String` (scan : `hasString=false`). Ces JSON portent la **mise en scène et le timing**, pas les libellés affichés.

---

## subtitle/ — sous-titres temporisés (1321 fichiers)

Un fichier par scène et par langue : `subtitle/<lang>/Subtitle_<evXX>_<NNNNN>.cfg.bin.json`.

- **Langues (9)** : `de, en, es, fr, it, ja, pt, zh_hans, zh_hant`.
- **Comptes par langue** : `de/es/fr/it/pt` = 153 fichiers / 2093 lignes ; `en/ja/zh_hans/zh_hant` = 139 fichiers / 1992 lignes.
- **Total** : 1321 fichiers, **18 433 lignes de sous-titre**.
- **Scènes couvertes (15 préfixes `ev`)** : `ev01, ev02, ev03, ev04, ev05, ev06, ev07, ev08, ev09, ev15, ev20, ev73, ev74, ev75, ev90`.

Structure : entrée `EV_SUBTITLE_DATA_LIST_BEG_0` (variable = compte) → children `EV_SUBTITLE_DATA_<n>`. Chaque ligne = **1 `Int` + 4 nombres de timing**.

| Champ | Type | Sens (observé) |
|---|---|---|
| var[0] | `Int` | hash CRC32 du texte du sous-titre (ex. `-721745706`, `1033416163`) — clé vers le libellé localisé, hors de cette famille |
| var[1..4] | `Float`/`Int` | 4 marqueurs temporels (apparition/maintien/disparition), ex. `9.833333 / 13.283334 / 9.833333 / 13.333333` |

Les 4 valeurs sont majoritairement `Float` mais peuvent être `Int` quand entières — d'où plusieurs signatures observées (la dominante `Int,Float,Float,Float,Float` couvre 14 661 / 18 433 lignes ; variantes comme `Int,Int,Float,Int,Float`, `Int,Int,Int,Int,Int`, etc. pour le reste).

---

## event_bustup_talk_data_config_c<NNN> — portraits parlants (34 fichiers + 1 générique)

Un fichier par personnage : codes présents `c16, c20, c21, c22, c23, c24, c25, c26, c2700–c2712, c2801–c2812, c40`. **228 438 lignes** cumulées sur les 34 fichiers.

Sections (exemple `c16`) :

| Section | Nb lignes (c16) | Rôle |
|---|---|---|
| `EV_BUSTUP_TALK_DATA_CHR_1_LIST_BEG_0` | 43 | variantes de portrait niveau 1 |
| `EV_BUSTUP_TALK_DATA_CHR_2_LIST_BEG_0` | 36 | niveau 2 |
| `EV_BUSTUP_TALK_DATA_CHR_3_LIST_BEG_0` | 12 | niveau 3 |
| `EV_BUSTUP_TALK_DATA_CHR_4_LIST_BEG_0` | 12 | niveau 4 |
| `EV_BUSTUP_TALK_DATA_BODY_LIST_BEG_0` | 688 | corps de données (poses/expressions par réplique) |
| `EV_BUSTUP_TALK_DATA_CONFIG_LIST_BEG_0` | 12 | config |

Chaque ligne `CHR_*` = ~46 colonnes : 7 `Int`, puis **3 `String` = chemins `.g4pk`** (modèle de pose + visage + bouche), puis ~36 `Int`. Exemples réels de chemins (c16) :

```
common/chr/c000101/c000101_p020.g4pk
common/chr/c000101/c000101_p200.g4pk
common/chr/c000101/c000101_p250.g4pk
common/chr/c000101/c000101_p061.g4pk
```

Le fichier générique `event_general_bustup_talk_data_config_c40` (1587 lignes, section `EV_GENERAL_BUSTUP_TALK_DATA_CONFIG`) mélange chemins de modèles `common/chr/…` et de **motions d'événement** `common/event/ev_mot/cXXXXXX/…_pd.g4pk` (ex. `c000101_00_b10_ofn001def001pd.g4pk`).

---

## event_bustup_talk_config — mise en scène des fenêtres de dialogue

`event_bustup_talk_config_1.03.59` — 7 sections, schéma entries :

| Section | Lignes | Signature / contenu |
|---|---|---|
| `EV_BUSTUP_TALK_WIN_EFF_DEF` | 240 | `Int×4` — effets de fenêtre |
| `EV_BUSTUP_TALK_EFF_PLACE_INFO` | 57 | `Int,Float×3,Int×6` — placement d'effets |
| `EV_BUSTUP_TALK_WIN_EFF_DETAIL_INFO` | 72 | `Int×2,Float×3,Int×5` |
| `EV_BUSTUP_LIGHT_BASE_PATH` | 1 | String = `common/property/light/` |
| `EV_BUSTUP_LIGHT_INFO` | 53 | `Int,String` — 53 presets de lumière 2D |
| `EV_BUSTUP_TALK_PRESET_CHARA` | 7694 | 51 colonnes (Int + 2 Float) — presets de placement perso |
| `EV_BUSTUP_TALK_PRESET_INFO` | 1140 | `Int×2` — index des presets |

Libellés de lumière (`EV_BUSTUP_LIGHT_INFO`, échantillon) : `light_2d_bustup_event.cfg.bin`, `light_2d_bustup_event_old.cfg.bin`, `light_2d_bustup_event_daytime.cfg.bin`, `light_2d_bustup_event_daytime_nonfilter.cfg.bin`, `light_2d_bustup_event_cloudy.cfg.bin`, `light_2d_bustup_event_evening.cfg.bin`.

## event_bustup_talk_sound_data_config — voix/SE des dialogues

`event_bustup_talk_sound_data_config_1.02.92` — 2 sections :

| Section | Lignes | Signature |
|---|---|---|
| `EV_BUSTUP_TALK_SOUND_DATA_BODY` | 2693 | `Int×9, String, Int×3` |
| `EV_BUSTUP_TALK_SOUND_DATA_CONFIG` | 2520 | `Int×3` |

Le `String` (769 valeurs distinctes) = identifiants de cue son/scène : ex. `ev21_01100_1`, `bg90080`, `ev23_02000_1`, `bg90030`, `ev20_01`, `ev23_03180_1`.

---

## event_env_config_* — environnements de scène (3 fichiers)

`event_env_config_{quest, scenario, soccer_demo}_0.00.32` — même schéma `EVENT_ENV_CONFIG`, 55 colonnes :

| Fichier | Lignes |
|---|---|
| `event_env_config_quest` | 69 |
| `event_env_config_scenario` | 659 |
| `event_env_config_soccer_demo` | 1412 |

Colonnes : `Int` (hash event) ` | String` (**id de scène** ex. `ev01_00050`) ` | ` ~40 `Int` (flags) ` | String` (**tag d'env/groupe** ex. `ev01`) ` | ` 12 `Int`. Les chaînes incluent aussi des **backgrounds** `bg*` (ex. `bg50030, bg50031, bg50050, bg50040, bg99999, bg60290`). Exemple de ligne (scenario row 0) :

```
hash=-797635319 | scene=ev01_00050 | flags… | tag=ev01 | flags…
```

---

## Configs typées (schéma version/lists/values)

### event_movie_config (0.00.00 et 0.05.08) — cinématiques

3 listes. `EVENT_MOVIE_INFO` (4 films) — champs `eventId, menuId, captionId, moviePath, bgmName, fedeInTime, fedeOutTime, staffrollDataName` :

| moviePath | staffroll | bgm |
|---|---|---|
| `common/movie/yw-y1_evop_0010.usm` | — | `0xC1EEF2A7` |
| `common/movie/yw-y1_evop_0020.usm` | `op_01` | `0x6BA84291` |
| `common/movie/yw-y1_evop_0010.usm` | — | `0x40851152` |
| `common/movie/yw-y1_eved_0010.usm` | `ed_01` | `0x7CB20E91` |

`EVENT_SONG_CAPTION_DATA` (2) — `captionId, startFrame, endFrame, captionName` : `telop_ev01_2501` (220→453), `telop_ev01_2511` (390→673). `EVENT_SUBTITLE_MENU_DATA` (3) — `subtitleId, menuCrc, layerCrc, textLocateCrc, usedGroupCrc`.

### select_member_event_config_1.03.99 — mise en scène « sélection de membre »

6 listes : `SelectMemberCameraParam` (1040 : `charaId, cameraPos[4], cameraRef[4], cameraFov, cameraRoll`), `SelectMemberCameraInfo` (65), `SelectMemberMotionParam` (1981 : `charaId, motion, motionFilePath`), `SelectMemberMotionInfo` (124), `SelectMemberLayoutParam` (63 : `charaId, pos[4], rotY, scale`), `SelectMemberLayoutInfo` (38). Chemins motion réels : `common/event/ev_mot/c000101/c000101_00_b10_std001def001pd.g4pk`.

### scenario_soccer_demo_config_1.03.06.00 — démos de match scénarisées

`SCENARIO_SOCCER_DEMO_DATA` (1355 : `userList, opponentList` — hashes d'équipes) et `SCENARIO_SOCCER_DEMO_INFO` (1444 : `id, eventId, userTeam, assignData[2], ballAuraColor, skillRank, skillId`). Exemple : `{id:0x839299FE, eventId:0xC41C9274, userTeam:"01", ballAuraColor:"FF", skillId:0x00000000}`.

### event_map_tag_config_0.00.00 — tags de carte par event

4 listes : `EVENT_MAP_TAG_DATA` (98 : `mapTagName, invisible`), `EVENT_MAP_TAG_INFO` (43 : `id, data[2]`), `EVENT_MAP_TAG_INFO_ID` (200 : `tagId`), `EVENT_MAP_TAG_SETTING_INFO` (147 : `eventId, tagIdListRef[2]`). Pilote la visibilité d'objets de map par scène (ex. `{mapTagName:0x705841BC, invisible:true}`).

### event_skill_direction_1.03.78.00 — animation jauge gardien

`EventKeeperHPAnimeConfig` (25) : `ev_id, gauge_anime_start, competition_duration, competition_end_duration`. Ex. `{ev_id:0x3C6824A7, gauge_anime_start:60, competition_duration:15, competition_end_duration:9}`.

### event_searcheye_overwrite_0.00.10 — caméra « search eye »

`SEARCH_EYE_OVERWRITE` (23) : `ev_id, ev_id_str, camera_type, map_id, posX, posY, posZ, rotY`. Scènes : `ev00_90500, ev07_00310…ev07_00370, ev73_00160…ev73_00300`. Ex. `{ev_id_str:"ev07_00310", camera_type:0x58C87384, posX:-27.138, posY:5.9, posZ:-130.775, rotY:29.209}`.

### event_replace_file_tag_config — substitution de fichiers

`EV_FILE_TAG_DATA` (25 : `replaceId, replaceStr`) + `EV_FILE_TAG_INFO` (2 : `typeId, m_refReplaceInfo[2]`). Ex. `{replaceId:0xD4B45A92, replaceStr:"i00610000"}`, `{0x3DD7FFA7 → "i00610010"}`.

---

## Petites configs (schéma entries)

| Fichier | Section / lignes | Contenu réel |
|---|---|---|
| `event_timezone_config_0.00.00` | `DETAIL_TIMEZONE_DATA` (7) | tranches horaires : `0→4h`, `1→6h(5.5)`, `2→8h`, `3→16h`, `4→18h(18.5)`, `5→24h`, sentinelle `6` |
| `event_fld_def` | `EVENT_FLD_DEF` (11) | `Int,String` : 11 entrées étiquetées `evt` ou `other` (1:evt, 2:other, 7:evt, 9:evt, 10:evt…) |
| `event_cmnd_config_0.00.00` | `EV_CMND_INFO_DATA` (93) | 93 `Int` = hashes de commandes d'événement (ex. `-711910290, 466468138, 896822880…`) |
| `event_model_config` | `EV_MDL_DEF_DATA` (1) | `Int,String` : `ei100001` |
| `event_cam_preset_config` | `EVENT_CAM_PRESET_CONFIG` (2) | `Int×9` — presets caméra |
| `event_tag_word_replace_config_1.02.54` | 6 sections (voir ci-dessous) | remplacement de mots/tags variables |

`event_tag_word_replace_config` — 6 sections : `EVENT_VARIATION_TAG_WORD_REPLACE_TARGET` (32, `Int×4`), `…_INFO` (4), `EVENT_ASSIGN_TAG_WORD_REPLACE_TARGET` (106, `Int,String`), `…_INFO` (18), `EVENT_ASSIGN_SND_TAG_WORD_REPLACE_TARGET` (143, `Int,String`), `…_INFO` (14). Les `String` sont des codes Keshin/assign `k000180, k000190, k000200, k000210, k000010, k000330, k000990…` (71 et 142 distincts).
