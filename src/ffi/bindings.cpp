/// @file bindings.cpp
/// Module Python nanobind "iecode" — expose les parsers et utilitaires C++ natifs.
///
/// Prefere ce module au wrapper ctypes (iecode.py / IecodeFFI) :
/// vrais types C++, gestion memoire automatique, pas de handles opaques.

#include <nanobind/nanobind.h>
#include <nanobind/stl/optional.h>
#include <nanobind/stl/string.h>
#include <nanobind/stl/vector.h>

#include "iecode/compression/crilayla.h"
#include "iecode/compression/lz10.h"
#include "iecode/compression/lz4_block.h"
#include "iecode/converters/texture_export.h"
#include "iecode/crypto/crc32.h"
#include "iecode/crypto/cri_crypto.h"
#include "iecode/formats/bin_dispatcher.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/criware/cpk_writer.h"
#include "iecode/formats/criware/utf_parser.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/level5/col_parser.h"
#include "iecode/formats/level5/g4nv_parser.h"
#include "iecode/formats/level5/g4pk.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/level5/objbin_parser.h"

#include <fmt/format.h>

#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <span>
#include <string>
#include <unordered_map>
#include <vector>

namespace nb = nanobind;
using namespace nb::literals;

// ── Version statique ─────────────────────────────────────────────────

static constexpr const char* IECODE_PY_VERSION = "1.0.0";

// ── Helpers internes ─────────────────────────────────────────────────

namespace {

/// Convertit nb::bytes en span<const uint8_t> (zero-copy).
std::span<const uint8_t> bytes_to_span(const nb::bytes& data) {
    return {reinterpret_cast<const uint8_t*>(data.c_str()), data.size()};
}

/// Convertit un vector<uint8_t> en nb::bytes.
nb::bytes vec_to_bytes(const std::vector<uint8_t>& v) {
    return nb::bytes(reinterpret_cast<const char*>(v.data()), v.size());
}

/// Lit un fichier en entier dans un vector<uint8_t>.
std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) {
        throw nb::value_error(("Impossible d'ouvrir le fichier : " + path).c_str());
    }
    auto size = f.tellg();
    f.seekg(0);
    std::vector<uint8_t> buf(static_cast<size_t>(size));
    f.read(reinterpret_cast<char*>(buf.data()), size);
    return buf;
}

} // namespace anonyme

// ── Wrappers Python ──────────────────────────────────────────────────

/// Wrapper CpkReader : ouvre un CPK depuis un chemin fichier.
class PyCpkReader {
public:
    explicit PyCpkReader(const std::string& path) {
        if (!reader_.open(std::filesystem::path(path))) {
            throw nb::value_error(("Impossible d'ouvrir le CPK : " + path).c_str());
        }
    }

    /// Nombre de fichiers dans l'archive.
    [[nodiscard]] size_t count() const noexcept { return reader_.count(); }

    /// Liste des noms de fichiers.
    [[nodiscard]] nb::list filenames() const {
        nb::list result;
        for (const auto& entry : reader_.list()) {
            std::string full = entry.directory.empty()
                                   ? entry.filename
                                   : entry.directory + "/" + entry.filename;
            result.append(nb::str(full.c_str(), full.size()));
        }
        return result;
    }

    /// Extrait le fichier a l'index donne.
    [[nodiscard]] nb::bytes extract(int index) const {
        const auto& entries = reader_.list();
        if (index < 0 || static_cast<size_t>(index) >= entries.size()) {
            throw nb::index_error("Index CPK hors limites");
        }
        auto data = reader_.extract(entries[static_cast<size_t>(index)]);
        if (data.empty()) {
            throw nb::value_error("Extraction CPK echouee");
        }
        return vec_to_bytes(data);
    }

private:
    iecode::criware::CpkReader reader_;
};

/// Wrapper G4TX : parse un fichier G4TX depuis des bytes.
class PyG4tx {
public:
    explicit PyG4tx(const nb::bytes& data) {
        auto span = bytes_to_span(data);
        auto parsed = iecode::level5::g4tx_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing G4TX echoue (magic invalide ou donnees corrompues)");
        }
        file_ = std::move(*parsed);
    }

    /// Nombre de textures dans le fichier.
    [[nodiscard]] size_t count() const noexcept { return file_.textures.size(); }

    /// Exporte la texture d'index idx en PNG au chemin donne.
    [[nodiscard]] bool export_png(int index, const std::string& path) const {
        if (index < 0 || static_cast<size_t>(index) >= file_.textures.size()) {
            throw nb::index_error("Index texture hors limites");
        }
        return iecode::converters::export_png(
            file_.textures[static_cast<size_t>(index)],
            std::filesystem::path(path));
    }

    /// Exporte la texture d'index idx en WebP.
    [[nodiscard]] bool export_webp(int index, const std::string& path, int quality = 90) const {
        if (index < 0 || static_cast<size_t>(index) >= file_.textures.size()) {
            throw nb::index_error("Index texture hors limites");
        }
        return iecode::converters::export_webp(
            file_.textures[static_cast<size_t>(index)],
            std::filesystem::path(path),
            quality);
    }

    /// Decode la texture en RGBA8 brut.
    [[nodiscard]] nb::bytes decode_rgba(int index) const {
        if (index < 0 || static_cast<size_t>(index) >= file_.textures.size()) {
            throw nb::index_error("Index texture hors limites");
        }
        auto rgba = iecode::converters::decode_to_rgba8(
            file_.textures[static_cast<size_t>(index)]);
        if (rgba.empty()) {
            throw nb::value_error("Decodage RGBA echoue");
        }
        return vec_to_bytes(rgba);
    }

    /// Informations sur une texture (dict Python).
    [[nodiscard]] nb::dict info(int index) const {
        if (index < 0 || static_cast<size_t>(index) >= file_.textures.size()) {
            throw nb::index_error("Index texture hors limites");
        }
        const auto& tex = file_.textures[static_cast<size_t>(index)];
        nb::dict d;
        d["index"] = index;
        d["name"] = tex.name;
        d["width"] = tex.width;
        d["height"] = tex.height;
        d["format"] = static_cast<uint32_t>(tex.format);
        d["mip_count"] = tex.mip_count;
        d["is_dds"] = tex.is_dds;
        d["data_size"] = tex.data.size();
        d["sub_texture_count"] = tex.sub_textures.size();
        return d;
    }

private:
    iecode::level5::G4txFile file_;
};

// ── cpk_list_files — liste les fichiers d'un CPK chiffre ou non ─────

/// Lit un uint32 LE depuis un buffer.
static uint32_t read_u32_le_buf(const uint8_t* p) noexcept {
    uint32_t v = 0;
    std::memcpy(&v, p, 4);
    return v;
}

/// Lit un chunk de fichier, le dechiffre si une cle est fournie.
static std::vector<uint8_t> read_and_decrypt_chunk(
    std::ifstream& f, int64_t offset, size_t size, uint32_t key, bool encrypted) {

    std::vector<uint8_t> buf(size);
    f.seekg(offset);
    f.read(reinterpret_cast<char*>(buf.data()), static_cast<std::streamsize>(size));
    const auto actual = static_cast<size_t>(f.gcount());
    buf.resize(actual);

    if (encrypted && !buf.empty()) {
        iecode::crypto::cri_decrypt_block(
            std::span<uint8_t>(buf), offset, key);
    }
    return buf;
}

/// Liste les fichiers d'un CPK. Gere le chiffrement CRI externe
/// (XOR derive du nom de fichier) de maniere transparente.
/// Optimise : ne lit que le header + TOC (pas le fichier entier de 4+ GB).
static std::vector<std::string> cpk_list_files_nb(const std::string& path) {
    namespace fs = std::filesystem;

    const fs::path cpk_path(path);

    std::ifstream f(cpk_path, std::ios::binary | std::ios::ate);
    if (!f) {
        throw nb::value_error(("Impossible d'ouvrir le fichier : " + path).c_str());
    }
    const auto file_size = static_cast<size_t>(f.tellg());
    if (file_size < 64) {
        throw nb::value_error("Fichier CPK trop petit");
    }

    // Detecter le chiffrement : lire les 4 premiers octets
    bool encrypted = false;
    uint32_t key = 0;

    {
        uint8_t magic_buf[4]{};
        f.seekg(0);
        f.read(reinterpret_cast<char*>(magic_buf), 4);

        constexpr uint32_t CPK_MAGIC = 0x204B5043;
        uint32_t magic = read_u32_le_buf(magic_buf);

        if (magic != CPK_MAGIC) {
            // Tenter le dechiffrement CRI
            const std::string filename = cpk_path.filename().string();
            key = iecode::crypto::cri_derive_key(filename);
            encrypted = true;

            // Dechiffrer les 4 octets du magic pour verifier
            iecode::crypto::cri_decrypt_block(
                std::span<uint8_t>(magic_buf, 4), 0, key);
            magic = read_u32_le_buf(magic_buf);

            if (magic != CPK_MAGIC) {
                throw nb::value_error(
                    ("Magic CPK invalide apres dechiffrement (0x"
                     + fmt::format("{:08X}", magic)
                     + "). Fichier corrompu ou cle incorrecte.")
                        .c_str());
            }
        }
    }

    // Lire le header CPK : container (16 octets) + table @UTF
    // D'abord lire le container pour connaitre la taille de la table
    auto container = read_and_decrypt_chunk(f, 0, 16, key, encrypted);
    const uint32_t header_table_size = read_u32_le_buf(container.data() + 8);

    // Lire la table header @UTF (a partir de l'offset 16)
    const size_t header_total = 16 + header_table_size;
    auto header_data = read_and_decrypt_chunk(f, 0, header_total, key, encrypted);

    // Parser le header avec CpkReader::open_from_data en deux passes :
    // 1. D'abord parser juste le header pour obtenir TocOffset/TocSize
    // On reutilise open_from_data avec les donnees partielles pour extraire les offsets.
    // ... mais open_from_data fait un parsing complet incluant le TOC.

    // Approche directe : parser l'@UTF header manuellement pour extraire TocOffset/TocSize,
    // puis lire le chunk TOC, et construire un buffer contenant header + TOC.

    // Le header @UTF commence a l'offset 16 dans le CPK
    auto header_utf = iecode::criware::utf_parse(
        std::span<const uint8_t>(header_data.data() + 16, header_table_size));
    if (!header_utf || header_utf->rows.empty()) {
        throw nb::value_error("Echec du parsing de la table header CPK");
    }

    // Chercher TocOffset et TocSize dans la table header
    int64_t toc_offset = -1;
    int64_t toc_size = -1;
    int64_t content_offset = -1;

    for (size_t col = 0; col < header_utf->columns.size(); ++col) {
        const auto& name = header_utf->columns[col].name;
        const auto& val = header_utf->rows[0].values[col];

        if (name == "TocOffset") {
            if (const auto* v = std::get_if<uint64_t>(&val))
                toc_offset = static_cast<int64_t>(*v);
            else if (const auto* v32 = std::get_if<uint32_t>(&val))
                toc_offset = static_cast<int64_t>(*v32);
        } else if (name == "TocSize") {
            if (const auto* v = std::get_if<uint64_t>(&val))
                toc_size = static_cast<int64_t>(*v);
            else if (const auto* v32 = std::get_if<uint32_t>(&val))
                toc_size = static_cast<int64_t>(*v32);
        } else if (name == "ContentOffset") {
            if (const auto* v = std::get_if<uint64_t>(&val))
                content_offset = static_cast<int64_t>(*v);
            else if (const auto* v32 = std::get_if<uint32_t>(&val))
                content_offset = static_cast<int64_t>(*v32);
        }
    }

    if (toc_offset < 0 || toc_size <= 0) {
        throw nb::value_error("TocOffset/TocSize introuvable dans le header CPK");
    }

    if (content_offset < 0 || toc_offset < content_offset) {
        content_offset = toc_offset;
    }

    // Lire le chunk TOC (conteneur 16 octets + table @UTF)
    auto toc_data = read_and_decrypt_chunk(
        f, toc_offset, static_cast<size_t>(toc_size), key, encrypted);
    f.close();

    // Verifier le magic "TOC " (optionnel, certains CPK n'ont pas ce magic)
    // Parser la table @UTF du TOC (a l'offset 16 dans le conteneur TOC)
    if (toc_data.size() < 16) {
        throw nb::value_error("Donnees TOC trop petites");
    }

    // Le conteneur TOC : magic(4) + pad(4) + size(4) + pad(4)
    const uint32_t toc_table_size = read_u32_le_buf(toc_data.data() + 8);
    if (16 + toc_table_size > toc_data.size()) {
        throw nb::value_error("Table TOC depasse les donnees lues");
    }

    // Detecter le chiffrement @UTF interne de la table TOC
    auto toc_table_span = std::span<const uint8_t>(
        toc_data.data() + 16, toc_table_size);

    std::vector<uint8_t> toc_table_decrypted;
    uint32_t toc_utf_magic = 0;
    if (toc_table_size >= 4) {
        std::memcpy(&toc_utf_magic, toc_table_span.data(), 4);
        if (toc_utf_magic != 0x46545540) {
            // Table @UTF chiffree — dechiffrer avec la cle de table CRI
            toc_table_decrypted.assign(toc_table_span.begin(), toc_table_span.end());
            iecode::crypto::cri_decrypt_table(toc_table_decrypted);
            toc_table_span = toc_table_decrypted;

            std::memcpy(&toc_utf_magic, toc_table_span.data(), 4);
            if (toc_utf_magic != 0x46545540) {
                throw nb::value_error("Table TOC @UTF corrompue apres dechiffrement");
            }
        }
    }

    auto toc_table = iecode::criware::utf_parse(toc_table_span);
    if (!toc_table) {
        throw nb::value_error("Echec du parsing de la table TOC @UTF");
    }

    // Extraire les noms de fichiers depuis la table TOC
    std::vector<std::string> result;
    result.reserve(toc_table->rows.size());

    // Trouver les indices des colonnes FileName et DirName
    size_t filename_col = SIZE_MAX;
    size_t dirname_col = SIZE_MAX;
    for (size_t c = 0; c < toc_table->columns.size(); ++c) {
        if (toc_table->columns[c].name == "FileName") filename_col = c;
        else if (toc_table->columns[c].name == "DirName") dirname_col = c;
    }

    if (filename_col == SIZE_MAX) {
        throw nb::value_error("Colonne 'FileName' absente de la table TOC");
    }

    for (const auto& row : toc_table->rows) {
        std::string fname;
        if (filename_col < row.values.size()) {
            if (const auto* s = std::get_if<std::string>(&row.values[filename_col])) {
                fname = *s;
            }
        }

        std::string dir;
        if (dirname_col < row.values.size() && dirname_col != SIZE_MAX) {
            if (const auto* s = std::get_if<std::string>(&row.values[dirname_col])) {
                dir = *s;
            }
        }

        if (dir.empty()) {
            result.push_back(std::move(fname));
        } else {
            result.push_back(dir + "/" + fname);
        }
    }
    return result;
}

// ── Module nanobind ──────────────────────────────────────────────────

NB_MODULE(iecode, m) {
    m.doc() = "iecode — toolkit natif de RE et modding pour Inazuma Eleven: Victory Road";

    // ── Version ──────────────────────────────────────────────────────

    m.def("version", []() -> std::string { return IECODE_PY_VERSION; },
          "Retourne la version d'iecode.");

    // ── CpkReader ────────────────────────────────────────────────────

    nb::class_<PyCpkReader>(m, "CpkReader",
        "Lecteur d'archives CPK (CRI Package).\n\n"
        "Utilise memory-mapped I/O pour un acces zero-copy.")
        .def(nb::init<const std::string&>(), "path"_a,
             "Ouvre un fichier CPK depuis un chemin.")
        .def_prop_ro("count", &PyCpkReader::count,
             "Nombre de fichiers dans l'archive.")
        .def("filenames", &PyCpkReader::filenames,
             "Liste des noms de fichiers contenus.")
        .def("extract", &PyCpkReader::extract, "index"_a,
             "Extrait le fichier a l'index donne (retourne bytes).");

    m.def("cpk_list_files", &cpk_list_files_nb, "path"_a,
          "Liste les fichiers d'un CPK (supporte le chiffrement CRI externe).");

    // ── CPK read_file — lecture directe d'un fichier par chemin interne ──

    m.def("cpk_read_file", [](const std::string& cpk_path, const std::string& internal_path) -> nb::bytes {
        iecode::criware::CpkReader reader;
        if (!reader.open(std::filesystem::path(cpk_path))) {
            throw nb::value_error(("Impossible d'ouvrir le CPK : " + cpk_path).c_str());
        }

        for (const auto& entry : reader.list()) {
            std::string full = entry.directory.empty()
                                   ? entry.filename
                                   : entry.directory + "/" + entry.filename;
            if (full == internal_path) {
                auto data = reader.extract(entry);
                if (data.empty()) {
                    throw nb::value_error(
                        ("Extraction echouee pour '" + internal_path + "'").c_str());
                }
                return vec_to_bytes(data);
            }
        }
        throw nb::value_error(("Fichier '" + internal_path + "' non trouve dans le CPK").c_str());
    }, "cpk_path"_a, "internal_path"_a,
       "Lit un fichier specifique dans un CPK par chemin interne (ex: 'common/chara/chr001.g4tx').\n"
       "Retourne les donnees dechiffrees/decompressees (bytes).");

    // ── CPK find_entry — infos sur une entree par chemin interne ─────

    m.def("cpk_find_entry", [](const std::string& cpk_path, const std::string& internal_path) -> nb::dict {
        iecode::criware::CpkReader reader;
        if (!reader.open(std::filesystem::path(cpk_path))) {
            throw nb::value_error(("Impossible d'ouvrir le CPK : " + cpk_path).c_str());
        }

        for (size_t i = 0; i < reader.list().size(); ++i) {
            const auto& entry = reader.list()[i];
            std::string full = entry.directory.empty()
                                   ? entry.filename
                                   : entry.directory + "/" + entry.filename;
            if (full == internal_path) {
                nb::dict d;
                d["index"] = static_cast<int>(i);
                d["filename"] = entry.filename;
                d["directory"] = entry.directory;
                d["offset"] = entry.offset;
                d["size"] = entry.size;
                d["extract_size"] = entry.extract_size;
                d["is_compressed"] = entry.is_compressed;
                d["is_encrypted"] = entry.is_encrypted;
                return d;
            }
        }
        throw nb::value_error(("Fichier '" + internal_path + "' non trouve dans le CPK").c_str());
    }, "cpk_path"_a, "internal_path"_a,
       "Retourne un dict avec les metadonnees d'une entree CPK par chemin interne.");

    // ── CPK patch — remplacement in-place ────────────────────────────

    m.def("cpk_patch", [](const std::string& cpk_path,
                           const std::string& internal_path,
                           const nb::bytes& data) -> bool {
        auto span = bytes_to_span(data);
        return iecode::criware::cpk_patch_file(
            std::filesystem::path(cpk_path),
            internal_path,
            span);
    }, "cpk_path"_a, "internal_path"_a, "data"_a,
       "Patche un fichier dans un CPK existant (in-place).\n"
       "Le nouveau fichier doit avoir une taille <= a l'original.\n"
       "Retourne True si succes.");

    // ── CPK rebuild_with_mods — rebuild avec fichiers remplaces ──────

    m.def("cpk_rebuild_with_mods", [](const std::string& source_cpk,
                                       const std::string& output_path,
                                       const nb::list& mods) -> bool {
        // Construire un index des mods : internal_path -> file_path sur disque
        struct ModInfo {
            std::string file_path;
            bool compress = false;
        };
        std::unordered_map<std::string, ModInfo> mods_map;

        for (size_t i = 0; i < nb::len(mods); ++i) {
            nb::dict mod = nb::cast<nb::dict>(mods[i]);
            std::string ipath = nb::cast<std::string>(mod["internal_path"]);
            std::string fpath = nb::cast<std::string>(mod["file_path"]);
            bool comp = false;
            if (mod.contains("compress")) {
                comp = nb::cast<bool>(mod["compress"]);
            }
            mods_map[ipath] = ModInfo{.file_path = fpath, .compress = comp};
        }

        // Ouvrir le CPK source
        iecode::criware::CpkReader reader;
        if (!reader.open(std::filesystem::path(source_cpk))) {
            throw nb::value_error(("Impossible d'ouvrir le CPK source : " + source_cpk).c_str());
        }

        // Construire les entrees pour le rebuild
        std::vector<iecode::criware::CpkWriteEntry> entries;
        entries.reserve(reader.list().size());

        for (const auto& cpk_entry : reader.list()) {
            iecode::criware::CpkWriteEntry we;
            we.filename  = cpk_entry.filename;
            we.directory = cpk_entry.directory;

            std::string full = cpk_entry.directory.empty()
                                   ? cpk_entry.filename
                                   : cpk_entry.directory + "/" + cpk_entry.filename;

            auto it = mods_map.find(full);
            if (it != mods_map.end()) {
                // Entree modifiee
                we.compress = it->second.compress;
                we.data = read_file(it->second.file_path);
            } else {
                // Entree originale
                we.data = reader.extract(cpk_entry);
                we.compress = cpk_entry.is_compressed;
            }

            entries.push_back(std::move(we));
        }

        return iecode::criware::cpk_rebuild(entries, std::filesystem::path(output_path));
    }, "source_cpk"_a, "output_path"_a, "mods"_a,
       "Reconstruit un CPK en remplacant certains fichiers.\n"
       "mods = liste de dicts {'internal_path': '...', 'file_path': '...', 'compress': False}.\n"
       "Retourne True si succes.");

    // ── G4tx ─────────────────────────────────────────────────────────

    nb::class_<PyG4tx>(m, "G4tx",
        "Fichier texture G4TX (Level-5).\n\n"
        "Parse depuis des bytes bruts, exporte en PNG/WebP.")
        .def(nb::init<const nb::bytes&>(), "data"_a,
             "Parse un fichier G4TX depuis des bytes.")
        .def_prop_ro("count", &PyG4tx::count,
             "Nombre de textures dans le fichier.")
        .def("export_png", &PyG4tx::export_png, "index"_a, "path"_a,
             "Exporte la texture d'index idx en PNG.")
        .def("export_webp", &PyG4tx::export_webp, "index"_a, "path"_a, "quality"_a = 90,
             "Exporte la texture d'index idx en WebP.")
        .def("decode_rgba", &PyG4tx::decode_rgba, "index"_a,
             "Decode la texture en RGBA8 brut (bytes).")
        .def("info", &PyG4tx::info, "index"_a,
             "Retourne un dict avec les metadonnees de la texture.");

    // ── CfgBin ───────────────────────────────────────────────────────

    m.def("cfgbin_parse", [](const nb::bytes& data) -> nb::dict {
        auto span = bytes_to_span(data);
        auto parsed = iecode::level5::cfgbin_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing cfg.bin echoue");
        }
        // Serialise en JSON via la fonction existante, puis re-parse en dict Python.
        // On passe par la string JSON que Python re-parse — plus simple et fiable
        // qu'une conversion recursive nlohmann::json -> nb::object.
        auto json_str = iecode::level5::cfgbin_to_json(*parsed);
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "data"_a, "Parse un buffer cfg.bin (T2B ou RDBN) et retourne un dict Python.");

    m.def("cfgbin_parse_file", [](const std::string& path) -> nb::dict {
        auto buf = read_file(path);
        auto span = std::span<const uint8_t>(buf);
        auto parsed = iecode::level5::cfgbin_parse(span);
        if (!parsed) {
            throw nb::value_error(("Parsing cfg.bin echoue : " + path).c_str());
        }
        auto json_str = iecode::level5::cfgbin_to_json(*parsed);
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "path"_a, "Lit et parse un fichier cfg.bin depuis un chemin.");

    // ── Crypto ───────────────────────────────────────────────────────

    m.def("crc32", [](const nb::bytes& data) -> uint32_t {
        return iecode::crypto::crc32_compute(bytes_to_span(data));
    }, "data"_a, "Calcule le CRC32 d'un buffer.");

    m.def("crc32_str", [](const std::string& s) -> uint32_t {
        return iecode::crypto::crc32_compute(std::string_view(s));
    }, "s"_a, "Calcule le CRC32 d'une chaine UTF-8.");

    m.def("cri_decrypt", [](nb::bytes data, uint32_t key) -> nb::bytes {
        // Copie les donnees, dechiffre, retourne le resultat.
        // On ne peut pas modifier nb::bytes in-place (immutable comme Python bytes).
        std::vector<uint8_t> buf(data.size());
        std::memcpy(buf.data(), data.c_str(), data.size());
        auto span = std::span<uint8_t>(buf);
        iecode::crypto::cri_decrypt(span, key);
        return vec_to_bytes(buf);
    }, "data"_a, "key"_a = uint32_t(0x1717E18E),
       "Dechiffre des donnees CRI (XOR symetrique). Retourne les bytes dechiffres.");

    m.def("cri_derive_key", [](const std::string& filename) -> uint32_t {
        return iecode::crypto::cri_derive_key(std::string_view(filename));
    }, "filename"_a, "Derive la cle CRI XOR depuis un nom de fichier.");

    m.def("cri_is_encrypted", [](const nb::bytes& data) -> bool {
        return iecode::crypto::cri_is_encrypted(bytes_to_span(data));
    }, "data"_a, "Verifie si les donnees semblent chiffrees CRI.");

    // ── Compression ──────────────────────────────────────────────────

    m.def("lz10_decompress", [](const nb::bytes& data) -> nb::bytes {
        auto result = iecode::compression::lz10_decompress(bytes_to_span(data));
        if (result.empty()) {
            throw nb::value_error("Decompression LZ10 echouee");
        }
        return vec_to_bytes(result);
    }, "data"_a, "Decompresse un buffer LZ10.");

    m.def("crilayla_decompress", [](const nb::bytes& data) -> nb::bytes {
        auto result = iecode::compression::crilayla_decompress(bytes_to_span(data));
        if (result.empty()) {
            throw nb::value_error("Decompression CRILAYLA echouee");
        }
        return vec_to_bytes(result);
    }, "data"_a, "Decompresse un buffer CRILAYLA.");

    m.def("lz4_decompress", [](const nb::bytes& data, uint32_t decompressed_size) -> nb::bytes {
        auto result = iecode::compression::lz4_decompress(bytes_to_span(data), decompressed_size);
        if (result.empty()) {
            throw nb::value_error("Decompression LZ4 echouee");
        }
        return vec_to_bytes(result);
    }, "data"_a, "decompressed_size"_a, "Decompresse un buffer LZ4 block.");

    m.def("is_lz10", [](const nb::bytes& data) -> bool {
        return iecode::compression::is_lz10(bytes_to_span(data));
    }, "data"_a, "Verifie si les donnees commencent par un header LZ10 valide.");

    // ── G4PK ────────────────────────────────────────────────────────

    m.def("g4pk_list_files", [](const std::string& path) -> nb::list {
        auto buf = read_file(path);
        auto span = std::span<const uint8_t>(buf);
        auto parsed = iecode::level5::g4pk_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing G4PK echoue");
        }
        nb::list result;
        for (const auto& entry : parsed->entries) {
            nb::dict d;
            d["name"] = entry.name;
            d["offset"] = entry.offset;
            d["size"] = entry.size;
            d["hash"] = entry.hash;
            result.append(d);
        }
        return result;
    }, "path"_a,
       "Liste les fichiers d'une archive G4PK. Retourne une liste de dicts {name, offset, size, hash}.");

    m.def("g4pk_extract", [](const std::string& path, const std::string& output_dir) -> int {
        auto buf = read_file(path);
        auto span = std::span<const uint8_t>(buf);
        auto parsed = iecode::level5::g4pk_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing G4PK echoue");
        }
        return static_cast<int>(
            iecode::level5::g4pk_extract_all(span, *parsed,
                                              std::filesystem::path(output_dir)));
    }, "path"_a, "output_dir"_a,
       "Extrait tous les fichiers d'une archive G4PK. Retourne le nombre de fichiers extraits.");

    // ── Scene formats (OBJBIN, COL, G4NV) ───────────────────────────

    m.def("objbin_parse", [](const nb::bytes& data) -> nb::dict {
        auto span = bytes_to_span(data);
        auto parsed = iecode::level5::objbin_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing OBJBIN echoue");
        }
        auto json_str = iecode::level5::objbin_to_json(*parsed);
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "data"_a,
       "Parse un buffer OBJBIN et retourne un dict {version, object_count, objects: [...]}.");

    m.def("col_parse", [](const nb::bytes& data) -> nb::dict {
        auto span = bytes_to_span(data);
        auto parsed = iecode::level5::col_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing COL echoue");
        }
        auto json_str = iecode::level5::col_to_json(*parsed);
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "data"_a,
       "Parse un buffer COL et retourne un dict {version, vertex_count, triangle_count, bbox_min, bbox_max}.");

    m.def("g4nv_parse", [](const nb::bytes& data) -> nb::dict {
        auto span = bytes_to_span(data);
        auto parsed = iecode::level5::g4nv_parse(span);
        if (!parsed) {
            throw nb::value_error("Parsing G4NV echoue");
        }
        auto json_str = iecode::level5::g4nv_to_json(*parsed);
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "data"_a,
       "Parse un buffer G4NV et retourne un dict {version, node_count, nodes: [...]}.");

    // ── Bin Dispatcher ─────────────────────────────────────────────────

    m.def("bin_inspect", [](const nb::bytes& data, const std::string& filename) -> nb::dict {
        auto span = bytes_to_span(data);
        auto result = iecode::bin_inspect(span, filename);

        nb::dict d;
        d["format"] = std::string(iecode::bin_format_name(result.format));
        d["format_id"] = static_cast<int>(result.format);
        d["was_encrypted"] = result.was_encrypted;
        d["was_compressed"] = result.was_compressed;
        if (!result.compression_type.empty()) {
            d["compression_type"] = result.compression_type;
        }
        if (!result.error.empty()) {
            d["error"] = result.error;
        }
        d["payload_size"] = result.payload.size();
        return d;
    }, "data"_a, "filename"_a = std::string(""),
       "Inspecte un buffer .bin : detecte format, dechiffre/decompresse si possible.");

    m.def("bin_dispatch", [](const std::string& path, const std::string& /*output_dir*/) -> nb::dict {
        auto buf = read_file(path);
        auto span = std::span<const uint8_t>(buf);
        auto filename = std::filesystem::path(path).filename().string();

        auto json_str = iecode::bin_dispatch_json(span, filename);

        // Re-parser le JSON en dict Python
        nb::module_ json_mod = nb::module_::import_("json");
        return nb::cast<nb::dict>(json_mod.attr("loads")(json_str));
    }, "path"_a, "output_dir"_a = std::string(""),
       "Parse un fichier .bin avec detection automatique et retourne un dict de metadonnees.");
}
