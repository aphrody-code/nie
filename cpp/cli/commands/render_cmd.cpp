/// @file render_cmd.cpp
/// Commandes de rendu/conversion exposant le pipeline 3D/2D : textures G4TX,
/// meshes G4MG (+ squelettes G4SK), animations G4RA et modeles de personnage
/// complets (G4MD + G4MG + G4SK + G4RA).
///
/// Usage :
///   iecode render texture <input.g4tx> [--output <out.dds>] [--info]
///   iecode render mesh    <input.g4mg> [--output <out.glb>] [--skeleton <in.g4sk>]
///   iecode render anim    <input.g4ra> [--output <out.json>] [--list]
///   iecode render model   <charaId> --data <path> [--output <dir>]

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/converters/model_export.h"
#include "iecode/converters/texture_export.h"
#include "iecode/engine/anim/anim_player.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/g4pk.h"
#include "iecode/formats/level5/g4ra.h"
#include "iecode/formats/level5/g4sk.h"
#include "iecode/formats/level5/g4tx.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <array>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Helpers de lecture ────────────────────────────────────────────────

/// Charge un fichier complet en memoire, ou retourne un vecteur vide.
static std::vector<uint8_t> slurp_file(const fs::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return {};
    const auto size = f.tellg();
    if (size <= 0) return {};
    std::vector<uint8_t> buf(static_cast<size_t>(size));
    f.seekg(0);
    f.read(reinterpret_cast<char*>(buf.data()), size);
    return buf;
}

/// Charge `{chara}.{ext}` depuis le repertoire `root` avec fallback sur
/// `{chara}.g4pkm` : si le fichier standalone est absent, parse le container
/// G4PK et extrait l'entree dont le nom se termine par `.{ext}`.
/// Retourne un vector vide si introuvable.
static std::vector<uint8_t> load_chara_asset(const fs::path& root,
                                             const std::string& chara_id,
                                             std::string_view ext) {
    // 1. Fichier standalone `{chara}.{ext}`
    const fs::path standalone = root / (chara_id + "." + std::string(ext));
    if (fs::exists(standalone)) {
        return slurp_file(standalone);
    }

    // 2. Fallback container `{chara}.g4pkm`
    const fs::path pkm = root / (chara_id + ".g4pkm");
    if (!fs::exists(pkm)) {
        return {};
    }

    auto archive = slurp_file(pkm);
    if (archive.empty()) return {};

    auto parsed = level5::g4pk_parse(std::span<const uint8_t>(archive));
    if (!parsed) return {};

    const std::string suffix = "." + std::string(ext);
    for (const auto& entry : parsed->entries) {
        if (entry.name.size() >= suffix.size() &&
            entry.name.compare(entry.name.size() - suffix.size(),
                               suffix.size(), suffix) == 0) {
            auto slice = level5::g4pk_extract_entry(
                std::span<const uint8_t>(archive), entry);
            return {slice.begin(), slice.end()};
        }
    }
    return {};
}

/// Nom de format G4txFormat en string pour l'affichage JSON.
static const char* g4tx_format_name(level5::G4txFormat fmt) noexcept {
    switch (fmt) {
        case level5::G4txFormat::BC1:   return "BC1";
        case level5::G4txFormat::BC2:   return "BC2";
        case level5::G4txFormat::BC3:   return "BC3";
        case level5::G4txFormat::BC4:   return "BC4";
        case level5::G4txFormat::BC5:   return "BC5";
        case level5::G4txFormat::BC6H:  return "BC6H";
        case level5::G4txFormat::BC7:   return "BC7";
        case level5::G4txFormat::RGBA8: return "RGBA8";
        default:                        return "Unknown";
    }
}

// ── render texture ────────────────────────────────────────────────────

static void cmd_render_texture(const std::string& input_path,
                                const std::string& output_path,
                                bool info_only) {
    if (!fs::exists(input_path)) {
        emit_error("input not found: " + input_path);
        return;
    }

    auto data = slurp_file(input_path);
    if (data.empty()) {
        emit_error("cannot read: " + input_path);
        return;
    }

    auto parsed = level5::g4tx_parse(std::span<const uint8_t>(data));
    if (!parsed) {
        emit_error("g4tx parse failed: " + input_path);
        return;
    }

    // Mode info : dump metadonnees de toutes les textures
    if (info_only || output_path.empty()) {
        json textures = json::array();
        for (size_t i = 0; i < parsed->textures.size(); ++i) {
            const auto& t = parsed->textures[i];
            textures.push_back(json{
                {"index", i},
                {"name", t.name},
                {"width", t.width},
                {"height", t.height},
                {"format", g4tx_format_name(t.format)},
                {"mipCount", t.mip_count},
                {"isDds", t.is_dds},
                {"dataSize", t.data.size()},
                {"subTextures", t.sub_textures.size()},
            });
        }
        emit(json{
            {"ok", true},
            {"input", input_path},
            {"version", parsed->version},
            {"count", parsed->textures.size()},
            {"textures", textures},
        });
        return;
    }

    // Mode export : DDS brut (premiere texture).
    if (parsed->textures.empty()) {
        emit_error("g4tx contient 0 texture");
        return;
    }

    const auto& tex = parsed->textures[0];
    const bool ok = converters::export_dds(tex, fs::path(output_path));
    emit(json{
        {"ok", ok},
        {"input", input_path},
        {"output", output_path},
        {"format", g4tx_format_name(tex.format)},
        {"width", tex.width},
        {"height", tex.height},
    });
}

// ── render mesh ───────────────────────────────────────────────────────

static void cmd_render_mesh(const std::string& input_path,
                             const std::string& output_path,
                             const std::string& skeleton_path) {
    if (!fs::exists(input_path)) {
        emit_error("input not found: " + input_path);
        return;
    }

    auto mesh_data = slurp_file(input_path);
    if (mesh_data.empty()) {
        emit_error("cannot read: " + input_path);
        return;
    }

    auto mesh = level5::g4mg_parse(std::span<const uint8_t>(mesh_data));
    if (!mesh) {
        emit_error("g4mg parse failed: " + input_path);
        return;
    }

    // Squelette optionnel — on parse seulement pour valider + inclure dans
    // les metadonnees. L'export GLB actuel n'embarque pas encore le skeleton.
    size_t bone_count = 0;
    if (!skeleton_path.empty()) {
        auto sk_data = slurp_file(skeleton_path);
        if (sk_data.empty()) {
            emit_error("cannot read skeleton: " + skeleton_path);
            return;
        }
        auto sk = level5::g4sk_parse(std::span<const uint8_t>(sk_data));
        if (!sk) {
            emit_error("g4sk parse failed: " + skeleton_path);
            return;
        }
        bone_count = sk->bones.size();
    }

    std::string out = output_path;
    if (out.empty()) {
        auto p = fs::path(input_path);
        out = (p.parent_path() / p.stem()).string() + ".glb";
    }

    const bool ok = converters::export_glb(*mesh, fs::path(out));
    emit(json{
        {"ok", ok},
        {"input", input_path},
        {"output", out},
        {"meshes", mesh->meshes.size()},
        {"skeleton", skeleton_path},
        {"bones", bone_count},
    });
}

// ── render anim ───────────────────────────────────────────────────────

static void cmd_render_anim(const std::string& input_path,
                             const std::string& output_path,
                             bool list_only) {
    if (!fs::exists(input_path)) {
        emit_error("input not found: " + input_path);
        return;
    }

    auto data = slurp_file(input_path);
    if (data.empty()) {
        emit_error("cannot read: " + input_path);
        return;
    }

    auto ra = level5::g4ra_parse(std::span<const uint8_t>(data));
    if (!ra) {
        emit_error("g4ra parse failed: " + input_path);
        return;
    }

    // Liste des entrees de l'archive G4RA
    if (list_only || output_path.empty()) {
        json entries = json::array();
        for (const auto& e : ra->entries) {
            entries.push_back(json{
                {"index", e.index},
                {"name", e.name},
                {"offset", e.offset},
                {"size", e.size},
                {"refCount", e.ref_count},
                {"flags", e.flags},
            });
        }
        emit(json{
            {"ok", true},
            {"input", input_path},
            {"version", ra->version},
            {"entryCount", ra->entry_count},
            {"entries", entries},
        });
        return;
    }

    // Export JSON du clip (keyframes TRS) si le loader AnimClip sait parser.
    auto clip = lives::AnimClip::from_g4ra(*ra);
    if (!clip) {
        emit(json{
            {"ok", false},
            {"input", input_path},
            {"error", "AnimClip::from_g4ra: keyframe format pas encore reverse"},
            {"entryCount", ra->entry_count},
        });
        return;
    }

    json tracks = json::array();
    for (const auto& tr : clip->tracks) {
        json kf = json::array();
        for (size_t i = 0; i < tr.times.size(); ++i) {
            json frame{{"t", tr.times[i]}};
            if (i < tr.positions.size()) {
                frame["p"] = {tr.positions[i].x, tr.positions[i].y, tr.positions[i].z};
            }
            if (i < tr.rotations.size()) {
                frame["r"] = {tr.rotations[i].x, tr.rotations[i].y,
                              tr.rotations[i].z, tr.rotations[i].w};
            }
            if (i < tr.scales.size()) {
                frame["s"] = {tr.scales[i].x, tr.scales[i].y, tr.scales[i].z};
            }
            kf.push_back(std::move(frame));
        }
        tracks.push_back(json{
            {"bone", tr.bone_index},
            {"keys", std::move(kf)},
        });
    }

    const json out_j{
        {"duration", clip->duration},
        {"fps", clip->fps},
        {"tracks", std::move(tracks)},
    };

    fs::create_directories(fs::path(output_path).parent_path());
    std::ofstream out(output_path);
    if (!out) {
        emit_error("cannot write: " + output_path);
        return;
    }
    out << out_j.dump(2);

    emit(json{
        {"ok", true},
        {"input", input_path},
        {"output", output_path},
        {"duration", clip->duration},
        {"trackCount", clip->tracks.size()},
    });
}

// ── render raw-mesh ───────────────────────────────────────────────────

/// Exporte un fichier g4mg brut (vertex buffer stride 32 ou 64) directement
/// en GLB, sans passer par G4MD. Les positions sont interpretees comme des
/// int16 SNORM avec un multiplicateur de 2.0/32767.0 (range ±2m).
static void cmd_render_raw_mesh(const std::string& input_path,
                                 const std::string& output_path) {
    if (!fs::exists(input_path)) {
        emit_error("input not found: " + input_path);
        return;
    }

    auto data = slurp_file(input_path);
    if (data.empty()) {
        emit_error("cannot read: " + input_path);
        return;
    }

    // Choix du stride : 32 par defaut, fallback 64.
    size_t stride = 0;
    if (data.size() % 32 == 0) {
        stride = 32;
    } else if (data.size() % 64 == 0) {
        stride = 64;
    } else {
        emit_error("file size not divisible by 32 or 64: " +
                   std::to_string(data.size()));
        return;
    }

    const size_t vertex_count = data.size() / stride;
    if (vertex_count == 0 || vertex_count > 0xFFFFFFFFu) {
        emit_error("invalid vertex count");
        return;
    }

    // Decode des positions SNORM int16 → float (range ±2m).
    constexpr float kSnormScale = 2.0f / 32767.0f;
    std::vector<float> positions(vertex_count * 3);
    for (size_t i = 0; i < vertex_count; ++i) {
        int16_t px = 0, py = 0, pz = 0;
        std::memcpy(&px, data.data() + i * stride + 0, 2);
        std::memcpy(&py, data.data() + i * stride + 2, 2);
        std::memcpy(&pz, data.data() + i * stride + 4, 2);
        positions[i * 3 + 0] = static_cast<float>(px) * kSnormScale;
        positions[i * 3 + 1] = static_cast<float>(py) * kSnormScale;
        positions[i * 3 + 2] = static_cast<float>(pz) * kSnormScale;
    }

    // Bounding box (requis par glTF pour accessor POSITION).
    float min_x = positions[0], min_y = positions[1], min_z = positions[2];
    float max_x = min_x, max_y = min_y, max_z = min_z;
    for (size_t i = 1; i < vertex_count; ++i) {
        const float x = positions[i * 3 + 0];
        const float y = positions[i * 3 + 1];
        const float z = positions[i * 3 + 2];
        if (x < min_x) min_x = x; if (x > max_x) max_x = x;
        if (y < min_y) min_y = y; if (y > max_y) max_y = y;
        if (z < min_z) min_z = z; if (z > max_z) max_z = z;
    }

    // Indices sequentiels (triangle list). Ushort si possible, sinon uint32.
    const bool use_uint32 = vertex_count > 65535;
    const size_t index_bytes = use_uint32 ? 4 : 2;
    std::vector<uint8_t> index_buf(vertex_count * index_bytes);
    if (use_uint32) {
        for (size_t i = 0; i < vertex_count; ++i) {
            const uint32_t v = static_cast<uint32_t>(i);
            std::memcpy(index_buf.data() + i * 4, &v, 4);
        }
    } else {
        for (size_t i = 0; i < vertex_count; ++i) {
            const uint16_t v = static_cast<uint16_t>(i);
            std::memcpy(index_buf.data() + i * 2, &v, 2);
        }
    }

    // Construction binary buffer : positions (float3) puis indices, aligne 4.
    const size_t pos_offset = 0;
    const size_t pos_size = positions.size() * sizeof(float);
    size_t idx_offset = pos_size;
    // Alignement 4 pour les indices (deja assure car pos_size multiple de 4).
    if (idx_offset % 4 != 0) idx_offset += 4 - (idx_offset % 4);
    const size_t idx_size = index_buf.size();
    size_t bin_size = idx_offset + idx_size;
    // Padding final 4 bytes.
    while (bin_size % 4 != 0) ++bin_size;

    std::vector<uint8_t> bin(bin_size, 0);
    std::memcpy(bin.data() + pos_offset, positions.data(), pos_size);
    std::memcpy(bin.data() + idx_offset, index_buf.data(), idx_size);

    // JSON glTF 2.0
    json gltf = {
        {"asset", {{"version", "2.0"}, {"generator", "iecode render raw-mesh"}}},
        {"scene", 0},
        {"scenes", json::array({ json{{"nodes", json::array({0})}} })},
        {"nodes", json::array({ json{{"mesh", 0}} })},
        {"meshes", json::array({
            json{
                {"primitives", json::array({
                    json{
                        {"attributes", {{"POSITION", 0}}},
                        {"indices", 1},
                        {"mode", 4},  // TRIANGLES
                    }
                })}
            }
        })},
        {"buffers", json::array({ json{{"byteLength", bin_size}} })},
        {"bufferViews", json::array({
            json{
                {"buffer", 0},
                {"byteOffset", pos_offset},
                {"byteLength", pos_size},
                {"target", 34962},  // ARRAY_BUFFER
            },
            json{
                {"buffer", 0},
                {"byteOffset", idx_offset},
                {"byteLength", idx_size},
                {"target", 34963},  // ELEMENT_ARRAY_BUFFER
            },
        })},
        {"accessors", json::array({
            json{
                {"bufferView", 0},
                {"byteOffset", 0},
                {"componentType", 5126},  // FLOAT
                {"count", vertex_count},
                {"type", "VEC3"},
                {"min", json::array({min_x, min_y, min_z})},
                {"max", json::array({max_x, max_y, max_z})},
            },
            json{
                {"bufferView", 1},
                {"byteOffset", 0},
                {"componentType", use_uint32 ? 5125 : 5123},
                {"count", vertex_count},
                {"type", "SCALAR"},
            },
        })},
    };

    std::string json_str = gltf.dump();
    // Padding JSON chunk sur 4 bytes avec des espaces.
    while (json_str.size() % 4 != 0) json_str.push_back(' ');

    const uint32_t json_chunk_len = static_cast<uint32_t>(json_str.size());
    const uint32_t bin_chunk_len = static_cast<uint32_t>(bin_size);
    const uint32_t total_len = 12 + 8 + json_chunk_len + 8 + bin_chunk_len;

    // Ecriture du GLB binaire.
    fs::path out_path(output_path);
    if (out_path.has_parent_path()) {
        fs::create_directories(out_path.parent_path());
    }
    std::ofstream out(out_path, std::ios::binary);
    if (!out) {
        emit_error("cannot write: " + output_path);
        return;
    }

    auto write_u32 = [&](uint32_t v) {
        out.write(reinterpret_cast<const char*>(&v), 4);
    };

    // Header GLB
    const uint32_t magic = 0x46546C67u;  // "glTF"
    write_u32(magic);
    write_u32(2);  // version
    write_u32(total_len);

    // JSON chunk
    write_u32(json_chunk_len);
    write_u32(0x4E4F534Au);  // "JSON"
    out.write(json_str.data(), static_cast<std::streamsize>(json_str.size()));

    // BIN chunk
    write_u32(bin_chunk_len);
    write_u32(0x004E4942u);  // "BIN\0"
    out.write(reinterpret_cast<const char*>(bin.data()),
              static_cast<std::streamsize>(bin.size()));

    out.close();

    emit(json{
        {"ok", true},
        {"vertices", vertex_count},
        {"stride", stride},
        {"output", out_path.string()},
    });
}

// ── render model ──────────────────────────────────────────────────────

static void cmd_render_model(const std::string& chara_id,
                              const std::string& data_root,
                              const std::string& output_dir) {
    if (chara_id.empty()) {
        emit_error("charaId is required");
        return;
    }
    if (data_root.empty() || !fs::exists(data_root)) {
        emit_error("--data directory not found");
        return;
    }

    const fs::path root = fs::path(data_root) / "common" / "chr" / chara_id;
    if (!fs::exists(root)) {
        emit_error("chara dir not found: " + root.string());
        return;
    }

    json report{
        {"ok", true},
        {"charaId", chara_id},
        {"root", root.string()},
    };

    // G4MD — metadonnees (fallback sur c000101.g4pkm si standalone absent)
    std::optional<level5::G4mdFile> md_opt;
    if (auto data = load_chara_asset(root, chara_id, "g4md"); !data.empty()) {
        md_opt = level5::g4md_parse(std::span<const uint8_t>(data));
        if (md_opt) {
            // Descripteur du premier submesh pour validation visuelle rapide.
            json first_sub = nullptr;
            if (!md_opt->submeshes.empty()) {
                const auto& s0 = md_opt->submeshes.front();
                first_sub = json{
                    {"vertexCount", s0.vertex_count},
                    {"indexCount", s0.index_count},
                    {"primitiveType", s0.primitive_type},
                    {"indexOffset", s0.index_offset},
                    {"materialIndex", s0.material_index},
                };
            }
            report["g4md"] = {
                {"submeshes", md_opt->submeshes.size()},
                {"materials", md_opt->materials.size()},
                {"boneRefs", md_opt->bone_refs.size()},
                {"totalVertexCount", md_opt->header.total_vertex_count},
                {"totalIndexCount", md_opt->header.total_index_count},
                {"vertexBufferSize", md_opt->header.vertex_buffer_size},
                {"indexBufferSize", md_opt->header.index_buffer_size},
                {"firstSubmesh", first_sub},
            };
        } else {
            report["g4md"] = {{"error", "parse failed"}};
        }
    }

    // G4MG — mesh principal + export GLB
    std::optional<level5::G4mgFile> mesh;
    if (auto data = load_chara_asset(root, chara_id, "g4mg"); !data.empty()) {
        mesh = level5::g4mg_parse(std::span<const uint8_t>(data));
        if (mesh) {
            json g4mg_info = {
                {"meshes", mesh->meshes.size()},
                {"version", mesh->version},
            };
            // Validation croisee avec le G4MD : le vertex_buffer_size du g4md
            // doit correspondre a la taille du buffer brut contenu dans g4mg.
            if (md_opt) {
                const size_t total_raw = mesh->raw_vertex_data.size();
                g4mg_info["rawVertexBufferSize"] = total_raw;
                g4mg_info["g4mdVertexBufferSize"] = md_opt->header.vertex_buffer_size;
                g4mg_info["vertexBufferMatches"] =
                    (total_raw == md_opt->header.vertex_buffer_size);
                if (total_raw != md_opt->header.vertex_buffer_size) {
                    spdlog::warn("render model {}: vertex buffer mismatch "
                                 "(g4mg={} vs g4md={})",
                                 chara_id, total_raw,
                                 md_opt->header.vertex_buffer_size);
                }
            }
            report["g4mg"] = g4mg_info;
        } else {
            report["g4mg"] = {{"error", "parse failed"}};
        }
    }

    // G4SK — squelette (fallback g4pkm)
    if (auto data = load_chara_asset(root, chara_id, "g4sk"); !data.empty()) {
        auto sk = level5::g4sk_parse(std::span<const uint8_t>(data));
        if (sk) {
            report["g4sk"] = {{"bones", sk->bones.size()}};
        } else {
            report["g4sk"] = {{"error", "parse failed"}};
        }
    }

    // G4RA — archive d'animations
    if (auto data = load_chara_asset(root, chara_id, "g4ra"); !data.empty()) {
        auto ra = level5::g4ra_parse(std::span<const uint8_t>(data));
        if (ra) {
            report["g4ra"] = {{"entries", ra->entry_count}};
        } else {
            report["g4ra"] = {{"error", "parse failed"}};
        }
    }

    // G4TX — textures + export DDS de chaque texture
    size_t tx_exported = 0;
    if (auto data = load_chara_asset(root, chara_id, "g4tx"); !data.empty()) {
        auto tx = level5::g4tx_parse(std::span<const uint8_t>(data));
        if (tx) {
            report["g4tx"] = {{"textures", tx->textures.size()}};
            if (!output_dir.empty()) {
                fs::create_directories(output_dir);
                for (size_t i = 0; i < tx->textures.size(); ++i) {
                    const auto& t = tx->textures[i];
                    const auto out = fs::path(output_dir) /
                        (chara_id + "_" + std::to_string(i) + ".dds");
                    if (converters::export_dds(t, out)) {
                        ++tx_exported;
                    }
                }
            }
        }
    }

    // Export GLB du mesh
    if (mesh && !output_dir.empty()) {
        fs::create_directories(output_dir);
        const auto glb_out = fs::path(output_dir) / (chara_id + ".glb");
        const bool ok = converters::export_glb(*mesh, glb_out);
        report["glbExport"] = {{"ok", ok}, {"path", glb_out.string()}};
    }

    if (!output_dir.empty()) {
        report["texturesExported"] = tx_exported;
        report["outputDir"] = output_dir;
    }

    emit(report);
}

// ── Enregistrement CLI11 ──────────────────────────────────────────────

void register_render_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("render",
        "Commandes de rendu/conversion pour le pipeline 3D/2D");
    cmd->require_subcommand(1);

    // ── render texture ───────────────────────────────────────────────
    {
        auto* sub = cmd->add_subcommand("texture",
            "Convertit un G4TX en DDS ou affiche ses metadonnees");
        static std::string input_path;
        static std::string output_path;
        static bool info_only = false;
        sub->add_option("input", input_path, "Fichier G4TX")->required();
        sub->add_option("-o,--output", output_path, "Fichier DDS de sortie");
        sub->add_flag("--info", info_only, "Affiche uniquement les metadonnees");
        sub->callback([]() {
            cmd_render_texture(input_path, output_path, info_only);
        });
    }

    // ── render mesh ──────────────────────────────────────────────────
    {
        auto* sub = cmd->add_subcommand("mesh",
            "Exporte un G4MG (+ squelette G4SK optionnel) en GLB");
        static std::string input_path;
        static std::string output_path;
        static std::string skeleton_path;
        sub->add_option("input", input_path, "Fichier G4MG")->required();
        sub->add_option("-o,--output", output_path, "Fichier GLB de sortie");
        sub->add_option("-s,--skeleton", skeleton_path, "Fichier G4SK associe");
        sub->callback([]() {
            cmd_render_mesh(input_path, output_path, skeleton_path);
        });
    }

    // ── render anim ──────────────────────────────────────────────────
    {
        auto* sub = cmd->add_subcommand("anim",
            "Liste les animations d'un G4RA ou les exporte en JSON (keyframes TRS)");
        static std::string input_path;
        static std::string output_path;
        static bool list_only = false;
        sub->add_option("input", input_path, "Fichier G4RA")->required();
        sub->add_option("-o,--output", output_path, "Fichier JSON de sortie");
        sub->add_flag("--list", list_only, "Liste uniquement les entrees");
        sub->callback([]() {
            cmd_render_anim(input_path, output_path, list_only);
        });
    }

    // ── render raw-mesh ──────────────────────────────────────────────
    {
        auto* sub = cmd->add_subcommand("raw-mesh",
            "Exporte un g4mg brut (vertex buffer SNORM int16) en GLB");
        static std::string g4mg_path;
        static std::string output_path;
        sub->add_option("--g4mg", g4mg_path, "Fichier g4mg brut")->required();
        sub->add_option("-o,--output", output_path, "Fichier GLB de sortie")->required();
        sub->callback([]() {
            cmd_render_raw_mesh(g4mg_path, output_path);
        });
    }

    // ── render model ─────────────────────────────────────────────────
    {
        auto* sub = cmd->add_subcommand("model",
            "Charge un modele de personnage complet (G4MD+G4MG+G4SK+G4RA+G4TX)");
        static std::string chara_id;
        static std::string data_root;
        static std::string output_dir;
        sub->add_option("charaId", chara_id, "Identifiant du personnage (ex: chr001)")->required();
        sub->add_option("--data", data_root, "Racine des donnees du jeu (contient common/)")->required();
        sub->add_option("-o,--output", output_dir, "Dossier de sortie pour les assets exportes");
        sub->callback([]() {
            cmd_render_model(chara_id, data_root, output_dir);
        });
    }
}

} // namespace iecode::cli
