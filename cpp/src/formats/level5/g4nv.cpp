/// @file g4nv.cpp
/// Implementation du parser G4NV (navigation mesh).

#include "iecode/formats/level5/g4nv_parser.h"
#include "iecode/types.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cstddef>

namespace iecode::level5 {

// ── Constantes du format ────────────────────────────────────────────

/// Header : magic(4) + version(4) + node_count(4) + edge_count(4) = 16 octets
static constexpr size_t G4NV_HEADER_SIZE = 0x10;

/// Taille d'un noeud fixe : center[3](12) + radius(4) + flags(4) = 20 octets
/// Les connexions sont stockees separement apres les noeuds.
static constexpr size_t G4NV_NODE_FIXED_SIZE = 20;

/// Taille d'un edge : from(4) + to(4) = 8 octets
static constexpr size_t G4NV_EDGE_SIZE = 8;

/// Limites raisonnables
static constexpr uint32_t G4NV_MAX_NODES = 1'000'000;
static constexpr uint32_t G4NV_MAX_EDGES = 10'000'000;

// ── Parsing ─────────────────────────────────────────────────────────

std::optional<G4nvFile> g4nv_parse(std::span<const uint8_t> data) {
    if (data.size() < G4NV_HEADER_SIZE) {
        spdlog::debug("g4nv: donnees trop petites ({} octets, minimum {})",
                      data.size(), G4NV_HEADER_SIZE);
        return std::nullopt;
    }

    const uint32_t magic = read_u32_le(data, 0x00);

    if (magic != MAGIC_G4NV) {
        spdlog::error("g4nv: magic invalide {:#010x} (attendu G4NV = {:#010x})",
                      magic, MAGIC_G4NV);
        return std::nullopt;
    }

    const uint32_t version = read_u32_le(data, 0x04);
    const uint32_t node_count = read_u32_le(data, 0x08);
    const uint32_t edge_count = read_u32_le(data, 0x0C);

    // Validation des compteurs
    if (node_count > G4NV_MAX_NODES) {
        spdlog::error("g4nv: nombre de noeuds suspect ({}, max {})",
                      node_count, G4NV_MAX_NODES);
        return std::nullopt;
    }
    if (edge_count > G4NV_MAX_EDGES) {
        spdlog::error("g4nv: nombre d'edges suspect ({}, max {})",
                      edge_count, G4NV_MAX_EDGES);
        return std::nullopt;
    }

    // Calcul des tailles
    const size_t nodes_size = static_cast<size_t>(node_count) * G4NV_NODE_FIXED_SIZE;
    const size_t edges_size = static_cast<size_t>(edge_count) * G4NV_EDGE_SIZE;
    const size_t total_needed = G4NV_HEADER_SIZE + nodes_size + edges_size;

    if (total_needed > data.size()) {
        spdlog::error("g4nv: donnees insuffisantes ({} octets, besoin {})",
                      data.size(), total_needed);
        return std::nullopt;
    }

    G4nvFile file;
    file.version = version;
    file.nodes.resize(node_count);

    // Lecture des noeuds
    size_t offset = G4NV_HEADER_SIZE;
    for (uint32_t i = 0; i < node_count; ++i) {
        auto& node = file.nodes[i];
        node.center[0] = read_f32_le(data, offset);
        node.center[1] = read_f32_le(data, offset + 4);
        node.center[2] = read_f32_le(data, offset + 8);
        node.radius = read_f32_le(data, offset + 12);
        node.flags = read_u32_le(data, offset + 16);
        offset += G4NV_NODE_FIXED_SIZE;
    }

    // Lecture des edges et construction des listes d'adjacence
    for (uint32_t i = 0; i < edge_count; ++i) {
        const uint32_t from = read_u32_le(data, offset);
        const uint32_t to = read_u32_le(data, offset + 4);

        if (from < node_count && to < node_count) {
            file.nodes[from].connections.push_back(to);
        } else {
            spdlog::warn("g4nv: edge {} reference un noeud hors limites "
                         "(from={}, to={}, max={})",
                         i, from, to, node_count);
        }
        offset += G4NV_EDGE_SIZE;
    }

    spdlog::debug("g4nv: parse OK — version={}, {} noeuds, {} edges",
                  version, node_count, edge_count);
    return file;
}

// ── Export JSON ─────────────────────────────────────────────────────

std::string g4nv_to_json(const G4nvFile& file) {
    nlohmann::json j;
    j["format"] = "G4NV";
    j["version"] = file.version;
    j["node_count"] = file.nodes.size();

    // Compter les edges totaux
    size_t total_edges = 0;
    for (const auto& node : file.nodes) {
        total_edges += node.connections.size();
    }
    j["edge_count"] = total_edges;

    auto nodes_json = nlohmann::json::array();
    for (size_t i = 0; i < file.nodes.size(); ++i) {
        const auto& node = file.nodes[i];
        nlohmann::json entry;
        entry["index"] = i;
        entry["center"] = { node.center[0], node.center[1], node.center[2] };
        entry["radius"] = node.radius;
        entry["flags"] = node.flags;
        entry["connections"] = node.connections;
        nodes_json.push_back(std::move(entry));
    }
    j["nodes"] = std::move(nodes_json);

    return j.dump(2);
}

} // namespace iecode::level5
