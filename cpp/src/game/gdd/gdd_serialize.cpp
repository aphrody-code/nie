/// @file gdd_serialize.cpp
/// Implementation de CGDDSerialize, CGDDHeaderData, CGDDPlayData.
/// Port partiel de FUN_1400babb0 (rpg_savedata.c, 48 KB).
///
/// Format de save nie.exe — binaire little-endian, versionne :
///   [u32 magic='GDDH'] [u32 version] [u32 play_time_sec] [u64 timestamp]
///   [u32 chapter] [u32 current_map_id] [u32 gold]
/// La serialisation reelle dans nie.exe utilise un systeme de tags par
/// champ (CRC32 du nom + taille) pour permettre l'evolution du format.
/// Ici on utilise une structure compacte equivalente sans tags.

#include "iecode/game/gdd/gdd_serialize.h"

#include <cstring>

namespace game {

namespace {

constexpr uint32_t GDD_HEADER_MAGIC   = 0x48444447u; // 'GDDH' little-endian
constexpr uint32_t GDD_PLAYDATA_MAGIC = 0x50444447u; // 'GDDP'

template <class T>
void append_le(std::vector<uint8_t>& out, T value) noexcept {
    const auto* p = reinterpret_cast<const uint8_t*>(&value);
    for (size_t i = 0; i < sizeof(T); ++i) {
        out.push_back(p[i]);
    }
}

template <class T>
[[nodiscard]] bool read_le(const std::vector<uint8_t>& in, size_t& off, T& value) noexcept {
    if (off + sizeof(T) > in.size()) {
        return false;
    }
    std::memcpy(&value, in.data() + off, sizeof(T));
    off += sizeof(T);
    return true;
}

} // namespace

// ── Helpers exposes — serialisation compacte ───────────────────────────
// Ces fonctions libres permettent de serialiser/deserialiser les
// structures GDD sans modifier les overrides inline des headers.
// Elles sont utilisees par le systeme de save complet (rpg_savedata.cpp).

bool gdd_header_serialize(const CGDDHeaderData& h, std::vector<uint8_t>& out) {
    out.reserve(out.size() + 24);
    append_le<uint32_t>(out, GDD_HEADER_MAGIC);
    append_le<uint32_t>(out, h.save_version);
    append_le<uint32_t>(out, h.play_time_sec);
    append_le<uint64_t>(out, h.save_timestamp);
    return true;
}

bool gdd_header_deserialize(CGDDHeaderData& h, const std::vector<uint8_t>& in) {
    size_t off = 0;
    uint32_t magic = 0;
    if (!read_le(in, off, magic) || magic != GDD_HEADER_MAGIC) {
        return false;
    }
    if (!read_le(in, off, h.save_version)) return false;
    if (!read_le(in, off, h.play_time_sec)) return false;
    if (!read_le(in, off, h.save_timestamp)) return false;
    return true;
}

bool gdd_playdata_serialize(const CGDDPlayData& p, std::vector<uint8_t>& out) {
    out.reserve(out.size() + 16);
    append_le<uint32_t>(out, GDD_PLAYDATA_MAGIC);
    append_le<uint32_t>(out, p.chapter);
    append_le<uint32_t>(out, p.current_map_id);
    append_le<uint32_t>(out, p.gold);
    return true;
}

bool gdd_playdata_deserialize(CGDDPlayData& p, const std::vector<uint8_t>& in) {
    size_t off = 0;
    uint32_t magic = 0;
    if (!read_le(in, off, magic) || magic != GDD_PLAYDATA_MAGIC) {
        return false;
    }
    if (!read_le(in, off, p.chapter)) return false;
    if (!read_le(in, off, p.current_map_id)) return false;
    if (!read_le(in, off, p.gold)) return false;
    return true;
}

} // namespace game
