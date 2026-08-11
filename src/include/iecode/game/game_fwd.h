#pragma once

/// @file game_fwd.h
/// Declarations anticipees de tous les types game:: (logique de jeu).
/// 1037 classes RTTI identifiees dans nie.exe.
/// Organisees par sous-systeme.

#include <cstdint>

namespace game {

// ===========================================================================
// Scene — gestion des scenes et transitions
// ===========================================================================

class CSceneManager;
class CScene;
class CSceneRoot;
class CSceneMain;
class CSceneTitle;
class CSceneMenu;
class CSceneRpg;
class CSceneRpgBattle;
class CSceneSoccer;
class CSceneSoccerTraining;
class CSceneEvent;
class CSceneVSRoute;

enum class SceneId : uint32_t;
enum class RpgScenePhase : uint32_t;

// ===========================================================================
// Camera — controleurs de camera (16 classes RTTI)
// ===========================================================================

struct CCameraCtrlBase;
struct CCameraCtrlChase;
struct CCameraCtrlChaseBase;
struct CCameraCtrlChaseSoccer;
struct CCameraCtrlEvent;
struct CCameraCtrlFixPos;
struct CCameraCtrlFps;
struct CCameraCtrlInterPolate;
struct CCameraCtrlMenu;
struct CCameraCtrlNearFar;
struct CCameraCtrlOffset;
struct CCameraCtrlPickUp;
struct CCameraCtrlRail;
struct CCameraCtrlSelfie;
struct CCameraCtrlShake;
struct CCameraCtrlShooting;
struct CCameraCtrlSoccerMenu;
struct CCameraCtrlSpecialAttack;

// ===========================================================================
// Character — parametres, mouvement, collision, facial, voix, edition
// ===========================================================================

struct CCharaParam;
struct CCharaActParam;
struct CCharaMoveParam;
struct CCharaCollision;
struct CCharaColHitReport;
struct CCharaMoveCtrl;
struct CCharaMoveNAnimComp;
struct CCharaFacial;
struct CCharaFaceSizeComponent;
struct CCharaVoice;
struct CCharaEditParam;
struct CCharaEditVariableParam;
struct CCharaEditModelMenu;
struct CCharaEditModelUpdater;
struct CCharaEditCustomMdlComp;
struct CCharaEditCustomTextureComp;
struct CCharaEditingCustomPartsComponent;
struct CCharaSelfShadow;

// ===========================================================================
// Soccer — match engine, AI, equipes, balle
// ===========================================================================

struct CSoccerStateMachine;
struct CSoccerCtrl;
struct CSoccerCtrlBase;
struct CSoccerCtrlAI;
struct CSoccerCtrlAIStateMachine;
struct CSoccerTeamDock;
struct CSoccerCharaData;
struct BallComponent;
struct IBallMoveController;
struct BallMoveNormal;
struct BallMoveBezier;
struct BallMoveMultiBezier;
struct BallMoveDribble;
struct BallMoveGoalnet;
struct BallMoveLerp;
struct BallMoveRate;
struct BallMoveRealSkillShootBezier;
struct BallMoveSimpleParabora;
struct BallMoveTargetFollow;

enum class SoccerPhase : uint32_t;

// ===========================================================================
// RPG — machine d'etat, batailles, cible
// ===========================================================================

struct CRpgStateMachine;
struct CRpgBattleStateMachine;
struct CRpgBattleTurnManager;
struct CRpgBattleShootTurnManager;
struct CRpgBattleDribbleTurnManager;
struct CRpgBattleDanceTurnManager;
struct CRpgBattleLiftingTurnManager;
struct CRpgBattleScrambleTurnManager;
struct CRpgBattleSledDashTurnManager;
struct CRpgBattleStairsRaceTurnManager;
struct CRpgBattleBallTrapFielderTurnManager;
struct CRpgBattleBallTrapKeeperTurnManager;
struct CRpgTargetManager;

enum class RpgPhase : uint32_t;

// ===========================================================================
// NPC — controleurs et donnees PNJ
// ===========================================================================

struct CBaseNpcController;
struct CBaseNpcData;
struct CCmnTaskNpcController;
struct CCmnTaskNpcData;
struct CCraftNpcController;
struct CCraftNpcData;
struct CMobNpcController;
struct CMobNpcData;
struct CHappenEventNpcController;
struct CHappenEventNpcData;
struct CNpcUnit;

// ===========================================================================
// GDS — config statiques (~280 classes, lues depuis cfg.bin)
// ===========================================================================

// chara (32+)
struct GDSCharaBase;
struct GDSCharaParam;
struct GDSCharaExpTableConfig;
struct GDSCharaAddDesc;
struct GDSCharaExpression;
struct GDSCharaModel;
struct GDSCharaTexture;
struct GDSCharaParts;
struct GDSCharaScale;
struct GDSCharaMeshType;
struct GDSCharaModelChange;
struct GDSCharaMotion;
struct GDSCharaMenuMotion;
struct GDSCharaFacial;
struct GDSCharaSeTrigger;
struct GDSCharaDetailsConfig;
struct GDSCharaEditConfig;
struct GDSCharaEditPartsTypeConfig;
struct GDSCharaPropDefaultConfig;
struct GDSCharaNameTagConfig;
struct GDSCharaSeriesConfig;
struct GDSCharaCostumeConfig;
struct GDSCharaMenuResource;
struct GDSCharaSoundResource;
struct GDSCharaUniformMenuResource;
struct GDSCharaFaceIconConfig;

// skill
struct GDSSkillConfig;
struct GDSSkillInfoReplaceConfig;
struct GDSAbilityLearningConfig;

// map (30+)
struct GDSMapConfig;
struct GDSMapAdditionalConfig;
struct GDSMapValidConfig;
struct GDSMapGameInfo;
struct GDSMapPlacementConfig;
struct GDSMapFuncPointConfig;
struct GDSMapInterestPointConfig;
struct GDSMapNameTagConfig;
struct GDSMapEnvDataConfig;
struct GDSMapLightSetConfig;
struct GDSMapCubemapConfig;
struct GDSMapWeatherPresetConfig;

// event (22+)
struct GDSEventPlayConfig;
struct GDSEventEnvConfig;
struct GDSEventFldDef;
struct GDSEventTimeZone;
struct GDSEventLightConfig;
struct GDSEventBustupTalkConfig;
struct GDSEventSubtitleConfig;
struct GDSEventGeneralBustupTalkDataConfig;

// menu
struct GDSMenuCreateConfig;
struct GDSMenuDataFileConfig;
struct GDSMenuPresetConfig;
struct GDSMenuPopupConfig;
struct GDSLayoutConfig;

// soccer
struct GDSSoccerGameConfig;
struct GDSSoccerCharaPlacement;
struct GDSSoccerUserAIConfig;

// system / audio
struct GDSBgmConfig;
struct GDSSoundQueueSheet;

// ===========================================================================
// GDD — donnees runtime mutables (save/session, ~50 classes)
// ===========================================================================

struct CGDDSerialize;
struct CGDDHeaderData;
struct CGDDPlayData;
struct CGDDChara;
struct CGDDCharaCollection;
struct CGDDCharaStatus;
struct CGDDHumanChara;
struct CGDDEditChara;
struct CGDDInventoryConsume;
struct CGDDInventoryEquipment;
struct CGDDInventoryAnimal;
struct CGDDInventoryCollection;
struct CGDDInventoryCraftObj;
struct CGDDInventoryKizunaLink;
struct CGDDInventoryNamePlate;
struct CGDDInventoryPerformance;
struct CGDDInventorySkill;
struct CGDDInventoryStatus;
struct CGDDInventoryTeamItem;
struct CGDDInventoryTitle;
struct CGDDBasaraSpirit;
struct CGDDElementSpirit;
struct CGDDHeroSpirit;
struct CGDDNormalSpirit;
struct CGDDTokenSpirit;
struct CGDDQuestStatus;
struct CGDDMissionStatus;
struct CGDDPartyStatus;
struct CGDDPhaseStatus;
struct CGDDRpgBattleData;
struct CGDDShopStatus;
struct CGDDFlagStatus;
struct CGDDRandStatus;

// ===========================================================================
// UI — systeme de menus (417 classes CMenu*)
// ===========================================================================

struct CMenuController;
struct CMenuStateMachine;
struct CMenuPopup;
struct CMenuLoading;
struct CMenuSavingIcon;
struct CLuaMenuObject;
struct CMenuMinimap;

// components (menu_components.h)
struct CMenuComponentBase;
struct CMenuIconSwapComponent;
struct CMenuCreatePrimitiveComponent;
struct CMenuCharaModelComponent;
struct CMenuEffectAttachComponent;
struct CMenuCtrlTextComponent;
struct CMenuChangeMaterialColor;
struct CMenuFocusDeactiveMouse;
struct CMenuDropItemComponent;
struct CMenuLoopTimeComponent;
struct CMenuMapComponent;
struct CMenuSimpleMoveLocator;
struct CMenuEventOnePictureFilter;
struct MenuTextLongCtrlComponent;
struct MenuButtonGuideSystemComponent;
struct MenuButtonGuideManageComponent;
struct MenuVirtualPadComponent;
struct MenuCursorReflectSituationComponent;
struct MenuInputDeviceReflectComponent;
struct MenuSimplePrimitiveComponent;

// properties (menu_properties.h)
struct CMenuPropertyBase;
struct CMenuCaptionInfoProperty;
struct CMenuTextPlateUpdateProperty;
struct CMenuSoundCmdProperty;
struct CMenuCharaMaskProperty;
struct MenuButtonGuideInfoProperty;

// controls (menu_controls.h)
struct CMenuNumRoll;
struct CMenuCountUpCtrl;
struct CMenuRefModelFadeCtrl;
struct CMenuLayerAnim;
struct CMenuDotCharaAnim;
struct MenuAnimationLink;
struct MenuMaterialColorGradation;

// standalone menus (menu_standalone.h)
struct BeansTradeMenu;
struct AbilityListMenu;
struct HistoryCheckMenu;

// lua commands (lua_menu_commands.h)
enum class MenuCommand : uint32_t;

// listview (66+ specialisations)
struct CMenuListViewChara;
struct CMenuListViewCharaBank;
struct CMenuListViewCharaBankFilter;
struct CMenuListViewCharaFilter;
struct CMenuListViewCharaReverseLookup;
struct CMenuListViewCharaEquip;
struct CMenuListViewCharaEditColor;
struct CMenuListViewCharaEditParts;
struct CMenuListViewAbility;
struct CMenuListViewEquip;
struct CMenuListViewEquipAuraSkill;
struct CMenuListViewEquipMedalSet;
struct CMenuListViewEquipMedalSetPos;
struct CMenuListViewInventory;
struct CMenuListViewItem;
struct CMenuListViewItemFilter;
struct CMenuListViewSoccerAuraParameter;
struct CMenuListViewSoccerGameOptionBgm;
struct CMenuListViewSoccerGameOptionCommentator;
struct CMenuListViewSoccerGameOptionField;
struct CMenuListViewSoccerHarfTimeScorer;
struct CMenuListViewSoccerOverrideSkillParameter;
struct CMenuListViewSoccerParameter;
struct CMenuListViewSoccerPracticeMatch;
struct CMenuListViewSoccerResult;
struct CMenuListViewSoccerSpirit;
struct CMenuListViewSoccerSpiritFilter;
struct CMenuListViewSoccerSummon;
struct CMenuListViewSoccerSummonChara;
struct CMenuListViewSoccerVsCpu;
struct CMenuListViewSpecialTrainingBgm;
struct CMenuListViewNetworkBlockUser;
struct CMenuListViewNetworkRoom;
struct CMenuListViewNetworkRoomMemberTown;
struct CMenuListViewNetworkRoomTown;
struct CMenuListViewNFC;
struct CMenuListViewQuest;
struct CMenuListViewQuestSubWindowCommon;
struct CMenuListViewMapTravel;
struct CMenuListViewMusic;
struct CMenuListViewGallery;
struct CMenuListViewShop;
struct CMenuListViewShopBasaraSearchChara;
struct CMenuListViewKeyConfig;
struct CMenuListViewSetting;
struct CMenuListViewRecord;
struct CMenuListViewRpgResult;
struct CMenuListViewSceneArchive;
struct CMenuListViewSubWindowCommon;
struct CMenuListViewSystemUnlock;
struct CMenuListViewUniverseChara;
struct CMenuListViewUniverseSearchChara;
struct CMenuListViewUniverseSearchResult;
struct CMenuListViewUserNamePlate;
struct CMenuListViewVsRoute;
struct CMenuListViewFashion;
struct CMenuListViewHelp;
struct CMenuListViewInfoBookmark;
struct CMenuListViewInformationDelivery;
struct CMenuListViewInacodeComment;
struct CMenuListViewInacodeRoom;
struct CMenuListViewKizunaLink;
struct CMenuListViewPost;
struct CMenuListViewPostDetail;
struct CMenuListViewOpponentTeam;
struct CMenuListViewPhotoInfo;
struct CMenuListViewPhotoManage;
struct CMenuListViewVisitorList;
struct CMenuListViewDropRateList;
struct CMenuListViewDictionary;

// extra listviews (listview_extra.h)
struct MenuNestListView;
struct MenuListViewSoccerFormation;
struct MenuListViewMatchRecord;
struct MenuListViewAbilityLearningReport;
struct MenuListViewInformationDeliveryResult;
struct MenuListViewInformationDeliveryItem;
struct MenuListViewCommunication;
struct MenuListViewAnimal;
struct MenuListViewItemUse;
struct MenuListViewCraft;
struct MenuListViewMapMenu;
struct MenuListViewDatafile;
struct MenuListViewArmedChara;
struct MenuListViewUseVictoryBox;
struct MenuListViewSpecialTrainingFasttravel;
struct MenuListViewSelectScoutChara;
struct MenuListViewInformationBanner;
struct MenuListViewSoccerPerformanceCharaList;

// scene states
struct ISceneState;
struct IGameNetState;
struct TitleMenuState;
struct SoccerResultMenuState;
struct SoccerState;
struct SoccerTrainingState;
struct VSRouteState;
struct TextChatState;
struct InitState;
struct GameOverState;
struct EventState;
struct EndTitleState;
struct TrialInitState;
struct TrialThankYouState;
struct SceneRpgBattle_MenuState;
struct SceneSoccerTrainingMenuState;
struct SceneCraftArrangementMember_MenuState;
struct SceneCraftEdit_MenuState;
struct SceneCraftWarp_MenuState;

namespace menuvsroute { struct MenuState; }
namespace soccerscene { struct MenuState; struct ResultMenuState; }

} // namespace game
