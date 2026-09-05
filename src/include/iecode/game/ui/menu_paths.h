#pragma once

/// @file menu_paths.h
/// Constantes VFS pour le sous-systeme de menus du jeu.
///
/// Cartographie complete des repertoires VFS menu vers les classes C++ :
///
/// ============================================================================
/// Repertoire VFS                    | Classes C++ utilisatrices
/// ============================================================================
/// data/common/menu/00_soccer/       | CMenuListViewSoccer*, CSoccerStateMachine,
///                                   | soccerscene::MenuState
/// data/common/menu/01_rpg/          | CMenuListViewRpgResult, CRpgBattleTurnManager,
///                                   | SceneRpgBattle_MenuState
/// data/common/menu/02_btl/          | CMenuListViewAbility*, SceneRpgBattle_MenuState
/// data/common/menu/10_win/          | CMenuPopup, CMenuStateMachine (fenetres modales)
/// data/common/menu/20_cmn/          | MenuButtonGuideSystemComponent,
///                                   | MenuInputDeviceReflectComponent (elements communs)
/// data/common/menu/30_vsroute/      | CMenuListViewVsRoute,
///                                   | menuvsroute::MenuState
/// data/common/menu/31_universe/     | CMenuListViewUniverseChara,
///                                   | CMenuListViewUniverseSearchChara
/// data/common/menu/50_title/        | TitleMenuState
/// data/common/menu/90_map/          | CMenuListViewMapTravel, CMenuMapComponent,
///                                   | CMenuMinimap
/// data/common/menu/91_quest/        | CMenuListViewQuest,
///                                   | CMenuListViewQuestSubWindowCommon
/// data/common/menu/100_mainmenu/    | CMenuController (menu principal)
/// data/common/menu/101_member/      | CMenuListViewChara, CMenuListViewCharaBank
/// data/common/menu/102_team/        | CMenuListViewEquip*, MenuListViewSoccerFormation,
///                                   | MenuListViewArmedChara
/// data/common/menu/103_item/        | CMenuListViewInventory, CMenuListViewItem,
///                                   | CMenuDropItemComponent
/// data/common/menu/105_datafile/    | MenuListViewDatafile
/// data/common/menu/106_info/        | CMenuListViewInfoBookmark,
///                                   | CMenuListViewInformationDelivery
/// data/common/menu/107_vs/          | CMenuListViewSoccerVsCpu,
///                                   | CMenuListViewOpponentTeam
/// data/common/menu/108_option/      | CMenuListViewKeyConfig, CMenuListViewSetting
/// data/common/menu/115_calendar/    | (Lua-driven, pas de classe C++ dediee)
/// data/common/menu/121_inacord/     | CMenuListViewInacodeComment,
///                                   | CMenuListViewInacodeRoom
/// data/common/menu/125_multi/       | CMenuListViewNetworkRoom,
///                                   | CMenuListViewNetworkBlockUser
/// data/common/menu/150_shop/        | CMenuListViewShop,
///                                   | CMenuListViewShopBasaraSearchChara
/// data/common/menu/150_list/        | CMenuListViewSubWindowCommon (listes generiques)
/// data/common/menu/160_town/        | CMenuListViewMapTravel (deplacement ville)
/// data/common/menu/161_avatar/      | CMenuListViewCharaEdit, CMenuListViewFashion
/// data/dx11/menu/200_icon/          | lives::CMenuIconDraw, CMenuIconSwapComponent
/// data/dx11/menu/220_img/           | CMenuCharaModelComponent (bustups, savedata)
/// data/common/menu/600_event/       | CMenuEventOnePictureFilter
/// data/common/menu/obj/             | (objbin scenes 3D menu)
/// data/common/menu/cfg/             | (fichiers cfg.bin de parametrage menu)
///
/// ============================================================================
/// Fichier config (cfg.bin)          | Struct/classe qui le charge
/// ============================================================================
/// menu_minimap_config               | CMenuMinimap, CMenuMapComponent
/// virtual_pad_button_config         | MenuVirtualPadComponent
/// chara_face_icon_config            | lives::CMenuIconDraw (atlas face/)
/// menu_graphic_number_config        | CMenuNumRoll
/// menu_chara_model_pose_config      | CMenuCharaModelComponent
/// menu_create_setting               | BeansTradeMenu, MenuListViewCraft
///
/// ============================================================================
/// Pattern script Lua                | Instance CLuaMenuObject
/// ============================================================================
/// common/script/lua/menu/%s.lua.bin | CLuaMenuObject::SCRIPT_PATH_FMT
///   Exemples : chara_select, title, soccer_result, rpg_battle, vs_route,
///              shop, team_edit, option, calendar, inacord, quest, map_travel,
///              multiplay, post, nfc, dictionary
/// ============================================================================

#include <fmt/format.h>
#include <string>
#include <string_view>

namespace game::menu_paths {

// ============================================================================
// Repertoires VFS — menus communs (data/common/menu/)
// ============================================================================

namespace dir {

/// Soccer UI (1729 fichiers — layouts match, score, mi-temps, formation).
inline constexpr std::string_view SOCCER       = "data/common/menu/00_soccer";

/// RPG battle UI (295 fichiers — tours de combat, resultats).
inline constexpr std::string_view RPG          = "data/common/menu/01_rpg";

/// Battle UI (650 fichiers — competences, effets, barres de vie).
inline constexpr std::string_view BATTLE       = "data/common/menu/02_btl";

/// Fenetres modales (564 fichiers — popups, dialogues, confirmations).
inline constexpr std::string_view WINDOW       = "data/common/menu/10_win";

/// Elements communs (148 fichiers — boutons, guides, jauges).
inline constexpr std::string_view COMMON       = "data/common/menu/20_cmn";

/// VS Route UI (203 fichiers — selection route, matchmaking).
inline constexpr std::string_view VS_ROUTE     = "data/common/menu/30_vsroute";

/// Players Universe UI (493 fichiers — recherche, recrutement).
inline constexpr std::string_view UNIVERSE     = "data/common/menu/31_universe";

/// Ecran titre (234 fichiers — logo, selection profil).
inline constexpr std::string_view TITLE        = "data/common/menu/50_title";

/// Carte / minimap (56 fichiers — textures carte, indicateurs).
inline constexpr std::string_view MAP          = "data/common/menu/90_map";

/// Quetes (130 fichiers — liste, detail, sous-fenetres).
inline constexpr std::string_view QUEST        = "data/common/menu/91_quest";

/// Menu principal (293 fichiers — hub navigation).
inline constexpr std::string_view MAIN_MENU    = "data/common/menu/100_mainmenu";

/// Membres / equipe (43 fichiers — liste personnages).
inline constexpr std::string_view MEMBER       = "data/common/menu/101_member";

/// Gestion d'equipe (705 fichiers — equipement, formation, placement).
inline constexpr std::string_view TEAM         = "data/common/menu/102_team";

/// Objets / inventaire (64 fichiers — liste items, detail).
inline constexpr std::string_view ITEM         = "data/common/menu/103_item";

/// Fichiers de donnees (73 fichiers — navigateur datafile).
inline constexpr std::string_view DATAFILE     = "data/common/menu/105_datafile";

/// Informations (50 fichiers — favoris, livraison, banniere).
inline constexpr std::string_view INFO         = "data/common/menu/106_info";

/// Mode VS (325 fichiers — matchs CPU, selection adversaire).
inline constexpr std::string_view VS           = "data/common/menu/107_vs";

/// Options / parametres (53 fichiers — config touches, graphismes).
inline constexpr std::string_view OPTION       = "data/common/menu/108_option";

/// Calendrier (59 fichiers — evenements quotidiens).
inline constexpr std::string_view CALENDAR     = "data/common/menu/115_calendar";

/// Inacord social (41 fichiers — chat, salles).
inline constexpr std::string_view INACORD      = "data/common/menu/121_inacord";

/// Multijoueur (48 fichiers — salons, matchmaking).
inline constexpr std::string_view MULTI        = "data/common/menu/125_multi";

/// Boutique (145 fichiers — liste produits, achat).
inline constexpr std::string_view SHOP         = "data/common/menu/150_shop";

/// Listes generiques (60 fichiers — sous-fenetres communes).
inline constexpr std::string_view LIST         = "data/common/menu/150_list";

/// Ville (211 fichiers — deplacement, interaction PNJ).
inline constexpr std::string_view TOWN         = "data/common/menu/160_town";

/// Avatar / edition personnage (215 fichiers — customisation).
inline constexpr std::string_view AVATAR       = "data/common/menu/161_avatar";

/// Evenements (75 fichiers — scenes evenementielles).
inline constexpr std::string_view EVENT        = "data/common/menu/600_event";

/// Objets 3D de scene menu (3179 fichiers — objbin).
inline constexpr std::string_view OBJ          = "data/common/menu/obj";

/// Fichiers cfg.bin menu (440 fichiers — parametrage).
inline constexpr std::string_view CFG          = "data/common/menu/cfg";

/// Repertoire config global menu.
inline constexpr std::string_view CONFIG       = "data/common/menu/config";

} // namespace dir

// ============================================================================
// Repertoires VFS — textures DX11 (data/dx11/menu/)
// ============================================================================

namespace dx11 {

/// Atlas d'icones (19245 fichiers — items, personnages, communs).
inline constexpr std::string_view ICON         = "data/dx11/menu/200_icon";

/// Sous-repertoires d'icones.
inline constexpr std::string_view ICON_ITEM    = "data/dx11/menu/200_icon/02_icon_item";
inline constexpr std::string_view ICON_CHR     = "data/dx11/menu/200_icon/10_icon_chr";
inline constexpr std::string_view ICON_COMMON  = "data/dx11/menu/200_icon/15_icon_common";

/// Images (16642 fichiers — bustups, savedata, calendrier, adversaires).
inline constexpr std::string_view IMG          = "data/dx11/menu/220_img";

} // namespace dx11

// ============================================================================
// Atlas d'icones — chemins connus
// ============================================================================

namespace icon {

/// Atlas d'icones d'objets (icon_item90.g4tx).
/// Charge par lives::CMenuIconDraw via FUN_140fb3210.
inline constexpr std::string_view ITEM_ATLAS =
    "data/dx11/menu/200_icon/02_icon_item/icon_item90.g4tx";

/// Construit le chemin d'une icone de visage de personnage.
/// Format : data/dx11/menu/200_icon/10_icon_chr/face/{chara_name}.g4tx
/// Charge par FUN_140fb0560.
[[nodiscard]] inline std::string face_icon(std::string_view chara_name) {
    return fmt::format("data/dx11/menu/200_icon/10_icon_chr/face/{}.g4tx",
                       chara_name);
}

/// Construit le chemin de l'atlas d'icones communs pour une langue donnee.
/// Format : data/dx11/menu/200_icon/15_icon_common/{lang}/icon_common.g4tx
/// Charge par FUN_140fb3210.
[[nodiscard]] inline std::string common_icon(std::string_view lang) {
    return fmt::format(
        "data/dx11/menu/200_icon/15_icon_common/{}/icon_common.g4tx", lang);
}

} // namespace icon

// ============================================================================
// Minimap — textures de carte
// ============================================================================

namespace minimap {

/// Repertoire racine minimap (DX11).
inline constexpr std::string_view DIR = "data/dx11/menu/210_minimap";

/// Construit le chemin d'une texture minimap.
/// Format : data/dx11/menu/210_minimap/{map_name}/mmp_{map_name}_00.g4tx
/// Charge par FUN_141079750.
[[nodiscard]] inline std::string texture(std::string_view map_name) {
    return fmt::format("data/dx11/menu/210_minimap/{}/mmp_{}_00.g4tx",
                       map_name, map_name);
}

} // namespace minimap

// ============================================================================
// Images — bustups, savedata, calendrier, adversaires
// ============================================================================

namespace img {

/// Construit le chemin d'une image menu generique (localisee).
/// Format : data/dx11/menu/220_img/{category}{lang}/{name}.g4tx
/// Charge par FUN_140db11a0.
[[nodiscard]] inline std::string generic(std::string_view category,
                                         std::string_view lang,
                                         std::string_view name) {
    return fmt::format("data/dx11/menu/220_img/{}{}/{}.g4tx",
                       category, lang, name);
}

/// Construit le chemin d'une image d'adversaire.
/// Format : data/dx11/menu/220_img/opponent_img/{name}.g4tx
/// Charge par FUN_140bd5b00.
[[nodiscard]] inline std::string opponent(std::string_view name) {
    return fmt::format("data/dx11/menu/220_img/opponent_img/{}.g4tx", name);
}

/// Construit le chemin d'une image de sauvegarde.
/// Format : data/dx11/menu/220_img/savedata_img/savedata_ch_img{index:02}.g4tx
/// Charge par FUN_140db0490.
[[nodiscard]] inline std::string savedata(uint32_t index) {
    return fmt::format(
        "data/dx11/menu/220_img/savedata_img/savedata_ch_img{:02}.g4tx",
        index);
}

/// Construit le chemin d'une image de calendrier.
/// Format : data/dx11/menu/220_img/calendar_img/{name}.g4tx
/// Charge par FUN_140f70ae0.
[[nodiscard]] inline std::string calendar(std::string_view name) {
    return fmt::format("data/dx11/menu/220_img/calendar_img/{}.g4tx", name);
}

} // namespace img

// ============================================================================
// Scripts Lua — menus
// ============================================================================

namespace lua {

/// Repertoire des scripts Lua menu.
inline constexpr std::string_view MENU_SCRIPT_DIR =
    "data/common/script/lua/menu";

/// Construit le chemin d'un script Lua menu.
/// Le nom doit inclure la version presente dans le VFS.
/// Format : data/common/script/lua/menu/{versioned_name}.lua.bin
/// Loader principal : FUN_14103df90 (CRC32 lookup + snprintf).
/// Les .lua.bin sont chiffres CRI XOR (0x1717E18E) puis comprimes LZ10.
[[nodiscard]] inline std::string menu_script(std::string_view name) {
    return fmt::format("data/common/script/lua/menu/{}.lua.bin", name);
}

/// Chemin de recherche Lua defini par nie.exe (FUN_1405a8a10).
inline constexpr std::string_view LUA_PATH =
    R"(!\lua\?.lua;!\lua\?\init.lua)";

} // namespace lua

// ============================================================================
// Fichiers config (cfg.bin) — parametrage menu
// ============================================================================

namespace config {

/// Repertoire cfg.bin du sous-systeme gamedata/menu.
inline constexpr std::string_view GAMEDATA_CFG_DIR =
    "data/common/gamedata/menu/cfg";

/// Repertoire config global menu.
inline constexpr std::string_view MENU_CONFIG_DIR =
    "data/common/menu/config";

/// Config minimap (FUN_141079750).
/// Charge par CMenuMinimap et CMenuMapComponent.
inline constexpr std::string_view MINIMAP_CONFIG =
    "data/common/menu/config/menu_minimap_config_0.00.00.cfg.bin";

/// Config pad virtuel tactile (FUN_1401326f0).
/// Charge par MenuVirtualPadComponent.
inline constexpr std::string_view VIRTUAL_PAD_CONFIG =
    "data/common/gamedata/menu/"
    "virtual_pad_button_config_1.04.17.01.cfg.bin";

/// Config icones de visage personnages (FUN_140fb0560).
/// Charge par lives::CMenuIconDraw pour les atlas face/.
inline constexpr std::string_view FACE_ICON_CONFIG =
    "data/common/menu/config/"
    "chara_face_icon_config_0.00.00.cfg.bin";

/// Config nombres graphiques — odometre, score (FUN_140fb3210).
/// Charge par CMenuNumRoll.
inline constexpr std::string_view GRAPHIC_NUMBER_CONFIG =
    "data/common/menu/config/"
    "menu_graphic_number_config_0.00.00.cfg.bin";

/// Config poses modeles 3D personnages dans les menus.
/// Charge par CMenuCharaModelComponent.
inline constexpr std::string_view CHARA_MODEL_POSE_CONFIG =
    "data/common/gamedata/menu/"
    "menu_chara_model_pose_config_1.02.38.cfg.bin";

/// Config parametres de creation (craft, trade).
/// Charge par BeansTradeMenu et MenuListViewCraft.
inline constexpr std::string_view CREATE_SETTING =
    "data/common/gamedata/menu/"
    "menu_create_setting_5.00.27.00.cfg.bin";

} // namespace config

// ============================================================================
// Prefixes VFS (#/ = resolution CRC32 par FUN_1402b5cb0)
// ============================================================================

namespace vfs_prefix {

/// Prefixe VFS pour les icones (resolution CRC32).
inline constexpr std::string_view ICON     = "#/menu/200_icon";

/// Prefixe VFS pour les minimaps (resolution CRC32).
inline constexpr std::string_view MINIMAP  = "#/menu/210_minimap";

/// Prefixe VFS pour les images (resolution CRC32).
inline constexpr std::string_view IMG      = "#/menu/220_img";

} // namespace vfs_prefix

} // namespace game::menu_paths
