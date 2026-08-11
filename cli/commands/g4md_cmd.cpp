#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4md.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Helper : construit le JSON complet d'un G4MD parse ────────────

static json g4md_build_json(const std::string& input_path,
                            size_t file_size,
                            const level5::G4mdFile& parsed) {
    auto submeshes_json = json::array();
    for (const auto& sm : parsed.submeshes) {
        submeshes_json.push_back({
            {"name", sm.name},
            {"indexCount", sm.index_count},
            {"vertexCount", sm.vertex_count},
            {"materialIndex", sm.material_index},
            {"vertexFormat", fmt::format("{:#010x}", sm.vertex_format)},
            {"indexBufferOffset", sm.index_buffer_offset},
            {"indexBufferSize", sm.index_buffer_size},
            {"vertexBufferOffset", sm.vertex_buffer_offset},
        });
    }

    auto bone_refs_json = json::array();
    for (const auto& br : parsed.bone_refs) {
        bone_refs_json.push_back({
            {"boneIndex", br.bone_index},
            {"weight", br.weight},
        });
    }

    auto materials_json = json::array();
    for (const auto& mat : parsed.materials) {
        materials_json.push_back({
            {"name", mat.name},
            {"shaderHash", fmt::format("{:#010x}", mat.shader_hash)},
            {"textureHash", fmt::format("{:#010x}", mat.texture_hash)},
        });
    }

    return json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"name", fs::path(input_path).stem().string()},
        {"size", file_size},
        {"version", parsed.version},
        {"endianness", parsed.header.is_big_endian ? "big" : "little"},
        {"submeshCount", parsed.submeshes.size()},
        {"boneRefCount", parsed.bone_refs.size()},
        {"materialCount", parsed.materials.size()},
        {"header", {
            {"magic", fmt::format("{:#010x}", parsed.header.magic)},
            {"sectionBase", parsed.header.section_base},
            {"faceCount", parsed.header.face_count},
            {"boneCount", parsed.header.bone_count},
            {"vertexDataOffset", parsed.header.vertex_data_offset},
            {"boneRefOffset", parsed.header.bone_ref_offset},
            {"indexOffset", parsed.header.index_offset},
            {"headerSize", parsed.header.header_size},
            {"fileType", parsed.header.file_type},
            {"submeshCount", parsed.header.submesh_count},
            {"groupCount", parsed.header.group_count},
        }},
        {"submeshes", std::move(submeshes_json)},
        {"boneRefs", std::move(bone_refs_json)},
        {"materials", std::move(materials_json)},
    };
}

// ── Info : resume des metadonnees modele G4MD ──────────────────────

static void cmd_g4md_info(const std::string& input_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4md_parse(data);
    if (!parsed) { emit_error("G4MD parse failed"); return; }

    emit(g4md_build_json(input_path, data.size(), *parsed));
}

// ── Export : ecriture JSON dans un fichier ─────────────────────────

static void cmd_g4md_export(const std::string& input_path,
                            const std::string& output_path) {
    auto data = read_file(input_path);
    if (data.empty()) { emit_error("file not found or empty"); return; }

    auto parsed = level5::g4md_parse(data);
    if (!parsed) { emit_error("G4MD parse failed"); return; }

    auto j = g4md_build_json(input_path, data.size(), *parsed);

    // Determiner le chemin de sortie
    const fs::path out = output_path.empty()
        ? fs::path(input_path).replace_extension(".json")
        : fs::path(output_path);

    // Creer les repertoires parents si necessaire
    std::error_code ec;
    fs::create_directories(out.parent_path(), ec);

    // Ecrire le JSON avec indentation
    std::ofstream ofs(out);
    if (!ofs) {
        emit_error(fmt::format("impossible d'ecrire '{}'", out.string()));
        return;
    }

    ofs << j.dump(2);
    if (!ofs.good()) {
        emit_error(fmt::format("erreur d'ecriture vers '{}'", out.string()));
        return;
    }

    emit(json{
        {"ok", true},
        {"file", fs::path(input_path).filename().string()},
        {"output", out.string()},
        {"size", j.dump(2).size()},
    });
}

// ── Registration ────────────────────────────────────────────────────

void register_g4md_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4md", "G4MD model metadata operations (JSON output)");

    // ── g4md info ──
    auto* info_cmd = cmd->add_subcommand("info", "Parse and show G4MD metadata summary");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "G4MD file path")->required();
    info_cmd->callback([]() { cmd_g4md_info(info_input); });

    // ── g4md export ──
    auto* export_cmd = cmd->add_subcommand("export", "Export G4MD metadata to JSON file");
    static std::string export_input;
    static std::string export_output;
    export_cmd->add_option("input", export_input, "G4MD file path")->required();
    export_cmd->add_option("-o,--output", export_output,
                           "Output JSON file path (default: same name with .json extension)");
    export_cmd->callback([]() {
        cmd_g4md_export(export_input, export_output);
    });
}

} // namespace iecode::cli
