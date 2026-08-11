/// @file mod_compatibility.cpp
/// Implementation de la verification de compatibilite avec la version du jeu.

#include "iecode/modding/mod_compatibility.h"

#include <fmt/format.h>
#include <spdlog/spdlog.h>

#include <charconv>
#include <fstream>
#include <regex>
#include <string>
#include <string_view>

namespace fs = std::filesystem;

namespace iecode::modding {

// ── Helpers ───────────────────────────────────────────────────────────

/// Parse une version en composants numeriques (ex: "5.00.24.00" -> {5, 0, 24, 0}).
static std::vector<int> parse_version_components(const std::string& ver) {
    std::vector<int> parts;
    if (ver.empty()) return parts;

    std::string_view sv = ver;

    // Supprimer le prefixe 'v'/'V' eventuel
    if (!sv.empty() && (sv.front() == 'v' || sv.front() == 'V')) {
        sv.remove_prefix(1);
    }

    while (!sv.empty()) {
        int val = 0;
        auto [ptr, ec] = std::from_chars(sv.data(), sv.data() + sv.size(), val);
        if (ec != std::errc{}) break;
        parts.push_back(val);

        // Avancer apres le nombre et le separateur
        auto consumed = static_cast<size_t>(ptr - sv.data());
        sv.remove_prefix(consumed);
        if (!sv.empty() && sv.front() == '.') {
            sv.remove_prefix(1);
        } else {
            break;
        }
    }

    return parts;
}

/// Compare deux versions composant par composant.
/// Retourne <0 si a < b, 0 si egal, >0 si a > b.
static int compare_versions(const std::vector<int>& a, const std::vector<int>& b) {
    const auto len = std::max(a.size(), b.size());
    for (size_t i = 0; i < len; ++i) {
        const int va = (i < a.size()) ? a[i] : 0;
        const int vb = (i < b.size()) ? b[i] : 0;
        if (va < vb) return -1;
        if (va > vb) return 1;
    }
    return 0;
}

/// Verifie si une version correspond a une specification.
/// Supporte :
///   - exact : "5.00.24.00"
///   - wildcard : "5.00.x", "5.x"
///   - operateur : ">=5.00.24.00", "<=5.00.24.00", ">5.0", "<5.0"
static bool version_matches_spec(const std::string& current,
                                 const std::string& spec) {
    if (spec.empty()) return true;  // pas de contrainte

    // Verifier les operateurs en prefixe
    std::string_view sv = spec;
    if (sv.starts_with(">=")) {
        sv.remove_prefix(2);
        auto target = parse_version_components(std::string(sv));
        auto cur = parse_version_components(current);
        return compare_versions(cur, target) >= 0;
    }
    if (sv.starts_with("<=")) {
        sv.remove_prefix(2);
        auto target = parse_version_components(std::string(sv));
        auto cur = parse_version_components(current);
        return compare_versions(cur, target) <= 0;
    }
    if (sv.starts_with('>')) {
        sv.remove_prefix(1);
        auto target = parse_version_components(std::string(sv));
        auto cur = parse_version_components(current);
        return compare_versions(cur, target) > 0;
    }
    if (sv.starts_with('<')) {
        sv.remove_prefix(1);
        auto target = parse_version_components(std::string(sv));
        auto cur = parse_version_components(current);
        return compare_versions(cur, target) < 0;
    }

    // Verifier le wildcard 'x' ou '*'
    // Ex: "5.00.x" matche "5.00.24.00", "5.x" matche "5.00.24.00"
    auto spec_parts = parse_version_components(spec);
    auto cur_parts = parse_version_components(current);

    // Trouver l'index du premier wildcard
    std::string clean_spec(spec);
    size_t wildcard_pos = std::string::npos;
    for (size_t i = 0; i < clean_spec.size(); ++i) {
        if (clean_spec[i] == 'x' || clean_spec[i] == 'X' || clean_spec[i] == '*') {
            // Compter le nombre de composants avant le wildcard
            size_t dot_count = 0;
            for (size_t j = 0; j < i; ++j) {
                if (clean_spec[j] == '.') ++dot_count;
            }
            wildcard_pos = dot_count;
            break;
        }
    }

    if (wildcard_pos != std::string::npos) {
        // Comparer uniquement les composants avant le wildcard
        for (size_t i = 0; i < wildcard_pos; ++i) {
            const int va = (i < cur_parts.size()) ? cur_parts[i] : 0;
            const int vb = (i < spec_parts.size()) ? spec_parts[i] : 0;
            if (va != vb) return false;
        }
        return true;
    }

    // Comparaison exacte
    return compare_versions(cur_parts, spec_parts) == 0;
}

// ── API publique ──────────────────────────────────────────────────────

std::vector<CompatibilityResult> check_compatibility(
    const std::vector<ModInfo>& mods,
    const std::string& game_version) {

    std::vector<CompatibilityResult> results;
    results.reserve(mods.size());

    for (const auto& mod : mods) {
        if (!mod.enabled) continue;

        CompatibilityResult cr;
        cr.mod_name = mod.name;
        cr.current_game_version = game_version;
        cr.mod_game_version = mod.metadata.game_version;

        if (mod.metadata.game_version.empty()) {
            // Pas de contrainte de version — compatible par defaut
            cr.compatible = true;
            cr.reason = "aucune contrainte de version";
        } else if (game_version.empty()) {
            // Version du jeu inconnue — avertissement
            cr.compatible = true;
            cr.reason = "version du jeu inconnue, compatibilite non verifiable";
        } else if (version_matches_spec(game_version, mod.metadata.game_version)) {
            cr.compatible = true;
            cr.reason = "compatible";
        } else {
            cr.compatible = false;
            cr.reason = fmt::format(
                "le mod cible la version '{}' mais le jeu est en '{}'",
                mod.metadata.game_version, game_version);
        }

        results.push_back(std::move(cr));
    }

    return results;
}

std::optional<std::string> detect_game_version(const fs::path& game_path) {
    if (game_path.empty() || !fs::is_directory(game_path)) {
        return std::nullopt;
    }

    // Strategie 1 : lire l'appmanifest Steam
    // Remonter depuis game_path (ex: steamapps/common/GAME/) vers steamapps/
    {
        auto steamapps = game_path.parent_path().parent_path();
        auto manifest = steamapps / "appmanifest_2799860.acf";

        if (fs::exists(manifest)) {
            try {
                std::ifstream file(manifest);
                if (file) {
                    std::string line;
                    while (std::getline(file, line)) {
                        // Chercher : "buildid" "NNNNNNN"
                        // Note : le buildid n'est pas exactement la version du jeu
                        // mais peut servir d'identifiant.
                        // Chercher plutot "versioninfo" ou un champ "version" custom
                    }
                }
            } catch (...) {
                // Ignorer les erreurs de lecture du manifest
            }
        }
    }

    // Strategie 2 : version connue par defaut
    // Le jeu est en version 5.00.24.00 (constante connue du projet)
    constexpr auto DEFAULT_VERSION = "5.00.24.00";

    // Verifier que nie.exe existe bien dans le dossier
    const auto exe_path = game_path / "nie.exe";
    if (fs::exists(exe_path)) {
        spdlog::debug("mod_compatibility: nie.exe trouve, version par defaut '{}'",
                      DEFAULT_VERSION);
        return DEFAULT_VERSION;
    }

    spdlog::warn("mod_compatibility: nie.exe introuvable dans '{}'",
                 game_path.string());
    return std::nullopt;
}

} // namespace iecode::modding
