#pragma once

/// @file vfx_inspector.h
/// Inspecteur generique des formats VFX Level-5 (VFXO/PFXO/FXBIN/PTLB).
/// Ces formats ne sont pas completement reverse-engineeres — on rapporte
/// les metadonnees inferables (magic, version, count) sans parsing complet.

#include <cstdint>
#include <span>
#include <string>
#include <string_view>

namespace iecode::level5 {

enum class VfxFormatType { Unknown, Vfxo, Pfxo, Fxbin, Ptlb };

struct VfxInspectResult {
    VfxFormatType format_type = VfxFormatType::Unknown;
    std::string   format_name;      ///< "VFXO", "PFXO", "FXBIN", "PTLB", "unknown"
    uint32_t      magic       = 0;
    uint32_t      version     = 0;  ///< offset 4-7 (heuristique)
    uint32_t      item_count  = 0;  ///< offset 8-11 (heuristique)
    uint64_t      file_size   = 0;
    bool          has_known_magic = false;
    std::string   hex_header;       ///< premiers 32 octets en hex "XX XX ..."
};

/// Inspecte les donnees brutes et identifie le format VFX.
[[nodiscard]] VfxInspectResult vfx_inspect(std::span<const uint8_t> data,
                                           std::string_view filename = "");

/// Serialise le resultat en JSON.
[[nodiscard]] std::string vfx_inspect_json(const VfxInspectResult& result);

} // namespace iecode::level5
