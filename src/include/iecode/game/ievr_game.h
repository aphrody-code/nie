#pragma once

/// @file ievr_game.h
/// Facade principale pour Inazuma Eleven: Victory Road.
///
/// Coordonne tous les sous-systemes : chemins, validation, analyse,
/// EAC bypass, et futur DumpService.
/// Point d'entree unique pour les operations sur le jeu installe.

#include "iecode/services/eac_service.h"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace iecode::game {

/// Informations analysees du jeu (structure de resultat immutable).
struct GameInfo {
    std::filesystem::path game_path;
    std::filesystem::path exe_path;
    int64_t exe_size = 0;
    int cpk_count = 0;
    int64_t total_cpk_size = 0;
    bool has_cpk_list = false;
    std::string analyzed_at; ///< ISO 8601 (ex: "2025-01-01T00:00:00Z")
};

// Forward declaration — Phase 2.2
// class DumpService;

/// Facade principale pour IEVR — coordonne tous les sous-systemes.
///
/// Usage typique :
/// @code
/// auto game = IevrGame::detect();
/// if (game && game->is_valid()) {
///     auto info = game->analyze();
///     spdlog::info("Trouve {} CPKs", info.cpk_count);
/// }
/// @endcode
class IevrGame {
public:
    // ── Constantes ──────────────────────────────────────────────────
    static constexpr uint32_t CRI_KEY = 0x1717E18Eu;
    static constexpr uint32_t STEAM_APP_ID = 2799860u;
    static constexpr std::string_view EXE_NAME = "nie.exe";
    static constexpr std::string_view GAME_FOLDER_NAME =
        "INAZUMA ELEVEN Victory Road";
    /// Cree depuis un chemin explicite vers le dossier du jeu.
    /// @param game_path chemin vers le dossier d'installation (contient nie.exe + data/)
    explicit IevrGame(std::filesystem::path game_path);

    // Move OK, pas de copie (EacService possede des chemins)
    IevrGame(IevrGame&&) noexcept = default;
    IevrGame& operator=(IevrGame&&) noexcept = default;
    IevrGame(const IevrGame&) = delete;
    IevrGame& operator=(const IevrGame&) = delete;

    /// Auto-detection via steam_helper::detect_game_path().
    /// @return instance configuree, ou nullopt si le jeu n'est pas trouve
    [[nodiscard]] static std::optional<IevrGame> detect();

    // ── Accesseurs de chemins ───────────────────────────────────────
    /// Chemin racine du jeu.
    [[nodiscard]] const std::filesystem::path& game_path() const noexcept;

    /// Chemin vers data/ (game_path/data/).
    [[nodiscard]] std::filesystem::path data_path() const;

    /// Chemin vers data/packs/ (contient les CPKs).
    [[nodiscard]] std::filesystem::path packs_path() const;

    /// Chemin vers data/cpk_list.cfg.bin.
    [[nodiscard]] std::filesystem::path cpk_list_path() const;

    /// Chemin vers nie.exe.
    [[nodiscard]] std::filesystem::path exe_path() const;

    /// Chemin vers data/common/system/.
    [[nodiscard]] std::filesystem::path system_config_path() const;

    // ── Validation ──────────────────────────────────────────────────
    /// Verifie que le dossier de jeu contient les fichiers attendus.
    [[nodiscard]] bool is_valid() const noexcept;

    // ── Analyse ─────────────────────────────────────────────────────
    /// Analyse la structure du jeu : compte les CPKs, taille exe, etc.
    /// Operation potentiellement lente (parcourt data/packs/ recursivement).
    [[nodiscard]] GameInfo analyze() const;

    /// Serialise les informations d'analyse en JSON.
    [[nodiscard]] std::string export_info_json() const;

    // ── Sous-systemes ───────────────────────────────────────────────
    /// Acces au service EAC (bypass/restore).
    [[nodiscard]] iecode::services::EacService& eac() noexcept;
    [[nodiscard]] const iecode::services::EacService& eac() const noexcept;

private:
    std::filesystem::path game_path_;
    bool valid_ = false;
    iecode::services::EacService eac_service_;

    /// Valide la presence de nie.exe et data/.
    void validate();
};

} // namespace iecode::game
