/// @file playstyle_parser.cpp
/// Parser du systeme PlayStyle d'IEVR.
///
/// Lit les fichiers .cfg.bin.json pre-parses (nlohmann::json) pour
/// extraire les 5 sources de donnees playstyle et les merger dans
/// une PlaystyleDatabase unique.

#include "iecode/gamedata/playstyle_parser.h"
#include "iecode/formats/level5/cfgbin.h"

#include <algorithm>
#include <fstream>
#include <filesystem>
#include <spdlog/spdlog.h>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::gamedata {

// ── Constantes ────────────────────────────────────────────────────────

namespace {

/// Noms anglais des 6 playstyles (index = enum value).
constexpr const char* PLAYSTYLE_NAMES[] = {
    "Counter", "Bond", "Tension", "Rough Play", "Justice", "Freedom"
};

/// Noms francais des 6 playstyles.
constexpr const char* PLAYSTYLE_NAMES_FR[] = {
    "Contre", "Lien", "Tension", "Jeu violent", "Justice", "Libert\xc3\xa9"
};

/// Hashes des labels courts (TEXT_INFO 1812-1817).
constexpr int32_t LABEL_HASHES[] = {
    -1121763846,  // Counter
     233210732,   // Bond
    -242085397,   // Tension
    -216550890,   // Rough Play
    -289133215,   // Justice
    -1938598508,  // Freedom
};

/// Hashes des labels "Team Build" (TEXT_INFO 1907-1911, 2448).
constexpr int32_t TEAM_BUILD_HASHES[] = {
    -176668365,   // Counter Team Build
    -2105577051,  // Bond Team Build
     471589894,   // Tension Team Build
     1797051536,  // Rough Play Team Build
    -233470678,   // Justice Team Build
     460726303,   // Freedom Team Build
};

/// Noms d'icones par playstyle (convention interne IEVR).
constexpr const char* ICON_NAMES[] = {
    "icon_build_l02",  // Counter
    "icon_build_l03",  // Bond
    "icon_build_l04",  // Tension
    "icon_build_l05",  // Rough Play
    "icon_build_l06",  // Justice
    "icon_build_l07",  // Freedom
};

/// Valeur sentinelle "null hash" dans les T2B IEVR.
constexpr int32_t NULL_HASH = -992181094;

// ── Helpers internes ──────────────────────────────────────────────────

/// Charge un fichier JSON depuis le disque. Accepte :
///  - .cfg.bin.json : fichier JSON pre-genere (ancien workflow)
///  - .cfg.bin      : parsing direct via cfgbin_parse() puis conversion JSON
std::optional<json> ps_load_json(const fs::path& path) {
    if (!fs::exists(path)) {
        spdlog::debug("playstyle: fichier introuvable '{}'", path.string());
        return std::nullopt;
    }

    const auto name = path.filename().string();
    const bool is_binary = name.ends_with(".cfg.bin");

    if (is_binary) {
        // Parse direct du binaire — reproduit la structure JSON attendue.
        std::ifstream bf(path, std::ios::binary | std::ios::ate);
        if (!bf) { spdlog::warn("playstyle: impossible d'ouvrir '{}'", path.string()); return std::nullopt; }
        const auto sz = bf.tellg();
        bf.seekg(0);
        std::vector<uint8_t> buf(static_cast<size_t>(sz));
        bf.read(reinterpret_cast<char*>(buf.data()), sz);

        auto cfg = level5::cfgbin_parse(buf);
        if (!cfg) { spdlog::warn("playstyle: echec parsing cfg.bin '{}'", path.string()); return std::nullopt; }
        try {
            return json::parse(level5::cfgbin_to_json(*cfg));
        } catch (const json::parse_error& e) {
            spdlog::warn("playstyle: erreur JSON (cfgbin) '{}': {}", path.string(), e.what());
            return std::nullopt;
        }
    }

    std::ifstream f(path);
    if (!f) {
        spdlog::warn("playstyle: impossible d'ouvrir '{}'", path.string());
        return std::nullopt;
    }

    try {
        json j;
        f >> j;
        return j;
    } catch (const json::parse_error& e) {
        spdlog::warn("playstyle: erreur JSON dans '{}': {}", path.string(), e.what());
        return std::nullopt;
    }
}

/// Cherche un fichier dans un repertoire par prefixe. Accepte en priorite
/// un .cfg.bin.json (workflow legacy) puis a defaut un .cfg.bin (parsing direct).
/// Retourne le fichier avec le nom le plus grand (version la plus recente).
fs::path ps_find_json_file(const fs::path& dir, const std::string& prefix) {
    if (!fs::exists(dir) || !fs::is_directory(dir)) return {};

    fs::path best_json;
    std::string best_json_name;
    fs::path best_bin;
    std::string best_bin_name;

    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        if (!entry.is_regular_file()) continue;
        const auto name = entry.path().filename().string();
        if (!name.starts_with(prefix)) continue;

        if (name.ends_with(".cfg.bin.json")) {
            if (best_json.empty() || name > best_json_name) {
                best_json = entry.path();
                best_json_name = name;
            }
        } else if (name.ends_with(".cfg.bin")) {
            if (best_bin.empty() || name > best_bin_name) {
                best_bin = entry.path();
                best_bin_name = name;
            }
        }
    }
    if (!best_json.empty()) return best_json;
    return best_bin;
}

/// Extrait un int depuis un objet JSON variable T2B {"type":"Int","value":"123"}.
int32_t ps_t2b_int(const json& var) {
    if (!var.contains("value")) return 0;
    const auto& val = var["value"];
    if (val.is_number_integer()) return val.get<int32_t>();
    if (val.is_string()) {
        try { return std::stoi(val.get<std::string>()); }
        catch (...) { return 0; }
    }
    return 0;
}

/// Extrait une string depuis un objet JSON variable T2B.
std::string ps_t2b_string(const json& var) {
    if (!var.contains("value")) return {};
    const auto& val = var["value"];
    if (val.is_string()) return val.get<std::string>();
    return {};
}

// ── 1. Extraction labels ──────────────────────────────────────────────

/// Construit les 6 labels statiquement (avec hashes connus).
/// Les textes sont en dur car ils sont stables et connus.
void ps_extract_labels(PlaystyleDatabase& db) {
    db.labels.reserve(6);

    for (int i = 0; i < 6; ++i) {
        PlaystyleLabel label;
        label.index           = i;
        label.en              = PLAYSTYLE_NAMES[i];
        label.fr              = PLAYSTYLE_NAMES_FR[i];
        label.icon            = ICON_NAMES[i];
        label.hash_label      = LABEL_HASHES[i];
        label.hash_team_build = TEAM_BUILD_HASHES[i];

        // Noms Team Build en dur
        label.team_build_en = std::string(PLAYSTYLE_NAMES[i]) + " Team Build";
        label.team_build_fr = [i]() -> std::string {
            switch (i) {
                case 0: return "Style Contre";
                case 1: return "Style Lien";
                case 2: return "Style Tension";
                case 3: return "Style Violent";
                case 4: return "Style Justice";
                case 5: return "Style d'\xc3\xa9quipe libert\xc3\xa9";
                default: return {};
            }
        }();

        db.labels.push_back(std::move(label));
    }
}

/// Surcharge les labels en lisant les fichiers menu_text si disponibles.
/// Permet de corriger les textes si le jeu est mis a jour.
void ps_extract_labels_from_text(const fs::path& data_root, PlaystyleDatabase& db) {
    // Lire les menu_text EN et FR
    for (const auto& locale : {"en", "fr"}) {
        const auto text_dir = data_root / "common" / "text" / locale;
        auto path = ps_find_json_file(text_dir, "menu_text");
        if (path.empty()) continue;

        auto j = ps_load_json(path);
        if (!j) continue;

        // Construire un map hash → texte
        std::unordered_map<int32_t, std::string> hash_to_text;

        for (const auto& entry : j->value("entries", json::array())) {
            for (const auto& child : entry.value("children", json::array())) {
                const auto& vars = child.value("variables", json::array());
                if (vars.size() < 3) continue;
                if (vars[0].value("type", "") != "Int") continue;
                if (vars[2].value("type", "") != "String") continue;

                int32_t hash = ps_t2b_int(vars[0]);
                std::string text = ps_t2b_string(vars[2]);
                if (!text.empty()) {
                    hash_to_text[hash] = std::move(text);
                }
            }
        }

        // Appliquer aux labels
        const bool is_en = std::string(locale) == "en";
        for (auto& label : db.labels) {
            // Label court
            if (auto it = hash_to_text.find(label.hash_label); it != hash_to_text.end()) {
                if (is_en) label.en = it->second;
                else       label.fr = it->second;
            }
            // Label Team Build
            if (auto it = hash_to_text.find(label.hash_team_build); it != hash_to_text.end()) {
                if (is_en) label.team_build_en = it->second;
                else       label.team_build_fr = it->second;
            }
        }

        spdlog::debug("playstyle: {} labels surcharges depuis menu_text ({})",
                       hash_to_text.size(), locale);
    }
}

// ── 2. Distribution depuis chara_param ────────────────────────────────

void ps_extract_distribution(const fs::path& data_root, PlaystyleDatabase& db) {
    const auto char_dir = data_root / "common" / "gamedata" / "character";
    auto path = ps_find_json_file(char_dir, "chara_param_1");
    if (path.empty()) {
        // Fallback : chercher chara_param sans suffixe de version
        path = ps_find_json_file(char_dir, "chara_param");
        // Exclure chara_param_table
        if (!path.empty() && path.filename().string().find("chara_param_table") != std::string::npos) {
            path.clear();
        }
    }
    if (path.empty()) {
        spdlog::warn("playstyle: fichier chara_param introuvable dans '{}'", char_dir.string());
        return;
    }

    auto j = ps_load_json(path);
    if (!j) return;

    // Compter les playstyles depuis les entries T2B
    int32_t counts[6] = {};
    int32_t total = 0;

    for (const auto& entry : j->value("entries", json::array())) {
        for (const auto& child : entry.value("children", json::array())) {
            const auto& name = child.value("name", "");
            // Matcher CHARA_PARAM_INFO_N, ignorer LIST/BEG/END
            if (name.find("CHARA_PARAM_INFO_") == std::string::npos) continue;
            if (name.find("LIST") != std::string::npos) continue;
            if (name.find("BEG") != std::string::npos) continue;
            if (name.find("END") != std::string::npos) continue;

            const auto& vars = child.value("variables", json::array());
            if (vars.size() < 6) continue;

            int32_t ps = ps_t2b_int(vars[5]);
            if (ps >= 0 && ps < 6) {
                counts[ps]++;
                total++;
            }
        }
    }

    // Remplir la distribution
    for (int i = 0; i < 6; ++i) {
        db.distribution[PLAYSTYLE_NAMES[i]] = counts[i];
    }
    db.total_characters = total;

    spdlog::info("playstyle: distribution extraite — {} personnages, {} playstyles",
                 total, 6);
}

// ── 3. Table config depuis chara_param_table_config ───────────────────

/// Helper generique pour extraire une liste PlayStyleList depuis le JSON RDBN.
void ps_extract_playstyle_list(const json& lists,
                                const std::string& list_name,
                                std::vector<PlaystyleTableEntry>& out) {
    for (const auto& list : lists) {
        if (list.value("name", "") != list_name) continue;

        for (const auto& val : list.value("values", json::array())) {
            PlaystyleTableEntry e;
            e.play_style = val.value("playStyle", 0);
            const auto& data = val.value("data", json::array());
            if (data.size() >= 2) {
                e.offset = data[0].get<int32_t>();
                e.count  = data[1].get<int32_t>();
            }
            out.push_back(e);
        }
        return;
    }
}

/// Extrait les donnees preset (7x3 stats min/max/max2).
void ps_extract_preset_data(const json& lists,
                             std::vector<PlaystylePresetData>& out) {
    for (const auto& list : lists) {
        if (list.value("name", "") != "m_charaParamPresetTableParamList") continue;

        for (const auto& val : list.value("values", json::array())) {
            PlaystylePresetData d;
            d.param_min_kick         = val.value("param_min_kick", 0);
            d.param_min_control      = val.value("param_min_control", 0);
            d.param_min_technic      = val.value("param_min_technic", 0);
            d.param_min_pressure     = val.value("param_min_pressure", 0);
            d.param_min_physical     = val.value("param_min_physical", 0);
            d.param_min_agility      = val.value("param_min_agility", 0);
            d.param_min_intelligence = val.value("param_min_intelligence", 0);
            d.param_max_kick         = val.value("param_max_kick", 0);
            d.param_max_control      = val.value("param_max_control", 0);
            d.param_max_technic      = val.value("param_max_technic", 0);
            d.param_max_pressure     = val.value("param_max_pressure", 0);
            d.param_max_physical     = val.value("param_max_physical", 0);
            d.param_max_agility      = val.value("param_max_agility", 0);
            d.param_max_intelligence = val.value("param_max_intelligence", 0);
            d.param_max2_kick         = val.value("param_max2_kick", 0);
            d.param_max2_control      = val.value("param_max2_control", 0);
            d.param_max2_technic      = val.value("param_max2_technic", 0);
            d.param_max2_pressure     = val.value("param_max2_pressure", 0);
            d.param_max2_physical     = val.value("param_max2_physical", 0);
            d.param_max2_agility      = val.value("param_max2_agility", 0);
            d.param_max2_intelligence = val.value("param_max2_intelligence", 0);
            out.push_back(d);
        }
        return;
    }
}

/// Extrait les donnees de personnalite.
void ps_extract_personality_data(const json& lists,
                                  std::vector<PlaystylePersonalityData>& out) {
    for (const auto& list : lists) {
        if (list.value("name", "") != "m_charaParamPersonalityTableDataList") continue;

        for (const auto& val : list.value("values", json::array())) {
            PlaystylePersonalityData d;
            d.param_min_kick         = val.value("param_min_kick", 0);
            d.param_min_control      = val.value("param_min_control", 0);
            d.param_min_technic      = val.value("param_min_technic", 0);
            d.param_min_pressure     = val.value("param_min_pressure", 0);
            d.param_min_physical     = val.value("param_min_physical", 0);
            d.param_min_agility      = val.value("param_min_agility", 0);
            d.param_min_intelligence = val.value("param_min_intelligence", 0);
            d.param_max_kick         = val.value("param_max_kick", 0);
            d.param_max_control      = val.value("param_max_control", 0);
            d.param_max_technic      = val.value("param_max_technic", 0);
            d.param_max_pressure     = val.value("param_max_pressure", 0);
            d.param_max_physical     = val.value("param_max_physical", 0);
            d.param_max_agility      = val.value("param_max_agility", 0);
            d.param_max_intelligence = val.value("param_max_intelligence", 0);
            out.push_back(d);
        }
        return;
    }
}

/// Extrait les multiplicateurs add_rate.
void ps_extract_add_rate_data(const json& lists,
                               std::vector<PlaystyleAddRateData>& out) {
    for (const auto& list : lists) {
        if (list.value("name", "") != "m_charaParamAddRateTableDataList") continue;

        for (const auto& val : list.value("values", json::array())) {
            PlaystyleAddRateData d;
            d.param_kick         = val.value("param_kick", 0.0f);
            d.param_control      = val.value("param_control", 0.0f);
            d.param_technic      = val.value("param_technic", 0.0f);
            d.param_pressure     = val.value("param_pressure", 0.0f);
            d.param_physical     = val.value("param_physical", 0.0f);
            d.param_agility      = val.value("param_agility", 0.0f);
            d.param_intelligence = val.value("param_intelligence", 0.0f);
            out.push_back(d);
        }
        return;
    }
}

void ps_extract_table_config(const fs::path& data_root, PlaystyleDatabase& db) {
    const auto char_dir = data_root / "common" / "gamedata" / "character";
    auto path = ps_find_json_file(char_dir, "chara_param_table_config");
    if (path.empty()) {
        spdlog::warn("playstyle: chara_param_table_config introuvable");
        return;
    }

    auto j = ps_load_json(path);
    if (!j) return;

    const auto& lists = j->value("lists", json::array());

    // Extraire les index par playstyle
    ps_extract_playstyle_list(lists, "m_charaParamPresetTablePlayStyleList",
                               db.table_config.preset);
    ps_extract_playstyle_list(lists, "m_charaParamPersonalityTablePlayStyleList",
                               db.table_config.personality);
    ps_extract_playstyle_list(lists, "m_charaParamAddRateTablePlayStyleList",
                               db.table_config.add_rate);

    // Extraire les donnees sous-jacentes
    ps_extract_preset_data(lists, db.table_config.preset_data);
    ps_extract_personality_data(lists, db.table_config.personality_data);
    ps_extract_add_rate_data(lists, db.table_config.add_rate_data);

    spdlog::info("playstyle: table_config — {} preset, {} personality, {} add_rate entries",
                 db.table_config.preset.size(),
                 db.table_config.personality.size(),
                 db.table_config.add_rate.size());
}

// ── 4. Growth table Lv1 depuis growth_table_config ────────────────────

void ps_extract_growth_table(const fs::path& data_root, PlaystyleDatabase& db) {
    const auto char_dir = data_root / "common" / "gamedata" / "character";
    auto path = ps_find_json_file(char_dir, "growth_table_config");
    if (path.empty()) {
        spdlog::warn("playstyle: growth_table_config introuvable");
        return;
    }

    auto j = ps_load_json(path);
    if (!j) return;

    const auto& lists = j->value("lists", json::array());

    for (const auto& list : lists) {
        if (list.value("name", "") != "m_growthTableLv1List") continue;

        for (const auto& val : list.value("values", json::array())) {
            PlaystyleGrowthEntry e;
            e.main_position = val.value("mainPosition", 0);
            e.sub_position  = val.value("subPosition", 0);
            e.play_style    = val.value("playStyle", 0);
            e.kick          = val.value("Kc_1", 0);
            e.control       = val.value("Cr_1", 0);
            e.technique     = val.value("Tc_1", 0);
            e.pressure      = val.value("Pr_1", 0);
            e.physical      = val.value("Ps_1", 0);
            e.agility       = val.value("Ag_1", 0);
            e.intelligence  = val.value("It_1", 0);
            db.growth_table_lv1.push_back(e);
        }
        break;
    }

    spdlog::info("playstyle: growth_table_lv1 — {} entrees", db.growth_table_lv1.size());
}

// ── 5. Team Build depuis team_build_config ────────────────────────────

void ps_extract_team_build(const fs::path& data_root, PlaystyleDatabase& db) {
    const auto skill_dir = data_root / "common" / "gamedata" / "skill";
    auto path = ps_find_json_file(skill_dir, "team_build_config");
    if (path.empty()) {
        spdlog::warn("playstyle: team_build_config introuvable");
        return;
    }

    auto j = ps_load_json(path);
    if (!j) return;

    auto& tb = db.team_build;

    for (const auto& entry : j->value("entries", json::array())) {
        const auto& entry_name = entry.value("name", "");
        const auto& children = entry.value("children", json::array());

        // ── TEAM_BUILD_EFFECT_DATA ──
        if (entry_name.find("TEAM_BUILD_EFFECT_DATA_LIST") != std::string::npos) {
            int32_t idx = 0;
            for (const auto& child : children) {
                const auto& cname = child.value("name", "");
                if (cname.find("TEAM_BUILD_EFFECT_DATA_") == std::string::npos) continue;
                if (cname.find("LIST") != std::string::npos) continue;
                if (cname.find("BEG") != std::string::npos) continue;

                const auto& vars = child.value("variables", json::array());
                if (vars.size() < 3) continue;

                PlaystyleTeamBuildEffect d;
                d.id          = idx++;
                d.hash_1      = ps_t2b_int(vars[0]);
                d.sub_id      = ps_t2b_int(vars[1]);
                d.effect_type = ps_t2b_int(vars[2]);

                // Hashes d'effets (vars[3..])
                for (size_t i = 3; i < vars.size(); ++i) {
                    d.effect_hashes.push_back(ps_t2b_int(vars[i]));
                }

                tb.effect_data.push_back(std::move(d));
            }
        }

        // ── TEAM_BUILD_EFFECT_INFO ──
        else if (entry_name.find("TEAM_BUILD_EFFECT_INFO_LIST") != std::string::npos) {
            // Les children alternent EFFECT_INFO_N et REF_EFFECT_DATA_N
            TeamBuildEffectInfo current;
            bool has_current = false;

            for (const auto& child : children) {
                const auto& cname = child.value("name", "");
                const auto& vars = child.value("variables", json::array());

                if (cname.find("TEAM_BUILD_EFFECT_INFO_REF_EFFECT_DATA_") != std::string::npos) {
                    // Reference vers effect_data
                    if (has_current && vars.size() >= 2) {
                        current.ref_offset = ps_t2b_int(vars[0]);
                        current.ref_count  = ps_t2b_int(vars[1]);
                        tb.effect_info.push_back(current);
                        has_current = false;
                    }
                }
                else if (cname.find("TEAM_BUILD_EFFECT_INFO_") != std::string::npos &&
                         cname.find("LIST") == std::string::npos &&
                         cname.find("BEG") == std::string::npos) {
                    // Nouvelle info
                    if (has_current) {
                        // Pas de REF suivant — pousser quand meme
                        tb.effect_info.push_back(current);
                    }
                    current = {};
                    if (!vars.empty()) {
                        current.info_id = ps_t2b_int(vars[0]);
                    }
                    has_current = true;
                }
            }
            // Dernier element sans REF
            if (has_current) {
                tb.effect_info.push_back(current);
            }
        }

        // ── TEAM_BUILD_UP_DATA ──
        else if (entry_name.find("TEAM_BUILD_UP_DATA_LIST") != std::string::npos) {
            for (const auto& child : children) {
                const auto& cname = child.value("name", "");
                if (cname.find("TEAM_BUILD_UP_DATA_") == std::string::npos) continue;
                if (cname.find("LIST") != std::string::npos) continue;
                if (cname.find("BEG") != std::string::npos) continue;

                const auto& vars = child.value("variables", json::array());
                if (vars.empty()) continue;

                TeamBuildUpData d;
                d.up_id = ps_t2b_int(vars[0]);
                if (vars.size() >= 2) d.threshold    = ps_t2b_int(vars[1]);
                if (vars.size() >= 3) d.effect_count = ps_t2b_int(vars[2]);

                // Brutes completes
                for (const auto& v : vars) {
                    d.raw.push_back(ps_t2b_int(v));
                }

                tb.up_data.push_back(std::move(d));
            }
        }

        // ── TEAM_BUILD_DOWN_DATA ──
        else if (entry_name.find("TEAM_BUILD_DOWN_DATA_LIST") != std::string::npos) {
            for (const auto& child : children) {
                const auto& cname = child.value("name", "");
                if (cname.find("TEAM_BUILD_DOWN_DATA_") == std::string::npos) continue;
                if (cname.find("LIST") != std::string::npos) continue;
                if (cname.find("BEG") != std::string::npos) continue;

                const auto& vars = child.value("variables", json::array());
                if (vars.empty()) continue;

                TeamBuildDownData d;
                d.down_id = ps_t2b_int(vars[0]);
                if (vars.size() >= 2) d.threshold    = ps_t2b_int(vars[1]);
                if (vars.size() >= 3) d.effect_count = ps_t2b_int(vars[2]);

                for (const auto& v : vars) {
                    d.raw.push_back(ps_t2b_int(v));
                }

                tb.down_data.push_back(std::move(d));
            }
        }

        // ── TEAM_BUILD_INFO ──
        else if (entry_name.find("TEAM_BUILD_INFO_LIST") != std::string::npos) {
            // Children : INFO_N, REF_UP_DATA_N, REF_DOWN_DATA_N, REF_EFFECT_INFO_N
            TeamBuildInfo current;
            bool has_current = false;
            [[maybe_unused]] int ref_phase = 0; // 0=attente, 1=up, 2=down, 3=effect

            for (const auto& child : children) {
                const auto& cname = child.value("name", "");
                const auto& vars = child.value("variables", json::array());

                if (cname.find("TEAM_BUILD_INFO_REF_UP_DATA_") != std::string::npos) {
                    if (has_current && vars.size() >= 2) {
                        current.ref_up_offset = ps_t2b_int(vars[0]);
                        current.ref_up_count  = ps_t2b_int(vars[1]);
                        ref_phase = 1;
                    }
                }
                else if (cname.find("TEAM_BUILD_INFO_REF_DOWN_DATA_") != std::string::npos) {
                    if (has_current && vars.size() >= 2) {
                        current.ref_down_offset = ps_t2b_int(vars[0]);
                        current.ref_down_count  = ps_t2b_int(vars[1]);
                        ref_phase = 2;
                    }
                }
                else if (cname.find("TEAM_BUILD_INFO_REF_EFFECT_INFO_") != std::string::npos) {
                    if (has_current && vars.size() >= 2) {
                        current.ref_effect_offset = ps_t2b_int(vars[0]);
                        current.ref_effect_count  = ps_t2b_int(vars[1]);
                        ref_phase = 3;
                        // Apres la derniere ref, pousser
                        tb.info.push_back(current);
                        has_current = false;
                        ref_phase = 0;
                    }
                }
                else if (cname.find("TEAM_BUILD_INFO_") != std::string::npos &&
                         cname.find("LIST") == std::string::npos &&
                         cname.find("BEG") == std::string::npos &&
                         cname.find("REF") == std::string::npos) {
                    // Nouvel INFO — si un precedent n'a pas ete pousse, le pousser
                    if (has_current) {
                        tb.info.push_back(current);
                    }
                    current = {};
                    if (vars.size() >= 1) current.play_style_index = ps_t2b_int(vars[0]);
                    if (vars.size() >= 2) current.level = ps_t2b_int(vars[1]);
                    has_current = true;
                    ref_phase = 0;
                }
            }
            // Dernier element
            if (has_current) {
                tb.info.push_back(current);
            }
        }
    }

    spdlog::info("playstyle: team_build — {} effect_data, {} effect_info, {} up, {} down, {} info",
                 tb.effect_data.size(), tb.effect_info.size(),
                 tb.up_data.size(), tb.down_data.size(), tb.info.size());
}

} // namespace anonyme

// ── API publique ──────────────────────────────────────────────────────

const char* playstyle_name(PlayStyle ps) noexcept {
    const auto idx = static_cast<uint8_t>(ps);
    if (idx < 6) return PLAYSTYLE_NAMES[idx];
    return "Unknown";
}

std::optional<PlaystyleDatabase> parse_playstyle_system(const fs::path& data_root) {
    if (!fs::exists(data_root)) {
        spdlog::error("playstyle: data_root introuvable: {}", data_root.string());
        return std::nullopt;
    }

    PlaystyleDatabase db;

    // 1. Labels (statiques + surcharge depuis les textes du jeu)
    ps_extract_labels(db);
    ps_extract_labels_from_text(data_root, db);

    // 2. Distribution depuis chara_param
    ps_extract_distribution(data_root, db);

    // 3. Table config depuis chara_param_table_config
    ps_extract_table_config(data_root, db);

    // 4. Growth table Lv1 depuis growth_table_config
    ps_extract_growth_table(data_root, db);

    // 5. Team Build depuis team_build_config
    ps_extract_team_build(data_root, db);

    spdlog::info("playstyle: parsing complet — {} labels, {} total chars, {} growth entries, {} team_build info",
                 db.labels.size(), db.total_characters,
                 db.growth_table_lv1.size(), db.team_build.info.size());

    return db;
}

// ── Serialisation JSON ────────────────────────────────────────────────

nlohmann::json playstyle_to_json(const PlaystyleDatabase& db) {
    json result;

    // Labels
    {
        auto arr = json::array();
        for (const auto& l : db.labels) {
            arr.push_back(json{
                {"index",           l.index},
                {"en",              l.en},
                {"fr",              l.fr},
                {"icon",            l.icon},
                {"team_build_en",   l.team_build_en},
                {"team_build_fr",   l.team_build_fr},
                {"hash_label",      l.hash_label},
                {"hash_team_build", l.hash_team_build},
            });
        }
        result["labels"] = std::move(arr);
    }

    // Distribution
    result["distribution"] = db.distribution;
    result["total_characters"] = db.total_characters;

    // Table config
    {
        json tc;

        // Preset index
        {
            auto arr = json::array();
            for (const auto& e : db.table_config.preset) {
                arr.push_back(json{
                    {"play_style", e.play_style},
                    {"offset",     e.offset},
                    {"count",      e.count},
                });
            }
            tc["preset"] = std::move(arr);
        }

        // Personality index
        {
            auto arr = json::array();
            for (const auto& e : db.table_config.personality) {
                arr.push_back(json{
                    {"play_style", e.play_style},
                    {"offset",     e.offset},
                    {"count",      e.count},
                });
            }
            tc["personality"] = std::move(arr);
        }

        // Add rate index
        {
            auto arr = json::array();
            for (const auto& e : db.table_config.add_rate) {
                arr.push_back(json{
                    {"play_style", e.play_style},
                    {"offset",     e.offset},
                    {"count",      e.count},
                });
            }
            tc["add_rate"] = std::move(arr);
        }

        // Preset data
        {
            auto arr = json::array();
            for (const auto& d : db.table_config.preset_data) {
                arr.push_back(json{
                    {"min", {
                        {"kick", d.param_min_kick}, {"control", d.param_min_control},
                        {"technic", d.param_min_technic}, {"pressure", d.param_min_pressure},
                        {"physical", d.param_min_physical}, {"agility", d.param_min_agility},
                        {"intelligence", d.param_min_intelligence},
                    }},
                    {"max", {
                        {"kick", d.param_max_kick}, {"control", d.param_max_control},
                        {"technic", d.param_max_technic}, {"pressure", d.param_max_pressure},
                        {"physical", d.param_max_physical}, {"agility", d.param_max_agility},
                        {"intelligence", d.param_max_intelligence},
                    }},
                    {"max2", {
                        {"kick", d.param_max2_kick}, {"control", d.param_max2_control},
                        {"technic", d.param_max2_technic}, {"pressure", d.param_max2_pressure},
                        {"physical", d.param_max2_physical}, {"agility", d.param_max2_agility},
                        {"intelligence", d.param_max2_intelligence},
                    }},
                });
            }
            tc["preset_data"] = std::move(arr);
        }

        // Personality data
        {
            auto arr = json::array();
            for (const auto& d : db.table_config.personality_data) {
                arr.push_back(json{
                    {"min", {
                        {"kick", d.param_min_kick}, {"control", d.param_min_control},
                        {"technic", d.param_min_technic}, {"pressure", d.param_min_pressure},
                        {"physical", d.param_min_physical}, {"agility", d.param_min_agility},
                        {"intelligence", d.param_min_intelligence},
                    }},
                    {"max", {
                        {"kick", d.param_max_kick}, {"control", d.param_max_control},
                        {"technic", d.param_max_technic}, {"pressure", d.param_max_pressure},
                        {"physical", d.param_max_physical}, {"agility", d.param_max_agility},
                        {"intelligence", d.param_max_intelligence},
                    }},
                });
            }
            tc["personality_data"] = std::move(arr);
        }

        // Add rate data
        {
            auto arr = json::array();
            for (const auto& d : db.table_config.add_rate_data) {
                arr.push_back(json{
                    {"kick", d.param_kick}, {"control", d.param_control},
                    {"technic", d.param_technic}, {"pressure", d.param_pressure},
                    {"physical", d.param_physical}, {"agility", d.param_agility},
                    {"intelligence", d.param_intelligence},
                });
            }
            tc["add_rate_data"] = std::move(arr);
        }

        result["table_config"] = std::move(tc);
    }

    // Growth table Lv1
    {
        auto arr = json::array();
        for (const auto& g : db.growth_table_lv1) {
            arr.push_back(json{
                {"main_position", g.main_position},
                {"sub_position",  g.sub_position},
                {"play_style",    g.play_style},
                {"stats", {
                    {"kick",         g.kick},
                    {"control",      g.control},
                    {"technique",    g.technique},
                    {"pressure",     g.pressure},
                    {"physical",     g.physical},
                    {"agility",      g.agility},
                    {"intelligence", g.intelligence},
                }},
            });
        }
        result["growth_table_lv1"] = std::move(arr);
    }

    // Team Build
    {
        json tb;

        // Effect data
        {
            auto arr = json::array();
            for (const auto& d : db.team_build.effect_data) {
                json j{
                    {"id",          d.id},
                    {"hash_1",      d.hash_1},
                    {"sub_id",      d.sub_id},
                    {"effect_type", d.effect_type},
                };
                // Filtrer les hashes null
                auto hashes = json::array();
                for (int32_t h : d.effect_hashes) {
                    if (h != NULL_HASH) {
                        hashes.push_back(h);
                    }
                }
                j["effect_hashes"] = std::move(hashes);
                arr.push_back(std::move(j));
            }
            tb["effect_data"] = std::move(arr);
        }

        // Effect info
        {
            auto arr = json::array();
            for (const auto& d : db.team_build.effect_info) {
                arr.push_back(json{
                    {"info_id",    d.info_id},
                    {"ref_offset", d.ref_offset},
                    {"ref_count",  d.ref_count},
                });
            }
            tb["effect_info"] = std::move(arr);
        }

        // Up data
        {
            auto arr = json::array();
            for (const auto& d : db.team_build.up_data) {
                json j{
                    {"up_id",        d.up_id},
                    {"threshold",    d.threshold},
                    {"effect_count", d.effect_count},
                };
                // Brut sans les hashes null
                auto raw = json::array();
                for (int32_t v : d.raw) {
                    raw.push_back(v);
                }
                j["raw"] = std::move(raw);
                arr.push_back(std::move(j));
            }
            tb["up_data"] = std::move(arr);
        }

        // Down data
        {
            auto arr = json::array();
            for (const auto& d : db.team_build.down_data) {
                json j{
                    {"down_id",      d.down_id},
                    {"threshold",    d.threshold},
                    {"effect_count", d.effect_count},
                };
                auto raw = json::array();
                for (int32_t v : d.raw) {
                    raw.push_back(v);
                }
                j["raw"] = std::move(raw);
                arr.push_back(std::move(j));
            }
            tb["down_data"] = std::move(arr);
        }

        // Info (par playstyle)
        {
            auto arr = json::array();
            for (const auto& d : db.team_build.info) {
                // Resoudre le nom du playstyle
                std::string ps_name = "Unknown";
                if (d.play_style_index >= 0 && d.play_style_index < 6) {
                    ps_name = PLAYSTYLE_NAMES[d.play_style_index];
                }

                arr.push_back(json{
                    {"play_style_index",  d.play_style_index},
                    {"play_style_name",   ps_name},
                    {"level",             d.level},
                    {"ref_up",   {{"offset", d.ref_up_offset},   {"count", d.ref_up_count}}},
                    {"ref_down", {{"offset", d.ref_down_offset}, {"count", d.ref_down_count}}},
                    {"ref_effect", {{"offset", d.ref_effect_offset}, {"count", d.ref_effect_count}}},
                });
            }
            tb["info"] = std::move(arr);
        }

        result["team_build"] = std::move(tb);
    }

    return json{{"playstyle_system", std::move(result)}};
}

} // namespace iecode::gamedata
