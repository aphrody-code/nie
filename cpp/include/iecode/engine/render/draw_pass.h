#pragma once

/// @file draw_pass.h
/// Passes de rendu D3D11 du moteur Level-5 (13 passes).
/// Pipeline complet identifie dans FUN_140eff080.
// iecode abstraction — no RTTI counterpart in nie.exe

#include <cstdint>
#include <string_view>

namespace lives {

/// Passes de rendu D3D11 — pipeline complet de nie.exe (FUN_140eff080).
enum class DrawPass : uint32_t {
    UI_BEFORE         = 0,   // gmdCDrawObjModelPriority:00_UI_Before
    ZERO              = 1,   // gmdCDrawObjModelPriority:00_Zero
    MAP_BEFORE        = 2,   // gmdCDrawObjModelPriority:10_MapBefore
    PROJ_EFFECT       = 3,   // gmdCDrawObjModelPriority:15_ProjEffect
    CHARA_BEFORE      = 4,   // gmdCDrawObjModelPriority:20_CharaBefore
    CHARA_AFTER       = 5,   // gmdCDrawObjModelPriority:25_CharaAfter
    MAP_AFTER         = 6,   // gmdCDrawObjModelPriority:30_MapAfter
    EFFECT            = 7,   // gmdCDrawObjModelPriority:40_Effect
    POST              = 8,   // gmdCDrawObjModelPriority:50_Post
    POST_AFTER        = 9,   // gmdCDrawObjModelPriority:51_PostAfter
    PRE_MENU_END_DRAW = 10,  // gmdCDrawObjModelPriority:59_PreMenuEndDraw
    UI                = 11,  // gmdCDrawObjModelPriority:60_UI
    POST_MENU_END_DRAW = 12, // gmdCDrawObjModelPriority:61_PostMenuEndDraw
    COUNT             = 13,
};

/// Retourne le nom textuel d'une passe de rendu.
[[nodiscard]] constexpr std::string_view draw_pass_name(DrawPass p) {
    switch (p) {
        case DrawPass::UI_BEFORE:         return "00_UI_Before";
        case DrawPass::ZERO:              return "00_Zero";
        case DrawPass::MAP_BEFORE:        return "10_MapBefore";
        case DrawPass::PROJ_EFFECT:       return "15_ProjEffect";
        case DrawPass::CHARA_BEFORE:      return "20_CharaBefore";
        case DrawPass::CHARA_AFTER:       return "25_CharaAfter";
        case DrawPass::MAP_AFTER:         return "30_MapAfter";
        case DrawPass::EFFECT:            return "40_Effect";
        case DrawPass::POST:              return "50_Post";
        case DrawPass::POST_AFTER:        return "51_PostAfter";
        case DrawPass::PRE_MENU_END_DRAW: return "59_PreMenuEndDraw";
        case DrawPass::UI:                return "60_UI";
        case DrawPass::POST_MENU_END_DRAW: return "61_PostMenuEndDraw";
        default:                          return "unknown";
    }
}

} // namespace lives
