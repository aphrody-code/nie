#pragma once

/// @file db/pg_push.h
/// Push ultra-rapide vers PostgreSQL/Supabase via libpqxx.
///
/// Optimisations :
///   1. Connexion unique persistante
///   2. Prepared statements (compile 1 fois, execute N fois)
///   3. Pipeline mode libpqxx (envoie batches sans attendre ACK)
///   4. Upsert batch 200 rows (ON CONFLICT DO UPDATE)
///   5. Thread detache pour tache de fond
///
/// Conditionnel IECODE_HAS_PQXX.

#include "iecode/gamedata/types.h"

#include <atomic>
#include <functional>
#include <string>
#include <vector>

namespace iecode::db {

/// Statistiques de push (thread-safe via atomics).
struct PushStats {
    std::atomic<size_t> characters{0};
    std::atomic<size_t> skills{0};
    std::atomic<size_t> teams{0};
    std::atomic<size_t> errors{0};
    std::atomic<uint64_t> elapsed_ms{0};
    std::atomic<bool> done{false};
};

/// Options de push.
struct PushOptions {
    std::string connection_string;  // postgresql://user:pw@host:5432/db
    int batch_size = 200;           // Rows par INSERT batch
    bool truncate_first = false;    // TRUNCATE avant insert (full refresh)
    /// Callback progression (thread-safe).
    std::function<void(const PushStats&, const std::string& table)> on_progress;
};

/// Push toutes les donnees en arriere-plan (thread detache).
/// Retourne immediatement. Verifier stats.done pour la completion.
void push_async(const gamedata::GameDatabase& db,
                 const PushOptions& opts,
                 PushStats& stats);

/// Push synchrone (bloque). Retourne JSON result.
[[nodiscard]] std::string push_sync(const gamedata::GameDatabase& db,
                                      const PushOptions& opts);

/// Push uniquement les personnages (synchrone).
[[nodiscard]] size_t push_characters(const std::string& conn,
                                      const std::vector<gamedata::ParsedCharaParam>& chars,
                                      int batch_size = 200);

/// Push uniquement les skills (synchrone).
[[nodiscard]] size_t push_skills(const std::string& conn,
                                  const std::vector<gamedata::ParsedSkill>& skills,
                                  int batch_size = 200);

} // namespace iecode::db
