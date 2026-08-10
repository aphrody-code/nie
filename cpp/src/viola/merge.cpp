#include "iecode/viola/merge.h"

#include <fmt/format.h>
#include <fstream>
#include <spdlog/spdlog.h>

namespace iecode::viola {

namespace {

// ── Helpers (prefixe viola_merge_ pour unity build) ────────────────

/// Copie un fichier de source vers dest en mode binaire.
/// Retourne la taille copiee, ou 0 en cas d'erreur.
[[nodiscard]] uint64_t viola_merge_copy_file(
    const std::filesystem::path& source,
    const std::filesystem::path& dest) {

    std::error_code ec;

    // Copier avec std::filesystem pour performance optimale
    std::filesystem::copy_file(source, dest,
                                std::filesystem::copy_options::overwrite_existing, ec);
    if (ec) {
        spdlog::warn("viola_merge: echec de copie '{}' -> '{}': {}",
                      source.string(), dest.string(), ec.message());
        return 0;
    }

    return std::filesystem::file_size(dest, ec);
}

} // namespace

MergeResult merge_directories(
    const std::filesystem::path& source,
    const std::filesystem::path& target,
    bool overwrite) {

    MergeResult result;
    std::error_code ec;

    // --- Verifier que la source existe ---
    if (!std::filesystem::exists(source, ec) || !std::filesystem::is_directory(source, ec)) {
        result.error = fmt::format("Dossier source inexistant ou invalide: '{}'", source.string());
        spdlog::error("viola_merge: {}", result.error);
        return result;
    }

    // --- Creer le dossier cible si necessaire ---
    if (!std::filesystem::exists(target, ec)) {
        std::filesystem::create_directories(target, ec);
        if (ec) {
            result.error = fmt::format("Impossible de creer le dossier cible '{}': {}",
                                        target.string(), ec.message());
            spdlog::error("viola_merge: {}", result.error);
            return result;
        }
        ++result.dirs_created;
    }

    spdlog::info("viola_merge: fusion '{}' -> '{}'", source.string(), target.string());

    // --- Parcourir recursivement la source ---
    for (const auto& entry : std::filesystem::recursive_directory_iterator(source, ec)) {
        // Chemin relatif par rapport a la source
        auto rel = std::filesystem::relative(entry.path(), source, ec);
        if (ec) continue;

        auto dest_path = target / rel;

        if (entry.is_directory()) {
            // Creer le dossier dans la cible s'il n'existe pas
            if (!std::filesystem::exists(dest_path, ec)) {
                std::filesystem::create_directories(dest_path, ec);
                if (!ec) {
                    ++result.dirs_created;
                } else {
                    spdlog::warn("viola_merge: impossible de creer '{}': {}",
                                  dest_path.string(), ec.message());
                }
            }
            continue;
        }

        if (!entry.is_regular_file()) continue;

        // Verifier si le fichier existe deja dans la cible
        if (std::filesystem::exists(dest_path, ec) && !overwrite) {
            ++result.files_skipped;
            spdlog::debug("viola_merge: ignore (existe deja) '{}'", rel.generic_string());
            continue;
        }

        // Creer le dossier parent si necessaire
        auto parent = dest_path.parent_path();
        if (!std::filesystem::exists(parent, ec)) {
            std::filesystem::create_directories(parent, ec);
            if (ec) {
                spdlog::warn("viola_merge: impossible de creer '{}': {}",
                              parent.string(), ec.message());
                continue;
            }
            ++result.dirs_created;
        }

        // Copier le fichier
        uint64_t bytes = viola_merge_copy_file(entry.path(), dest_path);
        if (bytes > 0 || std::filesystem::file_size(entry.path(), ec) == 0) {
            ++result.files_copied;
            result.bytes_copied += bytes;
            spdlog::debug("viola_merge: copie '{}' ({} octets)", rel.generic_string(), bytes);
        }
    }

    if (ec) {
        spdlog::warn("viola_merge: erreur d'iteration: {}", ec.message());
    }

    spdlog::info("viola_merge: fusion terminee — {} copies, {} ignores, {} dossiers crees",
                  result.files_copied, result.files_skipped, result.dirs_created);

    result.success = true;
    return result;
}

} // namespace iecode::viola
