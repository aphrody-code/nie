/// @file bridge.cpp
/// Implementation du bridge de decompilation — mapping RTTI et extraction de fonctions.
/// Charge les correspondances adresse → classe RTTI connues du jeu,
/// et permet d'extraire le code source d'une fonction depuis nie.c.

#include "decomp/bridge.h"

#include <spdlog/spdlog.h>

#include <mio.hpp>

#include <cstring>

namespace iecode::decomp {

// ── RttiRegistry ───────────────────────────────────────────────────

void RttiRegistry::load_known_mappings() {
    // Bridge funcLua* — fonctions Lua enregistrees dans nie.exe
    add_mapping("FUN_140c39f90", "game::CLuaMenuObject", "funcLuaMenuCommand");
    add_mapping("FUN_1410357f0", "game::CLuaMenuObject", "funcLuaMenuMapCommand");
    add_mapping("FUN_141088380", "game::CLuaMenuObject", "funcLuaMenuNetworkCommand");
    add_mapping("FUN_141091350", "game::CLuaMenuObject", "funcLuaMenuMultiplayCommand");
    add_mapping("FUN_141116110", "game::CLuaMenuObject", "funcLuaMenuVSRouteTownCommand");
    add_mapping("FUN_140b769a0", "game::CLuaMenuObject", "funcLuaActionCommand");
    add_mapping("FUN_140c39dc0", "game::CLuaMenuObject", "funcLuaEffectCommand");
    add_mapping("FUN_140b799f0", "game::CLuaMenuObject", "funcLuaCameraCommand");
    add_mapping("FUN_140c34ec0", "game::CLuaMenuObject", "funcLuaCommand");
    add_mapping("FUN_140fc2530", "game::CLuaMenuObject", "funcLuaMenuDictCommand");
    add_mapping("FUN_14103b990", "game::CLuaMenuObject", "funcLuaMenuMapTravelCommand");
    add_mapping("FUN_141097110", "game::CLuaMenuObject", "funcLuaMenuNfcCommand");
    add_mapping("FUN_1410b8580", "game::CLuaMenuObject", "funcLuaMenuPostCommand");
    add_mapping("FUN_1410b7ed0", "game::CLuaMenuObject", "funcLuaMenuPostListCommand");
    add_mapping("FUN_140c97e00", "game::CLuaMenuObject", "funcLuaSpTacticsCommand");

    // VFS / config
    add_mapping("FUN_1402b5cb0", "lives::CSystemGaiji", "vfs_path_hash");
    add_mapping("FUN_1402ac470", "lives::CSystemGaiji", "resource_pool_alloc");
    add_mapping("FUN_1402b2610", "lives::CSystemGaiji", "config_lookup_by_hash");

    // Shader / render
    add_mapping("FUN_1404cfa90", "lives::CShaderLibrary", "shader_resource_loader");
    add_mapping("FUN_14047f670", "lives::CShaderLibrary", "template_path_resolver");
    add_mapping("FUN_140ef27c0", "lives::gmdCObjManager", "render_init");
    add_mapping("FUN_140eff080", "lives::gmdCObjManager", "draw_pipeline_init");
    add_mapping("FUN_14045ab10", "lives::CComputeDeviceDX11", "d3d11_device_init");

    // Animation / physique
    add_mapping("FUN_1404ae7e0", "lives::gmdCAnimation", "animation_bone_blend");
    add_mapping("FUN_14070fe50", "lives::CPhysxStepper", "physx_simulate_fetch");

    // Formats
    add_mapping("FUN_1401c1430", "lives::CResBase", "rdbn_parser_main");

    // Sauvegarde
    add_mapping("FUN_1400babb0", "game::CGDDSerialize", "rpg_savedata");

    // Lua loader
    add_mapping("FUN_14103df90", "game::CLuaMenuObject", "lua_menu_loader");
    add_mapping("FUN_1405992e0", "game::CLuaMenuObject", "lua_register_bridge");

    // VFS
    add_mapping("FUN_140ef7980", "lives::CSystemGaiji", "vfs_path_resolver");

    spdlog::info("RttiRegistry: {} mappings connus charges", mappings_.size());
}

void RttiRegistry::add_mapping(const std::string& address,
                                const std::string& rtti_class,
                                const std::string& method_name) {
    mappings_[address] = RttiMapping{
        .address     = address,
        .rtti_class  = rtti_class,
        .method_name = method_name,
    };
}

std::optional<RttiMapping> RttiRegistry::find_by_address(
    const std::string& address) const {
    auto it = mappings_.find(address);
    if (it != mappings_.end()) {
        return it->second;
    }
    return std::nullopt;
}

std::vector<RttiMapping> RttiRegistry::find_by_class(
    const std::string& rtti_class) const {
    std::vector<RttiMapping> results;
    for (const auto& [addr, mapping] : mappings_) {
        if (mapping.rtti_class == rtti_class) {
            results.push_back(mapping);
        }
    }
    return results;
}

// ── Extraction du corps d'une fonction ─────────────────────────────

std::optional<std::string> extract_function_body(
    const std::string& nie_path,
    const NieFunction& func) {

    if (func.start_line == 0 || func.end_line == 0) {
        spdlog::error("extract_function_body: lignes invalides pour '{}'",
                      func.name);
        return std::nullopt;
    }

    // mmap le fichier
    mio::mmap_source mapped;
    std::error_code ec;
    mapped.map(nie_path, ec);
    if (ec) {
        spdlog::error("extract_function_body: impossible de mapper '{}': {}",
                      nie_path, ec.message());
        return std::nullopt;
    }

    // Scanner jusqu'a la ligne de debut
    const char* ptr = mapped.data();
    const char* end = mapped.data() + mapped.size();
    uint32_t line_num = 0;

    // Avancer jusqu'a start_line
    while (ptr < end && line_num < func.start_line - 1) {
        while (ptr < end && *ptr != '\n') {
            ++ptr;
        }
        if (ptr < end) {
            ++ptr; // passer le \n
        }
        ++line_num;
    }

    // Collecter les lignes de start_line a end_line
    const char* body_start = ptr;
    while (ptr < end && line_num < func.end_line) {
        while (ptr < end && *ptr != '\n') {
            ++ptr;
        }
        if (ptr < end) {
            ++ptr;
        }
        ++line_num;
    }

    if (body_start >= end) {
        return std::nullopt;
    }

    return std::string(body_start, static_cast<size_t>(ptr - body_start));
}

} // namespace iecode::decomp
