/// @file test_menu_paths.cpp
/// Tests unitaires pour les constantes VFS du systeme de menus
/// (game::menu_paths).

#include <iecode/game/ui/menu_paths.h>
#include <iecode/game/ui/menu_minimap.h>
#include <iecode/game/ui/menu_components.h>

#include <gtest/gtest.h>

namespace {

using namespace game::menu_paths;

// ============================================================================
// Repertoires VFS communs
// ============================================================================

TEST(MenuPaths, DirectoryConstantsNonEmpty) {
    EXPECT_FALSE(dir::SOCCER.empty());
    EXPECT_FALSE(dir::RPG.empty());
    EXPECT_FALSE(dir::BATTLE.empty());
    EXPECT_FALSE(dir::WINDOW.empty());
    EXPECT_FALSE(dir::COMMON.empty());
    EXPECT_FALSE(dir::VS_ROUTE.empty());
    EXPECT_FALSE(dir::UNIVERSE.empty());
    EXPECT_FALSE(dir::TITLE.empty());
    EXPECT_FALSE(dir::MAP.empty());
    EXPECT_FALSE(dir::QUEST.empty());
    EXPECT_FALSE(dir::MAIN_MENU.empty());
    EXPECT_FALSE(dir::MEMBER.empty());
    EXPECT_FALSE(dir::TEAM.empty());
    EXPECT_FALSE(dir::ITEM.empty());
    EXPECT_FALSE(dir::DATAFILE.empty());
    EXPECT_FALSE(dir::INFO.empty());
    EXPECT_FALSE(dir::VS.empty());
    EXPECT_FALSE(dir::OPTION.empty());
    EXPECT_FALSE(dir::CALENDAR.empty());
    EXPECT_FALSE(dir::INACORD.empty());
    EXPECT_FALSE(dir::MULTI.empty());
    EXPECT_FALSE(dir::SHOP.empty());
    EXPECT_FALSE(dir::LIST.empty());
    EXPECT_FALSE(dir::TOWN.empty());
    EXPECT_FALSE(dir::AVATAR.empty());
    EXPECT_FALSE(dir::EVENT.empty());
    EXPECT_FALSE(dir::OBJ.empty());
    EXPECT_FALSE(dir::CFG.empty());
    EXPECT_FALSE(dir::CONFIG.empty());
}

TEST(MenuPaths, DirectoryConstantsStartWithDataCommon) {
    // Tous les repertoires communs commencent par "data/common/menu/"
    EXPECT_EQ(dir::SOCCER.substr(0, 17), "data/common/menu/");
    EXPECT_EQ(dir::TITLE.substr(0, 17), "data/common/menu/");
    EXPECT_EQ(dir::SHOP.substr(0, 17), "data/common/menu/");
}

TEST(MenuPaths, Dx11DirectoryConstantsStartWithDataDx11) {
    EXPECT_EQ(dx11::ICON.substr(0, 15), "data/dx11/menu/");
    EXPECT_EQ(dx11::IMG.substr(0, 15), "data/dx11/menu/");
    EXPECT_EQ(dx11::ICON_ITEM.substr(0, 15), "data/dx11/menu/");
    EXPECT_EQ(dx11::ICON_CHR.substr(0, 15), "data/dx11/menu/");
    EXPECT_EQ(dx11::ICON_COMMON.substr(0, 15), "data/dx11/menu/");
}

// ============================================================================
// Fonctions de construction de chemins
// ============================================================================

TEST(MenuPathsIcon, FaceIconFormat) {
    auto path = icon::face_icon("chr001");
    EXPECT_EQ(path,
              "data/dx11/menu/200_icon/10_icon_chr/face/chr001.g4tx");
}

TEST(MenuPathsIcon, CommonIconFormat) {
    auto path = icon::common_icon("FR");
    EXPECT_EQ(path,
              "data/dx11/menu/200_icon/15_icon_common/FR/icon_common.g4tx");
}

TEST(MenuPathsIcon, ItemAtlasPath) {
    EXPECT_EQ(icon::ITEM_ATLAS,
              "data/dx11/menu/200_icon/02_icon_item/icon_item90.g4tx");
}

TEST(MenuPathsMinimap, TextureFormat) {
    auto path = minimap::texture("town_01");
    EXPECT_EQ(path,
              "data/dx11/menu/210_minimap/town_01/mmp_town_01_00.g4tx");
}

TEST(MenuPathsImg, OpponentFormat) {
    auto path = img::opponent("team_rival");
    EXPECT_EQ(path,
              "data/dx11/menu/220_img/opponent_img/team_rival.g4tx");
}

TEST(MenuPathsImg, SavedataFormat) {
    auto path = img::savedata(3);
    EXPECT_EQ(path,
              "data/dx11/menu/220_img/savedata_img/savedata_ch_img03.g4tx");
}

TEST(MenuPathsImg, SavedataZeroPadded) {
    auto path = img::savedata(0);
    EXPECT_EQ(path,
              "data/dx11/menu/220_img/savedata_img/savedata_ch_img00.g4tx");
}

TEST(MenuPathsImg, CalendarFormat) {
    auto path = img::calendar("event_summer");
    EXPECT_EQ(path,
              "data/dx11/menu/220_img/calendar_img/event_summer.g4tx");
}

TEST(MenuPathsImg, GenericLocalizedFormat) {
    auto path = img::generic("bustup_img", "FR", "chr001_bust");
    EXPECT_EQ(path,
              "data/dx11/menu/220_img/bustup_imgFR/chr001_bust.g4tx");
}

// ============================================================================
// Scripts Lua
// ============================================================================

TEST(MenuPathsLua, MenuScriptFormat) {
    auto path = lua::menu_script("chara_select_menu_0.00.00");
    EXPECT_EQ(path,
              "data/common/script/lua/menu/chara_select_menu_0.00.00.lua.bin");
}

TEST(MenuPathsLua, MenuScriptDir) {
    EXPECT_EQ(lua::MENU_SCRIPT_DIR, "data/common/script/lua/menu");
}

// ============================================================================
// Config cfg.bin
// ============================================================================

TEST(MenuPathsConfig, MinimapConfigPath) {
    EXPECT_TRUE(config::MINIMAP_CONFIG.find("minimap_config") !=
                std::string_view::npos);
    EXPECT_TRUE(config::MINIMAP_CONFIG.ends_with(".cfg.bin"));
}

TEST(MenuPathsConfig, AllConfigsEndWithCfgBin) {
    EXPECT_TRUE(config::MINIMAP_CONFIG.ends_with(".cfg.bin"));
    EXPECT_TRUE(config::VIRTUAL_PAD_CONFIG.ends_with(".cfg.bin"));
    EXPECT_TRUE(config::FACE_ICON_CONFIG.ends_with(".cfg.bin"));
    EXPECT_TRUE(config::GRAPHIC_NUMBER_CONFIG.ends_with(".cfg.bin"));
    EXPECT_TRUE(config::CHARA_MODEL_POSE_CONFIG.ends_with(".cfg.bin"));
    EXPECT_TRUE(config::CREATE_SETTING.ends_with(".cfg.bin"));
}

TEST(MenuPathsConfig, ConfigDirsNonEmpty) {
    EXPECT_FALSE(config::GAMEDATA_CFG_DIR.empty());
    EXPECT_FALSE(config::MENU_CONFIG_DIR.empty());
}

// ============================================================================
// Prefixes VFS (#/)
// ============================================================================

TEST(MenuPathsVfsPrefix, StartWithHash) {
    EXPECT_EQ(vfs_prefix::ICON[0], '#');
    EXPECT_EQ(vfs_prefix::MINIMAP[0], '#');
    EXPECT_EQ(vfs_prefix::IMG[0], '#');
}

// ============================================================================
// References croisees — classes C++ utilisent les constantes
// ============================================================================

TEST(MenuPathsCrossRef, MinimapUsesConfigPath) {
    // CMenuMinimap::CONFIG_PATH doit pointer vers la meme constante
    EXPECT_EQ(game::CMenuMinimap::CONFIG_PATH, config::MINIMAP_CONFIG);
}

TEST(MenuPathsCrossRef, CharaModelUsesConfigPath) {
    // CMenuCharaModelComponent::POSE_CONFIG_PATH doit pointer vers la meme constante
    EXPECT_EQ(game::CMenuCharaModelComponent::POSE_CONFIG_PATH,
              config::CHARA_MODEL_POSE_CONFIG);
}

} // namespace
