/// @file g4mg_cmd.cpp
/// Commande CLI 'g4mg' — inspection et conversion de meshes G4MG.
///
/// Sous-commandes :
///   iecode g4mg info <file>              → JSON metadata
///   iecode g4mg to-glb <file> -o <out>   → Export GLB

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/formats/level5/g4mg.h"
#include "iecode/converters/model_export.h"
#include "iecode/converters/model_import.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Sous-commande info ─────────────────────────────────────────────

static void cmd_g4mg_info(const std::string& input_path) {
    const fs::path path(input_path);
    if (!fs::exists(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    auto model = level5::g4mg_parse(data);
    if (!model) {
        emit_error(fmt::format("echec du parsing G4MG : '{}'", input_path));
        return;
    }

    // Calculer les totaux
    int total_vertices = 0;
    int total_indices = 0;
    int total_submeshes = 0;

    auto meshes_arr = json::array();
    for (const auto& mesh : model->meshes) {
        int mesh_verts = static_cast<int>(mesh.vertices.size());
        int mesh_idxs = static_cast<int>(mesh.indices.size());
        total_vertices += mesh_verts;
        total_indices += mesh_idxs;
        total_submeshes += static_cast<int>(mesh.sub_meshes.size());

        auto submeshes_arr = json::array();
        for (const auto& sm : mesh.sub_meshes) {
            submeshes_arr.push_back(json{
                {"name", sm.name},
                {"vertexCount", sm.vertex_count},
                {"indexCount", sm.index_count},
                {"materialIndex", sm.material_index},
                {"format", static_cast<uint32_t>(sm.format)},
                {"stride", level5::vertex_stride(sm.format)},
            });
        }

        meshes_arr.push_back(json{
            {"name", mesh.name},
            {"flags", mesh.flags},
            {"vertexCount", mesh_verts},
            {"indexCount", mesh_idxs},
            {"subMeshCount", mesh.sub_meshes.size()},
            {"subMeshes", std::move(submeshes_arr)},
        });
    }

    // Drapeaux de format vertex (union de tous les submeshes)
    uint32_t format_flags = 0;
    for (const auto& mesh : model->meshes) {
        for (const auto& sm : mesh.sub_meshes) {
            format_flags |= static_cast<uint32_t>(sm.format);
        }
    }

    emit(json{
        {"ok", true},
        {"format", "G4MG"},
        {"file", path.filename().string()},
        {"size", data.size()},
        {"version", model->version},
        {"header", {
            {"magic", fmt::format("0x{:08X}", model->header.magic)},
            {"headerSize", model->header.header_size},
            {"contentSize", model->header.content_size},
            {"bigEndian", model->header.is_big_endian},
        }},
        {"meshCount", model->meshes.size()},
        {"subMeshCount", total_submeshes},
        {"totalVertices", total_vertices},
        {"totalIndices", total_indices},
        {"vertexFormatFlags", fmt::format("0x{:03X}", format_flags)},
        {"meshes", std::move(meshes_arr)},
    });
}

// ── Sous-commande to-glb ───────────────────────────────────────────

static void cmd_g4mg_to_glb(const std::string& input_path,
                             const std::string& output_path) {
    const fs::path path(input_path);
    if (!fs::exists(path)) {
        emit_error(fmt::format("fichier introuvable : '{}'", input_path));
        return;
    }

    auto data = read_file(path);
    if (data.empty()) {
        emit_error(fmt::format("impossible de lire '{}'", input_path));
        return;
    }

    auto model = level5::g4mg_parse(data);
    if (!model) {
        emit_error(fmt::format("echec du parsing G4MG : '{}'", input_path));
        return;
    }

    // Determiner le chemin de sortie
    fs::path out_path;
    if (output_path.empty()) {
        out_path = path;
        out_path.replace_extension(".glb");
    } else {
        out_path = fs::path(output_path);
    }

    fs::create_directories(out_path.parent_path());

    if (!converters::export_glb(*model, out_path)) {
        emit_error(fmt::format("echec de l'export GLB vers '{}'", out_path.string()));
        return;
    }

    std::error_code ec;
    const auto out_size = fs::file_size(out_path, ec);

    emit(json{
        {"ok", true},
        {"input", path.filename().string()},
        {"output", out_path.string()},
        {"meshCount", model->meshes.size()},
        {"outputSize", ec ? 0 : out_size},
    });
}

// ── Registration ───────────────────────────────────────────────────

void register_g4mg_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("g4mg", "Inspecter ou convertir des modeles G4MG");

    // Sous-commande : info
    auto* info_cmd = cmd->add_subcommand("info", "Afficher les metadonnees d'un G4MG");
    static std::string info_input;
    info_cmd->add_option("input", info_input, "Fichier G4MG")->required();
    info_cmd->callback([]() { cmd_g4mg_info(info_input); });

    // Sous-commande : to-glb
    auto* glb_cmd = cmd->add_subcommand("to-glb", "Convertir un G4MG en fichier GLB");
    static std::string glb_input;
    static std::string glb_output;
    glb_cmd->add_option("input", glb_input, "Fichier G4MG d'entree")->required();
    glb_cmd->add_option("-o,--output", glb_output, "Fichier GLB de sortie");
    glb_cmd->callback([]() { cmd_g4mg_to_glb(glb_input, glb_output); });

    // Sous-commande : from-glb
    auto* from_glb_cmd = cmd->add_subcommand("from-glb", "Importer un GLB en fichier G4MG + G4MD");
    static std::string from_glb_input;
    static std::string from_glb_output;
    static std::string from_glb_g4md;
    from_glb_cmd->add_option("input", from_glb_input, "Fichier GLB d'entree")->required();
    from_glb_cmd->add_option("-o,--output", from_glb_output, "Fichier G4MG de sortie");
    from_glb_cmd->add_option("-m,--g4md", from_glb_g4md, "Fichier G4MD de sortie (defaut: meme nom)");
    from_glb_cmd->callback([]() {
        const fs::path in_path(from_glb_input);
        if (!fs::exists(in_path) || !fs::is_regular_file(in_path)) {
            emit_error(fmt::format("fichier introuvable : '{}'", from_glb_input));
            return;
        }

        // Chemin de sortie par defaut
        fs::path out_path;
        if (from_glb_output.empty()) {
            out_path = in_path;
            out_path.replace_extension(".g4mg");
        } else {
            out_path = fs::path(from_glb_output);
        }

        fs::path g4md_path;
        if (!from_glb_g4md.empty()) {
            g4md_path = fs::path(from_glb_g4md);
        }

        auto t0 = std::chrono::steady_clock::now();

        if (!converters::import_glb_to_g4mg(in_path, out_path, g4md_path)) {
            emit_error("echec de l'import GLB -> G4MG");
            return;
        }

        auto t1 = std::chrono::steady_clock::now();
        const auto elapsed_ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

        // Tailles de sortie
        std::error_code ec;
        const auto g4mg_size = fs::file_size(out_path, ec);
        const auto g4md_actual = g4md_path.empty()
            ? fs::path(out_path).replace_extension(".g4md")
            : g4md_path;
        const auto g4md_size = fs::file_size(g4md_actual, ec);

        emit(json{
            {"ok", true},
            {"input", in_path.filename().string()},
            {"g4mg", out_path.string()},
            {"g4md", g4md_actual.string()},
            {"g4mgSize", ec ? 0 : g4mg_size},
            {"g4mdSize", ec ? 0 : g4md_size},
            {"elapsed_ms", elapsed_ms},
        });
    });

    cmd->require_subcommand(1);
}

} // namespace iecode::cli
