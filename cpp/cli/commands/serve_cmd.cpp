/// @file serve_cmd.cpp
/// Commande CLI 'serve' — serveur HTTP REST API pour les donnees de jeu.
///
/// Replique les endpoints de l'adaptateur Hono de inagle :
///   GET /              Info + stats
///   GET /characters    Liste paginee (limit, offset)
///   GET /characters/:id  Par ID ou code interne
///   GET /skills        Liste paginee
///   GET /items         Liste paginee + filtre category
///   GET /items/:id     Par ID
///   GET /quests        Liste paginee + filtre phase
///   GET /quests/:id    Par ID
///   GET /teams         Liste paginee
///   GET /passives      Liste paginee
///   GET /tactics       Liste paginee
///   GET /formations    Liste paginee
///   GET /search?q=     Recherche globale multi-domaine
///   GET /enriched      Personnages enrichis (fusionne base+param+skills+texts)
///   GET /enriched/:id  Par ID

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/gamedata/loader.h"
#include "iecode/gamedata/types.h"

#include <CLI/CLI.hpp>
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <functional>
#include <string>
#include <vector>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Helpers ───────────────────────────────────────────────────────────

static std::string str_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

static bool str_contains_ci(const std::string& haystack, const std::string& needle_lower) {
    if (needle_lower.empty() || haystack.empty()) return false;
    return str_lower(haystack).find(needle_lower) != std::string::npos;
}

/// Parse un query param entier avec valeur par defaut.
static int param_int(const httplib::Request& req, const std::string& name, int def) {
    if (!req.has_param(name)) return def;
    try { return std::stoi(req.get_param_value(name)); }
    catch (...) { return def; }
}

/// Parse un query param string (vide si absent).
static std::string param_str(const httplib::Request& req, const std::string& name) {
    if (!req.has_param(name)) return {};
    return req.get_param_value(name);
}

/// Verifie si un des champs de noms contient la requete (case-insensitive).
static bool matches_query(const gamedata::LocalizedNames& names, const std::string& query_lower) {
    if (query_lower.empty()) return true;
    return str_contains_ci(names.fr, query_lower) ||
           str_contains_ci(names.en, query_lower) ||
           str_contains_ci(names.ja, query_lower);
}

/// Genere un slug URL-friendly a partir du nom anglais (ou francais, ou code).
static std::string make_slug(const gamedata::LocalizedNames& names, const std::string& code) {
    const auto& base = !names.en.empty() ? names.en : (!names.fr.empty() ? names.fr : code);
    std::string slug;
    slug.reserve(base.size());
    for (unsigned char c : base) {
        if (std::isalnum(c)) slug += static_cast<char>(std::tolower(c));
        else if (c == ' ' || c == '_' || c == '-') {
            if (!slug.empty() && slug.back() != '-') slug += '-';
        }
    }
    while (!slug.empty() && slug.back() == '-') slug.pop_back();
    return slug;
}

/// Applique pagination. limit=0 retourne tout, sinon cap a 10000.
static json paginate(const json& arr, int limit, int offset) {
    const int total = static_cast<int>(arr.size());
    offset = std::max(offset, 0);
    if (limit <= 0) limit = total; // 0 = tout
    else limit = std::min(limit, 10000); // cap a 10k
    json page = json::array();
    for (int i = offset; i < std::min(offset + limit, total); ++i)
        page.push_back(arr[i]);
    return json{{"total", total}, {"data", std::move(page)}};
}

// ── JSON serializers (full objects, not search-abbreviated) ──────────

static json names_json(const gamedata::LocalizedNames& n) {
    json j;
    if (!n.ja.empty()) j["ja"] = n.ja;
    if (!n.en.empty()) j["en"] = n.en;
    if (!n.fr.empty()) j["fr"] = n.fr;
    if (!n.de.empty()) j["de"] = n.de;
    if (!n.es.empty()) j["es"] = n.es;
    if (!n.it.empty()) j["it"] = n.it;
    if (!n.pt.empty()) j["pt"] = n.pt;
    if (!n.zh_hans.empty()) j["zh_hans"] = n.zh_hans;
    if (!n.zh_hant.empty()) j["zh_hant"] = n.zh_hant;
    return j;
}

static json stats_json(const gamedata::CharacterStats& s) {
    return json{
        {"kick", s.kick}, {"control", s.control}, {"technique", s.technique},
        {"pressure", s.pressure}, {"physical", s.physical},
        {"agility", s.agility}, {"intelligence", s.intelligence},
    };
}

static json character_json(const gamedata::ParsedCharaParam& c) {
    json skills = json::array();
    for (const auto& sk : c.skills) {
        skills.push_back(json{{"skillId", sk.skill_id}, {"learnLevel", sk.learn_level}});
    }
    return json{
        {"charaParamId", c.chara_param_id},
        {"charaBaseId", c.chara_base_id},
        {"element", static_cast<int>(c.element)},
        {"mainPosition", static_cast<int>(c.main_position)},
        {"subPosition", static_cast<int>(c.sub_position)},
        {"gender", c.gender == gamedata::Gender::Female ? "F" : "M"},
        {"charaRank", static_cast<int>(c.chara_rank)},
        {"growthPattern", static_cast<int>(c.growth_pattern)},
        {"playStyle", static_cast<int>(c.play_style)},
        {"skills", std::move(skills)},
        {"stats", json{
            {"lv1", stats_json(c.stats.lv1)},
            {"lv30", stats_json(c.stats.lv30)},
            {"lv50", stats_json(c.stats.lv50)},
            {"lv99", stats_json(c.stats.lv99)},
        }},
    };
}

static json enriched_json(const gamedata::EnrichedCharacter& e) {
    json skills = json::array();
    for (const auto& sk : e.skills) {
        skills.push_back(json{
            {"skillId", sk.skill_id},
            {"learnLevel", sk.learn_level},
            {"names", names_json(sk.names)},
            {"powerMin", sk.power_min},
            {"powerMax", sk.power_max},
            {"element", static_cast<int>(sk.element)},
        });
    }
    return json{
        {"charaParamId", e.chara_param_id},
        {"charaBaseId", e.chara_base_id},
        {"internalCode", e.internal_code},
        {"slug", make_slug(e.names, e.internal_code)},
        {"names", names_json(e.names)},
        {"descriptions", names_json(e.descriptions)},
        {"element", static_cast<int>(e.element)},
        {"mainPosition", static_cast<int>(e.main_position)},
        {"subPosition", static_cast<int>(e.sub_position)},
        {"gender", e.gender == gamedata::Gender::Female ? "F" : "M"},
        {"charaRank", static_cast<int>(e.chara_rank)},
        {"growthPattern", static_cast<int>(e.growth_pattern)},
        {"playStyle", static_cast<int>(e.play_style)},
        {"teamId", e.team_id},
        {"teamNames", names_json(e.team_names)},
        {"seriesId", e.series_id},
        {"stats", json{
            {"lv1", stats_json(e.stats.lv1)},
            {"lv30", stats_json(e.stats.lv30)},
            {"lv50", stats_json(e.stats.lv50)},
            {"lv99", stats_json(e.stats.lv99)},
        }},
        {"skills", std::move(skills)},
    };
}

static json skill_json(const gamedata::ParsedSkill& s) {
    return json{
        {"skillId", s.skill_id},
        {"skillIdStr", s.skill_id_str},
        {"slug", make_slug(s.names, s.skill_id_str)},
        {"names", names_json(s.names)},
        {"descriptions", names_json(s.descriptions)},
        {"element", static_cast<int>(s.element)},
        {"category", static_cast<int>(s.category)},
        {"tpCost", s.tp_cost},
        {"powerMin", s.power_min},
        {"powerMax", s.power_max},
        {"growthType", s.growth_type},
        {"recastTime", s.recast_time},
        {"isEldorado", s.is_eldorado},
        {"seriesId", s.series_id},
    };
}

static json item_json(const gamedata::ParsedItem& i) {
    return json{
        {"itemId", i.item_id},
        {"internalCode", i.internal_code},
        {"slug", make_slug(i.names, i.internal_code)},
        {"names", names_json(i.names)},
        {"descriptions", names_json(i.descriptions)},
        {"category", i.category},
        {"priceGp", i.price_gp},
        {"stat1", i.stat1},
        {"stat2", i.stat2},
        {"uniformId", i.uniform_id},
    };
}

static json team_json(const gamedata::ParsedTeam& t) {
    return json{
        {"teamId", t.team_id},
        {"orderType", t.order_type},
        {"names", names_json(t.names)},
        {"seriesId", t.series_id},
    };
}

static json quest_json(const gamedata::ParsedQuest& q) {
    return json{
        {"questId", q.quest_id},
        {"phase", q.phase},
        {"type", q.type},
        {"image", q.image},
        {"titles", names_json(q.titles)},
    };
}

static json passive_json(const gamedata::ParsedPassive& p) {
    return json{
        {"passiveId", p.passive_id},
        {"effectId", p.effect_id},
        {"names", names_json(p.names)},
        {"descriptions", names_json(p.descriptions)},
        {"rarity", p.rarity},
        {"effectParams", p.effect_params},
        {"scope", p.scope},
    };
}

static json tactic_json(const gamedata::ParsedSpecialTactic& t) {
    return json{
        {"tacticsId", t.tactics_id},
        {"internalCode", t.internal_code},
        {"slug", make_slug(t.names, t.internal_code)},
        {"names", names_json(t.names)},
        {"descriptions", names_json(t.descriptions)},
        {"power", t.power},
        {"recastTime", t.recast_time},
        {"element", static_cast<int>(t.element)},
        {"partnerIds", t.partner_ids},
    };
}

static json formation_json(const gamedata::ParsedFormation& f) {
    json positions = json::array();
    for (const auto& p : f.positions) {
        positions.push_back(json{
            {"positionNo", p.position_no},
            {"positionId", p.position_id},
            {"passNo", p.pass_no},
            {"bKickoff", p.b_kickoff},
            {"bFollow", p.b_follow},
            {"defensePos", p.defense_pos},
            {"offensePos", p.offense_pos},
            {"startPos", p.start_pos},
        });
    }
    return json{
        {"formationId", f.formation_id},
        {"names", names_json(f.names)},
        {"descriptions", names_json(f.descriptions)},
        {"powerOffense", f.power_offense},
        {"powerDefense", f.power_defense},
        {"positions", std::move(positions)},
    };
}

static json basara_json(const gamedata::BasaraCharacter& b) {
    json skills = json::array();
    for (const auto& sk : b.skills) {
        skills.push_back(json{
            {"skillId", sk.skill_id},
            {"learnLevel", sk.learn_level},
            {"names", names_json(sk.names)},
            {"powerMin", sk.power_min},
            {"powerMax", sk.power_max},
            {"element", static_cast<int>(sk.element)},
        });
    }
    json builds = json::array();
    for (const auto& bt : b.builds) {
        builds.push_back(json{
            {"type", bt.type},
            {"boardId", bt.board_id},
        });
    }
    return json{
        {"charaParamId", b.chara_param_id},
        {"charaBaseId", b.chara_base_id},
        {"internalCode", b.internal_code},
        {"slug", make_slug(b.names, b.internal_code)},
        {"names", names_json(b.names)},
        {"element", static_cast<int>(b.element)},
        {"mainPosition", static_cast<int>(b.main_position)},
        {"gender", b.gender == gamedata::Gender::Female ? "F" : "M"},
        {"charaRank", static_cast<int>(b.chara_rank)},
        {"growthPattern", static_cast<int>(b.growth_pattern)},
        {"playStyle", static_cast<int>(b.play_style)},
        {"teamId", b.team_id},
        {"teamNames", names_json(b.team_names)},
        {"seriesId", b.series_id},
        {"index", b.index},
        {"stats", json{
            {"lv1", stats_json(b.stats.lv1)},
            {"lv30", stats_json(b.stats.lv30)},
            {"lv50", stats_json(b.stats.lv50)},
            {"lv99", stats_json(b.stats.lv99)},
        }},
        {"skills", std::move(skills)},
        {"builds", std::move(builds)},
    };
}

static json aura_json(const gamedata::ParsedAuraSkill& a) {
    return json{
        {"auraId", a.aura_id},
        {"auraIdStr", a.aura_id_str},
        {"slug", make_slug(a.names, a.aura_id_str)},
        {"names", names_json(a.names)},
        {"descriptions", names_json(a.descriptions)},
        {"power", a.power},
        {"tpCost", a.tp_cost},
        {"element", static_cast<int>(a.element)},
        {"subType", a.sub_type},
        {"seriesId", a.series_id},
    };
}

// ── New domain serializers ────────────────────────────────────────────

static json shop_json(const gamedata::ParsedShop& s) {
    return json{{"shopId", s.shop_id}, {"nameHash", s.name_hash}, {"itemIds", s.item_ids}};
}

static json opponent_json(const gamedata::ParsedOpponentTeam& o) {
    return json{
        {"opponentId", o.opponent_id}, {"type", o.type}, {"teamId", o.team_id},
        {"descTextId", o.desc_text_id}, {"difficultyType", o.difficulty_type},
        {"bgTextureName", o.bg_texture_name}, {"gameId", o.game_id},
    };
}

static json costume_json(const gamedata::ParsedCostume& c) {
    return json{
        {"modelRefCrc", c.model_ref_crc}, {"type", c.type},
        {"flag1", c.flag1}, {"flag2", c.flag2},
    };
}

static json uniform_json(const gamedata::ParsedUniform& u) {
    return json{
        {"fielderModelCrc", u.fielder_model_crc}, {"keeperModelCrc", u.keeper_model_crc},
        {"directorModelCrc", u.director_model_crc}, {"managerModelCrc", u.manager_model_crc},
        {"shoesFielderCrc", u.shoes_fielder_crc}, {"shoesKeeperCrc", u.shoes_keeper_crc},
        {"gloveModelCrc", u.glove_model_crc}, {"typeId", u.type_id},
        {"shoesModelAttr", u.shoes_model_attr}, {"uniformNgAttr", u.uniform_ng_attr},
        {"shoesLocked", u.shoes_locked},
    };
}

static json series_json(const gamedata::ParsedSeries& s) {
    return json{
        {"seriesId", s.series_id}, {"seriesType", s.series_type},
        {"nameTextId", s.name_text_id}, {"names", names_json(s.names)},
    };
}

static json constellation_json(const gamedata::ParsedConstellation& c) {
    return json{
        {"index", c.index}, {"hashId", c.hash_id},
        {"names", names_json(c.names)}, {"characterCount", c.character_count},
        {"characterIds", c.character_ids},
    };
}

static json gallery_json(const gamedata::ParsedGallery& g) {
    return json{
        {"galleryId", g.gallery_id}, {"imgPath", g.img_path},
        {"thumbPath", g.thumb_path}, {"needTokenNum", g.need_token_num},
        {"flgNo", g.flg_no}, {"openCond", g.open_cond},
    };
}

static json trick_json(const gamedata::ParsedTrick& t) {
    return json{
        {"trickId", t.trick_id}, {"trickIdName", t.trick_id_name},
        {"eventId", t.event_id}, {"eventIdName", t.event_id_name},
        {"failEventId", t.fail_event_id}, {"failEventIdName", t.fail_event_id_name},
        {"trickName", t.trick_name}, {"trickCategory", t.trick_category},
    };
}

static json mission_json(const gamedata::ParsedMission& m) {
    return json{
        {"missionId", m.mission_id}, {"code", m.code},
        {"names", names_json(m.names)},
    };
}

static json trophy_json(const gamedata::ParsedTrophy& t) {
    return json{
        {"trophyId", t.trophy_id}, {"code", t.code},
        {"names", names_json(t.names)}, {"descriptions", names_json(t.descriptions)},
    };
}

static json music_json(const gamedata::ParsedMusic& m) {
    return json{
        {"musicId", m.music_id}, {"index", m.index}, {"names", names_json(m.names)},
    };
}

static json help_json(const gamedata::ParsedHelp& h) {
    return json{
        {"helpId", h.help_id}, {"image", h.image},
        {"nameIdx", h.name_idx}, {"descIdx", h.desc_idx},
        {"names", names_json(h.names)}, {"descriptions", names_json(h.descriptions)},
    };
}

static json enjoy_team_json(const gamedata::ParsedEnjoyModeTeam& e) {
    return json{
        {"teamId", e.team_id}, {"subId", e.sub_id}, {"colorCrc", e.color_crc},
        {"type", e.type}, {"formationCrc", e.formation_crc},
        {"texturePath", e.texture_path}, {"textureName", e.texture_name},
    };
}

static json skill_technic_json(const gamedata::ParsedSkillTechnic& s) {
    return json{
        {"id", s.id}, {"winSubMotionCrc", s.win_sub_motion_crc},
        {"loseSubMotionCrc", s.lose_sub_motion_crc}, {"loseType", s.lose_type},
        {"formationType", s.formation_type}, {"formationCharaLen", s.formation_chara_len},
        {"shootCurveMidRate", s.shoot_curve_mid_rate},
        {"shootCurveHeightRate", s.shoot_curve_height_rate},
        {"shootCurveAngle", s.shoot_curve_angle},
    };
}

static json ctrl_chara_json(const gamedata::ParsedCtrlChara& c) {
    return json{
        {"charaParamId", c.chara_param_id}, {"controlType", c.control_type},
        {"flags", c.flags},
    };
}

static json playstyle_json(const gamedata::PlaystyleEntry& p) {
    return json{
        {"playStyle", p.play_style}, {"nameEn", p.name_en}, {"nameFr", p.name_fr},
    };
}

// ── Search ────────────────────────────────────────────────────────────

struct SearchHit {
    std::string type;
    std::string id;
    std::string name;
    int score;
    json data;
};

/// Case-insensitive substring search with prefix-match scoring.
static int score_match(const std::string& text, const std::string& query_lower) {
    auto lower = str_lower(text);
    auto pos = lower.find(query_lower);
    if (pos == std::string::npos) return -1;

    int score = 0;
    // Prefix match bonus
    if (pos == 0) score += 1000;
    // Word-start bonus
    if (pos > 0 && (lower[pos - 1] == ' ' || lower[pos - 1] == '_')) score += 800;
    // Earlier position
    score += 300 - static_cast<int>(std::min(pos, size_t(30))) * 10;
    // Shorter strings = more specific
    score += 200 - static_cast<int>(std::min(lower.size(), size_t(50))) * 2;
    return score;
}

/// Cherche dans plusieurs champs et retourne le meilleur score.
static int best_score(const std::vector<std::string>& fields, const std::string& query_lower) {
    int best = -1;
    for (const auto& f : fields) {
        int s = score_match(f, query_lower);
        if (s > best) best = s;
    }
    return best;
}

static void global_search(const gamedata::GameDatabase& db,
                           const std::string& query,
                           int limit,
                           std::vector<SearchHit>& results) {
    const auto ql = str_lower(query);

    // Characters (enriched)
    for (const auto& c : db.enriched_characters) {
        int s = best_score({c.names.fr, c.names.en, c.names.ja, c.internal_code}, ql);
        if (s >= 0)
            results.push_back({"character", c.chara_param_id,
                               c.names.best(), s, enriched_json(c)});
    }

    // Skills
    for (const auto& sk : db.skills) {
        int s = best_score({sk.names.fr, sk.names.en, sk.names.ja, sk.skill_id_str}, ql);
        if (s >= 0)
            results.push_back({"skill", sk.skill_id,
                               sk.names.best(), s, skill_json(sk)});
    }

    // Items
    for (const auto& it : db.items) {
        int s = best_score({it.names.fr, it.names.en, it.names.ja, it.internal_code}, ql);
        if (s >= 0)
            results.push_back({"item", it.item_id,
                               it.names.best(), s, item_json(it)});
    }

    // Passives
    for (const auto& p : db.passives) {
        int s = best_score({p.names.fr, p.names.en, p.names.ja}, ql);
        if (s >= 0)
            results.push_back({"passive", p.passive_id,
                               p.names.best(), s, passive_json(p)});
    }

    // Teams
    for (const auto& t : db.teams) {
        int s = best_score({t.names.fr, t.names.en, t.names.ja}, ql);
        if (s >= 0)
            results.push_back({"team", t.team_id,
                               t.names.best(), s, team_json(t)});
    }

    // Tactics
    for (const auto& t : db.special_tactics) {
        int s = best_score({t.names.fr, t.names.en, t.names.ja, t.internal_code}, ql);
        if (s >= 0)
            results.push_back({"tactic", t.tactics_id,
                               t.names.best(), s, tactic_json(t)});
    }

    // Basara
    for (const auto& b : db.basara_characters) {
        int s = best_score({b.names.fr, b.names.en, b.names.ja, b.internal_code}, ql);
        if (s >= 0)
            results.push_back({"basara", b.chara_param_id,
                               b.names.best(), s, basara_json(b)});
    }

    // Auras
    for (const auto& a : db.aura_skills) {
        int s = best_score({a.names.fr, a.names.en, a.names.ja, a.aura_id_str}, ql);
        if (s >= 0)
            results.push_back({"aura", a.aura_id,
                               a.names.best(), s, aura_json(a)});
    }

    // Missions
    for (const auto& m : db.missions) {
        int s = best_score({m.names.fr, m.names.en, m.names.ja, m.code}, ql);
        if (s >= 0)
            results.push_back({"mission", m.mission_id,
                               m.names.best(), s, mission_json(m)});
    }

    // Trophies
    for (const auto& t : db.trophies) {
        int s = best_score({t.names.fr, t.names.en, t.names.ja, t.code}, ql);
        if (s >= 0)
            results.push_back({"trophy", t.trophy_id,
                               t.names.best(), s, trophy_json(t)});
    }

    // Music
    for (const auto& m : db.music) {
        int s = best_score({m.names.fr, m.names.en, m.names.ja}, ql);
        if (s >= 0)
            results.push_back({"music", m.music_id,
                               m.names.best(), s, music_json(m)});
    }

    // Constellations
    for (const auto& c : db.constellations) {
        int s = best_score({c.names.fr, c.names.en, c.names.ja}, ql);
        if (s >= 0)
            results.push_back({"constellation", c.hash_id,
                               c.names.best(), s, constellation_json(c)});
    }

    // Sort by score descending, then limit
    std::sort(results.begin(), results.end(),
              [](const SearchHit& a, const SearchHit& b) { return a.score > b.score; });
    if (static_cast<int>(results.size()) > limit)
        results.resize(static_cast<size_t>(limit));
}

// ── CORS middleware ───────────────────────────────────────────────────

static void set_cors(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
}

static void json_response(httplib::Response& res, const json& j) {
    set_cors(res);
    res.set_content(j.dump(), "application/json");
}

static void json_error(httplib::Response& res, int status, const std::string& msg) {
    set_cors(res);
    res.status = status;
    res.set_content(json{{"error", msg}}.dump(), "application/json");
}

// ── Serve command ─────────────────────────────────────────────────────

static void cmd_serve(const std::string& data_root, int port, const std::string& host) {
    const fs::path root(data_root);
    if (!fs::exists(root)) {
        spdlog::error("data root introuvable : '{}'", data_root);
        return;
    }

    spdlog::info("chargement de la base de donnees...");
    auto db = gamedata::load_game_database(root, true);
    if (!db) {
        spdlog::error("echec du chargement de la base de donnees");
        return;
    }

    spdlog::info("base chargee : {} characters, {} enriched, {} skills, {} items, "
                 "{} teams, {} quests, {} passives, {} tactics, {} formations, "
                 "{} basara, {} drops, {} auras",
                 db->characters.size(), db->enriched_characters.size(),
                 db->skills.size(), db->items.size(), db->teams.size(),
                 db->quests.size(), db->passives.size(), db->special_tactics.size(),
                 db->formations.size(), db->basara_characters.size(),
                 db->drop_tables.size(), db->aura_skills.size());

    // Pre-build JSON arrays for paginated endpoints
    spdlog::info("construction du cache JSON...");

    json all_characters = json::array();
    for (const auto& c : db->characters) all_characters.push_back(character_json(c));

    json all_enriched = json::array();
    for (const auto& e : db->enriched_characters) all_enriched.push_back(enriched_json(e));

    json all_skills = json::array();
    for (const auto& s : db->skills) all_skills.push_back(skill_json(s));

    json all_items = json::array();
    for (const auto& i : db->items) all_items.push_back(item_json(i));

    json all_teams = json::array();
    for (const auto& t : db->teams) all_teams.push_back(team_json(t));

    json all_quests = json::array();
    for (const auto& q : db->quests) all_quests.push_back(quest_json(q));

    json all_passives = json::array();
    for (const auto& p : db->passives) all_passives.push_back(passive_json(p));

    json all_tactics = json::array();
    for (const auto& t : db->special_tactics) all_tactics.push_back(tactic_json(t));

    json all_formations = json::array();
    for (const auto& f : db->formations) all_formations.push_back(formation_json(f));

    json all_basara = json::array();
    for (const auto& b : db->basara_characters) all_basara.push_back(basara_json(b));

    json all_auras = json::array();
    for (const auto& a : db->aura_skills) all_auras.push_back(aura_json(a));

    // Build category index for items
    std::unordered_map<std::string, json> items_by_category;
    for (const auto& i : db->items) {
        items_by_category[i.category].push_back(item_json(i));
    }

    // Build phase index for quests
    std::unordered_map<int, json> quests_by_phase;
    for (const auto& q : db->quests) {
        quests_by_phase[q.phase].push_back(quest_json(q));
    }

    spdlog::info("demarrage du serveur HTTP sur {}:{}...", host, port);

    httplib::Server svr;

    // CORS preflight
    svr.Options(R"(.*)", [](const httplib::Request&, httplib::Response& res) {
        set_cors(res);
        res.status = 204;
    });

    // GET / — Info + stats
    svr.Get("/", [&](const httplib::Request&, httplib::Response& res) {
        json_response(res, json{
            {"name", "iecode"},
            {"version", "1.0.0"},
            {"description", "Game Data API for Inazuma Eleven: Victory Road"},
            {"stats", json{
                {"characters", db->characters.size()},
                {"enriched", db->enriched_characters.size()},
                {"skills", db->skills.size()},
                {"teams", db->teams.size()},
                {"items", db->items.size()},
                {"quests", db->quests.size()},
                {"passives", db->passives.size()},
                {"tactics", db->special_tactics.size()},
                {"formations", db->formations.size()},
                {"shops", db->shops.size()},
                {"opponentTeams", db->opponent_teams.size()},
                {"basara", db->basara_characters.size()},
                {"dropTables", db->drop_tables.size()},
                {"auras", db->aura_skills.size()},
                {"costumes", db->costumes.size()},
                {"uniforms", db->uniforms.size()},
                {"series", db->series.size()},
                {"constellations", db->constellations.size()},
                {"capsules", db->capsules.size()},
                {"gallery", db->gallery.size()},
                {"tricks", db->tricks.size()},
                {"missions", db->missions.size()},
                {"trophies", db->trophies.size()},
                {"music", db->music.size()},
                {"help", db->help.size()},
                {"nfcLotteries", db->nfc_lotteries.size()},
                {"enjoyModeTeams", db->enjoy_mode_teams.size()},
                {"teamBuilds", db->team_builds.size()},
                {"skillTechnics", db->skill_technics.size()},
                {"realSkills", db->real_skills.size()},
                {"overrideSkills", db->override_skills.size()},
                {"passiveEffects", db->passive_effects.size()},
                {"changeAuraSkills", db->change_aura_skills.size()},
                {"ctrlCharas", db->ctrl_charas.size()},
                {"superTacticsBase", db->super_tactics_base.size()},
                {"playstyles", db->playstyles.size()},
                {"expTable", db->exp_table.size()},
            }},
        });
    });

    // GET /characters — liste paginee avec filtres optionnels
    svr.Get("/characters", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);
        int position = param_int(req, "position", -1);
        int rarity = param_int(req, "rarity", -1);

        bool has_filter = !q.empty() || element >= 0 || position >= 0 || rarity >= 0;

        if (!has_filter) {
            json_response(res, paginate(all_characters, limit, offset));
            return;
        }

        // Filtrage depuis les donnees source (pas de noms localises sur ParsedCharaParam,
        // on cherche dans chara_param_id)
        json filtered = json::array();
        for (const auto& c : db->characters) {
            if (!q.empty() && !str_contains_ci(c.chara_param_id, q) &&
                !str_contains_ci(c.chara_base_id, q)) continue;
            if (element >= 0 && static_cast<int>(c.element) != element) continue;
            if (position >= 0 && static_cast<int>(c.main_position) != position) continue;
            if (rarity >= 0 && static_cast<int>(c.chara_rank) != rarity) continue;
            filtered.push_back(character_json(c));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /characters/:id — by charaParamId or charaBaseId
    svr.Get(R"(/characters/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        // Try chara_by_id index first
        if (auto it = db->chara_by_id.find(id); it != db->chara_by_id.end()) {
            json_response(res, character_json(db->characters[it->second]));
            return;
        }
        // Try base characters by code
        for (const auto& b : db->base_characters) {
            if (b.code == id || b.chara_id == id) {
                // Find all params for this base
                json matches = json::array();
                for (const auto& c : db->characters) {
                    if (c.chara_base_id == b.chara_id)
                        matches.push_back(character_json(c));
                }
                if (!matches.empty()) {
                    json_response(res, json{{"total", matches.size()}, {"data", std::move(matches)}});
                    return;
                }
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /enriched — personnages enrichis avec filtres serveur
    svr.Get("/enriched", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);
        int position = param_int(req, "position", -1);
        int rarity = param_int(req, "rarity", -1);
        auto gender = param_str(req, "gender");
        auto team = param_str(req, "team");

        bool has_filter = !q.empty() || element >= 0 || position >= 0 ||
                          rarity >= 0 || !gender.empty() || !team.empty();

        if (!has_filter) {
            json_response(res, paginate(all_enriched, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& e : db->enriched_characters) {
            if (!q.empty() && !matches_query(e.names, q) &&
                !str_contains_ci(e.internal_code, q)) continue;
            if (element >= 0 && static_cast<int>(e.element) != element) continue;
            if (position >= 0 && static_cast<int>(e.main_position) != position) continue;
            if (rarity >= 0 && static_cast<int>(e.chara_rank) != rarity) continue;
            if (!gender.empty() && ((gender == "F" && e.gender != gamedata::Gender::Female) ||
                                    (gender == "M" && e.gender != gamedata::Gender::Male))) continue;
            if (!team.empty() && e.team_id != team) continue;
            filtered.push_back(enriched_json(e));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /enriched/:id — par charaParamId, internal code, ou slug
    svr.Get(R"(/enriched/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& e : db->enriched_characters) {
            if (e.chara_param_id == id || e.internal_code == id ||
                make_slug(e.names, e.internal_code) == id) {
                json_response(res, enriched_json(e));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /skills — liste paginee avec filtres
    svr.Get("/skills", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);
        int category = param_int(req, "category", -1);

        bool has_filter = !q.empty() || element >= 0 || category >= 0;

        if (!has_filter) {
            json_response(res, paginate(all_skills, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& s : db->skills) {
            if (!q.empty() && !matches_query(s.names, q) &&
                !str_contains_ci(s.skill_id_str, q)) continue;
            if (element >= 0 && static_cast<int>(s.element) != element) continue;
            if (category >= 0 && static_cast<int>(s.category) != category) continue;
            filtered.push_back(skill_json(s));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /skills/:id — par skillId, skillIdStr, ou slug
    svr.Get(R"(/skills/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& s : db->skills) {
            if (s.skill_id == id || s.skill_id_str == id ||
                make_slug(s.names, s.skill_id_str) == id) {
                json_response(res, skill_json(s));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /items — liste paginee avec filtres q et category
    svr.Get("/items", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        auto cat = param_str(req, "category");

        bool has_filter = !q.empty() || !cat.empty();

        if (!has_filter) {
            json_response(res, paginate(all_items, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& i : db->items) {
            if (!cat.empty() && i.category != cat) continue;
            if (!q.empty() && !matches_query(i.names, q) &&
                !str_contains_ci(i.internal_code, q)) continue;
            filtered.push_back(item_json(i));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /items/:id — par itemId, internal code, ou slug
    svr.Get(R"(/items/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        if (auto it = db->item_by_id.find(id); it != db->item_by_id.end()) {
            json_response(res, item_json(db->items[it->second]));
            return;
        }
        for (const auto& i : db->items) {
            if (i.internal_code == id ||
                make_slug(i.names, i.internal_code) == id) {
                json_response(res, item_json(i));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /teams — liste paginee avec filtre q
    svr.Get("/teams", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));

        if (q.empty()) {
            json_response(res, paginate(all_teams, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& t : db->teams) {
            if (!matches_query(t.names, q) && !str_contains_ci(t.team_id, q)) continue;
            filtered.push_back(team_json(t));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /quests — paginated list with optional phase filter
    svr.Get("/quests", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        if (req.has_param("phase")) {
            int phase = param_int(req, "phase", 0);
            if (auto it = quests_by_phase.find(phase); it != quests_by_phase.end()) {
                json_response(res, paginate(it->second, limit, offset));
            } else {
                json_response(res, json{{"total", 0}, {"data", json::array()}});
            }
        } else {
            json_response(res, paginate(all_quests, limit, offset));
        }
    });

    // GET /quests/:id
    svr.Get(R"(/quests/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        if (auto it = db->quest_by_id.find(id); it != db->quest_by_id.end()) {
            json_response(res, quest_json(db->quests[it->second]));
            return;
        }
        json_error(res, 404, "Not found");
    });

    // GET /passives — liste paginee avec filtres q et scope
    svr.Get("/passives", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        auto scope = param_str(req, "scope");

        bool has_filter = !q.empty() || !scope.empty();

        if (!has_filter) {
            json_response(res, paginate(all_passives, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& p : db->passives) {
            if (!q.empty() && !matches_query(p.names, q) &&
                !str_contains_ci(p.passive_id, q)) continue;
            if (!scope.empty() && p.scope != scope) continue;
            filtered.push_back(passive_json(p));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /passives/:id — par passiveId
    svr.Get(R"(/passives/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& p : db->passives) {
            if (p.passive_id == id) {
                json_response(res, passive_json(p));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /tactics — liste paginee avec filtres q et element
    svr.Get("/tactics", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);

        bool has_filter = !q.empty() || element >= 0;

        if (!has_filter) {
            json_response(res, paginate(all_tactics, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& t : db->special_tactics) {
            if (!q.empty() && !matches_query(t.names, q) &&
                !str_contains_ci(t.internal_code, q)) continue;
            if (element >= 0 && static_cast<int>(t.element) != element) continue;
            filtered.push_back(tactic_json(t));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /tactics/:id — par tacticsId, internalCode, ou slug
    svr.Get(R"(/tactics/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& t : db->special_tactics) {
            if (t.tactics_id == id || t.internal_code == id ||
                make_slug(t.names, t.internal_code) == id) {
                json_response(res, tactic_json(t));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /formations — paginated list
    svr.Get("/formations", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        json_response(res, paginate(all_formations, limit, offset));
    });

    // GET /basara — liste paginee avec filtres q, element, position
    svr.Get("/basara", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);
        int position = param_int(req, "position", -1);

        bool has_filter = !q.empty() || element >= 0 || position >= 0;

        if (!has_filter) {
            json_response(res, paginate(all_basara, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& b : db->basara_characters) {
            if (!q.empty() && !matches_query(b.names, q) &&
                !str_contains_ci(b.internal_code, q)) continue;
            if (element >= 0 && static_cast<int>(b.element) != element) continue;
            if (position >= 0 && static_cast<int>(b.main_position) != position) continue;
            filtered.push_back(basara_json(b));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /basara/:id — par charaParamId, internal code, ou slug
    svr.Get(R"(/basara/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        if (auto it = db->basara_by_id.find(id); it != db->basara_by_id.end()) {
            json_response(res, basara_json(db->basara_characters[it->second]));
            return;
        }
        for (const auto& b : db->basara_characters) {
            if (b.internal_code == id ||
                make_slug(b.names, b.internal_code) == id) {
                json_response(res, basara_json(b));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /drops/:itemId — sources de drop pour un item
    svr.Get(R"(/drops/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& item_id = req.matches[1].str();
        auto it = db->item_drop_sources.find(item_id);
        if (it == db->item_drop_sources.end()) {
            json_response(res, json{{"data", json::array()}});
            return;
        }
        json sources = json::array();
        for (const auto& [table_id, rate] : it->second) {
            sources.push_back(json{{"tableId", table_id}, {"rate", rate}});
        }
        json_response(res, json{{"data", std::move(sources)}});
    });

    // GET /auras — liste paginee avec filtres q, element, subType
    svr.Get("/auras", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 50);
        int offset = param_int(req, "offset", 0);
        auto q = str_lower(param_str(req, "q"));
        int element = param_int(req, "element", -1);
        int sub_type = param_int(req, "subType", -1);

        bool has_filter = !q.empty() || element >= 0 || sub_type >= 0;

        if (!has_filter) {
            json_response(res, paginate(all_auras, limit, offset));
            return;
        }

        json filtered = json::array();
        for (const auto& a : db->aura_skills) {
            if (!q.empty() && !matches_query(a.names, q) &&
                !str_contains_ci(a.aura_id_str, q)) continue;
            if (element >= 0 && static_cast<int>(a.element) != element) continue;
            if (sub_type >= 0 && a.sub_type != sub_type) continue;
            filtered.push_back(aura_json(a));
        }
        json_response(res, paginate(filtered, limit, offset));
    });

    // GET /auras/:id — par auraId, auraIdStr, ou slug
    svr.Get(R"(/auras/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& a : db->aura_skills) {
            if (a.aura_id == id || a.aura_id_str == id ||
                make_slug(a.names, a.aura_id_str) == id) {
                json_response(res, aura_json(a));
                return;
            }
        }
        json_error(res, 404, "Not found");
    });

    // GET /search?q= — global fuzzy search
    svr.Get("/search", [&](const httplib::Request& req, httplib::Response& res) {
        if (!req.has_param("q")) {
            json_error(res, 400, "Missing query param q");
            return;
        }
        const auto& q = req.get_param_value("q");
        int limit = param_int(req, "limit", 50);

        std::vector<SearchHit> hits;
        global_search(*db, q, limit, hits);

        json results = json::array();
        for (const auto& h : hits) {
            results.push_back(json{
                {"type", h.type},
                {"id", h.id},
                {"name", h.name},
                {"score", h.score},
                {"data", h.data},
            });
        }
        json_response(res, json{{"data", std::move(results)}});
    });

    // ── New endpoints ──────────────────────────────────────────────────

    svr.Get("/shops", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& s : db->shops) arr.push_back(shop_json(s));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/opponent-teams", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& o : db->opponent_teams) arr.push_back(opponent_json(o));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/costumes", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& c : db->costumes) arr.push_back(costume_json(c));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/uniforms", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& u : db->uniforms) arr.push_back(uniform_json(u));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/series", [&](const httplib::Request& /*req*/, httplib::Response& res) {
        json arr = json::array();
        for (const auto& s : db->series) arr.push_back(series_json(s));
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/constellations", [&](const httplib::Request& /*req*/, httplib::Response& res) {
        json arr = json::array();
        for (const auto& c : db->constellations) arr.push_back(constellation_json(c));
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get(R"(/constellations/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        for (const auto& c : db->constellations) {
            if (c.hash_id == id || std::to_string(c.index) == id) {
                json_response(res, constellation_json(c));
                return;
            }
        }
        json_error(res, 404, "Constellation not found");
    });

    svr.Get("/gallery", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& g : db->gallery) arr.push_back(gallery_json(g));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/tricks", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& t : db->tricks) arr.push_back(trick_json(t));
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/missions", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& m : db->missions) arr.push_back(mission_json(m));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/trophies", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& t : db->trophies) arr.push_back(trophy_json(t));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/dictionary", [&](const httplib::Request&, httplib::Response& res) {
        json habitats = json::array();
        for (const auto& h : db->dictionary_habitats) {
            habitats.push_back(json{
                {"habitatId", h.habitat_id}, {"mapId", h.map_id},
                {"mapNameId", h.map_name_id}, {"fileName", h.file_name},
                {"textureNameCrc", h.texture_name_crc}, {"showAreaTexture", h.show_area_texture},
            });
        }
        json_response(res, json{
            {"habitats", std::move(habitats)},
            {"observationCount", db->dictionary_observations.size()},
        });
    });

    svr.Get("/music", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& m : db->music) arr.push_back(music_json(m));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/help", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& h : db->help) arr.push_back(help_json(h));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/inacode", [&](const httplib::Request&, httplib::Response& res) {
        json stamps = json::array();
        for (const auto& s : db->inacode.stamps) {
            stamps.push_back(json{
                {"idCrc", s.id_crc}, {"imgNameCrc", s.img_name_crc},
                {"imgPathCrc", s.img_path_crc},
            });
        }
        json_response(res, json{
            {"stamps", std::move(stamps)},
            {"authorCount", db->inacode.author_count},
            {"commentCount", db->inacode.comment_count},
            {"stickerCount", db->inacode.sticker_count},
        });
    });

    svr.Get("/nfc-lottery", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& lot : db->nfc_lotteries) {
            json tables = json::array();
            for (const auto& tbl : lot.tables) {
                json items = json::array();
                for (const auto& item : tbl.items) {
                    items.push_back(json{
                        {"itemId", item.item_id}, {"type", item.type}, {"weight", item.weight},
                    });
                }
                tables.push_back(json{{"tableId", tbl.table_id}, {"items", std::move(items)}});
            }
            arr.push_back(json{{"lotteryId", lot.lottery_id}, {"tables", std::move(tables)}});
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/enjoy-teams", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 100);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& e : db->enjoy_mode_teams) arr.push_back(enjoy_team_json(e));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/team-build", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& tb : db->team_builds) {
            json effects = json::array();
            for (const auto& e : tb.effects) {
                effects.push_back(json{
                    {"effectId", e.effect_id}, {"threshold", e.threshold},
                    {"value", e.value}, {"conditions", e.conditions},
                });
            }
            json up = json::array();
            for (const auto& u : tb.up_data) {
                up.push_back(json{
                    {"type", u.type}, {"threshold", u.threshold}, {"multiplier", u.multiplier},
                    {"condValue1", u.cond_value1}, {"condValue2", u.cond_value2},
                    {"effectRefId", u.effect_ref_id}, {"effectCount", u.effect_count},
                });
            }
            json down = json::array();
            for (const auto& d : tb.down_data) {
                down.push_back(json{
                    {"type", d.type}, {"threshold", d.threshold}, {"multiplier", d.multiplier},
                    {"condValue1", d.cond_value1}, {"condValue2", d.cond_value2},
                    {"effectRefId", d.effect_ref_id}, {"effectCount", d.effect_count},
                });
            }
            arr.push_back(json{
                {"buildId", tb.build_id}, {"effects", std::move(effects)},
                {"upData", std::move(up)}, {"downData", std::move(down)},
            });
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/skill-technics", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& s : db->skill_technics) arr.push_back(skill_technic_json(s));
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/real-skills", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& rs : db->real_skills) {
            json courses = json::array();
            for (const auto& c : rs.shoot_courses) {
                courses.push_back(json{
                    {"targetRate", c.target_rate}, {"isGroundTarget", c.is_ground_target},
                    {"targetHeightOffset", c.target_height_offset},
                    {"targetHoriOffset", c.target_hori_offset},
                    {"curveRate", c.curve_rate}, {"curveHeightRate", c.curve_height_rate},
                    {"curveAngle", c.curve_angle}, {"moveTimeRate", c.move_time_rate},
                });
            }
            arr.push_back(json{
                {"id", rs.id}, {"loseType", rs.lose_type},
                {"formationType", rs.formation_type},
                {"formationCharaLen", rs.formation_chara_len},
                {"shootLimitBallHeightAttr", rs.shoot_limit_ball_height_attr},
                {"shootGroundingEffectName", rs.shoot_grounding_effect_name},
                {"shootCourses", std::move(courses)},
            });
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/override-skills", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& os : db->override_skills) {
            json conditions = json::array();
            for (const auto& c : os.conditions) {
                json skills = json::array();
                for (const auto& s : c.skills) {
                    skills.push_back(json{{"skillId", s.skill_id}, {"num", s.num}});
                }
                conditions.push_back(json{
                    {"conditionType", c.condition_type}, {"skills", std::move(skills)},
                });
            }
            arr.push_back(json{
                {"overrideSkillId", os.override_skill_id},
                {"conditions", std::move(conditions)},
            });
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/passive-effects", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& pe : db->passive_effects) {
            arr.push_back(json{{"effectId", pe.effect_id}, {"params", pe.params}});
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/change-aura-skills", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& cas : db->change_aura_skills) {
            arr.push_back(json{{"id", cas.id}, {"charaParamId", cas.chara_param_id}});
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/boost-groups", [&](const httplib::Request&, httplib::Response& res) {
        json spirits = json::array();
        for (const auto& s : db->boost_spirit_tables) {
            spirits.push_back(json{{"index", s.index}, {"spiritCrc", s.spirit_crc}});
        }
        json configs = json::array();
        for (const auto& c : db->boost_player_configs) {
            configs.push_back(json{{"duration", c.duration}, {"spiritIndices", c.spirit_indices}});
        }
        json_response(res, json{{"spiritTables", std::move(spirits)}, {"configs", std::move(configs)}});
    });

    svr.Get("/ctrl-charas", [&](const httplib::Request& req, httplib::Response& res) {
        int limit = param_int(req, "limit", 200);
        int offset = param_int(req, "offset", 0);
        json arr = json::array();
        for (const auto& c : db->ctrl_charas) arr.push_back(ctrl_chara_json(c));
        json_response(res, paginate(arr, limit, offset));
    });

    svr.Get("/super-tactics", [&](const httplib::Request&, httplib::Response& res) {
        json effects = json::array();
        for (const auto& e : db->super_tactics_effects) {
            effects.push_back(json{{"effectId", e.effect_id}, {"conditions", e.conditions}});
        }
        json base = json::array();
        for (const auto& b : db->super_tactics_base) {
            base.push_back(json{{"tacticsId", b.tactics_id}, {"rawVars", b.raw_vars}});
        }
        json_response(res, json{{"effects", std::move(effects)}, {"base", std::move(base)}});
    });

    svr.Get("/playstyles", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& p : db->playstyles) arr.push_back(playstyle_json(p));
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    svr.Get("/exp-table", [&](const httplib::Request&, httplib::Response& res) {
        json entries = json::array();
        for (const auto& e : db->exp_table) {
            entries.push_back(json{{"level", e.level}, {"needExp", e.need_exp}});
        }
        json rates = json::array();
        for (const auto& r : db->exp_rarity_rates) {
            rates.push_back(json{{"rarity", r.rarity}, {"rate", r.rate}});
        }
        json_response(res, json{{"entries", std::move(entries)}, {"rarityRates", std::move(rates)}});
    });

    svr.Get(R"(/evolution/(.+))", [&](const httplib::Request& req, httplib::Response& res) {
        const auto& id = req.matches[1].str();
        auto it = db->chara_by_id.find(id);
        if (it == db->chara_by_id.end()) {
            json_error(res, 404, "Character not found");
            return;
        }
        const auto& chara = db->characters[it->second];
        auto curve = gamedata::calculate_evolution_curve(*db, chara);

        json levels = json::array();
        for (const auto& snap : curve) {
            levels.push_back(json{
                {"level", snap.level}, {"stats", stats_json(snap.stats)},
                {"needExp", snap.need_exp}, {"cumulativeExp", snap.cumulative_exp},
            });
        }
        json_response(res, json{{"charaParamId", id}, {"levels", std::move(levels)}});
    });

    svr.Get("/capsules", [&](const httplib::Request&, httplib::Response& res) {
        json arr = json::array();
        for (const auto& cap : db->capsules) {
            json prizes = json::array();
            for (const auto& p : cap.prizes) {
                prizes.push_back(json{{"prizeId", p.prize_id}, {"rawVars", p.raw_vars}});
            }
            json rates = json::array();
            for (const auto& r : cap.rank_rates) {
                rates.push_back(json{
                    {"rateId", r.rate_id}, {"rank", r.rank}, {"weight", r.weight},
                });
            }
            arr.push_back(json{
                {"configId", cap.config_id}, {"prizes", std::move(prizes)},
                {"rankRates", std::move(rates)},
            });
        }
        json_response(res, json{{"total", arr.size()}, {"data", std::move(arr)}});
    });

    // Logger
    svr.set_logger([](const httplib::Request& req, const httplib::Response& res) {
        spdlog::debug("{} {} → {}", req.method, req.path, res.status);
    });

    spdlog::info("serveur pret : http://{}:{}", host, port);
    spdlog::info("Ctrl+C pour arreter");

    if (!svr.listen(host, port)) {
        spdlog::error("impossible de lier {}:{}", host, port);
    }
}

// ── Registration ──────────────────────────────────────────────────────

void register_serve_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("serve", "Start HTTP REST API server for game data");

    static std::string data_root;
    static int port = 3000;
    static std::string host = "0.0.0.0";

    cmd->add_option("--data", data_root, "Game data root directory")->default_val("data");
    cmd->add_option("--port,-p", port, "HTTP port (default: 3000)");
    cmd->add_option("--host,-H", host, "Bind address (default: 0.0.0.0)");

    cmd->callback([]() { cmd_serve(data_root, port, host); });
}

} // namespace iecode::cli
