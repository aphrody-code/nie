#pragma once

/// @file game_constants.h
/// Constantes globales du jeu Inazuma Eleven: Victory Road (nie.exe).
/// Avertissement : adresses valides pour nie.exe v5.00.24.00 (Steam, base 0x140000000).

#include <cstdint>
#include <string_view>
#include <array>

namespace iecode::game {

// ---------------------------------------------------------------------------
// Identifiants Steam
// ---------------------------------------------------------------------------

/// Steam App ID du jeu.
inline constexpr uint32_t STEAM_APP_ID = 2799860;

/// Nom du dossier Steam.
inline constexpr std::string_view STEAM_FOLDER = "INAZUMA ELEVEN Victory Road";

/// Nom de l'executable principal.
inline constexpr std::string_view EXE_NAME = "nie.exe";

/// Nom interne de l'executable.
inline constexpr std::string_view EXE_INTERNAL_NAME = "nie1v2.exe";

/// Version de l'application.
inline constexpr std::string_view APP_VERSION = "5.00.24.00";

// ---------------------------------------------------------------------------
// Chemins de fichiers par defaut
// ---------------------------------------------------------------------------

/// Repertoire de dump par defaut.
inline constexpr std::string_view DEFAULT_DUMP_PATH = ".";

/// Repertoire de scripts par defaut.
inline constexpr std::string_view DEFAULT_SCRIPTS_PATH = "scripts";

/// Nombre total d'archives CPK dans data/packs/.
inline constexpr uint32_t CPK_ARCHIVE_COUNT = 921;

/// Chemin du mapping CPK → nom lisible.
inline constexpr std::string_view CPK_LIST_PATH = "data/cpk_list.cfg.bin";

// ---------------------------------------------------------------------------
// Crypto CRI Middleware
// ---------------------------------------------------------------------------

/// Cle XOR utilisee pour chiffrer les fichiers CRI (scripts Lua, USM, ACB...).
inline constexpr uint32_t CRI_XOR_KEY = 0x1717E18EU;

// ---------------------------------------------------------------------------
// Chemins VFS (prefixe #/ = resolution par CRC32, FUN_1402b5cb0)
// ---------------------------------------------------------------------------

/// Repertoire des icones UI.
inline constexpr std::string_view VFS_MENU_ICON    = "#/menu/200_icon/";

/// Repertoire des minimaps UI.
inline constexpr std::string_view VFS_MENU_MINIMAP = "#/menu/210_minimap/";

/// Repertoire des images UI.
inline constexpr std::string_view VFS_MENU_IMG     = "#/menu/220_img/";

/// Format du chemin minimap : <zone>/<zone>.
inline constexpr std::string_view VFS_MINIMAP_FORMAT = "#/menu/210_minimap/%s/mmp_%s_00.g4tx";

/// Format image UI localisee.
inline constexpr std::string_view VFS_IMG_LOCALIZED_FORMAT = "#/menu/220_img/%s<LG>/%s.g4tx";

/// Repertoire des shaders compute.
inline constexpr std::string_view VFS_SHADER_ROOT = "#/shader/";

/// Nom du fichier de configuration des shaders.
inline constexpr std::string_view SHADER_LIST_CFG = "shader_list.cfg.bin";

// ---------------------------------------------------------------------------
// Scripts Lua menu
// ---------------------------------------------------------------------------

/// Format du chemin des scripts Lua menu (chiffres XOR CRI + LZ10).
inline constexpr std::string_view LUA_MENU_PATH_FORMAT = "common/script/lua/menu/%s.lua.bin";

/// Chaine de recherche de modules Lua (Lua package.path).
inline constexpr std::string_view LUA_PACKAGE_PATH =
    "!\\lua\\?.lua;!\\lua\\?\\init.lua;!\\?.lua;!\\?\\init.lua;.\\?.lua";

// ---------------------------------------------------------------------------
// Adresses de fonctions nie.exe (base 0x140000000, v5.00.24.00)
// ---------------------------------------------------------------------------

namespace addr {

/// Resolveur VFS CRC32 : #/<path> → chemin reel.
inline constexpr uint64_t VFS_RESOLVE        = 0x1402b5cb0ULL;

/// Loader principal des scripts Lua menu (nie.c:3005061).
/// CRC32 lookup → snprintf("common/script/lua/menu/%s.lua.bin", name)
inline constexpr uint64_t LUA_MENU_LOADER    = 0x14103df90ULL;

/// Loader Lua alternatif 1.
inline constexpr uint64_t LUA_LOADER_ALT1    = 0x14102b400ULL;

/// Loader Lua alternatif 2.
inline constexpr uint64_t LUA_LOADER_ALT2    = 0x1410430a0ULL;

/// Loader Lua alternatif 3.
inline constexpr uint64_t LUA_LOADER_ALT3    = 0x14107a290ULL;

/// Setup Lua package.path.
inline constexpr uint64_t LUA_PATH_SETUP     = 0x1405a8a10ULL;

/// Pipeline de rendu principal : enregistrement des 13 draw passes.
inline constexpr uint64_t RENDER_PIPELINE    = 0x140eff080ULL;

/// Initialisation moteur de rendu (shaders, PhysX, CMenuRender).
inline constexpr uint64_t RENDER_INIT        = 0x140ef27c0ULL;

/// Lecture layoutPosX / layoutPosY depuis cfg.bin.
inline constexpr uint64_t LAYOUT_POS         = 0x140110180ULL;

/// Lecture layoutInfoId depuis cfg.bin.
inline constexpr uint64_t LAYOUT_INFO_ID     = 0x140131850ULL;

/// Lecture m_layerLayoutScale depuis cfg.bin.
inline constexpr uint64_t LAYER_SCALE        = 0x1402e6620ULL;

/// Lecture m_virtualPadLayoutInfoList depuis cfg.bin.
inline constexpr uint64_t VIRTUAL_PAD_LAYOUT = 0x1401326f0ULL;

/// Gestionnaire pad virtuel.
inline constexpr uint64_t VIRTUAL_PAD_MGR    = 0x140adac30ULL;

// ---- Loader textures UI ----

/// Loader icone item / icone common / tactics / stadium / savedata.
inline constexpr uint64_t TEX_LOADER_COMMON  = 0x140fb3210ULL;

/// Loader icone visage personnage.
inline constexpr uint64_t TEX_LOADER_FACE    = 0x140fb0560ULL;

/// Loader minimap.
inline constexpr uint64_t TEX_LOADER_MINIMAP = 0x141079750ULL;

/// Loader image UI localisee.
inline constexpr uint64_t TEX_LOADER_IMG_LG  = 0x140db11a0ULL;

/// Loader image adversaire / savedata.
inline constexpr uint64_t TEX_LOADER_IMG2    = 0x140db0490ULL;

/// Loader image adversaire.
inline constexpr uint64_t TEX_LOADER_OPPO    = 0x140bd5b00ULL;

/// Loader calendrier.
inline constexpr uint64_t TEX_LOADER_CAL     = 0x140f70ae0ULL;

// ---- Bridge funcLua* (enregistres via lua_register, FUN_1405992e0) ----

/// funcLuaMenuCommand — menus generaux.
inline constexpr uint64_t FUNC_LUA_MENU_CMD          = 0x140c39f90ULL;

/// funcLuaMenuMapCommand — carte RPG.
inline constexpr uint64_t FUNC_LUA_MAP_CMD           = 0x1410357f0ULL;

/// funcLuaMenuNetworkCommand — reseau.
inline constexpr uint64_t FUNC_LUA_NETWORK_CMD       = 0x141088380ULL;

/// funcLuaMenuMultiplayCommand — multijoueur.
inline constexpr uint64_t FUNC_LUA_MULTIPLAY_CMD     = 0x141091350ULL;

/// funcLuaMenuVSRouteTownCommand — VS Route.
inline constexpr uint64_t FUNC_LUA_VSROUTE_CMD       = 0x141116110ULL;

/// funcLuaActionCommand — actions scene.
inline constexpr uint64_t FUNC_LUA_ACTION_CMD        = 0x140b769a0ULL;

/// funcLuaEffectCommand — effets.
inline constexpr uint64_t FUNC_LUA_EFFECT_CMD        = 0x140c39dc0ULL;

/// funcLuaCameraCommand — camera.
inline constexpr uint64_t FUNC_LUA_CAMERA_CMD        = 0x140b799f0ULL;

/// funcLuaCommand — generique.
inline constexpr uint64_t FUNC_LUA_CMD               = 0x140c34ec0ULL;

/// funcLuaMenuDictCommand — dictionnaire.
inline constexpr uint64_t FUNC_LUA_DICT_CMD          = 0x140fc2530ULL;

/// funcLuaMenuMapTravelCommand — voyage.
inline constexpr uint64_t FUNC_LUA_MAP_TRAVEL_CMD    = 0x14103b990ULL;

/// funcLuaMenuNfcCommand — NFC.
inline constexpr uint64_t FUNC_LUA_NFC_CMD           = 0x141097110ULL;

/// funcLuaMenuPostCommand — posts.
inline constexpr uint64_t FUNC_LUA_POST_CMD          = 0x1410b8580ULL;

/// funcLuaMenuPostListCommand — liste de posts.
inline constexpr uint64_t FUNC_LUA_POST_LIST_CMD     = 0x1410b7ed0ULL;

/// funcLuaSpTacticsCommand — tactiques speciales.
inline constexpr uint64_t FUNC_LUA_SP_TACTICS_CMD    = 0x140c97e00ULL;

} // namespace addr

// ---------------------------------------------------------------------------
// Noms des passes de rendu (gmdCDrawObjModelPriority)
// ---------------------------------------------------------------------------

namespace draw_pass {
    inline constexpr std::string_view UI_BEFORE         = "00_UI_Before";
    inline constexpr std::string_view ZERO              = "00_Zero";
    inline constexpr std::string_view MAP_BEFORE        = "10_MapBefore";
    inline constexpr std::string_view PROJ_EFFECT       = "15_ProjEffect";
    inline constexpr std::string_view CHARA_BEFORE      = "20_CharaBefore";
    inline constexpr std::string_view CHARA_AFTER       = "25_CharaAfter";
    inline constexpr std::string_view MAP_AFTER         = "30_MapAfter";
    inline constexpr std::string_view EFFECT            = "40_Effect";
    inline constexpr std::string_view POST              = "50_Post";
    inline constexpr std::string_view POST_AFTER        = "51_PostAfter";
    inline constexpr std::string_view PRE_MENU_END_DRAW = "59_PreMenuEndDraw";
    inline constexpr std::string_view UI                = "60_UI";
    inline constexpr std::string_view POST_MENU_END     = "61_PostMenuEndDraw";
} // namespace draw_pass

// ---------------------------------------------------------------------------
// Enumerations du jeu — extraites des cfg.bin et scripts Lua decompiles
// ---------------------------------------------------------------------------

/// Series (franchise) — listItemType 1
namespace series {
    struct SeriesInfo {
        uint32_t index_;
        uint32_t crc32_;
        std::string_view internal_name_;
        std::string_view label_;
    };

    inline constexpr uint32_t CRC_IE1      = 0x62E8448FU;
    inline constexpr uint32_t CRC_IE2      = 0xFBE11535U;
    inline constexpr uint32_t CRC_IE3      = 0x8CE625A3U;
    inline constexpr uint32_t CRC_GO1      = 0x9299810FU;
    inline constexpr uint32_t CRC_GO2      = 0x0B90D0B5U;
    inline constexpr uint32_t CRC_GO3      = 0x7C97E023U;
    inline constexpr uint32_t CRC_ARES     = 0x6461BCB4U;
    inline constexpr uint32_t CRC_ORION    = 0xE43DAFA3U;
    inline constexpr uint32_t CRC_VICTORY  = 0xE177FC30U;

    inline constexpr std::array<SeriesInfo, 9> ALL = {{
        {1, CRC_IE1,     "chara_series_ie1",     "Inazuma Eleven"},
        {2, CRC_IE2,     "chara_series_ie2",     "Inazuma Eleven 2"},
        {3, CRC_IE3,     "chara_series_ie3",     "Inazuma Eleven 3"},
        {4, CRC_GO1,     "chara_series_go1",     "Inazuma Eleven GO"},
        {5, CRC_GO2,     "chara_series_go2",     "Inazuma Eleven GO Chrono Stone"},
        {6, CRC_GO3,     "chara_series_go3",     "Inazuma Eleven GO Galaxy"},
        {7, CRC_ARES,    "chara_series_ares",    "Inazuma Eleven Ares"},
        {8, CRC_ORION,   "chara_series_orion",   "Inazuma Eleven Orion"},
        {9, CRC_VICTORY, "chara_series_victory", "Inazuma Eleven Victory Road"},
    }};
} // namespace series

/// Elements — listItemType 4
namespace element {
    inline constexpr uint32_t CRC_WIND     = 0x0EB943B3U;
    inline constexpr uint32_t CRC_FOREST   = 0x6E59C889U;
    inline constexpr uint32_t CRC_FIRE     = 0x776C1E82U;
    inline constexpr uint32_t CRC_MOUNTAIN = 0x9097CD4AU;
} // namespace element

/// Raretes — listItemType 5, valueInternal commence a 0
namespace rarity {
    struct RarityInfo {
        uint8_t id_;
        uint8_t value_internal_;
        uint32_t crc32_;
        std::string_view label_fr_;
    };

    inline constexpr uint32_t CRC_NORMAL          = 0xF4E9FBFCU;
    inline constexpr uint32_t CRC_EN_PROGRESSION   = 0x6DE0AA46U;
    inline constexpr uint32_t CRC_EXPERIMENTE      = 0x1AE79AD0U;
    inline constexpr uint32_t CRC_EMERITE          = 0x84830F73U;
    inline constexpr uint32_t CRC_LEGENDAIRE       = 0xF3843FE5U;
    inline constexpr uint32_t CRC_LEGENDAIRE_PLUS  = 0x6A8D6E5FU;
    inline constexpr uint32_t CRC_LEGENDAIRE_PP    = 0x1D8A5EC9U;
    inline constexpr uint32_t CRC_LEGENDAIRE_PPP   = 0x8D354358U;
    inline constexpr uint32_t CRC_HERO             = 0x9AF5FA2BU;

    inline constexpr std::array<RarityInfo, 9> ALL = {{
        { 0, 0, CRC_NORMAL,          "Normal"},
        { 1, 1, CRC_EN_PROGRESSION,   "En Progression"},
        { 2, 2, CRC_EXPERIMENTE,      "Experimente"},
        { 3, 3, CRC_EMERITE,          "Emerite"},
        { 4, 4, CRC_LEGENDAIRE,       "Legendaire"},
        { 5, 5, CRC_LEGENDAIRE_PLUS,  "Legendaire+"},
        { 6, 6, CRC_LEGENDAIRE_PP,    "Legendaire++"},
        { 7, 7, CRC_LEGENDAIRE_PPP,   "Legendaire+++"},
        {10, 8, CRC_HERO,             "Hero"},
    }};
} // namespace rarity

/// Genres — listItemType 6
namespace gender {
    inline constexpr uint32_t CRC_MALE    = 0x3EEBF867U;
    inline constexpr uint32_t CRC_FEMALE  = 0x0C61839CU;
    inline constexpr uint32_t CRC_UNKNOWN = 0x10DD40D2U;
} // namespace gender

/// Morphologies — listItemType 7
namespace body_type {
    struct BodyTypeInfo {
        uint32_t crc32_;
        std::string_view internal_name_;
        std::string_view label_fr_;
        std::string_view text_ja_;
    };

    inline constexpr uint32_t CRC_NORMAL   = 0x38DF4CEAU;
    inline constexpr uint32_t CRC_SMALL    = 0x43579585U;
    inline constexpr uint32_t CRC_BIG      = 0xE7901492U;
    inline constexpr uint32_t CRC_TALL     = 0x107520B2U;
    inline constexpr uint32_t CRC_MUSCLE   = 0xEA4B3DE1U;
    inline constexpr uint32_t CRC_SMALLFAT = 0x8652E263U;

    inline constexpr std::array<BodyTypeInfo, 6> ALL = {{
        {CRC_NORMAL,   "normal",   "Normal",        "普通"},
        {CRC_SMALL,    "small",    "Petit gabarit", "小柄"},
        {CRC_BIG,      "big",      "Grand gabarit", "大柄"},
        {CRC_TALL,     "tall",     "Elance",        "のっぽ"},
        {CRC_MUSCLE,   "muscle",   "Muscle",        "筋肉"},
        {CRC_SMALLFAT, "smallfat", "Petit et rond", "小太り"},
    }};
} // namespace body_type

/// Types de build strategique — listItemType 10
namespace build_type {
    struct BuildTypeInfo {
        uint8_t id_;
        uint32_t crc32_;
        std::string_view internal_name_;
        std::string_view label_;
        std::string_view text_ja_;
    };

    inline constexpr uint32_t CRC_FORCE_WIN  = 0x1EA47A48U;
    inline constexpr uint32_t CRC_COUNTER    = 0xBD233DFAU;
    inline constexpr uint32_t CRC_KIZUNA     = 0x0DE6836CU;
    inline constexpr uint32_t CRC_TENSION    = 0xF19211EBU;
    inline constexpr uint32_t CRC_ROUGH_PLAY = 0xF317B216U;
    inline constexpr uint32_t CRC_FAIR_PLAY  = 0xEEC42D61U;

    inline constexpr std::array<BuildTypeInfo, 6> ALL = {{
        {0, CRC_FORCE_WIN,  "force_win",  "Force Win (Breach)", "必殺"},
        {1, CRC_COUNTER,    "counter",    "Counter",            "カウンター"},
        {2, CRC_KIZUNA,     "kizuna",     "Kizuna (Bond)",      "キズナ"},
        {3, CRC_TENSION,    "tension",    "Tension",            "テンション"},
        {4, CRC_ROUGH_PLAY, "rough_play", "Rough Play",         "ラフプレー"},
        {5, CRC_FAIR_PLAY,  "fair_play",  "Fair Play (Justice)", "正義"},
    }};
} // namespace build_type

/// Roles — listItemType 11
namespace role {
    inline constexpr uint32_t CRC_PLAYER  = 0x63074D2EU;
    inline constexpr uint32_t CRC_COACH   = 0xF5224393U;
    inline constexpr uint32_t CRC_MANAGER = 0x1BD1A396U;
} // namespace role

/// Categories de skills (hissatsu)
namespace skill_category {
    inline constexpr uint32_t CRC_SHOOT   = 0x7044FCBEU;
    inline constexpr uint32_t CRC_DRIBBLE = 0x1EB19FC4U;
    inline constexpr uint32_t CRC_BLOCK   = 0x831B9722U;
    inline constexpr uint32_t CRC_CATCH   = 0xC56B7B64U;
} // namespace skill_category

/// CRC32 des 7 stats de personnage
namespace stat_hash {
    inline constexpr uint32_t KICK         = 0x1ED5DF05U;
    inline constexpr uint32_t CONTROL      = 0xEDDB2C4BU;
    inline constexpr uint32_t TECHNIQUE    = 0xD73B9841U;
    inline constexpr uint32_t PRESSURE     = 0x5FAFA067U;
    inline constexpr uint32_t PHYSICAL     = 0xD7293008U;
    inline constexpr uint32_t AGILITY      = 0x65027F8FU;
    inline constexpr uint32_t INTELLIGENCE = 0xD7D8E6C3U;
} // namespace stat_hash

/// CRC32 des onglets de filtre UI (listview chara)
namespace filter_tab {
    inline constexpr uint32_t CRC_BELONG_TEAM = 0x7AAE281EU;
    inline constexpr uint32_t CRC_POSITION    = 0x3C276E8DU;
    inline constexpr uint32_t CRC_ELEMENT     = 0x20908EB2U;
    inline constexpr uint32_t CRC_RARITY      = 0x0CEFE698U;
    inline constexpr uint32_t CRC_APPEARANCE  = 0x4038615BU;
    inline constexpr uint32_t CRC_BUILD       = 0x99BF2F6EU;
    inline constexpr uint32_t CRC_ROLE        = 0xFC179999U;
} // namespace filter_tab

/// Mapping listItemType → categorie de filtre
namespace list_item_type {
    inline constexpr uint8_t SERIES      = 1;
    inline constexpr uint8_t BELONG_TEAM = 2;
    inline constexpr uint8_t POSITION    = 3;
    inline constexpr uint8_t ELEMENT     = 4;
    inline constexpr uint8_t RARITY      = 5;
    inline constexpr uint8_t GENDER      = 6;
    inline constexpr uint8_t BODY_TYPE   = 7;
    inline constexpr uint8_t RESERVED    = 8;
    inline constexpr uint8_t SELECT_ALL  = 9;
    inline constexpr uint8_t BUILD_TYPE  = 10;
    inline constexpr uint8_t ROLE        = 11;
} // namespace list_item_type

// ---------------------------------------------------------------------------
// Chemins dynamiques de textures UI (patterns extraits de nie.c)
// ---------------------------------------------------------------------------

namespace tex_path {
    /// Icone d'item : icon_item{N}.g4tx
    inline constexpr std::string_view ICON_ITEM         = "#/menu/200_icon/02_icon_item/icon_item%d.g4tx";

    /// Icone de visage personnage : face/{code}.g4tx
    inline constexpr std::string_view ICON_FACE         = "#/menu/200_icon/10_icon_chr/face/%s.g4tx";

    /// Icone commune localisee : icon_common.g4tx
    inline constexpr std::string_view ICON_COMMON       = "#/menu/200_icon/15_icon_common/<LG>/icon_common.g4tx";

    /// Image adversaire
    inline constexpr std::string_view IMG_OPPONENT       = "#/menu/220_img/opponent_img/%s.g4tx";

    /// Image savedata
    inline constexpr std::string_view IMG_SAVEDATA       = "#/menu/220_img/savedata_img/savedata_ch_img%02u.g4tx";

    /// Image calendrier
    inline constexpr std::string_view IMG_CALENDAR       = "#/menu/220_img/calendar_img/%s.g4tx";

    /// Image fond de stade
    inline constexpr std::string_view IMG_STADIUM_BG     = "#/menu/220_img/stadium/img_vs_bg_%s.g4tx";

    /// Image aide (localisee + plateforme)
    inline constexpr std::string_view IMG_HELP           = "#/menu/220_img/hlp/<LG>/<PF>/%s.g4tx";
} // namespace tex_path

} // namespace iecode::game
