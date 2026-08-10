/// @file info_cmd.cpp
/// Commande CLI 'info' — inspection de metadata d'un fichier binaire.
///
/// Usage :
///   iecode info <file>
///
/// Detecte le format via les magic bytes, puis parse le header pour
/// extraire les metadonnees cle selon le format detecte.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/format_detector.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/formats/level5/g4sk.h"
#include "iecode/formats/level5/g4pk.h"
#include "iecode/formats/level5/g4ra.h"
#include "iecode/formats/level5/g4mt.h"
#include "iecode/formats/level5/agi.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/criware/utf_parser.h"
#include "iecode/formats/criware/usm_demuxer.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Metadata par format ────────────────────────────────────────────

static json metadata_g4tx(std::span<const uint8_t> data) {
    auto file = level5::g4tx_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    auto textures = json::array();
    for (const auto& tex : file->textures) {
        textures.push_back(json{
            {"id", tex.id},
            {"name", tex.name},
            {"width", tex.width},
            {"height", tex.height},
            {"format", static_cast<uint32_t>(tex.format)},
            {"mipCount", tex.mip_count},
            {"isDds", tex.is_dds},
            {"dataSize", tex.data.size()},
            {"subTextureCount", tex.sub_textures.size()},
        });
    }

    return json{
        {"version", file->version},
        {"textureCount", file->textures.size()},
        {"textures", std::move(textures)},
    };
}

static json metadata_g4mg(std::span<const uint8_t> data) {
    auto file = level5::g4mg_parse(data);
    if (!file) return {{"error", "parsing failed"}};

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
        {"bigEndian", file->header.is_big_endian},
    };
}

static json metadata_g4md(std::span<const uint8_t> data) {
    auto file = level5::g4md_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    return json{
        {"version", file->version},
        {"submeshCount", file->submeshes.size()},
        {"boneRefCount", file->bone_refs.size()},
        {"materialCount", file->materials.size()},
        {"bigEndian", file->header.is_big_endian},
    };
}

static json metadata_g4sk(std::span<const uint8_t> data) {
    auto file = level5::g4sk_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    auto bones_arr = json::array();
    for (const auto& bone : file->bones) {
        bones_arr.push_back(json{
            {"name", bone.name},
            {"parentIndex", bone.parent_index},
        });
    }

    return json{
        {"version", file->version},
        {"boneCount", file->bones.size()},
        {"bones", std::move(bones_arr)},
    };
}

static json metadata_g4pk(std::span<const uint8_t> data) {
    auto file = level5::g4pk_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    return json{
        {"version", file->version},
        {"entryCount", file->entries.size()},
    };
}

static json metadata_g4ra(std::span<const uint8_t> data) {
    auto file = level5::g4ra_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    return json{
        {"version", file->version},
        {"entryCount", file->entry_count},
    };
}

static json metadata_g4mt(std::span<const uint8_t> data) {
    auto file = level5::g4mt_parse(data);
    if (!file) return {{"error", "parsing failed"}};

    return json{
        {"version", file->version},
        {"entryCount", file->entry_count},
    };
}

static json metadata_utf(std::span<const uint8_t> data) {
    auto table = criware::utf_parse(data);
    if (!table) return {{"error", "parsing failed"}};

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

static json metadata_cpk(const fs::path& path) {
    // CPK necessite open() sur le fichier (pas juste un span)
    criware::CpkReader reader;
    if (!reader.open(path)) return {{"error", "cannot open CPK"}};

    const auto& entries = reader.list();
    uint64_t total_size = 0;
    uint64_t total_extract_size = 0;
    int compressed_count = 0;
    int encrypted_count = 0;

    for (const auto& e : entries) {
        total_size += e.size;
        total_extract_size += e.extract_size;
        if (e.is_compressed) ++compressed_count;
        if (e.is_encrypted) ++encrypted_count;
    }

    return json{
        {"entryCount", entries.size()},
        {"totalSize", total_size},
        {"totalExtractSize", total_extract_size},
        {"compressedEntries", compressed_count},
        {"encryptedEntries", encrypted_count},
    };
}

static json metadata_usm(std::span<const uint8_t> data) {
    auto file = criware::usm_parse_header(data);
    if (!file) return json{{"error", "USM parse failed"}};

    auto streams_arr = json::array();
    for (const auto& s : file->streams) {
        // Compter les chunks stream et le payload total
        size_t stream_chunks = 0;
        uint64_t total_payload = 0;
        for (const auto& c : s.chunks) {
            if (c.type == criware::UsmChunkType::Stream) {
                ++stream_chunks;
                total_payload += c.payload.size();
            }
        }

        json sj;
        sj["stmid"] = criware::usm_stmid_name(s.stmid);
        sj["codec"] = s.codec;
        sj["chunks"] = stream_chunks;
        sj["size"] = total_payload;
        if (s.width > 0) sj["width"] = s.width;
        if (s.height > 0) sj["height"] = s.height;
        streams_arr.push_back(std::move(sj));
    }

    return json{
        {"streamCount", file->streams.size()},
        {"streams", std::move(streams_arr)},
    };
}

static json metadata_cfgbin(std::span<const uint8_t> data) {
    auto cfg = level5::cfgbin_parse(data);
    if (!cfg) return {{"error", "parsing failed"}};

    json result;
    result["format"] = cfg->format == level5::CfgBinFile::Format::RDBN ? "RDBN" : "T2B";
    result["totalNodeCount"] = cfg->node_count();

    if (cfg->format == level5::CfgBinFile::Format::RDBN) {
        result["listCount"] = cfg->lists.size();
    } else {
        result["rootEntryCount"] = cfg->entries.size();
    }

    return result;
}

// ── Commande principale ────────────────────────────────────────────

static void cmd_info(const std::string& input_path) {
    const fs::path path(input_path);
    if (!fs::exists(path) || !fs::is_regular_file(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    const auto format = formats::detect(data);
    const auto format_str = std::string(formats::format_name(format));

    // Detecter cfg.bin par extension si format inconnu
    std::string effective_format = format_str;
    if (format == formats::FileFormat::Unknown) {
        const auto ext = path.extension().string();
        const auto stem = path.stem().string();
        if (ext == ".bin" && stem.find(".cfg") != std::string::npos) {
            effective_format = "CfgBin";
        }
    }

    // Extraire les metadata selon le format
    json metadata;
    if (format == formats::FileFormat::G4TX) {
        metadata = metadata_g4tx(data);
    } else if (format == formats::FileFormat::G4MG) {
        metadata = metadata_g4mg(data);
    } else if (format == formats::FileFormat::G4MD) {
        metadata = metadata_g4md(data);
    } else if (format == formats::FileFormat::G4SK) {
        metadata = metadata_g4sk(data);
    } else if (format == formats::FileFormat::G4PK) {
        metadata = metadata_g4pk(data);
    } else if (format == formats::FileFormat::G4RA) {
        metadata = metadata_g4ra(data);
    } else if (format == formats::FileFormat::G4MT) {
        metadata = metadata_g4mt(data);
    } else if (format == formats::FileFormat::UTF) {
        metadata = metadata_utf(data);
    } else if (format == formats::FileFormat::CPK) {
        metadata = metadata_cpk(path);
    } else if (format == formats::FileFormat::USM) {
        metadata = metadata_usm(data);
    } else if (format == formats::FileFormat::RDBN || effective_format == "CfgBin") {
        metadata = metadata_cfgbin(data);
    } else if (format == formats::FileFormat::CRILAYLA) {
        // CRILAYLA : extraire la taille decompresse depuis le header
        if (data.size() >= 16) {
            const uint32_t decomp_size = static_cast<uint32_t>(data[8]) |
                                         (static_cast<uint32_t>(data[9]) << 8) |
                                         (static_cast<uint32_t>(data[10]) << 16) |
                                         (static_cast<uint32_t>(data[11]) << 24);
            metadata = json{{"decompressedSize", decomp_size}};
        } else {
            metadata = json::object();
        }
    } else {
        metadata = json::object();
    }

    emit(json{
        {"ok", true},
        {"format", effective_format},
        {"name", path.filename().string()},
        {"size", data.size()},
        {"metadata", std::move(metadata)},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_info_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("info", "Afficher les informations d'un fichier binaire");

    static std::string input_path;

    cmd->add_option("input", input_path, "Fichier a analyser")->required();

    cmd->callback([]() { cmd_info(input_path); });
}

} // namespace iecode::cli
