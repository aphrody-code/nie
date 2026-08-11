#include "iecode/formats/level5/g4sk.h"

#include "iecode/types.h"
#include <spdlog/spdlog.h>
#include <cstring>
#include <fmt/format.h>

namespace iecode::level5 {

// ── Constantes internes (prefixees g4sk_ pour unity build) ──────────

/// Magic "G4SK" en little-endian (includes '@' : 0x40 = '@').
/// Le .NET utilise 0x4B533447 comme magic LE.
static constexpr uint32_t G4SK_MAGIC_LE = 0x4B533447;

/// Taille minimale du header G4SK.
static constexpr size_t G4SK_MIN_HEADER_SIZE = 0x24;

/// Offset de scan pour la table des parent indices.
/// On saute la zone des matrices 4x4 (qui contiennent des int16 valides)
/// pour eviter les faux positifs. Le C# reference utilise 0x1000.
static constexpr size_t G4SK_PARENT_SCAN_START = 0x1000;

/// Verifie que [offset, offset+len) est dans les bornes.
static bool g4sk_bounds_check(std::span<const uint8_t> data, size_t offset, size_t len) {
    return offset + len <= data.size() && offset + len >= offset;
}

/// Verifie si un octet est un caractere imprimable ASCII.
static bool g4sk_is_printable(uint8_t b) {
    return b >= 0x20 && b <= 0x7E;
}

/// Verifie si une position contient une table de chaines valide.
static bool g4sk_is_valid_string_table(std::span<const uint8_t> data, size_t offset,
                                        int check_count) {
    size_t current = offset;
    for (int k = 0; k < check_count; ++k) {
        size_t len = 0;
        while (current + len < data.size() && data[current + len] != 0) {
            if (!g4sk_is_printable(data[current + len])) return false;
            ++len;
        }
        if (len == 0) return false;                      // Chaine vide suspecte
        if (current + len >= data.size()) return false;   // Fin de fichier
        current += len + 1;                               // Sauter le terminateur null
    }
    return true;
}

/// Cherche la table des parent indices dans les donnees.
/// Retourne l'offset ou -1 si non trouvee.
static int64_t g4sk_find_parent_indices(std::span<const uint8_t> data,
                                         uint16_t bone_count) {
    if (bone_count == 0) return -1;

    const size_t array_size = static_cast<size_t>(bone_count) * 2;
    const size_t scan_start = G4SK_PARENT_SCAN_START;

    for (size_t i = scan_start; i + array_size <= data.size(); i += 2) {
        bool valid = true;
        int zero_count = 0;
        int neg_count = 0;

        for (uint16_t j = 0; j < bone_count; ++j) {
            const int16_t val = iecode::read_i16_le(data.data() + i + j * 2);
            if (val < -1 || val >= static_cast<int16_t>(bone_count)) {
                valid = false;
                break;
            }
            if (val == 0) ++zero_count;
            if (val == -1) ++neg_count;
        }

        // L'os racine a generalement parent = -1, les enfants ont parent >= 0
        if (valid && (zero_count > 0 || neg_count > 0)) {
            return static_cast<int64_t>(i);
        }
    }
    return -1;
}

/// Lit une chaine null-terminee et avance le curseur.
static std::string g4sk_read_string_advance(std::span<const uint8_t> data, size_t& offset) {
    if (offset >= data.size()) return {};
    const auto* start = reinterpret_cast<const char*>(data.data() + offset);
    const size_t max_len = data.size() - offset;
    const size_t len = strnlen(start, max_len);
    offset += len + 1; // Sauter le terminateur null
    return {start, len};
}

std::optional<G4skFile> g4sk_parse(std::span<const uint8_t> data) {
    if (data.size() < G4SK_MIN_HEADER_SIZE) {
        spdlog::error("g4sk_parse: donnees trop courtes ({} octets, minimum {})",
                      data.size(), G4SK_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    const auto* base = data.data();

    // Verification du magic (little-endian sur PC)
    const uint32_t magic = iecode::read_u32_le(base);
    if (magic != G4SK_MAGIC_LE) {
        spdlog::error("g4sk_parse: magic invalide ({:#010x}, attendu {:#010x})",
                      magic, G4SK_MAGIC_LE);
        return std::nullopt;
    }

    // Lecture du header
    G4skFile result;
    result.header_size = iecode::read_u16_le(base + 0x04);
    result.version     = iecode::read_u16_le(base + 0x06);
    result.file_size   = iecode::read_u32_le(base + 0x0C);

    // Bone count a l'offset 0x20
    const uint16_t bone_count = iecode::read_u16_le(base + 0x20);

    spdlog::info("g4sk_parse: version={:#x} header_size={:#x} file_size={} bones={}",
                 result.version, result.header_size, result.file_size, bone_count);

    if (bone_count == 0) {
        spdlog::warn("g4sk_parse: aucun os dans le squelette");
        return result;
    }

    // ── Recherche heuristique des parent indices ────────────────────
    const int64_t parent_offset = g4sk_find_parent_indices(data, bone_count);
    if (parent_offset < 0) {
        spdlog::warn("g4sk_parse: table des parent indices non trouvee, "
                     "hierarchie a plat");
    } else {
        spdlog::debug("g4sk_parse: parent indices trouves a l'offset {:#x}",
                       parent_offset);
    }

    // ── Recherche heuristique de la string table ────────────────────
    int64_t string_table_offset = -1;
    if (parent_offset >= 0) {
        // Scanner apres les parent indices (aligne sur 4 octets)
        size_t scan_start = static_cast<size_t>(parent_offset) +
                            static_cast<size_t>(bone_count) * 2;
        scan_start = (scan_start + 3) & ~size_t{3}; // Alignement 4

        for (size_t i = scan_start; i + 3 < data.size(); ++i) {
            if (g4sk_is_printable(data[i]) && g4sk_is_printable(data[i + 1]) &&
                g4sk_is_printable(data[i + 2])) {
                // Verifier que ca ressemble a une table de chaines
                const int check_count = static_cast<int>(std::min<uint16_t>(bone_count, 5));
                if (g4sk_is_valid_string_table(data, i, check_count)) {
                    string_table_offset = static_cast<int64_t>(i);
                    break;
                }
            }
        }
    }

    if (string_table_offset >= 0) {
        spdlog::debug("g4sk_parse: string table trouvee a l'offset {:#x}",
                       string_table_offset);
    }

    // ── Construire les os ───────────────────────────────────────────
    result.bones.reserve(bone_count);
    size_t current_string_offset = (string_table_offset >= 0)
                                    ? static_cast<size_t>(string_table_offset) : 0;

    for (uint16_t i = 0; i < bone_count; ++i) {
        Bone bone;

        // Parent index
        if (parent_offset >= 0) {
            const size_t pidx_off = static_cast<size_t>(parent_offset) +
                                    static_cast<size_t>(i) * 2;
            if (g4sk_bounds_check(data, pidx_off, 2)) {
                bone.parent_index = iecode::read_i16_le(base + pidx_off);
            }
        }

        // Nom
        if (string_table_offset >= 0 && current_string_offset < data.size()) {
            bone.name = g4sk_read_string_advance(data, current_string_offset);
        }
        if (bone.name.empty()) {
            bone.name = fmt::format("Bone_{}", i);
        }

        // Les transforms (position, rotation, scale) sont stockees
        // dans des matrices de transformation locale. On laisse les valeurs
        // par defaut car le layout exact des matrices varie selon la version.
        // Un parser plus complet necessiterait l'analyse des matrices 4x4.

        spdlog::debug("g4sk_parse: bone[{}] name='{}' parent={}",
                       i, bone.name, bone.parent_index);

        result.bones.push_back(std::move(bone));
    }

    spdlog::info("g4sk_parse: {} os parse(s) avec succes", result.bones.size());
    return result;
}

} // namespace iecode::level5
