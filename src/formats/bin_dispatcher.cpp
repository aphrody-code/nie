/// @file bin_dispatcher.cpp
/// Implementation du dispatcher intelligent pour fichiers .bin.
///
/// Algorithme de detection :
/// 1. Tenter le dechiffrement CRI (cri_derive_key depuis le filename)
/// 2. Tenter la decompression LZ10 (magic 0x11)
/// 3. Tenter la decompression CRILAYLA (magic "CRILAYLA")
/// 4. Matcher le magic sur les donnees finales

#include "iecode/formats/bin_dispatcher.h"

#include "iecode/compression/crilayla.h"
#include "iecode/compression/lz10.h"
#include "iecode/crypto/cri_crypto.h"
#include "iecode/formats/format_detector.h"
#include "iecode/formats/criware/awb_reader.h"
#include "iecode/formats/criware/utf_parser.h"
#include "iecode/formats/criware/usm_demuxer.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/g4mt.h"
#include "iecode/formats/level5/g4pk.h"
#include "iecode/formats/level5/g4ra.h"
#include "iecode/formats/level5/g4sk.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <cstring>

using json = nlohmann::json;

namespace iecode {

// ── Nom lisible des formats ──────────────────────────────────────────

std::string_view bin_format_name(BinFormat fmt) {
    switch (fmt) {
        case BinFormat::Unknown:            return "Unknown";
        case BinFormat::UtfTable:           return "UTF (@UTF)";
        case BinFormat::CfgBin:             return "CfgBin (RDBN)";
        case BinFormat::G4tx:               return "G4TX (Textures)";
        case BinFormat::G4mg:               return "G4MG (Meshes)";
        case BinFormat::G4sk:               return "G4SK (Squelette)";
        case BinFormat::G4md:               return "G4MD (Metadonnees)";
        case BinFormat::G4pk:               return "G4PK (Archive)";
        case BinFormat::G4cm:               return "G4CM (Collision)";
        case BinFormat::G4nv:               return "G4NV (Navigation)";
        case BinFormat::G4ra:               return "G4RA (Ressources)";
        case BinFormat::G4mt:               return "G4MT (Animations)";
        case BinFormat::Usm:                return "USM (Video CRI)";
        case BinFormat::Awb:                return "AWB (Audio CRI)";
        case BinFormat::Cpk:                return "CPK (Archive CRI)";
        case BinFormat::LuaBytecode:        return "Lua 5.2 Bytecode";
        case BinFormat::Lz10Compressed:     return "LZ10 Compresse";
        case BinFormat::CrilaylaCompressed: return "CRILAYLA Compresse";
        case BinFormat::CriEncrypted:       return "CRI Chiffre";
        case BinFormat::PeExecutable:       return "PE Executable";
        case BinFormat::Agi:                return "AGI (Level-5)";
    }
    return "Unknown";
}

// ── Detection du magic sur des donnees deja decodees ────────────────

/// Detecte le BinFormat a partir des magic bytes.
/// Ne gere pas les couches crypto/compression — juste le magic brut.
static BinFormat detect_magic(std::span<const uint8_t> data) {
    if (data.size() < 4) return BinFormat::Unknown;

    const uint32_t magic_be = read_u32_be(data.data());
    const uint32_t magic_le = read_u32_le(data.data());

    // CRILAYLA (8 octets)
    if (data.size() >= 8 && std::memcmp(data.data(), "CRILAYLA", 8) == 0) {
        return BinFormat::CrilaylaCompressed;
    }

    // RDBN (5 octets: "RDBNP")
    if (data.size() >= 5 && std::memcmp(data.data(), "RDBNP", 5) == 0) {
        return BinFormat::CfgBin;
    }

    // @UTF
    if (magic_be == MAGIC_UTF) return BinFormat::UtfTable;

    // AFS2 (little-endian)
    if (magic_le == MAGIC_AFS2) return BinFormat::Awb;

    // CPK
    if (magic_be == MAGIC_CPK) return BinFormat::Cpk;

    // Formats Level-5 (big-endian)
    if (magic_be == MAGIC_G4TX) return BinFormat::G4tx;
    if (magic_be == MAGIC_G4MG) return BinFormat::G4mg;
    if (magic_be == MAGIC_G4MD) return BinFormat::G4md;
    if (magic_be == MAGIC_G4SK) return BinFormat::G4sk;
    if (magic_be == MAGIC_G4PK) return BinFormat::G4pk;

    // G4MT (magic lu en little-endian: 0x544D3447)
    if (magic_le == MAGIC_G4MT) return BinFormat::G4mt;

    // G4RA ("G4RA`")
    if (data.size() >= 5 && std::memcmp(data.data(), "G4RA`", 5) == 0) {
        return BinFormat::G4ra;
    }

    // G4CM
    if (data.size() >= 4 && std::memcmp(data.data(), "G4CM", 4) == 0) {
        return BinFormat::G4cm;
    }

    // G4NV
    if (data.size() >= 4 && std::memcmp(data.data(), "G4NV", 4) == 0) {
        return BinFormat::G4nv;
    }

    // USM ("CRID")
    if (data.size() >= 4 && std::memcmp(data.data(), "CRID", 4) == 0) {
        return BinFormat::Usm;
    }

    // Lua bytecode (0x1B 'L' 'u' 'a')
    if (data.size() >= 4 &&
        data[0] == 0x1B && data[1] == 'L' && data[2] == 'u' && data[3] == 'a') {
        return BinFormat::LuaBytecode;
    }

    // PE executable (MZ header)
    if (data.size() >= 2 && data[0] == 'M' && data[1] == 'Z') {
        return BinFormat::PeExecutable;
    }

    // LZ10 (magic byte 0x11 avec taille decompressée dans les 3 octets suivants)
    if (compression::is_lz10(data)) {
        return BinFormat::Lz10Compressed;
    }

    return BinFormat::Unknown;
}

// ── Estimation d'entropie Shannon ───────────────────────────────────

/// Calcule l'entropie Shannon (bits/octet) sur les premiers N octets.
/// Utile pour estimer si les donnees sont compressees/chiffrees (entropie > 7.5).
static double compute_entropy(std::span<const uint8_t> data, size_t max_bytes = 4096) {
    if (data.empty()) return 0.0;

    const size_t n = std::min(data.size(), max_bytes);
    uint32_t freq[256] = {};

    for (size_t i = 0; i < n; ++i) {
        ++freq[data[i]];
    }

    double entropy = 0.0;
    const double dn = static_cast<double>(n);

    for (const auto f : freq) {
        if (f == 0) continue;
        const double p = static_cast<double>(f) / dn;
        entropy -= p * std::log2(p);
    }

    return entropy;
}

// ── Hex dump des premiers octets ────────────────────────────────────

/// Genere un hex dump lisible des premiers N octets.
static std::string hex_dump(std::span<const uint8_t> data, size_t max_bytes = 32) {
    const size_t n = std::min(data.size(), max_bytes);
    std::string result;
    result.reserve(n * 3);

    for (size_t i = 0; i < n; ++i) {
        if (i > 0) result += ' ';
        result += fmt::format("{:02X}", data[i]);
    }

    return result;
}

// ── Inspection principale ───────────────────────────────────────────

BinInspectResult bin_inspect(std::span<const uint8_t> data,
                              std::string_view filename) {
    BinInspectResult result;

    if (data.empty()) {
        result.format = BinFormat::Unknown;
        result.format_name = std::string(bin_format_name(BinFormat::Unknown));
        result.error = "donnees vides";
        return result;
    }

    // Copie de travail pour les transformations
    std::vector<uint8_t> working(data.begin(), data.end());

    // ── Etape 1 : Detection directe sur les donnees brutes ─────────
    auto fmt = detect_magic(working);

    // Si format deja connu (pas chiffre/compresse), retourner directement
    if (fmt != BinFormat::Unknown &&
        fmt != BinFormat::Lz10Compressed &&
        fmt != BinFormat::CrilaylaCompressed) {
        result.format = fmt;
        result.format_name = std::string(bin_format_name(fmt));
        result.payload = std::move(working);
        return result;
    }

    // ── Etape 2 : Tenter le dechiffrement CRI ─────────────────────
    // Si le magic n'est pas reconnu et qu'un filename est fourni,
    // tenter le dechiffrement CRI (XOR derive du filename).
    if (fmt == BinFormat::Unknown && !filename.empty()) {
        const uint32_t key = crypto::cri_derive_key(filename);

        // Dechiffrer une copie pour tester
        std::vector<uint8_t> decrypted(data.begin(), data.end());
        crypto::cri_decrypt(decrypted, key);

        auto decrypted_fmt = detect_magic(decrypted);
        if (decrypted_fmt != BinFormat::Unknown) {
            result.was_encrypted = true;
            working = std::move(decrypted);
            fmt = decrypted_fmt;
        }
    }

    // ── Etape 3 : Decompression LZ10 ──────────────────────────────
    if (fmt == BinFormat::Lz10Compressed || compression::is_lz10(working)) {
        auto decompressed = compression::lz10_decompress(working);
        if (!decompressed.empty()) {
            result.was_compressed = true;
            result.compression_type = "lz10";

            // Detecter le format des donnees decompressees
            auto inner_fmt = detect_magic(decompressed);
            if (inner_fmt != BinFormat::Unknown) {
                result.format = inner_fmt;
                result.format_name = std::string(bin_format_name(inner_fmt));
                result.payload = std::move(decompressed);
                return result;
            }

            // Format interne inconnu, mais on sait que c'etait du LZ10
            working = std::move(decompressed);
            fmt = detect_magic(working);
        } else if (fmt == BinFormat::Lz10Compressed) {
            // Le magic ressemblait a du LZ10 mais la decompression a echoue
            result.format = BinFormat::Lz10Compressed;
            result.format_name = std::string(bin_format_name(BinFormat::Lz10Compressed));
            result.error = "decompression LZ10 echouee";
            result.payload = std::move(working);
            return result;
        }
    }

    // ── Etape 4 : Decompression CRILAYLA ──────────────────────────
    if (fmt == BinFormat::CrilaylaCompressed || compression::is_crilayla(working)) {
        auto decompressed = compression::crilayla_decompress(working);
        if (!decompressed.empty()) {
            result.was_compressed = true;
            result.compression_type = "crilayla";

            auto inner_fmt = detect_magic(decompressed);
            if (inner_fmt != BinFormat::Unknown) {
                result.format = inner_fmt;
                result.format_name = std::string(bin_format_name(inner_fmt));
                result.payload = std::move(decompressed);
                return result;
            }

            working = std::move(decompressed);
            fmt = detect_magic(working);
        } else if (fmt == BinFormat::CrilaylaCompressed) {
            result.format = BinFormat::CrilaylaCompressed;
            result.format_name = std::string(bin_format_name(BinFormat::CrilaylaCompressed));
            result.error = "decompression CRILAYLA echouee";
            result.payload = std::move(working);
            return result;
        }
    }

    // ── Etape 5 : Re-detection finale ─────────────────────────────
    if (fmt == BinFormat::Unknown || fmt == BinFormat::Lz10Compressed ||
        fmt == BinFormat::CrilaylaCompressed) {
        fmt = detect_magic(working);
    }

    result.format = fmt;
    result.format_name = std::string(bin_format_name(fmt));
    result.payload = std::move(working);
    return result;
}

// ── Dispatch vers les parsers existants ─────────────────────────────

/// Produit le JSON de metadata pour un format donne en appelant les parsers existants.
static json dispatch_to_parser(BinFormat fmt, std::span<const uint8_t> data) {
    switch (fmt) {
        case BinFormat::UtfTable: {
            auto table = criware::utf_parse(data);
            if (!table) return {{"error", "parsing UTF echoue"}};

            auto columns = json::array();
            for (const auto& col : table->columns) {
                columns.push_back(json{
                    {"name", col.name},
                    {"type", static_cast<int>(col.type)},
                });
            }
            return json{
                {"tableName", table->name},
                {"columnCount", table->columns.size()},
                {"rowCount", table->rows.size()},
                {"columns", std::move(columns)},
            };
        }

        case BinFormat::CfgBin: {
            auto cfg = level5::cfgbin_parse(data);
            if (!cfg) return {{"error", "parsing CfgBin echoue"}};

            json r;
            r["format"] = cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B";
            r["totalNodeCount"] = cfg->node_count();
            if (cfg->format == level5::CfgBinFile::Format::RDBN) {
                r["listCount"] = cfg->lists.size();
            } else {
                r["rootEntryCount"] = cfg->entries.size();
            }
            return r;
        }

        case BinFormat::G4tx: {
            auto file = level5::g4tx_parse(data);
            if (!file) return {{"error", "parsing G4TX echoue"}};

            auto textures = json::array();
            for (const auto& tex : file->textures) {
                textures.push_back(json{
                    {"id", tex.id},
                    {"name", tex.name},
                    {"width", tex.width},
                    {"height", tex.height},
                    {"format", static_cast<uint32_t>(tex.format)},
                    {"mipCount", tex.mip_count},
                    {"dataSize", tex.data.size()},
                });
            }
            return json{
                {"version", file->version},
                {"textureCount", file->textures.size()},
                {"textures", std::move(textures)},
            };
        }

        case BinFormat::G4mg: {
            auto file = level5::g4mg_parse(data);
            if (!file) return {{"error", "parsing G4MG echoue"}};

            int total_verts = 0;
            int total_idx = 0;
            for (const auto& mesh : file->meshes) {
                total_verts += static_cast<int>(mesh.vertices.size());
                total_idx += static_cast<int>(mesh.indices.size());
            }
            return json{
                {"version", file->version},
                {"meshCount", file->meshes.size()},
                {"totalVertices", total_verts},
                {"totalIndices", total_idx},
            };
        }

        case BinFormat::G4md: {
            auto file = level5::g4md_parse(data);
            if (!file) return {{"error", "parsing G4MD echoue"}};
            return json{
                {"version", file->version},
                {"submeshCount", file->submeshes.size()},
                {"boneRefCount", file->bone_refs.size()},
                {"materialCount", file->materials.size()},
            };
        }

        case BinFormat::G4sk: {
            auto file = level5::g4sk_parse(data);
            if (!file) return {{"error", "parsing G4SK echoue"}};
            return json{
                {"version", file->version},
                {"boneCount", file->bones.size()},
            };
        }

        case BinFormat::G4pk: {
            auto file = level5::g4pk_parse(data);
            if (!file) return {{"error", "parsing G4PK echoue"}};
            return json{
                {"version", file->version},
                {"entryCount", file->entries.size()},
            };
        }

        case BinFormat::G4ra: {
            auto file = level5::g4ra_parse(data);
            if (!file) return {{"error", "parsing G4RA echoue"}};
            return json{
                {"version", file->version},
                {"entryCount", file->entry_count},
            };
        }

        case BinFormat::G4mt: {
            auto file = level5::g4mt_parse(data);
            if (!file) return {{"error", "parsing G4MT echoue"}};
            return json{
                {"version", file->version},
                {"entryCount", file->entry_count},
            };
        }

        case BinFormat::Usm: {
            auto file = criware::usm_parse_header(data);
            if (!file) return {{"error", "parsing USM echoue"}};

            auto streams = json::array();
            for (const auto& s : file->streams) {
                json sj;
                sj["stmid"] = criware::usm_stmid_name(s.stmid);
                sj["codec"] = s.codec;
                if (s.width > 0) sj["width"] = s.width;
                if (s.height > 0) sj["height"] = s.height;
                streams.push_back(std::move(sj));
            }
            return json{
                {"streamCount", file->streams.size()},
                {"streams", std::move(streams)},
            };
        }

        case BinFormat::Awb: {
            auto file = criware::awb_parse(data);
            if (!file) return {{"error", "parsing AWB echoue"}};
            return json{
                {"version", file->version},
                {"entryCount", file->entries.size()},
                {"blockSize", file->block_size},
            };
        }

        case BinFormat::LuaBytecode: {
            // Extraire les infos basiques du header Lua 5.2
            json r;
            r["type"] = "Lua 5.2 bytecode";
            if (data.size() >= 18) {
                r["luaVersion"] = fmt::format("{}.{}", data[4], data[5]);
            }
            r["size"] = data.size();
            return r;
        }

        case BinFormat::PeExecutable: {
            json r;
            r["type"] = "PE executable";
            r["size"] = data.size();
            // Lire l'offset PE header si disponible
            if (data.size() >= 64) {
                const uint32_t pe_offset = read_u32_le(data.data() + 0x3C);
                if (pe_offset + 4 <= data.size() &&
                    data[pe_offset] == 'P' && data[pe_offset + 1] == 'E') {
                    r["peOffset"] = pe_offset;
                    // Machine type
                    if (pe_offset + 6 <= data.size()) {
                        const uint16_t machine = read_u16_le(data.data() + pe_offset + 4);
                        r["machine"] = fmt::format("{:#06x}", machine);
                        if (machine == 0x8664) r["arch"] = "x86_64";
                        else if (machine == 0x014C) r["arch"] = "x86";
                        else if (machine == 0xAA64) r["arch"] = "ARM64";
                    }
                }
            }
            return r;
        }

        default:
            break;
    }

    return json::object();
}

std::string bin_dispatch_json(std::span<const uint8_t> data,
                               std::string_view filename) {
    auto inspect = bin_inspect(data, filename);

    json result;
    result["format"] = std::string(bin_format_name(inspect.format));
    result["formatId"] = static_cast<int>(inspect.format);
    result["wasEncrypted"] = inspect.was_encrypted;
    result["wasCompressed"] = inspect.was_compressed;

    if (!inspect.compression_type.empty()) {
        result["compressionType"] = inspect.compression_type;
    }

    if (!inspect.error.empty()) {
        result["error"] = inspect.error;
    }

    // Donnees effectives (apres dechiffrement/decompression)
    const auto& effective_data = inspect.payload;
    result["size"] = effective_data.size();

    if (inspect.format != BinFormat::Unknown) {
        // Parser les donnees effectives
        result["metadata"] = dispatch_to_parser(inspect.format, effective_data);
    } else {
        // Format inconnu : hex dump + entropie
        result["hexDump"] = hex_dump(effective_data);
        result["entropy"] = compute_entropy(effective_data);

        // Afficher aussi la taille originale si differente
        if (data.size() != effective_data.size()) {
            result["originalSize"] = data.size();
        }
    }

    return result.dump();
}

} // namespace iecode
