/// @file lua_script.cpp
/// Script Lua (lives::CLuaScript) — runtime Lua 5.2.1 integre.
/// Loader reference nie.exe : FUN_14103df90.
/// Chiffrement : XOR CRI 0x1717E18E + LZ10 (decompression apres dechiffrement).

#include "iecode/engine/scripting/lua_script.h"

#include "iecode/compression/lz10.h"
#include "iecode/crypto/cri_crypto.h"

#include <spdlog/spdlog.h>

extern "C" {
#include <lauxlib.h>
#include <lua.h>
#include <lualib.h>
}

#include <cstdio>
#include <cstring>
#include <span>
#include <string>
#include <vector>

namespace lives {

namespace {

/// Dechiffre un buffer .lua.bin avec la cle XOR CRI puis decompresse LZ10
/// si le magic LZ10 est present. Retourne un buffer pret a etre parse Lua.
[[nodiscard]] std::vector<uint8_t> decode_lua_bin(std::span<const uint8_t> encoded) {
    std::vector<uint8_t> buf(encoded.begin(), encoded.end());
    iecode::crypto::cri_decrypt(buf, CLuaScript::CRI_XOR_KEY);

    if (iecode::compression::is_lz10(buf)) {
        auto out = iecode::compression::lz10_decompress(buf);
        if (!out.empty()) return out;
        spdlog::warn("CLuaScript: echec decompression LZ10, utilisation du buffer brut");
    }
    return buf;
}

} // namespace

/// Cree un nouveau lua_State et ouvre les bibliotheques standard Lua 5.2.
/// Retourne false si l'allocation echoue.
[[nodiscard]] bool lua_script_init(CLuaScript& script) {
    if (script.lua_state_ != nullptr) return true;
    lua_State* L = luaL_newstate();
    if (L == nullptr) {
        spdlog::error("CLuaScript: luaL_newstate a echoue");
        return false;
    }
    luaL_openlibs(L);
    script.lua_state_ = L;
    return true;
}

/// Libere le lua_State associe au script.
void lua_script_shutdown(CLuaScript& script) noexcept {
    if (script.lua_state_ != nullptr) {
        lua_close(script.lua_state_);
        script.lua_state_ = nullptr;
    }
    script.state_ = ResState::UNLOADED;
}

/// Charge un script Lua .lua.bin depuis un buffer brut (dechiffre + decompresse + execute).
/// @return true si le script a ete charge et execute avec succes.
[[nodiscard]] bool lua_script_load(CLuaScript& script, std::span<const uint8_t> data,
                                   std::string_view chunk_name) {
    if (!lua_script_init(script)) {
        script.state_ = ResState::FAILED;
        return false;
    }
    auto decoded = decode_lua_bin(data);
    if (decoded.empty()) {
        script.state_ = ResState::FAILED;
        return false;
    }

    lua_State* L      = script.lua_state_;
    const std::string chunk{chunk_name};

    // luaL_loadbuffer compile le chunk en une fonction Lua au top de la pile.
    int rc = luaL_loadbuffer(L,
                             reinterpret_cast<const char*>(decoded.data()),
                             decoded.size(),
                             chunk.c_str());
    if (rc != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        spdlog::error("CLuaScript: echec load '{}': {}", chunk, msg != nullptr ? msg : "?");
        lua_pop(L, 1);
        script.state_ = ResState::FAILED;
        return false;
    }

    // pcall execute le chunk (0 args, 0 retours).
    rc = lua_pcall(L, 0, 0, 0);
    if (rc != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        spdlog::error("CLuaScript: echec exec '{}': {}", chunk, msg != nullptr ? msg : "?");
        lua_pop(L, 1);
        script.state_ = ResState::FAILED;
        return false;
    }

    script.script_name_ = chunk;
    script.state_       = ResState::LOADED;
    return true;
}

/// Execute une chaine Lua arbitraire dans l'etat du script.
[[nodiscard]] bool lua_script_exec(CLuaScript& script, std::string_view code) {
    if (!lua_script_init(script)) return false;
    lua_State* L = script.lua_state_;

    if (luaL_loadbuffer(L, code.data(), code.size(), "=[iecode:exec]") != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        spdlog::error("CLuaScript::exec load: {}", msg != nullptr ? msg : "?");
        lua_pop(L, 1);
        return false;
    }
    if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        spdlog::error("CLuaScript::exec pcall: {}", msg != nullptr ? msg : "?");
        lua_pop(L, 1);
        return false;
    }
    return true;
}

/// Appelle une fonction globale Lua par nom, sans argument.
[[nodiscard]] bool lua_script_call(CLuaScript& script, std::string_view func_name) {
    if (script.lua_state_ == nullptr) return false;
    lua_State* L = script.lua_state_;

    const std::string name{func_name};
    lua_getglobal(L, name.c_str());
    if (lua_isfunction(L, -1) == 0) {
        spdlog::error("CLuaScript::call: '{}' n'est pas une fonction", name);
        lua_pop(L, 1);
        return false;
    }
    if (lua_pcall(L, 0, 0, 0) != LUA_OK) {
        const char* msg = lua_tostring(L, -1);
        spdlog::error("CLuaScript::call '{}': {}", name, msg != nullptr ? msg : "?");
        lua_pop(L, 1);
        return false;
    }
    return true;
}

/// Formate le chemin VFS d'un script menu (common/script/lua/menu/%s.lua.bin).
[[nodiscard]] std::string lua_script_menu_path(std::string_view script_name) {
    char buf[256];
    std::snprintf(buf, sizeof(buf), "common/script/lua/menu/%.*s.lua.bin",
                  static_cast<int>(script_name.size()), script_name.data());
    return std::string{buf};
}

} // namespace lives
