/// @file mod_packager.cpp
/// Implementation du packaging de mods en archives ZIP.
///
/// Utilise un writer ZIP minimal base sur zlib (deflate).
/// Format ZIP compatible avec tous les outils standard (7-Zip, WinRAR, unzip).

#include "iecode/modding/mod_packager.h"

#include <fmt/format.h>
#include <fmt/ranges.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <zlib.h>

#include <algorithm>
#include <cstring>
#include <ctime>
#include <fstream>
#include <vector>

namespace fs = std::filesystem;

namespace iecode::modding {

// ── ZIP Writer minimal ────────────────────────────────────────────────
//
// Structure ZIP simplifiee :
//   [local file header 1][file data 1]
//   [local file header 2][file data 2]
//   ...
//   [central directory entry 1]
//   [central directory entry 2]
//   ...
//   [end of central directory record]

namespace {

/// Ecriture d'un entier en little-endian.
inline void write_u16(std::ostream& out, uint16_t v) {
    const uint8_t buf[2] = {
        static_cast<uint8_t>(v & 0xFF),
        static_cast<uint8_t>((v >> 8) & 0xFF)
    };
    out.write(reinterpret_cast<const char*>(buf), 2);
}

inline void write_u32(std::ostream& out, uint32_t v) {
    const uint8_t buf[4] = {
        static_cast<uint8_t>(v & 0xFF),
        static_cast<uint8_t>((v >> 8) & 0xFF),
        static_cast<uint8_t>((v >> 16) & 0xFF),
        static_cast<uint8_t>((v >> 24) & 0xFF)
    };
    out.write(reinterpret_cast<const char*>(buf), 4);
}

/// Convertit un path en slash-forward pour le ZIP.
std::string zip_path(const fs::path& p) {
    return p.generic_string();
}

/// Convertit un std::time_t en format date/heure MS-DOS pour ZIP.
void time_to_dos(std::time_t t, uint16_t& dos_date, uint16_t& dos_time) {
    std::tm tm_buf{};
#ifdef _WIN32
    localtime_s(&tm_buf, &t);
#else
    localtime_r(&t, &tm_buf);
#endif
    dos_time = static_cast<uint16_t>(
        (tm_buf.tm_sec / 2) | (tm_buf.tm_min << 5) | (tm_buf.tm_hour << 11));
    dos_date = static_cast<uint16_t>(
        tm_buf.tm_mday | ((tm_buf.tm_mon + 1) << 5) |
        ((tm_buf.tm_year - 80) << 9));
}

/// Entree dans le ZIP en cours de construction.
struct ZipEntry {
    std::string name;            // chemin dans le ZIP (forward slashes)
    uint32_t crc32 = 0;
    uint32_t compressed_size = 0;
    uint32_t uncompressed_size = 0;
    uint32_t local_header_offset = 0;
    uint16_t dos_time = 0;
    uint16_t dos_date = 0;
    uint16_t method = 8;         // 0=stored, 8=deflate
};

/// Calcule le CRC32 d'un buffer (utilise zlib).
uint32_t compute_crc32(const std::vector<uint8_t>& data) {
    return static_cast<uint32_t>(
        crc32(crc32(0, Z_NULL, 0), data.data(), static_cast<uInt>(data.size())));
}

/// Compresse un buffer avec deflate (zlib raw, sans header gzip).
std::vector<uint8_t> deflate_data(const std::vector<uint8_t>& input) {
    if (input.empty()) return {};

    // Taille estimee du buffer de sortie
    // Estimation generique de la taille du buffer de sortie
    const auto bound = static_cast<size_t>(input.size() + (input.size() / 100) + 512);

    std::vector<uint8_t> output(bound);

    z_stream strm{};
    // windowBits = -15 pour raw deflate (pas de header zlib/gzip)
    if (deflateInit2(&strm, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8,
                     Z_DEFAULT_STRATEGY) != Z_OK) {
        return {};
    }

    strm.avail_in = static_cast<uInt>(input.size());
    strm.next_in = const_cast<Bytef*>(input.data());
    strm.avail_out = static_cast<uInt>(output.size());
    strm.next_out = output.data();

    int ret = deflate(&strm, Z_FINISH);
    deflateEnd(&strm);

    if (ret != Z_STREAM_END) {
        return {};
    }

    output.resize(strm.total_out);
    return output;
}

/// Lit un fichier en entier.
std::vector<uint8_t> read_file_bin(const fs::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return {};
    const auto size = file.tellg();
    if (size <= 0) return {};
    std::vector<uint8_t> data(static_cast<size_t>(size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

/// Ecrit le local file header + les donnees compressees dans le flux.
void write_local_file(std::ostream& out, ZipEntry& entry,
                      const std::vector<uint8_t>& file_data) {
    entry.local_header_offset = static_cast<uint32_t>(out.tellp());
    entry.uncompressed_size = static_cast<uint32_t>(file_data.size());
    entry.crc32 = compute_crc32(file_data);

    // Compresser
    std::vector<uint8_t> compressed;
    if (!file_data.empty()) {
        compressed = deflate_data(file_data);
    }

    // Si la compression n'aide pas, stocker directement
    if (compressed.empty() || compressed.size() >= file_data.size()) {
        compressed = file_data;
        entry.method = 0;  // stored
    } else {
        entry.method = 8;  // deflate
    }
    entry.compressed_size = static_cast<uint32_t>(compressed.size());

    // Local file header (PK\x03\x04)
    write_u32(out, 0x04034b50);                // signature
    write_u16(out, 20);                         // version needed (2.0)
    write_u16(out, 0);                          // general purpose bit flag
    write_u16(out, entry.method);               // compression method
    write_u16(out, entry.dos_time);             // last mod file time
    write_u16(out, entry.dos_date);             // last mod file date
    write_u32(out, entry.crc32);                // crc-32
    write_u32(out, entry.compressed_size);      // compressed size
    write_u32(out, entry.uncompressed_size);    // uncompressed size
    write_u16(out, static_cast<uint16_t>(entry.name.size()));  // filename length
    write_u16(out, 0);                          // extra field length

    // Filename
    out.write(entry.name.data(), static_cast<std::streamsize>(entry.name.size()));

    // File data
    if (!compressed.empty()) {
        out.write(reinterpret_cast<const char*>(compressed.data()),
                  static_cast<std::streamsize>(compressed.size()));
    }
}

/// Ecrit le central directory entry.
void write_central_entry(std::ostream& out, const ZipEntry& entry) {
    write_u32(out, 0x02014b50);                // central directory signature
    write_u16(out, 20);                         // version made by (2.0)
    write_u16(out, 20);                         // version needed (2.0)
    write_u16(out, 0);                          // general purpose bit flag
    write_u16(out, entry.method);               // compression method
    write_u16(out, entry.dos_time);             // last mod file time
    write_u16(out, entry.dos_date);             // last mod file date
    write_u32(out, entry.crc32);                // crc-32
    write_u32(out, entry.compressed_size);      // compressed size
    write_u32(out, entry.uncompressed_size);    // uncompressed size
    write_u16(out, static_cast<uint16_t>(entry.name.size()));  // filename length
    write_u16(out, 0);                          // extra field length
    write_u16(out, 0);                          // file comment length
    write_u16(out, 0);                          // disk number start
    write_u16(out, 0);                          // internal file attributes
    write_u32(out, 0);                          // external file attributes
    write_u32(out, entry.local_header_offset);  // relative offset of local header

    out.write(entry.name.data(), static_cast<std::streamsize>(entry.name.size()));
}

/// Ecrit l'end of central directory record.
void write_eocd(std::ostream& out, uint16_t entry_count,
                uint32_t cd_offset, uint32_t cd_size) {
    write_u32(out, 0x06054b50);        // end of central dir signature
    write_u16(out, 0);                 // number of this disk
    write_u16(out, 0);                 // disk where cd starts
    write_u16(out, entry_count);       // entries on this disk
    write_u16(out, entry_count);       // total entries
    write_u32(out, cd_size);           // size of central directory
    write_u32(out, cd_offset);         // offset of cd from start
    write_u16(out, 0);                 // comment length
}

} // namespace anonyme

// ── Validation ────────────────────────────────────────────────────────

ValidationResult validate_mod_structure(const fs::path& mod_dir) {
    ValidationResult result;

    if (!fs::exists(mod_dir) || !fs::is_directory(mod_dir)) {
        result.valid = false;
        result.errors.push_back(
            fmt::format("dossier inexistant : '{}'", mod_dir.string()));
        return result;
    }

    // Verifier mod_data.json
    const auto json_path = mod_dir / "mod_data.json";
    if (!fs::exists(json_path)) {
        result.valid = false;
        result.errors.push_back("mod_data.json absent");
    } else {
        try {
            std::ifstream file(json_path);
            auto j = nlohmann::json::parse(file);

            if (!j.is_object()) {
                result.valid = false;
                result.errors.push_back("mod_data.json n'est pas un objet JSON");
            } else {
                // Verifier les champs obligatoires
                bool has_name = false;
                bool has_author = false;
                for (auto it = j.begin(); it != j.end(); ++it) {
                    auto key_lower = it.key();
                    std::transform(key_lower.begin(), key_lower.end(),
                                   key_lower.begin(),
                                   [](unsigned char c) { return std::tolower(c); });
                    if (key_lower == "name" && it->is_string() && !it->get<std::string>().empty()) {
                        has_name = true;
                    }
                    if (key_lower == "author" && it->is_string() && !it->get<std::string>().empty()) {
                        has_author = true;
                    }
                }
                if (!has_name) {
                    result.valid = false;
                    result.errors.push_back("champ 'name' manquant ou vide dans mod_data.json");
                }
                if (!has_author) {
                    result.warnings.push_back("champ 'author' manquant ou vide dans mod_data.json");
                }
            }
        } catch (const std::exception& e) {
            result.valid = false;
            result.errors.push_back(
                fmt::format("mod_data.json invalide : {}", e.what()));
        }
    }

    // Verifier le dossier data/
    const auto data_dir = mod_dir / "data";
    if (!fs::exists(data_dir) || !fs::is_directory(data_dir)) {
        result.valid = false;
        result.errors.push_back("dossier 'data/' absent");
    } else {
        // Verifier qu'il contient au moins un fichier
        bool has_files = false;
        std::error_code ec;
        for (const auto& entry : fs::recursive_directory_iterator(data_dir, ec)) {
            if (entry.is_regular_file()) {
                has_files = true;
                break;
            }
        }
        if (!has_files) {
            result.warnings.push_back("dossier 'data/' vide — le mod ne contient aucun fichier");
        }
    }

    // Verifier le README
    if (!fs::exists(mod_dir / "README.md") && !fs::exists(mod_dir / "README.txt")) {
        result.warnings.push_back("aucun fichier README trouve");
    }

    return result;
}

// ── Packaging ─────────────────────────────────────────────────────────

PackageResult package_mod(const PackageOptions& options) {
    PackageResult result;

    // Validation prealable
    if (options.validate) {
        auto validation = validate_mod_structure(options.mod_dir);
        if (!validation.valid) {
            result.success = false;
            result.error = fmt::format("validation echouee : {}",
                                       fmt::join(validation.errors, "; "));
            return result;
        }
        // Journaliser les avertissements
        for (const auto& w : validation.warnings) {
            spdlog::warn("mod_packager: {}", w);
        }
    }

    // Determiner le chemin de sortie
    fs::path out_path = options.output_path;
    if (out_path.empty()) {
        out_path = options.mod_dir.filename();
        out_path.replace_extension(".zip");
    }

    // Creer les dossiers parents si necessaire
    if (out_path.has_parent_path()) {
        std::error_code ec;
        fs::create_directories(out_path.parent_path(), ec);
    }

    // Collecter les fichiers a inclure
    struct FileEntry {
        fs::path disk_path;    // chemin reel sur le disque
        fs::path zip_name;     // chemin relatif dans le ZIP
    };
    std::vector<FileEntry> files;

    // mod_data.json en racine
    const auto json_path = options.mod_dir / "mod_data.json";
    if (fs::exists(json_path)) {
        files.push_back({json_path, "mod_data.json"});
    }

    // README si demande
    if (options.include_readme) {
        for (const auto& readme : {"README.md", "README.txt", "readme.md", "readme.txt"}) {
            auto rp = options.mod_dir / readme;
            if (fs::exists(rp)) {
                files.push_back({rp, readme});
                break;
            }
        }
    }

    // Dossier data/ recursivement
    const auto data_dir = options.mod_dir / "data";
    if (fs::exists(data_dir) && fs::is_directory(data_dir)) {
        std::error_code ec;
        for (const auto& entry : fs::recursive_directory_iterator(data_dir, ec)) {
            if (!entry.is_regular_file()) continue;

            auto rel = fs::relative(entry.path(), options.mod_dir, ec);
            if (ec) continue;

            files.push_back({entry.path(), rel});
        }
    }

    if (files.empty()) {
        result.success = false;
        result.error = "aucun fichier a empaqueter";
        return result;
    }

    // Ecrire le ZIP
    std::ofstream zip_out(out_path, std::ios::binary);
    if (!zip_out) {
        result.success = false;
        result.error = fmt::format("impossible de creer '{}'", out_path.string());
        return result;
    }

    // Timestamp courant en format DOS
    uint16_t dos_time = 0;
    uint16_t dos_date = 0;
    {
        auto now = std::time(nullptr);
        time_to_dos(now, dos_date, dos_time);
    }

    std::vector<ZipEntry> entries;
    entries.reserve(files.size());
    size_t total_uncompressed = 0;

    for (const auto& [disk_path, rel_name] : files) {
        auto file_data = read_file_bin(disk_path);

        ZipEntry ze;
        ze.name = zip_path(rel_name);
        ze.dos_time = dos_time;
        ze.dos_date = dos_date;

        write_local_file(zip_out, ze, file_data);
        total_uncompressed += file_data.size();
        entries.push_back(std::move(ze));
    }

    // Central directory
    auto cd_offset = static_cast<uint32_t>(zip_out.tellp());
    for (const auto& ze : entries) {
        write_central_entry(zip_out, ze);
    }
    auto cd_end = static_cast<uint32_t>(zip_out.tellp());

    // End of central directory
    write_eocd(zip_out,
               static_cast<uint16_t>(entries.size()),
               cd_offset,
               cd_end - cd_offset);

    zip_out.close();

    result.success = true;
    result.output_path = out_path;
    result.files_packaged = entries.size();
    result.total_size_bytes = total_uncompressed;

    spdlog::info("mod_packager: {} fichiers empaquetes dans '{}' ({} octets)",
                 result.files_packaged, out_path.string(), result.total_size_bytes);

    return result;
}

// ── Template ──────────────────────────────────────────────────────────

bool create_mod_template(const fs::path& dir,
                         const std::string& mod_name,
                         const std::string& author) {
    std::error_code ec;

    // Creer le dossier racine
    fs::create_directories(dir, ec);
    if (ec) {
        spdlog::error("mod_packager: impossible de creer '{}': {}",
                      dir.string(), ec.message());
        return false;
    }

    // Creer le dossier data/
    fs::create_directories(dir / "data", ec);
    if (ec) {
        spdlog::error("mod_packager: impossible de creer 'data/': {}", ec.message());
        return false;
    }

    // Generer mod_data.json
    nlohmann::json j = {
        {"name", mod_name},
        {"author", author},
        {"modVersion", "1.0.0"},
        {"gameVersion", "5.00.24.00"},
        {"modLink", ""},
        {"dependencies", nlohmann::json::array()}
    };

    const auto json_path = dir / "mod_data.json";
    std::ofstream file(json_path);
    if (!file) {
        spdlog::error("mod_packager: impossible de creer '{}'", json_path.string());
        return false;
    }
    file << j.dump(2);
    file.close();

    spdlog::info("mod_packager: template cree dans '{}'", dir.string());
    return true;
}

} // namespace iecode::modding
