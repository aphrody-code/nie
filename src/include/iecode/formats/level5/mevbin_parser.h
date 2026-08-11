#pragma once

/// @file mevbin_parser.h
/// Parser de fichiers MEVBIN (Motion Event Binary — Level-5).
/// Declenche des evenements synchronises a une animation (sons, VFX, hitboxes, callbacks Lua).

#include <cstdint>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace iecode::level5 {

/// Type d'evenement MEVBIN.
enum class MevEventType : uint32_t {
    Unknown     = 0,
    Sound       = 1,   ///< CRC32 du nom de son dans param1
    Vfx         = 2,   ///< ID d'effet visuel dans param1
    Hitbox      = 3,   ///< param1 = actif/inactif
    LuaCallback = 4,   ///< CRC32 du nom de fonction Lua dans param1
};

/// Un evenement dans le timeline MEVBIN.
struct MevbinEvent {
    float        time   = 0.0f; ///< Timestamp en secondes
    MevEventType type   = MevEventType::Unknown;
    uint32_t     param1 = 0;
    uint32_t     param2 = 0;
};

/// Fichier MEVBIN complet.
struct MevbinFile {
    uint32_t                  version        = 0;
    float                     duration       = 0.0f; ///< Duree totale en secondes
    std::vector<MevbinEvent>  events;
    bool                      is_speculative = false; ///< true si magic non reconnu
};

/// Parse un fichier MEVBIN depuis un span brut.
[[nodiscard]] std::optional<MevbinFile> mevbin_parse(std::span<const uint8_t> data);

/// Exporte un fichier MEVBIN en JSON.
[[nodiscard]] std::string mevbin_to_json(const MevbinFile& file);

} // namespace iecode::level5
