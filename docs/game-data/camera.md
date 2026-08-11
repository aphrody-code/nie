# Caméra — modèle complet (RE `nie.exe` + données)

Reversé sur le binaire **local** `nie.exe` (33 918 464 o, image base `0x140000000`, sections
`.text 0x140001000-0x14186B6E0`, `.rdata 0x14186C000-0x141C9E0CE`, `.data 0x141C9F000-0x14265694C`).
Toutes les VA de ce document sont **spécifiques à ce build**.

Source : extraction des 513 chaînes contenant `amera`, des noms RTTI MSVC (`.?AV…@game@@` /
`@lives@@`), et désassemblage ciblé des dispatchers Lua.

---

## 1. Hiérarchie de classes (RTTI, exacte)

Déduite des symboles `TAddPropertyCreator<Dérivée, Base>` — la relation est donc **prouvée**, pas
inférée du nom.

```
lives::CCamera                       (objet caméra ; TObjectInterface<CCamera, TComponent<CCameraCtrl>>)
lives::CCameraCtrl                   (composant contrôleur — racine de la hiérarchie)
├── lives::CCameraAnimeCtrl          (lecture d'anim caméra)
├── game::CGameCameraBlender         (fondu/blend entre deux contrôleurs)
└── game::CGameCameraCtrl            (base jeu ; game::CGameCamera + game::CGameCameraParam)
    ├── CCameraCtrlEvent             (cutscene / .g4cm)
    ├── CCameraCtrlFixPos            (position fixe)
    ├── CCameraCtrlFps               (vue subjective)
    ├── CCameraCtrlInterPolate       (interpolation entre états)
    ├── CCameraCtrlMenu              (menus 2D/3D)
    ├── CCameraCtrlNearFar           (pilotage des plans de clipping)
    ├── CCameraCtrlOffset            (décalage additif)
    ├── CCameraCtrlPickUp            (mise en avant d'une cible)
    ├── CCameraCtrlRail              (rail — cf. GDSRailCamera)
    ├── CCameraCtrlSelfie            (mode photo / selfie)
    ├── CCameraCtrlShake             (tremblement)
    ├── CCameraCtrlShooting          (tir)
    ├── CCameraCtrlSoccerMenu        (menus en match)
    ├── CCameraCtrlSpecialAttack     (hissatsu)
    ├── CGameCameraAnimeCtrl         (anim caméra jeu)
    ├── CGameCameraAnimeRateCtrl     (anim caméra à vitesse variable)
    └── CCameraCtrlChaseBase         (poursuite — base)
        ├── CCameraCtrlChase         (poursuite générique)
        └── CCameraCtrlChaseSoccer   (poursuite ballon/joueur en match)
```

Annexes :

- `lives::CObjModelCameraComponent` — composant de modèle **portant** une caméra (c'est lui que
  référence `m_cameraName` dans les `.objbin` de menu, cf. §6).
- `lives::CResExternalCameraData` — ressource caméra externe (`common/camera/config/external_camera_config.cfg.bin`).
- `lives::IHandleManager32<game::CameraWorkInfo>` — pool de « camera work » (handles 32 bits).
- `game::CEffectLightData::CAMERA_FADE` — fondu de lumière piloté caméra.

## 2. Structures de données (RTTI `game::`)

| Struct | Liste porteuse | Rôle |
|---|---|---|
| `SOCCER_CAMERA_INFO` / `_DATA` | `m_soccerCameraInfoList` (54) / `m_soccerCameraInfoDataList` (138) | jeux de paramètres de caméra de match |
| `SOCCER_DIR_CAMERA_INFO` | `m_soccerDirCameraInfoList` | caméra directionnelle (mise en scène) |
| `SOCCER_FIX_POS_CAMERA_INFO` / `_DATA` | `m_soccerFixPosCameraInfoList` / `…DataList` (21) | caméras à poste fixe |
| `ScAerialCameraInfo` / `ScAerialCameraMapInfo` | `m_scAerialCameraInfoList` / `m_scAerialCameraMapInfoList` (108) | vues aériennes par stade |
| `ScGoalnetCameraInfo` | `m_scGoalnetCameraInfoList` (8) | caméras derrière les filets |
| `CINEMATIC_CAMERA_INFO` / `_DATA` / `_SITUATION_INFO` | `m_cinematicCameraInfoList` / `…DataList` (15) / `…SituationInfoList` | caméras cinématiques et leur situation de déclenchement |
| `MAP_CAMERA_CONFIG` | — | caméra de map/exploration |
| `SelectMemberCameraParam` / `Info` | `m_SelectMemberCameraParamList` (1040) / `m_SelectMemberCameraInfoList` (65) | cadrage par personnage à la sélection (`charaId, cameraPos[4], cameraRef[4], cameraFov, cameraRoll`) |
| `RpgBattleCameraInfo` / `RpgBattleAttackCameraInfo` | `rpg_battle_camera_info.cfg.bin` | caméras de combat RPG |

Properties (`CProperty`) : `SoccerCameraProperty`, `SoccerCameraInterpProperty`.
GDS (game data source) : `GDSSoccerCameraConfig`, `GDSEventCameraPresetConfig`,
`GDSEventGeneralCameraOffsetConfig`, `GDSRailCamera`.

## 3. Fichiers de données (chemins en dur dans `.rdata`)

```
common/camera/config/external_camera_config.cfg.bin
common/property/camera/camera_ctrl_property_info.cfg.bin
common/property/camera/camera_ctrl_property_info_battle.cfg.bin
common/property/camera/camera_ctrl_property_info_craft_edit.cfg.bin
common/property/camera/camera_ctrl_property_info_photo.cfg.bin
common/property/camera/camera_ctrl_property_info_rpg_battle.cfg.bin
common/property/camera/camera_ctrl_property_info_screenshot_mode.cfg.bin
common/property/soccer/soccer_camera_property.cfg.bin
common/property/soccer/soccer_camera_interp_property.cfg.bin
common/property/rpg_battle/rpg_battle_camera_info.cfg.bin
common/property/global_param/battle_kill_camera_param.cfg.bin
common/gamedata/soccer/soccer_camera_config_1.03.21.cfg.bin      (13 listes)
common/gamedata/event/event_cam_preset_config.cfg.bin            (EventCameraPresetConfig)
common/gamedata/event/event_general_camera_offset_config.cfg.bin (EventGeneralCameraOffsetConfig)
common/script/lua/menu/camera_option_menu_0.03.73.lua.bin
common/script/lua/menu/camera_option_menu_shortcut_0.02.80.lua.bin
common/script/lua/menu/replay_camera_menu_0.00.00.00.lua.bin
common/event/ev72/ev72_01010/ev72_01010_camera.g4cm   (SoccerFormationEventCameraAnime)
common/event/ev72/ev72_03090/ev72_03090_camera.g4cm   (SoccerBattleStartCameraAnime)
common/event/ev72/ev72_10310/ev72_10310_camera.g4cm   (RpgBattleStartEventCameraAnime)
common/event/ev72/ev72_50010/ev72_50010_camera.g4cm   (RpgBattleDanceBattleCameraAnime)
```

Le dernier bloc montre que **4 `.g4cm` sont référencés par nom depuis le binaire** (anims caméra
« système »), les 1 206 autres étant résolus par convention `event/<ev>/<ev>_camera.g4cm`.

Un `common/property/camera/…` par **contexte** ⇒ `CCameraCtrl*` est paramétré par jeu de propriétés
selon le mode (jeu, battle, craft edit, photo, rpg battle, screenshot mode).

## 4. Paramètres (extrait typé des ~250 champs)

**Poursuite / match** — `cameraChaseLengthRate`, `isEnableCameraChase`, `isCameraChasePassBall`,
`isChaseMoveSoccerCamera`, `chaseCameraDefaultLength`, `chaseCameraDefaultMinX/MaxX`,
`chaseCameraCharaWidth/Hegiht` *(sic)*, `cameraRefBallChaseRate`,
`chaseDefenseCtrlCharaCameraBallChaseRate`, `isEnableChaseCameraRefTargetZRate`,
`cameraRefOffensiveDirMin/MaxOffset(+FrontLen)`, `soccerCameraMoveSpeedRate`,
`soccerCameraMoveReturnInterpRate`, `soccerCameraLoopTime`, `soccerCameraDrugLoopTime`,
`fSoccerCameraReachLength`, `uSoccerCameraLengthType`, `soccerCameraNo`,
`manuallyChangeSoccerCameraNo`, `changeSoccerCameraNo`, `changeCameraAfterKickOffDelayTime`.

**Tir / shake** — `shootCameraLargeShake{AmplitudeX,AmplitudeY,PeriodX,PeriodY,Time,IntervalMin/MaxTime}`,
idem `…SmallShake…`, `shootCameraShakeRefOffset{Min,Max,InTime,OutTime,MaxLoopTime,IntervalMin/MaxTime}`,
`shootCameraShakeRoll{Min,Max,InTime,OutTime,MaxLoopTime,IntervalMin/MaxTime}`,
`shootCameraShakeNormalShootPowerRate`, `shootCameraShakeDefensePowerRate`,
`shootCameraShakeReachMaxLen`, `isEnableShootCameraShake`, `isEnableDirectShootCamera`,
`defenseShootCameraRotateTime`, `shootChainDecideCameraRotateTime/BallLookRate`,
`hitDefenseWallCameraDistance/InterpTime`.

**Buts / filets** — `selfGoalnetCameraPosX/Y/Z`, `enemyGoalnetCameraPosX/Y/Z`,
`goalNetReturnInPlayCameraWaitTime`, `grounderResultCameraMoveWaitTime`,
`highBallResultCameraMoveWaitTime`, `resultCameraPassTargetLookRate`.

**Mise en scène directionnelle** — `soccerDirectionCameraPosX/Y/Z`, `…RotXStart/End`,
`…RotYStart/End`, `…Length`, `…HalfTime`, `…MaxTime`, `…VSTime`.

**Scramble / zone / invocation** — `scrambleCameraMidTargetPosY`, `scrambleCameraEndTarget{PosY,LookPosY,VariationPosYMin/Max}`,
`isEnableScrambleCamera`, `zoneEffectCamera{Fov,Length,Altitude,TargetOffset}`,
`summonPerformanceCamera{PosStart,PosEnd}_{FW,MF,DF,GK}`, `summonPerformanceCameraViewAngleStart/End(+FadeType)`,
`summonPerformanceCameraMoveStartTime/MoveTime/MoveFadeType`.

**Coach AI / entraînement** — `coachAICameraZoomSpeed`, `coachAIWheelCameraZoomSpeed`,
`coachAIKickoffCameraLength`, `coachAICameraChangeTelopDispTime`,
`dribbleTrainingEnemyHitCameraMoveStart/EndWaitTime`, `kiaiCatchCameraLengthOppTeamKeeper`,
`freeKickCameraBaseCharaCheckAngle`, `commandTechnicCameraZoomLength`.

**Contrôleur générique (`m_*`, `CCameraCtrl`)** — `m_cameraParam`, `m_cameraRefPosOffset`,
`m_vCameraRefOffset`, `m_fCameraRefMin/MaxOffset`, `m_fCameraRefCenterRate(Y)`,
`m_fCameraRotSpeedX/Y`, `m_fCameraMoveAutoRotRateX/Y`, `m_fCameraMoveAutoRotRange`, `m_fCameraWidth`,
`m_isCheckCameraCollision`, `m_isCheckCraftCameraCollision`, `m_cameraPosDistanceFromRefPos`,
`m_cameraAzimuth`, `m_cameraAltitude`, `m_cameraFov`, `m_cameraRoll`,
`m_localCameraPos(Base|Offset)`, `m_worldCameraPos`, `m_menuCameraNameCrc`, `m_cameraName`.

**Fade / clipping / post-effect** — `m_cameraFadeTime/Height/Radius`, `m_isCameraNear/FarFade`,
`m_cameraNear/FarFadeIn/OutDistance`, `cameraFadeNear/Far`, `defaultCameraFadeNear/Far`,
`resetCameraNear/Far`, `evResetParamCameraNear/Far`, `overwriteCameraClipParam_nearClip/_checkHeight`,
`cameraDLODON/OFFLength`, `camera_collision_fade`, `MapEff_CameraFade`, `cameraPostEffectFadeTime`,
et 13 bascules `changeCameraPostEffect{AA,Bloom,ColorGrading,DOF,Edge,LensFlare,MotionBlur,RainEffect,SSAO,SSR,SunShaft,ToneMap,Vignette}`
— **le changement de caméra reconfigure la chaîne de post-process**.

**Entrées joueur / options** — `CameraAdjustLR`, `CameraAdjustUD`, `CameraRevrseLR`, `CameraRevrseUD`
*(sic)*, `CameraSpeedMouse`, `CameraSpeedPadHorizontal/Vertical`, `cameraSpeedKeyboard`,
`cameraSpeedPad(RateH|RateV)`, `cameraSpeedMouseRate`, `baseCameraSpeedMouseRate`,
`soccerCtrlCameraRotateSpeedRate_PCMouse` / `_OunceMouse`, `cameraZoomInOutRollReverse`,
`isSoccerSaveCameraIdx`, `soccerCameraOffsetBgnIdx/EndIdx`, `rpgCameraOffsetBgnIdx/EndIdx`,
`touchSwipeCameraEnable`, `touchDoubleSwipeCameraEnable`, `touchPinchCameraEnable`,
`touchPinchParamCameraRate`, `touchCameraVirtualStickAnalogLengthBase/MaxScale`,
`BattleCameraLengthType`, `SoccerShootCameraShake`.

**Mode photo** — `photoModeCameraParallelMoveVal/Limit`, `photo_camera_collision`,
`overwriteHoldCraftObjCameraParam_{rotMinXDeg,rotMaxXDeg,startRotXDeg,cameraLengthChangeRange}`.

**HUD ancré caméra** — `damagePopupOffsetX/YfromCamera`, `specialPopupOffsetX/YfromCamera`,
`trainingParameterPopupOffsetX/YfromCamera`, `charaCardTrainingParameterPopupOffsetX/YfromCamera`,
`winJankenPopupOffsetX/YfromCamera` — les popups sont positionnés **en espace caméra**, pas écran.

## 5. Commandes d'entrée et API Lua

**Commandes d'input** (`CMD_*`, table de binding) : `CMD_CAMERA_MOVE_X/Y`,
`CMD_CAMERA_MOVE_UP/DOWN/LEFT/RIGHT`, `CMD_CAMERA_PARALLEL_MOVE_UP/DOWN/LEFT/RIGHT`,
`CMD_CAMERA_PARALLEL_MOVE_LX/LY`, `CMD_CAMERA_ZOOM_IN/OUT`, `CMD_CAMERA_LEN_OFS_INC/DEC/ROLL/RESET`,
`CMD_CAMERA_RESET`, `CMD_CAMERA_REVERSE`, `CMD_MOUSE_CAMERA_MOVE`,
`CMD_CHANGE_SOCCER_CAMERA_TYPE`, `CMD_COACH_AI_CAMERA_MOVE_X/Y`,
`CMD_COACH_AI_FREE_MOVE_CAMERA_MOVE_X/Y`, `CMD_CRAFT_CAMERA_ZOOM_IN/OUT`.

**Commandes Lua natives nommées** : `ChangeReplayCinematicCamera`, `SetVisibleCinematicCamera`,
`IsVisibleFreeCameraCenterMarker`, `SetVisibleFreeCameraCenterMarker`, `ChangeVisibleCameraFrame`,
`SetCoachAIFreeMoveCamera`, `UpdateCameraType`, `UpdateLongShotCameraState`.

**Caméras nommées (scène)** : `BaseCamera` (enregistrée à l'init via `FUN_140b0f730("BaseCamera",
0xffffffff, 1)`), `EventCamera`, `MenuCamera`, `MenuCameraDefault`, `RpgCamera`, `RpgBattleCamera`,
`SoccerCamera`, `WaitCamera`. Global params : `SoccerCameraGlobalParam`, `RpgBattleCameraGlobalParam`.
Hooks de scène : `CSceneRpg300::PreCamera`, `CSceneRpg310::PostCamera`.
Code d'erreur d'init : `ErrorCode_Init_CameraUtility`.

### 5.1 `funcLuaCameraCommand` — dispatch (build local)

| Élément | Valeur (ce build) |
|---|---|
| chaîne du nom | `0x141900EC8` |
| enregistrement Lua | `0x140BE9730` (`lea` du nom), closure `0x140BE66F0` |
| entrée `lua_CFunction` | `0x140BE66F0` ; variante interne `0x140BE6780` |
| table de dispatch | `0x1422B3380` (**BSS** de `.data`) |
| nombre de commandes | **46** (`mov r9d, 0x2E`) |
| routine de dispatch | `0x140CA7550`, partagée par les **15** dispatchers |

Format réel du dispatch (désassemblé) : la table est un tableau de **pointeurs 8 octets**
(`mov rcx, [rbx+rax*8]`) vers des entrées de 16 octets `{handler:u64, cmdId:u32, pad:u32}` ; la
recherche est **dichotomique** sur `cmdId` lu à `[entrée+8]`, le `cmdId` cible étant converti depuis
un double Lua (`lua_tonumber` → `cvttsd2si`).

Carte complète des dispatchers de ce build (table BSS, count) :

| dispatcher | table | count |
|---|---|---|
| action | `0x1422B32B0` | 26 |
| **camera** | `0x1422B3380` | **46** |
| command | `0x1422B34F0` | 2451 |
| effect | `0x1422B8190` | 48 |
| menu | `0x1422B8320` | 1150 |
| (10 autres) | `0x1422BA710` … `0x1422BAE80` | 11, 9, 3, 1, 39, 5, 28, 8, 2, 18 |

> ⚠️ **Correction à `docs/game-data/re-derived.md`.** Sur ce binaire les tables de dispatch sont en
> **BSS** : elles sont **construites au runtime** (pointeurs + tri sur place), et non lisibles
> statiquement. Le bloc `.data` initialisé `0x141CB5500` (3 660 entrées `{handler, cmdId, pad}`) est
> le **réservoir global** de toutes les commandes, **non segmenté par dispatcher** : les handlers y
> sont rangés par adresse décroissante (`0x140CA7390` → `0x140CA2740`), sans frontière observable
> entre sections. `data/re/funclua-cmdid-handlers.json` est donc ce réservoir entier, pas la table
> menu. **Conséquence : les 46 `cmdId` caméra ne sont pas isolables statiquement** — il faut soit
> tracer le remplissage runtime, soit poser un breakpoint sur `0x140CA7550` avec `r8 == 0x1422B3380`.
> Les commandes caméra Lua sont de toute façon quasi absentes des scripts : **2 occurrences** de
> `funcLuaCameraCommand` sur les 676 `.lua` décompilés locaux, toutes deux du bruit de décompilation
> (`soccer_pk_menu`, `soccer_zone_menu`).

## 6. Format `.g4cm` — anim caméra de cutscene (**reversé**)

1 215 fichiers dans le VFS. Structure entièrement établie et implémentée dans
`crates/engine/nie-camera/src/g4cm.rs` : **1 215/1 215 en round-trip byte-exact**
(`nie-cam verify`).

```text
  0x00  en-tête Level-5 : magic 'G4CM' · header_size 0x40 · VERSION 0x68 · endian · align 16
  0x20  13 × u16 : compteurs et offsets de sections
  0x40  clips        : nobj × 16 o  {start_frame, end_frame, index, flags, +8 o}
        params       : bloc de taille variable (f32 de réglage + 2 mots type hash)
  c[10] table de noms : nobj × u16 d'offsets (alignés 4), puis chaînes ASCII zéro-terminées
  c[2]  table d'objets: n × 8 o {u16, u16 premier_canal, u32 nb_canaux}
  c[3]  canaux       : total × 20 o {kind, mode, comp/size ×2, index, time_index, value_off, count}
  ...   temps        : u16[] partagés, indexés par `time_index`
  ...   valeurs      : flux contigu découpé par `value_offset` / `count` / taille d'échantillon
```

**Formule d'offsets — confirmée par le code machine.** Le loader générique des conteneurs G4
(`0x140506630`) calcule les sections en **dwords** :
`section(i) = fichier + ((compteur[i] << shift) + align) × 4`, avec `shift = compteur[11]` (= 2).
Le même code donne `compteur[0]` = nombre d'objets (`movzx r11d, word [rbx+0x20]`) et la taille
d'une entrée de canal : **0x14 = 20 octets** (`lea rax,[rax+0x14]` @ `0x1405067B0`).

**Canaux.** Exactement 8 par objet, sans exception sur le corpus (602 objets × 8 = 4 816) :
`0x16`/`0x17`/`0x18` = position X/Y/Z, `0x1A`/`0x1B`/`0x1C` = point visé X/Y/Z, `0x1E` = FOV,
`0x1F` = roll. Seuls `posX`/`posZ`/`refX`/`refZ` apparaissent en `f32` — valeurs de l'ordre de
±50, cohérentes avec des coordonnées de scène.

**Non résolu (assumé).** Les flux de keyframes sur **2 octets** (majoritaires) ne se décodent ni
en `f16` ni en `i16` de façon cohérente avec les canaux `f32` du même fichier. Ils sont exposés
bruts (`Track::Raw16`) plutôt que devinés ; le ré-encodage les restitue à l'identique, ce qui
rend l'édition des canaux `f32` sûre dès maintenant. Idem pour les flux 1 octet.

Cas particulier rencontré : `ev63_00420_camera.g4cm` déclare **7 noms pour 6 objets** — le nombre
d'entrées de la table d'objets se déduit de l'espace disponible avant les canaux, pas de
`compteur[0]`.

Lié : `event_cam_preset_config.cfg.bin` (presets), `SEARCH_EYE_OVERWRITE` (`camera_type` +
pos/rotY par scène, cf. `event-scripts.md`), `%s_EV_DISABLE_CAMERA_FADE`.

## 6 bis. `camera_ctrl_property_info*` — presets de contrôleur (**débloqués**)

Ces fichiers T2B décrivent un preset **par classe de contrôleur**, avec héritage :

```text
PROP_INFO_BGN = ["CCameraCtrlChase_Soccer", "CCameraCtrlChase"]   <- preset, parent
  PROP_PARAM  = ["m_fCamLength", 16.0]
  PROP_PARAM  = ["m_vCameraRefOffset", 0.0, 1.0, 0.0]
```

Le fichier par défaut porte **21 presets** (`CCameraCtrl`, `CCameraCtrlChase` et ses 5 variantes
`_Focus` / `_Soccer` / `_Far` / `StopWatching` / `StopWatchOverLook`, `Shooting`, `Fps`, `Shake`,
`Rail`, `Event`, `NearFar`, `Offset`, `PickUp`, `Selfie`, `InterPolate`, `GameCameraBlender`,
`CDebugCameraCtrl`, `CTestCameraCtrl`, `CCameraAnimeCtrl`). Valeurs réelles de
`CCameraCtrlChase_Soccer` après résolution d'héritage : `m_fCamLength 16`, `m_fInterpRate 0.2`,
`m_fRotMinX -20`, `m_fRotMaxX 45`, `m_fCameraRotSpeedX/Y 90`, `m_vCameraRefOffset (0, 1, 0)`.

> **Correctif `nie-formats`.** Ces fichiers étaient jusqu'ici **illisibles** : `parse_t2b`
> reconnaissait `_BEG` et `_BEGIN` comme ouverture de bloc mais pas `_BGN`, si bien que le `_END`
> correspondant fermait le niveau racine — `camera_ctrl_property_info.cfg.bin` ne rendait que
> **3 entrées sur 219**. Corrigé dans `cfgbin.rs` (197 tests de `nie-formats` toujours verts).

## 7. État du port Rust — crate `nie-camera`

Tout ce qui suit vit dans `crates/engine/nie-camera` (32 tests, clippy 0 warning), avec le CLI
`nie-cam` : `map`, `extract`, `decode`, `encode`, `verify`, `config`, `live`.

**Fait**

- **`g4cm`** — codec complet, round-trip **byte-exact sur les 1 215 fichiers** du jeu (§6).
- **`config`** — `soccer_camera_config` : 11 listes typées, 379 lignes décodées
  (`SoccerCameraInfoData`, `GoalnetCameraInfo`, `AerialCameraInfo`, `FixPosCameraInfoData`,
  `CinematicCameraInfoData`...), avec résolution des tranches `[offset, count]`.
- **`property`** — `camera_ctrl_property_info*` et `*_property.cfg.bin`, héritage de presets
  résolu (§6 bis).
- **`ctrl`** — contrôleurs portés : `ChaseSoccer` (poursuite paramétrée par
  `SOCCER_CAMERA_INFO_DATA`), `Shake` (shake de tir amorti), `InterPolate` (+ `FadeType`),
  `Offset` (montée/palier/descente), `Blender`.
- **`model`** — `CameraState` (pos/ref/fov/roll/near/far), forme polaire
  `distance/azimut/altitude`, matrices vue et projection, hiérarchie des 23 contrôleurs.
- **`map`** — carte RE : dispatchers, VA, hiérarchie, assets, `va_to_file_offset`,
  `verify_against` (contrôle qu'un `nie.exe` correspond à la carte).
- **`live`** — lecture/écriture de la caméra dans le process : layout paramétrable, bornes de
  plausibilité, scan heuristique + intersection de deux scans pour écarter le bruit.

**Antérieur (hors crate)**

- `nie-render3d::scene::Camera` — look-at `{eye, target, up, fov_y}`, base main droite,
  `focal = 1/tan(fov_y/2)`, z-buffer. Utilisé par `nie-app::character` (vignettes) et
  `nie-runtime::bin::match3d` (match 3D).
- `nie-engine::menu::CMenuRender` — `camera_index: u16` (+0xf1ba) et tri Z par
  `z = −(view[8]·x + view[9]·y + view[10]·z + view[11])` sur la passe 3D (port de `FUN_1404b9460`).
- `nie-formats::objbin` — `camera_name_hash` (`m_cameraName`) extrait du `RenderComponent`.
- `nie-formats::g4cm` — en-tête seul (§6).
- `nie-data::ai` — `cameraId` de `m_coachChoise` ; `nie-data::soccer_suggest` —
  `SuggestCameraInfo` + `spProdCamera`.
- `nie-re::anchors` — classification RTTI : `ccamera*`/`cgamecamera*` → `render`.

**Reste à faire**

1. **Encodage des flux 2 octets du `.g4cm`** — le seul point dur restant ; sans lui, les canaux
   `posY`/`refY`/`fov`/`roll` des cutscenes restent opaques (mais préservés).
2. **`camera_name_hash` toujours pas consommé au rendu** (cf. `DESIGN.md` §C : seul
   `draw_priority` est utilisé ; `draw_type` et `camera` sont ignorés).
3. **Câblage moteur** : `ctrl::ChaseSoccer` n'est pas encore branché dans `match3d`, ni
   `CCameraCtrlEvent` sur la lecture d'un `.g4cm`.
4. **Contrôleurs non portés** : `Rail`, `PickUp`, `Fps`, `Selfie`, `SpecialAttack`, `Shooting`,
   et la **collision caméra** (`m_isCheckCameraCollision`, `camera_collision_fade`).
5. **Post-effects** pilotés par changement de caméra (13 bascules `changeCameraPostEffect*`).
6. **Localisateur AOB de l'objet caméra** : `live` fonctionne par scan heuristique faute de
   signature validée sur un dump ; une entrée dans `nie-trace::catalog` rendrait l'accès direct.

## 8. Index SQL — `var/niers.sqlite`

Tout ce qui précède est **indexé dans la base de connaissance**, migration
`crates/forge/nie-index/src/camera.sql` (`nie_index::CAMERA_SCHEMA`, appliquée par
`Db::init` — `meta.schema_version = 2`). Peuplement : `nie-cam index`.

```bash
nie-cam index --db var/niers.sqlite --samples   # tout, échantillons compris
nie-cam index --no-anims                        # carte + configs seulement
nie-cam stats                                   # état de l'index
```

**22 tables `cam_*` et 5 vues.** Contenu réel après indexation du jeu complet :

| Contenu | Volume |
|---|---|
| animations `.g4cm` | **1 215** (round-trip byte-exact : 1 215) |
| canaux d'animation | **39 424** (dont 2 920 décodés en `f32`) |
| échantillons de keyframes | **2 626 163** (dont 260 991 décodés) |
| contrôleurs RTTI | 23 (9 portés) |
| paramètres caméra du binaire | 440, classés par domaine |
| presets de contrôleur | 27, sur 5 contextes |
| lignes de `soccer_camera_config` | 379 |
| assets caméra | 16 présents / 18 connus |

Coût : **+57 Mo** sur la base (248 → 305 Mo), ~6 s d'indexation complète.

### Tables

- **Provenance** — `cam_source` (une ligne par passe : binaire, VFS, animations).
- **Carte RE** — `cam_ctrl_class` (hiérarchie auto-référencée), `cam_dispatcher`,
  `cam_re_symbol` (VA + offset fichier), `cam_param` (domaine : `shake`, `chase`, `fade`,
  `input`, `posteffect`, `hud`…), `cam_symbol_list`.
- **Assets** — `cam_asset` (présence, taille, sha256, format détecté).
- **Match** — `cam_soccer_data`, `cam_soccer_ref`, `cam_goalnet`, `cam_aerial`,
  `cam_aerial_map`, `cam_dir`, `cam_fixpos_data`, `cam_cinematic_data`,
  `cam_cinematic_situation`.
- **Presets** — `cam_preset`, `cam_preset_param` (valeurs **déclarées** et **héritées**,
  avec le preset d'origine de chaque valeur héritée).
- **Animations** — `cam_anim`, `cam_anim_object`, `cam_anim_channel`, `cam_anim_sample`.

### Vues

| Vue | Réponse |
|---|---|
| `v_cam_ctrl_hierarchy` | l'arbre des contrôleurs à plat, avec le chemin d'héritage |
| `v_cam_preset_effective` | les paramètres effectifs d'un preset, héritage résolu |
| `v_cam_soccer_resolved` | caméra logique → ses jeux de paramètres (tranche résolue) |
| `v_cam_channel_stats` | canaux et échantillons par type et par encodage |
| `v_cam_coverage` | l'état de l'indexation en une ligne |

### À quoi ça sert concrètement

Le fait que `fov` ne soit **jamais** stocké en `f32` (1 canal sur 4 928 sur tout le
corpus), que `posY`/`refY` le soient à peine (33 et 29), alors que `posZ`/`refZ` le sont
massivement (1 332 et 1 362), se lit désormais d'une requête :

```sql
SELECT kind, encoding, n_channels, n_samples FROM v_cam_channel_stats ORDER BY kind;
```

C'est exactement le genre de statistique qui permettra d'attaquer l'encodage 2 octets
non résolu (§6) : la base contient les 2,6 M d'échantillons bruts et les 261 k
échantillons `f32` de référence, dans la même table, alignés sur leur numéro de frame.
