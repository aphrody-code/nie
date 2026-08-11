/// @file behaviour.cpp
/// Implementation de lives::ecs::Behaviour.
/// Delegue les callbacks de cycle de vie aux fonctions Lua correspondantes.

#include <iecode/engine/ecs/behaviour.h>

#include <spdlog/spdlog.h>

namespace lives::ecs {

bool Behaviour::set_script(sol::state& lua_state, const std::string& path) {
    script_path_ = path;

    // Charger le script dans un environnement isole (sandboxing).
    auto result = lua_state.safe_script_file(path, sol::script_pass_on_error);
    if (!result.valid()) {
        sol::error err = result;
        spdlog::error("Behaviour: erreur chargement script '{}': {}",
                       path, err.what());
        script_table_ = sol::table();
        return false;
    }

    // Le script doit retourner une table contenant les callbacks.
    if (result.get_type() == sol::type::table) {
        script_table_ = result.get<sol::table>();
    } else {
        // Si le script ne retourne pas de table, creer un environnement vide.
        script_table_ = lua_state.create_table();
        spdlog::warn("Behaviour: script '{}' ne retourne pas de table", path);
    }

    spdlog::debug("Behaviour: script '{}' charge", path);
    return true;
}

// ── Callbacks de cycle de vie ────────────────────────────────────────

void Behaviour::on_awake() {
    call_lua("on_awake");
}

void Behaviour::on_start() {
    call_lua("on_start");
}

void Behaviour::on_update(float dt) {
    call_lua("on_update", dt);
}

void Behaviour::on_late_update(float dt) {
    call_lua("on_late_update", dt);
}

void Behaviour::on_destroy() {
    call_lua("on_destroy");
    // Invalider la table apres destruction.
    script_table_ = sol::table();
}

void Behaviour::on_enable() {
    call_lua("on_enable");
}

void Behaviour::on_disable() {
    call_lua("on_disable");
}

// ── Appels Lua internes ──────────────────────────────────────────────

void Behaviour::call_lua(std::string_view func_name) {
    if (!script_table_.valid()) return;

    sol::object func_obj = script_table_[func_name];
    if (func_obj.get_type() != sol::type::function) return;

    sol::protected_function func = func_obj.as<sol::protected_function>();
    auto result = func(script_table_);

    if (!result.valid()) {
        sol::error err = result;
        spdlog::error("Behaviour: erreur Lua {}.{}(): {}",
                       script_path_, func_name, err.what());
    }
}

void Behaviour::call_lua(std::string_view func_name, float arg) {
    if (!script_table_.valid()) return;

    sol::object func_obj = script_table_[func_name];
    if (func_obj.get_type() != sol::type::function) return;

    sol::protected_function func = func_obj.as<sol::protected_function>();
    auto result = func(script_table_, arg);

    if (!result.valid()) {
        sol::error err = result;
        spdlog::error("Behaviour: erreur Lua {}.{}({}): {}",
                       script_path_, func_name, arg, err.what());
    }
}

} // namespace lives::ecs
