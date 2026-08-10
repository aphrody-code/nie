#include "iecode/formats/criware/acb_reader.h"

#include "iecode/formats/criware/utf_parser.h"
#include "iecode/types.h"

#include <spdlog/spdlog.h>

#include <algorithm>

namespace iecode::criware {

namespace {

/// Cherche l'index d'une colonne par nom dans une table UTF.
/// @return Index de la colonne, ou -1 si non trouvee.
[[nodiscard]] int find_column(const UtfTable& table, const std::string& name) {
    for (size_t i = 0; i < table.columns.size(); ++i) {
        if (table.columns[i].name == name) {
            return static_cast<int>(i);
        }
    }
    return -1;
}

/// Extrait une valeur string d'une cellule UTF.
[[nodiscard]] std::string get_string(const UtfValue& val) {
    if (const auto* s = std::get_if<std::string>(&val)) {
        return *s;
    }
    return {};
}

/// Extrait une valeur uint32 d'une cellule UTF.
[[nodiscard]] uint32_t get_uint32(const UtfValue& val) {
    if (const auto* v = std::get_if<uint32_t>(&val)) {
        return *v;
    }
    if (const auto* v = std::get_if<uint16_t>(&val)) {
        return *v;
    }
    if (const auto* v = std::get_if<uint8_t>(&val)) {
        return *v;
    }
    return 0;
}

/// Extrait les donnees binaires (Data) d'une cellule UTF.
[[nodiscard]] std::vector<uint8_t> get_data(const UtfValue& val) {
    if (const auto* v = std::get_if<std::vector<uint8_t>>(&val)) {
        return *v;
    }
    return {};
}

/// Parse une sous-table UTF embarquee (colonne de type Data contenant une table @UTF).
[[nodiscard]] std::optional<UtfTable> parse_subtable(const UtfValue& val) {
    auto data = get_data(val);
    if (data.empty()) return std::nullopt;
    return utf_parse(data);
}

} // namespace

std::optional<AcbInfo> acb_parse(std::span<const uint8_t> data) {
    // Un ACB est une table @UTF
    auto table = utf_parse(data);
    if (!table) {
        spdlog::error("acb_parse: echec du parsing @UTF");
        return std::nullopt;
    }

    if (table->rows.empty()) {
        spdlog::error("acb_parse: table @UTF vide (aucune ligne)");
        return std::nullopt;
    }

    AcbInfo info;

    // La premiere (et generalement unique) ligne contient les metadonnees
    const auto& row = table->rows[0];

    // --- Nom du cue sheet ---
    const int name_col = find_column(*table, "Name");
    if (name_col >= 0 && static_cast<size_t>(name_col) < row.values.size()) {
        info.name = get_string(row.values[static_cast<size_t>(name_col)]);
    }

    // --- Version ---
    const int ver_col = find_column(*table, "Version");
    if (ver_col >= 0 && static_cast<size_t>(ver_col) < row.values.size()) {
        info.version = get_uint32(row.values[static_cast<size_t>(ver_col)]);
    }

    // --- AWB embarque (colonne AwbFile) ---
    const int awb_col = find_column(*table, "AwbFile");
    if (awb_col >= 0 && static_cast<size_t>(awb_col) < row.values.size()) {
        auto awb_data = get_data(row.values[static_cast<size_t>(awb_col)]);
        info.has_embedded_awb = !awb_data.empty();
    }

    // --- AWB externe (colonne StreamAwbAfs2Header) ---
    const int stream_col = find_column(*table, "StreamAwbAfs2Header");
    if (stream_col >= 0 && static_cast<size_t>(stream_col) < row.values.size()) {
        auto stream_data = get_data(row.values[static_cast<size_t>(stream_col)]);
        info.has_stream_awb = !stream_data.empty();
    }

    // --- Noms des cues (CueNameTable) ---
    const int cue_name_col = find_column(*table, "CueNameTable");
    if (cue_name_col >= 0 && static_cast<size_t>(cue_name_col) < row.values.size()) {
        auto cue_name_table = parse_subtable(row.values[static_cast<size_t>(cue_name_col)]);
        if (cue_name_table) {
            const int cn_name_col = find_column(*cue_name_table, "CueName");
            if (cn_name_col >= 0) {
                info.cue_names.reserve(cue_name_table->rows.size());
                for (const auto& cn_row : cue_name_table->rows) {
                    if (static_cast<size_t>(cn_name_col) < cn_row.values.size()) {
                        info.cue_names.push_back(
                            get_string(cn_row.values[static_cast<size_t>(cn_name_col)]));
                    }
                }
            }
        }
    }

    // --- Nombre de cues (CueTable) ---
    const int cue_col = find_column(*table, "CueTable");
    if (cue_col >= 0 && static_cast<size_t>(cue_col) < row.values.size()) {
        auto cue_table = parse_subtable(row.values[static_cast<size_t>(cue_col)]);
        if (cue_table) {
            info.cue_count = static_cast<uint32_t>(cue_table->rows.size());
        }
    }

    // Si pas de CueTable, utiliser le nombre de noms comme fallback
    if (info.cue_count == 0 && !info.cue_names.empty()) {
        info.cue_count = static_cast<uint32_t>(info.cue_names.size());
    }

    spdlog::debug("acb_parse: '{}' v{} — {} cues, embedded_awb={}, stream_awb={}",
                  info.name, info.version, info.cue_count,
                  info.has_embedded_awb, info.has_stream_awb);
    return info;
}

std::vector<uint8_t> acb_extract_awb(std::span<const uint8_t> data) {
    auto table = utf_parse(data);
    if (!table || table->rows.empty()) {
        spdlog::error("acb_extract_awb: echec du parsing @UTF");
        return {};
    }

    const auto& row = table->rows[0];
    const int awb_col = find_column(*table, "AwbFile");
    if (awb_col < 0 || static_cast<size_t>(awb_col) >= row.values.size()) {
        spdlog::warn("acb_extract_awb: colonne AwbFile introuvable");
        return {};
    }

    auto awb_data = get_data(row.values[static_cast<size_t>(awb_col)]);
    if (awb_data.empty()) {
        spdlog::warn("acb_extract_awb: AWB embarque vide ou absent");
    } else {
        spdlog::debug("acb_extract_awb: AWB embarque extrait ({} octets)", awb_data.size());
    }

    return awb_data;
}

} // namespace iecode::criware
