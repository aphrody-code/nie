/// @file ffi.cpp
/// Implementation de l'API FFI C pour bun:ffi (inagle) et autres runtimes.
///
/// Chaque handle opaque wrappe la structure C++ correspondante + un cache JSON.
/// Toutes les exceptions C++ sont attrapees a la frontiere FFI (retourne nullptr/0).
/// Thread-safe : aucun global mutable (sauf la string statique de version).

#include "iecode/ffi.h"

#include "iecode/compression/crilayla.h"
#include "iecode/formats/criware/cpk_writer.h"
#include "iecode/compression/huffman.h"
#include "iecode/compression/inazuma_lzss.h"
#include "iecode/compression/level5_compress.h"
#include "iecode/compression/lz10.h"
#include "iecode/compression/lz4_block.h"
#include "iecode/compression/rle.h"
#include "iecode/compression/zlib_decompress.h"
#include "iecode/converters/batch_converter.h"
#include "iecode/converters/texture_export.h"
#include "iecode/crypto/crc32.h"
#include "iecode/crypto/cri_crypto.h"
#include "iecode/formats/criware/acb_reader.h"
#include "iecode/formats/criware/awb_reader.h"
#include "iecode/formats/criware/cpk_reader.h"
#include "iecode/formats/criware/usm_demuxer.h"
#include "iecode/formats/dds_parser.h"
#include "iecode/formats/format_detector.h"
#include "iecode/formats/level5/anm_parser.h"
#include "iecode/formats/level5/cfgbin.h"
#include "iecode/formats/level5/fnt_parser.h"
#include "iecode/formats/level5/g4cm.h"
#include "iecode/engine/anim/anim_player.h"
#include "iecode/formats/level5/g4md.h"
#include "iecode/formats/level5/g4mg.h"
#include "iecode/formats/level5/g4pk.h"
#include "iecode/formats/level5/g4la.h"
#include "iecode/formats/level5/g4mt.h"
#include "iecode/formats/level5/g4ra.h"
#include "iecode/formats/level5/g4sk.h"
#include "iecode/formats/level5/g4tx.h"
#include "iecode/formats/level5/map_block_list.h"
#include "iecode/formats/level5/nxtch.h"
#include "iecode/formats/level5/tagged_bin.h"
#include "iecode/formats/criware/utf_parser.h"
#include "iecode/modding/mod_conflict_detector.h"
#include "iecode/modding/mod_installer.h"
#include "iecode/modding/mod_scanner.h"
#include "iecode/modding/profile_manager.h"
#include "iecode/gamedata/event_text.h"
#include "iecode/gamedata/loader.h"
#include "iecode/gamedata/types.h"
#include "iecode/services/eac_service.h"

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <new>
#include <string>
#include <string_view>
#include <type_traits>
#include <unordered_map>
#include <variant>
#include <vector>

// ── Version statique ─────────────────────────────────────────────────

static constexpr const char* IECODE_VERSION_STR = "1.0.0";

// ── Handles opaques ──────────────────────────────────────────────────

/// Handle cfg.bin (T2B ou RDBN).
struct iecode_result {
    iecode::level5::CfgBinFile cfg;
    mutable std::string json_cache;
    mutable std::string format_str;
    mutable bool json_computed = false;
};

/// Handle G4TX.
struct iecode_g4tx {
    iecode::level5::G4txFile file;
    mutable std::vector<std::string> info_cache; // Par texture, lazy
};

/// Handle CPK — stocke les donnees brutes + la liste d'entrees parsees.
/// Le CpkReader lit depuis un fichier path, donc pour l'API memoire on
/// re-implemente un mini-parser en reutilisant le CpkReader interne.
struct iecode_cpk {
    std::vector<uint8_t> data;                       // Copie du buffer utilisateur
    std::vector<iecode::criware::CpkEntry> entries;
    iecode::criware::CpkReader reader;               // Lecteur interne
    mutable std::string temp_path;                    // Fichier temporaire pour le reader
};

/// Handle GameDatabase.
struct iecode_gamedb {
    iecode::gamedata::GameDatabase db;
    mutable std::string full_json_cache;
    mutable bool full_json_computed = false;
    mutable std::vector<std::string> chara_json_cache;
    mutable std::vector<std::string> skill_json_cache;
    mutable std::vector<std::string> item_json_cache;
    mutable std::vector<std::string> passive_json_cache;
    mutable std::vector<std::string> quest_json_cache;
    mutable std::vector<std::string> tactic_json_cache;
    mutable std::vector<std::string> formation_json_cache;
    mutable std::vector<std::string> opponent_json_cache;
    mutable std::vector<std::string> shop_json_cache;
    mutable std::string growth_json_cache;
    mutable std::vector<std::string> enriched_json_cache;
    mutable bool chara_cache_built     = false;
    mutable bool skill_cache_built     = false;
    mutable bool item_cache_built      = false;
    mutable bool passive_cache_built   = false;
    mutable bool quest_cache_built     = false;
    mutable bool tactic_cache_built    = false;
    mutable bool formation_cache_built = false;
    mutable bool opponent_cache_built  = false;
    mutable bool shop_cache_built      = false;
    mutable bool growth_cache_built    = false;
    mutable bool enriched_cache_built  = false;
};

// ── Helpers de serialisation JSON (namespace anonyme) ─────────────────

namespace {

using json = nlohmann::json;

// ── Helpers FFI : transfert de buffers C++ vers le monde C ──────────────
//
// iecode_free() appelle delete[], donc tous les buffers exposes doivent etre
// alloues via new[]. On ne peut pas eviter la copie depuis un std::vector
// (allocateur incompatible), mais on centralise le pattern pour :
//   1. Utiliser std::nothrow (pas d'exception sur OOM dans le hot path)
//   2. Supprimer la duplication de code (15+ sites identiques)
//   3. Garantir la coherence des checks (vide → 0, null → 0)

/// Transfere un vector<uint8_t> vers un buffer new[]-alloue pour FFI.
/// Retourne la taille, 0 si le vecteur est vide ou l'allocation echoue.
[[nodiscard]] uint32_t vec_to_ffi(std::vector<uint8_t>& vec,
                                  uint8_t** out_buf) noexcept {
    if (vec.empty()) return 0;
    if (vec.size() > UINT32_MAX) return 0; // guard against size_t → uint32_t truncation
    auto* buf = new (std::nothrow) uint8_t[vec.size()];
    if (!buf) return 0;
    std::memcpy(buf, vec.data(), vec.size());
    *out_buf = buf;
    return static_cast<uint32_t>(vec.size());
}

/// Variante pour optional<vector<uint8_t>> (retour courant des decompresseurs).
[[nodiscard]] uint32_t opt_vec_to_ffi(std::optional<std::vector<uint8_t>>& opt,
                                      uint8_t** out_buf) noexcept {
    if (!opt || opt->empty()) return 0;
    return vec_to_ffi(*opt, out_buf);
}

/// Alloue une copie C (null-terminated) d'une std::string pour FFI.
/// L'appelant libere via iecode_free() qui fait delete[] uint8_t*.
/// On alloue donc en uint8_t[] pour que le type corresponde.
[[nodiscard]] const char* str_to_ffi(const std::string& str) noexcept {
    if (str.empty()) return nullptr;
    auto* buf = new (std::nothrow) uint8_t[str.size() + 1];
    if (!buf) return nullptr;
    std::memcpy(buf, str.c_str(), str.size() + 1);
    return reinterpret_cast<const char*>(buf);
}

/// Serialise un ParsedCharaParam en JSON.
json ffi_chara_to_json(const iecode::gamedata::ParsedCharaParam& c) {
    json j;
    j["charaParamId"] = c.chara_param_id;
    j["charaBaseId"] = c.chara_base_id;
    j["element"] = static_cast<int>(c.element);
    j["mainPosition"] = static_cast<int>(c.main_position);
    j["subPosition"] = static_cast<int>(c.sub_position);
    j["gender"] = static_cast<int>(c.gender);
    j["charaRank"] = c.chara_rank;
    j["growthPattern"] = c.growth_pattern;
    j["playStyle"] = c.play_style;

    auto& skills = j["skills"] = json::array();
    for (const auto& s : c.skills) {
        skills.push_back(json{{"skillId", s.skill_id}, {"learnLevel", s.learn_level}});
    }

    // Stats multi-niveaux
    auto stat_to_json = [](const iecode::gamedata::CharacterStats& s) -> json {
        return json{
            {"kick", s.kick}, {"control", s.control}, {"technique", s.technique},
            {"pressure", s.pressure}, {"physical", s.physical},
            {"agility", s.agility}, {"intelligence", s.intelligence}
        };
    };
    j["stats"] = json{
        {"lv1", stat_to_json(c.stats.lv1)},
        {"lv30", stat_to_json(c.stats.lv30)},
        {"lv50", stat_to_json(c.stats.lv50)},
        {"lv99", stat_to_json(c.stats.lv99)},
    };

    return j;
}

/// Serialise un ParsedSkill en JSON.
json ffi_skill_to_json(const iecode::gamedata::ParsedSkill& s) {
    json j;
    j["skillId"] = s.skill_id;
    j["skillIdStr"] = s.skill_id_str;
    j["nameHash"] = s.name_hash;
    j["descHash"] = s.desc_hash;
    j["powerMin"] = s.power_min;
    j["powerMax"] = s.power_max;
    j["tpCost"] = s.tp_cost;
    j["element"] = static_cast<int>(s.element);
    j["category"] = static_cast<int>(s.category);
    j["growthType"] = s.growth_type;
    j["recastTime"] = s.recast_time;
    j["isEldorado"] = s.is_eldorado;
    j["seriesId"] = s.series_id;

    // Noms localises
    json names;
    names["en"] = s.names.en;
    names["fr"] = s.names.fr;
    names["ja"] = s.names.ja;
    names["de"] = s.names.de;
    names["es"] = s.names.es;
    names["it"] = s.names.it;
    names["pt"] = s.names.pt;
    names["zh_hans"] = s.names.zh_hans;
    names["zh_hant"] = s.names.zh_hant;
    j["names"] = names;

    return j;
}

/// Serialise un ParsedTeam en JSON.
json ffi_team_to_json(const iecode::gamedata::ParsedTeam& t) {
    json j;
    j["teamId"] = t.team_id;
    j["orderType"] = t.order_type;
    j["seriesId"] = t.series_id;

    json names;
    names["en"] = t.names.en;
    names["fr"] = t.names.fr;
    names["ja"] = t.names.ja;
    names["de"] = t.names.de;
    names["es"] = t.names.es;
    names["it"] = t.names.it;
    names["pt"] = t.names.pt;
    names["zh_hans"] = t.names.zh_hans;
    names["zh_hant"] = t.names.zh_hant;
    j["names"] = names;
    return j;
}

/// Helper : serialise des LocalizedNames en JSON.
json ffi_names_to_json(const iecode::gamedata::LocalizedNames& n) {
    return json{
        {"en", n.en}, {"fr", n.fr}, {"ja", n.ja},
        {"de", n.de}, {"es", n.es}, {"it", n.it},
        {"pt", n.pt}, {"zh_hans", n.zh_hans}, {"zh_hant", n.zh_hant}
    };
}

/// Serialise un ParsedItem en JSON.
json ffi_item_to_json(const iecode::gamedata::ParsedItem& item) {
    return json{
        {"itemId", item.item_id},
        {"internalCode", item.internal_code},
        {"nameHash", item.name_hash},
        {"descHash", item.desc_hash},
        {"category", item.category},
        {"price", item.price_gp},
        {"stat1", item.stat1},
        {"stat2", item.stat2},
        {"uniformId", item.uniform_id},
        {"names", ffi_names_to_json(item.names)},
    };
}

/// Serialise un ParsedPassive en JSON.
json ffi_passive_to_json(const iecode::gamedata::ParsedPassive& p) {
    return json{
        {"passiveId", p.passive_id},
        {"effectId", p.effect_id},
        {"nameHash", p.name_hash},
        {"descHash", p.desc_hash},
        {"rarity", p.rarity},
        {"scope", p.scope},
        {"effectParams", p.effect_params},
        {"names", ffi_names_to_json(p.names)},
    };
}

/// Serialise un ParsedQuest en JSON.
json ffi_quest_to_json(const iecode::gamedata::ParsedQuest& q) {
    return json{
        {"questId", q.quest_id},
        {"titleHash", q.title_hash},
        {"phase", q.phase},
        {"type", q.type},
        {"image", q.image},
        {"titles", ffi_names_to_json(q.titles)},
    };
}

/// Serialise un ParsedSpecialTactic en JSON.
json ffi_tactic_to_json(const iecode::gamedata::ParsedSpecialTactic& t) {
    return json{
        {"tacticsId", t.tactics_id},
        {"internalCode", t.internal_code},
        {"nameHash", t.name_hash},
        {"descHash", t.desc_hash},
        {"power", t.power},
        {"recastTime", t.recast_time},
        {"element", static_cast<int>(t.element)},
        {"partnerIds", t.partner_ids},
        {"names", ffi_names_to_json(t.names)},
    };
}

/// Serialise un ParsedFormation en JSON.
json ffi_formation_to_json(const iecode::gamedata::ParsedFormation& f) {
    json j;
    j["formationId"] = f.formation_id;
    j["nounHash"] = f.noun_hash;
    j["descHash"] = f.desc_hash;
    j["powerOffense"] = f.power_offense;
    j["powerDefense"] = f.power_defense;
    j["names"] = ffi_names_to_json(f.names);

    auto& positions = j["positions"] = json::array();
    for (const auto& p : f.positions) {
        positions.push_back(json{
            {"positionNo", p.position_no},
            {"positionId", p.position_id},
            {"passNo", p.pass_no},
            {"bKickoff", p.b_kickoff},
            {"bFollow", p.b_follow},
            {"defensePos", {p.defense_pos[0], p.defense_pos[1]}},
            {"offensePos", {p.offense_pos[0], p.offense_pos[1]}},
            {"startPos", {p.start_pos[0], p.start_pos[1]}},
        });
    }
    return j;
}

/// Serialise un ParsedShop en JSON.
json ffi_shop_to_json(const iecode::gamedata::ParsedShop& s) {
    return json{
        {"shopId", s.shop_id},
        {"nameHash", s.name_hash},
        {"itemIds", s.item_ids},
    };
}

/// Serialise un ParsedOpponentTeam en JSON.
json ffi_opponent_to_json(const iecode::gamedata::ParsedOpponentTeam& o) {
    return json{
        {"opponentId", o.opponent_id},
        {"type", o.type},
        {"teamId", o.team_id},
        {"descTextId", o.desc_text_id},
        {"difficultyType", o.difficulty_type},
        {"bgTextureName", o.bg_texture_name},
        {"gameId", o.game_id},
    };
}

/// Serialise un EnrichedCharacter en JSON.
json ffi_enriched_to_json(const iecode::gamedata::EnrichedCharacter& c) {
    auto stat_block = [](const iecode::gamedata::CharacterStats& s) -> json {
        return json{
            {"kick", s.kick}, {"control", s.control}, {"technique", s.technique},
            {"pressure", s.pressure}, {"physical", s.physical},
            {"agility", s.agility}, {"intelligence", s.intelligence}
        };
    };

    json j;
    j["charaParamId"] = c.chara_param_id;
    j["charaBaseId"] = c.chara_base_id;
    j["internalCode"] = c.internal_code;
    j["names"] = ffi_names_to_json(c.names);
    j["element"] = static_cast<int>(c.element);
    j["mainPosition"] = static_cast<int>(c.main_position);
    j["subPosition"] = static_cast<int>(c.sub_position);
    j["gender"] = static_cast<int>(c.gender);
    j["charaRank"] = c.chara_rank;
    j["growthPattern"] = c.growth_pattern;
    j["playStyle"] = c.play_style;
    j["teamId"] = c.team_id;
    j["teamNames"] = ffi_names_to_json(c.team_names);
    j["seriesId"] = c.series_id;
    j["stats"] = json{
        {"lv1", stat_block(c.stats.lv1)},
        {"lv30", stat_block(c.stats.lv30)},
        {"lv50", stat_block(c.stats.lv50)},
        {"lv99", stat_block(c.stats.lv99)},
    };

    auto& skills = j["skills"] = json::array();
    for (const auto& s : c.skills) {
        skills.push_back(json{
            {"skillId", s.skill_id},
            {"learnLevel", s.learn_level},
            {"names", ffi_names_to_json(s.names)},
            {"powerMin", s.power_min},
            {"powerMax", s.power_max},
            {"element", static_cast<int>(s.element)},
        });
    }
    return j;
}

/// Serialise la GameDatabase complete en JSON.
std::string ffi_gamedb_to_json(const iecode::gamedata::GameDatabase& db) {
    json root;

    auto& chars = root["characters"] = json::array();
    for (const auto& c : db.characters) {
        chars.push_back(ffi_chara_to_json(c));
    }

    auto& skills = root["skills"] = json::array();
    for (const auto& s : db.skills) {
        skills.push_back(ffi_skill_to_json(s));
    }

    auto& teams = root["teams"] = json::array();
    for (const auto& t : db.teams) {
        teams.push_back(ffi_team_to_json(t));
    }

    auto& items = root["items"] = json::array();
    for (const auto& i : db.items) {
        items.push_back(ffi_item_to_json(i));
    }

    auto& passives = root["passives"] = json::array();
    for (const auto& p : db.passives) {
        passives.push_back(ffi_passive_to_json(p));
    }

    auto& quests = root["quests"] = json::array();
    for (const auto& q : db.quests) {
        quests.push_back(ffi_quest_to_json(q));
    }

    auto& tactics = root["specialTactics"] = json::array();
    for (const auto& t : db.special_tactics) {
        tactics.push_back(ffi_tactic_to_json(t));
    }

    auto& formations = root["formations"] = json::array();
    for (const auto& f : db.formations) {
        formations.push_back(ffi_formation_to_json(f));
    }

    auto& shops = root["shops"] = json::array();
    for (const auto& s : db.shops) {
        shops.push_back(ffi_shop_to_json(s));
    }

    auto& opponents = root["opponentTeams"] = json::array();
    for (const auto& o : db.opponent_teams) {
        opponents.push_back(ffi_opponent_to_json(o));
    }

    root["stats"] = json{
        {"characterCount", db.characters.size()},
        {"skillCount", db.skills.size()},
        {"teamCount", db.teams.size()},
        {"itemCount", db.items.size()},
        {"passiveCount", db.passives.size()},
        {"questCount", db.quests.size()},
        {"tacticCount", db.special_tactics.size()},
        {"formationCount", db.formations.size()},
        {"shopCount", db.shops.size()},
        {"opponentCount", db.opponent_teams.size()},
        {"growthLv1Count", db.growth_lv1.size()},
        {"growthLv30Count", db.growth_lv30.size()},
    };

    return root.dump(2);
}

/// Nom du format G4TX en string.
const char* ffi_g4tx_format_name(iecode::level5::G4txFormat fmt) noexcept {
    switch (fmt) {
        case iecode::level5::G4txFormat::BC1:     return "BC1";
        case iecode::level5::G4txFormat::BC2:     return "BC2";
        case iecode::level5::G4txFormat::BC3:     return "BC3";
        case iecode::level5::G4txFormat::BC4:     return "BC4";
        case iecode::level5::G4txFormat::BC5:     return "BC5";
        case iecode::level5::G4txFormat::BC6H:    return "BC6H";
        case iecode::level5::G4txFormat::BC7:     return "BC7";
        case iecode::level5::G4txFormat::RGBA8:   return "RGBA8";
        default:                                  return "Unknown";
    }
}

/// Convertit un ExportFormat string en enum.
iecode::converters::ExportFormat ffi_parse_format(const char* fmt) noexcept {
    if (!fmt) return iecode::converters::ExportFormat::PNG;
    if (std::strcmp(fmt, "webp") == 0 || std::strcmp(fmt, "WebP") == 0)
        return iecode::converters::ExportFormat::WebP;
    if (std::strcmp(fmt, "dds") == 0 || std::strcmp(fmt, "DDS") == 0)
        return iecode::converters::ExportFormat::DDS;
    return iecode::converters::ExportFormat::PNG;
}

} // namespace anonyme

// ══════════════════════════════════════════════════════════════════════
//  Implementation des fonctions FFI extern "C"
// ══════════════════════════════════════════════════════════════════════

extern "C" {

// ── Lifecycle ────────────────────────────────────────────────────────

const char* iecode_version(void) {
    return IECODE_VERSION_STR;
}

void iecode_free(void* ptr) {
    delete[] static_cast<uint8_t*>(ptr);
}

// ── cfg.bin ──────────────────────────────────────────────────────────

iecode_result_t* iecode_cfgbin_parse(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::cfgbin_parse(span);
        if (!parsed) return nullptr;

        auto* result = new iecode_result();
        result->cfg = std::move(*parsed);
        return result;
    } catch (...) {
        return nullptr;
    }
}

const char* iecode_result_json(const iecode_result_t* result) {
    if (!result) return "";
    try {
        if (!result->json_computed) {
            result->json_cache = iecode::level5::cfgbin_to_json(result->cfg);
            result->json_computed = true;
        }
        return result->json_cache.c_str();
    } catch (...) {
        return "";
    }
}

const char* iecode_result_format(const iecode_result_t* result) {
    if (!result) return "unknown";
    switch (result->cfg.format) {
        case iecode::level5::CfgBinFile::Format::T2B:  return "t2b";
        case iecode::level5::CfgBinFile::Format::RDBN: return "rdbn";
        default:                                        return "unknown";
    }
}

void iecode_result_free(iecode_result_t* result) {
    delete result;
}

// ── G4TX (textures) ──────────────────────────────────────────────────

iecode_g4tx_t* iecode_g4tx_parse(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::g4tx_parse(span);
        if (!parsed) return nullptr;

        auto* g4tx = new iecode_g4tx();
        g4tx->file = std::move(*parsed);
        return g4tx;
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_g4tx_count(const iecode_g4tx_t* g4tx) {
    if (!g4tx) return 0;
    return static_cast<int32_t>(g4tx->file.textures.size());
}

int iecode_g4tx_export_png(const iecode_g4tx_t* g4tx, int32_t idx,
                           const char* output_path) {
    try {
        if (!g4tx || !output_path) return 0;
        if (idx < 0 || static_cast<size_t>(idx) >= g4tx->file.textures.size()) return 0;

        return iecode::converters::export_png(
            g4tx->file.textures[static_cast<size_t>(idx)],
            std::filesystem::path(output_path)) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_g4tx_export_webp(const iecode_g4tx_t* g4tx, int32_t idx,
                            const char* output_path, int quality) {
    try {
        if (!g4tx || !output_path) return 0;
        if (idx < 0 || static_cast<size_t>(idx) >= g4tx->file.textures.size()) return 0;

        return iecode::converters::export_webp(
            g4tx->file.textures[static_cast<size_t>(idx)],
            std::filesystem::path(output_path),
            quality) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

uint8_t* iecode_g4tx_decode_rgba(const iecode_g4tx_t* g4tx, int32_t idx,
                                 int32_t* out_width, int32_t* out_height) {
    try {
        if (!g4tx || !out_width || !out_height) return nullptr;
        if (idx < 0 || static_cast<size_t>(idx) >= g4tx->file.textures.size()) return nullptr;

        const auto& tex = g4tx->file.textures[static_cast<size_t>(idx)];
        auto rgba = iecode::converters::decode_to_rgba8(tex);
        if (rgba.empty()) return nullptr;

        *out_width = static_cast<int32_t>(tex.width);
        *out_height = static_cast<int32_t>(tex.height);

        uint8_t* out_buf = nullptr;
        (void)vec_to_ffi(rgba, &out_buf);
        return out_buf;
    } catch (...) {
        return nullptr;
    }
}

const char* iecode_g4tx_info(const iecode_g4tx_t* g4tx, int32_t idx) {
    if (!g4tx) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= g4tx->file.textures.size()) return "";

    try {
        // Initialiser le cache si necessaire
        if (g4tx->info_cache.empty()) {
            g4tx->info_cache.resize(g4tx->file.textures.size());
        }

        auto uidx = static_cast<size_t>(idx);
        if (g4tx->info_cache[uidx].empty()) {
            const auto& tex = g4tx->file.textures[uidx];
            json j;
            j["index"] = uidx;
            j["name"] = tex.name;
            j["width"] = tex.width;
            j["height"] = tex.height;
            j["format"] = ffi_g4tx_format_name(tex.format);
            j["mipCount"] = tex.mip_count;
            j["isDds"] = tex.is_dds;
            j["dataSize"] = tex.data.size();
            j["subTextureCount"] = tex.sub_textures.size();
            g4tx->info_cache[uidx] = j.dump();
        }

        return g4tx->info_cache[uidx].c_str();
    } catch (...) {
        return "";
    }
}

int iecode_g4tx_get_surface(const iecode_g4tx_t* g4tx, int32_t idx,
                            iecode_surface_t* out_surface) {
    try {
        if (!g4tx || !out_surface) return -1;
        if (idx < 0 || static_cast<size_t>(idx) >= g4tx->file.textures.size()) return -1;

        const auto& tex = g4tx->file.textures[static_cast<size_t>(idx)];
        if (tex.data.empty()) return -1;

        const auto fmt = static_cast<int32_t>(tex.format);

        out_surface->data       = tex.data.data();
        out_surface->data_size  = static_cast<uint32_t>(tex.data.size());
        out_surface->width      = static_cast<int32_t>(tex.width);
        out_surface->height     = static_cast<int32_t>(tex.height);
        out_surface->format     = fmt;
        out_surface->mip_count  = static_cast<int32_t>(tex.mip_count);
        out_surface->block_size = iecode::level5::bcn_block_size(static_cast<uint32_t>(fmt));

        return 0;
    } catch (...) {
        return -1;
    }
}

uint32_t iecode_bcn_to_dxgi(int32_t bcn_format) {
    switch (bcn_format) {
        case 0x01: return 71;   // DXGI_FORMAT_BC1_UNORM
        case 0x02: return 74;   // DXGI_FORMAT_BC2_UNORM
        case 0x03: return 77;   // DXGI_FORMAT_BC3_UNORM
        case 0x04: return 80;   // DXGI_FORMAT_BC4_UNORM
        case 0x05: return 83;   // DXGI_FORMAT_BC5_UNORM
        case 0x06: return 95;   // DXGI_FORMAT_BC6H_UF16
        case 0x07: return 98;   // DXGI_FORMAT_BC7_UNORM
        case 0x1F: return 28;   // DXGI_FORMAT_R8G8B8A8_UNORM
        default:   return 0;    // DXGI_FORMAT_UNKNOWN
    }
}

void iecode_g4tx_free(iecode_g4tx_t* g4tx) {
    delete g4tx;
}

// ── Compression ──────────────────────────────────────────────────────

uint32_t iecode_lz10_decompress(const uint8_t* data, uint32_t size,
                                uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::lz10_decompress(span);
        return vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

uint32_t iecode_crilayla_decompress(const uint8_t* data, uint32_t size,
                                    uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::crilayla_decompress(span);
        return vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

uint32_t iecode_lz4_decompress(const uint8_t* data, uint32_t size,
                               uint32_t decompressed_size,
                               uint8_t** out_buf) {
    try {
        if (!data || size == 0 || decompressed_size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::lz4_decompress(span, decompressed_size);
        return vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

// ── Crypto ───────────────────────────────────────────────────────────

uint32_t iecode_crc32(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return iecode::crypto::crc32_compute(span);
    } catch (...) {
        return 0;
    }
}

void iecode_cri_decrypt(uint8_t* data, uint32_t size, uint32_t key) {
    try {
        if (!data || size == 0) return;
        auto span = std::span<uint8_t>(data, size);
        iecode::crypto::cri_decrypt(span, key);
    } catch (...) {
        // Silencieux — operation in-place, pas de valeur de retour
    }
}

uint32_t iecode_cri_derive_key(const char* filename) {
    try {
        if (!filename) return 0;
        return iecode::crypto::cri_derive_key(std::string_view(filename));
    } catch (...) {
        return 0;
    }
}

// ── CPK ──────────────────────────────────────────────────────────────
//
// Le CpkReader existant lit depuis un fichier path. Pour l'API FFI memoire,
// on ecrit le buffer dans un fichier temporaire, puis on utilise le reader.
// C'est un compromis pragmatique : le reader parse correctement les tables
// @UTF, gere le dechiffrement et la decompression CRILAYLA.

iecode_cpk_t* iecode_cpk_open(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto* cpk = new iecode_cpk();

        // Copier les donnees
        cpk->data.assign(data, data + size);

        // Ecrire dans un fichier temporaire pour le reader
        cpk->temp_path = (std::filesystem::temp_directory_path() /
            fmt::format("iecode_cpk_{}.tmp", reinterpret_cast<uintptr_t>(cpk))).string();

        {
            std::ofstream f(cpk->temp_path, std::ios::binary);
            if (!f) {
                delete cpk;
                return nullptr;
            }
            f.write(reinterpret_cast<const char*>(data), size);
        }

        // Ouvrir avec le reader
        if (!cpk->reader.open(cpk->temp_path)) {
            // Nettoyer le fichier temporaire
            std::filesystem::remove(cpk->temp_path);
            delete cpk;
            return nullptr;
        }

        // Copier la liste d'entrees pour l'acces indexe
        cpk->entries = cpk->reader.list();

        return cpk;
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_cpk_count(const iecode_cpk_t* cpk) {
    if (!cpk) return 0;
    return static_cast<int32_t>(cpk->entries.size());
}

const char* iecode_cpk_filename(const iecode_cpk_t* cpk, int32_t idx) {
    if (!cpk) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= cpk->entries.size()) return "";
    return cpk->entries[static_cast<size_t>(idx)].filename.c_str();
}

uint8_t* iecode_cpk_extract(const iecode_cpk_t* cpk, int32_t idx,
                            uint32_t* out_size) {
    try {
        if (!cpk || !out_size) return nullptr;
        if (idx < 0 || static_cast<size_t>(idx) >= cpk->entries.size()) return nullptr;
        *out_size = 0;

        auto result = cpk->reader.extract(cpk->entries[static_cast<size_t>(idx)]);
        uint8_t* out_buf = nullptr;
        *out_size = vec_to_ffi(result, &out_buf);
        return out_buf;
    } catch (...) {
        return nullptr;
    }
}

void iecode_cpk_free(iecode_cpk_t* cpk) {
    if (cpk) {
        // Nettoyer le fichier temporaire
        if (!cpk->temp_path.empty()) {
            std::error_code ec;
            std::filesystem::remove(cpk->temp_path, ec);
        }
        delete cpk;
    }
}

// ── CPK — open_file, read_file, find_entry, entry accessors ─────────

iecode_cpk_t* iecode_cpk_open_file(const char* path) {
    try {
        if (!path) return nullptr;

        auto* cpk = new (std::nothrow) iecode_cpk();
        if (!cpk) return nullptr;

        if (!cpk->reader.open(std::filesystem::path(path))) {
            delete cpk;
            return nullptr;
        }

        cpk->entries = cpk->reader.list();
        return cpk;
    } catch (...) {
        return nullptr;
    }
}

} // extern "C" — pause pour helper C++

/// Helper : construit le chemin complet d'une entree CPK (directory/filename).
static std::string cpk_entry_full_path(const iecode::criware::CpkEntry& e) {
    if (e.directory.empty()) return e.filename;
    return e.directory + "/" + e.filename;
}

extern "C" {

uint8_t* iecode_cpk_read_file(iecode_cpk_t* cpk, const char* internal_path,
                               uint32_t* out_size) {
    try {
        if (!cpk || !internal_path || !out_size) return nullptr;
        *out_size = 0;

        const std::string target(internal_path);
        for (size_t i = 0; i < cpk->entries.size(); ++i) {
            if (cpk_entry_full_path(cpk->entries[i]) == target) {
                auto result = cpk->reader.extract(cpk->entries[i]);
                uint8_t* out_buf = nullptr;
                *out_size = vec_to_ffi(result, &out_buf);
                return out_buf;
            }
        }
        return nullptr; // Non trouve
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_cpk_find_entry(iecode_cpk_t* cpk, const char* internal_path) {
    try {
        if (!cpk || !internal_path) return -1;

        const std::string target(internal_path);
        for (size_t i = 0; i < cpk->entries.size(); ++i) {
            if (cpk_entry_full_path(cpk->entries[i]) == target) {
                return static_cast<int32_t>(i);
            }
        }
        return -1;
    } catch (...) {
        return -1;
    }
}

uint32_t iecode_cpk_entry_size(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk || index < 0 || static_cast<size_t>(index) >= cpk->entries.size()) return 0;
    return static_cast<uint32_t>(cpk->entries[static_cast<size_t>(index)].size);
}

uint32_t iecode_cpk_entry_extract_size(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk || index < 0 || static_cast<size_t>(index) >= cpk->entries.size()) return 0;
    return static_cast<uint32_t>(cpk->entries[static_cast<size_t>(index)].extract_size);
}

int32_t iecode_cpk_entry_is_compressed(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk || index < 0 || static_cast<size_t>(index) >= cpk->entries.size()) return -1;
    return cpk->entries[static_cast<size_t>(index)].is_compressed ? 1 : 0;
}

const char* iecode_cpk_entry_directory(iecode_cpk_t* cpk, int32_t index) {
    if (!cpk || index < 0 || static_cast<size_t>(index) >= cpk->entries.size()) return "";
    return cpk->entries[static_cast<size_t>(index)].directory.c_str();
}

// ── CPK — patch, rebuild, rebuild_with_mods ─────────────────────────

int32_t iecode_cpk_patch(const char* cpk_path, const char* internal_path,
                          const uint8_t* new_data, uint32_t new_size) {
    try {
        if (!cpk_path || !internal_path || !new_data || new_size == 0) return -1;

        auto span = std::span<const uint8_t>(new_data, new_size);
        bool ok = iecode::criware::cpk_patch_file(
            std::filesystem::path(cpk_path),
            std::string(internal_path),
            span);
        return ok ? 0 : -1;
    } catch (...) {
        return -1;
    }
}

int32_t iecode_cpk_rebuild(const char* output_path, const char* entries_json) {
    try {
        if (!output_path || !entries_json) return -1;

        auto j = nlohmann::json::parse(entries_json, nullptr, false);
        if (!j.is_array()) {
            spdlog::error("iecode_cpk_rebuild: entries_json n'est pas un tableau JSON");
            return -1;
        }

        std::vector<iecode::criware::CpkWriteEntry> entries;
        entries.reserve(j.size());

        for (const auto& item : j) {
            iecode::criware::CpkWriteEntry entry;
            entry.filename  = item.value("filename", "");
            entry.directory = item.value("directory", "");
            entry.compress  = item.value("compress", false);

            // Lire les donnees depuis un fichier sur disque
            std::string file_path = item.value("file_path", "");
            if (file_path.empty()) {
                spdlog::error("iecode_cpk_rebuild: entree sans 'file_path'");
                return -1;
            }

            std::ifstream f(file_path, std::ios::binary | std::ios::ate);
            if (!f) {
                spdlog::error("iecode_cpk_rebuild: impossible d'ouvrir '{}'", file_path);
                return -1;
            }
            auto sz = f.tellg();
            f.seekg(0);
            entry.data.resize(static_cast<size_t>(sz));
            f.read(reinterpret_cast<char*>(entry.data.data()), sz);

            entries.push_back(std::move(entry));
        }

        bool ok = iecode::criware::cpk_rebuild(entries, std::filesystem::path(output_path));
        return ok ? 0 : -1;
    } catch (const nlohmann::json::exception& e) {
        spdlog::error("iecode_cpk_rebuild: erreur JSON — {}", e.what());
        return -1;
    } catch (...) {
        return -1;
    }
}

int32_t iecode_cpk_rebuild_with_mods(const char* source_cpk_path,
                                      const char* output_path,
                                      const char* mods_json) {
    try {
        if (!source_cpk_path || !output_path || !mods_json) return -1;

        // Parser le JSON des mods
        auto j = nlohmann::json::parse(mods_json, nullptr, false);
        if (!j.is_array()) {
            spdlog::error("iecode_cpk_rebuild_with_mods: mods_json n'est pas un tableau JSON");
            return -1;
        }

        // Construire un index des mods : internal_path -> {file_path, compress}
        struct ModEntry {
            std::string file_path;
            bool compress = false;
        };
        std::unordered_map<std::string, ModEntry> mods_map;
        for (const auto& item : j) {
            std::string ipath = item.value("internal_path", "");
            if (ipath.empty()) {
                spdlog::error("iecode_cpk_rebuild_with_mods: entree mod sans 'internal_path'");
                return -1;
            }
            mods_map[ipath] = ModEntry{
                .file_path = item.value("file_path", ""),
                .compress  = item.value("compress", false)
            };
        }

        // Ouvrir le CPK source
        iecode::criware::CpkReader reader;
        if (!reader.open(std::filesystem::path(source_cpk_path))) {
            spdlog::error("iecode_cpk_rebuild_with_mods: impossible d'ouvrir '{}'",
                          source_cpk_path);
            return -1;
        }

        // Construire la liste d'entrees pour le rebuild
        std::vector<iecode::criware::CpkWriteEntry> entries;
        entries.reserve(reader.list().size());

        for (const auto& cpk_entry : reader.list()) {
            iecode::criware::CpkWriteEntry we;
            we.filename  = cpk_entry.filename;
            we.directory = cpk_entry.directory;

            std::string full_path = cpk_entry_full_path(cpk_entry);
            auto it = mods_map.find(full_path);

            if (it != mods_map.end()) {
                // Entree modifiee : lire les nouvelles donnees depuis le fichier disque
                const auto& mod = it->second;
                we.compress = mod.compress;

                std::ifstream f(mod.file_path, std::ios::binary | std::ios::ate);
                if (!f) {
                    spdlog::error("iecode_cpk_rebuild_with_mods: impossible d'ouvrir le mod '{}'",
                                  mod.file_path);
                    return -1;
                }
                auto sz = f.tellg();
                f.seekg(0);
                we.data.resize(static_cast<size_t>(sz));
                f.read(reinterpret_cast<char*>(we.data.data()), sz);
            } else {
                // Entree originale : extraire depuis le CPK source
                we.data = reader.extract(cpk_entry);
                we.compress = cpk_entry.is_compressed;
            }

            entries.push_back(std::move(we));
        }

        bool ok = iecode::criware::cpk_rebuild(entries, std::filesystem::path(output_path));
        return ok ? 0 : -1;
    } catch (const nlohmann::json::exception& e) {
        spdlog::error("iecode_cpk_rebuild_with_mods: erreur JSON — {}", e.what());
        return -1;
    } catch (...) {
        return -1;
    }
}

// ── Game Database ────────────────────────────────────────────────────

iecode_gamedb_t* iecode_gamedb_load(const char* data_root, int load_text) {
    try {
        if (!data_root) return nullptr;

        auto db = iecode::gamedata::load_game_database(
            std::filesystem::path(data_root),
            load_text != 0);
        if (!db) return nullptr;

        auto* handle = new iecode_gamedb();
        handle->db = std::move(*db);
        return handle;
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_gamedb_chara_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.characters.size());
}

int32_t iecode_gamedb_skill_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.skills.size());
}

int32_t iecode_gamedb_team_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.teams.size());
}

const char* iecode_gamedb_json(const iecode_gamedb_t* db) {
    if (!db) return "";
    try {
        if (!db->full_json_computed) {
            db->full_json_cache = ffi_gamedb_to_json(db->db);
            db->full_json_computed = true;
        }
        return db->full_json_cache.c_str();
    } catch (...) {
        return "";
    }
}

const char* iecode_gamedb_chara_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.characters.size()) return "";

    try {
        // Construire le cache si necessaire
        if (!db->chara_cache_built) {
            db->chara_json_cache.resize(db->db.characters.size());
            db->chara_cache_built = true;
        }

        auto uidx = static_cast<size_t>(idx);
        if (db->chara_json_cache[uidx].empty()) {
            db->chara_json_cache[uidx] = ffi_chara_to_json(db->db.characters[uidx]).dump();
        }
        return db->chara_json_cache[uidx].c_str();
    } catch (...) {
        return "";
    }
}

const char* iecode_gamedb_skill_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.skills.size()) return "";

    try {
        // Construire le cache si necessaire
        if (!db->skill_cache_built) {
            db->skill_json_cache.resize(db->db.skills.size());
            db->skill_cache_built = true;
        }

        auto uidx = static_cast<size_t>(idx);
        if (db->skill_json_cache[uidx].empty()) {
            db->skill_json_cache[uidx] = ffi_skill_to_json(db->db.skills[uidx]).dump();
        }
        return db->skill_json_cache[uidx].c_str();
    } catch (...) {
        return "";
    }
}

int32_t iecode_gamedb_find_chara(const iecode_gamedb_t* db, const char* chara_param_id) {
    if (!db || !chara_param_id) return -1;
    try {
        // NOTE: std::unordered_map<std::string, ...> ne supporte pas le lookup
        // heterogene (string_view) sans comparateurs transparents (C++20 requires
        // Hash::is_transparent + KeyEqual::is_transparent). Le cout de la std::string
        // temporaire est acceptable ici (lookup ponctuel, pas un hot path).
        // Pour un acces O(1) sans allocation, migrer vers une map avec
        // transparent hash (ex: absl::flat_hash_map ou hash/eq personnalises).
        auto it = db->db.chara_by_id.find(std::string(chara_param_id));
        if (it == db->db.chara_by_id.end()) return -1;
        return static_cast<int32_t>(it->second);
    } catch (...) {
        return -1;
    }
}

int32_t iecode_gamedb_find_skill(const iecode_gamedb_t* db, const char* skill_id) {
    if (!db || !skill_id) return -1;
    try {
        // Meme limitation que find_chara — voir commentaire ci-dessus.
        auto it = db->db.skill_by_id.find(std::string(skill_id));
        if (it == db->db.skill_by_id.end()) return -1;
        return static_cast<int32_t>(it->second);
    } catch (...) {
        return -1;
    }
}

// ── Items ──────────────────────────────────────────────────────────────

int32_t iecode_gamedb_item_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.items.size());
}

const char* iecode_gamedb_item_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.items.size()) return "";
    try {
        if (!db->item_cache_built) {
            db->item_json_cache.resize(db->db.items.size());
            db->item_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->item_json_cache[uidx].empty()) {
            db->item_json_cache[uidx] = ffi_item_to_json(db->db.items[uidx]).dump();
        }
        return db->item_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

int32_t iecode_gamedb_find_item(const iecode_gamedb_t* db, const char* item_id) {
    if (!db || !item_id) return -1;
    try {
        auto it = db->db.item_by_id.find(std::string(item_id));
        if (it == db->db.item_by_id.end()) return -1;
        return static_cast<int32_t>(it->second);
    } catch (...) { return -1; }
}

// ── Passives ──────────────────────────────────────────────────────────

int32_t iecode_gamedb_passive_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.passives.size());
}

const char* iecode_gamedb_passive_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.passives.size()) return "";
    try {
        if (!db->passive_cache_built) {
            db->passive_json_cache.resize(db->db.passives.size());
            db->passive_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->passive_json_cache[uidx].empty()) {
            db->passive_json_cache[uidx] = ffi_passive_to_json(db->db.passives[uidx]).dump();
        }
        return db->passive_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

int32_t iecode_gamedb_find_passive(const iecode_gamedb_t* db, const char* passive_id) {
    if (!db || !passive_id) return -1;
    try {
        auto it = db->db.passive_by_id.find(std::string(passive_id));
        if (it == db->db.passive_by_id.end()) return -1;
        return static_cast<int32_t>(it->second);
    } catch (...) { return -1; }
}

// ── Quests ────────────────────────────────────────────────────────────

int32_t iecode_gamedb_quest_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.quests.size());
}

const char* iecode_gamedb_quest_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.quests.size()) return "";
    try {
        if (!db->quest_cache_built) {
            db->quest_json_cache.resize(db->db.quests.size());
            db->quest_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->quest_json_cache[uidx].empty()) {
            db->quest_json_cache[uidx] = ffi_quest_to_json(db->db.quests[uidx]).dump();
        }
        return db->quest_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

// ── Special Tactics ───────────────────────────────────────────────────

int32_t iecode_gamedb_tactic_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.special_tactics.size());
}

const char* iecode_gamedb_tactic_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.special_tactics.size()) return "";
    try {
        if (!db->tactic_cache_built) {
            db->tactic_json_cache.resize(db->db.special_tactics.size());
            db->tactic_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->tactic_json_cache[uidx].empty()) {
            db->tactic_json_cache[uidx] = ffi_tactic_to_json(db->db.special_tactics[uidx]).dump();
        }
        return db->tactic_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

int32_t iecode_gamedb_find_tactic(const iecode_gamedb_t* db, const char* tactic_id) {
    if (!db || !tactic_id) return -1;
    try {
        auto it = db->db.tactic_by_id.find(std::string(tactic_id));
        if (it == db->db.tactic_by_id.end()) return -1;
        return static_cast<int32_t>(it->second);
    } catch (...) { return -1; }
}

// ── Formations ────────────────────────────────────────────────────────

int32_t iecode_gamedb_formation_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.formations.size());
}

const char* iecode_gamedb_formation_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.formations.size()) return "";
    try {
        if (!db->formation_cache_built) {
            db->formation_json_cache.resize(db->db.formations.size());
            db->formation_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->formation_json_cache[uidx].empty()) {
            db->formation_json_cache[uidx] = ffi_formation_to_json(db->db.formations[uidx]).dump();
        }
        return db->formation_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

// ── Opponent Teams ────────────────────────────────────────────────────

int32_t iecode_gamedb_opponent_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.opponent_teams.size());
}

const char* iecode_gamedb_opponent_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.opponent_teams.size()) return "";
    try {
        if (!db->opponent_cache_built) {
            db->opponent_json_cache.resize(db->db.opponent_teams.size());
            db->opponent_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->opponent_json_cache[uidx].empty()) {
            db->opponent_json_cache[uidx] = ffi_opponent_to_json(db->db.opponent_teams[uidx]).dump();
        }
        return db->opponent_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

// ── Shops ─────────────────────────────────────────────────────────────

int32_t iecode_gamedb_shop_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.shops.size());
}

const char* iecode_gamedb_shop_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.shops.size()) return "";
    try {
        if (!db->shop_cache_built) {
            db->shop_json_cache.resize(db->db.shops.size());
            db->shop_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->shop_json_cache[uidx].empty()) {
            db->shop_json_cache[uidx] = ffi_shop_to_json(db->db.shops[uidx]).dump();
        }
        return db->shop_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

// ── Growth Tables ─────────────────────────────────────────────────────

const char* iecode_gamedb_growth_json(const iecode_gamedb_t* db) {
    if (!db) return "";
    try {
        if (!db->growth_cache_built) {
            json root;
            auto& lv1 = root["lv1"] = json::array();
            for (const auto& r : db->db.growth_lv1) {
                lv1.push_back(json{
                    {"mainPosition", r.main_position},
                    {"subPosition", r.sub_position},
                    {"playStyle", r.play_style},
                    {"kick", r.stats.kick}, {"control", r.stats.control},
                    {"technique", r.stats.technique}, {"pressure", r.stats.pressure},
                    {"physical", r.stats.physical}, {"agility", r.stats.agility},
                    {"intelligence", r.stats.intelligence},
                });
            }
            auto& lv30 = root["lv30"] = json::array();
            for (const auto& r : db->db.growth_lv30) {
                lv30.push_back(json{
                    {"mainPosition", r.main_position},
                    {"subPosition", r.sub_position},
                    {"growthPattern", r.growth_pattern},
                    {"charaRank", r.chara_rank},
                    {"kick", r.stats.kick}, {"control", r.stats.control},
                    {"technique", r.stats.technique}, {"pressure", r.stats.pressure},
                    {"physical", r.stats.physical}, {"agility", r.stats.agility},
                    {"intelligence", r.stats.intelligence},
                });
            }
            db->growth_json_cache = root.dump(2);
            db->growth_cache_built = true;
        }
        return db->growth_json_cache.c_str();
    } catch (...) { return ""; }
}

// ── Enriched Characters ───────────────────────────────────────────────

int32_t iecode_gamedb_enriched_count(const iecode_gamedb_t* db) {
    if (!db) return 0;
    return static_cast<int32_t>(db->db.enriched_characters.size());
}

const char* iecode_gamedb_enriched_json(const iecode_gamedb_t* db, int32_t idx) {
    if (!db) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= db->db.enriched_characters.size()) return "";
    try {
        if (!db->enriched_cache_built) {
            db->enriched_json_cache.resize(db->db.enriched_characters.size());
            db->enriched_cache_built = true;
        }
        auto uidx = static_cast<size_t>(idx);
        if (db->enriched_json_cache[uidx].empty()) {
            db->enriched_json_cache[uidx] =
                ffi_enriched_to_json(db->db.enriched_characters[uidx]).dump();
        }
        return db->enriched_json_cache[uidx].c_str();
    } catch (...) { return ""; }
}

int32_t iecode_gamedb_find_enriched(const iecode_gamedb_t* db, const char* chara_param_id) {
    if (!db || !chara_param_id) return -1;
    try {
        // Enriched characters are in same order as characters, same index
        auto it = db->db.chara_by_id.find(std::string(chara_param_id));
        if (it == db->db.chara_by_id.end()) return -1;
        auto idx = it->second;
        if (idx >= db->db.enriched_characters.size()) return -1;
        return static_cast<int32_t>(idx);
    } catch (...) { return -1; }
}

// ── Free ──────────────────────────────────────────────────────────────

void iecode_gamedb_free(iecode_gamedb_t* db) {
    delete db;
}

// ── Batch conversion ─────────────────────────────────────────────────

int32_t iecode_batch_convert(const char* input_dir,
                             const char* output_dir,
                             const char* format,
                             int32_t threads,
                             int recursive,
                             int flat) {
    try {
        if (!input_dir || !output_dir) return 0;

        iecode::converters::BatchOptions opts;
        opts.format = ffi_parse_format(format);
        opts.threads = threads;
        opts.recursive = (recursive != 0);
        opts.flat_output = (flat != 0);

        iecode::converters::BatchStats stats;
        auto result = iecode::converters::batch_convert(
            std::filesystem::path(input_dir),
            std::filesystem::path(output_dir),
            opts,
            stats);

        return static_cast<int32_t>(result);
    } catch (...) {
        return 0;
    }
}

// ── AWB (AFS2) ──────────────────────────────────────────────────────

// ── USM (video CRI Sofdec2) ──────────────────────────────────────────

const char* iecode_usm_info(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::criware::usm_parse_header(span);
        if (!parsed) return nullptr;

        json j;
        j["version"] = parsed->version;

        auto& streams = j["streams"] = json::array();
        // Pre-allouer pour eviter les reallocs dans la boucle
        streams.get_ref<json::array_t&>().reserve(parsed->streams.size());
        for (const auto& s : parsed->streams) {
            json sj;
            sj["stmid"] = fmt::format("{:#010x}", s.stmid);
            sj["stmid_name"] = iecode::criware::usm_stmid_name(s.stmid);
            sj["codec"] = s.codec;
            sj["chunk_count"] = s.chunks.size();
            if (s.width > 0)  sj["width"] = s.width;
            if (s.height > 0) sj["height"] = s.height;
            if (s.sample_rate > 0) sj["sample_rate"] = s.sample_rate;
            if (s.channels > 0)    sj["channels"] = s.channels;
            streams.push_back(std::move(sj));
        }

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

uint64_t iecode_usm_demux(const uint8_t* data, uint32_t size,
                            const char* output_dir) {
    try {
        if (!data || size == 0 || !output_dir) return 0;

        auto span = std::span<const uint8_t>(data, size);
        // Extraire le nom de base depuis le repertoire de sortie
        auto out_path = std::filesystem::path(output_dir);
        auto base_name = out_path.stem().string();
        if (base_name.empty()) base_name = "usm";

        return iecode::criware::usm_demux(span, out_path, base_name, false);
    } catch (...) {
        return 0;
    }
}

} // extern "C" -- temporaire pour les structs

/// Handle opaque pour un AWB parse.
struct iecode_awb {
    std::vector<uint8_t> data;
    iecode::criware::AwbFile file;
    mutable std::vector<std::string> entry_info_cache;
};

extern "C" {

iecode_awb_t* iecode_awb_open(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::criware::awb_parse(span);
        if (!parsed) return nullptr;

        auto* awb = new iecode_awb();
        awb->data.assign(data, data + size);
        awb->file = std::move(*parsed);
        return awb;
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_awb_count(const iecode_awb_t* awb) {
    if (!awb) return 0;
    return static_cast<int32_t>(awb->file.entries.size());
}

const char* iecode_awb_entry_info(const iecode_awb_t* awb, int32_t idx) {
    if (!awb) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= awb->file.entries.size()) return "";

    try {
        if (awb->entry_info_cache.empty()) {
            awb->entry_info_cache.resize(awb->file.entries.size());
        }

        auto uidx = static_cast<size_t>(idx);
        if (awb->entry_info_cache[uidx].empty()) {
            const auto& entry = awb->file.entries[uidx];
            json j;
            j["cue_id"] = entry.cue_id;
            j["offset"] = entry.offset;
            j["size"] = entry.size;
            awb->entry_info_cache[uidx] = j.dump();
        }
        return awb->entry_info_cache[uidx].c_str();
    } catch (...) {
        return "";
    }
}

int32_t iecode_awb_extract_all(const iecode_awb_t* awb, const char* output_dir) {
    try {
        if (!awb || !output_dir) return 0;
        return static_cast<int32_t>(
            iecode::criware::awb_extract_all(awb->data, awb->file,
                                              std::filesystem::path(output_dir)));
    } catch (...) {
        return 0;
    }
}

void iecode_awb_free(iecode_awb_t* awb) {
    delete awb;
}

// ── ACB ─────────────────────────────────────────────────────────────

const char* iecode_acb_info(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::criware::acb_parse(span);
        if (!parsed) return nullptr;

        json j;
        j["name"] = parsed->name;
        j["version"] = parsed->version;
        j["cue_count"] = parsed->cue_count;
        j["has_embedded_awb"] = parsed->has_embedded_awb;
        j["has_stream_awb"] = parsed->has_stream_awb;
        j["cue_names"] = parsed->cue_names;

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

uint8_t* iecode_acb_extract_awb(const uint8_t* data, uint32_t size,
                                 uint32_t* out_size) {
    try {
        if (!data || size == 0 || !out_size) return nullptr;
        *out_size = 0;

        auto span = std::span<const uint8_t>(data, size);
        auto awb_data = iecode::criware::acb_extract_awb(span);
        uint8_t* out_buf = nullptr;
        *out_size = vec_to_ffi(awb_data, &out_buf);
        return out_buf;
    } catch (...) {
        return nullptr;
    }
}

// ── G4MD (model metadata) ──────────────────────────────────────────

const char* iecode_g4md_parse(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::g4md_parse(span);
        if (!parsed) return nullptr;

        json j;
        j["version"] = parsed->version;
        j["endianness"] = parsed->header.is_big_endian ? "big" : "little";
        j["submeshCount"] = parsed->submeshes.size();
        j["boneRefCount"] = parsed->bone_refs.size();
        j["materialCount"] = parsed->materials.size();

        j["header"] = json{
            {"sectionBase", parsed->header.section_base},
            {"faceCount", parsed->header.face_count},
            {"boneCount", parsed->header.bone_count},
        };

        auto& submeshes = j["submeshes"] = json::array();
        for (const auto& sm : parsed->submeshes) {
            submeshes.push_back(json{
                {"name", sm.name},
                {"indexCount", sm.index_count},
                {"vertexCount", sm.vertex_count},
                {"materialIndex", sm.material_index},
                {"vertexFormat", fmt::format("{:#010x}", sm.vertex_format)},
            });
        }

        auto& bone_refs = j["boneRefs"] = json::array();
        for (const auto& br : parsed->bone_refs) {
            bone_refs.push_back(json{
                {"boneIndex", br.bone_index},
                {"weight", br.weight},
            });
        }

        auto& materials = j["materials"] = json::array();
        for (const auto& mat : parsed->materials) {
            materials.push_back(json{
                {"name", mat.name},
                {"shaderHash", fmt::format("{:#010x}", mat.shader_hash)},
                {"textureHash", fmt::format("{:#010x}", mat.texture_hash)},
            });
        }

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

// ── G4CM (character model container) ───────────────────────────────

const char* iecode_g4cm_list(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::g4cm_parse(span);
        if (!parsed) return nullptr;

        auto entries = json::array();
        for (const auto& e : parsed->entries) {
            entries.push_back(json{
                {"type", e.type},
                {"name", e.name},
                {"offset", e.offset},
                {"size", e.size},
            });
        }

        return str_to_ffi(entries.dump());
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_g4cm_extract(const uint8_t* data, uint32_t size,
                            const char* output_dir) {
    try {
        if (!data || size == 0 || !output_dir) return 0;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::g4cm_parse(span);
        if (!parsed) return 0;

        return static_cast<int32_t>(
            iecode::level5::g4cm_extract_all(span, *parsed,
                                              std::filesystem::path(output_dir)));
    } catch (...) {
        return 0;
    }
}

// ── Level-5 Compression (dispatcher unifie) ────────────────────────

uint32_t iecode_level5_decompress(const uint8_t* data, uint32_t size,
                                   uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::level5_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

uint8_t iecode_level5_detect_method(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return static_cast<uint8_t>(iecode::compression::detect_level5_method(span));
    } catch (...) {
        return 0;
    }
}

uint32_t iecode_level5_decompressed_size(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return iecode::compression::level5_decompressed_size(span);
    } catch (...) {
        return 0;
    }
}

// ── InazumaLZSS ────────────────────────────────────────────────────

int iecode_is_inazuma_lzss(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return iecode::compression::is_inazuma_lzss(span) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

uint32_t iecode_inazuma_lzss_decompress(const uint8_t* data, uint32_t size,
                                         uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::inazuma_lzss_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

// ── Huffman ────────────────────────────────────────────────────────

uint32_t iecode_huffman4_decompress(const uint8_t* data, uint32_t size,
                                     uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::huffman4_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

uint32_t iecode_huffman8_decompress(const uint8_t* data, uint32_t size,
                                     uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::huffman8_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

// ── RLE ────────────────────────────────────────────────────────────

uint32_t iecode_rle_decompress(const uint8_t* data, uint32_t size,
                                uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::rle_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

// ── ZLib ───────────────────────────────────────────────────────────

uint32_t iecode_zlib_decompress(const uint8_t* data, uint32_t size,
                                 uint8_t** out_buf) {
    try {
        if (!data || size == 0 || !out_buf) return 0;
        *out_buf = nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::compression::zlib_decompress(span);
        return opt_vec_to_ffi(result, out_buf);
    } catch (...) {
        return 0;
    }
}

// ── DDS ────────────────────────────────────────────────────────────

int iecode_dds_is_valid(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return iecode::formats::dds_is_valid(span) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

const char* iecode_dds_info(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto header = iecode::formats::dds_parse_header(span);
        if (!header) return nullptr;

        json j;
        j["width"] = header->width;
        j["height"] = header->height;
        j["depth"] = header->depth;
        j["mipmapCount"] = header->mipmap_count;
        j["hasFourCC"] = header->has_fourcc();
        j["hasDx10Extension"] = header->has_dx10_extension();
        if (header->has_fourcc()) {
            j["fourCC"] = iecode::formats::dds_fourcc_to_string(header->pf_fourcc);
        }
        j["rgbBitCount"] = header->pf_rgb_bit_count;
        j["dataOffset"] = header->data_offset();
        j["flags"] = header->flags;
        j["caps1"] = header->caps1;
        j["caps2"] = header->caps2;

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

// ── Format detection ───────────────────────────────────────────────

const char* iecode_detect_format(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto fmt = iecode::formats::detect(span);
        auto name = std::string(iecode::formats::format_name(fmt));

        return str_to_ffi(name);
    } catch (...) {
        return nullptr;
    }
}

// ── cfg.bin RDBN write ─────────────────────────────────────────────

uint32_t iecode_cfgbin_write(const iecode_result_t* result, uint8_t** out_buf) {
    try {
        if (!result || !out_buf) return 0;
        *out_buf = nullptr;

        auto binary = iecode::level5::cfgbin_write(result->cfg);
        return vec_to_ffi(binary, out_buf);
    } catch (...) {
        return 0;
    }
}

} // extern "C"

// ── G4PK handle opaque ────────────────────────────────────────────

/// Handle G4PK — stocke les donnees brutes + la liste d'entrees parsees.
struct iecode_g4pk {
    std::vector<uint8_t> data;
    iecode::level5::G4pkFile file;
};

extern "C" {

// ── G4PK ───────────────────────────────────────────────────────────

iecode_g4pk_t* iecode_g4pk_open(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::g4pk_parse(span);
        if (!parsed) return nullptr;

        auto* g4pk = new iecode_g4pk();
        g4pk->data.assign(data, data + size);
        g4pk->file = std::move(*parsed);
        return g4pk;
    } catch (...) {
        return nullptr;
    }
}

int32_t iecode_g4pk_count(const iecode_g4pk_t* g4pk) {
    if (!g4pk) return 0;
    return static_cast<int32_t>(g4pk->file.entries.size());
}

const char* iecode_g4pk_entry_name(const iecode_g4pk_t* g4pk, int32_t idx) {
    if (!g4pk) return "";
    if (idx < 0 || static_cast<size_t>(idx) >= g4pk->file.entries.size()) return "";
    return g4pk->file.entries[static_cast<size_t>(idx)].name.c_str();
}

uint8_t* iecode_g4pk_extract(const iecode_g4pk_t* g4pk, int32_t idx,
                              uint32_t* out_size) {
    try {
        if (!g4pk || !out_size) return nullptr;
        if (idx < 0 || static_cast<size_t>(idx) >= g4pk->file.entries.size()) return nullptr;
        *out_size = 0;

        auto archive_span = std::span<const uint8_t>(g4pk->data);
        auto entry_data = iecode::level5::g4pk_extract_entry(
            archive_span, g4pk->file.entries[static_cast<size_t>(idx)]);
        if (entry_data.empty()) return nullptr;
        auto* buf = new (std::nothrow) uint8_t[entry_data.size()];
        if (!buf) return nullptr;
        std::memcpy(buf, entry_data.data(), entry_data.size());
        *out_size = static_cast<uint32_t>(entry_data.size());
        return buf;
    } catch (...) {
        return nullptr;
    }
}

void iecode_g4pk_free(iecode_g4pk_t* g4pk) {
    delete g4pk;
}

// ── FNT (font) ─────────────────────────────────────────────────────

const char* iecode_fnt_info(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::fnt_parse(span);
        if (!parsed) return nullptr;

        json j;
        j["version"] = iecode::level5::fnt_version_string(parsed->header);
        j["glyphCount"] = parsed->header.glyph_count;
        j["textureWidth"] = parsed->header.texture_width;
        j["textureHeight"] = parsed->header.texture_height;
        j["lineHeight"] = parsed->header.line_height;
        j["baseHeight"] = parsed->header.base_height;
        j["textureDataSize"] = parsed->texture_data.size();

        auto& glyphs = j["glyphs"] = json::array();
        for (const auto& g : parsed->glyphs) {
            glyphs.push_back(json{
                {"charCode", g.char_code},
                {"x", g.x},
                {"y", g.y},
                {"width", g.width},
                {"height", g.height},
                {"offsetX", g.offset_x},
                {"offsetY", g.offset_y},
                {"advance", g.advance},
            });
        }

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

// ── ANMx (animation) ──────────────────────────────────────────────

int iecode_anm_is_valid(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return 0;
        auto span = std::span<const uint8_t>(data, size);
        return iecode::level5::anm_is_valid(span) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

const char* iecode_anm_info(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto parsed = iecode::level5::anm_parse(span);
        if (!parsed) return nullptr;

        // anm_to_json produit deja une string JSON complete
        auto str = iecode::level5::anm_to_json(*parsed);
        return str_to_ffi(str);
    } catch (...) {
        return nullptr;
    }
}

// ── EventText ──────────────────────────────────────────────────────

const char* iecode_event_text_extract(const uint8_t* data, uint32_t size) {
    try {
        if (!data || size == 0) return nullptr;

        auto span = std::span<const uint8_t>(data, size);
        auto result = iecode::gamedata::event_text_extract_raw(span);

        json j = json::array();
        for (const auto& entry : result.entries) {
            json ej;
            ej["hash"] = fmt::format("{:#010x}", entry.hash);
            ej["key"] = entry.key;
            ej["text"] = entry.text;
            ej["speakerId"] = entry.speaker_id;
            ej["voiceId"] = entry.voice_id;
            ej["startTime"] = entry.start_time;
            ej["endTime"] = entry.end_time;
            j.push_back(std::move(ej));
        }

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

// ── Steam API ────────────────────────────────────────────────────────

} // extern "C" — fermer pour inclure le header Steam C++

#include "iecode/steam/steam_api.h"

struct iecode_steam {
    iecode::steam::SteamContext ctx;
};

extern "C" {

iecode_steam_t* iecode_steam_init(void) {
    try {
        auto ctx = iecode::steam::SteamContext::init();
        if (!ctx) return nullptr;
        return new (std::nothrow) iecode_steam{std::move(*ctx)};
    } catch (...) {
        return nullptr;
    }
}

iecode_steam_t* iecode_steam_init_app(uint32_t app_id) {
    try {
        auto ctx = iecode::steam::SteamContext::init_with_app_id(app_id);
        if (!ctx) return nullptr;
        return new (std::nothrow) iecode_steam{std::move(*ctx)};
    } catch (...) {
        return nullptr;
    }
}

void iecode_steam_shutdown(iecode_steam_t* ctx) {
    delete ctx;
}

int iecode_steam_is_running(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_steam_running() ? 1 : 0;
}

uint64_t iecode_steam_get_id(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.get_steam_id().raw;
}

int iecode_steam_is_logged_on(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_logged_on() ? 1 : 0;
}

int iecode_steam_get_level(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.get_player_steam_level();
}

int iecode_steam_is_subscribed(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_subscribed() ? 1 : 0;
}

int iecode_steam_is_subscribed_app(const iecode_steam_t* ctx, uint32_t app_id) {
    if (!ctx) return 0;
    return ctx->ctx.is_subscribed_app(app_id) ? 1 : 0;
}

int iecode_steam_is_family_sharing(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_family_sharing() ? 1 : 0;
}

int iecode_steam_is_dlc_installed(const iecode_steam_t* ctx, uint32_t dlc_app_id) {
    if (!ctx) return 0;
    return ctx->ctx.is_dlc_installed(dlc_app_id) ? 1 : 0;
}

const char* iecode_steam_get_language(const iecode_steam_t* ctx) {
    if (!ctx) return nullptr;
    try {
        auto lang = ctx->ctx.get_current_game_language();
        return str_to_ffi(lang);
    } catch (...) {
        return nullptr;
    }
}

int iecode_steam_get_build_id(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.get_app_build_id();
}

const char* iecode_steam_get_install_dir(const iecode_steam_t* ctx, uint32_t app_id) {
    if (!ctx) return nullptr;
    try {
        auto dir = ctx->ctx.get_app_install_dir(app_id);
        return str_to_ffi(dir);
    } catch (...) {
        return nullptr;
    }
}

void iecode_steam_run_callbacks(const iecode_steam_t* ctx) {
    if (ctx) ctx->ctx.run_callbacks();
}

// ── Steam Cloud ─────────────────────────────────────────────────────

int iecode_steam_cloud_enabled(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_cloud_enabled_for_account() ? 1 : 0;
}

int iecode_steam_cloud_enabled_app(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.is_cloud_enabled_for_app() ? 1 : 0;
}

int iecode_steam_cloud_quota(const iecode_steam_t* ctx,
                              uint64_t* total, uint64_t* available) {
    if (!ctx || !total || !available) return 0;
    auto quota = ctx->ctx.get_cloud_quota();
    if (quota.total == 0 && quota.available == 0) return 0;
    *total = quota.total;
    *available = quota.available;
    return 1;
}

int iecode_steam_cloud_file_count(const iecode_steam_t* ctx) {
    if (!ctx) return 0;
    return ctx->ctx.get_cloud_file_count();
}

const char* iecode_steam_cloud_file_name(const iecode_steam_t* ctx,
                                          int index, int32_t* size_out) {
    if (!ctx) return nullptr;
    try {
        auto info = ctx->ctx.get_cloud_file_info(index);
        if (info.name.empty()) return nullptr;
        if (size_out) *size_out = info.size;
        return str_to_ffi(info.name);
    } catch (...) {
        return nullptr;
    }
}

int iecode_steam_cloud_exists(const iecode_steam_t* ctx, const char* name) {
    if (!ctx || !name) return 0;
    return ctx->ctx.cloud_file_exists(name) ? 1 : 0;
}

int32_t iecode_steam_cloud_file_size(const iecode_steam_t* ctx, const char* name) {
    if (!ctx || !name) return 0;
    return ctx->ctx.cloud_file_size(name);
}

uint8_t* iecode_steam_cloud_read(const iecode_steam_t* ctx,
                                  const char* name, uint32_t* out_size) {
    if (!ctx || !name || !out_size) return nullptr;
    try {
        auto data = ctx->ctx.cloud_read(name);
        if (!data || data->empty()) return nullptr;
        auto* buf = new (std::nothrow) uint8_t[data->size()];
        if (!buf) return nullptr;
        std::memcpy(buf, data->data(), data->size());
        *out_size = static_cast<uint32_t>(data->size());
        return buf;
    } catch (...) {
        return nullptr;
    }
}

int iecode_steam_cloud_write(const iecode_steam_t* ctx,
                              const char* name,
                              const uint8_t* data, uint32_t size) {
    if (!ctx || !name || !data) return 0;
    auto span = std::span<const uint8_t>(data, size);
    return ctx->ctx.cloud_write(name, span) ? 1 : 0;
}

int iecode_steam_cloud_delete(const iecode_steam_t* ctx, const char* name) {
    if (!ctx || !name) return 0;
    return ctx->ctx.cloud_delete(name) ? 1 : 0;
}

} // extern "C" — fin Steam

// ── Encrypted App Tickets ───────────────────────────────────────────

#include "iecode/steam/encrypted_ticket.h"

struct iecode_ticket {
    iecode::steam::EncryptedTicket ticket;
};

extern "C" {

iecode_ticket_t* iecode_ticket_load(void) {
    try {
        auto ticket = iecode::steam::EncryptedTicket::load();
        if (!ticket) return nullptr;
        return new (std::nothrow) iecode_ticket{std::move(*ticket)};
    } catch (...) {
        return nullptr;
    }
}

void iecode_ticket_free(iecode_ticket_t* ticket) {
    delete ticket;
}

int iecode_ticket_decrypt(const iecode_ticket_t* t,
                           const uint8_t* encrypted, uint32_t enc_size,
                           const uint8_t* key, uint32_t key_size,
                           uint8_t** out_buf, uint32_t* out_size) {
    if (!t || !encrypted || !key || !out_buf || !out_size) return 0;
    *out_buf = nullptr;
    *out_size = 0;
    try {
        auto enc_span = std::span<const uint8_t>(encrypted, enc_size);
        auto key_span = std::span<const uint8_t>(key, key_size);
        std::vector<uint8_t> decrypted;
        if (!t->ticket.decrypt(enc_span, key_span, decrypted)) return 0;
        *out_size = vec_to_ffi(decrypted, out_buf);
        return (*out_size > 0) ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_ticket_is_for_app(const iecode_ticket_t* t,
                              const uint8_t* decrypted, uint32_t size,
                              uint32_t app_id) {
    if (!t || !decrypted) return 0;
    return t->ticket.is_ticket_for_app({decrypted, size}, app_id) ? 1 : 0;
}

int iecode_ticket_is_borrowed(const iecode_ticket_t* t,
                               const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.is_license_borrowed({decrypted, size}) ? 1 : 0;
}

int iecode_ticket_is_temporary(const iecode_ticket_t* t,
                                const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.is_license_temporary({decrypted, size}) ? 1 : 0;
}

int iecode_ticket_is_vac_banned(const iecode_ticket_t* t,
                                 const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.is_vac_banned({decrypted, size}) ? 1 : 0;
}

uint64_t iecode_ticket_get_steam_id(const iecode_ticket_t* t,
                                     const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.get_steam_id({decrypted, size});
}

uint32_t iecode_ticket_get_app_id(const iecode_ticket_t* t,
                                   const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.get_app_id({decrypted, size});
}

uint32_t iecode_ticket_get_issue_time(const iecode_ticket_t* t,
                                       const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return 0;
    return t->ticket.get_issue_time({decrypted, size});
}

const char* iecode_ticket_info_json(const iecode_ticket_t* t,
                                     const uint8_t* decrypted, uint32_t size) {
    if (!t || !decrypted) return nullptr;
    try {
        auto info = t->ticket.parse_ticket({decrypted, size});
        if (!info) return nullptr;

        nlohmann::json j;
        j["steam_id"] = info->steam_id;
        j["app_id"] = info->app_id;
        j["issue_time"] = info->issue_time;
        j["is_vac_banned"] = info->is_vac_banned;
        j["is_borrowed"] = info->is_borrowed;
        j["is_temporary"] = info->is_temporary;

        return str_to_ffi(j.dump());
    } catch (...) {
        return nullptr;
    }
}

} // extern "C" — fin Encrypted Tickets

// ── Memory Editor (Windows uniquement) ───────────────────────────────

#ifdef _WIN32

extern "C" {
// Note: on est deja dans extern "C" depuis le block precedent,
// mais le #ifdef _WIN32 cree un nouveau scope logique.
} // fermer pour inclure les headers C++ memory

#include "iecode/memory/process.h"
#include "iecode/memory/aob_scanner.h"
#include "iecode/memory/nie_addresses.h"

// Handles opaques pour le memory editor
struct iecode_process {
    iecode::memory::ProcessHandle handle;
};

struct iecode_nie {
    iecode::memory::nie::NieProcess nie;
};

extern "C" {

// ── Process generique ────────────────────────────────────────────────

iecode_process_t* iecode_process_attach(const char* exe_name) {
    try {
        auto proc = iecode::memory::ProcessHandle::attach(exe_name);
        if (!proc) return nullptr;
        return new (std::nothrow) iecode_process{std::move(*proc)};
    } catch (...) {
        return nullptr;
    }
}

iecode_process_t* iecode_process_attach_pid(uint32_t pid) {
    try {
        auto proc = iecode::memory::ProcessHandle::attach_pid(pid);
        if (!proc) return nullptr;
        return new (std::nothrow) iecode_process{std::move(*proc)};
    } catch (...) {
        return nullptr;
    }
}

void iecode_process_detach(iecode_process_t* proc) {
    delete proc;
}

int iecode_process_is_valid(const iecode_process_t* proc) {
    if (!proc) return 0;
    return proc->handle.is_valid() ? 1 : 0;
}

uint64_t iecode_process_base_address(const iecode_process_t* proc) {
    if (!proc) return 0;
    return static_cast<uint64_t>(proc->handle.base_address());
}

uint32_t iecode_process_pid(const iecode_process_t* proc) {
    if (!proc) return 0;
    return proc->handle.pid();
}

int iecode_mem_read(const iecode_process_t* proc, uint64_t addr,
                    uint8_t* buf, uint32_t size) {
    if (!proc || !buf) return 0;
    return proc->handle.read_bytes(static_cast<uintptr_t>(addr), buf, size) ? 1 : 0;
}

int iecode_mem_write(const iecode_process_t* proc, uint64_t addr,
                     const uint8_t* data, uint32_t size) {
    if (!proc || !data) return 0;
    return proc->handle.write_bytes(static_cast<uintptr_t>(addr), data, size) ? 1 : 0;
}

int iecode_mem_read_i32(const iecode_process_t* proc, uint64_t addr, int32_t* out) {
    if (!proc || !out) return 0;
    auto val = proc->handle.read<int32_t>(static_cast<uintptr_t>(addr));
    if (!val) return 0;
    *out = *val;
    return 1;
}

int iecode_mem_write_i32(const iecode_process_t* proc, uint64_t addr, int32_t value) {
    if (!proc) return 0;
    return proc->handle.write(static_cast<uintptr_t>(addr), value) ? 1 : 0;
}

int iecode_mem_read_i16(const iecode_process_t* proc, uint64_t addr, int16_t* out) {
    if (!proc || !out) return 0;
    auto val = proc->handle.read<int16_t>(static_cast<uintptr_t>(addr));
    if (!val) return 0;
    *out = *val;
    return 1;
}

int iecode_mem_write_i16(const iecode_process_t* proc, uint64_t addr, int16_t value) {
    if (!proc) return 0;
    return proc->handle.write(static_cast<uintptr_t>(addr), value) ? 1 : 0;
}

int iecode_mem_read_u32(const iecode_process_t* proc, uint64_t addr, uint32_t* out) {
    if (!proc || !out) return 0;
    auto val = proc->handle.read<uint32_t>(static_cast<uintptr_t>(addr));
    if (!val) return 0;
    *out = *val;
    return 1;
}

int iecode_mem_write_u32(const iecode_process_t* proc, uint64_t addr, uint32_t value) {
    if (!proc) return 0;
    return proc->handle.write(static_cast<uintptr_t>(addr), value) ? 1 : 0;
}

uint64_t iecode_mem_resolve_chain(const iecode_process_t* proc, uint64_t base,
                                   const uint64_t* offsets, uint32_t count) {
    if (!proc || !offsets || count == 0) return 0;

    // Convertir uint64_t[] -> uintptr_t[]
    std::vector<uintptr_t> offs(count);
    for (uint32_t i = 0; i < count; ++i) {
        offs[i] = static_cast<uintptr_t>(offsets[i]);
    }

    auto result = proc->handle.resolve_chain(static_cast<uintptr_t>(base), offs);
    return result ? static_cast<uint64_t>(*result) : 0;
}

uint64_t iecode_aob_scan(const iecode_process_t* proc, const char* pattern) {
    if (!proc || !pattern) return 0;
    try {
        auto pat = iecode::memory::AobPattern::from_string(pattern);
        if (!pat) return 0;
        iecode::memory::AobScanner scanner(proc->handle);
        auto result = scanner.find_first(*pat);
        return result ? static_cast<uint64_t>(*result) : 0;
    } catch (...) {
        return 0;
    }
}

uint64_t iecode_aob_scan_range(const iecode_process_t* proc, const char* pattern,
                                uint64_t start, uint32_t size) {
    if (!proc || !pattern) return 0;
    try {
        auto pat = iecode::memory::AobPattern::from_string(pattern);
        if (!pat) return 0;
        iecode::memory::AobScanner scanner(proc->handle);
        auto result = scanner.find_in_range(*pat, static_cast<uintptr_t>(start), size);
        return result ? static_cast<uint64_t>(*result) : 0;
    } catch (...) {
        return 0;
    }
}

// ── nie.exe helpers ──────────────────────────────────────────────────

iecode_nie_t* iecode_nie_attach(void) {
    try {
        auto nie = iecode::memory::nie::NieProcess::attach();
        if (!nie) return nullptr;
        return new (std::nothrow) iecode_nie{std::move(*nie)};
    } catch (...) {
        return nullptr;
    }
}

void iecode_nie_detach(iecode_nie_t* nie) {
    delete nie;
}

uint64_t iecode_nie_rebase(const iecode_nie_t* nie, uint64_t static_addr) {
    if (!nie) return 0;
    return static_cast<uint64_t>(nie->nie.rebase(static_cast<uintptr_t>(static_addr)));
}

uint8_t* iecode_nie_read_player(const iecode_nie_t* nie, uint32_t index,
                                 uint32_t* out_size) {
    if (!nie || !out_size) return nullptr;
    *out_size = 0;
    try {
        auto data = nie->nie.read_player(index);
        if (!data || data->empty()) return nullptr;
        auto* buf = new (std::nothrow) uint8_t[data->size()];
        if (!buf) return nullptr;
        std::memcpy(buf, data->data(), data->size());
        *out_size = static_cast<uint32_t>(data->size());
        return buf;
    } catch (...) {
        return nullptr;
    }
}

int iecode_nie_read_chara_stats(const iecode_nie_t* nie, uint64_t chara_addr,
                                 int16_t stats_out[8]) {
    if (!nie || !stats_out) return 0;
    auto stats = nie->nie.read_chara_stats(static_cast<uintptr_t>(chara_addr));
    if (!stats) return 0;
    stats_out[0] = stats->kick;
    stats_out[1] = stats->guard;
    stats_out[2] = stats->catch_;
    stats_out[3] = stats->body;
    stats_out[4] = stats->control;
    stats_out[5] = stats->speed;
    stats_out[6] = stats->stamina;
    stats_out[7] = stats->luck;
    return 1;
}

int iecode_nie_write_chara_stats(const iecode_nie_t* nie, uint64_t chara_addr,
                                  const int16_t stats_in[8]) {
    if (!nie || !stats_in) return 0;
    iecode::memory::nie::CharaStats stats{
        .kick    = stats_in[0],
        .guard   = stats_in[1],
        .catch_  = stats_in[2],
        .body    = stats_in[3],
        .control = stats_in[4],
        .speed   = stats_in[5],
        .stamina = stats_in[6],
        .luck    = stats_in[7],
    };
    return nie->nie.write_chara_stats(static_cast<uintptr_t>(chara_addr), stats) ? 1 : 0;
}

int iecode_nie_read_skills(const iecode_nie_t* nie, uint64_t chara_addr,
                            uint32_t skills_out[6]) {
    if (!nie || !skills_out) return 0;
    auto skills = nie->nie.read_skills(static_cast<uintptr_t>(chara_addr));
    if (!skills) return 0;
    std::memcpy(skills_out, skills->data(), sizeof(uint32_t) * 6);
    return 1;
}

int iecode_nie_write_skill(const iecode_nie_t* nie, uint64_t chara_addr,
                            uint32_t slot, uint32_t skill_id) {
    if (!nie) return 0;
    return nie->nie.write_skill(static_cast<uintptr_t>(chara_addr), slot, skill_id) ? 1 : 0;
}

int iecode_nie_read_level(const iecode_nie_t* nie, uint64_t chara_addr,
                           uint32_t* level_out, uint32_t* exp_out) {
    if (!nie || !level_out || !exp_out) return 0;
    auto result = nie->nie.read_level_exp(static_cast<uintptr_t>(chara_addr));
    if (!result) return 0;
    *level_out = result->first;
    *exp_out = result->second;
    return 1;
}

int iecode_nie_write_level(const iecode_nie_t* nie, uint64_t chara_addr,
                            uint32_t level, uint32_t exp) {
    if (!nie) return 0;
    return nie->nie.write_level_exp(static_cast<uintptr_t>(chara_addr), level, exp) ? 1 : 0;
}

uint64_t iecode_nie_find_pattern(const iecode_nie_t* nie, const char* pattern) {
    if (!nie || !pattern) return 0;
    try {
        auto result = nie->nie.find_pattern(pattern);
        return result ? static_cast<uint64_t>(*result) : 0;
    } catch (...) {
        return 0;
    }
}

uint64_t iecode_nie_resolve_rip(const iecode_nie_t* nie, const char* pattern,
                                 uint32_t rip_offset, uint32_t instr_len) {
    if (!nie || !pattern) return 0;
    try {
        auto result = nie->nie.resolve_rip_from_aob(pattern, rip_offset, instr_len);
        return result ? static_cast<uint64_t>(*result) : 0;
    } catch (...) {
        return 0;
    }
}

} // extern "C" — fin memory editor (WIN32)

#endif // _WIN32

// ── Dump Service ────────────────────────────────────────────────────

#include "iecode/services/dump_service.h"

struct iecode_dump {
    iecode::services::DumpService service;
    std::atomic<bool> cancel_flag{false};
    mutable std::string json_cache;

    explicit iecode_dump(std::filesystem::path game_path)
        : service(std::move(game_path)) {}
};

iecode_dump_t* iecode_dump_create(const char* game_path) {
    if (!game_path) return nullptr;
    try {
        return new (std::nothrow) iecode_dump(std::filesystem::path(game_path));
    } catch (...) {
        return nullptr;
    }
}

void iecode_dump_free(iecode_dump_t* d) {
    delete d;
}

const char* iecode_dump_run(
    iecode_dump_t* d,
    const char* output_path,
    int smart_dump,
    int max_parallelism,
    void (*on_progress)(const char* json_progress, void* userdata),
    void* userdata) {
    if (!d || !output_path) return nullptr;
    try {
        iecode::services::DumpOptions opts;
        opts.output_path = std::filesystem::path(output_path);
        opts.smart_dump = (smart_dump != 0);
        opts.max_parallelism = std::max(1, std::min(max_parallelism, 16));

        if (on_progress) {
            opts.on_progress = [on_progress, userdata](const iecode::services::DumpProgress& p) {
                nlohmann::json j;
                j["phase"] = static_cast<int>(p.phase);
                j["message"] = p.message;
                j["current_cpk"] = p.current_cpk;
                j["cpk_index"] = p.cpk_index;
                j["total_cpks"] = p.total_cpks;
                j["extracted_files"] = p.extracted_files;
                j["total_files"] = p.total_files;
                j["extracted_bytes"] = p.extracted_bytes;
                j["total_bytes"] = p.total_bytes;
                j["bytes_per_second"] = p.bytes_per_second;
                std::string json_str = j.dump();
                on_progress(json_str.c_str(), userdata);
            };
        }

        d->cancel_flag.store(false, std::memory_order_relaxed);
        auto result = d->service.dump(opts, d->cancel_flag);

        // Serialiser le resultat en JSON
        nlohmann::json j;
        j["success"] = result.success;
        j["was_cancelled"] = result.was_cancelled;
        j["is_resume"] = result.is_resume;
        j["error"] = result.error;
        j["output_path"] = result.output_path.string();
        j["total_cpks"] = result.total_cpks;
        j["total_files"] = result.total_files;
        j["extracted_files"] = result.extracted_files;
        j["skipped_files"] = result.skipped_files;
        j["loose_files_copied"] = result.loose_files_copied;
        j["extracted_bytes"] = result.extracted_bytes;
        j["errors"] = result.errors;
        j["duration_seconds"] = result.duration_seconds;

        d->json_cache = j.dump();
        return d->json_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

void iecode_dump_cancel(iecode_dump_t* d) {
    if (d) {
        d->cancel_flag.store(true, std::memory_order_relaxed);
    }
}

// ── IevrGame (facade jeu) ──────────────────────────────────────────

#include "iecode/game/ievr_game.h"

struct iecode_game {
    iecode::game::IevrGame game;
    mutable std::string json_cache;
    mutable std::string data_path_cache;
    mutable std::string packs_path_cache;
    mutable std::string game_path_cache;

    explicit iecode_game(std::filesystem::path path)
        : game(std::move(path)) {}
};

iecode_game_t* iecode_game_create(const char* game_path) {
    if (!game_path) return nullptr;
    try {
        return new (std::nothrow) iecode_game(std::filesystem::path(game_path));
    } catch (...) {
        return nullptr;
    }
}

iecode_game_t* iecode_game_detect() {
    try {
        auto opt = iecode::game::IevrGame::detect();
        if (!opt) return nullptr;
        auto* g = new (std::nothrow) iecode_game(opt->game_path());
        return g;
    } catch (...) {
        return nullptr;
    }
}

void iecode_game_free(iecode_game_t* g) {
    delete g;
}

int iecode_game_is_valid(const iecode_game_t* g) {
    if (!g) return 0;
    return g->game.is_valid() ? 1 : 0;
}

const char* iecode_game_path(const iecode_game_t* g) {
    if (!g) return nullptr;
    try {
        g->game_path_cache = g->game.game_path().string();
        return g->game_path_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

const char* iecode_game_data_path(iecode_game_t* g) {
    if (!g) return nullptr;
    try {
        g->data_path_cache = g->game.data_path().string();
        return g->data_path_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

const char* iecode_game_packs_path(iecode_game_t* g) {
    if (!g) return nullptr;
    try {
        g->packs_path_cache = g->game.packs_path().string();
        return g->packs_path_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

const char* iecode_game_info_json(iecode_game_t* g) {
    if (!g) return nullptr;
    try {
        g->json_cache = g->game.export_info_json();
        return g->json_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

int iecode_game_eac_disable(iecode_game_t* g) {
    if (!g) return 0;
    try {
        return g->game.eac().disable_eac() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_game_eac_restore(iecode_game_t* g) {
    if (!g) return 0;
    try {
        return g->game.eac().restore_eac() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_game_eac_is_disabled(const iecode_game_t* g) {
    if (!g) return 0;
    try {
        return g->game.eac().is_eac_disabled() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

// ── EAC Service ─────────────────────────────────────────────────────

struct iecode_eac {
    iecode::services::EacService service;
    mutable std::string json_cache;

    explicit iecode_eac(std::filesystem::path game_dir)
        : service(std::move(game_dir)) {}
};

iecode_eac_t* iecode_eac_create(const char* game_dir) {
    if (!game_dir) return nullptr;
    try {
        return new (std::nothrow) iecode_eac(std::filesystem::path(game_dir));
    } catch (...) {
        return nullptr;
    }
}

void iecode_eac_free(iecode_eac_t* eac) {
    delete eac;
}

int iecode_eac_disable(iecode_eac_t* eac) {
    if (!eac) return 0;
    try {
        return eac->service.disable_eac() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_eac_restore(iecode_eac_t* eac) {
    if (!eac) return 0;
    try {
        return eac->service.restore_eac() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_eac_is_disabled(const iecode_eac_t* eac) {
    if (!eac) return 0;
    try {
        return eac->service.is_eac_disabled() ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

const char* iecode_eac_status_json(const iecode_eac_t* eac) {
    if (!eac) return nullptr;
    try {
        const auto status = eac->service.get_status();
        nlohmann::json j;
        j["ini_modified"] = status.ini_modified;
        j["launcher_backed_up"] = status.launcher_backed_up;
        j["launcher_missing"] = status.launcher_missing;
        eac->json_cache = j.dump();
        return eac->json_cache.c_str();
    } catch (...) {
        return nullptr;
    }
}

// ── VFS ─────────────────────────────────────────────────────────────

// extern "C" — ferme le bloc precedent pour inclure le header VFS C++

#include "iecode/vfs/vfs.h"

extern "C" {

void* iecode_vfs_init(const char* game_data_dir) {
    try {
        if (!game_data_dir) return nullptr;
        auto vfs = new (std::nothrow) iecode::vfs::Vfs();
        if (!vfs) return nullptr;
        if (!vfs->init(std::filesystem::path(game_data_dir))) {
            delete vfs;
            return nullptr;
        }
        return vfs;
    } catch (...) {
        return nullptr;
    }
}

void iecode_vfs_shutdown(void* vfs) {
    try {
        if (!vfs) return;
        auto* v = static_cast<iecode::vfs::Vfs*>(vfs);
        v->shutdown();
        delete v;
    } catch (...) {
        // Silencieux
    }
}

int32_t iecode_vfs_find(void* vfs, const char* path,
                         char* cpk_out, uint32_t cpk_out_size) {
    try {
        if (!vfs || !path) return -1;
        auto* v = static_cast<iecode::vfs::Vfs*>(vfs);
        auto entry = v->find(std::string(path));
        if (!entry) return 0;

        if (cpk_out && cpk_out_size > 0) {
            const auto& cpk = entry->cpk_filename;
            const auto len = std::min(static_cast<uint32_t>(cpk.size()),
                                       cpk_out_size - 1);
            std::memcpy(cpk_out, cpk.data(), len);
            cpk_out[len] = '\0';
        }

        return static_cast<int32_t>(entry->file_size);
    } catch (...) {
        return -1;
    }
}

uint8_t* iecode_vfs_read(void* vfs, const char* path, uint32_t* out_size) {
    try {
        if (!vfs || !path || !out_size) return nullptr;
        *out_size = 0;

        auto* v = static_cast<iecode::vfs::Vfs*>(vfs);
        auto data = v->read(std::string(path));
        if (data.empty()) return nullptr;

        auto* buf = static_cast<uint8_t*>(std::malloc(data.size()));
        if (!buf) return nullptr;

        std::memcpy(buf, data.data(), data.size());
        *out_size = static_cast<uint32_t>(data.size());
        return buf;
    } catch (...) {
        return nullptr;
    }
}

uint32_t iecode_vfs_asset_count(void* vfs) {
    try {
        if (!vfs) return 0;
        auto* v = static_cast<iecode::vfs::Vfs*>(vfs);
        return static_cast<uint32_t>(v->asset_count());
    } catch (...) {
        return 0;
    }
}

} // extern "C" — fin VFS

// ── Pipeline 3D : Texture / Mesh / Anim / Model ─────────────────────
//
// Wrappers opaques sur les parsers Level-5 + AnimClip. Ces handles sont
// independants du backend GPU (bgfx n'est pas linke dans iecode_ffi), donc
// on expose les donnees parsees brutes et les metadonnees utiles au client.

/// Handle texture — wrappe un G4txFile complet.
struct iecode_texture {
    iecode::level5::G4txFile file;
};

/// Handle mesh — wrappe un G4mgFile complet.
struct iecode_mesh {
    iecode::level5::G4mgFile file;
};

/// Handle anim — archive G4RA + tentative de reconstruction d'un AnimClip.
/// Si `AnimClip::from_g4ra` retourne nullopt (format keyframe pas encore
/// reverse), `clip` est vide et on expose le nombre d'entrees brutes.
struct iecode_anim {
    iecode::level5::G4raFile          archive;
    std::optional<lives::AnimClip>    clip;
};

/// Handle modele de personnage — regroupe tous les sous-fichiers.
/// Chaque champ est optionnel : un fichier manquant laisse son optional vide.
struct iecode_model {
    std::optional<iecode::level5::G4mdFile> md;
    std::optional<iecode::level5::G4mgFile> mg;
    std::optional<iecode::level5::G4skFile> sk;
    std::optional<iecode::level5::G4raFile> ra;
    std::optional<lives::AnimClip>          clip;
    lives::AnimPlayer                       player;
};

namespace {

/// Charge un fichier complet en memoire via ifstream. Retourne vecteur vide
/// en cas d'erreur (pas d'exception propagee a la frontiere FFI).
[[nodiscard]] std::vector<uint8_t> ffi_slurp(const std::filesystem::path& path) noexcept {
    try {
        std::ifstream f(path, std::ios::binary | std::ios::ate);
        if (!f) return {};
        const auto size = f.tellg();
        if (size <= 0) return {};
        std::vector<uint8_t> buf(static_cast<size_t>(size));
        f.seekg(0);
        f.read(reinterpret_cast<char*>(buf.data()), size);
        return buf;
    } catch (...) {
        return {};
    }
}

} // namespace

extern "C" {

// ── Texture ─────────────────────────────────────────────────────────

iecode_texture_t* iecode_texture_load_g4tx(const char* path) {
    try {
        if (!path) return nullptr;
        auto data = ffi_slurp(path);
        if (data.empty()) return nullptr;

        auto parsed = iecode::level5::g4tx_parse(std::span<const uint8_t>(data));
        if (!parsed) return nullptr;

        auto* tex = new (std::nothrow) iecode_texture();
        if (!tex) return nullptr;
        tex->file = std::move(*parsed);
        return tex;
    } catch (...) {
        return nullptr;
    }
}

void iecode_texture_destroy(iecode_texture_t* tex) {
    delete tex;
}

uint16_t iecode_texture_width(iecode_texture_t* tex) {
    if (!tex || tex->file.textures.empty()) return 0;
    return tex->file.textures.front().width;
}

uint16_t iecode_texture_height(iecode_texture_t* tex) {
    if (!tex || tex->file.textures.empty()) return 0;
    return tex->file.textures.front().height;
}

// ── Mesh ────────────────────────────────────────────────────────────

iecode_mesh_t* iecode_mesh_load_g4mg(const char* path) {
    try {
        if (!path) return nullptr;
        auto data = ffi_slurp(path);
        if (data.empty()) return nullptr;

        auto parsed = iecode::level5::g4mg_parse(std::span<const uint8_t>(data));
        if (!parsed) return nullptr;

        auto* mesh = new (std::nothrow) iecode_mesh();
        if (!mesh) return nullptr;
        mesh->file = std::move(*parsed);
        return mesh;
    } catch (...) {
        return nullptr;
    }
}

void iecode_mesh_destroy(iecode_mesh_t* mesh) {
    delete mesh;
}

uint32_t iecode_mesh_vertex_count(iecode_mesh_t* mesh) {
    if (!mesh) return 0;
    size_t total = 0;
    for (const auto& m : mesh->file.meshes) {
        total += m.vertices.size();
    }
    return static_cast<uint32_t>(total);
}

uint32_t iecode_mesh_index_count(iecode_mesh_t* mesh) {
    if (!mesh) return 0;
    size_t total = 0;
    for (const auto& m : mesh->file.meshes) {
        total += m.indices.size();
    }
    return static_cast<uint32_t>(total);
}

// ── Animation ───────────────────────────────────────────────────────

iecode_anim_t* iecode_anim_load_g4ra(const char* path) {
    try {
        if (!path) return nullptr;
        auto data = ffi_slurp(path);
        if (data.empty()) return nullptr;

        auto parsed = iecode::level5::g4ra_parse(std::span<const uint8_t>(data));
        if (!parsed) return nullptr;

        auto* anim = new (std::nothrow) iecode_anim();
        if (!anim) return nullptr;
        anim->archive = std::move(*parsed);
        // Tentative de reconstruction du clip TRS (peut etre nullopt tant
        // que le format keyframes Level-5 n'est pas reverse).
        anim->clip = lives::AnimClip::from_g4ra(anim->archive);
        return anim;
    } catch (...) {
        return nullptr;
    }
}

void iecode_anim_destroy(iecode_anim_t* anim) {
    delete anim;
}

float iecode_anim_duration(iecode_anim_t* anim) {
    if (!anim || !anim->clip) return 0.0f;
    return anim->clip->duration;
}

uint32_t iecode_anim_track_count(iecode_anim_t* anim) {
    if (!anim) return 0;
    if (anim->clip) return static_cast<uint32_t>(anim->clip->tracks.size());
    return anim->archive.entry_count;
}

// ── Model ───────────────────────────────────────────────────────────

iecode_model_t* iecode_model_load(const char* data_root, const char* chara_id) {
    try {
        if (!data_root || !chara_id) return nullptr;

        const std::filesystem::path root =
            std::filesystem::path(data_root) / "common" / "chr" / chara_id;
        if (!std::filesystem::exists(root)) return nullptr;

        auto* model = new (std::nothrow) iecode_model();
        if (!model) return nullptr;

        const std::string cid = chara_id;

        // Chaque fichier est optionnel : on log silencieusement les manquants.
        auto load_one = [&](const char* ext, auto parse_fn, auto& dest) {
            const auto p = root / (cid + ext);
            if (!std::filesystem::exists(p)) return;
            auto data = ffi_slurp(p);
            if (data.empty()) return;
            auto parsed = parse_fn(std::span<const uint8_t>(data));
            if (parsed) dest = std::move(*parsed);
        };

        load_one(".g4md", iecode::level5::g4md_parse, model->md);
        load_one(".g4mg", iecode::level5::g4mg_parse, model->mg);
        load_one(".g4sk", iecode::level5::g4sk_parse, model->sk);
        load_one(".g4ra", iecode::level5::g4ra_parse, model->ra);

        if (model->ra) {
            model->clip = lives::AnimClip::from_g4ra(*model->ra);
            if (model->clip) {
                model->player.set_clip(&*model->clip);
            }
        }

        return model;
    } catch (...) {
        return nullptr;
    }
}

void iecode_model_destroy(iecode_model_t* model) {
    delete model;
}

void iecode_model_update(iecode_model_t* model, float dt) {
    if (!model) return;
    try {
        model->player.update(dt);
    } catch (...) {
        // Silencieux — ne pas propager a la frontiere FFI
    }
}

} // extern "C" — fin pipeline 3D

// ── Handles supplementaires (G4RA buffer, modding, UTF, tagged_bin, G4xx, G4MT, map_blocks) ──

/// Handle G4RA (API buffer) — conserve le buffer source pour extraction.
struct iecode_g4ra {
    std::vector<uint8_t>         data;
    iecode::level5::G4raFile     file;
};

/// Handle liste de mods — stocke la liste scannee + caches de strings.
struct iecode_mod_list {
    std::vector<iecode::modding::ModInfo> mods;
    // Les ModInfo contiennent deja des std::string — on retourne c_str() direct.
};

/// Handle rapport de conflits.
struct iecode_conflict_result {
    iecode::modding::ConflictReport report;
    mutable std::string             json_cache;
    mutable bool                    json_computed = false;
};

/// Handle UTF table.
struct iecode_utf {
    iecode::criware::UtfTable table;
    mutable std::string       json_cache;
    mutable bool              json_computed = false;
    // Cache de strings par cellule pour iecode_utf_get_string (lifetime handle).
    mutable std::unordered_map<uint64_t, std::string> str_cache;
};

/// Handle tagged binary — conserve le buffer source (raw_entries pointe dedans).
struct iecode_tagged_bin {
    std::vector<uint8_t>        data;
    iecode::level5::TaggedBin   parsed;
};

/// Handle G4xx — conserve le buffer source (raw span pointe dedans).
struct iecode_g4xx {
    std::vector<uint8_t>             data;
    iecode::level5::G4xxContainer    container;
};

/// Handle G4MT.
struct iecode_g4mt {
    iecode::level5::G4mtFile file;
    mutable std::string      json_cache;
    mutable bool             json_computed = false;
};

/// Handle map_block_list.
struct iecode_map_blocks {
    iecode::level5::MapBlockList list;
};

extern "C" {

// ── G4RA (buffer) ───────────────────────────────────────────────────

iecode_g4ra_t* iecode_g4ra_open(const uint8_t* data, size_t size) {
    try {
        if (!data || size == 0) return nullptr;
        auto* ra = new (std::nothrow) iecode_g4ra();
        if (!ra) return nullptr;
        ra->data.assign(data, data + size);
        auto parsed = iecode::level5::g4ra_parse(std::span<const uint8_t>(ra->data));
        if (!parsed) {
            delete ra;
            return nullptr;
        }
        ra->file = std::move(*parsed);
        return ra;
    } catch (...) {
        return nullptr;
    }
}

void iecode_g4ra_free(iecode_g4ra_t* ra) {
    delete ra;
}

uint32_t iecode_g4ra_entry_count(iecode_g4ra_t* ra) {
    if (!ra) return 0;
    return ra->file.entry_count;
}

const char* iecode_g4ra_entry_name(iecode_g4ra_t* ra, uint32_t idx) {
    if (!ra || idx >= ra->file.entries.size()) return nullptr;
    return ra->file.entries[idx].name.c_str();
}

int iecode_g4ra_extract(iecode_g4ra_t* ra, uint32_t idx, uint8_t** out, size_t* out_size) {
    try {
        if (!ra || !out || !out_size) return -1;
        if (idx >= ra->file.entries.size()) return -1;
        const auto& e = ra->file.entries[idx];
        if (e.offset + e.size > ra->data.size()) return -1;
        auto* buf = new (std::nothrow) uint8_t[e.size];
        if (!buf) return -1;
        std::memcpy(buf, ra->data.data() + e.offset, e.size);
        *out = buf;
        *out_size = e.size;
        return 0;
    } catch (...) {
        return -1;
    }
}

// ── Modding ─────────────────────────────────────────────────────────

iecode_mod_list_t* iecode_mod_scan(const char* mods_dir) {
    try {
        if (!mods_dir) return nullptr;
        auto* list = new (std::nothrow) iecode_mod_list();
        if (!list) return nullptr;
        list->mods = iecode::modding::scan_mods(std::filesystem::path(mods_dir));
        return list;
    } catch (...) {
        return nullptr;
    }
}

void iecode_mod_list_free(iecode_mod_list_t* list) {
    delete list;
}

uint32_t iecode_mod_list_count(iecode_mod_list_t* list) {
    if (!list) return 0;
    return static_cast<uint32_t>(list->mods.size());
}

const char* iecode_mod_list_name(iecode_mod_list_t* list, uint32_t idx) {
    if (!list || idx >= list->mods.size()) return nullptr;
    const auto& m = list->mods[idx];
    return m.metadata.display_name.empty() ? m.name.c_str()
                                            : m.metadata.display_name.c_str();
}

const char* iecode_mod_list_id(iecode_mod_list_t* list, uint32_t idx) {
    if (!list || idx >= list->mods.size()) return nullptr;
    return list->mods[idx].name.c_str();
}

iecode_conflict_result_t* iecode_mod_check_conflicts(const char* game_path,
                                                      iecode_mod_list_t* mods) {
    try {
        (void)game_path; // reserve pour verifications futures
        if (!mods) return nullptr;
        auto* r = new (std::nothrow) iecode_conflict_result();
        if (!r) return nullptr;
        r->report = iecode::modding::detect_conflicts(mods->mods);
        return r;
    } catch (...) {
        return nullptr;
    }
}

void iecode_conflict_result_free(iecode_conflict_result_t* r) {
    delete r;
}

int iecode_conflict_result_has_conflicts(iecode_conflict_result_t* r) {
    if (!r) return 0;
    return r->report.has_conflicts() ? 1 : 0;
}

const char* iecode_conflict_result_json(iecode_conflict_result_t* r) {
    if (!r) return nullptr;
    if (!r->json_computed) {
        try {
            nlohmann::json j = nlohmann::json::object();
            nlohmann::json c = nlohmann::json::object();
            for (const auto& [file, mods] : r->report.conflicts) {
                c[file] = mods;
            }
            j["conflicts"] = std::move(c);
            j["count"]     = r->report.count();
            r->json_cache    = j.dump();
            r->json_computed = true;
        } catch (...) {
            r->json_cache    = "{}";
            r->json_computed = true;
        }
    }
    return r->json_cache.c_str();
}

int iecode_mod_install(const char* game_path, const char* mod_path,
                        const char* cpklist_path) {
    try {
        if (!game_path || !mod_path || !cpklist_path) return 0;

        // On scanne un seul mod : le dossier parent de mod_path sert de mods_dir
        // et on filtre sur le nom du dossier.
        const std::filesystem::path mp(mod_path);
        if (!std::filesystem::exists(mp)) return 0;

        iecode::modding::ModInfo mi;
        mi.name     = mp.filename().string();
        mi.path     = mp;
        mi.enabled  = true;
        mi.metadata = iecode::modding::load_mod_metadata(mp);

        iecode::modding::InstallOptions opts;
        opts.game_path    = std::filesystem::path(game_path);
        opts.cpklist_path = std::filesystem::path(cpklist_path);
        opts.platform     = iecode::modding::Platform::PC;
        opts.do_pack      = true;
        opts.cleanup_temp = true;

        auto result = iecode::modding::install_mods({mi}, opts);
        return result.success ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

int iecode_mod_uninstall(const char* game_path, const char* mod_id) {
    try {
        if (!game_path || !mod_id) return 0;
        // Pas d'API uninstall dediee : on s'appuie sur LastInstallManager
        // pour nettoyer les fichiers obsoletes si le mod n'est plus dans la liste.
        const std::filesystem::path data_dir =
            std::filesystem::path(game_path) / ".iecode";
        iecode::modding::LastInstallManager mgr(data_dir);
        auto rec = mgr.load();
        if (!rec) return 0;

        // Retire mod_id de la liste et deduit les fichiers a supprimer.
        std::vector<iecode::modding::ModInfo> remaining;
        // Impossible de reconstruire les ModInfo sans scan — on se contente
        // de vider l'enregistrement si le mod etait le seul installe.
        const std::string target = mod_id;
        bool was_present = false;
        for (const auto& n : rec->installed_mods) {
            if (n == target) { was_present = true; break; }
        }
        if (!was_present) return 0;

        // Cas simple : on vide tout ce qui avait ete installe.
        std::vector<std::filesystem::path> nothing;
        mgr.cleanup_obsolete_files(nothing, std::filesystem::path(game_path));
        mgr.clear();
        return 1;
    } catch (...) {
        return 0;
    }
}

const char* iecode_profile_list_json(const char* profiles_dir) {
    try {
        if (!profiles_dir) return nullptr;
        iecode::modding::ProfileManager mgr{std::filesystem::path{profiles_dir}};
        const auto profiles = mgr.list_profiles();
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& p : profiles) {
            nlohmann::json jp;
            jp["name"]             = p.name;
            jp["created_at"]       = p.created_at;
            jp["last_modified"]    = p.last_modified;
            jp["selected_cpk"]     = p.selected_cpk_name;
            jp["mod_count"]        = p.mods.size();
            arr.push_back(std::move(jp));
        }
        const std::string dump = arr.dump();
        // Allocation new[] pour etre compatible avec iecode_free (delete[]).
        auto* raw = new (std::nothrow) uint8_t[dump.size() + 1];
        if (!raw) return nullptr;
        std::memcpy(raw, dump.data(), dump.size());
        raw[dump.size()] = 0;
        return reinterpret_cast<const char*>(raw);
    } catch (...) {
        return nullptr;
    }
}

int iecode_profile_apply(const char* game_path, const char* profile_name,
                          const char* profiles_dir) {
    try {
        if (!game_path || !profile_name || !profiles_dir) return 0;
        iecode::modding::ProfileManager mgr{std::filesystem::path{profiles_dir}};
        auto profile = mgr.load_profile(profile_name);
        if (!profile) return 0;

        // Reconstruit les ModInfo depuis les entrees du profil. Les chemins
        // sont supposes etre relatifs au dossier du jeu (convention azalee).
        std::vector<iecode::modding::ModInfo> mods;
        mods.reserve(profile->mods.size());
        const std::filesystem::path game(game_path);
        for (const auto& entry : profile->mods) {
            if (!entry.enabled) continue;
            iecode::modding::ModInfo mi;
            mi.name    = entry.name;
            mi.path    = game / "mods" / entry.name;
            mi.enabled = true;
            if (std::filesystem::exists(mi.path)) {
                mi.metadata = iecode::modding::load_mod_metadata(mi.path);
                mods.push_back(std::move(mi));
            }
        }

        iecode::modding::InstallOptions opts;
        opts.game_path    = game;
        opts.cpklist_path = game / "data" / "cpk_list.cfg.bin";
        opts.platform     = iecode::modding::Platform::PC;
        opts.do_pack      = true;
        opts.cleanup_temp = true;

        auto result = iecode::modding::install_mods(mods, opts);
        return result.success ? 1 : 0;
    } catch (...) {
        return 0;
    }
}

// ── UTF parser ──────────────────────────────────────────────────────

iecode_utf_t* iecode_utf_parse(const uint8_t* data, size_t size) {
    try {
        if (!data || size == 0) return nullptr;
        auto parsed = iecode::criware::utf_parse(std::span<const uint8_t>(data, size));
        if (!parsed) return nullptr;
        auto* utf = new (std::nothrow) iecode_utf();
        if (!utf) return nullptr;
        utf->table = std::move(*parsed);
        return utf;
    } catch (...) {
        return nullptr;
    }
}

void iecode_utf_free(iecode_utf_t* utf) {
    delete utf;
}

uint32_t iecode_utf_row_count(iecode_utf_t* utf) {
    if (!utf) return 0;
    return static_cast<uint32_t>(utf->table.rows.size());
}

uint32_t iecode_utf_col_count(iecode_utf_t* utf) {
    if (!utf) return 0;
    return static_cast<uint32_t>(utf->table.columns.size());
}

const char* iecode_utf_col_name(iecode_utf_t* utf, uint32_t col) {
    if (!utf || col >= utf->table.columns.size()) return nullptr;
    return utf->table.columns[col].name.c_str();
}

const char* iecode_utf_get_string(iecode_utf_t* utf, uint32_t row, uint32_t col) {
    if (!utf) return nullptr;
    if (row >= utf->table.rows.size() || col >= utf->table.columns.size()) return nullptr;
    const auto& val = utf->table.rows[row].values[col];
    if (!std::holds_alternative<std::string>(val)) return nullptr;
    // Le string est deja stocke dans le variant — retourne son c_str() direct.
    return std::get<std::string>(val).c_str();
}

int32_t iecode_utf_get_int(iecode_utf_t* utf, uint32_t row, uint32_t col) {
    if (!utf) return 0;
    if (row >= utf->table.rows.size() || col >= utf->table.columns.size()) return 0;
    const auto& val = utf->table.rows[row].values[col];
    return std::visit([](const auto& v) -> int32_t {
        using T = std::decay_t<decltype(v)>;
        if constexpr (std::is_integral_v<T>) {
            return static_cast<int32_t>(v);
        } else if constexpr (std::is_floating_point_v<T>) {
            return static_cast<int32_t>(v);
        } else {
            return 0;
        }
    }, val);
}

int iecode_utf_to_json(iecode_utf_t* utf, char** out_json) {
    try {
        if (!utf || !out_json) return -1;
        nlohmann::json j;
        j["name"] = utf->table.name;
        nlohmann::json cols = nlohmann::json::array();
        for (const auto& c : utf->table.columns) {
            cols.push_back({{"name", c.name},
                            {"type", static_cast<int>(c.type)},
                            {"flags", c.flags}});
        }
        j["columns"] = std::move(cols);

        nlohmann::json rows = nlohmann::json::array();
        for (const auto& r : utf->table.rows) {
            nlohmann::json row = nlohmann::json::array();
            for (const auto& v : r.values) {
                std::visit([&row](const auto& val) {
                    using T = std::decay_t<decltype(val)>;
                    if constexpr (std::is_same_v<T, std::vector<uint8_t>>) {
                        row.push_back({{"data_size", val.size()}});
                    } else if constexpr (std::is_same_v<T, std::string>) {
                        row.push_back(val);
                    } else {
                        row.push_back(val);
                    }
                }, v);
            }
            rows.push_back(std::move(row));
        }
        j["rows"] = std::move(rows);

        const std::string dump = j.dump();
        auto* raw = new (std::nothrow) uint8_t[dump.size() + 1];
        if (!raw) return -1;
        std::memcpy(raw, dump.data(), dump.size());
        raw[dump.size()] = 0;
        *out_json = reinterpret_cast<char*>(raw);
        return 0;
    } catch (...) {
        return -1;
    }
}

// ── Tagged binary (clobin / linb / ptlb) ────────────────────────────

iecode_tagged_bin_t* iecode_tagged_bin_parse(const uint8_t* data, size_t size) {
    try {
        if (!data || size == 0) return nullptr;
        auto* tb = new (std::nothrow) iecode_tagged_bin();
        if (!tb) return nullptr;
        tb->data.assign(data, data + size);
        auto parsed = iecode::level5::tagged_bin_parse(
            std::span<const uint8_t>(tb->data), 0);
        if (!parsed) {
            delete tb;
            return nullptr;
        }
        tb->parsed = *parsed;
        return tb;
    } catch (...) {
        return nullptr;
    }
}

void iecode_tagged_bin_free(iecode_tagged_bin_t* tb) {
    delete tb;
}

uint32_t iecode_tagged_bin_count(iecode_tagged_bin_t* tb) {
    if (!tb) return 0;
    return tb->parsed.header.count;
}

uint32_t iecode_tagged_bin_type_hash(iecode_tagged_bin_t* tb) {
    if (!tb) return 0;
    return tb->parsed.header.type_hash;
}

const uint8_t* iecode_tagged_bin_raw_entries(iecode_tagged_bin_t* tb, size_t* out_size) {
    if (!tb || !out_size) return nullptr;
    *out_size = tb->parsed.raw_entries.size();
    return tb->parsed.raw_entries.data();
}

// ── G4LA / G4MA / G4VS ──────────────────────────────────────────────

namespace {

iecode_g4xx_t* g4xx_parse_generic(const uint8_t* data, size_t size, uint32_t expected_magic) {
    try {
        if (!data || size == 0) return nullptr;
        auto* g = new (std::nothrow) iecode_g4xx();
        if (!g) return nullptr;
        g->data.assign(data, data + size);
        auto parsed = iecode::level5::g4xx_parse(
            std::span<const uint8_t>(g->data), expected_magic);
        if (!parsed) {
            delete g;
            return nullptr;
        }
        g->container = std::move(*parsed);
        return g;
    } catch (...) {
        return nullptr;
    }
}

} // namespace

iecode_g4xx_t* iecode_g4la_parse(const uint8_t* data, size_t size) {
    return g4xx_parse_generic(data, size, iecode::level5::MAGIC_G4LA);
}

iecode_g4xx_t* iecode_g4ma_parse(const uint8_t* data, size_t size) {
    return g4xx_parse_generic(data, size, iecode::level5::MAGIC_G4MA);
}

iecode_g4xx_t* iecode_g4vs_parse(const uint8_t* data, size_t size) {
    return g4xx_parse_generic(data, size, iecode::level5::MAGIC_G4VS);
}

void iecode_g4xx_free(iecode_g4xx_t* g) {
    delete g;
}

uint32_t iecode_g4xx_data_size(iecode_g4xx_t* g) {
    if (!g) return 0;
    return g->container.data_size;
}

const uint8_t* iecode_g4xx_raw_data(iecode_g4xx_t* g, size_t* out_size) {
    if (!g || !out_size) return nullptr;
    *out_size = g->data.size();
    return g->data.data();
}

// ── G4MT ────────────────────────────────────────────────────────────

iecode_g4mt_t* iecode_g4mt_parse(const uint8_t* data, size_t size) {
    try {
        if (!data || size == 0) return nullptr;
        auto parsed = iecode::level5::g4mt_parse(std::span<const uint8_t>(data, size));
        if (!parsed) return nullptr;
        auto* mt = new (std::nothrow) iecode_g4mt();
        if (!mt) return nullptr;
        mt->file = std::move(*parsed);
        return mt;
    } catch (...) {
        return nullptr;
    }
}

void iecode_g4mt_free(iecode_g4mt_t* mt) {
    delete mt;
}

const char* iecode_g4mt_info_json(iecode_g4mt_t* mt) {
    if (!mt) return nullptr;
    if (!mt->json_computed) {
        try {
            nlohmann::json j;
            j["version"]      = mt->file.version;
            j["header_size"]  = mt->file.header_size;
            j["entry_count"]  = mt->file.entry_count;
            nlohmann::json entries = nlohmann::json::array();
            for (const auto& e : mt->file.entries) {
                entries.push_back({
                    {"texture_id",  e.texture_id},
                    {"material_id", e.material_id},
                    {"flags",       e.flags},
                    {"reserved",    e.reserved},
                });
            }
            j["entries"] = std::move(entries);
            mt->json_cache    = j.dump();
            mt->json_computed = true;
        } catch (...) {
            mt->json_cache    = "{}";
            mt->json_computed = true;
        }
    }
    return mt->json_cache.c_str();
}

// ── map_block_list ──────────────────────────────────────────────────

iecode_map_blocks_t* iecode_map_blocks_parse(const char* text) {
    try {
        if (!text) return nullptr;
        auto parsed = iecode::level5::MapBlockList::parse(std::string_view(text));
        if (!parsed) return nullptr;
        auto* mb = new (std::nothrow) iecode_map_blocks();
        if (!mb) return nullptr;
        mb->list = std::move(*parsed);
        return mb;
    } catch (...) {
        return nullptr;
    }
}

void iecode_map_blocks_free(iecode_map_blocks_t* mb) {
    delete mb;
}

uint32_t iecode_map_blocks_count(iecode_map_blocks_t* mb) {
    if (!mb) return 0;
    return static_cast<uint32_t>(mb->list.blocks.size());
}

const char* iecode_map_blocks_name(iecode_map_blocks_t* mb, uint32_t idx) {
    if (!mb || idx >= mb->list.blocks.size()) return nullptr;
    return mb->list.blocks[idx].crc_name.c_str();
}

int iecode_map_blocks_to_json(iecode_map_blocks_t* mb, char** out_json) {
    try {
        if (!mb || !out_json) return -1;
        nlohmann::json j;
        j["declared_count"] = mb->list.declared_count;
        nlohmann::json arr = nlohmann::json::array();
        for (const auto& b : mb->list.blocks) {
            arr.push_back({
                {"crc_name", b.crc_name},
                {"unk0",     b.unk0},
                {"unk1",     b.unk1},
            });
        }
        j["blocks"] = std::move(arr);
        const std::string dump = j.dump();
        auto* raw = new (std::nothrow) uint8_t[dump.size() + 1];
        if (!raw) return -1;
        std::memcpy(raw, dump.data(), dump.size());
        raw[dump.size()] = 0;
        *out_json = reinterpret_cast<char*>(raw);
        return 0;
    } catch (...) {
        return -1;
    }
}

} // extern "C" — fin exports supplementaires
