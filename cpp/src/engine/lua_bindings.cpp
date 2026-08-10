/// @file lua_bindings.cpp
/// Enregistrement de tous les types lives:: comme usertypes sol2.
/// Replique le bridge Lua <-> C++ de nie.exe (15 fonctions funcLua*).

#include <iecode/engine/lua_bindings.h>

#include <iecode/engine/camera/camera.h>
#include <iecode/engine/core/object.h>
#include <iecode/engine/input/pad.h>
#include <iecode/engine/menu/menu_animation.h>
#include <iecode/engine/menu/menu_layer.h>
#include <iecode/engine/menu/menu_list_view.h>
#include <iecode/engine/menu/menu_object.h>
#include <iecode/engine/menu/menu_render.h>
#include <iecode/engine/render/draw_pass.h>
#include <iecode/engine/res/res_base.h>
#include <iecode/engine/scripting/lua_script.h>

#include <spdlog/spdlog.h>

namespace iecode::engine {

namespace {

/// Enregistre les enums du moteur.
void register_enums(sol::state& lua) {
    // DrawPass — 13 passes de rendu D3D11
    lua.new_enum<lives::DrawPass>("DrawPass", {
        {"UI_BEFORE",          lives::DrawPass::UI_BEFORE},
        {"ZERO",               lives::DrawPass::ZERO},
        {"MAP_BEFORE",         lives::DrawPass::MAP_BEFORE},
        {"PROJ_EFFECT",        lives::DrawPass::PROJ_EFFECT},
        {"CHARA_BEFORE",       lives::DrawPass::CHARA_BEFORE},
        {"CHARA_AFTER",        lives::DrawPass::CHARA_AFTER},
        {"MAP_AFTER",          lives::DrawPass::MAP_AFTER},
        {"EFFECT",             lives::DrawPass::EFFECT},
        {"POST",               lives::DrawPass::POST},
        {"POST_AFTER",         lives::DrawPass::POST_AFTER},
        {"PRE_MENU_END_DRAW",  lives::DrawPass::PRE_MENU_END_DRAW},
        {"UI",                 lives::DrawPass::UI},
        {"POST_MENU_END_DRAW", lives::DrawPass::POST_MENU_END_DRAW},
        {"COUNT",              lives::DrawPass::COUNT},
    });

    // PadButton — masque de bits des boutons gamepad
    lua.new_enum<lives::PadButton>("PadButton", {
        {"NONE",       lives::PadButton::NONE},
        {"A",          lives::PadButton::A},
        {"B",          lives::PadButton::B},
        {"X",          lives::PadButton::X},
        {"Y",          lives::PadButton::Y},
        {"L1",         lives::PadButton::L1},
        {"R1",         lives::PadButton::R1},
        {"L2",         lives::PadButton::L2},
        {"R2",         lives::PadButton::R2},
        {"START",      lives::PadButton::START},
        {"SELECT",     lives::PadButton::SELECT},
        {"L3",         lives::PadButton::L3},
        {"R3",         lives::PadButton::R3},
        {"DPAD_UP",    lives::PadButton::DPAD_UP},
        {"DPAD_DOWN",  lives::PadButton::DPAD_DOWN},
        {"DPAD_LEFT",  lives::PadButton::DPAD_LEFT},
        {"DPAD_RIGHT", lives::PadButton::DPAD_RIGHT},
    });

    // ComponentType — types de composants CObject
    lua.new_enum<lives::ComponentType>("ComponentType", {
        {"UNKNOWN",    lives::ComponentType::UNKNOWN},
        {"RENDER",     lives::ComponentType::RENDER},
        {"PHYSICS",    lives::ComponentType::PHYSICS},
        {"ANIMATION",  lives::ComponentType::ANIMATION},
        {"AUDIO",      lives::ComponentType::AUDIO},
        {"INPUT",      lives::ComponentType::INPUT},
        {"SCRIPT",     lives::ComponentType::SCRIPT},
        {"UI",         lives::ComponentType::UI},
        {"EFFECT",     lives::ComponentType::EFFECT},
        {"CAMERA",     lives::ComponentType::CAMERA},
        {"NAVIGATION", lives::ComponentType::NAVIGATION},
    });

    // ResState — etats de chargement des ressources
    lua.new_enum<lives::ResState>("ResState", {
        {"UNLOADED", lives::ResState::UNLOADED},
        {"LOADING",  lives::ResState::LOADING},
        {"LOADED",   lives::ResState::LOADED},
        {"FAILED",   lives::ResState::FAILED},
    });
}

/// Enregistre les types de base du moteur (core/).
void register_core_types(sol::state& lua) {
    // hash32 — CRC32 VFS
    lua.new_usertype<lives::hash32>("hash32",
        sol::constructors<lives::hash32(), lives::hash32(uint32_t)>(),
        "value", &lives::hash32::value
    );

    // hash64
    lua.new_usertype<lives::hash64>("hash64",
        sol::constructors<lives::hash64(), lives::hash64(uint64_t)>(),
        "value", &lives::hash64::value
    );

    // CObject — base de tout
    lua.new_usertype<lives::CObject>("CObject",
        sol::constructors<lives::CObject()>(),
        "ref_count",      &lives::CObject::ref_count_,
        "initialize",     &lives::CObject::initialize,
        "finalize",       &lives::CObject::finalize,
        "get_class_name", &lives::CObject::get_class_name
    );

    // CComponent — composant attachable
    lua.new_usertype<lives::CComponent>("CComponent",
        sol::constructors<lives::CComponent()>(),
        "owner",   &lives::CComponent::owner_,
        "type",    &lives::CComponent::type_,
        "enabled", &lives::CComponent::enabled_,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CObjectLink — reference faible
    lua.new_usertype<lives::CObjectLink>("CObjectLink",
        sol::constructors<lives::CObjectLink()>(),
        "target",   &lives::CObjectLink::target_,
        "is_valid", &lives::CObjectLink::is_valid
    );
}

/// Enregistre les types de ressources (res/).
void register_res_types(sol::state& lua) {
    lua.new_usertype<lives::CResBase>("CResBase",
        sol::constructors<lives::CResBase()>(),
        "name_hash",     &lives::CResBase::name_hash_,
        "path",          &lives::CResBase::path_,
        "state",         &lives::CResBase::state_,
        "res_ref_count", &lives::CResBase::res_ref_count_,
        "res_type_name", &lives::CResBase::res_type_name,
        "is_loaded",     &lives::CResBase::is_loaded,
        sol::base_classes, sol::bases<lives::CObject>()
    );
}

/// Enregistre les types menu (menu/).
void register_menu_types(sol::state& lua) {
    // MenuLayout — position et layout depuis cfg.bin
    lua.new_usertype<lives::MenuLayout>("MenuLayout",
        sol::constructors<lives::MenuLayout()>(),
        "pos",     &lives::MenuLayout::pos,
        "size",    &lives::MenuLayout::size,
        "scale",   &lives::MenuLayout::scale,
        "info_id", &lives::MenuLayout::info_id
    );

    // CMenuObject — objet UI de base
    lua.new_usertype<lives::CMenuObject>("CMenuObject",
        sol::constructors<lives::CMenuObject()>(),
        "layout",  &lives::CMenuObject::layout_,
        "visible", &lives::CMenuObject::visible_,
        "active",  &lives::CMenuObject::active_,
        "layer",   &lives::CMenuObject::layer_,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // IMenuController — interface controleur
    lua.new_usertype<lives::IMenuController>("IMenuController",
        "on_init",   &lives::IMenuController::on_init,
        "on_update", &lives::IMenuController::on_update,
        "on_draw",   &lives::IMenuController::on_draw,
        "on_close",  &lives::IMenuController::on_close
    );

    // IMenuTextInfo — interface info texte
    lua.new_usertype<lives::IMenuTextInfo>("IMenuTextInfo",
        "get_text", &lives::IMenuTextInfo::get_text
    );

    // MenuRenderSlot — slot de rendu individuel
    lua.new_usertype<lives::MenuRenderSlot>("MenuRenderSlot",
        sol::constructors<lives::MenuRenderSlot()>(),
        "object",   &lives::MenuRenderSlot::object,
        "priority", &lives::MenuRenderSlot::priority,
        "flags",    &lives::MenuRenderSlot::flags,
        "visible",  &lives::MenuRenderSlot::visible
    );

    // CMenuRender — 1100 slots de rendu
    lua.new_usertype<lives::CMenuRender>("CMenuRender",
        sol::constructors<lives::CMenuRender()>(),
        "active_count", &lives::CMenuRender::active_count_,
        // Acces indexe aux slots (1-based pour Lua)
        "get_slot", [](lives::CMenuRender& self, uint32_t index) -> lives::MenuRenderSlot* {
            if (index == 0 || index > lives::MENU_RENDER_SLOT_COUNT) {
                return nullptr;
            }
            return &self.slots_[index - 1];
        },
        "slot_count", sol::var(lives::MENU_RENDER_SLOT_COUNT),
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CMenuRenderComponent
    lua.new_usertype<lives::CMenuRenderComponent>("CMenuRenderComponent",
        sol::constructors<lives::CMenuRenderComponent()>(),
        "render",     &lives::CMenuRenderComponent::render_,
        "slot_index", &lives::CMenuRenderComponent::slot_index_,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CMenuListView — vue liste avec defilement
    lua.new_usertype<lives::CMenuListView>("CMenuListView",
        sol::constructors<lives::CMenuListView()>(),
        "item_count",     &lives::CMenuListView::item_count_,
        "selected_index", &lives::CMenuListView::selected_index_,
        "scroll_offset",  &lives::CMenuListView::scroll_offset_,
        "visible_count",  &lives::CMenuListView::visible_count_,
        "is_valid_index", &lives::CMenuListView::is_valid_index,
        "has_selection",  &lives::CMenuListView::has_selection,
        sol::base_classes, sol::bases<lives::CMenuObject, lives::CObject>()
    );

    // CMenuLayerObject — objet de calque
    lua.new_usertype<lives::CMenuLayerObject>("CMenuLayerObject",
        sol::constructors<lives::CMenuLayerObject()>(),
        "layer_index", &lives::CMenuLayerObject::layer_index_,
        "opacity",     &lives::CMenuLayerObject::opacity_,
        sol::base_classes, sol::bases<lives::CMenuObject, lives::CObject>()
    );

    // CMenuLayerGroup — groupe de calques
    lua.new_usertype<lives::CMenuLayerGroup>("CMenuLayerGroup",
        sol::constructors<lives::CMenuLayerGroup()>(),
        "active_layer", &lives::CMenuLayerGroup::active_layer_,
        "layer_count",  [](const lives::CMenuLayerGroup& self) -> size_t {
            return self.layers_.size();
        },
        "get_layer", [](lives::CMenuLayerGroup& self, uint32_t index) -> lives::CMenuLayerObject* {
            if (index == 0 || index > self.layers_.size()) {
                return nullptr;
            }
            return self.layers_[index - 1];
        },
        sol::base_classes, sol::bases<lives::CMenuObject, lives::CObject>()
    );
}

/// Enregistre les types d'animation (menu/).
void register_animation_types(sol::state& lua) {
    // CMenuAnimation — animation de base
    lua.new_usertype<lives::CMenuAnimation>("CMenuAnimation",
        sol::constructors<lives::CMenuAnimation()>(),
        "current_time", &lives::CMenuAnimation::current_time_,
        "duration",     &lives::CMenuAnimation::duration_,
        "playing",      &lives::CMenuAnimation::playing_,
        "looping",      &lives::CMenuAnimation::looping_,
        "is_finished",  &lives::CMenuAnimation::is_finished,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CMenuSimpleAnimation — interpolation lineaire
    lua.new_usertype<lives::CMenuSimpleAnimation>("CMenuSimpleAnimation",
        sol::constructors<lives::CMenuSimpleAnimation()>(),
        "start_value",   &lives::CMenuSimpleAnimation::start_value_,
        "end_value",     &lives::CMenuSimpleAnimation::end_value_,
        "current_value", &lives::CMenuSimpleAnimation::current_value,
        sol::base_classes, sol::bases<lives::CMenuAnimation, lives::CObject>()
    );

    // CMenuRateAnimeCtrl — controleur par taux
    lua.new_usertype<lives::CMenuRateAnimeCtrl>("CMenuRateAnimeCtrl",
        sol::constructors<lives::CMenuRateAnimeCtrl()>(),
        "rate",     &lives::CMenuRateAnimeCtrl::rate_,
        "progress", &lives::CMenuRateAnimeCtrl::progress_,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CMenuRateAnimeCompetitionCtrl — controleur avec priorite
    lua.new_usertype<lives::CMenuRateAnimeCompetitionCtrl>("CMenuRateAnimeCompetitionCtrl",
        sol::constructors<lives::CMenuRateAnimeCompetitionCtrl()>(),
        "priority", &lives::CMenuRateAnimeCompetitionCtrl::priority_,
        sol::base_classes, sol::bases<lives::CMenuRateAnimeCtrl, lives::CObject>()
    );
}

/// Enregistre les types input (input/).
void register_input_types(sol::state& lua) {
    // CPad — gamepad (layout fidele nie.exe, taille 0x1A0, standalone)
    lua.new_usertype<lives::CPad>("CPad",
        sol::constructors<lives::CPad()>(),
        "buttons_current",   &lives::CPad::buttons_current_,
        "buttons_trigger",   &lives::CPad::buttons_trigger_,
        "buttons_released",  &lives::CPad::buttons_released_,
        "analog_data_0",     &lives::CPad::analog_data_0_,
        "analog_data_1",     &lives::CPad::analog_data_1_,
        "analog_data_2",     &lives::CPad::analog_data_2_,
        "state_flag",        &lives::CPad::state_flag_,
        "enabled",           &lives::CPad::enabled_,
        "is_connected",      &lives::CPad::is_connected,
        "is_pressed",        &lives::CPad::is_pressed,
        "is_triggered",      &lives::CPad::is_triggered,
        "is_released",       &lives::CPad::is_released
    );

    // CPadArray — 4 pads max
    lua.new_usertype<lives::CPadArray>("CPadArray",
        sol::constructors<lives::CPadArray()>(),
        "get_pad", [](lives::CPadArray& self, uint32_t index) -> lives::CPad* {
            if (index == 0 || index > lives::MAX_PAD_COUNT) {
                return nullptr;
            }
            return &self.pads_[index - 1];
        },
        "max_count", sol::var(lives::MAX_PAD_COUNT)
    );
}

/// Enregistre les types camera (camera/).
void register_camera_types(sol::state& lua) {
    // CCamera — camera 3D
    lua.new_usertype<lives::CCamera>("CCamera",
        sol::constructors<lives::CCamera()>(),
        "position",     &lives::CCamera::position_,
        "target",       &lives::CCamera::target_,
        "up",           &lives::CCamera::up_,
        "fov",          &lives::CCamera::fov_,
        "near",         &lives::CCamera::near_,
        "far",          &lives::CCamera::far_,
        "aspect_ratio", &lives::CCamera::aspect_ratio_,
        "view_matrix",  &lives::CCamera::view_matrix_,
        "proj_matrix",  &lives::CCamera::proj_matrix_,
        sol::base_classes, sol::bases<lives::CObject>()
    );

    // CCameraAnimeCtrl — controleur d'animation camera
    lua.new_usertype<lives::CCameraAnimeCtrl>("CCameraAnimeCtrl",
        sol::constructors<lives::CCameraAnimeCtrl()>(),
        "camera",       &lives::CCameraAnimeCtrl::camera_,
        "blend_time",   &lives::CCameraAnimeCtrl::blend_time_,
        "blend_factor", &lives::CCameraAnimeCtrl::blend_factor_,
        "active",       &lives::CCameraAnimeCtrl::active_,
        sol::base_classes, sol::bases<lives::CObject>()
    );
}

/// Enregistre CLuaScript (scripting/).
void register_scripting_types(sol::state& lua) {
    auto lua_script_type = lua.new_usertype<lives::CLuaScript>("CLuaScript",
        sol::constructors<lives::CLuaScript()>(),
        "script_name",    &lives::CLuaScript::script_name_,
        "is_menu_script", &lives::CLuaScript::is_menu_script_,
        sol::base_classes, sol::bases<lives::CResBase, lives::CObject>()
    );
    // Constantes statiques exposees via readonly_property pour eviter
    // le conflit sol::var_wrapper / is_container_v sur MSVC.
    lua_script_type["PATH_FORMAT"] = sol::readonly_property([]() {
        return std::string(lives::CLuaScript::PATH_FORMAT);
    });
    lua_script_type["CRI_XOR_KEY"] = sol::readonly_property([]() {
        return lives::CLuaScript::CRI_XOR_KEY;
    });
}

/// Enregistre les fonctions utilitaires globales.
void register_utility_functions(sol::state& lua) {
    // draw_pass_name — retourne le nom textuel d'une passe de rendu
    lua["draw_pass_name"] = &lives::draw_pass_name;

    // Constantes de rendu menu
    lua["MENU_RENDER_SLOT_COUNT"]  = lives::MENU_RENDER_SLOT_COUNT;
    lua["MENU_RENDER_SLOT_STRIDE"] = lives::MENU_RENDER_SLOT_STRIDE;
    lua["MENU_RENDER_TOTAL_SIZE"]  = lives::MENU_RENDER_TOTAL_SIZE;
    lua["MAX_PAD_COUNT"]           = lives::MAX_PAD_COUNT;
}

} // namespace

void register_lua_bindings(sol::state& lua) {
    spdlog::info("Enregistrement des bindings Lua engine (lives::)...");

    // Ordre important : les types de base avant les types derives
    register_enums(lua);
    register_core_types(lua);
    register_res_types(lua);
    register_menu_types(lua);
    register_animation_types(lua);
    register_input_types(lua);
    register_camera_types(lua);
    register_scripting_types(lua);
    register_utility_functions(lua);

    spdlog::info("Bindings Lua engine enregistres avec succes");
}

} // namespace iecode::engine
