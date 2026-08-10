#include "iecode/formats/criware/utf_parser.h"

#include "iecode/crypto/cri_crypto.h"
#include "iecode/types.h"
#include <bit>
#include <cstring>
#include <spdlog/spdlog.h>

namespace iecode::criware {

namespace {

// ── Constantes du format @UTF ──────────────────────────────────────

/// Magic "@UTF" en little-endian (tel que lu par memcpy sur x86).
constexpr uint32_t UTF_MAGIC = 0x46545540;  // '@', 'U', 'T', 'F'

/// Magic d'une table @UTF chiffree (premier uint32 apres XOR).
constexpr uint32_t UTF_ENCRYPTED_MAGIC = 0x1F9EF3F5;

/// Offset de base : toutes les offsets internes sont relatives a cet offset.
constexpr size_t UTF_BASE_OFFSET = 0x08;

/// Offset du debut des definitions de colonnes dans le header.
constexpr size_t UTF_COLUMN_DATA_OFFSET = 0x20;

/// Taille minimale du header @UTF (magic + table_size + metadata).
constexpr size_t UTF_MIN_HEADER_SIZE = 0x20;

// ── Flags de stockage (bits 4-6 de l'octet flags) ──────────────────

/// La colonne a un nom dans le string pool.
constexpr uint8_t UTF_FLAG_HAS_NAME = 0x10;

/// La colonne a une valeur par defaut (constante).
constexpr uint8_t UTF_FLAG_HAS_DEFAULT = 0x20;

/// La colonne a une valeur par ligne (per-row storage).
constexpr uint8_t UTF_FLAG_ROW_STORAGE = 0x40;

// ── Helpers de lecture BE depuis un span ────────────────────────────

/// Lit un uint8 a l'offset donne, retourne 0 si hors bornes.
[[nodiscard]] inline uint8_t utf_read_u8(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset >= data.size()) return 0;
    return data[offset];
}

/// Lit un uint16 big-endian a l'offset donne.
[[nodiscard]] inline uint16_t utf_read_u16_be(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset + 2 > data.size()) return 0;
    return iecode::read_u16_be(data.data() + offset);
}

/// Lit un uint32 big-endian a l'offset donne.
[[nodiscard]] inline uint32_t utf_read_u32_be(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0;
    return iecode::read_u32_be(data.data() + offset);
}

/// Lit un uint64 big-endian a l'offset donne.
[[nodiscard]] inline uint64_t utf_read_u64_be(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset + 8 > data.size()) return 0;
    return iecode::read_u64_be(data.data() + offset);
}

/// Lit un float big-endian a l'offset donne.
[[nodiscard]] inline float utf_read_f32_be(std::span<const uint8_t> data, size_t offset) noexcept {
    const uint32_t bits = utf_read_u32_be(data, offset);
    return std::bit_cast<float>(bits);
}

/// Lit un double big-endian a l'offset donne.
[[nodiscard]] inline double utf_read_f64_be(std::span<const uint8_t> data, size_t offset) noexcept {
    const uint64_t bits = utf_read_u64_be(data, offset);
    return std::bit_cast<double>(bits);
}

/// Lit un uint32 little-endian a l'offset donne (pour le magic).
[[nodiscard]] inline uint32_t utf_read_u32_le(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0;
    return iecode::read_u32_le(data.data() + offset);
}

/// Taille en octets d'une valeur pour un type de colonne donne.
[[nodiscard]] inline size_t utf_value_size(UtfColumnType type) noexcept {
    switch (type) {
        case UtfColumnType::Byte:   return 1;
        case UtfColumnType::SByte:  return 1;
        case UtfColumnType::UInt16: return 2;
        case UtfColumnType::Int16:  return 2;
        case UtfColumnType::UInt32: return 4;
        case UtfColumnType::Int32:  return 4;
        case UtfColumnType::UInt64: return 8;
        case UtfColumnType::Int64:  return 8;
        case UtfColumnType::Single: return 4;
        case UtfColumnType::Double: return 8;
        case UtfColumnType::String: return 4;   // offset u32 dans le string pool
        case UtfColumnType::Data:   return 8;   // offset u32 + size u32
        case UtfColumnType::Guid:   return 16;
        default:                    return 0;
    }
}

/// Lit une chaine null-terminated depuis le string pool.
[[nodiscard]] inline std::string utf_read_string_from_pool(
    std::span<const uint8_t> data, size_t string_pool_abs, uint32_t string_offset) noexcept {
    const size_t abs_offset = string_pool_abs + string_offset;
    if (abs_offset >= data.size()) return {};

    std::string result;
    for (size_t i = abs_offset; i < data.size(); ++i) {
        if (data[i] == 0) break;
        result.push_back(static_cast<char>(data[i]));
    }
    return result;
}

/// Lit une valeur depuis un offset donne dans les donnees de la table.
[[nodiscard]] inline UtfValue utf_read_value(
    std::span<const uint8_t> data,
    size_t offset,
    UtfColumnType type,
    size_t string_pool_abs,
    size_t data_pool_abs) noexcept {

    switch (type) {
        case UtfColumnType::Byte:
        case UtfColumnType::SByte:
            return utf_read_u8(data, offset);

        case UtfColumnType::UInt16:
        case UtfColumnType::Int16:
            return utf_read_u16_be(data, offset);

        case UtfColumnType::UInt32:
        case UtfColumnType::Int32:
            return utf_read_u32_be(data, offset);

        case UtfColumnType::UInt64:
        case UtfColumnType::Int64:
            return utf_read_u64_be(data, offset);

        case UtfColumnType::Single:
            return utf_read_f32_be(data, offset);

        case UtfColumnType::Double:
            return utf_read_f64_be(data, offset);

        case UtfColumnType::String: {
            const uint32_t str_offset = utf_read_u32_be(data, offset);
            return utf_read_string_from_pool(data, string_pool_abs, str_offset);
        }

        case UtfColumnType::Data: {
            const uint32_t blob_offset = utf_read_u32_be(data, offset);
            const uint32_t blob_size = utf_read_u32_be(data, offset + 4);
            const size_t abs_blob = data_pool_abs + blob_offset;
            if (abs_blob + blob_size > data.size() || blob_size == 0) {
                return std::vector<uint8_t>{};
            }
            return std::vector<uint8_t>(
                data.data() + abs_blob,
                data.data() + abs_blob + blob_size);
        }

        case UtfColumnType::Guid: {
            // Stocker comme blob de 16 octets
            if (offset + 16 > data.size()) return std::vector<uint8_t>{};
            return std::vector<uint8_t>(
                data.data() + offset,
                data.data() + offset + 16);
        }

        default:
            return uint8_t{0};
    }
}

/// Description interne d'une colonne pendant le parsing (inclut la constante).
struct UtfColumnDef {
    std::string name;
    UtfColumnType type = UtfColumnType::Byte;
    uint8_t flags = 0;
    bool has_default = false;
    bool is_row_storage = false;
    UtfValue default_value;
};

} // namespace

std::optional<UtfTable> utf_parse(std::span<const uint8_t> data) {
    if (data.size() < UTF_MIN_HEADER_SIZE) {
        spdlog::error("utf_parse: donnees trop courtes ({} octets, minimum {})",
                       data.size(), UTF_MIN_HEADER_SIZE);
        return std::nullopt;
    }

    // --- Detecter et dechiffrer si necessaire ---
    // On travaille sur une copie si les donnees sont chiffrees.
    std::vector<uint8_t> decrypted_buf;
    std::span<const uint8_t> table_data = data;

    const uint32_t magic_le = utf_read_u32_le(data, 0);
    if (magic_le == UTF_ENCRYPTED_MAGIC) {
        // Table chiffree : copier et dechiffrer in-place
        decrypted_buf.assign(data.begin(), data.end());
        iecode::crypto::cri_decrypt_table(decrypted_buf);
        table_data = decrypted_buf;

        // Verifier le magic apres dechiffrement
        const uint32_t decrypted_magic = utf_read_u32_le(table_data, 0);
        if (decrypted_magic != UTF_MAGIC) {
            spdlog::error("utf_parse: magic invalide apres dechiffrement (0x{:08X})", decrypted_magic);
            return std::nullopt;
        }
    } else if (magic_le != UTF_MAGIC) {
        spdlog::error("utf_parse: magic invalide (attendu @UTF/0x{:08X}, recu 0x{:08X})",
                       UTF_MAGIC, magic_le);
        return std::nullopt;
    }

    // --- Lire le header de la table ---
    // const uint32_t table_size = utf_read_u32_be(table_data, 4); // non utilise pour le moment

    // Offsets relatifs a UTF_BASE_OFFSET (0x08)
    const uint16_t rows_offset_rel    = utf_read_u16_be(table_data, 0x0A);
    const uint32_t string_offset_rel  = utf_read_u32_be(table_data, 0x0C);
    const uint32_t data_offset_rel    = utf_read_u32_be(table_data, 0x10);
    const uint32_t table_name_offset  = utf_read_u32_be(table_data, 0x14);
    const uint16_t column_count       = utf_read_u16_be(table_data, 0x18);
    const uint16_t row_stride         = utf_read_u16_be(table_data, 0x1A);
    const uint32_t row_count          = utf_read_u32_be(table_data, 0x1C);

    // Convertir en offsets absolus
    const size_t rows_offset_abs   = static_cast<size_t>(rows_offset_rel) + UTF_BASE_OFFSET;
    const size_t string_pool_abs   = static_cast<size_t>(string_offset_rel) + UTF_BASE_OFFSET;
    const size_t data_pool_abs     = static_cast<size_t>(data_offset_rel) + UTF_BASE_OFFSET;

    // Validation basique des offsets
    if (string_pool_abs > table_data.size()) {
        spdlog::error("utf_parse: string_pool_offset (0x{:X}) depasse la taille des donnees (0x{:X})",
                       string_pool_abs, table_data.size());
        return std::nullopt;
    }

    // --- Lire le nom de la table ---
    UtfTable table;
    table.name = utf_read_string_from_pool(table_data, string_pool_abs, table_name_offset);

    // --- Parser les definitions de colonnes ---
    std::vector<UtfColumnDef> col_defs;
    col_defs.reserve(column_count);

    size_t col_offset = UTF_COLUMN_DATA_OFFSET;

    for (uint16_t i = 0; i < column_count; ++i) {
        if (col_offset >= table_data.size()) {
            spdlog::error("utf_parse: depassement a la colonne {} (offset 0x{:X})", i, col_offset);
            return std::nullopt;
        }

        UtfColumnDef def;
        def.flags = table_data[col_offset];
        col_offset += 1;

        // Extraire le type (bits 0-3)
        const uint8_t type_val = def.flags & 0x0F;
        if (type_val > static_cast<uint8_t>(UtfColumnType::Guid)) {
            spdlog::warn("utf_parse: type de colonne inconnu {} a la colonne {}", type_val, i);
        }
        def.type = static_cast<UtfColumnType>(type_val);

        // Lire le nom si HasName (bit 4)
        if (def.flags & UTF_FLAG_HAS_NAME) {
            const uint32_t name_offset = utf_read_u32_be(table_data, col_offset);
            col_offset += 4;
            def.name = utf_read_string_from_pool(table_data, string_pool_abs, name_offset);
        }

        // Flags de stockage
        def.has_default = (def.flags & UTF_FLAG_HAS_DEFAULT) != 0;
        def.is_row_storage = (def.flags & UTF_FLAG_ROW_STORAGE) != 0;

        // Lire la valeur par defaut si HasDefaultValue (bit 5)
        if (def.has_default) {
            def.default_value = utf_read_value(
                table_data, col_offset, def.type, string_pool_abs, data_pool_abs);
            col_offset += utf_value_size(def.type);
        }

        col_defs.push_back(std::move(def));
    }

    // --- Construire les colonnes de sortie ---
    table.columns.reserve(column_count);
    for (const auto& def : col_defs) {
        UtfColumn col;
        col.name = def.name;
        col.type = def.type;
        col.flags = def.flags;
        table.columns.push_back(std::move(col));
    }

    // --- Parser les lignes ---
    table.rows.reserve(row_count);

    for (uint32_t row_idx = 0; row_idx < row_count; ++row_idx) {
        UtfRow row;
        row.values.reserve(column_count);

        // Position dans les donnees de ligne pour cette ligne
        size_t row_data_offset = rows_offset_abs + static_cast<size_t>(row_idx) * row_stride;

        for (uint16_t col_idx = 0; col_idx < column_count; ++col_idx) {
            const auto& def = col_defs[col_idx];

            if (def.is_row_storage) {
                // Lire la valeur depuis les donnees de la ligne
                if (row_data_offset + utf_value_size(def.type) > table_data.size()) {
                    spdlog::error("utf_parse: depassement ligne {} colonne '{}' (offset 0x{:X})",
                                   row_idx, def.name, row_data_offset);
                    return std::nullopt;
                }
                row.values.push_back(
                    utf_read_value(table_data, row_data_offset, def.type, string_pool_abs, data_pool_abs));
                row_data_offset += utf_value_size(def.type);
            } else if (def.has_default) {
                // Utiliser la valeur par defaut (constante)
                row.values.push_back(def.default_value);
            } else {
                // Pas de donnee : valeur zero selon le type
                switch (def.type) {
                    case UtfColumnType::Byte:
                    case UtfColumnType::SByte:   row.values.emplace_back(uint8_t{0}); break;
                    case UtfColumnType::UInt16:
                    case UtfColumnType::Int16:   row.values.emplace_back(uint16_t{0}); break;
                    case UtfColumnType::UInt32:
                    case UtfColumnType::Int32:   row.values.emplace_back(uint32_t{0}); break;
                    case UtfColumnType::UInt64:
                    case UtfColumnType::Int64:   row.values.emplace_back(uint64_t{0}); break;
                    case UtfColumnType::Single:  row.values.emplace_back(float{0.0f}); break;
                    case UtfColumnType::Double:  row.values.emplace_back(double{0.0}); break;
                    case UtfColumnType::String:  row.values.emplace_back(std::string{}); break;
                    case UtfColumnType::Data:
                    case UtfColumnType::Guid:    row.values.emplace_back(std::vector<uint8_t>{}); break;
                    default:                     row.values.emplace_back(uint8_t{0}); break;
                }
            }
        }

        table.rows.push_back(std::move(row));
    }

    spdlog::debug("utf_parse: table '{}' parsee — {} colonnes, {} lignes",
                   table.name, table.columns.size(), table.rows.size());
    return table;
}

} // namespace iecode::criware
