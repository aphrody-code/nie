#pragma once

/// @file dump_service.h
/// Service d'extraction massive de toutes les archives CPK du jeu.
///
/// Fonctionnalites :
///   - Smart resume via manifest JSON (.iecode-manifest.json)
///   - Tri des CPK par taille croissante (petits d'abord)
///   - Extraction parallele (N workers, configurable)
///   - Sauvegarde periodique du manifest (toutes les 300s)
///   - Copie des loose files (cfg.bin, ini hors packs/)
///   - Callback de progression par phase

#include "iecode/formats/criware/cpk_reader.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace iecode::services {

/// Phase du processus de dump.
enum class DumpPhase {
    LOADING,       ///< Chargement du manifest existant
    PLANNING,      ///< Construction du plan d'extraction
    EXTRACTING,    ///< Extraction des CPK en cours
    COPYING_LOOSE, ///< Copie des fichiers loose (hors CPK)
    COMPLETED,     ///< Termine avec succes
    CANCELLED,     ///< Annule par l'utilisateur
    ERRORED        ///< Erreur fatale
};

/// Progression courante du dump.
struct DumpProgress {
    DumpPhase phase = DumpPhase::LOADING;
    std::string message;
    std::string current_cpk;
    int cpk_index = 0;
    int total_cpks = 0;
    int extracted_files = 0;
    int total_files = 0;
    int64_t extracted_bytes = 0;
    int64_t total_bytes = 0;
    double bytes_per_second = 0.0;
};

/// Options de configuration du dump.
struct DumpOptions {
    std::filesystem::path output_path;                       ///< Repertoire de sortie
    std::optional<std::filesystem::path> packs_path;         ///< Override du chemin packs/
    bool smart_dump = true;                                  ///< Reprise intelligente via manifest
    bool include_loose_files = true;                         ///< Copier les fichiers hors CPK
    int max_parallelism = 4;                                 ///< Nombre max de workers
    std::string file_filter;                                 ///< Glob filter (vide = tout)
    bool priority_mode = false;                              ///< Extrait gamedata/scripts avant textures
    int64_t large_file_threshold = 1 * 1024 * 1024;         ///< Seuil gros fichier en octets (defaut 1 MB)
    bool use_vfs = true;                                     ///< Utiliser cpk_list.cfg.bin pour le planning (plus rapide, filter-aware)
    std::function<void(const DumpProgress&)> on_progress;    ///< Callback de progression
};

/// Resultat final du dump.
struct DumpResult {
    bool success = false;
    bool was_cancelled = false;
    bool is_resume = false;
    std::string error;
    std::filesystem::path output_path;
    int total_cpks = 0;
    int total_files = 0;
    int extracted_files = 0;
    int skipped_files = 0;
    int loose_files_copied = 0;
    int64_t extracted_bytes = 0;
    std::vector<std::string> errors;
    double duration_seconds = 0.0;
};

/// Service d'extraction massive des CPK du jeu.
///
/// Port C++20 du DumpService C#. Gere la reprise via un manifest JSON,
/// le tri par taille, l'extraction parallele et la copie des loose files.
class DumpService {
public:
    /// Construit le service pour le repertoire de jeu donne.
    /// @param game_path racine du jeu (contient data/packs/)
    explicit DumpService(std::filesystem::path game_path);

    /// Execute le dump (bloquant, sans annulation externe).
    [[nodiscard]] DumpResult dump(const DumpOptions& options) const;

    /// Execute le dump avec support d'annulation via atomic flag.
    [[nodiscard]] DumpResult dump(const DumpOptions& options,
                                  std::atomic<bool>& cancel_flag) const;

    // ── Internal types (public for nlohmann serialization macros) ────

    /// Info d'un fichier deja extrait.
    struct ExtractedFileInfo {
        int64_t size = 0;
        std::string cpk_name;
    };

    /// Manifest de reprise — etat persistant sur disque.
    struct Manifest {
        std::string game_path;
        std::string created_at;
        std::string last_updated;
        std::unordered_set<std::string> completed_cpks;
        std::unordered_map<std::string, ExtractedFileInfo> extracted_files;
    };

private:
    std::filesystem::path game_path_;
    std::filesystem::path data_path_;
    std::filesystem::path packs_path_;

    /// Charge le manifest depuis le repertoire de sortie.
    [[nodiscard]] bool load_manifest(const std::filesystem::path& output_dir,
                                     Manifest& manifest) const;

    /// Sauvegarde le manifest dans le repertoire de sortie (thread-safe via copie).
    [[nodiscard]] bool save_manifest(const std::filesystem::path& output_dir,
                                     const Manifest& manifest) const;

    // ── Plan d'extraction ──────────────────────────────────────────────

    /// Element du plan : un CPK a extraire avec sa taille.
    struct CpkPlan {
        std::filesystem::path path;
        std::string name;
        int64_t size = 0;
    };

    /// Construit la liste triee des CPK a extraire (exclut les deja completes).
    [[nodiscard]] std::vector<CpkPlan> build_plan(
        const std::filesystem::path& packs_dir,
        const Manifest& manifest) const;

    // ── Extraction ─────────────────────────────────────────────────────

    /// Extrait un CPK unique vers output_path.
    /// Accumule les fichiers extraits dans un batch local, puis merge en une
    /// seule prise de mutex par CPK (au lieu d'une par fichier).
    void extract_cpk(const std::filesystem::path& cpk_path,
                     const std::filesystem::path& output_path,
                     const std::string& file_filter,
                     bool is_resume,
                     std::atomic<int>& files_out,
                     std::atomic<int64_t>& bytes_out,
                     std::mutex& manifest_mutex,
                     Manifest& manifest,
                     std::vector<std::string>& errors,
                     std::mutex& errors_mutex) const;

    /// Copie les fichiers loose (cfg.bin, ini) hors du dossier packs/.
    void copy_loose_files(const DumpOptions& opts,
                          const Manifest& manifest,
                          DumpResult& result) const;

    /// Retourne un timestamp ISO 8601 UTC.
    [[nodiscard]] static std::string now_iso8601();
};

} // namespace iecode::services
