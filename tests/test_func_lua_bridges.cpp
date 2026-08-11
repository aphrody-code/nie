#include <gtest/gtest.h>

#include "iecode/engine/func_lua_bridges.h"

#include <sol/sol.hpp>
#include <string>

/// Fixture pour les tests des bridges funcLua*.
/// Cree un etat sol2 et enregistre les 15 bridges.
class FuncLuaBridgesTest : public ::testing::Test {
  protected:
    sol::state lua_;

    void SetUp() override {
        lua_.open_libraries(sol::lib::base);
        iecode::engine::register_func_lua_bridges(lua_);
    }
};

// ============================================================================
// Verification de l'enregistrement des 15 fonctions
// ============================================================================

/// Les 15 fonctions bridge doivent etre enregistrees comme fonctions globales.
TEST_F(FuncLuaBridgesTest, AllBridgesRegistered) {
    static constexpr const char* BRIDGE_NAMES[] = {
        "funcLuaMenuCommand",
        "funcLuaMenuMapCommand",
        "funcLuaMenuNetworkCommand",
        "funcLuaMenuMultiplayCommand",
        "funcLuaMenuVSRouteTownCommand",
        "funcLuaActionCommand",
        "funcLuaEffectCommand",
        "funcLuaCameraCommand",
        "funcLuaCommand",
        "funcLuaMenuDictCommand",
        "funcLuaMenuMapTravelCommand",
        "funcLuaMenuNfcCommand",
        "funcLuaMenuPostCommand",
        "funcLuaMenuPostListCommand",
        "funcLuaSpTacticsCommand",
    };

    for (const auto* name : BRIDGE_NAMES) {
        sol::object func = lua_[name];
        EXPECT_TRUE(func.is<sol::function>())
            << "Bridge '" << name << "' non enregistre ou n'est pas une fonction";
    }
}

// ============================================================================
// funcLuaMenuCommand — tests des sous-commandes
// ============================================================================

/// SET_VISIBLE (0x03) ne doit pas lever d'exception.
TEST_F(FuncLuaBridgesTest, MenuCommand_SetVisible) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x03, true)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// SET_POSITION (0x01) avec coordonnees.
TEST_F(FuncLuaBridgesTest, MenuCommand_SetPosition) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x01, 100.0, 200.0)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// SET_COLOR (0x08) avec 4 composantes RGBA.
TEST_F(FuncLuaBridgesTest, MenuCommand_SetColor) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x08, 255, 128, 0, 255)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// LIST_GET_SELECTED (0x31) retourne un entier (-1 = pas de selection).
TEST_F(FuncLuaBridgesTest, MenuCommand_ListGetSelected) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x31)");
    ASSERT_TRUE(result.valid());
    int selected = result.get<int>();
    EXPECT_EQ(selected, -1);
}

/// GET_MONEY (0x83) retourne un entier (0 par defaut).
TEST_F(FuncLuaBridgesTest, MenuCommand_GetMoney) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x83)");
    ASSERT_TRUE(result.valid());
    int money = result.get<int>();
    EXPECT_EQ(money, 0);
}

/// GET_CHARA_NAME (0x70) retourne une chaine vide (stub).
TEST_F(FuncLuaBridgesTest, MenuCommand_GetCharaName) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0x70, 1)");
    ASSERT_TRUE(result.valid());
    auto name = result.get<std::string>();
    EXPECT_TRUE(name.empty());
}

/// Commande inconnue (0xFF) retourne nil sans crash.
TEST_F(FuncLuaBridgesTest, MenuCommand_UnknownReturnsNil) {
    auto result = lua_.safe_script("return funcLuaMenuCommand(0xFF)");
    ASSERT_TRUE(result.valid());
    sol::object obj = result;
    EXPECT_TRUE(obj == sol::nil);
}

// ============================================================================
// funcLuaCameraCommand
// ============================================================================

/// SET_CAMERA_FOV (0x03) ne leve pas d'exception.
TEST_F(FuncLuaBridgesTest, CameraCommand_SetFov) {
    auto result = lua_.safe_script("return funcLuaCameraCommand(0x03, 90.0)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// CAMERA_SHAKE (0x04) avec intensite et duree.
TEST_F(FuncLuaBridgesTest, CameraCommand_Shake) {
    auto result = lua_.safe_script("return funcLuaCameraCommand(0x04, 2.5, 0.3)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

// ============================================================================
// funcLuaCommand
// ============================================================================

/// GET_FLAG (0x02) retourne un entier (0 par defaut).
TEST_F(FuncLuaBridgesTest, Command_GetFlag) {
    auto result = lua_.safe_script("return funcLuaCommand(0x02, 42)");
    ASSERT_TRUE(result.valid());
    int flag_value = result.get<int>();
    EXPECT_EQ(flag_value, 0);
}

// ============================================================================
// funcLuaSpTacticsCommand
// ============================================================================

/// GET_FORMATION (0x02) retourne un entier (0 par defaut).
TEST_F(FuncLuaBridgesTest, SpTactics_GetFormation) {
    auto result = lua_.safe_script("return funcLuaSpTacticsCommand(0x02)");
    ASSERT_TRUE(result.valid());
    int formation = result.get<int>();
    EXPECT_EQ(formation, 0);
}

// ============================================================================
// Autres bridges — appels basiques sans crash
// ============================================================================

/// funcLuaActionCommand ne crash pas sur une commande connue.
TEST_F(FuncLuaBridgesTest, ActionCommand_NoThrow) {
    auto result = lua_.safe_script("return funcLuaActionCommand(0x01, 0, 1.0, 2.0, 3.0)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// funcLuaEffectCommand ne crash pas.
TEST_F(FuncLuaBridgesTest, EffectCommand_NoThrow) {
    auto result = lua_.safe_script("return funcLuaEffectCommand(0x01, 1, 0.0, 0.0, 0.0)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// funcLuaMenuMapCommand ne crash pas.
TEST_F(FuncLuaBridgesTest, MapCommand_NoThrow) {
    auto result = lua_.safe_script("return funcLuaMenuMapCommand(0x01, 10.0, 20.0)", sol::script_pass_on_error);
    EXPECT_TRUE(result.valid());
}

/// funcLuaMenuNetworkCommand retourne nil pour GET_ONLINE_STATUS.
TEST_F(FuncLuaBridgesTest, NetworkCommand_OnlineStatus) {
    auto result = lua_.safe_script("return funcLuaMenuNetworkCommand(0x01)");
    ASSERT_TRUE(result.valid());
    int status = result.get<int>();
    EXPECT_EQ(status, 0); // hors ligne
}

/// funcLuaMenuDictCommand — GET_DICT_COUNT retourne 0.
TEST_F(FuncLuaBridgesTest, DictCommand_GetCount) {
    auto result = lua_.safe_script("return funcLuaMenuDictCommand(0x03)");
    ASSERT_TRUE(result.valid());
    int count = result.get<int>();
    EXPECT_EQ(count, 0);
}

/// funcLuaMenuPostListCommand — GET_POST_COUNT retourne 0.
TEST_F(FuncLuaBridgesTest, PostListCommand_GetCount) {
    auto result = lua_.safe_script("return funcLuaMenuPostListCommand(0x01)");
    ASSERT_TRUE(result.valid());
    int count = result.get<int>();
    EXPECT_EQ(count, 0);
}

/// Tous les bridges survivent a un appel sans arguments supplementaires.
TEST_F(FuncLuaBridgesTest, AllBridges_MinimalCallNoThrow) {
    static constexpr const char* CALLS[] = {
        "return funcLuaMenuCommand(0xFF)",
        "return funcLuaMenuMapCommand(0xFF)",
        "return funcLuaMenuNetworkCommand(0xFF)",
        "return funcLuaMenuMultiplayCommand(0xFF)",
        "return funcLuaMenuVSRouteTownCommand(0xFF)",
        "return funcLuaActionCommand(0xFF)",
        "return funcLuaEffectCommand(0xFF)",
        "return funcLuaCameraCommand(0xFF)",
        "return funcLuaCommand(0xFF)",
        "return funcLuaMenuDictCommand(0xFF)",
        "return funcLuaMenuMapTravelCommand(0xFF)",
        "return funcLuaMenuNfcCommand(0xFF)",
        "return funcLuaMenuPostCommand(0xFF)",
        "return funcLuaMenuPostListCommand(0xFF)",
        "return funcLuaSpTacticsCommand(0xFF)",
    };

    for (const auto* call : CALLS) {
        auto result = lua_.safe_script(call, sol::script_pass_on_error);
        EXPECT_TRUE(result.valid()) << "Echec sur: " << call;
    }
}
