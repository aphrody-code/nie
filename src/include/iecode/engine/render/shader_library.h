#pragma once

/// @file shader_library.h
/// Interface de la bibliotheque de shaders (IShaderLibrary / CShaderLibrary).
/// Chemins decouverts via FUN_14047f670 (resolveur de template path).
/// Config : shader_list.cfg.bin charge par FUN_140ef27c0.
// iecode abstraction — no RTTI counterpart in nie.exe

#include "../core/object.h"
#include "../hash/hash_types.h"
#include <cstdint>
#include <string_view>

namespace lives {

/// Chemins VFS des shaders du moteur.
namespace shader_paths {
    /// Chemin de la liste de shaders (avec placeholder version).
    inline constexpr std::string_view SHADER_LIST = "#/shader/<SHADER_VERSION>/shader_list.cfg.bin";

    /// Prefixe des compute shaders.
    inline constexpr std::string_view COMPUTE_PREFIX = "#/shader/<SHADER_VERSION>/cs_";

    /// Noms des 5 compute shaders identifies dans le moteur.
    inline constexpr std::string_view CS_TILEBASE     = "cs_tilebase";
    inline constexpr std::string_view CS_LIGHT_TILE   = "cs_light_tile";
    inline constexpr std::string_view CS_CUBEMAP_TILE = "cs_cubemap_tile";
    inline constexpr std::string_view CS_CULLING      = "cs_culling";
    inline constexpr std::string_view CS_MORPH        = "cs_morph";
} // namespace shader_paths

/// Interface de la bibliotheque de shaders (IShaderLibrary).
/// FUN_1404cfa90 : shader resource loader (par type + path, ref-counting atomic).
struct IShaderLibrary {
    virtual ~IShaderLibrary() = default;

    /// Charge un shader par hash CRC32 de son nom.
    virtual bool load_shader(hash32 name_hash) = 0;

    /// Decharge un shader (decremente le ref-count).
    virtual void unload_shader(hash32 name_hash) = 0;

    /// Verifie si un shader est charge.
    [[nodiscard]] virtual bool is_loaded(hash32 name_hash) const = 0;
};

} // namespace lives
