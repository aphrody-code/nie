/// @file dump_gamedata_cmd.cpp
/// Commande CLI 'dump-gamedata' — export type des donnees de jeu en JSON.
///
/// Sous-types : character, skill, team, all
/// Utilise gamedata::load_game_database() pour charger les cfg.bin,
/// puis serialise en JSON sur stdout ou dans un fichier de sortie.

#include "commands.h"
#include "cli_helpers.h"

#include "iecode/gamedata/loader.h"
#include "iecode/gamedata/types.h"

#include <CLI/CLI.hpp>
#include <spdlog/spdlog.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace iecode::cli {

// ── Serialisation JSON ─────────────────────────────────────────────

static json char_to_json(const gamedata::ParsedCharaParam& c) {
    return json{
        {"id", c.chara_param_id},
        {"baseId", c.chara_base_id},
        {"rarity", static_cast<int>(c.chara_rank)},
        {"position", static_cast<int>(c.main_position)},
        {"subPosition", static_cast<int>(c.sub_position)},
        {"element", static_cast<int>(c.element)},
        {"gender", c.gender == gamedata::Gender::Female ? "F" : "M"},
        {"growthPattern", static_cast<int>(c.growth_pattern)},
        {"playStyle", static_cast<int>(c.play_style)},
        {"skillCount", c.skills.size()},
    };
}

static json skill_to_json(const gamedata::ParsedSkill& s) {
    json j{
        {"id", s.skill_id},
        {"idStr", s.skill_id_str},
        {"element", static_cast<int>(s.element)},
        {"category", static_cast<int>(s.category)},
        {"tpCost", s.tp_cost},
        {"powerMin", s.power_min},
        {"powerMax", s.power_max},
        {"growthType", s.growth_type},
        {"recastTime", s.recast_time},
        {"isEldorado", s.is_eldorado},
    };

    // Noms localises (uniquement si renseignes)
    json names;
    if (!s.names.en.empty()) names["en"] = s.names.en;
    if (!s.names.fr.empty()) names["fr"] = s.names.fr;
    if (!s.names.ja.empty()) names["ja"] = s.names.ja;
    if (!names.empty()) j["names"] = std::move(names);

    json descs;
    if (!s.descriptions.en.empty()) descs["en"] = s.descriptions.en;
    if (!s.descriptions.fr.empty()) descs["fr"] = s.descriptions.fr;
    if (!s.descriptions.ja.empty()) descs["ja"] = s.descriptions.ja;
    if (!descs.empty()) j["descriptions"] = std::move(descs);

    return j;
}

static json team_to_json(const gamedata::ParsedTeam& t) {
    json j{
        {"id", t.team_id},
        {"orderType", t.order_type},
    };

    json names;
    if (!t.names.en.empty()) names["en"] = t.names.en;
    if (!t.names.fr.empty()) names["fr"] = t.names.fr;
    if (!t.names.ja.empty()) names["ja"] = t.names.ja;
    if (!names.empty()) j["names"] = std::move(names);

    return j;
}

// ── Ecriture JSON (stdout ou fichier) ──────────────────────────────

static void write_output(const json& data, const std::string& output_path) {
    if (output_path.empty()) {
        emit(data);
        return;
    }

    fs::create_directories(fs::path(output_path).parent_path());
    std::ofstream out(output_path);
    if (!out) { emit_error(fmt::format("impossible d'ecrire '{}'", output_path)); return; }
    out << data.dump(2) << "\n";
    out.close();

    emit(json{
        {"ok", true},
        {"output", output_path},
        {"size", fs::file_size(output_path)},
    });
}

// ── Commande principale ────────────────────────────────────────────

static void cmd_dump_gamedata(const std::string& type,
                               const std::string& data_root,
                               const std::string& output_path) {
    const fs::path root(data_root);
    if (!fs::exists(root)) {
        emit_error(fmt::format("data root introuvable : '{}'", data_root));
        return;
    }

    // Charger les textes uniquement pour skills et teams (cross-reference noms)
    const bool need_text = (type != "character");
    auto db = gamedata::load_game_database(root, need_text);
    if (!db) {
        emit_error("echec du chargement de la base de donnees");
        return;
    }

    if (type == "character") {
        auto arr = json::array();
        for (const auto& c : db->characters) arr.push_back(char_to_json(c));

        write_output(json{
            {"ok", true},
            {"type", "character"},
            {"count", db->characters.size()},
            {"data", std::move(arr)},
        }, output_path);
    }
    else if (type == "skill") {
        auto arr = json::array();
        for (const auto& s : db->skills) arr.push_back(skill_to_json(s));

        write_output(json{
            {"ok", true},
            {"type", "skill"},
            {"count", db->skills.size()},
            {"data", std::move(arr)},
        }, output_path);
    }
    else if (type == "team") {
        auto arr = json::array();
        for (const auto& t : db->teams) arr.push_back(team_to_json(t));

        write_output(json{
            {"ok", true},
            {"type", "team"},
            {"count", db->teams.size()},
            {"data", std::move(arr)},
        }, output_path);
    }
    else if (type == "item") {
        auto arr = json::array();
        for (const auto& i : db->items) {
            json j{{"id", i.item_id}, {"category", i.category}, {"priceGp", i.price_gp}};
            json names;
            if (!i.names.en.empty()) names["en"] = i.names.en;
            if (!i.names.fr.empty()) names["fr"] = i.names.fr;
            if (!i.names.ja.empty()) names["ja"] = i.names.ja;
            if (!names.empty()) j["names"] = std::move(names);
            arr.push_back(std::move(j));
        }
        write_output(json{{"ok", true}, {"type", "item"}, {"count", db->items.size()}, {"data", std::move(arr)}}, output_path);
    }
    else if (type == "mission") {
        auto arr = json::array();
        for (const auto& m : db->missions) {
            json j{{"id", m.mission_id}, {"code", m.code}};
            json names;
            if (!m.names.en.empty()) names["en"] = m.names.en;
            if (!m.names.fr.empty()) names["fr"] = m.names.fr;
            if (!names.empty()) j["names"] = std::move(names);
            arr.push_back(std::move(j));
        }
        write_output(json{{"ok", true}, {"type", "mission"}, {"count", db->missions.size()}, {"data", std::move(arr)}}, output_path);
    }
    else if (type == "trophy") {
        auto arr = json::array();
        for (const auto& t : db->trophies) {
            json j{{"id", t.trophy_id}, {"code", t.code}};
            json names;
            if (!t.names.en.empty()) names["en"] = t.names.en;
            if (!t.names.fr.empty()) names["fr"] = t.names.fr;
            if (!names.empty()) j["names"] = std::move(names);
            arr.push_back(std::move(j));
        }
        write_output(json{{"ok", true}, {"type", "trophy"}, {"count", db->trophies.size()}, {"data", std::move(arr)}}, output_path);
    }
    else if (type == "all") {
        auto chars = json::array();
        for (const auto& c : db->characters) chars.push_back(char_to_json(c));

        auto skills = json::array();
        for (const auto& s : db->skills) skills.push_back(skill_to_json(s));

        auto teams = json::array();
        for (const auto& t : db->teams) teams.push_back(team_to_json(t));

        write_output(json{
            {"ok", true},
            {"type", "all"},
            {"characters", {{"count", db->characters.size()}, {"data", std::move(chars)}}},
            {"skills", {{"count", db->skills.size()}, {"data", std::move(skills)}}},
            {"teams", {{"count", db->teams.size()}, {"data", std::move(teams)}}},
            {"stats", json{
                {"items", db->items.size()},
                {"passives", db->passives.size()},
                {"quests", db->quests.size()},
                {"formations", db->formations.size()},
                {"costumes", db->costumes.size()},
                {"uniforms", db->uniforms.size()},
                {"constellations", db->constellations.size()},
                {"missions", db->missions.size()},
                {"trophies", db->trophies.size()},
                {"music", db->music.size()},
                {"tricks", db->tricks.size()},
                {"gallery", db->gallery.size()},
            }},
        }, output_path);
    }
    else {
        emit_error(fmt::format("type inconnu '{}' — utiliser character|skill|team|item|mission|trophy|all", type));
    }
}

// ── Registration ───────────────────────────────────────────────────

void register_dump_gamedata_command(CLI::App& app) {
    auto* cmd = app.add_subcommand("dump-gamedata", "Export game data as typed JSON");

    static std::string type;
    static std::string data_root;
    static std::string output_path;

    cmd->add_option("type", type, "Data type: character|skill|team|item|mission|trophy|all")->required();
    cmd->add_option("--data", data_root, "Game data root directory")->default_val("data");
    cmd->add_option("-o,--output", output_path, "Output file (default: stdout)");

    cmd->callback([]() { cmd_dump_gamedata(type, data_root, output_path); });
}

} // namespace iecode::cli
