#include "iecode/formats/criware/cpk_writer.h"
#include "iecode/compression/crilayla.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>
#include <cstring>
#include <fstream>
#include <numeric>

namespace iecode::criware {

namespace {

// ── Constantes ──────────────────────────────────────────────────────

constexpr uint32_t WRITER_TOC_MAGIC  = 0x20434F54; // "TOC "
constexpr uint32_t WRITER_CPK_MAGIC_LE = 0x204B5043; // "CPK " en LE
constexpr size_t WRITER_ALIGNMENT    = 0x800;         // Alignement standard CPK (2048)
constexpr size_t WRITER_TABLE_CONTAINER_SIZE = 16; // magic(4) + pad(4) + size(4) + pad(4)

// ── Helpers ─────────────────────────────────────────────────────────

/// Aligne a la prochaine frontiere.
size_t align_up(size_t val, size_t alignment) {
    return ((val + alignment - 1) / alignment) * alignment;
}

/// Ecrit un u16 BE dans un buffer (pour les headers @UTF).
static void put_u16_be(std::vector<uint8_t>& buf, size_t pos, uint16_t val) {
    if (pos + 2 <= buf.size()) {
        iecode::write_u16_be(buf.data() + pos, val);
    }
}

static void put_u32_be(std::vector<uint8_t>& buf, size_t pos, uint32_t val) {
    if (pos + 4 <= buf.size()) {
        iecode::write_u32_be(buf.data() + pos, val);
    }
}

// ── Construction de la TOC @UTF minimaliste ─────────────────────────

/// Construit une table @UTF TOC simplifiee pour les entrees CPK.
/// Colonnes : FileName(string), DirName(string), FileOffset(u64), FileSize(u64), ExtractSize(u64)
static std::vector<uint8_t> build_toc_utf(
    const std::vector<CpkWriteEntry>& entries,
    const std::vector<uint64_t>& offsets,
    uint64_t content_base)
{
    // Pour une implementation minimale, on construit une @UTF avec :
    // - 5 colonnes : FileName, DirName, FileOffset, FileSize, ExtractSize
    // - N lignes
    //
    // Le format @UTF est big-endian pour les metadonnees.
    // C'est le format le plus complexe de CRI — on simplifie au maximum.

    // String pool : toutes les chaines null-terminees
    std::vector<uint8_t> str_pool;
    auto add_str = [&](const std::string& s) -> uint32_t {
        uint32_t off = static_cast<uint32_t>(str_pool.size());
        str_pool.insert(str_pool.end(), s.begin(), s.end());
        str_pool.push_back(0);
        return off;
    };

    // Noms de colonnes
    uint32_t col_filename_str    = add_str("FileName");
    uint32_t col_dirname_str     = add_str("DirName");
    uint32_t col_fileoffset_str  = add_str("FileOffset");
    uint32_t col_filesize_str    = add_str("FileSize");
    uint32_t col_extractsize_str = add_str("ExtractSize");
    uint32_t table_name_str      = add_str("CpkTocInfo");

    // Ajouter les strings de donnees
    std::vector<uint32_t> filename_offsets;
    std::vector<uint32_t> dirname_offsets;
    for (const auto& e : entries) {
        filename_offsets.push_back(add_str(e.filename));
        dirname_offsets.push_back(add_str(e.directory));
    }

    // Calculer les tailles
    const size_t num_cols = 5;
    const size_t num_rows = entries.size();
    // Row data : pour chaque ligne, 5 champs :
    //   FileName(4 bytes offset) + DirName(4) + FileOffset(8) + FileSize(8) + ExtractSize(8) = 32 bytes
    const size_t row_size = 32;
    const size_t rows_data_size = num_rows * row_size;

    // Column table : 5 colonnes × 5 bytes chacune (flags + name_offset)
    // Flags : 0x50 = FLAG_NAME | FLAG_ROW_DATA + type String(5)
    //         0x46 = FLAG_NAME | FLAG_ROW_DATA + type U64(3)
    const size_t col_table_size = num_cols * 5; // flags(1) + name_offset(4) per column

    // Construire le header @UTF
    // @UTF structure after magic(4)+table_size(4):
    //   +0x08: 0x00 (reserved)
    //   +0x09: encoding byte
    //   +0x0A: rows_offset (u16 BE, relative to +0x08)
    //   +0x0C: string_pool_offset (i32 BE, relative to +0x08)
    //   +0x10: data_pool_offset (i32 BE, relative to +0x08)
    //   +0x14: table_name_offset (u32 BE)
    //   +0x18: column_count (u16 BE)
    //   +0x1A: row_size (u16 BE)
    //   +0x1C: row_count (i32 BE)
    //   +0x20: column table starts

    const size_t col_start = 0x20; // relative to file start
    const size_t rows_start = col_start + col_table_size;
    const size_t str_pool_start = rows_start + rows_data_size;
    const size_t total_size = str_pool_start + str_pool.size();
    const size_t table_size = total_size - 0x08; // size after magic+size

    std::vector<uint8_t> utf(total_size, 0);

    // Magic "@UTF"
    utf[0] = 0x40; utf[1] = 0x55; utf[2] = 0x54; utf[3] = 0x46;
    // Table size (BE)
    put_u32_be(utf, 4, static_cast<uint32_t>(table_size));
    // Encoding = UTF-8
    utf[0x09] = 1;
    // Rows offset (relative to 0x08)
    put_u16_be(utf, 0x0A, static_cast<uint16_t>(rows_start - 0x08));
    // String pool offset (relative to 0x08)
    put_u32_be(utf, 0x0C, static_cast<uint32_t>(str_pool_start - 0x08));
    // Data pool = same as string pool (pas de data pool separe)
    put_u32_be(utf, 0x10, static_cast<uint32_t>(str_pool_start - 0x08));
    // Table name
    put_u32_be(utf, 0x14, table_name_str);
    // Column count
    put_u16_be(utf, 0x18, static_cast<uint16_t>(num_cols));
    // Row size
    put_u16_be(utf, 0x1A, static_cast<uint16_t>(row_size));
    // Row count
    put_u32_be(utf, 0x1C, static_cast<uint32_t>(num_rows));

    // Column table
    // UtfColumnType::String = 10, UtfColumnType::UInt64 = 6
    // flags = UTF_FLAG_ROW_STORAGE(0x40) | UTF_FLAG_HAS_NAME(0x10) | type
    constexpr uint8_t FLAG_STRING = 0x40 | 0x10 | 10; // 0x5A
    constexpr uint8_t FLAG_U64    = 0x40 | 0x10 | 6;  // 0x56
    size_t cp = col_start;
    // FileName (string)
    utf[cp++] = FLAG_STRING; put_u32_be(utf, cp, col_filename_str); cp += 4;
    // DirName (string)
    utf[cp++] = FLAG_STRING; put_u32_be(utf, cp, col_dirname_str); cp += 4;
    // FileOffset (u64)
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_fileoffset_str); cp += 4;
    // FileSize (u64)
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_filesize_str); cp += 4;
    // ExtractSize (u64)
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_extractsize_str); cp += 4;

    // Row data
    for (size_t i = 0; i < num_rows; ++i) {
        size_t rp = rows_start + i * row_size;
        // FileName offset (4 bytes BE → string pool)
        put_u32_be(utf, rp, filename_offsets[i]); rp += 4;
        // DirName offset
        put_u32_be(utf, rp, dirname_offsets[i]); rp += 4;
        // FileOffset (8 bytes BE) — relatif a content_base
        uint64_t rel_off = offsets[i] - content_base;
        put_u32_be(utf, rp, static_cast<uint32_t>(rel_off >> 32)); rp += 4;
        put_u32_be(utf, rp, static_cast<uint32_t>(rel_off & 0xFFFFFFFF)); rp += 4;
        // FileSize (8 bytes BE)
        uint64_t sz = entries[i].data.size();
        put_u32_be(utf, rp, static_cast<uint32_t>(sz >> 32)); rp += 4;
        put_u32_be(utf, rp, static_cast<uint32_t>(sz & 0xFFFFFFFF)); rp += 4;
        // ExtractSize (8 bytes BE) — meme que FileSize si pas compresse
        put_u32_be(utf, rp, static_cast<uint32_t>(sz >> 32)); rp += 4;
        put_u32_be(utf, rp, static_cast<uint32_t>(sz & 0xFFFFFFFF));
    }

    // String pool
    std::memcpy(utf.data() + str_pool_start, str_pool.data(), str_pool.size());

    return utf;
}

// ── Construction du header CPK @UTF ────────────────────────────────

/// Construit la table @UTF du header CPK avec TocOffset, ContentOffset, TocSize.
/// Une seule ligne, 3 colonnes u64.
static std::vector<uint8_t> build_cpk_header_utf(
    uint64_t toc_offset, uint64_t content_offset, uint64_t toc_size)
{
    // String pool
    std::vector<uint8_t> str_pool;
    auto add_str = [&](const std::string& s) -> uint32_t {
        uint32_t off = static_cast<uint32_t>(str_pool.size());
        str_pool.insert(str_pool.end(), s.begin(), s.end());
        str_pool.push_back(0);
        return off;
    };

    uint32_t col_toc_offset_str     = add_str("TocOffset");
    uint32_t col_content_offset_str = add_str("ContentOffset");
    uint32_t col_toc_size_str       = add_str("TocSize");
    uint32_t table_name_str         = add_str("CpkHeader");

    const size_t num_cols = 3;
    const size_t row_size = 24; // 3 × u64 = 24 bytes
    const size_t col_table_size = num_cols * 5; // flags(1) + name_offset(4)
    const size_t col_start = 0x20;
    const size_t rows_start = col_start + col_table_size;
    const size_t str_pool_start = rows_start + row_size;
    const size_t total_size = str_pool_start + str_pool.size();
    const size_t table_size = total_size - 0x08;

    std::vector<uint8_t> utf(total_size, 0);

    // "@UTF" magic
    utf[0] = 0x40; utf[1] = 0x55; utf[2] = 0x54; utf[3] = 0x46;
    put_u32_be(utf, 4, static_cast<uint32_t>(table_size));
    utf[0x09] = 1; // UTF-8 encoding
    put_u16_be(utf, 0x0A, static_cast<uint16_t>(rows_start - 0x08));
    put_u32_be(utf, 0x0C, static_cast<uint32_t>(str_pool_start - 0x08));
    put_u32_be(utf, 0x10, static_cast<uint32_t>(str_pool_start - 0x08));
    put_u32_be(utf, 0x14, table_name_str);
    put_u16_be(utf, 0x18, static_cast<uint16_t>(num_cols));
    put_u16_be(utf, 0x1A, static_cast<uint16_t>(row_size));
    put_u32_be(utf, 0x1C, 1); // 1 row

    // Column table — all u64 (flags = ROW_STORAGE|HAS_NAME|UInt64 = 0x56)
    constexpr uint8_t FLAG_U64 = 0x40 | 0x10 | 6; // 0x56
    size_t cp = col_start;
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_toc_offset_str); cp += 4;
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_content_offset_str); cp += 4;
    utf[cp++] = FLAG_U64; put_u32_be(utf, cp, col_toc_size_str); cp += 4;

    // Row data — 3 × u64 BE
    size_t rp = rows_start;
    put_u32_be(utf, rp, static_cast<uint32_t>(toc_offset >> 32)); rp += 4;
    put_u32_be(utf, rp, static_cast<uint32_t>(toc_offset & 0xFFFFFFFF)); rp += 4;
    put_u32_be(utf, rp, static_cast<uint32_t>(content_offset >> 32)); rp += 4;
    put_u32_be(utf, rp, static_cast<uint32_t>(content_offset & 0xFFFFFFFF)); rp += 4;
    put_u32_be(utf, rp, static_cast<uint32_t>(toc_size >> 32)); rp += 4;
    put_u32_be(utf, rp, static_cast<uint32_t>(toc_size & 0xFFFFFFFF));

    // String pool
    std::memcpy(utf.data() + str_pool_start, str_pool.data(), str_pool.size());

    return utf;
}

/// Ecrit un conteneur CRI (magic + padding + size_le + padding) suivi des donnees @UTF.
static void write_table_container(std::ostream& out, uint32_t magic_le,
                                   const std::vector<uint8_t>& utf_data) {
    uint8_t container[WRITER_TABLE_CONTAINER_SIZE] = {};
    // Magic LE
    std::memcpy(container, &magic_le, 4);
    // Padding byte 4-7 : 0x00FF (convention CRI)
    container[4] = 0x00; container[5] = 0xFF; container[6] = 0x00; container[7] = 0x00;
    // Size LE
    iecode::write_u32_le(container + 8, static_cast<uint32_t>(utf_data.size()));
    // Padding 12-15
    out.write(reinterpret_cast<const char*>(container), WRITER_TABLE_CONTAINER_SIZE);
    out.write(reinterpret_cast<const char*>(utf_data.data()),
              static_cast<std::streamsize>(utf_data.size()));
}

} // namespace anonyme

// ── Implementation ──────────────────────────────────────────────────

bool cpk_rebuild(const std::vector<CpkWriteEntry>& entries,
                   const std::filesystem::path& output_path) {
    if (entries.empty()) {
        spdlog::error("cpk_rebuild: aucune entree");
        return false;
    }

    std::ofstream out(output_path, std::ios::binary);
    if (!out) {
        spdlog::error("cpk_rebuild: impossible de creer '{}'", output_path.string());
        return false;
    }

    // Layout :
    //   [0x0000] "CPK " container (0x10) + header @UTF
    //   [0x0800] "TOC " container (0x10) + TOC @UTF
    //   [aligned] file data

    // Phase 1 : placer le TOC a 0x800
    const size_t toc_pos = WRITER_ALIGNMENT;

    // Phase 2 : estimer content_base pour calculer les offsets
    const size_t toc_utf_estimate = 0x20 + entries.size() * 40 + entries.size() * 128;
    size_t content_base = align_up(toc_pos + WRITER_TABLE_CONTAINER_SIZE + toc_utf_estimate, WRITER_ALIGNMENT);

    // Phase 3 : calculer les offsets des fichiers
    std::vector<uint64_t> file_offsets(entries.size());
    size_t current_offset = content_base;
    for (size_t i = 0; i < entries.size(); ++i) {
        file_offsets[i] = current_offset;
        current_offset += entries[i].data.size();
        current_offset = align_up(current_offset, 0x10);
    }

    // Phase 4 : construire la TOC @UTF
    auto toc_utf = build_toc_utf(entries, file_offsets, content_base);
    const size_t toc_total = WRITER_TABLE_CONTAINER_SIZE + toc_utf.size();

    // Recalculer content_base avec la vraie taille du TOC
    content_base = align_up(toc_pos + toc_total, WRITER_ALIGNMENT);

    // Recalculer les offsets avec le vrai content_base
    current_offset = content_base;
    for (size_t i = 0; i < entries.size(); ++i) {
        file_offsets[i] = current_offset;
        current_offset += entries[i].data.size();
        current_offset = align_up(current_offset, 0x10);
    }

    // Reconstruire le TOC avec les offsets corrects
    // FileOffset est relatif a toc_pos (= ContentOffset dans le header)
    toc_utf = build_toc_utf(entries, file_offsets, toc_pos);

    // Phase 5 : construire le header CPK @UTF
    // ContentOffset = toc_pos (convention CRI : FileOffset est relatif a ContentOffset,
    // et le reader utilise min(TocOffset, ContentOffset) comme base).
    auto cpk_header_utf = build_cpk_header_utf(
        static_cast<uint64_t>(toc_pos),
        static_cast<uint64_t>(toc_pos),
        static_cast<uint64_t>(toc_utf.size()));

    // Phase 6 : ecrire le fichier
    // CPK header container + @UTF
    write_table_container(out, WRITER_CPK_MAGIC_LE, cpk_header_utf);

    // Padding jusqu'a toc_pos
    {
        const size_t pos = WRITER_TABLE_CONTAINER_SIZE + cpk_header_utf.size();
        if (pos < toc_pos) {
            std::vector<uint8_t> padding(toc_pos - pos, 0);
            out.write(reinterpret_cast<const char*>(padding.data()),
                      static_cast<std::streamsize>(padding.size()));
        }
    }

    // TOC container + @UTF
    write_table_container(out, WRITER_TOC_MAGIC, toc_utf);

    // Padding jusqu'a content_base
    {
        const size_t pos = toc_pos + WRITER_TABLE_CONTAINER_SIZE + toc_utf.size();
        if (pos < content_base) {
            std::vector<uint8_t> padding(content_base - pos, 0);
            out.write(reinterpret_cast<const char*>(padding.data()),
                      static_cast<std::streamsize>(padding.size()));
        }
    }

    // Ecrire les fichiers
    for (size_t i = 0; i < entries.size(); ++i) {
        out.write(reinterpret_cast<const char*>(entries[i].data.data()),
                  static_cast<std::streamsize>(entries[i].data.size()));

        const size_t pad = align_up(entries[i].data.size(), 0x10) - entries[i].data.size();
        if (pad > 0) {
            std::vector<uint8_t> p(pad, 0);
            out.write(reinterpret_cast<const char*>(p.data()),
                      static_cast<std::streamsize>(p.size()));
        }
    }

    spdlog::info("cpk_rebuild: {} fichiers ecrits dans '{}'",
                 entries.size(), output_path.filename().string());
    return out.good();
}

bool cpk_patch_file(const std::filesystem::path& cpk_path,
                      const std::string& filename,
                      std::span<const uint8_t> new_data) {
    // Ouvrir le CPK et trouver l'entree
    CpkReader reader;
    if (!reader.open(cpk_path)) {
        spdlog::error("cpk_patch: impossible d'ouvrir '{}'", cpk_path.string());
        return false;
    }

    // Chercher le fichier
    const CpkEntry* target = nullptr;
    for (const auto& e : reader.list()) {
        std::string full = e.directory.empty() ? e.filename : e.directory + "/" + e.filename;
        if (full == filename || e.filename == filename) {
            target = &e;
            break;
        }
    }

    if (!target) {
        spdlog::error("cpk_patch: fichier '{}' non trouve dans le CPK", filename);
        return false;
    }

    if (new_data.size() > target->size) {
        spdlog::error("cpk_patch: nouvelle taille ({}) > originale ({}) — impossible en patch in-place",
                      new_data.size(), target->size);
        return false;
    }

    // Ecrire les nouvelles donnees a l'offset du fichier
    std::fstream file(cpk_path, std::ios::binary | std::ios::in | std::ios::out);
    if (!file) {
        spdlog::error("cpk_patch: impossible d'ouvrir '{}' en ecriture", cpk_path.string());
        return false;
    }

    file.seekp(static_cast<std::streamoff>(target->offset));
    file.write(reinterpret_cast<const char*>(new_data.data()),
               static_cast<std::streamsize>(new_data.size()));

    // Remplir le reste avec des zeros si plus petit
    if (new_data.size() < target->size) {
        const size_t pad = static_cast<size_t>(target->size) - new_data.size();
        std::vector<uint8_t> zeros(pad, 0);
        file.write(reinterpret_cast<const char*>(zeros.data()),
                   static_cast<std::streamsize>(zeros.size()));
    }

    spdlog::info("cpk_patch: '{}' remplace ({} octets)", filename, new_data.size());
    return file.good();
}

} // namespace iecode::criware
