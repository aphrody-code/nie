/// @file ievr_game.cpp
/// Implementation de la facade IevrGame.

#include "iecode/game/ievr_game.h"
#include "iecode/modding/steam_helper.h"

#include <fmt/chrono.h>
#include <fmt/format.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>

#include <chrono>
#include <system_error>

namespace iecode::game {

// ── Construction ────────────────────────────────────────────────────

IevrGame::IevrGame(std::filesystem::path game_path)
    : game_path_(std::move(game_path)),
      eac_service_(game_path_) {
    validate();
}

std::optional<IevrGame> IevrGame::detect() {
    auto result = iecode::modding::detect_game_path(STEAM_APP_ID);
    if (!result) {
        spdlog::debug("IevrGame::detect() — jeu non trouve via Steam");
        return std::nullopt;
    }
    spdlog::info("IevrGame::detect() — jeu trouve : {}",
                 result->game_path.string());
    return IevrGame(std::move(result->game_path));
}

// ── Accesseurs de chemins ───────────────────────────────────────────

const std::filesystem::path& IevrGame::game_path() const noexcept {
    return game_path_;
}

std::filesystem::path IevrGame::data_path() const {
    return game_path_ / "data";
}

std::filesystem::path IevrGame::packs_path() const {
    return game_path_ / "data" / "packs";
}

std::filesystem::path IevrGame::cpk_list_path() const {
    return game_path_ / "data" / "cpk_list.cfg.bin";
}

std::filesystem::path IevrGame::exe_path() const {
    return game_path_ / EXE_NAME;
}

std::filesystem::path IevrGame::system_config_path() const {
    return game_path_ / "data" / "common" / "system";
}

// ── Validation ──────────────────────────────────────────────────────

bool IevrGame::is_valid() const noexcept {
    return valid_;
}

void IevrGame::validate() {
    std::error_code ec;

    // Verifier que le dossier de jeu existe
    if (!std::filesystem::is_directory(game_path_, ec)) {
        spdlog::debug("IevrGame::validate() — dossier inexistant : {}",
                      game_path_.string());
        valid_ = false;
        return;
    }

    // Verifier que nie.exe existe
    if (!std::filesystem::is_regular_file(exe_path(), ec)) {
        spdlog::debug("IevrGame::validate() — exe manquant : {}",
                      exe_path().string());
        valid_ = false;
        return;
    }

    // Verifier que data/ existe
    if (!std::filesystem::is_directory(data_path(), ec)) {
        spdlog::debug("IevrGame::validate() — data/ manquant : {}",
                      data_path().string());
        valid_ = false;
        return;
    }

    valid_ = true;
    spdlog::debug("IevrGame::validate() — valide : {}", game_path_.string());
}

// ── Analyse ─────────────────────────────────────────────────────────

GameInfo IevrGame::analyze() const {
    GameInfo info;
    info.game_path = game_path_;
    info.exe_path = exe_path();

    std::error_code ec;

    // Taille de l'executable
    info.exe_size = static_cast<int64_t>(
        std::filesystem::file_size(info.exe_path, ec));
    if (ec) {
        spdlog::warn("IevrGame::analyze() — impossible de lire la taille de {} : {}",
                     info.exe_path.string(), ec.message());
        info.exe_size = 0;
    }

    // Compter les CPKs dans data/packs/
    const auto packs = packs_path();
    if (std::filesystem::is_directory(packs, ec)) {
        for (const auto& entry :
             std::filesystem::recursive_directory_iterator(packs, ec)) {
            if (ec) {
                spdlog::warn("IevrGame::analyze() — erreur iteration packs : {}",
                             ec.message());
                break;
            }
            if (!entry.is_regular_file(ec) || ec) continue;

            if (entry.path().extension() == ".cpk") {
                info.cpk_count++;
                const auto sz = entry.file_size(ec);
                if (!ec) {
                    info.total_cpk_size += static_cast<int64_t>(sz);
                }
            }
        }
    }

    // Verifier cpk_list.cfg.bin
    info.has_cpk_list = std::filesystem::is_regular_file(cpk_list_path(), ec);

    // Horodatage ISO 8601
    const auto now = std::chrono::system_clock::now();
    const auto time_t_now = std::chrono::system_clock::to_time_t(now);
    std::tm tm_utc{};
#ifdef _WIN32
    gmtime_s(&tm_utc, &time_t_now);
#else
    gmtime_r(&time_t_now, &tm_utc);
#endif
    info.analyzed_at = fmt::format("{:%Y-%m-%dT%H:%M:%SZ}", tm_utc);

    return info;
}

std::string IevrGame::export_info_json() const {
    const auto info = analyze();

    nlohmann::json j;
    j["game_path"] = info.game_path.string();
    j["exe_path"] = info.exe_path.string();
    j["exe_size"] = info.exe_size;
    j["cpk_count"] = info.cpk_count;
    j["total_cpk_size"] = info.total_cpk_size;
    j["has_cpk_list"] = info.has_cpk_list;
    j["analyzed_at"] = info.analyzed_at;

    return j.dump(2);
}

// ── Sous-systemes ───────────────────────────────────────────────────

iecode::services::EacService& IevrGame::eac() noexcept {
    return eac_service_;
}

const iecode::services::EacService& IevrGame::eac() const noexcept {
    return eac_service_;
}

} // namespace iecode::game
