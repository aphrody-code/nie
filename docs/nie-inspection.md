# Inspection de nie.exe

Fichier : `nie.exe` (copie locale depuis le dossier Steam)
Date d'inspection : 2026-04-05

## Informations generales

| Propriete | Valeur |
|-----------|--------|
| Format | PE32+ (x86_64), Windows GUI, 9 sections |
| Taille | 30 MB (31 457 280 bytes) |
| Editeur | LEVEL5 Inc. |
| Produit | INAZUMA ELEVEN: Victory Road |
| Nom interne | `nie1v2.exe` |
| Version | 1.0.0.0 |
| Copyright | (C) LEVEL5 Inc. All rights reserved. |
| Debug symbols | Non |

## Moteur & Technologies

| Composant | Details |
|-----------|---------|
| Moteur | Level-5 proprietaire (classes `gmdC*` — ni Unreal ni Unity) |
| Rendering | DirectX 11 (D3D11 + DXGI + HLSL shaders) |
| Physique | NVIDIA PhysX (`PhysX3Gpu_x64.dll`) |
| Audio/Video | CRI Middleware complet (CriAtom ADX, CriFs, Sofdec2 HCA) |
| Scripting | Lua 5.2 (`LUA_PATH_5_2`, `LUA_CPATH_5_2`) |
| Anti-cheat | EasyAntiCheat |
| Reseau | Steam API (`steam_api64.dll`) + libcurl + Winsock2 |

## Sections PE

| Section | VSize | RawSize | Description |
|---------|-------|---------|-------------|
| `.text` | 22.6 MB | 22.6 MB | Code executable |
| `.rdata` | 3.6 MB | 3.6 MB | Donnees read-only (strings, vtables, imports) |
| `.data` | 9.6 MB | 2.2 MB | Donnees globales (BSS sparse) |
| `.pdata` | 1.1 MB | 1.1 MB | Exception unwind info (x64 SEH) |
| `.rodata` | 1 KB | 1 KB | Constantes supplementaires |
| `_RDATA` | 78 KB | 78 KB | Runtime data |
| `.fptable` | 256 B | 512 B | Table de pointeurs de fonctions |
| `.rsrc` | 60 KB | 60 KB | Ressources (icone, manifest, version) |
| `.reloc` | 177 KB | 177 KB | Relocations |

## DLL Importees

| DLL | Role |
|-----|------|
| `d3d11.dll` | DirectX 11 rendering |
| `D3DCOMPILER_47.dll` | Compilation shaders HLSL |
| `dxgi.dll` | DirectX Graphics Infrastructure |
| `PhysX3Gpu_x64.dll` | NVIDIA PhysX GPU |
| `PhysXUpdateLoader64.dll` | PhysX loader |
| `steam_api64.dll` | Steamworks SDK |
| `sdkencryptedappticket64.dll` | Steam encrypted tickets |
| `libcurl.dll` | HTTP client |
| `dbghelp.dll` | Debug helpers (stack traces) |
| `KERNEL32.dll`, `USER32.dll`, `GDI32.dll` | Windows API core |
| `WS2_32.dll` | Winsock (reseau) |
| `WINMM.dll` | Multimedia (audio timing) |
| `MMDevAPI.dll` | Audio device API |
| `ole32.dll`, `OLEAUT32.dll` | COM runtime |
| `IMM32.dll` | Input Method Manager |
| `SHELL32.dll`, `SHLWAPI.dll` | Shell utilities |

## Formats de fichiers confirmes (offsets dans le binaire)

| Format | Offset | Contexte |
|--------|--------|----------|
| G4TX | `0x01BFF640` | Parser de textures Level-5 |
| G4MD | `0x004CC7F6` | Metadata modeles (dans .text, code de parsing) |
| G4SK | `0x01BFF5B0` | Squelettes / hierarchie d'os |
| G4PK | `0x01C01890` | Archives de packages |
| G4RA | `0x01BFFDB0` | Archives de ressources |
| RDBN | `0x01BFF5F0` | Configuration moderne |
| @UTF | `0x016BF744` | Tables CRI Universal |
| CRILAYLA | `0x016C99A0` | Compression CRI LZSS |
| CPK | `0x0157C1A9` | Archives CRI |
| cfg.bin | `0x01721B38` | Configuration Level-5 |

Note : G4MG et NXTCH non trouves en string ASCII — probablement references par magic bytes numeriques (0x474D3447) plutot que par nom.

## Classes Level-5 (gmdC — moteur proprietaire)

Systeme ECS custom avec `gmdCObject` comme base :

| Classe | Role |
|--------|------|
| `gmdCObject` | Classe de base du moteur |
| `gmdCObjModel` | Modele 3D |
| `gmdCObjModelComponent` | Composant modele attache a un objet |
| `gmdCObjModelIK` / `gmdCObjModelIkJob` | Inverse kinematics |
| `gmdCObjModelLodInfo` | Level of Detail |
| `gmdCObjBlendShapeManager` | Blend shapes (morph targets) |
| `gmdCObjDecalComponent` | Decals |
| `gmdCLookAtComponent` | IK regard (eyes/head tracking) |
| `gmdCAnimation` / `gmdCAnimationAsync` | Systeme d'animation |
| `gmdCAnimationRefAnim` | Reference d'animation |
| `gmdCObjPlayAnime` / `gmdCObjPlayAnimeManager` | Lecture d'animations |
| `gmdCShareObjAnimeList` / `gmdCShareObjAnimeListManager` | Partage de listes d'anims |
| `gmdCDrawObjModelPriority` | Priorite de rendu |

## CRI Middleware — Modules identifies

| Module | Role |
|--------|------|
| `CriFs` / `CriFsBinder` | Systeme de fichiers, binding CPK |
| `CriAtomEx` | Moteur audio ADX/HCA (config, ASR, player) |
| `CriAtomTblAcf` / `CriAtomTblCsb` | Tables audio (ACF, CSB) |
| `CriAadx` / `CriAdec` | Decodeurs audio |
| `CriAlphaDec` | Decodeur alpha (video) |
| `CriAtomHcaMx` | Mixage HCA |

## Lua Scripting

Le jeu embarque Lua 5.2 avec :
- `LUA_PATH` / `LUA_PATH_5_2` — recherche de modules .lua
- `LUA_CPATH` / `LUA_CPATH_5_2` — recherche de modules natifs (.dll)
- Patterns : `!\lua\?.lua`, `!\lua\?\init.lua`, `!\?.lua`
- Modules C : `!\?.dll`, `!\loadall.dll`

## Constantes connues pour le reverse engineering

| Constante | Valeur | Usage |
|-----------|--------|-------|
| Steam App ID | `2799860` (0x2AB694) | Authentification Steam |
| CRI XOR Key | `0x1717E18E` | Dechiffrement assets CRI |
| cfg.bin footer | `01 74 32 62 FE` | Detection fin de cfg.bin |

---

## Analyse Rizin (rz-bin)

### Metadonnees avancees

| Propriete | Valeur |
|-----------|--------|
| Base address | `0x140000000` |
| Compilateur | MSVC Linker 14.44 |
| Compile le | 30 mars 2026, 09:09:13 UTC+1 |
| PDB path | `G:\nie1v2\program\main\program\SteamRelease\x64\nie.pdb` |
| Langage | C++ (RTTI present) |
| PIE | Oui |
| NX | Oui (DEP) |
| Stripped | Non |
| Signed | Non |

### Imports (465 fonctions)

| DLL | Fonctions cles |
|-----|----------------|
| `libcurl.dll` | curl_easy_init, curl_easy_perform, curl_easy_setopt, etc. (10) |
| `steam_api64.dll` | SteamAPI_Init, RunCallbacks, RegisterCallback, etc. (11) |
| `sdkencryptedappticket64.dll` | BDecryptTicket, GetTicketSteamID, BIsTicketForApp (4) |
| `WS2_32.dll` | socket, bind, listen, accept, connect, send, recv, select (20+) |
| `KERNEL32.dll` | Threading (SRW locks, condition vars), file I/O, memory (300+) |
| `d3d11.dll` + `dxgi.dll` | D3D11CreateDevice, DXGIFactory |
| `D3DCOMPILER_47.dll` | D3DReflect (shader compilation) |

### Exports (2 seulement)

| Export | Role |
|--------|------|
| `AmdPowerXpressRequestHighPerformance` | Force GPU discret AMD |
| `NvOptimusEnablement` | Force GPU discret NVIDIA |

### Strings (45 344 total)

### Rendering Pipeline (priorites de rendu)

L'engine Level-5 utilise un systeme de priorites de rendu nomme :

| Priorite | Nom | Description |
|----------|-----|-------------|
| 00 | `00_Zero` | Base / fond |
| 00 | `00_UI_Before` | UI arriere-plan |
| 10 | `10_MapBefore` | Map avant personnages |
| 15 | `15_ProjEffect` | Effets de projection |
| 20 | `20_CharaBefore` | Personnages avant |
| 25 | `25_CharaAfter` | Personnages apres |
| 30 | `30_MapAfter` | Map apres personnages |
| 40 | `40_Effect` | Effets visuels |
| 50 | `50_Post` | Post-processing |
| 51 | `51_PostAfter` | Post-processing apres |
| 59 | `59_PreMenuEndDraw` | Avant fin menu |
| 60 | `60_UI` | Interface utilisateur |
| 61 | `61_PostMenuEndDraw` | Apres fin menu |

### Namespaces C++ (RTTI)

Deux namespaces principaux :

**`lives::`** — Moteur bas-niveau Level-5
- `lives::CVector2`, `lives::TVector3`, `lives::TVector4` — types mathematiques
- `lives::CVectorBase3`, `lives::CVectorBase4`, `lives::FVectorBase3` — bases vectorielles
- `lives::hash32` — systeme de hashing
- `lives::SCREEN_STRETCH` — modes d'ecran
- `lives::CCT_SHAPE_TYPE` — types de formes collision

**`game::`** — Code gameplay specifique IEVR
- `game::CGameCameraParam` — parametres camera
- `game::CModelIK` — inverse kinematics (RES_JOINT, RES_JOINT_LIST)
- `game::CCharaAlphaState` — transparence personnages (BLEND_TYPE)
- `game::CCharaWaterEffectComponent` — effets eau
- `game::CCharaEditCustomMdlComp` — edition de personnages (BONE_OFFSET_INFO)
- `game::CCustomAnimePlayer` — lecteur d'animation (ANIME_MANAGE_INFO)
- `game::CRopeComponent` — physique de cordes (KEY_INFO, GROUND_INFO)
- `game::CScalingAlongGroundComponent` — mise a l'echelle terrain
- `game::CEffectLightData` — eclairage effets (CAMERA_FADE)
- `game::CPutEffectEqualInterval` — placement d'effets reguliers
- `game::WorldCharaCol` — collision monde-personnage
- `game::COL_PART_INFO`, `game::COL_GROUP_INFO` — systeme de collision
- `game::CHARA_EDGE_PARAM` — contours de personnages

## Historique des inspections

### 2026-04-05 — Inspection initiale
- Analyse PE headers, sections, imports (PowerShell + xxd)
- Extraction strings ASCII (patterns connus)
- Identification moteur Level-5, CRI, PhysX, Lua, Steam
- 17 classes gmdC identifiees
- 10 formats de fichiers confirmes dans le binaire

## RTTI — Classes completes

1 234 classes RTTI identifiees (1 037 game::, 197 lives::).
Liste complete : [nie-rtti-classes.txt](nie-rtti-classes.txt)

### Systeme GDS (Game Data System) — 268 classes de configuration

Toutes les configs de jeu sont des classes `GDS*Config` chargees depuis cfg.bin.
Domaines couverts :

| Domaine | Classes cles |
|---------|-------------|
| Personnages | GDSCharaBase, GDSCharaParam, GDSCharaModel, GDSCharaMotion, GDSCharaExpTableConfig |
| Skills | GDSSkillConfig, GDSRealSkillConfig, GDSAuraSkillConfig, GDSOverrideSkillConfig |
| Passive Skills | GDSPassiveSkillConfig, GDSPassiveSkillEffectConfig, GDSPassiveSkillRarityTableConfig |
| Soccer | GDSSoccerGameConfig, GDSSoccerCameraConfig, GDSSoccerPhaseConfig, GDSSoccerRankConfig |
| Formations | GDSFormationConfig, GDSRpgBattleFormationConfig |
| Equipes | GDSTeamConfig, GDSTeamBuildConfig, GDSBelongTeamConfig, GDSOpponentTeamConfig |
| Carte | GDSMapConfig, GDSMapEnvDataConfig, GDSMapMinimapConfig, GDSMapDoorConfig |
| Evenements | GDSEventPlayConfig, GDSEventCmndConfig, GDSEventCameraPresetConfig |
| Combat RPG | GDSRpgBattleCmdConfig, GDSRpgBattleAiConfig, GDSRpgBattleFormationConfig |
| Audio | GDSBgmConfig, GDSSoccerGameBgmConfig, GDSMotionSoundConfig |
| UI/Menu | GDSMenuCreateConfig, GDSMenuPresetConfig, GDSMenuIconManagerConfig |
| Entrainement | GDSRpgBattleDribbleTrainingConfig, GDSRpgBattleSpecialTrainingConfig |

### Classes Soccer (gameplay principal)

| Classe | Role |
|--------|------|
| CSoccerCtrl / CSoccerCtrlBase | Controleur principal du match |
| CSoccerCtrlAI / CSoccerCtrlAIStateMachine | IA de jeu |
| CSoccerStateMachine | Machine a etats du match |
| CSoccerCharaData / SoccerCharaCtrl | Donnees et controle d'un joueur |
| SoccerCharaCtrlInPlay / SetPlay / Zone | Controle selon phase de jeu |
| SoccerCharaTacticsAI / SoccerTacticsAI | IA tactique |
| SoccerPlayCmdManager / CharaPlayCmdManager | Commandes de jeu |
| SoccerCommandEffect* | Effets de commandes (PassiveSkill, TeamBuild, SuperTactics...) |
| BallComponent / IBallMoveController | Physique du ballon |
| BallMoveDribble / BallMoveRealSkillShootBezier | Mouvements specifiques |
| CRpgBattleShootTurnManager / DribbleTurnManager | Tours RPG |
| GoalnetComponent | Filet de but |
| SoccerCalcKeeperSaveComponent | Calcul arrets gardien |
| CSceneSoccer / CSceneSoccerTraining | Scenes de match |

### Structure des assets (paths dans le binaire)

```
#/                              — racine virtuelle des assets
#/chr/_uniform/                 — uniformes (n000201_10.g4tx)
#/effect/                       — effets visuels
#/effect/locus/                 — locus d'effets
#/font/                         — polices (gaiji par plateforme: nx, ps4, ps5, xbox, SteamDeck)
#/font/<LG>/                    — polices localisees
#/map/ar/ao*/                   — areas outdoor (ao001-ao403)
#/map/ar/gr*/                   — ground/terrain (gr001-gr080)
#/map/ar/pl*/                   — places (pl001-pl339)
#/map/ar/tr*/                   — training areas
#/menu/220_img/                 — images menu
#/menu/220_img/opponent_img/    — portraits adversaires
#/menu/220_img/meet_img/<LG>/   — images de rencontre (localisees)
#/menu/220_img/stadium/         — fonds de stade
#/menu/220_img/savedata_img/    — images de sauvegarde
data/common/system/             — configs systeme (error_code_text_<LG>.cfg.bin)
```

Patterns d'asset : `<LG>` = langue (localisation), `%s` = dynamique, `_l` = version large.

### 2026-04-05 — Inspection Rizin approfondie (rz-bin)
- Installe Rizin 0.8.2 via winget
- Decouverte du PDB path : `G:\nie1v2\program\main\program\SteamRelease\x64\nie.pdb`
- Date de compilation : 30 mars 2026
- 465 imports, 2 exports (GPU switching)
- 45 344 strings extraites
- 1 234 classes RTTI C++ (1 037 game::, 197 lives::) → nie-rtti-classes.txt
- 268 classes GDS*Config identifiees (systeme de donnees de jeu complet)
- 13 priorites de rendu identifiees
- 30+ classes soccer/gameplay cartographiees
- Structure des assets (#/chr, #/map, #/font, #/effect, #/menu)
- Patterns de localisation (`<LG>`) et multi-plateforme (nx, ps4, ps5, xbox, SteamDeck)

### 2026-04-05 — Setup Ghidra
- Installe JDK 21.0.10 (Microsoft OpenJDK)
- Installe Ghidra 12.0.4 dans C:\Users\yohan\ghidra\
- Scripts d'export deployes (ExportDecompiled.java, ExportSingleFunction.java, IECODEAnalyzer.java)

### 2026-04-05 — Recherche Context7 : Ghidra DecompilerLanguage
- Ghidra ne supporte que 2 langages de sortie : `C_LANGUAGE` et `JAVA_LANGUAGE`
- **Pas de mode C++ natif** — meme pour un binaire C++ comme nie.exe, la sortie est du pseudo-C
- `this` → `param_1`, appels virtuels → dereferences de pointeurs, pas de namespaces/RAII
- Strategie : garder le pseudo-C brut dans `src/decomp/functions/*.c`, convertir manuellement via `bridge.cpp`
- Les 1 234 classes RTTI sont la cle pour mapper `FUN_XXXXXXXXX` → `Class::Method`

### 2026-04-05 — Analyse complete GhydraMCP + nie.c (auto)

#### Statistiques Ghidra (GhydraMCP)

| Metrique | Valeur |
|----------|--------|
| Fonctions | 60 540 |
| Symboles | 720 259 |
| Strings | 24 944 |
| Structs | 204 |
| Data items | 272 834 |
| Segments | 11 |
| Plage code | `0x140001000` — `0x141698344` (~23.6 MB) |

Export complet : `docs/ghidra-export/` (strings.json, structs.json, segments.json, program-info.json)

#### Analyse nie.c (4.15M lignes, 127 MB)

| Metrique | Valeur |
|----------|--------|
| Lignes totales | 4 155 103 |
| En-tete (typedefs, structs, globals) | 91 446 lignes |
| Code (fonctions) | 4 063 657 lignes |
| Fonctions (`FUN_14*`) | ~58 969 |
| Globals uniques (`DAT_14*`) | 97 315 |
| Appels indirects (vtable) | 68 753 |
| Statements `switch` | 756 |
| Labels `case` | 5 995 |
| Classes GDS*Config | 280 |
| Classes gmdC* | 165 |
| Refs `lives::` | 6 521 |
| Refs `game::` | 3 146 |

#### Top 10 plus grosses fonctions

| Rang | Fonction | Lignes | Role probable |
|------|----------|--------|---------------|
| 1 | `FUN_140ac2130` | 26 219 | Physique/collision (10 params float/vector) |
| 2 | `FUN_140794880` | 14 625 | Inconnu |
| 3 | `FUN_140a34260` | 10 185 | Inconnu |
| 4 | `FUN_140436c80` | 9 189 | Bool return |
| 5 | `FUN_14075db20` | 8 430 | Void |
| 6 | `FUN_140a25330` | 8 057 | ulonglong return |
| 7 | `FUN_140a2e9f0` | 6 495 | Void |
| 8 | `FUN_1406d1d30` | 5 750 | Void |
| 9 | `FUN_140a20b70` | 5 697 | ulonglong return |
| 10 | `FUN_1412fee50` | 4 718 | ulonglong return |

#### 22 fonctions cles decompilees

Toutes exportees dans `docs/ghidra-export/decompiled/` (244 KB total) :

**CRI Middleware (@UTF / CRILAYLA) :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_140654230` | `0x140654230` | 2.8 KB | @UTF parser entry — alloc `@UTF1`/`@UTF2`, 16-byte align |
| `FUN_140663d08` | `0x140663d08` | 3.8 KB | UTF table parse core — champs, colonnes, lignes |
| `FUN_140663cf0` | `0x140663cf0` | 322 B | Compteur de champs UTF |
| `FUN_1406543e4` | `0x1406543e4` | 859 B | Finaliseur/validation UTF |
| `FUN_14066371c` | `0x14066371c` | 325 B | Stub CRILAYLA magic check |

**Level-5 Formats :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_1401c1430` | `0x1401c1430` | 50.9 KB | **RDBN parser** — 313+ refs `RDBNP`, constructeur cfg.bin |
| `FUN_14103d7d0` | `0x14103d7d0` | 6.6 KB | G4TX loader — `"%s.g4tx"` |
| `FUN_1405846b0` | `0x1405846b0` | 759 B | G4PK init — magic `G4PK@` a `0x141c03290` |
| `FUN_1404d96d0` | `0x1404d96d0` | 542 B | G4SK init — magic `G4SK@` a `0x141c00fb0` |
| `FUN_14055e740` | `0x14055e740` | 542 B | G4RA init — magic `` G4RA` `` a `0x141c017b0` |
| `FUN_14055fc80` | `0x14055fc80` | 2.2 KB | G4MD init — magic `G4MDP` a `0x141c01840` |

**cfg.bin :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_1415f5590` | `0x1415f5590` | 3.5 KB | cfg.bin loader #1 |
| `FUN_14160abb0` | `0x14160abb0` | 3.5 KB | cfg.bin loader #2 |
| `FUN_14160d640` | `0x14160d640` | 5.4 KB | cfg.bin parser/dispatch |

**CPK :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_14157c660` | `0x14157c660` | 8.3 KB | Scanner CPK — glob `"%s/*.cpk"` |
| `FUN_14157cf50` | `0x14157cf50` | 3.4 KB | Chargeur `cpk_list.cfg.bin` |

**Lua 5.2 :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_140ef27c0` | `0x140ef27c0` | **97 KB** | CObjLuaManager init — 8 familles de bridge |
| `FUN_140c34ec0` | `0x140c34ec0` | 713 B | Registre `funcLuaCommand` |
| `FUN_14059b950` | `0x14059b950` | 968 B | Lua openlibs (runtime 5.2 embarque) |

**Systemes de jeu :**
| Fonction | Adresse | Taille | Role |
|----------|---------|--------|------|
| `FUN_1400babb0` | `0x1400babb0` | 48.6 KB | RpgSaveData2 — serialisation save |
| `FUN_140ae76b0` | `0x140ae76b0` | 452 B | App config `5.00.24.00` |
| `FUN_140985524` | `0x140985524` | 158 B | Entry point (`__scrt_common_main_seh`) |

#### Adresses magic strings (.rdata)

| Magic | Adresse | Fonctions referentes |
|-------|---------|---------------------|
| `@UTF1` | `0x1416c0f44` | `FUN_140654230` |
| `@UTF2` | `0x1416c0f5c` | `FUN_140654230` |
| `CRILAYLA` | `0x1416cb1a0` | `FUN_14066371c` |
| `RDBNP` | `0x141c00ff0` | `FUN_1401c1430` + 20 inits |
| `G4PK@` | `0x141c03290` | `FUN_1405846b0`, `FUN_140585da0`, `FUN_140585e90` |
| `G4SK@` | `0x141c00fb0` | `FUN_1404d96d0`, `FUN_1404d9720`, `FUN_140584670` |
| `` G4RA` `` | `0x141c017b0` | `FUN_14055e740`, `FUN_14055e790`, `FUN_140584540` |
| `G4MDP` | `0x141c01840` | `FUN_14055fc80`, `FUN_14055fdf0`, `FUN_140583d50` |

#### Lua 5.2 — Bridge functions

8 familles de fonctions Lua enregistrees dans `CObjLuaManager` :

1. `funcLuaCommand` — commandes generales
2. `funcLuaActionCommand` — actions de personnages
3. `funcLuaCameraCommand` — controle camera
4. `funcLuaEffectCommand` — effets visuels
5. `funcLuaMenuCommand` — navigation menus
6. `funcLuaSpTacticsCommand` — super tactiques
7. `funcLuaMenuNetworkCommand` — menus reseau
8. `funcLuaMenuMultiplayCommand` — multijoueur

Scripts charges depuis : `common/script/lua/menu/%s.lua.bin`

#### PhysX 3.4 (statiquement lie)

Source : `D:\SVN\PhysX3.4\PhysX_3.4\Source\...`
- 2 330 references dans nie.c
- Sous-systemes : BroadPhase (SAP/MBP), GeomUtils, LowLevelDynamics, LowLevelCloth, Articulation
- Collision : convex mesh, heightfield, sweep/raycast, BVH trees
- Simulation de tissu (cloth)

#### Patterns d'occurrences dans nie.c

| Categorie | Pattern | Occurrences |
|-----------|---------|-------------|
| Personnages | `player`, `character`, `chara` | 2 047 |
| Soccer/Match | `soccer`, `match`, `football` | 1 139 |
| Animation | `anim`, `motion`, `skeleton` | 705 |
| Erreurs | `Error`, `error`, `ERROR` | 313 |
| Save/Load | `save`, `load` | 258 |
| Reseau | `network`, `online`, `multiplayer` | 151 |
| Assets virtuels (`#/`) | Refs filesystem virtuel | 89 |
| CRI Middleware | `CriFs`, `CriAtomEx`, `CriMana` | ~197 |
| Steam API | `SteamAPI_*` | 66 |
| cfg.bin | Fichiers de configuration | 32 |
| G4TX textures | Chemins d'assets | 71 |
| RDBN | Container format | 162 |

#### Version de l'application

`5.00.24.00` — identifiee depuis `common/system/app_config_5.00.24.00.cfg.bin`
