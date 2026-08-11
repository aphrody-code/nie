/// @file db/pg_push.cpp
/// Push des donnees de jeu vers PostgreSQL/Supabase via libpqxx.
///
/// Fonctions :
///   push_sync()      — connexion, create tables, upsert batch, retourne JSON
///   push_async()     — lance push_sync dans un std::thread detache
///   push_characters() — upsert uniquement les personnages
///   push_skills()    — upsert uniquement les skills
///
/// Conditionnel : compile si IECODE_HAS_PQXX est defini.
/// Sinon, les stubs loguent une erreur et retournent des valeurs vides.

#include "iecode/db/pg_push.h"

#include <chrono>
#include <thread>

#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

using json = nlohmann::json;

// ════════════════════════════════════════════════════════════════════════
// Implementation complete avec libpqxx
// ════════════════════════════════════════════════════════════════════════

#ifdef IECODE_HAS_PQXX

#include <pqxx/pqxx>

namespace iecode::db {

namespace {

// ── Prefixes pgpush_ pour unity build ───────────────────────────────

/// Schema SQL de la table characters.
constexpr const char* pgpush_kCreateCharacters = R"SQL(
CREATE TABLE IF NOT EXISTS characters (
    id              TEXT PRIMARY KEY,
    element         INT NOT NULL DEFAULT 0,
    position        INT NOT NULL DEFAULT 0,
    sub_position    INT NOT NULL DEFAULT 0,
    gender          INT NOT NULL DEFAULT 0,
    chara_rank      INT NOT NULL DEFAULT 0,
    growth_pattern  INT NOT NULL DEFAULT 0,
    play_style      INT NOT NULL DEFAULT 0
);
)SQL";

/// Schema SQL de la table skills.
constexpr const char* pgpush_kCreateSkills = R"SQL(
CREATE TABLE IF NOT EXISTS skills (
    id              TEXT PRIMARY KEY,
    power_min       INT NOT NULL DEFAULT 0,
    power_max       INT NOT NULL DEFAULT 0,
    tp_cost         INT NOT NULL DEFAULT 0,
    element         INT NOT NULL DEFAULT 0,
    category        INT NOT NULL DEFAULT 0,
    growth_type     INT NOT NULL DEFAULT 0,
    recast_time     INT NOT NULL DEFAULT 0
);
)SQL";

/// Schema SQL de la table teams.
constexpr const char* pgpush_kCreateTeams = R"SQL(
CREATE TABLE IF NOT EXISTS teams (
    id              TEXT PRIMARY KEY,
    order_type      INT NOT NULL DEFAULT 0,
    series_id       TEXT NOT NULL DEFAULT ''
);
)SQL";

/// Echappe une chaine pour l'insertion SQL (securite basique).
/// libpqxx fournit pqxx::connection::esc(), mais pour les batches
/// on utilise quote() sur la transaction.
std::string pgpush_quote(pqxx::work& tx, const std::string& s) {
    return tx.quote(s);
}

/// Cree les tables si elles n'existent pas.
void pgpush_create_tables(pqxx::connection& conn) {
    pqxx::work tx(conn);
    tx.exec(pgpush_kCreateCharacters).no_rows();
    tx.exec(pgpush_kCreateSkills).no_rows();
    tx.exec(pgpush_kCreateTeams).no_rows();
    tx.commit();
    spdlog::info("pg_push: tables creees/verifiees");
}

/// Tronque les tables (full refresh).
void pgpush_truncate_tables(pqxx::connection& conn) {
    pqxx::work tx(conn);
    tx.exec("TRUNCATE characters, skills, teams;").no_rows();
    tx.commit();
    spdlog::info("pg_push: tables tronquees (full refresh)");
}

/// Upsert un batch de personnages via multi-value INSERT.
/// Retourne le nombre de rows traitees.
size_t pgpush_upsert_characters_batch(
    pqxx::work& tx,
    const std::vector<gamedata::ParsedCharaParam>& chars,
    size_t offset,
    size_t count)
{
    if (count == 0) return 0;

    std::string sql = "INSERT INTO characters (id, element, position, sub_position, "
                      "gender, chara_rank, growth_pattern, play_style) VALUES ";

    const size_t end = std::min(offset + count, chars.size());
    bool first = true;

    for (size_t i = offset; i < end; ++i) {
        const auto& c = chars[i];
        if (!first) sql += ',';
        first = false;
        sql += fmt::format("({},{},{},{},{},{},{},{})",
            pgpush_quote(tx, c.chara_param_id),
            static_cast<int>(c.element),
            static_cast<int>(c.main_position),
            static_cast<int>(c.sub_position),
            static_cast<int>(c.gender),
            static_cast<int>(c.chara_rank),
            static_cast<int>(c.growth_pattern),
            static_cast<int>(c.play_style));
    }

    sql += " ON CONFLICT (id) DO UPDATE SET "
           "element = EXCLUDED.element, "
           "position = EXCLUDED.position, "
           "sub_position = EXCLUDED.sub_position, "
           "gender = EXCLUDED.gender, "
           "chara_rank = EXCLUDED.chara_rank, "
           "growth_pattern = EXCLUDED.growth_pattern, "
           "play_style = EXCLUDED.play_style";

    tx.exec(sql).no_rows();
    return end - offset;
}

/// Upsert un batch de skills via multi-value INSERT.
size_t pgpush_upsert_skills_batch(
    pqxx::work& tx,
    const std::vector<gamedata::ParsedSkill>& skills,
    size_t offset,
    size_t count)
{
    if (count == 0) return 0;

    std::string sql = "INSERT INTO skills (id, power_min, power_max, tp_cost, "
                      "element, category, growth_type, recast_time) VALUES ";

    const size_t end = std::min(offset + count, skills.size());
    bool first = true;

    for (size_t i = offset; i < end; ++i) {
        const auto& s = skills[i];
        if (!first) sql += ',';
        first = false;
        sql += fmt::format("({},{},{},{},{},{},{},{})",
            pgpush_quote(tx, s.skill_id),
            s.power_min,
            s.power_max,
            s.tp_cost,
            static_cast<int>(s.element),
            static_cast<int>(s.category),
            s.growth_type,
            s.recast_time);
    }

    sql += " ON CONFLICT (id) DO UPDATE SET "
           "power_min = EXCLUDED.power_min, "
           "power_max = EXCLUDED.power_max, "
           "tp_cost = EXCLUDED.tp_cost, "
           "element = EXCLUDED.element, "
           "category = EXCLUDED.category, "
           "growth_type = EXCLUDED.growth_type, "
           "recast_time = EXCLUDED.recast_time";

    tx.exec(sql).no_rows();
    return end - offset;
}

/// Upsert un batch de teams via multi-value INSERT.
size_t pgpush_upsert_teams_batch(
    pqxx::work& tx,
    const std::vector<gamedata::ParsedTeam>& teams,
    size_t offset,
    size_t count)
{
    if (count == 0) return 0;

    std::string sql = "INSERT INTO teams (id, order_type, series_id) VALUES ";

    const size_t end = std::min(offset + count, teams.size());
    bool first = true;

    for (size_t i = offset; i < end; ++i) {
        const auto& t = teams[i];
        if (!first) sql += ',';
        first = false;
        sql += fmt::format("({},{},{})",
            pgpush_quote(tx, t.team_id),
            t.order_type,
            pgpush_quote(tx, t.series_id));
    }

    sql += " ON CONFLICT (id) DO UPDATE SET "
           "order_type = EXCLUDED.order_type, "
           "series_id = EXCLUDED.series_id";

    tx.exec(sql).no_rows();
    return end - offset;
}

} // namespace anonyme

// ── API publique ────────────────────────────────────────────────────

size_t push_characters(const std::string& conn_str,
                       const std::vector<gamedata::ParsedCharaParam>& chars,
                       int batch_size)
{
    if (chars.empty()) return 0;

    try {
        pqxx::connection conn(conn_str);
        spdlog::info("pg_push: connecte a PostgreSQL (characters)");

        // Creer la table si necessaire
        {
            pqxx::work tx(conn);
            tx.exec(pgpush_kCreateCharacters).no_rows();
            tx.commit();
        }

        size_t total = 0;
        const size_t bs = static_cast<size_t>(std::max(batch_size, 1));

        for (size_t off = 0; off < chars.size(); off += bs) {
            const size_t n = std::min(bs, chars.size() - off);
            pqxx::work tx(conn);
            total += pgpush_upsert_characters_batch(tx, chars, off, n);
            tx.commit();
        }

        spdlog::info("pg_push: {} personnages upserted", total);
        return total;

    } catch (const pqxx::sql_error& e) {
        spdlog::error("pg_push characters SQL error: {} (query: {})", e.what(), e.query());
        return 0;
    } catch (const std::exception& e) {
        spdlog::error("pg_push characters error: {}", e.what());
        return 0;
    }
}

size_t push_skills(const std::string& conn_str,
                   const std::vector<gamedata::ParsedSkill>& skills,
                   int batch_size)
{
    if (skills.empty()) return 0;

    try {
        pqxx::connection conn(conn_str);
        spdlog::info("pg_push: connecte a PostgreSQL (skills)");

        // Creer la table si necessaire
        {
            pqxx::work tx(conn);
            tx.exec(pgpush_kCreateSkills).no_rows();
            tx.commit();
        }

        size_t total = 0;
        const size_t bs = static_cast<size_t>(std::max(batch_size, 1));

        for (size_t off = 0; off < skills.size(); off += bs) {
            const size_t n = std::min(bs, skills.size() - off);
            pqxx::work tx(conn);
            total += pgpush_upsert_skills_batch(tx, skills, off, n);
            tx.commit();
        }

        spdlog::info("pg_push: {} skills upserted", total);
        return total;

    } catch (const pqxx::sql_error& e) {
        spdlog::error("pg_push skills SQL error: {} (query: {})", e.what(), e.query());
        return 0;
    } catch (const std::exception& e) {
        spdlog::error("pg_push skills error: {}", e.what());
        return 0;
    }
}

std::string push_sync(const gamedata::GameDatabase& db,
                       const PushOptions& opts)
{
    const auto t0 = std::chrono::steady_clock::now();

    try {
        pqxx::connection conn(opts.connection_string);
        spdlog::info("pg_push: connecte a PostgreSQL");

        // 1. Creer les tables
        pgpush_create_tables(conn);

        // 2. Truncate si demande (full refresh)
        if (opts.truncate_first) {
            pgpush_truncate_tables(conn);
        }

        const size_t bs = static_cast<size_t>(std::max(opts.batch_size, 1));
        size_t n_chars = 0;
        size_t n_skills = 0;
        size_t n_teams = 0;

        // 3. Upsert characters par batches
        for (size_t off = 0; off < db.characters.size(); off += bs) {
            const size_t n = std::min(bs, db.characters.size() - off);
            pqxx::work tx(conn);
            n_chars += pgpush_upsert_characters_batch(tx, db.characters, off, n);
            tx.commit();

            if (opts.on_progress) {
                PushStats tmp;
                tmp.characters.store(n_chars);
                opts.on_progress(tmp, "characters");
            }
        }
        spdlog::info("pg_push: {} personnages upserted", n_chars);

        // 4. Upsert skills par batches
        for (size_t off = 0; off < db.skills.size(); off += bs) {
            const size_t n = std::min(bs, db.skills.size() - off);
            pqxx::work tx(conn);
            n_skills += pgpush_upsert_skills_batch(tx, db.skills, off, n);
            tx.commit();

            if (opts.on_progress) {
                PushStats tmp;
                tmp.characters.store(n_chars);
                tmp.skills.store(n_skills);
                opts.on_progress(tmp, "skills");
            }
        }
        spdlog::info("pg_push: {} skills upserted", n_skills);

        // 5. Upsert teams par batches
        for (size_t off = 0; off < db.teams.size(); off += bs) {
            const size_t n = std::min(bs, db.teams.size() - off);
            pqxx::work tx(conn);
            n_teams += pgpush_upsert_teams_batch(tx, db.teams, off, n);
            tx.commit();

            if (opts.on_progress) {
                PushStats tmp;
                tmp.characters.store(n_chars);
                tmp.skills.store(n_skills);
                tmp.teams.store(n_teams);
                opts.on_progress(tmp, "teams");
            }
        }
        spdlog::info("pg_push: {} teams upserted", n_teams);

        // 6. Calculer le temps ecoule
        const auto t1 = std::chrono::steady_clock::now();
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

        json result = {
            {"ok",         true},
            {"characters", n_chars},
            {"skills",     n_skills},
            {"teams",      n_teams},
            {"elapsed_ms", ms},
        };

        spdlog::info("pg_push: termine en {} ms", ms);
        return result.dump();

    } catch (const pqxx::sql_error& e) {
        const auto t1 = std::chrono::steady_clock::now();
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

        spdlog::error("pg_push SQL error: {} (query: {})", e.what(), e.query());

        json result = {
            {"ok",         false},
            {"error",      e.what()},
            {"query",      e.query()},
            {"elapsed_ms", ms},
        };
        return result.dump();

    } catch (const std::exception& e) {
        const auto t1 = std::chrono::steady_clock::now();
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count();

        spdlog::error("pg_push error: {}", e.what());

        json result = {
            {"ok",         false},
            {"error",      e.what()},
            {"elapsed_ms", ms},
        };
        return result.dump();
    }
}

void push_async(const gamedata::GameDatabase& db,
                const PushOptions& opts,
                PushStats& stats)
{
    // Copier les donnees necessaires pour le thread detache.
    // Le thread prend une reference vers stats (doit survivre au thread).
    std::thread([&db, opts, &stats]() {
        const auto t0 = std::chrono::steady_clock::now();

        try {
            pqxx::connection conn(opts.connection_string);
            spdlog::info("pg_push async: connecte a PostgreSQL");

            pgpush_create_tables(conn);

            if (opts.truncate_first) {
                pgpush_truncate_tables(conn);
            }

            const size_t bs = static_cast<size_t>(std::max(opts.batch_size, 1));

            // Upsert characters
            for (size_t off = 0; off < db.characters.size(); off += bs) {
                const size_t n = std::min(bs, db.characters.size() - off);
                pqxx::work tx(conn);
                const size_t done = pgpush_upsert_characters_batch(tx, db.characters, off, n);
                tx.commit();
                stats.characters.fetch_add(done, std::memory_order_relaxed);
            }
            spdlog::info("pg_push async: {} personnages", stats.characters.load());

            // Upsert skills
            for (size_t off = 0; off < db.skills.size(); off += bs) {
                const size_t n = std::min(bs, db.skills.size() - off);
                pqxx::work tx(conn);
                const size_t done = pgpush_upsert_skills_batch(tx, db.skills, off, n);
                tx.commit();
                stats.skills.fetch_add(done, std::memory_order_relaxed);
            }
            spdlog::info("pg_push async: {} skills", stats.skills.load());

            // Upsert teams
            for (size_t off = 0; off < db.teams.size(); off += bs) {
                const size_t n = std::min(bs, db.teams.size() - off);
                pqxx::work tx(conn);
                const size_t done = pgpush_upsert_teams_batch(tx, db.teams, off, n);
                tx.commit();
                stats.teams.fetch_add(done, std::memory_order_relaxed);
            }
            spdlog::info("pg_push async: {} teams", stats.teams.load());

        } catch (const std::exception& e) {
            spdlog::error("pg_push async error: {}", e.what());
            stats.errors.fetch_add(1, std::memory_order_relaxed);
        }

        const auto t1 = std::chrono::steady_clock::now();
        const auto ms = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count());
        stats.elapsed_ms.store(ms, std::memory_order_relaxed);
        stats.done.store(true, std::memory_order_release);

        spdlog::info("pg_push async: termine en {} ms", ms);
    }).detach();
}

} // namespace iecode::db

// ════════════════════════════════════════════════════════════════════════
// Stubs sans libpqxx
// ════════════════════════════════════════════════════════════════════════

#else // !IECODE_HAS_PQXX

namespace iecode::db {

namespace {

constexpr const char* pgpush_kNoPqxxMsg =
    "pg_push: libpqxx non disponible — recompiler avec -DIECODE_HAS_PQXX=1";

} // namespace anonyme

std::string push_sync(const gamedata::GameDatabase& /*db*/,
                       const PushOptions& /*opts*/)
{
    spdlog::error(pgpush_kNoPqxxMsg);
    json result = {
        {"ok",    false},
        {"error", pgpush_kNoPqxxMsg},
    };
    return result.dump();
}

void push_async(const gamedata::GameDatabase& /*db*/,
                const PushOptions& /*opts*/,
                PushStats& stats)
{
    spdlog::error(pgpush_kNoPqxxMsg);
    stats.errors.store(1, std::memory_order_relaxed);
    stats.done.store(true, std::memory_order_release);
}

size_t push_characters(const std::string& /*conn*/,
                       const std::vector<gamedata::ParsedCharaParam>& /*chars*/,
                       int /*batch_size*/)
{
    spdlog::error(pgpush_kNoPqxxMsg);
    return 0;
}

size_t push_skills(const std::string& /*conn*/,
                   const std::vector<gamedata::ParsedSkill>& /*skills*/,
                   int /*batch_size*/)
{
    spdlog::error(pgpush_kNoPqxxMsg);
    return 0;
}

} // namespace iecode::db

#endif // IECODE_HAS_PQXX
