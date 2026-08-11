/// @file gdd_spirit.cpp
/// Serialisation des esprits runtime — Basara, Element, Hero, Normal, Token.
/// Chaque esprit partage le meme layout compact : [u32 id][u32 level][u32 exp]
/// precede d'un magic 4CC discriminant le type.

#include "iecode/game/gdd/gdd_spirit.h"

#include <cstring>

namespace game {

namespace {

constexpr uint32_t MAGIC_BASARA  = 0x53524142u; // 'BARS'
constexpr uint32_t MAGIC_ELEMENT = 0x4D454C45u; // 'ELEM'
constexpr uint32_t MAGIC_HERO    = 0x4F524548u; // 'HERO'
constexpr uint32_t MAGIC_NORMAL  = 0x4D524F4Eu; // 'NORM'
constexpr uint32_t MAGIC_TOKEN   = 0x4E4B4F54u; // 'TOKN'

template <class T>
void put(std::vector<uint8_t>& out, T v) noexcept {
    const auto* p = reinterpret_cast<const uint8_t*>(&v);
    for (size_t i = 0; i < sizeof(T); ++i) out.push_back(p[i]);
}

template <class T>
[[nodiscard]] bool get(const std::vector<uint8_t>& in, size_t& off, T& v) noexcept {
    if (off + sizeof(T) > in.size()) return false;
    std::memcpy(&v, in.data() + off, sizeof(T));
    off += sizeof(T);
    return true;
}

template <class Spirit>
bool serialize_common(uint32_t magic, const Spirit& s, std::vector<uint8_t>& out) {
    out.reserve(out.size() + 16);
    put<uint32_t>(out, magic);
    put<uint32_t>(out, s.spirit_id);
    put<uint32_t>(out, s.level);
    put<uint32_t>(out, s.exp);
    return true;
}

template <class Spirit>
bool deserialize_common(uint32_t expected_magic, Spirit& s,
                        const std::vector<uint8_t>& in) {
    size_t off = 0;
    uint32_t m = 0;
    if (!get(in, off, m) || m != expected_magic) return false;
    if (!get(in, off, s.spirit_id)) return false;
    if (!get(in, off, s.level)) return false;
    if (!get(in, off, s.exp)) return false;
    return true;
}

} // namespace

// ── Helpers par type d'esprit ──────────────────────────────────────────

bool gdd_basara_serialize(const CGDDBasaraSpirit& s, std::vector<uint8_t>& out) {
    return serialize_common(MAGIC_BASARA, s, out);
}
bool gdd_basara_deserialize(CGDDBasaraSpirit& s, const std::vector<uint8_t>& in) {
    return deserialize_common(MAGIC_BASARA, s, in);
}

bool gdd_element_serialize(const CGDDElementSpirit& s, std::vector<uint8_t>& out) {
    return serialize_common(MAGIC_ELEMENT, s, out);
}
bool gdd_element_deserialize(CGDDElementSpirit& s, const std::vector<uint8_t>& in) {
    return deserialize_common(MAGIC_ELEMENT, s, in);
}

bool gdd_hero_serialize(const CGDDHeroSpirit& s, std::vector<uint8_t>& out) {
    return serialize_common(MAGIC_HERO, s, out);
}
bool gdd_hero_deserialize(CGDDHeroSpirit& s, const std::vector<uint8_t>& in) {
    return deserialize_common(MAGIC_HERO, s, in);
}

bool gdd_normal_serialize(const CGDDNormalSpirit& s, std::vector<uint8_t>& out) {
    return serialize_common(MAGIC_NORMAL, s, out);
}
bool gdd_normal_deserialize(CGDDNormalSpirit& s, const std::vector<uint8_t>& in) {
    return deserialize_common(MAGIC_NORMAL, s, in);
}

bool gdd_token_serialize(const CGDDTokenSpirit& s, std::vector<uint8_t>& out) {
    return serialize_common(MAGIC_TOKEN, s, out);
}
bool gdd_token_deserialize(CGDDTokenSpirit& s, const std::vector<uint8_t>& in) {
    return deserialize_common(MAGIC_TOKEN, s, in);
}

} // namespace game
