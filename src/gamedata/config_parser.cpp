#include "iecode/gamedata/config_parser.h"

#include <cstdlib>
#include <cstring>
#include <fmt/format.h>
#include <spdlog/spdlog.h>

namespace iecode::gamedata {

namespace {

// ── Chaine vide statique pour retour par reference ──────────────────
const std::string gd_config_empty_string;

} // namespace

// ── Helpers d'extraction de variables (format entries/T2B) ──────────

int32_t parse_int_var(const level5::CfgVariable& v) {
    if (v.type == level5::CfgVarType::Int) {
        if (auto* val = std::get_if<int32_t>(&v.value))
            return *val;
    }
    // Fallback : essayer aussi le type Unknown (stocke comme int32)
    if (v.type == level5::CfgVarType::Unknown) {
        if (auto* val = std::get_if<int32_t>(&v.value))
            return *val;
    }
    return 0;
}

float parse_float_var(const level5::CfgVariable& v) {
    if (v.type == level5::CfgVarType::Float) {
        if (auto* val = std::get_if<float>(&v.value))
            return *val;
    }
    return 0.0f;
}

const std::string& parse_string_var(const level5::CfgVariable& v) {
    if (v.type == level5::CfgVarType::String) {
        if (auto* val = std::get_if<std::string>(&v.value))
            return *val;
    }
    return gd_config_empty_string;
}

// ── Conversion hexadecimale ─────────────────────────────────────────

std::string to_hex(int32_t value) {
    return fmt::format("0x{:08X}", static_cast<uint32_t>(value));
}

std::string to_hex(uint32_t value) {
    return fmt::format("0x{:08X}", value);
}

int32_t from_hex(const std::string& hex) {
    if (hex.size() < 3 || (hex[0] != '0' || (hex[1] != 'x' && hex[1] != 'X'))) {
        spdlog::warn("from_hex: format invalide '{}'", hex);
        return 0;
    }
    // strtoul gere le prefixe 0x automatiquement
    unsigned long result = std::strtoul(hex.c_str(), nullptr, 16);
    return static_cast<int32_t>(result);
}

// ── Traversee de l'arbre CfgEntry ───────────────────────────────────

namespace {

/// Recherche recursive des noeuds par prefixe (interne).
void gd_config_find_by_prefix_rec(
    const std::vector<level5::CfgEntry>& entries,
    const std::string& prefix,
    std::vector<const level5::CfgEntry*>& results) {

    for (const auto& entry : entries) {
        // Verifier si le nom commence par le prefixe
        // Le nom T2B est souvent "NAME_TYPE_INDEX", on veut matcher le debut
        if (entry.name.size() >= prefix.size() &&
            entry.name.compare(0, prefix.size(), prefix) == 0) {
            results.push_back(&entry);
        }

        // Descendre dans les enfants
        if (!entry.children.empty()) {
            gd_config_find_by_prefix_rec(entry.children, prefix, results);
        }
    }
}

/// Visite recursive (interne).
void gd_config_visit_rec(
    const std::vector<level5::CfgEntry>& entries,
    const std::function<void(const level5::CfgEntry&)>& visitor) {

    for (const auto& entry : entries) {
        visitor(entry);
        if (!entry.children.empty()) {
            gd_config_visit_rec(entry.children, visitor);
        }
    }
}

} // namespace

std::vector<const level5::CfgEntry*> find_nodes_by_prefix(
    const std::vector<level5::CfgEntry>& entries,
    const std::string& prefix) {

    std::vector<const level5::CfgEntry*> results;
    gd_config_find_by_prefix_rec(entries, prefix, results);
    return results;
}

const level5::CfgEntry* find_first_node(
    const std::vector<level5::CfgEntry>& entries,
    const std::string& prefix) {

    // Recherche directe sans accumuler tous les resultats
    for (const auto& entry : entries) {
        if (entry.name.size() >= prefix.size() &&
            entry.name.compare(0, prefix.size(), prefix) == 0) {
            return &entry;
        }
        if (!entry.children.empty()) {
            const auto* found = find_first_node(entry.children, prefix);
            if (found) return found;
        }
    }
    return nullptr;
}

void visit_nodes(const std::vector<level5::CfgEntry>& entries,
                  const std::function<void(const level5::CfgEntry&)>& visitor) {
    gd_config_visit_rec(entries, visitor);
}

// ── Helpers RDBN (format lists) ─────────────────────────────────────

const level5::RdbnList* find_list(
    const level5::CfgBinFile& cfg,
    const std::string& name) {

    for (const auto& list : cfg.lists) {
        if (list.name == name)
            return &list;
    }
    return nullptr;
}

int32_t rdbn_int(const level5::RdbnField& f) {
    // Int, Flag
    if (auto* val = std::get_if<int32_t>(&f.value))
        return *val;
    // Short, ActType
    if (auto* val = std::get_if<int16_t>(&f.value))
        return static_cast<int32_t>(*val);
    // Byte
    if (auto* val = std::get_if<uint8_t>(&f.value))
        return static_cast<int32_t>(*val);
    // Bool → 0/1
    if (auto* val = std::get_if<bool>(&f.value))
        return *val ? 1 : 0;
    return 0;
}

float rdbn_float(const level5::RdbnField& f) {
    if (auto* val = std::get_if<float>(&f.value))
        return *val;
    // Fallback depuis int (parfois des floats sont stockes comme int)
    if (auto* val = std::get_if<int32_t>(&f.value))
        return static_cast<float>(*val);
    return 0.0f;
}

std::string rdbn_string(const level5::RdbnField& f) {
    // Hash ("0x..."), Condition (string)
    if (auto* val = std::get_if<std::string>(&f.value))
        return *val;
    // Int → convertir en hex (souvent un hash)
    if (auto* val = std::get_if<int32_t>(&f.value))
        return to_hex(*val);
    return {};
}

bool rdbn_bool(const level5::RdbnField& f) {
    if (auto* val = std::get_if<bool>(&f.value))
        return *val;
    // Fallback : int != 0
    if (auto* val = std::get_if<int32_t>(&f.value))
        return *val != 0;
    if (auto* val = std::get_if<uint8_t>(&f.value))
        return *val != 0;
    return false;
}

const level5::RdbnField* find_field(
    const level5::RdbnEntry& entry,
    const std::string& name) {

    for (const auto& field : entry.fields) {
        if (field.name == name)
            return &field;
    }
    return nullptr;
}

} // namespace iecode::gamedata
