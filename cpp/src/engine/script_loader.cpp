/// @file script_loader.cpp
/// Chargement des scripts Lua du jeu (dechiffrement XOR CRI + decompression LZ10).
/// Chemin : common/script/lua/menu/{name}.lua.bin

#include <iecode/engine/lua_bindings.h>

#include <iecode/compression/lz10.h>
#include <iecode/crypto/cri_crypto.h>

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <fstream>
#include <iterator>

namespace iecode::engine {

namespace {

/// Cle XOR CRI pour le dechiffrement des scripts Lua.
constexpr uint32_t LUA_CRI_XOR_KEY = 0x1717E18EU;

/// Lit un fichier binaire depuis le disque.
/// Retourne un vecteur vide si le fichier n'existe pas.
[[nodiscard]] std::vector<uint8_t> read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file.is_open()) {
        return {};
    }
    return {std::istreambuf_iterator<char>(file),
            std::istreambuf_iterator<char>()};
}

} // namespace

std::string load_lua_script(const std::vector<uint8_t>& encrypted_data) {
    if (encrypted_data.empty()) {
        spdlog::warn("load_lua_script: donnees vides");
        return {};
    }

    // Etape 1 : dechiffrement XOR CRI (in-place sur une copie)
    auto decrypted = encrypted_data;
    iecode::crypto::cri_decrypt(
        std::span<uint8_t>(decrypted.data(), decrypted.size()),
        LUA_CRI_XOR_KEY
    );

    // Etape 2 : verifier si c'est du LZ10 compresse
    auto decrypted_span = std::span<const uint8_t>(decrypted.data(), decrypted.size());
    if (!iecode::compression::is_lz10(decrypted_span)) {
        // Pas de compression LZ10 — traiter comme du Lua brut
        spdlog::debug("load_lua_script: pas de header LZ10, utilisation directe");
        return {decrypted.begin(), decrypted.end()};
    }

    // Etape 3 : decompression LZ10
    auto decompressed = iecode::compression::lz10_decompress(decrypted_span);
    if (decompressed.empty()) {
        spdlog::error("load_lua_script: echec de la decompression LZ10");
        return {};
    }

    spdlog::debug("load_lua_script: dechiffre+decompresse {} -> {} octets",
                  encrypted_data.size(), decompressed.size());

    return {decompressed.begin(), decompressed.end()};
}

bool load_menu_script(sol::state& lua, const std::string& name,
                      const std::filesystem::path& data_root) {
    // Construire le chemin : common/script/lua/menu/{name}.lua.bin
    auto script_path = data_root / "common" / "script" / "lua" / "menu"
                       / fmt::format("{}.lua.bin", name);

    spdlog::info("Chargement du script menu '{}' depuis {}", name, script_path.string());

    // Lire le fichier chiffre
    auto encrypted_data = read_file(script_path);
    if (encrypted_data.empty()) {
        spdlog::error("load_menu_script: fichier introuvable ou vide: {}",
                      script_path.string());
        return false;
    }

    // Dechiffrer + decompresser
    auto source = load_lua_script(encrypted_data);
    if (source.empty()) {
        spdlog::error("load_menu_script: echec du dechiffrement pour '{}'", name);
        return false;
    }

    // Charger le script dans le sol::state
    auto result = lua.safe_script(source, sol::script_pass_on_error);
    if (!result.valid()) {
        sol::error err = result;
        spdlog::error("load_menu_script: erreur Lua pour '{}': {}", name, err.what());
        return false;
    }

    spdlog::info("Script menu '{}' charge avec succes ({} octets source)",
                 name, source.size());
    return true;
}

void init_lua_state(sol::state& lua) {
    // Ouvrir les librairies standard Lua 5.2
    lua.open_libraries(
        sol::lib::base,
        sol::lib::package,
        sol::lib::coroutine,
        sol::lib::string,
        sol::lib::os,
        sol::lib::math,
        sol::lib::table,
        sol::lib::debug,
        sol::lib::io
    );

    // Enregistrer tous les types engine
    register_lua_bindings(lua);

    spdlog::info("sol::state initialise (Lua 5.2 + bindings engine)");
}

} // namespace iecode::engine
