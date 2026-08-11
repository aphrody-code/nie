#include "iecode/gamedata/loader.h"

#include "iecode/gamedata/config_parser.h"
#include "iecode/gamedata/text_parser.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/game/gds/chara/gds_chara_base.h"

#include <array>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <spdlog/spdlog.h>

namespace fs = std::filesystem;

namespace iecode::gamedata {

namespace {

/// Lit un fichier binaire entier.
std::vector<uint8_t> gd_loader_read_file(const fs::path& p) {
    std::ifstream f(p, std::ios::binary | std::ios::ate);
    if (!f) return {};
    auto sz = f.tellg();
    f.seekg(0);
    std::vector<uint8_t> buf(static_cast<size_t>(sz));
    f.read(reinterpret_cast<char*>(buf.data()), sz);
    return buf;
}

/// Scan un repertoire pour les fichiers cfg.bin correspondant a un prefix.
std::vector<fs::path> gd_loader_scan(const fs::path& dir, const std::string& prefix) {
    std::vector<fs::path> result;
    if (!fs::exists(dir) || !fs::is_directory(dir)) return result;

    for (const auto& entry : fs::directory_iterator(dir)) {
        if (!entry.is_regular_file()) continue;
        const auto name = entry.path().filename().string();
        if (name.starts_with(prefix) && name.find(".cfg.bin") != std::string::npos) {
            result.push_back(entry.path());
        }
    }
    std::sort(result.begin(), result.end());
    return result;
}

/// Parse un fichier cfg.bin et retourne le CfgBinFile.
std::optional<level5::CfgBinFile> gd_loader_parse_cfg(const fs::path& path) {
    auto data = gd_loader_read_file(path);
    if (data.empty()) return std::nullopt;
    return level5::cfgbin_parse(data);
}

/// Extrait un int32 depuis une variable T2B.
int32_t gd_loader_t2b_int(const level5::CfgVariable& v) {
    if (auto* val = std::get_if<int32_t>(&v.value)) return *val;
    return 0;
}

/// Convertit un int32 en hex "0xABCD1234".
std::string gd_loader_to_hex(int32_t v) {
    return fmt::format("0x{:08X}", static_cast<uint32_t>(v));
}

/// Extrait les donnees de base des personnages depuis chara_base_*.cfg.bin
/// (T2B). Le fichier contient typiquement 5887 enregistrements decrits par
/// 14 descripteurs de colonnes. Utilise game::GDSCharaBase::from_cfgbin.
///
/// Remplit db.base_characters (ParsedCharaBase) et, en l'absence de chara_param
/// exploitable, ajoute aussi des entrees dans db.characters (ParsedCharaParam).
void gd_loader_extract_chara_base(const fs::path& gamedata_dir,
                                   GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "chara_base");

    for (const auto& file : files) {
        // Ignorer les variantes — chara_base_change, chara_base_xxx autres
        const auto fname = file.filename().string();
        if (fname.find("chara_base_") != 0) continue;

        auto data = gd_loader_read_file(file);
        if (data.empty()) continue;

        auto bases = game::GDSCharaBase::from_cfgbin(data);
        if (!bases) {
            spdlog::warn("loader: echec parsing {}", fname);
            continue;
        }

        for (const auto& b : *bases) {
            ParsedCharaBase pb;
            pb.chara_id  = gd_loader_to_hex(static_cast<int32_t>(b.chara_id));
            pb.code      = b.name_key;
            pb.name_hash = gd_loader_to_hex(static_cast<int32_t>(b.name_hash.value));
            pb.series_id = fmt::format("0x{:02X}", b.series_id);
            // gender/team_id non disponibles dans GDSCharaBase

            if (!pb.chara_id.empty()) {
                db.base_characters.push_back(std::move(pb));
            }
        }
    }

    spdlog::info("loader: {} chara_base charges", db.base_characters.size());
}

/// Extrait les personnages depuis les fichiers chara_param (T2B ou RDBN).
void gd_loader_extract_characters(const fs::path& gamedata_dir,
                                   GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "chara_param");

    for (const auto& file : files) {
        // Ignorer les fichiers chara_param_table (structure differente)
        if (file.filename().string().find("chara_param_table") != std::string::npos)
            continue;

        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format == level5::CfgBinFile::Format::RDBN) {
            for (const auto& list : cfg->lists) {
                if (list.name.find("CHARA_PARAM") == std::string::npos) continue;

                for (const auto& entry : list.entries) {
                    ParsedCharaParam chara;

                    for (const auto& field : entry.fields) {
                        if (field.name.find("chara_param_id") != std::string::npos ||
                            field.name.find("CharaParamId") != std::string::npos) {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                chara.chara_param_id = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                chara.chara_param_id = fmt::format("0x{:08X}", *i);
                        }
                        else if (field.name.find("element") != std::string::npos) {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                chara.element = static_cast<Element>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                chara.element = static_cast<Element>(*v2);
                        }
                        else if (field.name.find("main_position") != std::string::npos ||
                                 field.name.find("position") != std::string::npos) {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                chara.main_position = static_cast<Position>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                chara.main_position = static_cast<Position>(*v2);
                        }
                        else if (field.name.find("gender") != std::string::npos) {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                chara.gender = static_cast<Gender>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                chara.gender = static_cast<Gender>(*v2);
                        }
                        else if (field.name.find("chara_rank") != std::string::npos) {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                chara.chara_rank = static_cast<uint8_t>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                chara.chara_rank = static_cast<uint8_t>(*v2);
                        }
                    }

                    if (!chara.chara_param_id.empty()) {
                        db.chara_by_id[chara.chara_param_id] = db.characters.size();
                        db.characters.push_back(std::move(chara));
                    }
                }
            }
        }
        else if (cfg->format == level5::CfgBinFile::Format::T2B) {
            // Format T2B : les entries CHARA_PARAM_INFO_N sont des enfants
            // des noeuds racines. Chaque entry a 43 variables Int sans noms.
            //
            // Indices (valides par le parser TS chara-param.ts) :
            //   [0] = charaParamId (hash int32)
            //   [1] = charaBaseId (hash int32)
            //   [2] = element (1=Wind, 2=Forest, 3=Fire, 4=Mountain)
            //   [3] = mainPosition (1=GK, 2=FW, 3=MF, 4=DF)
            //   [4] = subPosition
            //   [5] = playStyle (0=Counter, 1=Bond, 2=Tension, 3=RoughPlay, 4=Justice, 5=Freedom)
            //   [6] = unknown
            //   [7] = unknown
            //   [8] = growthPattern (0 ou 1)
            //   [9..20] = 6 paires (skillHash, learnLevel) — si hash != 0

            for (const auto& root : cfg->entries) {
                for (const auto& child : root.children) {
                    // Matcher CHARA_PARAM_INFO_N, ignorer LIST/BEG
                    if (child.name.find("CHARA_PARAM_INFO_") == std::string::npos) continue;
                    if (child.name.find("LIST") != std::string::npos) continue;
                    if (child.name.find("BEG") != std::string::npos) continue;

                    const auto& vars = child.variables;
                    if (vars.size() < 8) continue;

                    ParsedCharaParam chara;

                    // Extraire les valeurs par indices fixes
                    chara.chara_param_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
                    chara.chara_base_id  = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
                    chara.element        = static_cast<Element>(gd_loader_t2b_int(vars[2]));
                    chara.main_position  = static_cast<Position>(gd_loader_t2b_int(vars[3]));
                    chara.sub_position   = static_cast<Position>(gd_loader_t2b_int(vars[4]));
                    chara.play_style     = static_cast<uint8_t>(gd_loader_t2b_int(vars[5]));
                    chara.growth_pattern = static_cast<uint8_t>(gd_loader_t2b_int(vars[8]));

                    // V2 format (8 variables) : baseId = paramId
                    if (vars.size() == 8) {
                        int32_t v6 = gd_loader_t2b_int(vars[6]);
                        int32_t v0 = gd_loader_t2b_int(vars[0]);
                        if (v6 == v0) {
                            chara.chara_base_id = chara.chara_param_id;
                        }
                    }

                    // Extraire les skills (6 slots max), paires a partir de l'indice 9
                    for (int i = 0; i < 6; ++i) {
                        const size_t skill_idx = 9 + static_cast<size_t>(i) * 2;
                        const size_t level_idx = 10 + static_cast<size_t>(i) * 2;
                        if (level_idx >= vars.size()) break;

                        int32_t skill_hash = gd_loader_t2b_int(vars[skill_idx]);
                        int32_t learn_level = gd_loader_t2b_int(vars[level_idx]);
                        if (skill_hash != 0) {
                            chara.skills.push_back({
                                gd_loader_to_hex(skill_hash),
                                learn_level
                            });
                        }
                    }

                    // Stocker les variables brutes
                    chara.raw_variables.reserve(vars.size());
                    for (const auto& v : vars) {
                        chara.raw_variables.push_back(gd_loader_t2b_int(v));
                    }

                    if (!chara.chara_param_id.empty()) {
                        db.chara_by_id[chara.chara_param_id] = db.characters.size();
                        db.characters.push_back(std::move(chara));
                    }
                }
            }
        }
    }

    // Fallback : si chara_param a produit peu de resultats (<100), lire
    // chara_base_*.cfg.bin pour recuperer les ~5887 personnages.
    if (db.characters.size() < 100) {
        const size_t before = db.characters.size();
        gd_loader_extract_chara_base(gamedata_dir, db);

        for (const auto& base : db.base_characters) {
            // Ne pas dupliquer si un chara_param correspondant existe deja
            if (db.chara_by_id.contains(base.chara_id)) continue;

            ParsedCharaParam chara;
            chara.chara_param_id = base.chara_id;
            chara.chara_base_id  = base.chara_id;
            db.chara_by_id[chara.chara_param_id] = db.characters.size();
            db.characters.push_back(std::move(chara));
        }

        spdlog::info("loader: chara_base fallback — {} personnages ajoutes "
                     "(total {})", db.characters.size() - before, db.characters.size());
    }

    spdlog::info("loader: {} personnages charges", db.characters.size());
}

/// Extrait les skills depuis les fichiers RDBN skill_config.
/// Noms de champs RDBN resolus : skillID, skillIDStr, skillNameId,
/// skillDescId, power_min, power_max, element, category, consumeTp,
/// growthType, recastTime, eldorado, seriesIdCrc.
void gd_loader_extract_skills(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format == level5::CfgBinFile::Format::RDBN) {
            for (const auto& list : cfg->lists) {
                // On ne veut que m_skillInfoList (pas m_skillOptionInfoList, etc.)
                if (list.name != "m_skillInfoList") continue;

                for (const auto& entry : list.entries) {
                    ParsedSkill skill;

                    for (const auto& field : entry.fields) {
                        if (field.name == "skillID") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                skill.skill_id = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                skill.skill_id = gd_loader_to_hex(*i);
                        }
                        else if (field.name == "skillIDStr") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                skill.skill_id_str = *s;
                        }
                        else if (field.name == "skillNameId") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                skill.name_hash = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                skill.name_hash = gd_loader_to_hex(*i);
                        }
                        else if (field.name == "skillDescId") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                skill.desc_hash = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                skill.desc_hash = gd_loader_to_hex(*i);
                        }
                        else if (field.name == "consumeTp") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.tp_cost = *v;
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                skill.tp_cost = static_cast<int32_t>(*v2);
                        }
                        else if (field.name == "power_min") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.power_min = *v;
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                skill.power_min = static_cast<int32_t>(*v2);
                        }
                        else if (field.name == "power_max") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.power_max = *v;
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                skill.power_max = static_cast<int32_t>(*v2);
                        }
                        else if (field.name == "element") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.element = static_cast<Element>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                skill.element = static_cast<Element>(*v2);
                        }
                        else if (field.name == "category") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.category = static_cast<SkillCategory>(*v);
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                skill.category = static_cast<SkillCategory>(*v2);
                        }
                        else if (field.name == "growthType") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.growth_type = *v;
                        }
                        else if (field.name == "recastTime") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                skill.recast_time = *v;
                        }
                        else if (field.name == "eldorado") {
                            if (auto* v = std::get_if<bool>(&field.value))
                                skill.is_eldorado = *v;
                        }
                        else if (field.name == "seriesIdCrc") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                skill.series_id = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                skill.series_id = gd_loader_to_hex(*i);
                        }
                    }

                    if (!skill.skill_id.empty()) {
                        // Dedup : garder la premiere version trouvee
                        if (db.skill_by_id.find(skill.skill_id) == db.skill_by_id.end()) {
                            db.skill_by_id[skill.skill_id] = db.skills.size();
                            db.skills.push_back(std::move(skill));
                        }
                    }
                }
            }
        }
    }

    spdlog::info("loader: {} skills charges", db.skills.size());
}

/// Extrait les equipes depuis les fichiers RDBN belong_team_config.
/// Le fichier est dans character/ (pas team/).
/// Noms de champs RDBN resolus : belongTeamId, binderTeamOrderType,
/// teamNameTextId.
void gd_loader_extract_teams(const fs::path& gamedata_dir, GameDatabase& db) {
    // belong_team_config est dans character/, pas dans team/
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "belong_team");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format == level5::CfgBinFile::Format::RDBN) {
            for (const auto& list : cfg->lists) {
                // m_belongTeamInfoList
                if (list.name.find("belongTeam") == std::string::npos &&
                    list.name.find("BELONG_TEAM") == std::string::npos) continue;

                for (const auto& entry : list.entries) {
                    ParsedTeam team;

                    for (const auto& field : entry.fields) {
                        if (field.name == "belongTeamId") {
                            if (auto* s = std::get_if<std::string>(&field.value))
                                team.team_id = *s;
                            else if (auto* i = std::get_if<int32_t>(&field.value))
                                team.team_id = gd_loader_to_hex(*i);
                        }
                        else if (field.name == "binderTeamOrderType") {
                            if (auto* v = std::get_if<int32_t>(&field.value))
                                team.order_type = *v;
                            else if (auto* v2 = std::get_if<int16_t>(&field.value))
                                team.order_type = static_cast<int32_t>(*v2);
                        }
                    }

                    if (!team.team_id.empty()) {
                        db.team_by_id[team.team_id] = db.teams.size();
                        db.teams.push_back(std::move(team));
                    }
                }
            }
        }
    }

    spdlog::info("loader: {} equipes chargees", db.teams.size());
}

// ── Map des 20 prefixes de categories d'items ──────────────────────

struct ItemCategoryMapping {
    const char* prefix;
    const char* category;
};

static constexpr ItemCategoryMapping gd_item_categories[] = {
    {"ITEM_CONSUME_INFO_",          "consume"},
    {"ITEM_SHOES_INFO_",            "shoes"},
    {"ITEM_MISANGA_INFO_",          "misanga"},
    {"ITEM_ACCESSORY_INFO_",        "accessory"},
    {"ITEM_SPECIAL_INFO_",          "special"},
    {"ITEM_FORMATION_INFO_",        "formation"},
    {"ITEM_SPECIAL_TACTICS_INFO_",  "special_tactics"},
    {"ITEM_SUPER_TACTICS_INFO_",    "super_tactics"},
    {"ITEM_SPECIAL_SKILL_INFO_",    "special_skill"},
    {"ITEM_TITLE_INFO_",            "title"},
    {"ITEM_FASHION_INFO_",          "fashion"},
    {"ITEM_COSTUME_INFO_",          "costume"},
    {"ITEM_EMBLEM_INFO_",           "emblem"},
    {"ITEM_UNIQUE_INFO_",           "unique"},
    {"ITEM_CRAFT_OBJ_INFO_",        "craft_obj"},
    {"ITEM_ANIMAL_INFO_",           "animal"},
    {"ITEM_KIZUNA_LINK_INFO_",      "kizuna_link"},
    {"ITEM_NAME_PLATE_INFO_",       "name_plate"},
    {"ITEM_PERFORMANCE_INFO_",      "performance"},
    {"ITEM_IMPORTANT_INFO_",        "important"},
};

/// Detecte la categorie d'un noeud T2B item par son nom.
const char* gd_loader_item_category(const std::string& name) {
    for (const auto& [prefix, category] : gd_item_categories) {
        if (name.starts_with(prefix)) return category;
    }
    return nullptr;
}

/// Extrait les items depuis les fichiers item_config (T2B).
void gd_loader_extract_items(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto item_dir = gamedata_dir / "item";
    auto files = gd_loader_scan(item_dir, "item_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            // Ignorer les noeuds _LIST_BEG_
            if (entry.name.find("_LIST_BEG_") != std::string::npos) return;

            const char* cat = gd_loader_item_category(entry.name);
            if (!cat) return;

            const auto& vars = entry.variables;
            if (vars.size() < 5) return;

            ParsedItem item;
            item.item_id   = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            item.category  = cat;

            if (vars.size() > 2)
                item.name_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            if (vars.size() > 3)
                item.desc_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[3]));
            if (vars.size() > 4)
                item.price_gp = gd_loader_t2b_int(vars[4]);
            if (vars.size() > 5)
                item.stat1 = gd_loader_t2b_int(vars[5]);
            if (vars.size() > 6)
                item.stat2 = gd_loader_t2b_int(vars[6]);
            if (vars.size() > 11) {
                if (auto* s = std::get_if<std::string>(&vars[11].value))
                    item.internal_code = *s;
            }
            // Fashion: uniformId = vars[last]
            if (std::string_view(cat) == "fashion" && !vars.empty()) {
                item.uniform_id = gd_loader_t2b_int(vars.back());
            }

            if (!item.item_id.empty()) {
                db.item_by_id[item.item_id] = db.items.size();
                db.items.push_back(std::move(item));
            }
        });
    }

    spdlog::info("loader: {} items charges", db.items.size());
}

/// Extrait les skills passifs (T2B + RDBN team passives).
void gd_loader_extract_passives(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "passive_skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Pass 1 : collecter les effets
        std::unordered_map<std::string, ParsedPassiveEffect> effects_map;
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("PASSIVE_SKILL_EFFECT_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            ParsedPassiveEffect effect;
            effect.effect_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));

            for (size_t i = 1; i < vars.size(); ++i) {
                if (vars[i].type == level5::CfgVarType::Float) {
                    if (auto* v = std::get_if<float>(&vars[i].value))
                        effect.params.push_back(*v);
                } else {
                    effect.params.push_back(
                        static_cast<float>(gd_loader_t2b_int(vars[i])));
                }
            }

            effects_map[effect.effect_id] = std::move(effect);
        });

        // Pass 2 : collecter les skills passifs
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("PASSIVE_SKILL_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_REF_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 5) return;

            ParsedPassive passive;
            passive.passive_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            passive.effect_id  = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            passive.name_hash  = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            passive.desc_hash  = gd_loader_to_hex(gd_loader_t2b_int(vars[3]));
            passive.rarity     = gd_loader_t2b_int(vars[4]);
            passive.scope      = "player";

            // Resoudre les parametres d'effet
            auto eit = effects_map.find(passive.effect_id);
            if (eit != effects_map.end()) {
                passive.effect_params = eit->second.params;
            }

            if (!passive.passive_id.empty()) {
                db.passive_by_id[passive.passive_id] = db.passives.size();
                db.passives.push_back(std::move(passive));
            }
        });
    }

    // Team passives (RDBN) — soccer/soccer_team_passive_config_*.cfg.bin
    const auto soccer_dir = gamedata_dir / "soccer";
    auto team_files = gd_loader_scan(soccer_dir, "soccer_team_passive_config");
    for (const auto& file : team_files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_soccerTeamPassiveDataList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedPassive passive;
            passive.scope = "team";

            for (const auto& field : entry.fields) {
                if (field.name == "teamPassiveId")
                    passive.passive_id = rdbn_string(field);
                else if (field.name == "teamPassiveTextId")
                    passive.name_hash = rdbn_string(field);
                else if (field.name == "effectId")
                    passive.effect_id = rdbn_string(field);
                else if (field.name == "effectValueMin" || field.name == "effectValueMax") {
                    passive.effect_params.push_back(rdbn_float(field));
                }
            }

            if (!passive.passive_id.empty()) {
                db.passive_by_id[passive.passive_id] = db.passives.size();
                db.passives.push_back(std::move(passive));
            }
        }
    }

    spdlog::info("loader: {} passifs charges", db.passives.size());
}

/// Extrait les quetes depuis les fichiers quest_config (T2B).
void gd_loader_extract_quests(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto quest_dir = gamedata_dir / "quest";
    auto files = gd_loader_scan(quest_dir, "quest_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Chercher le noeud QUEST_DATA_CFG_LIST_BEG_0 et iterer ses enfants
        const auto* list_node = find_first_node(cfg->entries, "QUEST_DATA_CFG_LIST_BEG_");
        if (!list_node) continue;

        for (const auto& child : list_node->children) {
            if (child.name.find("QUEST_DATA_CFG_") == std::string::npos) continue;
            if (child.name.find("_REF_") != std::string::npos) continue;

            const auto& vars = child.variables;
            if (vars.size() < 4) continue;

            ParsedQuest quest;
            quest.quest_id   = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            quest.phase      = gd_loader_t2b_int(vars[1]);
            quest.type       = gd_loader_t2b_int(vars[2]);
            quest.title_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[3]));

            if (vars.size() > 16) {
                if (auto* s = std::get_if<std::string>(&vars[16].value)) {
                    if (!s->empty()) quest.image = *s;
                }
            }

            if (!quest.quest_id.empty()) {
                db.quest_by_id[quest.quest_id] = db.quests.size();
                db.quests.push_back(std::move(quest));
            }
        }
    }

    spdlog::info("loader: {} quetes chargees", db.quests.size());
}

/// Sentinelle NULL pour les champs special tactics.
static constexpr int32_t GD_NULL_SENTINEL = -992181094; // 0xC4B0B4DA

/// Extrait les tactiques speciales depuis special_tactics_config (T2B).
void gd_loader_extract_special_tactics(const fs::path& gamedata_dir,
                                        GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "special_tactics_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Collecter les effets
        std::vector<SpecialTacticsEffect> effects;
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("SPECIAL_TACTICS_EFFECT_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 9) return;

            SpecialTacticsEffect effect;
            effect.effect_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            effect.power     = gd_loader_t2b_int(vars[1]);

            for (size_t i = 2; i < vars.size(); ++i) {
                int32_t val = gd_loader_t2b_int(vars[i]);
                if (val != GD_NULL_SENTINEL) {
                    effect.conditions.push_back(gd_loader_to_hex(val));
                }
            }

            effects.push_back(std::move(effect));
        });

        // Collecter les tactiques
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            // Matcher exactement SPECIAL_TACTICS_INFO_N (pas REF, pas LIST)
            if (entry.name.find("SPECIAL_TACTICS_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_REF_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 10) return;

            ParsedSpecialTactic tactic;
            tactic.tactics_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            if (auto* s = std::get_if<std::string>(&vars[1].value))
                tactic.internal_code = *s;
            tactic.name_hash  = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            tactic.desc_hash  = gd_loader_to_hex(gd_loader_t2b_int(vars[3]));
            tactic.power      = gd_loader_t2b_int(vars[4]);
            tactic.recast_time = gd_loader_t2b_int(vars[5]);
            tactic.element    = static_cast<Element>(gd_loader_t2b_int(vars[6]));

            // Partner IDs (indices 7, 8, 9)
            for (int i = 7; i < 10 && static_cast<size_t>(i) < vars.size(); ++i) {
                int32_t val = gd_loader_t2b_int(vars[static_cast<size_t>(i)]);
                if (val != 0 && val != GD_NULL_SENTINEL) {
                    tactic.partner_ids.push_back(gd_loader_to_hex(val));
                }
            }

            if (!tactic.tactics_id.empty()) {
                db.tactic_by_id[tactic.tactics_id] = db.special_tactics.size();
                db.special_tactics.push_back(std::move(tactic));
            }
        });
    }

    spdlog::info("loader: {} tactiques speciales chargees", db.special_tactics.size());
}

/// Decode une string hex de 16 caracteres en 2 float32 LE.
std::array<float, 2> gd_loader_hex_to_floats(const std::string& hex) {
    std::array<float, 2> result = {0.0f, 0.0f};
    if (hex.size() < 16) return result;

    // 16 hex chars = 8 bytes = 2 float32
    uint8_t bytes[8] = {};
    for (int i = 0; i < 8; ++i) {
        char hi = hex[static_cast<size_t>(i) * 2];
        char lo = hex[static_cast<size_t>(i) * 2 + 1];
        auto nibble = [](char c) -> uint8_t {
            if (c >= '0' && c <= '9') return static_cast<uint8_t>(c - '0');
            if (c >= 'a' && c <= 'f') return static_cast<uint8_t>(c - 'a' + 10);
            if (c >= 'A' && c <= 'F') return static_cast<uint8_t>(c - 'A' + 10);
            return 0;
        };
        bytes[i] = static_cast<uint8_t>((nibble(hi) << 4) | nibble(lo));
    }

    std::memcpy(&result[0], bytes, 4);
    std::memcpy(&result[1], bytes + 4, 4);
    return result;
}

/// Extrait les formations depuis formation_config (RDBN).
void gd_loader_extract_formations(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto form_dir = gamedata_dir / "formation";
    auto files = gd_loader_scan(form_dir, "formation_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // D'abord charger les placements
        std::vector<FormationPosition> all_placements;
        const auto* placement_list = find_list(*cfg, "m_SoccerFormPlacementInfoList");
        if (placement_list) {
            for (const auto& entry : placement_list->entries) {
                FormationPosition pos;
                for (const auto& field : entry.fields) {
                    if (field.name == "positionNo")    pos.position_no = rdbn_int(field);
                    else if (field.name == "positionId") pos.position_id = rdbn_int(field);
                    else if (field.name == "passNo")     pos.pass_no = rdbn_int(field);
                    else if (field.name == "bKickoff")   pos.b_kickoff = rdbn_bool(field);
                    else if (field.name == "bFollow")    pos.b_follow = rdbn_bool(field);
                    else if (field.name == "defensePos") pos.defense_pos = gd_loader_hex_to_floats(rdbn_string(field));
                    else if (field.name == "offensePos") pos.offense_pos = gd_loader_hex_to_floats(rdbn_string(field));
                    else if (field.name == "startPos")   pos.start_pos = gd_loader_hex_to_floats(rdbn_string(field));
                }
                all_placements.push_back(pos);
            }
        }

        // Puis charger les formations
        const auto* form_list = find_list(*cfg, "m_SoccerFormationInfoList");
        if (!form_list) continue;

        for (const auto& entry : form_list->entries) {
            ParsedFormation formation;
            int32_t placement_start = 0;
            int32_t placement_count = 0;

            for (const auto& field : entry.fields) {
                if (field.name == "formId")
                    formation.formation_id = rdbn_string(field);
                else if (field.name == "nounId")
                    formation.noun_hash = rdbn_string(field);
                else if (field.name == "descId")
                    formation.desc_hash = rdbn_string(field);
                else if (field.name == "powerOffense")
                    formation.power_offense = rdbn_int(field);
                else if (field.name == "powerDefense")
                    formation.power_defense = rdbn_int(field);
                else if (field.name == "placementInfo") {
                    // Array [startIdx, count]
                    if (auto* vec = std::get_if<std::vector<int16_t>>(&field.value)) {
                        if (vec->size() >= 2) {
                            placement_start = (*vec)[0];
                            placement_count = (*vec)[1];
                        }
                    }
                }
            }

            // Lier les placements
            for (int32_t i = placement_start;
                 i < placement_start + placement_count &&
                 static_cast<size_t>(i) < all_placements.size();
                 ++i) {
                formation.positions.push_back(all_placements[static_cast<size_t>(i)]);
            }

            if (!formation.formation_id.empty()) {
                db.formations.push_back(std::move(formation));
            }
        }
    }

    spdlog::info("loader: {} formations chargees", db.formations.size());
}

/// Extrait les shops depuis shop_config (T2B).
void gd_loader_extract_shops(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto shop_dir = gamedata_dir / "shop";
    auto files = gd_loader_scan(shop_dir, "shop_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Naviguer SHOP_INFO_LIST_BEG_* -> SHOP_INFO_* -> SHOP_INFO_ITEM_*
        auto shop_nodes = find_nodes_by_prefix(cfg->entries, "SHOP_INFO_LIST_BEG_");
        for (const auto* list_node : shop_nodes) {
            for (const auto& shop_child : list_node->children) {
                if (shop_child.name.find("SHOP_INFO_") == std::string::npos) continue;
                if (shop_child.name.find("_LIST_") != std::string::npos) continue;
                if (shop_child.name.find("_ITEM_") != std::string::npos) continue;

                const auto& vars = shop_child.variables;
                if (vars.size() < 2) continue;

                ParsedShop shop;
                shop.shop_id   = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
                shop.name_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));

                // Extraire les items du shop (enfants SHOP_INFO_ITEM_*)
                for (const auto& item_child : shop_child.children) {
                    if (item_child.name.find("SHOP_INFO_ITEM_") == std::string::npos) continue;
                    if (item_child.name.find("_LIST_") != std::string::npos) continue;

                    if (item_child.variables.size() > 2) {
                        shop.item_ids.push_back(
                            gd_loader_to_hex(gd_loader_t2b_int(item_child.variables[2])));
                    }
                }

                if (!shop.shop_id.empty()) {
                    db.shops.push_back(std::move(shop));
                }
            }
        }
    }

    spdlog::info("loader: {} shops charges", db.shops.size());
}

/// Extrait les equipes adverses depuis opponent_team_config (RDBN).
void gd_loader_extract_opponent_teams(const fs::path& gamedata_dir,
                                       GameDatabase& db) {
    const auto team_dir = gamedata_dir / "team";
    auto files = gd_loader_scan(team_dir, "opponent_team_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_OpponentTeamInfoList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedOpponentTeam opp;

            for (const auto& field : entry.fields) {
                if (field.name == "id")
                    opp.opponent_id = rdbn_string(field);
                else if (field.name == "type")
                    opp.type = rdbn_int(field);
                else if (field.name == "teamId")
                    opp.team_id = rdbn_string(field);
                else if (field.name == "descTextId")
                    opp.desc_text_id = rdbn_string(field);
                else if (field.name == "difficultyType")
                    opp.difficulty_type = rdbn_int(field);
                else if (field.name == "bgTextureName")
                    opp.bg_texture_name = rdbn_string(field);
                else if (field.name == "gameId")
                    opp.game_id = rdbn_string(field);
            }

            if (!opp.opponent_id.empty()) {
                db.opponent_teams.push_back(std::move(opp));
            }
        }
    }

    spdlog::info("loader: {} equipes adverses chargees", db.opponent_teams.size());
}

/// Extrait les tables de croissance depuis growth_table_config (RDBN).
void gd_loader_extract_growth_tables(const fs::path& gamedata_dir,
                                      GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "growth_table_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // Lv1 table
        const auto* lv1_list = find_list(*cfg, "m_growthTableLv1List");
        if (lv1_list) {
            for (const auto& entry : lv1_list->entries) {
                GrowthTableLv1 row;
                for (const auto& field : entry.fields) {
                    if (field.name == "mainPosition")    row.main_position = rdbn_int(field);
                    else if (field.name == "subPosition") row.sub_position = rdbn_int(field);
                    else if (field.name == "playStyle")   row.play_style = rdbn_int(field);
                    else if (field.name == "Kc_1")  row.stats.kick         = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Cr_1")  row.stats.control      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Tc_1")  row.stats.technique    = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Pr_1")  row.stats.pressure     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ps_1")  row.stats.physical     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ag_1")  row.stats.agility      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "It_1")  row.stats.intelligence = static_cast<int16_t>(rdbn_int(field));
                }
                db.growth_lv1.push_back(row);
            }
        }

        // Lv30 table
        const auto* lv30_list = find_list(*cfg, "m_growthTableLv30List");
        if (lv30_list) {
            for (const auto& entry : lv30_list->entries) {
                GrowthTableLv30 row;
                for (const auto& field : entry.fields) {
                    if (field.name == "mainPosition")      row.main_position = rdbn_int(field);
                    else if (field.name == "subPosition")   row.sub_position = rdbn_int(field);
                    else if (field.name == "growthPattern") row.growth_pattern = rdbn_int(field);
                    else if (field.name == "charaRank")     row.chara_rank = rdbn_int(field);
                    else if (field.name == "Kc_30") row.stats.kick         = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Cr_30") row.stats.control      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Tc_30") row.stats.technique    = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Pr_30") row.stats.pressure     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ps_30") row.stats.physical     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ag_30") row.stats.agility      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "It_30") row.stats.intelligence = static_cast<int16_t>(rdbn_int(field));
                }
                db.growth_lv30.push_back(row);
            }
        }
    }

    spdlog::info("loader: {} growth lv1 + {} growth lv30 charges",
                 db.growth_lv1.size(), db.growth_lv30.size());
}

/// Resout un hash en LocalizedNames depuis une MultiLocaleText.
void gd_loader_resolve_names(LocalizedNames& out, const std::string& hash,
                              const MultiLocaleText& text) {
    if (hash.empty()) return;
    out.ja      = text.find(hash, "ja");
    out.en      = text.find(hash, "en");
    out.fr      = text.find(hash, "fr");
    out.de      = text.find(hash, "de");
    out.es      = text.find(hash, "es");
    out.it      = text.find(hash, "it");
    out.pt      = text.find(hash, "pt");
    out.zh_hans = text.find(hash, "zh_hans");
    out.zh_hant = text.find(hash, "zh_hant");
}

/// Cross-reference : resout les hashes en noms localises pour tous les domaines.
void gd_loader_resolve_texts(GameDatabase& db) {
    // Skills
    for (auto& skill : db.skills) {
        gd_loader_resolve_names(skill.names, skill.name_hash, db.skill_text);
        gd_loader_resolve_names(skill.descriptions, skill.desc_hash, db.skill_text);
    }

    // Teams
    for (auto& team : db.teams) {
        gd_loader_resolve_names(team.names, team.team_id, db.team_text);
    }

    // Items (noms dans item_text, descriptions dans item_desc_text)
    for (auto& item : db.items) {
        gd_loader_resolve_names(item.names, item.name_hash, db.item_text);
        gd_loader_resolve_names(item.descriptions, item.desc_hash, db.item_desc_text);
    }

    // Passives (skill_text pour les player, passive_text pour les team)
    for (auto& passive : db.passives) {
        if (passive.scope == "team") {
            gd_loader_resolve_names(passive.names, passive.name_hash, db.passive_text);
        } else {
            gd_loader_resolve_names(passive.names, passive.name_hash, db.skill_text);
            // Fallback : si pas de nom dans skill_text, essayer passive_text
            if (passive.names.best().empty()) {
                gd_loader_resolve_names(passive.names, passive.passive_id, db.passive_text);
            }
        }
    }

    // Quests
    for (auto& quest : db.quests) {
        gd_loader_resolve_names(quest.titles, quest.title_hash, db.quest_text);
    }

    // Special Tactics (noms dans item_text, pas skill_text)
    for (auto& tactic : db.special_tactics) {
        gd_loader_resolve_names(tactic.names, tactic.name_hash, db.item_text);
        gd_loader_resolve_names(tactic.descriptions, tactic.desc_hash, db.item_text);
    }

    // Formations
    for (auto& form : db.formations) {
        gd_loader_resolve_names(form.names, form.noun_hash, db.formation_text);
        gd_loader_resolve_names(form.descriptions, form.desc_hash, db.formation_text);
    }

    // Missions
    for (auto& mission : db.missions) {
        gd_loader_resolve_names(mission.names, mission.name_hash, db.mission_text);
    }

    // Trophees
    for (auto& trophy : db.trophies) {
        gd_loader_resolve_names(trophy.names, trophy.name_hash, db.trophy_text);
        gd_loader_resolve_names(trophy.descriptions, trophy.desc_hash, db.trophy_text);
    }

    // Constellations
    for (auto& c : db.constellations) {
        gd_loader_resolve_names(c.names, c.hash_id, db.constellation_text);
    }

    // Series
    for (auto& s : db.series) {
        gd_loader_resolve_names(s.names, s.name_text_id, db.chara_text);
    }

    spdlog::info("loader: textes resolus pour tous les domaines");
}

/// Lookup growth table lv1 par (position, play_style).
const GrowthTableLv1* gd_loader_find_growth_lv1(
    const std::vector<GrowthTableLv1>& table,
    int32_t main_pos, int32_t play_style) {
    for (const auto& row : table) {
        if (row.main_position == main_pos && row.play_style == play_style)
            return &row;
    }
    return nullptr;
}

/// Lookup growth table lv30 par (position, growth_pattern, chara_rank).
const GrowthTableLv30* gd_loader_find_growth_lv30(
    const std::vector<GrowthTableLv30>& table,
    int32_t main_pos, int32_t growth_pattern, int32_t chara_rank) {
    for (const auto& row : table) {
        if (row.main_position == main_pos &&
            row.growth_pattern == growth_pattern &&
            row.chara_rank == chara_rank)
            return &row;
    }
    return nullptr;
}

/// Calcule les stats multi-niveaux pour tous les personnages.
void gd_loader_compute_stats(GameDatabase& db) {
    if (db.growth_lv1.empty() || db.growth_lv30.empty()) return;

    int computed = 0;
    for (auto& chara : db.characters) {
        int32_t main_pos = static_cast<int32_t>(chara.main_position);
        int32_t ps = chara.play_style;
        int32_t gp = chara.growth_pattern;
        int32_t rank = chara.chara_rank;

        const auto* lv1 = gd_loader_find_growth_lv1(db.growth_lv1, main_pos, ps);
        const auto* lv30 = gd_loader_find_growth_lv30(db.growth_lv30, main_pos, gp, rank);

        if (!lv1 || !lv30) continue;

        // lv1 stats from growth table
        chara.stats.lv1 = lv1->stats;
        chara.stats.lv30 = lv30->stats;

        // Lv50/99 : utiliser growth_main si disponible, sinon extrapolation
        const GrowthTableMain* main_row = nullptr;
        for (const auto& row : db.growth_main) {
            if (row.main_position == main_pos &&
                row.growth_pattern == gp &&
                row.chara_rank == rank) {
                main_row = &row;
                break;
            }
        }

        if (main_row) {
            chara.stats.lv50 = main_row->stats_50;
            chara.stats.lv99 = main_row->stats_99;
        } else {
            // Fallback: extrapolation lineaire
            auto interp = [](int16_t v1, int16_t v30) -> std::pair<int16_t, int16_t> {
                float rate = (v30 != v1) ? static_cast<float>(v30 - v1) / 29.0f : 0.0f;
                auto lv50_val = static_cast<int16_t>(static_cast<float>(v30) + rate * 20.0f);
                auto lv99_val = static_cast<int16_t>(static_cast<float>(lv50_val) + rate * 49.0f);
                return {lv50_val, lv99_val};
            };

            auto [kick50, kick99] = interp(lv1->stats.kick, lv30->stats.kick);
            auto [ctrl50, ctrl99] = interp(lv1->stats.control, lv30->stats.control);
            auto [tech50, tech99] = interp(lv1->stats.technique, lv30->stats.technique);
            auto [pres50, pres99] = interp(lv1->stats.pressure, lv30->stats.pressure);
            auto [phys50, phys99] = interp(lv1->stats.physical, lv30->stats.physical);
            auto [agil50, agil99] = interp(lv1->stats.agility, lv30->stats.agility);
            auto [inte50, inte99] = interp(lv1->stats.intelligence, lv30->stats.intelligence);

            chara.stats.lv50 = {kick50, ctrl50, tech50, pres50, phys50, agil50, inte50};
            chara.stats.lv99 = {kick99, ctrl99, tech99, pres99, phys99, agil99, inte99};
        }
        ++computed;
    }

    spdlog::info("loader: stats calculees pour {} personnages", computed);
}

/// Index de CharaBase par chara_id pour lookup rapide.
using CharaBaseIndex = std::unordered_map<std::string, const ParsedCharaBase*>;

/// Construit les personnages enrichis a partir de toutes les sources.
void gd_loader_build_enriched(GameDatabase& db) {
    // Construire un index des bases
    CharaBaseIndex base_index;
    for (const auto& base : db.base_characters) {
        base_index[base.chara_id] = &base;
    }

    db.enriched_characters.reserve(db.characters.size());

    for (const auto& chara : db.characters) {
        EnrichedCharacter ec;
        ec.chara_param_id = chara.chara_param_id;
        ec.chara_base_id  = chara.chara_base_id;
        ec.element        = chara.element;
        ec.main_position  = chara.main_position;
        ec.sub_position   = chara.sub_position;
        ec.gender         = chara.gender;
        ec.chara_rank     = chara.chara_rank;
        ec.growth_pattern = chara.growth_pattern;
        ec.play_style     = chara.play_style;
        ec.stats          = chara.stats;

        // Resoudre depuis CharaBase
        auto bit = base_index.find(chara.chara_base_id);
        if (bit != base_index.end()) {
            const auto* base = bit->second;
            ec.internal_code = base->code;
            ec.team_id       = base->team_id;
            ec.series_id     = base->series_id;

            // Noms du personnage depuis chara_text via le name_hash de base
            gd_loader_resolve_names(ec.names, base->name_hash, db.chara_text);

            // Description
            // chara_description_text utilise le meme hash
            // (pas charge separement pour l'instant — utilise chara_text fallback)

            // Nom de l'equipe
            auto tit = db.team_by_id.find(base->team_id);
            if (tit != db.team_by_id.end()) {
                ec.team_names = db.teams[tit->second].names;
            }
        }

        // Skills enrichis
        for (const auto& slot : chara.skills) {
            EnrichedCharacter::SkillInfo si;
            si.skill_id    = slot.skill_id;
            si.learn_level = slot.learn_level;

            auto sit = db.skill_by_id.find(slot.skill_id);
            if (sit != db.skill_by_id.end()) {
                const auto& skill = db.skills[sit->second];
                si.names     = skill.names;
                si.power_min = skill.power_min;
                si.power_max = skill.power_max;
                si.element   = skill.element;
            }

            ec.skills.push_back(std::move(si));
        }

        db.enriched_characters.push_back(std::move(ec));
    }

    spdlog::info("loader: {} personnages enrichis construits",
                 db.enriched_characters.size());
}

/// Extrait la configuration BASARA depuis basara_chara_config (RDBN).
void gd_loader_extract_basara_config(const fs::path& gamedata_dir,
                                      GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "basara_chara_config");

    // Structures temporaires pour l'association
    std::vector<BasaraBuildInfo> build_infos;

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // Charger les build types
        const auto* type_list = find_list(*cfg, "m_basaraBuildTypeList");
        if (type_list) {
            for (const auto& entry : type_list->entries) {
                BasaraBuildType bt;
                for (const auto& field : entry.fields) {
                    if (field.name == "type")
                        bt.type = rdbn_int(field);
                    else if (field.name == "boardId")
                        bt.board_id = rdbn_string(field);
                }
                db.basara_build_types.push_back(std::move(bt));
            }
        }

        // Charger les build infos
        const auto* info_list = find_list(*cfg, "m_basaraBuildInfoList");
        if (info_list) {
            for (const auto& entry : info_list->entries) {
                BasaraBuildInfo bi;
                for (const auto& field : entry.fields) {
                    if (field.name == "charaParamId")
                        bi.chara_param_id = rdbn_string(field);
                    else if (field.name == "typeInfo") {
                        // Array d'indices int16
                        if (auto* vec = std::get_if<std::vector<int16_t>>(&field.value)) {
                            for (auto idx : *vec)
                                bi.type_indices.push_back(static_cast<int32_t>(idx));
                        }
                    }
                }
                if (!bi.chara_param_id.empty())
                    build_infos.push_back(std::move(bi));
            }
        }
    }

    // Stocker les build infos pour utilisation dans gd_loader_build_basara
    // On les stocke temporairement via un static local (sera utilise juste apres)
    // Alternative : on passe par un parametre supplementaire
    // Pour rester simple, on construit une map chara_param_id → build_infos
    // et on la stocke dans un champ temporaire (ou on fait le build ici)

    // On fait le build directement ici si les enriched sont deja prets
    // Sinon, on stocke les infos pour plus tard
    // => On va faire le lien dans gd_loader_build_basara qui recoit build_infos

    spdlog::info("loader: {} basara build types, {} basara build infos charges",
                 db.basara_build_types.size(), build_infos.size());

    // Construire un index temporaire pour le lien
    // On va rappeler gd_loader_build_basara apres enrichment, donc on stocke
    // les infos dans une variable statique (pas ideal mais fonctionnel)
    // Meilleure approche : faire tout dans cette fonction apres enrichment.
    // Le caller doit appeler cette fonction apres gd_loader_build_enriched.

    // On construit directement les basara ici si enriched est rempli
    if (!db.enriched_characters.empty()) {
        // Construire un index des build infos par chara_param_id
        std::unordered_map<std::string, const BasaraBuildInfo*> bi_index;
        for (const auto& bi : build_infos) {
            bi_index[bi.chara_param_id] = &bi;
        }

        int32_t basara_index = 0;
        for (const auto& ec : db.enriched_characters) {
            if (ec.chara_rank != 20) continue;

            BasaraCharacter bc;
            bc.chara_param_id = ec.chara_param_id;
            bc.chara_base_id  = ec.chara_base_id;
            bc.internal_code  = ec.internal_code;
            bc.names          = ec.names;
            bc.element        = ec.element;
            bc.main_position  = ec.main_position;
            bc.gender         = ec.gender;
            bc.chara_rank     = ec.chara_rank;
            bc.growth_pattern = ec.growth_pattern;
            bc.play_style     = ec.play_style;
            bc.stats          = ec.stats;
            bc.team_id        = ec.team_id;
            bc.team_names     = ec.team_names;
            bc.series_id      = ec.series_id;
            bc.skills         = ec.skills;
            bc.index          = ++basara_index;

            // Lier les builds depuis la config
            auto it = bi_index.find(ec.chara_param_id);
            if (it != bi_index.end()) {
                for (auto idx : it->second->type_indices) {
                    if (static_cast<size_t>(idx) < db.basara_build_types.size()) {
                        bc.builds.push_back(db.basara_build_types[static_cast<size_t>(idx)]);
                    }
                }
            }

            db.basara_by_id[bc.chara_param_id] = db.basara_characters.size();
            db.basara_characters.push_back(std::move(bc));
        }

        spdlog::info("loader: {} personnages BASARA construits", db.basara_characters.size());
    }
}

/// Extrait les drop tables depuis item_table_config (T2B).
void gd_loader_extract_drop_tables(const fs::path& gamedata_dir,
                                    GameDatabase& db) {
    const auto item_dir = gamedata_dir / "item";
    auto files = gd_loader_scan(item_dir, "item_table_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Pass 1 : collecter tous les ITBL_ITEMS_* (pas LIST)
        std::vector<DropEntry> flat_items;
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("ITBL_ITEMS_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            DropEntry de;
            de.item_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            de.rate    = gd_loader_t2b_int(vars[1]);
            de.count   = gd_loader_t2b_int(vars[2]);
            flat_items.push_back(std::move(de));
        });

        // Pass 2 : collecter les ITBL_INFO_* (definitions de tables)
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("ITBL_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            DropTable table;
            table.table_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            int32_t start  = gd_loader_t2b_int(vars[1]);
            int32_t count  = gd_loader_t2b_int(vars[2]);

            // Extraire la tranche du tableau flat
            for (int32_t i = start;
                 i < start + count && static_cast<size_t>(i) < flat_items.size();
                 ++i) {
                table.entries.push_back(flat_items[static_cast<size_t>(i)]);
            }

            if (!table.table_id.empty()) {
                db.drop_table_by_id[table.table_id] = db.drop_tables.size();
                db.drop_tables.push_back(std::move(table));
            }
        });
    }

    // Construire l'index inverse : itemId → [(tableId, rate)]
    for (const auto& table : db.drop_tables) {
        for (const auto& entry : table.entries) {
            db.item_drop_sources[entry.item_id].emplace_back(table.table_id, entry.rate);
        }
    }

    spdlog::info("loader: {} drop tables charges ({} items indexes)",
                 db.drop_tables.size(), db.item_drop_sources.size());
}

/// Extrait les aura skills depuis aura_skill_config (T2B).
void gd_loader_extract_aura_skills(const fs::path& gamedata_dir,
                                    GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "aura_skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("AURA_SKILL_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 7) return;

            ParsedAuraSkill aura;
            aura.aura_id   = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            aura.name_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            aura.desc_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            aura.power     = gd_loader_t2b_int(vars[3]);
            aura.tp_cost   = gd_loader_t2b_int(vars[4]);
            aura.element   = static_cast<Element>(gd_loader_t2b_int(vars[5]));
            aura.sub_type  = gd_loader_t2b_int(vars[6]);

            // String vars : [0]=auraIdStr, [1]=seriesId (si disponible)
            if (vars.size() > 0) {
                if (auto* s = std::get_if<std::string>(&vars[0].value))
                    aura.aura_id_str = *s;
            }
            if (vars.size() > 1) {
                if (auto* s = std::get_if<std::string>(&vars[1].value))
                    aura.series_id = *s;
            }

            if (!aura.aura_id.empty()) {
                if (db.aura_by_id.find(aura.aura_id) == db.aura_by_id.end()) {
                    db.aura_by_id[aura.aura_id] = db.aura_skills.size();
                    db.aura_skills.push_back(std::move(aura));
                }
            }
        });
    }

    spdlog::info("loader: {} aura skills charges", db.aura_skills.size());
}

// ══════════════════════════════════════════════════════════════════════
// Nouveaux extracteurs — port depuis inagle
// ══════════════════════════════════════════════════════════════════════

/// Extrait les tables d'XP depuis chara_exp_table_config (RDBN).
void gd_loader_extract_exp_table(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "chara_exp_table_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* exp_list = find_list(*cfg, "m_charaExpTableList");
        if (exp_list) {
            for (const auto& entry : exp_list->entries) {
                ExpTableEntry row;
                for (const auto& field : entry.fields) {
                    if (field.name == "level")    row.level = rdbn_int(field);
                    else if (field.name == "needExp") row.need_exp = rdbn_int(field);
                }
                db.exp_table.push_back(row);
            }
        }

        const auto* rate_list = find_list(*cfg, "m_expRarityRateList");
        if (rate_list) {
            for (const auto& entry : rate_list->entries) {
                ExpRarityRate row;
                for (const auto& field : entry.fields) {
                    if (field.name == "rarity") row.rarity = rdbn_int(field);
                    else if (field.name == "rate") row.rate = rdbn_float(field);
                }
                db.exp_rarity_rates.push_back(row);
            }
        }
    }

    spdlog::info("loader: {} exp entries + {} rarity rates",
                 db.exp_table.size(), db.exp_rarity_rates.size());
}

/// Extrait les growth tables main/sub (Lv50/99) depuis growth_table_config (RDBN).
void gd_loader_extract_growth_main(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "growth_table_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // Main table (lv50/99 combined)
        const auto* main_list = find_list(*cfg, "m_growthTableMainList");
        if (main_list) {
            for (const auto& entry : main_list->entries) {
                GrowthTableMain row;
                for (const auto& field : entry.fields) {
                    if (field.name == "mainPosition")      row.main_position = rdbn_int(field);
                    else if (field.name == "subPosition")   row.sub_position = rdbn_int(field);
                    else if (field.name == "growthPattern") row.growth_pattern = rdbn_int(field);
                    else if (field.name == "charaRank")     row.chara_rank = rdbn_int(field);
                    else if (field.name == "Kc_50") row.stats_50.kick         = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Cr_50") row.stats_50.control      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Tc_50") row.stats_50.technique    = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Pr_50") row.stats_50.pressure     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ps_50") row.stats_50.physical     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ag_50") row.stats_50.agility      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "It_50") row.stats_50.intelligence = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Kc_99") row.stats_99.kick         = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Cr_99") row.stats_99.control      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Tc_99") row.stats_99.technique    = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Pr_99") row.stats_99.pressure     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ps_99") row.stats_99.physical     = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "Ag_99") row.stats_99.agility      = static_cast<int16_t>(rdbn_int(field));
                    else if (field.name == "It_99") row.stats_99.intelligence = static_cast<int16_t>(rdbn_int(field));
                }
                db.growth_main.push_back(row);
            }
        }
    }

    spdlog::info("loader: {} growth main (lv50/99) charges", db.growth_main.size());
}

/// Extrait les costumes depuis chara_costume_config (T2B).
void gd_loader_extract_costumes(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "chara_costume");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("CHARA_COSTUME_MODEL_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 4) return;

            ParsedCostume costume;
            costume.type          = gd_loader_t2b_int(vars[0]);
            costume.model_ref_crc = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            costume.flag1         = gd_loader_t2b_int(vars[2]);
            costume.flag2         = gd_loader_t2b_int(vars[3]);
            db.costumes.push_back(std::move(costume));
        });
    }

    spdlog::info("loader: {} costumes charges", db.costumes.size());
}

/// Extrait les uniformes depuis uniform_config (RDBN).
void gd_loader_extract_uniforms(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "uniform_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_UniformModelInfoList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedUniform uniform;
            for (const auto& field : entry.fields) {
                if (field.name == "uniformFielderModelIdCrc")
                    uniform.fielder_model_crc = rdbn_string(field);
                else if (field.name == "uniformKeeperModelIdCrc")
                    uniform.keeper_model_crc = rdbn_string(field);
                else if (field.name == "uniformDirectorModelIdCrc")
                    uniform.director_model_crc = rdbn_string(field);
                else if (field.name == "uniformManagerModelIdCrc")
                    uniform.manager_model_crc = rdbn_string(field);
                else if (field.name == "shoesFielderModelIdCrc")
                    uniform.shoes_fielder_crc = rdbn_string(field);
                else if (field.name == "shoesKeeperModelIdCrc")
                    uniform.shoes_keeper_crc = rdbn_string(field);
                else if (field.name == "gloveModelIdCrc")
                    uniform.glove_model_crc = rdbn_string(field);
                else if (field.name == "typeId")
                    uniform.type_id = rdbn_int(field);
                else if (field.name == "shoesModelAttr")
                    uniform.shoes_model_attr = rdbn_int(field);
                else if (field.name == "uniformNgModelAttr")
                    uniform.uniform_ng_attr = rdbn_int(field);
                else if (field.name == "shoesModelIdLocked")
                    uniform.shoes_locked = rdbn_int(field);
            }
            db.uniforms.push_back(std::move(uniform));
        }
    }

    spdlog::info("loader: {} uniformes charges", db.uniforms.size());
}

/// Extrait les series depuis chara_series_config (T2B ou RDBN).
void gd_loader_extract_series(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto char_dir = gamedata_dir / "character";
    auto files = gd_loader_scan(char_dir, "chara_series_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format == level5::CfgBinFile::Format::RDBN) {
            const auto* list = find_list(*cfg, "m_charaSeriesInfoList");
            if (!list) continue;
            for (const auto& entry : list->entries) {
                ParsedSeries series;
                for (const auto& field : entry.fields) {
                    if (field.name == "charaSeriesId")
                        series.series_id = rdbn_string(field);
                    else if (field.name == "charaSeriesType")
                        series.series_type = rdbn_int(field);
                    else if (field.name == "charaSeriesNameTextId")
                        series.name_text_id = rdbn_string(field);
                }
                if (!series.series_id.empty())
                    db.series.push_back(std::move(series));
            }
        } else if (cfg->format == level5::CfgBinFile::Format::T2B) {
            visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
                if (entry.name.find("CHARA_SERIES_") == std::string::npos) return;
                if (entry.name.find("_LIST_") != std::string::npos) return;
                if (entry.name.find("_BEG_") != std::string::npos) return;

                const auto& vars = entry.variables;
                if (vars.size() < 3) return;

                ParsedSeries series;
                series.series_id    = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
                series.series_type  = gd_loader_t2b_int(vars[1]);
                series.name_text_id = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
                if (!series.series_id.empty())
                    db.series.push_back(std::move(series));
            });
        }
    }

    spdlog::info("loader: {} series chargees", db.series.size());
}

/// Extrait les constellations depuis star info (RDBN/T2B).
void gd_loader_extract_constellations(const fs::path& gamedata_dir, GameDatabase& db) {
    // Try all-gamedata directory first
    const auto star_dir = gamedata_dir / "star";
    auto files = gd_loader_scan(star_dir, "star_");
    // Also check players_universe
    auto pu_files = gd_loader_scan(gamedata_dir / "players_universe", "star_");
    files.insert(files.end(), pu_files.begin(), pu_files.end());

    // Map index → constellation
    std::unordered_map<int32_t, size_t> index_map;

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        if (cfg->format == level5::CfgBinFile::Format::RDBN) {
            // star_info
            const auto* star_list = find_list(*cfg, "m_starInfoList");
            if (star_list) {
                for (const auto& entry : star_list->entries) {
                    ParsedConstellation c;
                    for (const auto& field : entry.fields) {
                        if (field.name == "index")   c.index = rdbn_int(field);
                        else if (field.name == "id") c.hash_id = rdbn_string(field);
                    }
                    index_map[c.index] = db.constellations.size();
                    db.constellations.push_back(std::move(c));
                }
            }

            // star_sign_chara_info — link characters
            const auto* chara_list = find_list(*cfg, "m_starSignCharaInfoList");
            if (chara_list) {
                for (const auto& entry : chara_list->entries) {
                    int32_t star_idx = -1;
                    std::string param_id;
                    for (const auto& field : entry.fields) {
                        if (field.name == "starIndex") star_idx = rdbn_int(field);
                        else if (field.name == "charaParamId") param_id = rdbn_string(field);
                    }
                    if (star_idx >= 0 && !param_id.empty()) {
                        auto it = index_map.find(star_idx);
                        if (it != index_map.end()) {
                            db.constellations[it->second].character_ids.push_back(param_id);
                            ++db.constellations[it->second].character_count;
                        }
                    }
                }
            }
        }
    }

    spdlog::info("loader: {} constellations chargees", db.constellations.size());
}

/// Extrait les capsules/gacha depuis capsule_config (T2B).
void gd_loader_extract_capsules(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto cap_dir = gamedata_dir / "capsule";
    auto files = gd_loader_scan(cap_dir, "capsule_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg) continue;

        ParsedCapsule capsule;

        if (cfg->format == level5::CfgBinFile::Format::T2B) {
            // Prizes
            visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
                if (entry.name.find("CPSL_PRIZE_INFO_") == std::string::npos) return;
                if (entry.name.find("_LIST_") != std::string::npos) return;
                if (entry.name.find("_BEG") != std::string::npos) return;

                const auto& vars = entry.variables;
                if (vars.empty()) return;

                CapsulePrize prize;
                prize.prize_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
                for (size_t i = 1; i < vars.size(); ++i)
                    prize.raw_vars.push_back(gd_loader_t2b_int(vars[i]));
                capsule.prizes.push_back(std::move(prize));
            });

            // Lot rank rates
            visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
                if (entry.name.find("CPSL_LOT_RANK_RATE_INFO_") == std::string::npos) return;
                if (entry.name.find("_LIST_") != std::string::npos) return;
                if (entry.name.find("_BEG") != std::string::npos) return;

                const auto& vars = entry.variables;
                if (vars.size() < 3) return;

                CapsuleLotRankRate rate;
                rate.rate_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
                rate.rank    = gd_loader_t2b_int(vars[1]);
                rate.weight  = gd_loader_t2b_int(vars[2]);
                capsule.rank_rates.push_back(std::move(rate));
            });

            // Config ID from first CPSL_CONFIG_INFO
            visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
                if (entry.name.find("CPSL_CONFIG_INFO_") == std::string::npos) return;
                if (entry.name.find("_LIST_") != std::string::npos) return;
                if (entry.name.find("_BEG") != std::string::npos) return;
                if (capsule.config_id.empty() && !entry.variables.empty())
                    capsule.config_id = gd_loader_to_hex(gd_loader_t2b_int(entry.variables[0]));
            });
        }

        if (!capsule.prizes.empty())
            db.capsules.push_back(std::move(capsule));
    }

    spdlog::info("loader: {} capsule configs charges", db.capsules.size());
}

/// Extrait la galerie depuis gallery_config (RDBN).
void gd_loader_extract_gallery(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto gal_dir = gamedata_dir / "gallery";
    auto files = gd_loader_scan(gal_dir, "gallery_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_GalleryInfoList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedGallery gal;
            for (const auto& field : entry.fields) {
                if (field.name == "galleryId")       gal.gallery_id = rdbn_string(field);
                else if (field.name == "imgPath")    gal.img_path = rdbn_string(field);
                else if (field.name == "thumbPath")  gal.thumb_path = rdbn_string(field);
                else if (field.name == "needTokenNum") gal.need_token_num = rdbn_int(field);
                else if (field.name == "flgNo")      gal.flg_no = rdbn_int(field);
                else if (field.name == "openCond")   gal.open_cond = rdbn_int(field);
            }
            if (!gal.gallery_id.empty())
                db.gallery.push_back(std::move(gal));
        }
    }

    spdlog::info("loader: {} gallery entries chargees", db.gallery.size());
}

/// Extrait les tricks depuis trick_config (RDBN).
void gd_loader_extract_tricks(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "trick_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_trickInfoList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedTrick trick;
            for (const auto& field : entry.fields) {
                if (field.name == "trickID")          trick.trick_id = rdbn_string(field);
                else if (field.name == "trickIDName") trick.trick_id_name = rdbn_string(field);
                else if (field.name == "eventID")     trick.event_id = rdbn_string(field);
                else if (field.name == "eventIDName") trick.event_id_name = rdbn_string(field);
                else if (field.name == "failEventID") trick.fail_event_id = rdbn_string(field);
                else if (field.name == "failEventIDName") trick.fail_event_id_name = rdbn_string(field);
                else if (field.name == "trickName")   trick.trick_name = rdbn_string(field);
                else if (field.name == "trickCategory") trick.trick_category = rdbn_int(field);
            }
            if (!trick.trick_id.empty())
                db.tricks.push_back(std::move(trick));
        }
    }

    spdlog::info("loader: {} tricks charges", db.tricks.size());
}

/// Extrait les missions depuis mission_config (T2B).
void gd_loader_extract_missions(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto mission_dir = gamedata_dir / "mission";
    auto files = gd_loader_scan(mission_dir, "mission_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("MISSION_CONFIG_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 2) return;

            ParsedMission mission;
            mission.mission_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            if (vars.size() > 1) {
                if (auto* s = std::get_if<std::string>(&vars[1].value))
                    mission.code = *s;
            }
            if (vars.size() > 2)
                mission.name_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));

            if (!mission.mission_id.empty())
                db.missions.push_back(std::move(mission));
        });
    }

    spdlog::info("loader: {} missions chargees", db.missions.size());
}

/// Extrait les trophees depuis trophy_config (T2B).
void gd_loader_extract_trophies(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto trophy_dir = gamedata_dir / "trophy";
    auto files = gd_loader_scan(trophy_dir, "trophy_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("TROPHY_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_REF_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            ParsedTrophy trophy;
            trophy.trophy_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            if (vars.size() > 1)
                trophy.name_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            if (vars.size() > 2)
                trophy.desc_hash = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            if (vars.size() > 3) {
                if (auto* s = std::get_if<std::string>(&vars[3].value))
                    trophy.code = *s;
            }

            if (!trophy.trophy_id.empty())
                db.trophies.push_back(std::move(trophy));
        });
    }

    spdlog::info("loader: {} trophees charges", db.trophies.size());
}

/// Extrait le dictionnaire depuis dictionary_config (RDBN).
void gd_loader_extract_dictionary(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto dict_dir = gamedata_dir / "dictionary";
    auto files = gd_loader_scan(dict_dir, "dictionary_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* hab_list = find_list(*cfg, "m_HabitatList");
        if (hab_list) {
            for (const auto& entry : hab_list->entries) {
                DictionaryHabitat hab;
                for (const auto& field : entry.fields) {
                    if (field.name == "habitatID")       hab.habitat_id = rdbn_string(field);
                    else if (field.name == "mapID")      hab.map_id = rdbn_string(field);
                    else if (field.name == "mapNameID")   hab.map_name_id = rdbn_string(field);
                    else if (field.name == "fileName")    hab.file_name = rdbn_string(field);
                    else if (field.name == "textureNameCrc") hab.texture_name_crc = rdbn_string(field);
                    else if (field.name == "isShowAreaTexture") hab.show_area_texture = rdbn_bool(field);
                }
                db.dictionary_habitats.push_back(std::move(hab));
            }
        }

        const auto* obs_list = find_list(*cfg, "m_ObservationDataList");
        if (obs_list) {
            for (const auto& entry : obs_list->entries) {
                DictionaryObservation obs;
                for (const auto& field : entry.fields)
                    obs.raw_vars.push_back(rdbn_int(field));
                db.dictionary_observations.push_back(std::move(obs));
            }
        }
    }

    spdlog::info("loader: {} habitats + {} observations",
                 db.dictionary_habitats.size(), db.dictionary_observations.size());
}

/// Extrait la musique depuis music_app_config (T2B).
void gd_loader_extract_music(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto music_dir = gamedata_dir / "music_app";
    auto files = gd_loader_scan(music_dir, "music_app_config");

    int32_t music_index = 0;
    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("MUSIC_APP_INFO_ITEM_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            ParsedMusic music;
            music.music_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            music.index    = music_index++;

            if (!music.music_id.empty())
                db.music.push_back(std::move(music));
        });
    }

    spdlog::info("loader: {} musiques chargees", db.music.size());
}

/// Extrait les tutorials depuis help_list_config (T2B).
void gd_loader_extract_help(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto help_dir = gamedata_dir / "help";
    auto files = gd_loader_scan(help_dir, "help_list_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("HELP_LIST_IMAGE_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            ParsedHelp help;
            help.help_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            if (auto* s = std::get_if<std::string>(&vars[1].value))
                help.image = *s;
            help.name_idx = gd_loader_t2b_int(vars[2]);
            if (vars.size() > 3)
                help.desc_idx = gd_loader_t2b_int(vars[3]);

            if (!help.help_id.empty())
                db.help.push_back(std::move(help));
        });
    }

    spdlog::info("loader: {} help entries chargees", db.help.size());
}

/// Extrait les inacode stamps depuis inacode_config (RDBN).
void gd_loader_extract_inacode(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto ina_dir = gamedata_dir / "inacode";
    auto files = gd_loader_scan(ina_dir, "inacode_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* stamp_list = find_list(*cfg, "m_InacodeStampDataList");
        if (stamp_list) {
            for (const auto& entry : stamp_list->entries) {
                InacodeStamp stamp;
                for (const auto& field : entry.fields) {
                    if (field.name == "idCrc")         stamp.id_crc = rdbn_string(field);
                    else if (field.name == "imgNameCrc") stamp.img_name_crc = rdbn_string(field);
                    else if (field.name == "imgPathCrc") stamp.img_path_crc = rdbn_string(field);
                }
                db.inacode.stamps.push_back(std::move(stamp));
            }
        }

        const auto* author_list = find_list(*cfg, "m_InacodeAuthorNameDataList");
        if (author_list) db.inacode.author_count = static_cast<int32_t>(author_list->entries.size());

        const auto* comment_list = find_list(*cfg, "m_InacodeCommentDataList");
        if (comment_list) db.inacode.comment_count = static_cast<int32_t>(comment_list->entries.size());

        const auto* sticker_list = find_list(*cfg, "m_InacodeStickerDataList");
        if (sticker_list) db.inacode.sticker_count = static_cast<int32_t>(sticker_list->entries.size());
    }

    spdlog::info("loader: {} inacode stamps charges", db.inacode.stamps.size());
}

/// Extrait les NFC lotteries depuis nfc_lottery_config (T2B).
void gd_loader_extract_nfc_lottery(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto nfc_dir = gamedata_dir / "nfc";
    auto files = gd_loader_scan(nfc_dir, "nfc_lottery_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Navigate NFC_LOTTERY_INFO_LIST_BEG → NFC_LOTTERY_INFO_* → tables → items
        auto lottery_nodes = find_nodes_by_prefix(cfg->entries, "NFC_LOTTERY_INFO_LIST_BEG_");
        for (const auto* list_node : lottery_nodes) {
            for (const auto& lottery_child : list_node->children) {
                if (lottery_child.name.find("NFC_LOTTERY_INFO_") == std::string::npos) continue;
                if (lottery_child.name.find("_LIST_") != std::string::npos) continue;
                if (lottery_child.name.find("_TABLE_") != std::string::npos) continue;

                ParsedNfcLottery lottery;
                if (!lottery_child.variables.empty())
                    lottery.lottery_id = gd_loader_to_hex(gd_loader_t2b_int(lottery_child.variables[0]));

                // Tables are children
                for (const auto& table_child : lottery_child.children) {
                    if (table_child.name.find("_TABLE_LIST_BEG_") != std::string::npos) {
                        for (const auto& tbl : table_child.children) {
                            if (tbl.name.find("_TABLE_ITEM_") != std::string::npos) continue;
                            if (tbl.name.find("_TABLE_") == std::string::npos) continue;

                            NfcLotteryTable table;
                            if (!tbl.variables.empty())
                                table.table_id = gd_loader_to_hex(gd_loader_t2b_int(tbl.variables[0]));

                            for (const auto& item_beg : tbl.children) {
                                for (const auto& item_child : item_beg.children) {
                                    if (item_child.variables.size() < 3) continue;
                                    NfcLotteryItem item;
                                    item.item_id = gd_loader_to_hex(gd_loader_t2b_int(item_child.variables[0]));
                                    item.type    = gd_loader_t2b_int(item_child.variables[1]);
                                    item.weight  = gd_loader_t2b_int(item_child.variables[2]);
                                    table.items.push_back(std::move(item));
                                }
                            }

                            if (!table.table_id.empty())
                                lottery.tables.push_back(std::move(table));
                        }
                    }
                }

                if (!lottery.lottery_id.empty())
                    db.nfc_lotteries.push_back(std::move(lottery));
            }
        }
    }

    spdlog::info("loader: {} nfc lotteries chargees", db.nfc_lotteries.size());
}

/// Extrait les enjoy mode teams (T2B).
void gd_loader_extract_enjoy_mode_teams(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto team_dir = gamedata_dir / "team";
    auto files = gd_loader_scan(team_dir, "enjoy_mode_team_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("ENJOY_MODE_TEAM_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 7) return;

            ParsedEnjoyModeTeam team;
            team.team_id       = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            team.sub_id        = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            team.color_crc     = gd_loader_to_hex(gd_loader_t2b_int(vars[2]));
            team.type          = gd_loader_t2b_int(vars[3]);
            team.formation_crc = gd_loader_to_hex(gd_loader_t2b_int(vars[4]));
            if (auto* s = std::get_if<std::string>(&vars[5].value))
                team.texture_path = *s;
            if (auto* s = std::get_if<std::string>(&vars[6].value))
                team.texture_name = *s;

            if (!team.team_id.empty())
                db.enjoy_mode_teams.push_back(std::move(team));
        });
    }

    spdlog::info("loader: {} enjoy mode teams charges", db.enjoy_mode_teams.size());
}

/// Extrait le team build depuis team_build_config (T2B).
void gd_loader_extract_team_build(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "team_build_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        ParsedTeamBuild build;

        // Effects
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("TEAM_BUILD_EFFECT_DATA_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            TeamBuildEffectData effect;
            effect.effect_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            effect.threshold = gd_loader_t2b_int(vars[1]);
            effect.value     = gd_loader_t2b_int(vars[2]);
            for (size_t i = 3; i < vars.size(); ++i) {
                int32_t val = gd_loader_t2b_int(vars[i]);
                if (val != GD_NULL_SENTINEL)
                    effect.conditions.push_back(gd_loader_to_hex(val));
            }
            build.effects.push_back(std::move(effect));
        });

        // Up data
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("TEAM_BUILD_UP_DATA_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 7) return;

            TeamBuildUpDown up;
            up.type         = gd_loader_t2b_int(vars[0]);
            up.threshold    = gd_loader_t2b_int(vars[1]);
            up.multiplier   = gd_loader_t2b_int(vars[2]);
            up.cond_value1  = gd_loader_t2b_int(vars[3]);
            up.cond_value2  = gd_loader_t2b_int(vars[4]);
            up.effect_ref_id = gd_loader_to_hex(gd_loader_t2b_int(vars[5]));
            up.effect_count = gd_loader_t2b_int(vars[6]);
            build.up_data.push_back(std::move(up));
        });

        // Down data
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("TEAM_BUILD_DOWN_DATA_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 7) return;

            TeamBuildUpDown down;
            down.type         = gd_loader_t2b_int(vars[0]);
            down.threshold    = gd_loader_t2b_int(vars[1]);
            down.multiplier   = gd_loader_t2b_int(vars[2]);
            down.cond_value1  = gd_loader_t2b_int(vars[3]);
            down.cond_value2  = gd_loader_t2b_int(vars[4]);
            down.effect_ref_id = gd_loader_to_hex(gd_loader_t2b_int(vars[5]));
            down.effect_count = gd_loader_t2b_int(vars[6]);
            build.down_data.push_back(std::move(down));
        });

        // Build ID from TEAM_BUILD_INFO
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("TEAM_BUILD_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;
            if (build.build_id.empty() && !entry.variables.empty())
                build.build_id = gd_loader_to_hex(gd_loader_t2b_int(entry.variables[0]));
        });

        if (!build.effects.empty())
            db.team_builds.push_back(std::move(build));
    }

    spdlog::info("loader: {} team builds charges", db.team_builds.size());
}

/// Extrait les skill technics depuis skill_technic_config (RDBN).
void gd_loader_extract_skill_technics(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "skill_technic_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_SkillTechnicInfoList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedSkillTechnic st;
            for (const auto& field : entry.fields) {
                if (field.name == "id")
                    st.id = rdbn_string(field);
                else if (field.name == "winSubMotionNameCrc")
                    st.win_sub_motion_crc = rdbn_string(field);
                else if (field.name == "loseSubMotionNameCrc")
                    st.lose_sub_motion_crc = rdbn_string(field);
                else if (field.name == "loseType")
                    st.lose_type = rdbn_int(field);
                else if (field.name == "formationType")
                    st.formation_type = rdbn_int(field);
                else if (field.name == "formationCharaLen")
                    st.formation_chara_len = rdbn_int(field);
                else if (field.name == "shootCurveMidRate")
                    st.shoot_curve_mid_rate = rdbn_float(field);
                else if (field.name == "shootCurveHeightRate")
                    st.shoot_curve_height_rate = rdbn_float(field);
                else if (field.name == "shootCurveAngle")
                    st.shoot_curve_angle = rdbn_float(field);
            }
            if (!st.id.empty())
                db.skill_technics.push_back(std::move(st));
        }
    }

    spdlog::info("loader: {} skill technics charges", db.skill_technics.size());
}

/// Extrait les real skills depuis real_skill_config (RDBN).
void gd_loader_extract_real_skills(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "real_skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // Flat shoot courses
        std::vector<RealSkillShootCourse> all_courses;
        const auto* course_list = find_list(*cfg, "m_RealSkillShootCourseInfoList");
        if (course_list) {
            for (const auto& entry : course_list->entries) {
                RealSkillShootCourse course;
                for (const auto& field : entry.fields) {
                    if (field.name == "targetRate")       course.target_rate = rdbn_float(field);
                    else if (field.name == "isGroundTarget") course.is_ground_target = rdbn_bool(field);
                    else if (field.name == "targetHeightOffset") course.target_height_offset = rdbn_float(field);
                    else if (field.name == "targetHoriOffset")   course.target_hori_offset = rdbn_float(field);
                    else if (field.name == "curveRate")    course.curve_rate = rdbn_float(field);
                    else if (field.name == "curveHeightRate") course.curve_height_rate = rdbn_float(field);
                    else if (field.name == "curveAngle")   course.curve_angle = rdbn_float(field);
                    else if (field.name == "moveTimeRate") course.move_time_rate = rdbn_float(field);
                }
                all_courses.push_back(course);
            }
        }

        // Real skills with refs to courses
        const auto* skill_list = find_list(*cfg, "m_RealSkillInfoList");
        if (skill_list) {
            for (const auto& entry : skill_list->entries) {
                ParsedRealSkill rs;
                int32_t course_start = 0;
                int32_t course_count = 0;
                for (const auto& field : entry.fields) {
                    if (field.name == "id")
                        rs.id = rdbn_string(field);
                    else if (field.name == "loseType")
                        rs.lose_type = rdbn_int(field);
                    else if (field.name == "formationType")
                        rs.formation_type = rdbn_int(field);
                    else if (field.name == "formationCharaLen")
                        rs.formation_chara_len = rdbn_int(field);
                    else if (field.name == "shootLimitBallHeightAttr")
                        rs.shoot_limit_ball_height_attr = rdbn_int(field);
                    else if (field.name == "shootGroundingEffectName")
                        rs.shoot_grounding_effect_name = rdbn_string(field);
                    else if (field.name == "shootGroundingEffectIntervalTime")
                        rs.shoot_grounding_effect_interval_time = rdbn_float(field);
                    else if (field.name == "shootGroundingEffectScale")
                        rs.shoot_grounding_effect_scale = rdbn_float(field);
                    else if (field.name == "shootCourseInfoRef") {
                        if (auto* vec = std::get_if<std::vector<int16_t>>(&field.value)) {
                            if (vec->size() >= 2) {
                                course_start = (*vec)[0];
                                course_count = (*vec)[1];
                            }
                        }
                    }
                }
                // Link courses
                for (int32_t i = course_start;
                     i < course_start + course_count &&
                     static_cast<size_t>(i) < all_courses.size(); ++i) {
                    rs.shoot_courses.push_back(all_courses[static_cast<size_t>(i)]);
                }
                if (!rs.id.empty())
                    db.real_skills.push_back(std::move(rs));
            }
        }
    }

    spdlog::info("loader: {} real skills charges", db.real_skills.size());
}

/// Extrait les override skills depuis override_skill_config (RDBN).
void gd_loader_extract_override_skills(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "override_skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        // Flat condition skills
        std::vector<OverrideConditionSkill> all_cond_skills;
        const auto* cs_list = find_list(*cfg, "m_OverrideConditionSkillInfoList");
        if (cs_list) {
            for (const auto& entry : cs_list->entries) {
                OverrideConditionSkill ocs;
                for (const auto& field : entry.fields) {
                    if (field.name == "skillId") ocs.skill_id = rdbn_string(field);
                    else if (field.name == "num") ocs.num = rdbn_int(field);
                }
                all_cond_skills.push_back(std::move(ocs));
            }
        }

        // Flat conditions
        std::vector<OverrideCondition> all_conditions;
        const auto* cond_list = find_list(*cfg, "m_OverrideConditionInfoList");
        if (cond_list) {
            for (const auto& entry : cond_list->entries) {
                OverrideCondition oc;
                int32_t ref_start = 0, ref_count = 0;
                for (const auto& field : entry.fields) {
                    if (field.name == "conditionType") oc.condition_type = rdbn_int(field);
                    else if (field.name == "refConditionSkillData") {
                        if (auto* vec = std::get_if<std::vector<int16_t>>(&field.value)) {
                            if (vec->size() >= 2) {
                                ref_start = (*vec)[0];
                                ref_count = (*vec)[1];
                            }
                        }
                    }
                }
                for (int32_t i = ref_start;
                     i < ref_start + ref_count &&
                     static_cast<size_t>(i) < all_cond_skills.size(); ++i) {
                    oc.skills.push_back(all_cond_skills[static_cast<size_t>(i)]);
                }
                all_conditions.push_back(std::move(oc));
            }
        }

        // Override skills
        const auto* os_list = find_list(*cfg, "m_OverrideSkillInfoList");
        if (os_list) {
            for (const auto& entry : os_list->entries) {
                ParsedOverrideSkill os;
                int32_t ref_start = 0, ref_count = 0;
                for (const auto& field : entry.fields) {
                    if (field.name == "overrideSkillId") os.override_skill_id = rdbn_string(field);
                    else if (field.name == "refConditionData") {
                        if (auto* vec = std::get_if<std::vector<int16_t>>(&field.value)) {
                            if (vec->size() >= 2) {
                                ref_start = (*vec)[0];
                                ref_count = (*vec)[1];
                            }
                        }
                    }
                }
                for (int32_t i = ref_start;
                     i < ref_start + ref_count &&
                     static_cast<size_t>(i) < all_conditions.size(); ++i) {
                    os.conditions.push_back(all_conditions[static_cast<size_t>(i)]);
                }
                if (!os.override_skill_id.empty())
                    db.override_skills.push_back(std::move(os));
            }
        }
    }

    spdlog::info("loader: {} override skills charges", db.override_skills.size());
}

/// Extrait les effets passifs depuis passive_skill_effect_config (RDBN).
void gd_loader_extract_passive_effects(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "passive_skill_effect_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_soccerPassiveSkillEffectList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedPassiveEffect pe;
            for (const auto& field : entry.fields) {
                if (field.name == "effectId")
                    pe.effect_id = rdbn_string(field);
                else if (field.name.starts_with("effectParam"))
                    pe.params.push_back(rdbn_float(field));
            }
            if (!pe.effect_id.empty())
                db.passive_effects.push_back(std::move(pe));
        }
    }

    spdlog::info("loader: {} passive effects charges", db.passive_effects.size());
}

/// Extrait les change aura skills (RDBN).
void gd_loader_extract_change_aura_skills(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "change_aura_skill_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::RDBN) continue;

        const auto* list = find_list(*cfg, "m_ChangeAuraSkillDataList");
        if (!list) continue;

        for (const auto& entry : list->entries) {
            ParsedChangeAuraSkill cas;
            for (const auto& field : entry.fields) {
                if (field.name == "id")
                    cas.id = rdbn_string(field);
                else if (field.name == "charaParamId")
                    cas.chara_param_id = rdbn_string(field);
            }
            if (!cas.id.empty())
                db.change_aura_skills.push_back(std::move(cas));
        }
    }

    spdlog::info("loader: {} change aura skills charges", db.change_aura_skills.size());
}

/// Extrait les boost player groups (T2B).
void gd_loader_extract_boost_player_groups(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto boost_dir = gamedata_dir / "boost_grp";
    auto files = gd_loader_scan(boost_dir, "boost_player_group_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Spirit tables
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("BOOST_PLAYER_GRP_SPRIT_TABLE_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 2) return;

            BoostSpiritTable bst;
            bst.index      = gd_loader_t2b_int(vars[0]);
            bst.spirit_crc = gd_loader_to_hex(gd_loader_t2b_int(vars[1]));
            db.boost_spirit_tables.push_back(std::move(bst));
        });

        // Configs
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("BOOST_PLAYER_GRP_CONFIG_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            BoostPlayerGroupConfig bpc;
            bpc.duration = gd_loader_t2b_int(vars[0]);
            for (size_t i = 1; i < vars.size(); ++i)
                bpc.spirit_indices.push_back(gd_loader_t2b_int(vars[i]));
            db.boost_player_configs.push_back(std::move(bpc));
        });
    }

    spdlog::info("loader: {} spirit tables + {} boost configs",
                 db.boost_spirit_tables.size(), db.boost_player_configs.size());
}

/// Extrait les personnages controlables (T2B).
void gd_loader_extract_ctrl_charas(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto party_dir = gamedata_dir / "party";
    auto files = gd_loader_scan(party_dir, "ctrl_chara_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("CTRL_CHR_DATA_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG_") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.size() < 3) return;

            ParsedCtrlChara ctrl;
            ctrl.chara_param_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            ctrl.control_type   = gd_loader_t2b_int(vars[1]);
            ctrl.flags          = gd_loader_t2b_int(vars[2]);

            if (!ctrl.chara_param_id.empty())
                db.ctrl_charas.push_back(std::move(ctrl));
        });
    }

    spdlog::info("loader: {} ctrl charas charges", db.ctrl_charas.size());
}

/// Extrait les super tactics base depuis super_tactics_config (T2B).
void gd_loader_extract_super_tactics_base(const fs::path& gamedata_dir, GameDatabase& db) {
    const auto skill_dir = gamedata_dir / "skill";
    auto files = gd_loader_scan(skill_dir, "super_tactics_config");

    for (const auto& file : files) {
        auto cfg = gd_loader_parse_cfg(file);
        if (!cfg || cfg->format != level5::CfgBinFile::Format::T2B) continue;

        // Effects
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("SUPER_TACTICS_EFFECT_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            SuperTacticsEffect ste;
            ste.effect_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            for (size_t i = 1; i < vars.size(); ++i) {
                int32_t val = gd_loader_t2b_int(vars[i]);
                if (val != GD_NULL_SENTINEL)
                    ste.conditions.push_back(gd_loader_to_hex(val));
            }
            db.super_tactics_effects.push_back(std::move(ste));
        });

        // Tactics info
        visit_nodes(cfg->entries, [&](const level5::CfgEntry& entry) {
            if (entry.name.find("SUPER_TACTICS_INFO_") == std::string::npos) return;
            if (entry.name.find("_LIST_") != std::string::npos) return;
            if (entry.name.find("_BEG") != std::string::npos) return;

            const auto& vars = entry.variables;
            if (vars.empty()) return;

            ParsedSuperTacticsBase stb;
            stb.tactics_id = gd_loader_to_hex(gd_loader_t2b_int(vars[0]));
            for (size_t i = 1; i < vars.size(); ++i)
                stb.raw_vars.push_back(gd_loader_t2b_int(vars[i]));
            db.super_tactics_base.push_back(std::move(stb));
        });
    }

    spdlog::info("loader: {} super tactics effects + {} super tactics base",
                 db.super_tactics_effects.size(), db.super_tactics_base.size());
}

/// Construit la map de playstyles (statique, pas de cfg.bin).
void gd_loader_build_playstyles(GameDatabase& db) {
    db.playstyles = {
        {0, "Counter",    "Contre"},
        {1, "Bond",       "Lien"},
        {2, "Tension",    "Tension"},
        {3, "Rough Play", "Jeu violent"},
        {4, "Justice",    "Justice"},
        {5, "Freedom",    "Liberte"},
    };
}

} // namespace

std::optional<GameDatabase> load_game_database(
    const fs::path& data_root, bool load_text) {

    const auto gamedata_dir = data_root / "common" / "gamedata";

    if (!fs::exists(gamedata_dir)) {
        spdlog::error("loader: repertoire gamedata introuvable: {}", gamedata_dir.string());
        return std::nullopt;
    }

    GameDatabase db;

    gd_loader_extract_characters(gamedata_dir, db);
    gd_loader_extract_skills(gamedata_dir, db);
    gd_loader_extract_teams(gamedata_dir, db);
    gd_loader_extract_items(gamedata_dir, db);
    gd_loader_extract_passives(gamedata_dir, db);
    gd_loader_extract_quests(gamedata_dir, db);
    gd_loader_extract_special_tactics(gamedata_dir, db);
    gd_loader_extract_formations(gamedata_dir, db);
    gd_loader_extract_shops(gamedata_dir, db);
    gd_loader_extract_opponent_teams(gamedata_dir, db);
    gd_loader_extract_growth_tables(gamedata_dir, db);
    gd_loader_extract_growth_main(gamedata_dir, db);
    gd_loader_extract_drop_tables(gamedata_dir, db);
    gd_loader_extract_aura_skills(gamedata_dir, db);

    // Nouveaux extracteurs
    gd_loader_extract_exp_table(gamedata_dir, db);
    gd_loader_extract_costumes(gamedata_dir, db);
    gd_loader_extract_uniforms(gamedata_dir, db);
    gd_loader_extract_series(gamedata_dir, db);
    gd_loader_extract_constellations(gamedata_dir, db);
    gd_loader_extract_capsules(gamedata_dir, db);
    gd_loader_extract_gallery(gamedata_dir, db);
    gd_loader_extract_tricks(gamedata_dir, db);
    gd_loader_extract_missions(gamedata_dir, db);
    gd_loader_extract_trophies(gamedata_dir, db);
    gd_loader_extract_dictionary(gamedata_dir, db);
    gd_loader_extract_music(gamedata_dir, db);
    gd_loader_extract_help(gamedata_dir, db);
    gd_loader_extract_inacode(gamedata_dir, db);
    gd_loader_extract_nfc_lottery(gamedata_dir, db);
    gd_loader_extract_enjoy_mode_teams(gamedata_dir, db);
    gd_loader_extract_team_build(gamedata_dir, db);
    gd_loader_extract_skill_technics(gamedata_dir, db);
    gd_loader_extract_real_skills(gamedata_dir, db);
    gd_loader_extract_override_skills(gamedata_dir, db);
    gd_loader_extract_passive_effects(gamedata_dir, db);
    gd_loader_extract_change_aura_skills(gamedata_dir, db);
    gd_loader_extract_boost_player_groups(gamedata_dir, db);
    gd_loader_extract_ctrl_charas(gamedata_dir, db);
    gd_loader_extract_super_tactics_base(gamedata_dir, db);
    gd_loader_build_playstyles(db);

    if (load_text) {
        db.chara_text     = load_all_locales(data_root, "chara");
        db.skill_text     = load_all_locales(data_root, "skill");
        db.item_text      = load_all_locales(data_root, "item");
        db.item_desc_text = load_all_locales(data_root, "item_explain");
        db.team_text      = load_all_locales(data_root, "team");
        db.passive_text   = load_all_locales(data_root, "soccer_passive");
        db.quest_text     = load_all_locales(data_root, "quest_title");
        db.formation_text = load_all_locales(data_root, "formation");
        db.mission_text   = load_all_locales(data_root, "mission");
        db.trophy_text    = load_all_locales(data_root, "trophy");
        db.music_text     = load_all_locales(data_root, "music");
        db.help_text      = load_all_locales(data_root, "help");
        db.menu_text      = load_all_locales(data_root, "menu");
        db.constellation_text = load_all_locales(data_root, "players_universe");

        // Resoudre les hashes en noms localises
        gd_loader_resolve_texts(db);
    }

    // Calculer les stats multi-niveaux
    gd_loader_compute_stats(db);

    // Construire les personnages enrichis (apres textes + stats)
    if (load_text) {
        gd_loader_build_enriched(db);
        gd_loader_extract_basara_config(gamedata_dir, db);

        // Resoudre les noms des aura skills (utilisent item_text comme les tactiques)
        for (auto& aura : db.aura_skills) {
            gd_loader_resolve_names(aura.names, aura.name_hash, db.item_text);
            gd_loader_resolve_names(aura.descriptions, aura.desc_hash, db.item_text);
        }
    }

    spdlog::info("loader: database complete — {} chars, {} skills, {} teams, "
                 "{} items, {} passives, {} quests, {} tactics, {} formations, "
                 "{} basara, {} drops, {} auras, {} costumes, {} uniforms, "
                 "{} series, {} constellations, {} missions, {} trophies, "
                 "{} music, {} tricks",
                 db.characters.size(), db.skills.size(), db.teams.size(),
                 db.items.size(), db.passives.size(), db.quests.size(),
                 db.special_tactics.size(), db.formations.size(),
                 db.basara_characters.size(), db.drop_tables.size(),
                 db.aura_skills.size(), db.costumes.size(), db.uniforms.size(),
                 db.series.size(), db.constellations.size(),
                 db.missions.size(), db.trophies.size(),
                 db.music.size(), db.tricks.size());

    return db;
}

std::vector<ParsedCharaParam> load_characters(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_characters(data_root / "common" / "gamedata", db);
    return std::move(db.characters);
}

std::vector<ParsedSkill> load_skills(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_skills(data_root / "common" / "gamedata", db);
    return std::move(db.skills);
}

std::vector<ParsedTeam> load_teams(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_teams(data_root / "common" / "gamedata", db);
    return std::move(db.teams);
}

std::vector<ParsedItem> load_items(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_items(data_root / "common" / "gamedata", db);
    return std::move(db.items);
}

std::vector<ParsedPassive> load_passives(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_passives(data_root / "common" / "gamedata", db);
    return std::move(db.passives);
}

std::vector<ParsedQuest> load_quests(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_quests(data_root / "common" / "gamedata", db);
    return std::move(db.quests);
}

std::vector<ParsedSpecialTactic> load_special_tactics(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_special_tactics(data_root / "common" / "gamedata", db);
    return std::move(db.special_tactics);
}

std::vector<ParsedFormation> load_formations(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_formations(data_root / "common" / "gamedata", db);
    return std::move(db.formations);
}

std::vector<ParsedShop> load_shops(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_shops(data_root / "common" / "gamedata", db);
    return std::move(db.shops);
}

std::vector<ParsedOpponentTeam> load_opponent_teams(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_opponent_teams(data_root / "common" / "gamedata", db);
    return std::move(db.opponent_teams);
}

std::vector<ParsedCostume> load_costumes(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_costumes(data_root / "common" / "gamedata", db);
    return std::move(db.costumes);
}

std::vector<ParsedUniform> load_uniforms(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_uniforms(data_root / "common" / "gamedata", db);
    return std::move(db.uniforms);
}

std::vector<ParsedSeries> load_series(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_series(data_root / "common" / "gamedata", db);
    return std::move(db.series);
}

std::vector<ParsedMission> load_missions(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_missions(data_root / "common" / "gamedata", db);
    return std::move(db.missions);
}

std::vector<ParsedTrophy> load_trophies(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_trophies(data_root / "common" / "gamedata", db);
    return std::move(db.trophies);
}

std::vector<ParsedMusic> load_music(const fs::path& data_root) {
    GameDatabase db;
    gd_loader_extract_music(data_root / "common" / "gamedata", db);
    return std::move(db.music);
}

CharacterStats calculate_stats_at_level(
    const GameDatabase& db, const ParsedCharaParam& chara, int level) {
    (void)db;

    const auto& s = chara.stats;
    auto interp = [level](int16_t s1, int16_t s30, int16_t s50, int16_t s99) -> int16_t {
        if (level <= 1) return s1;
        if (level <= 30) {
            float t = static_cast<float>(level - 1) / 29.0f;
            return static_cast<int16_t>(static_cast<float>(s1) + t * (static_cast<float>(s30) - static_cast<float>(s1)));
        }
        if (level <= 50) {
            float t = static_cast<float>(level - 30) / 20.0f;
            return static_cast<int16_t>(static_cast<float>(s30) + t * (static_cast<float>(s50) - static_cast<float>(s30)));
        }
        if (level <= 99) {
            float t = static_cast<float>(level - 50) / 49.0f;
            return static_cast<int16_t>(static_cast<float>(s50) + t * (static_cast<float>(s99) - static_cast<float>(s50)));
        }
        return s99;
    };

    CharacterStats result;
    result.kick         = interp(s.lv1.kick, s.lv30.kick, s.lv50.kick, s.lv99.kick);
    result.control      = interp(s.lv1.control, s.lv30.control, s.lv50.control, s.lv99.control);
    result.technique    = interp(s.lv1.technique, s.lv30.technique, s.lv50.technique, s.lv99.technique);
    result.pressure     = interp(s.lv1.pressure, s.lv30.pressure, s.lv50.pressure, s.lv99.pressure);
    result.physical     = interp(s.lv1.physical, s.lv30.physical, s.lv50.physical, s.lv99.physical);
    result.agility      = interp(s.lv1.agility, s.lv30.agility, s.lv50.agility, s.lv99.agility);
    result.intelligence = interp(s.lv1.intelligence, s.lv30.intelligence, s.lv50.intelligence, s.lv99.intelligence);
    return result;
}

std::vector<StatSnapshot> calculate_evolution_curve(
    const GameDatabase& db, const ParsedCharaParam& chara) {

    std::vector<StatSnapshot> curve;
    curve.reserve(99);

    // XP rarity rate
    float xp_rate = 1.0f;
    for (const auto& r : db.exp_rarity_rates) {
        if (r.rarity == chara.chara_rank) {
            xp_rate = r.rate;
            break;
        }
    }

    int32_t cumulative = 0;
    for (int level = 1; level <= 99; ++level) {
        StatSnapshot snap;
        snap.level = level;
        snap.stats = calculate_stats_at_level(db, chara, level);

        // XP from exp_table
        if (static_cast<size_t>(level - 1) < db.exp_table.size()) {
            snap.need_exp = static_cast<int32_t>(
                static_cast<float>(db.exp_table[static_cast<size_t>(level - 1)].need_exp) * xp_rate);
        }
        cumulative += snap.need_exp;
        snap.cumulative_exp = cumulative;

        curve.push_back(snap);
    }

    return curve;
}

} // namespace iecode::gamedata
