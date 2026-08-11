#include "iecode/formats/criware/cpk_reader.h"

#include "iecode/compression/crilayla.h"
#include "iecode/crypto/cri_crypto.h"
#include "iecode/formats/criware/utf_parser.h"
#include "iecode/types.h"

#include <mio.hpp>

#include <cstring>
#include <fstream>
#include <spdlog/spdlog.h>

namespace iecode::criware {

// ── Implementation du fichier mappe (pimpl) ─────────────────────────

struct CpkReader::MappedFile {
    mio::mmap_source mmap;

    [[nodiscard]] std::span<const uint8_t> data() const noexcept {
        if (!mmap.is_open()) return {};
        return {reinterpret_cast<const uint8_t*>(mmap.data()), mmap.size()};
    }

    [[nodiscard]] size_t size() const noexcept {
        return mmap.is_open() ? mmap.size() : 0;
    }
};

// ── Constructeurs / destructeur ─────────────────────────────────────

CpkReader::CpkReader() = default;
CpkReader::~CpkReader() = default;
CpkReader::CpkReader(CpkReader&& other) noexcept = default;
CpkReader& CpkReader::operator=(CpkReader&& other) noexcept = default;

// ── Acces aux donnees mappees ───────────────────────────────────────

std::span<const uint8_t> CpkReader::mapped_data() const noexcept {
    if (mapped_file_ && mapped_file_->size() > 0) {
        return mapped_file_->data();
    }
    return file_data_;
}

namespace {

// ── Constantes CPK ─────────────────────────────────────────────────

/// Taille du conteneur de table (magic 4 + padding 4 + size LE 4 + padding 4).
constexpr size_t CPK_TABLE_CONTAINER_SIZE = 16;

/// Taille minimale d'un fichier CPK (conteneur + header UTF minimal).
constexpr size_t CPK_MIN_FILE_SIZE = CPK_TABLE_CONTAINER_SIZE + 0x20;

/// Magic "CPK " en little-endian.
constexpr uint32_t CPK_MAGIC_LE = 0x204B5043;

/// Magic "TOC " en little-endian.
constexpr uint32_t CPK_TOC_MAGIC_LE = 0x20434F54;

// ── Helpers ────────────────────────────────────────────────────────

/// Lit un uint32 LE depuis un span.
[[nodiscard]] inline uint32_t cpk_read_u32_le(std::span<const uint8_t> data, size_t offset) noexcept {
    if (offset + 4 > data.size()) return 0;
    return iecode::read_u32_le(data.data() + offset);
}

/// Extrait le contenu d'une table @UTF depuis un conteneur CRI (CPK/TOC/ETOC).
/// Le conteneur fait 16 octets : magic(4) + pad(4) + size_le(4) + pad(4),
/// suivi des donnees de la table.
[[nodiscard]] std::optional<UtfTable> cpk_read_table_container(
    std::span<const uint8_t> data, size_t container_offset) {

    if (container_offset + CPK_TABLE_CONTAINER_SIZE > data.size()) {
        spdlog::error("cpk_read_table_container: conteneur hors bornes (offset 0x{:X})", container_offset);
        return std::nullopt;
    }

    // Lire la taille de la table (u32 LE a offset +8 dans le conteneur)
    const uint32_t table_size = cpk_read_u32_le(data, container_offset + 8);
    const size_t table_start = container_offset + CPK_TABLE_CONTAINER_SIZE;

    if (table_start + table_size > data.size()) {
        spdlog::error("cpk_read_table_container: table depasse les donnees "
                       "(start=0x{:X}, size=0x{:X}, file_size=0x{:X})",
                       table_start, table_size, data.size());
        return std::nullopt;
    }

    // Detecter le chiffrement de la table et dechiffrer si necessaire
    auto table_span = data.subspan(table_start, table_size);

    // Verifier si la table est chiffree (magic != @UTF)
    if (table_size >= 4) {
        uint32_t table_magic = 0;
        std::memcpy(&table_magic, table_span.data(), 4);

        // 0x46545540 = "@UTF" en LE, 0x1F9EF3F5 = chiffre
        if (table_magic != 0x46545540) {
            // Copier et dechiffrer
            std::vector<uint8_t> decrypted(table_span.begin(), table_span.end());
            iecode::crypto::cri_decrypt_table(decrypted);

            // Verifier apres dechiffrement
            uint32_t decrypted_magic = 0;
            std::memcpy(&decrypted_magic, decrypted.data(), 4);
            if (decrypted_magic != 0x46545540) {
                spdlog::error("cpk_read_table_container: table ni valide ni dechiffrable "
                               "(magic=0x{:08X})", decrypted_magic);
                return std::nullopt;
            }

            return utf_parse(decrypted);
        }
    }

    return utf_parse(table_span);
}

/// Cherche une valeur dans une ligne UTF par nom de colonne.
/// Retourne nullopt si la colonne n'existe pas.
template <typename T>
[[nodiscard]] std::optional<T> cpk_get_column_value(
    const UtfTable& table, size_t row_idx, const std::string& col_name) {

    if (row_idx >= table.rows.size()) return std::nullopt;

    for (size_t i = 0; i < table.columns.size(); ++i) {
        if (table.columns[i].name == col_name) {
            if (i >= table.rows[row_idx].values.size()) return std::nullopt;
            const auto* val = std::get_if<T>(&table.rows[row_idx].values[i]);
            if (val) return *val;
            return std::nullopt;
        }
    }
    return std::nullopt;
}

/// Cherche un entier (u32 ou u64) dans une ligne UTF, avec coercion automatique.
[[nodiscard]] int64_t cpk_get_column_int64(
    const UtfTable& table, size_t row_idx, const std::string& col_name,
    int64_t default_val = -1) {

    if (row_idx >= table.rows.size()) return default_val;

    for (size_t i = 0; i < table.columns.size(); ++i) {
        if (table.columns[i].name != col_name) continue;
        if (i >= table.rows[row_idx].values.size()) return default_val;

        const auto& val = table.rows[row_idx].values[i];
        // Tenter toutes les tailles d'entier
        if (const auto* v = std::get_if<uint64_t>(&val)) return static_cast<int64_t>(*v);
        if (const auto* v = std::get_if<uint32_t>(&val)) return static_cast<int64_t>(*v);
        if (const auto* v = std::get_if<uint16_t>(&val)) return static_cast<int64_t>(*v);
        if (const auto* v = std::get_if<uint8_t>(&val))  return static_cast<int64_t>(*v);
        return default_val;
    }
    return default_val;
}

/// Cherche une chaine dans une ligne UTF.
[[nodiscard]] std::string cpk_get_column_string(
    const UtfTable& table, size_t row_idx, const std::string& col_name) {

    auto result = cpk_get_column_value<std::string>(table, row_idx, col_name);
    return result.value_or(std::string{});
}

} // namespace

bool CpkReader::open(const std::filesystem::path& path) {
    // --- Tenter un memory-mapping du fichier (zero-copy) ---
    std::error_code ec;
    auto mf = std::make_unique<MappedFile>();

    mf->mmap = mio::make_mmap_source(path.string(), ec);
    if (!ec && mf->mmap.is_open() && mf->mmap.size() >= CPK_MIN_FILE_SIZE) {
        mapped_file_ = std::move(mf);
        file_data_.clear();
    } else {
        mapped_file_.reset();

        std::ifstream file(path, std::ios::binary | std::ios::ate);
        if (!file.is_open()) {
            spdlog::error("CpkReader::open: impossible d'ouvrir '{}'", path.string());
            return false;
        }

        const auto size = file.tellg();
        if (static_cast<size_t>(size) < CPK_MIN_FILE_SIZE) {
            spdlog::error("CpkReader::open: fichier trop petit ({} octets, minimum {})",
                           static_cast<size_t>(size), CPK_MIN_FILE_SIZE);
            return false;
        }

        file.seekg(0);
        file_data_.resize(static_cast<size_t>(size));
        file.read(reinterpret_cast<char*>(file_data_.data()), size);
    }

    path_ = path;

    // --- Detecter le chiffrement CRI XOR file-level ---
    // Au lieu de copier+dechiffrer tout le fichier (56 GB pour le jeu complet),
    // on teste les 4 premiers octets et on active le streaming decrypt.
    const auto data = mapped_data();
    const uint32_t magic = cpk_read_u32_le(data, 0);

    if (magic != CPK_MAGIC_LE) {
        const auto filename = path.filename().string();

        // nie.exe FUN_1404a0670 : key = CRC32("XXXXXXXX-filename") avec AppID prefix.
        // Essayer d'abord avec AppID IEVR (2799860 = 0x002AB8F4), puis sans prefix.
        constexpr uint32_t IEVR_APP_ID = 2799860u;
        const uint32_t key_with_appid = iecode::crypto::cri_derive_key(filename, IEVR_APP_ID);
        const uint32_t key_without    = iecode::crypto::cri_derive_key(filename);

        auto try_key = [&](uint32_t candidate_key) -> bool {
            uint8_t test[4];
            std::memcpy(test, data.data(), 4);
            iecode::crypto::cri_decrypt_block(std::span<uint8_t>(test, 4), 0, candidate_key);
            uint32_t dm = 0;
            std::memcpy(&dm, test, 4);
            return dm == CPK_MAGIC_LE;
        };

        if (try_key(key_with_appid)) {
            is_file_encrypted_ = true;
            file_key_ = key_with_appid;
            spdlog::debug("CpkReader: cle avec AppID prefix pour '{}'", filename);
        } else if (try_key(key_without)) {
            is_file_encrypted_ = true;
            file_key_ = key_without;
            spdlog::debug("CpkReader: cle sans AppID prefix pour '{}'", filename);
        } else {
            spdlog::error("CpkReader: magic invalide 0x{:08X}, decrypt echoue pour '{}'",
                          magic, filename);
            return false;
        }
    }

    return parse_internal();
}

bool CpkReader::open_from_data(std::span<const uint8_t> data) {
    mapped_file_.reset();
    file_data_.assign(data.begin(), data.end());
    path_ = "<memory>";
    is_file_encrypted_ = false;
    file_key_ = 0;
    return parse_internal();
}

// ── Streaming decrypt : copie+dechiffre une region depuis le mmap ──

std::vector<uint8_t> CpkReader::read_region(size_t offset, size_t size) const {
    const auto data = mapped_data();
    if (offset + size > data.size()) return {};

    std::vector<uint8_t> region(data.begin() + static_cast<ptrdiff_t>(offset),
                                 data.begin() + static_cast<ptrdiff_t>(offset + size));

    if (is_file_encrypted_) {
        iecode::crypto::cri_decrypt_block(
            std::span<uint8_t>(region),
            static_cast<int64_t>(offset),
            file_key_);
    }

    return region;
}

// ── Parsing : ne dechiffre que header+TOC (quelques KB) ────────────

bool CpkReader::parse_internal() {
    const auto data = mapped_data();

    if (data.size() < CPK_MIN_FILE_SIZE) {
        spdlog::error("CpkReader: donnees trop petites ({} octets, minimum {})",
                       data.size(), CPK_MIN_FILE_SIZE);
        return false;
    }

    // --- Verifier le magic (read_region dechiffre si necessaire) ---
    auto magic_bytes = read_region(0, 4);
    if (magic_bytes.size() < 4) return false;
    const uint32_t magic = cpk_read_u32_le(magic_bytes, 0);

    if (magic != CPK_MAGIC_LE) {
        spdlog::error("CpkReader: magic invalide apres dechiffrement (0x{:08X})", magic);
        return false;
    }

    // --- Lire le conteneur header (16 octets) pour obtenir la taille de la table ---
    auto header_container = read_region(0, CPK_TABLE_CONTAINER_SIZE);
    if (header_container.size() < CPK_TABLE_CONTAINER_SIZE) return false;

    const uint32_t header_table_size = cpk_read_u32_le(header_container, 8);
    const size_t header_total = CPK_TABLE_CONTAINER_SIZE + header_table_size;

    if (header_total > data.size()) {
        spdlog::error("CpkReader: table header depasse le fichier");
        return false;
    }

    // --- Lire et dechiffrer la region header complete ---
    auto header_data = read_region(0, header_total);
    auto header_table = cpk_read_table_container(
        std::span<const uint8_t>(header_data), 0);

    if (!header_table) {
        spdlog::error("CpkReader: echec du parsing de la table header CPK");
        return false;
    }
    if (header_table->rows.empty()) {
        spdlog::error("CpkReader: table header CPK vide (0 lignes)");
        return false;
    }

    // --- TocOffset et ContentOffset ---
    const int64_t toc_offset = cpk_get_column_int64(*header_table, 0, "TocOffset", -1);
    int64_t content_offset = cpk_get_column_int64(*header_table, 0, "ContentOffset", -1);

    if (toc_offset < 0) {
        spdlog::error("CpkReader: TocOffset introuvable dans la table header");
        return false;
    }

    if (content_offset < 0 || toc_offset < content_offset) {
        content_offset = toc_offset;
    }

    spdlog::trace("CpkReader: TocOffset=0x{:X}, ContentOffset=0x{:X}",
                   toc_offset, content_offset);

    // --- Lire le conteneur TOC ---
    const auto toc_abs = static_cast<size_t>(toc_offset);
    if (toc_abs + CPK_TABLE_CONTAINER_SIZE > data.size()) {
        spdlog::error("CpkReader: TocOffset 0x{:X} hors bornes", toc_abs);
        return false;
    }

    auto toc_container = read_region(toc_abs, CPK_TABLE_CONTAINER_SIZE);
    if (toc_container.size() < CPK_TABLE_CONTAINER_SIZE) return false;

    const uint32_t toc_magic = cpk_read_u32_le(toc_container, 0);
    if (toc_magic != CPK_TOC_MAGIC_LE) {
        spdlog::warn("CpkReader: magic TOC inattendu (0x{:08X})", toc_magic);
    }

    const uint32_t toc_table_size = cpk_read_u32_le(toc_container, 8);
    const size_t toc_total = CPK_TABLE_CONTAINER_SIZE + toc_table_size;

    if (toc_abs + toc_total > data.size()) {
        spdlog::error("CpkReader: table TOC depasse le fichier");
        return false;
    }

    // Dechiffrer uniquement la region TOC
    auto toc_data = read_region(toc_abs, toc_total);
    auto toc_table = cpk_read_table_container(
        std::span<const uint8_t>(toc_data), 0);

    if (!toc_table) {
        spdlog::error("CpkReader: echec du parsing de la table TOC");
        return false;
    }

    // --- Remplir entries_ ---
    entries_.clear();
    entries_.reserve(toc_table->rows.size());

    for (size_t i = 0; i < toc_table->rows.size(); ++i) {
        CpkEntry entry;
        entry.filename  = cpk_get_column_string(*toc_table, i, "FileName");
        entry.directory  = cpk_get_column_string(*toc_table, i, "DirName");

        const int64_t file_offset = cpk_get_column_int64(*toc_table, i, "FileOffset", 0);
        entry.offset = static_cast<uint64_t>(file_offset + content_offset);

        const int64_t file_size = cpk_get_column_int64(*toc_table, i, "FileSize", 0);
        entry.size = static_cast<uint64_t>(file_size);

        const int64_t extract_size = cpk_get_column_int64(*toc_table, i, "ExtractSize", 0);
        entry.extract_size = static_cast<uint64_t>(extract_size);

        entry.is_compressed = (entry.extract_size != entry.size) && (entry.size > 0);

        entries_.push_back(std::move(entry));
    }

    spdlog::debug("CpkReader: '{}' — {} fichiers",
                   path_.filename().string(), entries_.size());
    return true;
}

// ── Extraction : dechiffre+decompresse a la volee ─────────────────

std::vector<uint8_t> CpkReader::extract(const CpkEntry& entry) const {
    if (entry.size == 0) return {};

    // read_region gere le dechiffrement streaming si necessaire
    auto raw = read_region(
        static_cast<size_t>(entry.offset),
        static_cast<size_t>(entry.size));

    if (raw.empty()) {
        spdlog::error("CpkReader::extract: '{}' hors bornes "
                       "(offset=0x{:X}, size=0x{:X})",
                       entry.filename, entry.offset, entry.size);
        return {};
    }

    if (entry.is_compressed && iecode::compression::is_crilayla(raw)) {
        auto decompressed = iecode::compression::crilayla_decompress(raw);
        if (decompressed.empty()) {
            spdlog::error("CpkReader::extract: echec CRILAYLA pour '{}'",
                           entry.filename);
            return {};
        }
        return decompressed;
    }

    return raw;
}

} // namespace iecode::criware
