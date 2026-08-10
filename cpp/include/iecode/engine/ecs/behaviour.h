#pragma once

/// @file behaviour.h
/// Behaviour ECS scriptable en Lua (lives::ecs::Behaviour).
/// Component dont les callbacks sont deleguees a un script Lua 5.2.
/// Utilise sol2 pour le binding Lua <-> C++.

#include "component.h"

#include <sol/sol.hpp>
#include <string>
#include <string_view>
#include <typeindex>

namespace lives::ecs {

/// Component scriptable en Lua.
/// Charge un script .lua.bin et delegue les callbacks de cycle de vie
/// aux fonctions Lua correspondantes (on_awake, on_start, on_update, etc.).
///
/// Pattern nie.exe : game::CLuaMenuObject wraps chaque menu Lua.
/// Ici, Behaviour generalise ce pattern a tout type de script.
class Behaviour : public Component {
public:
    Behaviour() = default;
    ~Behaviour() override = default;

    // Non-copiable (sol::table n'est pas copiable de facon sure)
    Behaviour(const Behaviour&) = delete;
    Behaviour& operator=(const Behaviour&) = delete;
    Behaviour(Behaviour&&) noexcept = default;
    Behaviour& operator=(Behaviour&&) noexcept = default;

    // ── Configuration ────────────────────────────────────────────────

    /// Charge et lie un script Lua a ce Behaviour.
    /// Le script doit definir des fonctions optionnelles :
    ///   on_awake(), on_start(), on_update(dt), on_late_update(dt), on_destroy()
    /// @param lua_state Etat Lua partage (un par scene typiquement).
    /// @param path Chemin du script (ex: "common/script/lua/menu/title.lua.bin").
    /// @return true si le script a ete charge avec succes.
    [[nodiscard]] bool set_script(sol::state& lua_state, const std::string& path);

    /// Chemin du script charge.
    [[nodiscard]] const std::string& script_path() const noexcept {
        return script_path_;
    }

    /// Table Lua contenant l'etat du script.
    [[nodiscard]] sol::table& script_table() noexcept { return script_table_; }
    [[nodiscard]] const sol::table& script_table() const noexcept {
        return script_table_;
    }

    /// Indique si un script est charge et valide.
    [[nodiscard]] bool has_script() const noexcept {
        return script_table_.valid();
    }

    // ── Component overrides ──────────────────────────────────────────

    [[nodiscard]] std::type_index component_type_id() const override {
        return std::type_index(typeid(Behaviour));
    }

    [[nodiscard]] std::string_view component_name() const override {
        return "Behaviour";
    }

    void on_awake() override;
    void on_start() override;
    void on_update(float dt) override;
    void on_late_update(float dt) override;
    void on_destroy() override;
    void on_enable() override;
    void on_disable() override;

private:
    /// Appelle une fonction Lua sans argument dans script_table_.
    void call_lua(std::string_view func_name);

    /// Appelle une fonction Lua avec un argument float.
    void call_lua(std::string_view func_name, float arg);

    /// Chemin du script .lua.bin charge.
    std::string script_path_;

    /// Table Lua contenant l'etat et les callbacks du script.
    sol::table script_table_;
};

} // namespace lives::ecs
