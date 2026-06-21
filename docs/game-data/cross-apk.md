# cross-apk

Famille de veille / reverse-engineering APK de **Inazuma Eleven Cross** (`jp.co.level5.inazumacross`, JP), un jeu mobile Unity **IL2CPP** DISTINCT du moteur Level-5 « Lives » de Victory Road (aucun CPK / g4tx / cfg.bin). Stock d'archive non consommé par les crates. Le dossier contient le suivi des versions APK et des extractions cross-version.

**356 fichiers `.json`** répartis par sous-dossier :

| Sous-dossier | Fichiers JSON |
|---|---:|
| `work` | 204 |
| `tools` | 140 |
| `extract` | 8 |
| `scratch` | 2 |
| `api_versions.json` | 1 |
| `api_hist.json` | 1 |

Le gros de `tools/` (140) est l'outillage Il2CppInspector Redux (csproj, package.json, tsconfig, appsettings, résultats de tests) — bruit de build, sans contenu de jeu. Le contenu réel vit dans `work/exploit/` (master data, enums, stats catalogue, patterns d'assets) et `extract/` (métadonnées d'extraction APK).

## Identité technique (extract/)

| Champ | Valeur (source JSON) |
|---|---|
| package_name | `jp.co.level5.inazumacross` |
| name (store) | イナイレクロス |
| xapk_version | 2 |
| Firebase project_id | `inazuma-cross-jp` |
| Firebase project_number | 738444093977 |
| storage_bucket | `inazuma-cross-jp.firebasestorage.app` |
| Unity build target | Android |
| Catalogue distant | `{AssetBaseUri}/catalog_prd-161d00a0574f38c64b30aa2e9cd8b2fe02f0738f.hash` |
| ScriptingAssemblies | 164 DLL listées |

Assemblies de jeu notables (hors Unity/System) : `AdjustSdk.Scripts.dll`, `aiming.localization.dll`, `AimingLink.Editor.dll`, `AimingLink.Scripts.dll`, `AppleAuth.dll`, `Assembly-CSharp-firstpass.dll`, `Assembly-CSharp.dll`, `Coffee.SoftMaskForUGUI.dll`, `Coffee.UIEffect.dll`, `Coffee.UIParticle.dll`, `CriMw.CriWare.Assets.Addressables.Runtime.dll`, `CriMw.CriWare.Assets.Runtime.dll`, `CriMw.CriWare.Runtime.dll`, `Google.Play.Common.dll`, `Google.Play.Core.dll`, `Google.Play.Review.dll`, `GoogleSignin.dll`, `LayoutElementExtended.Scripts.dll`, `LoopScrollRect.Runtime.dll`, `MPUIKit.dll`, `R3.Unity.dll`, `R3.Unity.TextMeshPro.dll`, `R3.Unity.XRInteractionToolkit.dll`, `Shared.dll` … (50 au total).

## Suivi de versions APK (sondes API)

Deux fichiers racine sont les **réponses brutes des sondes de release** (pas du contenu de jeu) :

| Fichier | Contenu |
|---|---|
| `api_hist.json` | `{retcode:0, errmsg:"success", version_list:[]}` — historique vide |
| `api_versions.json` | non-JSON : payload **protobuf** brut contenant les littéraux `INVALID_COMMAND` et `SUCCESS` |

`api_hist.json` confirme un `version_list` vide (la sonde de release ne remontait aucune version au moment du dump). La version effectivement extraite (v1.0.0) est documentée hors-JSON dans `STATUS.txt`.

## Catalogue Addressables (work/exploit/catalog-stats.json)

Généré le 2026-06-09T23:51:00Z. Totaux du catalogue Unity Addressables :

| Métrique | Valeur |
|---|---:|
| catalog_rows | 85,267 |
| loadable_objects | 23,247 |
| distinct_addresses | 18,580 |
| addresses_multi_type | 4,453 |
| physical_bundles | 2,081 |
| content_bundles | 1,480 |
| cri_bundles | 601 |
| physical_bundles_total_bytes | 2,053,600,416 |
| index_lines_written | 25,328 |

**Providers** (qui charge quoi) :

| Provider | Bundles |
|---|---:|
| `AssetBundleProvider` | 1,480 |
| `CriResourceProvider` | 1,201 |
| `BundledAssetProvider` | 82,586 |

**Objets chargeables par type d'asset Unity** (top 25) :

| Type | Count |
|---|---:|
| Texture2D | 6,795 |
| GameObject | 5,238 |
| Sprite | 3,371 |
| Material | 3,338 |
| Mesh | 1,263 |
| AnimationClip | 1,113 |
| StringTable | 378 |
| CriAtomAcbAsset | 372 |
| CriAtomAwbAsset | 227 |
| TextAsset | 188 |
| RuntimeAnimatorController | 182 |
| SharedTableData | 125 |
| AnimatorOverrideController | 77 |
| Shader | 70 |
| SpriteAtlas | 42 |
| Cubemap | 41 |
| TMP_FontAsset | 36 |
| Font | 35 |
| SceneInstance | 33 |
| GuildEmblemDefinition | 32 |
| TimelineAsset | 27 |
| AnimationTrack | 25 |
| AnimationPlayableAsset | 22 |
| LightingSettings | 20 |
| ShapeCorrectionClip | 20 |

## Master data du jeu (work/exploit/masterdata-typed.json)

**153 tables de master data** confirmées (schéma typé colonne-par-colonne ; chacune adossée à un TSV source, ex. « LGAマスター - … .tsv »). Liste complète :

`AffinityRankMaster`, `AffinityRewardMaster`, `AwakeningTierMaster`, `BackgroundMaster`, `BattleBgmMaster`, `BattleOperationParameter`, `BattlePassLevelMaster`, `BattlePassMaster`, `BonusPassMaster`, `CharacterGradeMaster`, `CharacterMaster`, `CharacterModelSetMaster`, `CharacterModelVariationMaster`, `CharacterTagMaster`, `ChatStampMaster`, `ClubHouseDecorationSlotTypeMaster`, `ClubMemberOperationProfileMaster`, `CommentaryMaster`, `ConnectionBoardAreaMaster`, `ConnectionBoardChapterMaster`, `ConnectionBoardStageMaster`, `DirectorGrowthRecipeMasterData`, `DirectorLevelTotalPowerBonusMaster`, `EnemyTeamMaster`, `EventConnectionBoardAreaMaster`, `EventConnectionBoardChapterMaster`, `EventConnectionBoardStageMaster`, `EventGuideMaster`, `EventMaster`, `EventMissionGroupMaster`, `EventStoryAreaMaster`, `EventStoryChapterMaster`, `EventStoryStageMaster`, `ExpTableLevelMaster`, `ExtraCupGroupMaster`, `ExtraCupStageMaster`, `FieldAreaMaster`, `FieldMaster`, `FieldTerrainMaster`, `FixedDropTableMaster`, `FixedPlayerMaster`, `FormationDeckMaster`, `GachaBackgroundCutsceneMaster`, `GachaDroptableMaster`, `GachaItemPresentationMaster`, `GachaMachineMaster`, `GachaMainPresentationMaster`, `GachaPresentationMaster`, `GachaPresentationVariationMaster`, `GachaWishlistCandidateMaster`, `GameContentTutorialMaster`, `GameContentUnlockConditionMaster`, `GuildEmblemMaster`, `GuildMemberCountFilterMaster`, `GuildRankAcquisitionMaster`, `GuildRankMaster`, `GuildResourceMaster`, `GuildWeeklyContributionRewardMaster`, `InalinkGroupMaster`, `InitialFormationMaster`, `InstructionNavigationMaster`, `InvitationRewardMaster`, `AffinityItemMaster`, `CharacterItemMaster`, `CharacterSoulItemMaster`, `CharacterizeItemMaster`, `ClubHouseDecorationItemMaster`, `DiamondItemMaster`, `DirectorItemMaster`, `DirectorLevelUpMaterialItemMaster`, `ElementAwakenItemMaster`, `EquipmentCraftingMaterialItemMaster`, `EquipmentItemMaster`, `FocusedTrainingTicketItemMaster`, `FormationMaster`, `GachaTicketItemMaster`, `HonoraryTitleItemMaster`, `ItemAcquisitionMaster`, `ModifierPassiveItemMaster`, `ProfileIconItemMaster`, `RandomEquipmentBoxMaster`, `SpecialMoveLevelUpMaterialItemMaster`, `SpecialMoveManualMaster`, `TeamUniformItemMaster`, `TokenItemMaster`, `VirtualCurrencyItemMaster`, `L5iDPointStatusRewardMaster`, `LoginBonusMaster`, `LoginBonusRewardMaster`, `LotteryDropTableMaster`, `MVPTitleMaster`, `MainStoryAreaMaster`, `MainStoryChapterMaster`, `MainStoryStageMaster`, `ManagerCommentMaster`, `BattlePassMissionGroupMaster`, `BattlePassMissionMaster`, `BeginnerMissionGroupMaster`, `BeginnerMissionMaster`, `EventMissionMaster`, `GuildMissionGroupMaster`, `GuildMissionMaster`, `MissionGroupMaster`, `MissionMaster`, `MissionPointMaster`, `MissionPointRewardMaster`, `OfferMissionGroupMaster`, `OfferMissionMaster`, `ModifierPassiveLotteryTableMaster`, `OfferMaster`, `OfferStepMaster`, `OperationListMaster`, `OperationProfileMaster`, `ParameterMaster`, `PassiveMaster`, `PassiveTotalPowerAdditionMaster`, `PassiveTriggerMaster`, `PlaywrightBookMaster`, `PreferredAreaRankMaster`, `PvPMatchingSlotMaster`, `PvPNpcTeamMaster`, `PvpPlacementMaster`, `PvpRankMaster`, `PvpSeasonMaster`, `PvpSeasonRankingRewardMaster`, `RaidCycleMaster`, `RaidDifficultyMaster`, `RaidGroupMaster`, `RaidMaster`, `RaidRankingRewardMaster`, `RaidScoreRewardMaster`, `BaseScheduleMaster`, `ShapeModelVariationMaster`, `ShopCategoryMaster`, `ShopItemMaster`, `SkitMaster`, `SpecialMoveLevelUpRecipeMasterData`, `SpecialMoveMaster`, `SpecialMoveTotalPowerAdditionMaster`, `StaffModelSetMaster`, `StatusEffectConditionMaster`, `StatusEffectGroupMaster`, `StatusEffectGrowthTableMaster`, `StatusEffectMaster`, `StoreCategoryMaster`, `StoreItemTableMaster`, `ExternalLinkProductMaster`, `InAppLinkProductMaster`, `StoreExchangeProductMaster`, `TrainingShowcaseMaster`, `TrainingStageMaster`, `WorldGroupMaster`, `WorldMergeHistoryMaster`.

Exemples de schémas (table → fichier TSV → colonnes) :

| Table | Fichier source | Colonnes |
|---|---|---|
| `AwakeningTierMaster` | LGAマスター - 覚醒度.tsv | Code:int, NameKey:localizationKey, KickMultiplier:float, TechniqueMultiplier:float, BlockMultiplier:float, CatchMultiplier:float, SpeedMultiplier:float |
| `BattlePassLevelMaster` | LGAマスター - バトルパスレベル.tsv | BattlePassCode:int, Level:int, BattlePass:ref→BattlePassMaster, NormalRewardTable:ref→FixedDropTableMaster, PremiumRewardTable:ref→FixedDropTableMaster, IsPickup:bool |
| `BattleBgmMaster` | LGAマスター - 試合BGM.tsv | Code:int, FirstHalfRequest:struct, SecondHalfRequest:struct, AlmostFinishRequest:struct |
| `BackgroundMaster` | LGAマスター - 背景.tsv | Code:int, ScenePath:string, GoalPostPath:string, SoccerBattleGoalPostPath:string |
| `AffinityRankMaster` | LGAマスター - 信頼度ランク.tsv | AffinityRank:int, RequiredAffinity:int |
| `AffinityRewardMaster` | LGAマスター - 信頼度報酬.tsv | ClubMemberCode:int, AffinityRank:int, Reward:ref→FixedDropTableMaster |

Sur l'ensemble, **1215 colonnes** réparties par `kind` :

| kind | colonnes |
|---|---:|
| int | 399 |
| ref | 221 |
| string | 141 |
| array | 92 |
| enum | 90 |
| struct | 83 |
| localizationKey | 78 |
| bool | 65 |
| float | 28 |
| list | 13 |
| dict | 5 |

## Enums du jeu (work/exploit/enums.json + enums-meta.json)

**214 enums** (1502 valeurs au total). Quelques enums de gameplay et leurs valeurs :

| Enum | Valeurs (name=value) |
|---|---|
| `Soccer.Shared.CharacterShape` | Undefined=0, MaleAverage=1, MaleSmall=2, MaleFat=3, MaleTall=4, MaleMuscular=5, MaleLarge=6, MaleTallAndMuscular=7, MaleMuscularThickNeck=8, MaleLargeThickNeck=9, FemaleAverage=10, FemaleSmall=11, FemaleFat=12, FemaleTall=13, FemaleMuscular=14, FemaleLarge=15, FemaleTallAndMuscular=16, FemaleMuscularThickNeck=17, FemaleLargeThickNeck=18 |
| `Soccer.PlayerType` | ClubMember=0, PlayerDefinition=1 |
| `Soccer.ClubHouseCameraType` | Default=0, FixedPoint1=1, FixedPoint2=2, FixedPoint3=3, StuffedToy=4, Trophy=5, WallArt=6, Carpet=7, Shop=8, Ranking=9 |
| `Soccer.UserAction` | None=0, OpenProfile=1, Report=2, Block=3 |
| `Soccer.FilterSpecialMoveCategory` | None=0, Shoot=1, Dribble=2, Block=4, ShootBlock=8, Catch=16, Punching=32 |
| `Soccer.ChatMessageUserAction` | ClickPlayerIcon=0, LongHoldPlayerIcon=1, ClickMessage=2, LongHoldMessage=3, ClickStamp=4, LongHoldStamp=5 |
| `RootMotion.FinalIK.PositionOffset` | Pelvis=0, Chest=1, Head=2, LeftHand=3, RightHand=4, LeftFoot=5, RightFoot=6, LeftHeel=7, RightHeel=8 |
| `Soccer.Shared.CharacterElement` | None=0, Wind=1, Forest=2, Fire=3, Mountain=4 |

`enums-meta.json` documente pour chaque enum son fichier .cs, son type sous-jacent et son caractère `[Flags]` (4 enums marqués Flags).

## Taxonomie des types C# (work/exploit/class-taxonomy.json)

Dump UnityPy/IL2CPP : **14,283 types** au total (2,592 de jeu, 11,691 de librairie) ; 185 master data dont 153 à schéma confirmé.

**Partition par couche** (types de jeu) :

| Partition | Types |
|---|---:|
| lib:Unity | 5476 |
| lib:BCL/System | 3586 |
| lib:ThirdParty | 2629 |
| GameMisc | 506 |
| ViewModels | 427 |
| SharedModels/DTO | 410 |
| Battle | 283 |
| Network/Api | 262 |
| MasterData | 185 |
| Enums | 122 |
| Views | 93 |
| Extensions | 73 |
| Story/Skit/Cutscene | 67 |
| Models | 38 |
| Dialogs/Pages | 37 |
| Services | 35 |
| Presenters | 25 |
| Sound | 9 |
| Auth | 7 |
| DebugTool/Options | 7 |
| Exceptions | 5 |
| Attributes | 1 |

**Domaines fonctionnels** (top, multi-étiquetage) :

| Domaine | Types |
|---|---:|
| Battle | 422 |
| Character | 199 |
| Social | 187 |
| Story | 181 |
| Reward | 170 |
| Item | 167 |
| UI_Common | 150 |
| Stage | 127 |
| Guild | 126 |
| Training | 125 |
| Mission | 125 |
| Shop_IAP | 116 |
| Gacha | 96 |
| Auth_Account | 91 |
| PvP | 89 |
| Formation_Team | 87 |
| Club | 86 |
| SpecialMoves/Skills | 71 |
| Raid | 64 |
| Event | 60 |

## Patterns de clés d'assets (work/exploit/asset-key-patterns.json)

Conventions d'adressage Addressables reversées (classe `Soccer.CharacterModelKeys (Assembly-CSharp) + Soccer.CharacterModelBuilder`). Identité perso = `c` + 8 chiffres ; modèles/parts = préfixe + 6 chiffres ; suffixes `_H`/`_A` = kit domicile/extérieur.

| Pattern | Source field | Template d'adresse | Type | Codes distincts |
|---|---|---|---|---:|
| character_icon | `CharacterMaster.CharacterIconCode` | `Icons/Character/c{CharacterIconCode:D8}.png` | Texture2D (sprite portrait) | 312 |
| character_voice_acb | `CharacterMaster.VoiceCode` | `Sound/CharacterVoice/c{VoiceCode:D8}.acb` | CriAtomAcbAsset (voice cuesheet) | 246 |
| character_voice_awb | `CharacterMaster.VoiceCode` | `Sound/CharacterVoice/c{VoiceCode:D8}.awb` | CriAtomAwbAsset (voice streaming) | 101 |
| character_voice_internalid | `CharacterMaster.VoiceCode (CRI bundle internal id, lowercased)` | `app_sounds_assets_sound/charactervoice/c{VoiceCode:D8}.acb_data` | CRI internal id | 3 |
| face_ingame | `CharacterMaster.FaceCode  (CharacterModelKeys.Face)` | `CharacterParts/Face/c{FaceCode:D8}/Prefabs/c{FaceCode:D8}.prefab` | GameObject (in-game face rig) | 254 |
| face_director | `CharacterMaster.FaceCode (cutscene/skit)` | `DirectorParts/Face/c{FaceCode:D8}/Prefabs/face_c{FaceCode:D8}.prefab` | GameObject (director/skit face) | 105 |
| base_body | `CharacterShape -> bodyCode lookup (CharacterModelKeys.BaseBone); NOT a :D6 of the enum value (enum 1..18, codes 000101/000201/000301/000401)` | `CharacterParts/Base/Fbx/c{bodyCode:D6}.fbx` | GameObject (shared skeleton mesh) | 4 |
| motions | `Shared by skeleton/bodyCode (same lookup as base_body)` | `Motions/Battle/c{bodyCode:D6}/c{bodyCode:D6}_p010_..._<anim>.fbx` | AnimationClip | 4 |
| uniform_mesh | `CharacterModelSetMaster.UniformCode + shape (CharacterModelKeys.Uniform)` | `CharacterParts/Uniform/Fbx/u{group:D4}{shape:D2}/u{group:D4}{shape:D2}.fbx` | GameObject (uniform mesh per shape) | 44 |
| uniform_material | `CharacterModelSetMaster.UniformCode + shape + isHome` | `CharacterParts/Uniform/u{variant:D7}/u{variant:D7}_{H|A}/...` | Material/Texture (kit color, Home=_H Away=_A) | 92 |
| skin | `CharacterModelSetMaster.SkinCode + shape (CharacterModelKeys.Skin)` | `CharacterParts/Skin/Fbx/sk{SkinCode:D6}/...` | GameObject/Material (skin/body) | 4 |
| glove | `CharacterModelSetMaster.GloveCode + shape + isHome (CharacterModelKeys.Glove)` | `CharacterParts/Glove/Fbx/g{GloveCode:D6}/...` | GameObject (GK glove) | 24 |
| shoes | `CharacterModelSetMaster.ShoesCode + shape + isHome (CharacterModelKeys.Shoes)` | `CharacterParts/Shoes/Fbx/s{ShoesCode:D6}/...` | GameObject (shoes) | 36 |
| captain_mark | `CharacterModelSetMaster.CaptainMarkCode + shape + isHome (CharacterModelKeys.CaptainMark)` | `CharacterParts/Mark/Fbx/m{CaptainMarkCode:D6}/...` | GameObject (captain armband) | 2 |
| uniform_number | `CharacterModelSetMaster.UniformNumberCode + shape + isHome (CharacterModelKeys.UniformNumber)` | `CharacterParts/Number/Fbx/n{UniformNumberCode:D6}/...` | GameObject (jersey number) | 3 |
| accessory_legacy | `CharacterModelSetMaster.AccessoryCodes[] (CharacterModelKeys.Accessory) legacy 6-digit` | `CharacterParts/Accessory/Fbx/i{accessoryCode:D6}.fbx` | GameObject (accessory legacy) | 1 |
| accessory_new | `CharacterModelSetMaster.AccessoryCodes[] new 8-digit` | `CharacterParts/Accessory/i{accessoryCode:D8}/Prefabs/i{accessoryCode:D8}.prefab` | GameObject (accessory new) | 8 |
| shape_correction | `CharacterMaster.ShapeCorrectionCode + shape (CharacterModelKeys.ShapeCorrection)` | `CharacterParts/ShapeCorrection/c{shape:D6}_..._{shapeCorrectionCode}...` | ShapeCorrectionClip | 4 |

Exemples de codes (character_icon) : `c00001001`, `c00001002`, `c00001003`, `c00001004`, `c00001005`.

## Autres inventaires

- `monoscript-classes.json` — **877** classes MonoBehaviour référencées dans les bundles (ex. `CriWare.Assets.CriAtomAcbAsset`, `DG.Tweening.DOTweenAnimation`, classes `Soccer.*`).
- `laneA-il2cpp/masterdata-schema.json` — **153** master `Soccer.Shared.*Master` → liste plate de leurs colonnes.
- `laneA-il2cpp/type-schema.json` — **2118** types `Soccer.*` (ViewModels, services…) → champs sérialisés.
- `assets-local/assets-local-manifest.json` — **312** assets embarqués localement, dont :
  - Texture2D : 24
  - Material : 103
  - Shader : 70
  - Cubemap : 1
  - Sprite : 25
  - Texture2D_empty_skipped : 3
  - TextAsset : 2
  - Font : 3
  - MonoBehaviour : 84

Le dossier `work/exploit/assets-local/text/` contient surtout des **dumps MonoBehaviour** (`m_GameObject`/`m_Script`/`m_PathID` : ShopService, GachaModel, GuildModel, MainStoryModel, MasterSound_*, etc.) et des **TMP/SDF font assets** (Goldman-Regular SDF, BO-SoftGoStd) — pas des StringTables de texte localisé lisible. `materials/` contient des matériaux Unity (Lit, BG_Unlit_Sky, variantes de contour/glow de polices). `shaders/` contient des dumps de shaders Unity.

## Note : pas de cfg.bin.json dans cette famille

Contrairement aux familles issues du moteur Level-5 « Lives » (Victory Road), **aucun fichier `cfg.bin.json`** (structure `entries → children → TEXT_INFO [Int hash, Int, String]`) n'existe ici : Inazuma Eleven Cross tourne sous Unity IL2CPP + Addressables, ses données vivent en master data TSV/MessagePack et en bundles Unity, pas en RDBN cfg.bin. L'aplatissement TEXT_INFO demandé est donc sans objet pour cross-apk.
