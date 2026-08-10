#pragma once

/// @file cli_helpers.h
/// Helpers partages par les commandes CLI (unity-build safe).

#include <fmt/format.h>
#include <nlohmann/json.hpp>

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

namespace iecode::cli {

/// Lit un fichier binaire complet.
inline std::vector<uint8_t> read_file(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file) return {};
    const auto size = file.tellg();
    if (size <= 0) return {};
    std::vector<uint8_t> data(static_cast<size_t>(size));
    file.seekg(0);
    file.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

/// Ecrit un fichier binaire. Cree les repertoires parents si necessaire.
/// @return true si l'ecriture a reussi.
inline bool write_file(const std::filesystem::path& path,
                       std::span<const uint8_t> data) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream out(path, std::ios::binary);
    if (!out) return false;
    out.write(reinterpret_cast<const char*>(data.data()),
              static_cast<std::streamsize>(data.size()));
    return out.good();
}

/// Matching glob simple (supporte * et ?).
/// Exemples : "*.g4tx" matche "file.g4tx", "chara_*" matche "chara_001".
inline bool glob_match(std::string_view pattern, std::string_view text) {
    size_t pi = 0;
    size_t ti = 0;
    size_t star_pi = std::string_view::npos;
    size_t star_ti = 0;

    while (ti < text.size()) {
        if (pi < pattern.size() && (pattern[pi] == '?' || pattern[pi] == text[ti])) {
            ++pi;
            ++ti;
        } else if (pi < pattern.size() && pattern[pi] == '*') {
            star_pi = pi;
            star_ti = ti;
            ++pi;
        } else if (star_pi != std::string_view::npos) {
            pi = star_pi + 1;
            ++star_ti;
            ti = star_ti;
        } else {
            return false;
        }
    }

    while (pi < pattern.size() && pattern[pi] == '*') ++pi;
    return pi == pattern.size();
}

/// JSON stdout. Toutes les commandes sortent du JSON sur stdout.
inline void emit(const nlohmann::json& j) {
    fmt::print("{}\n", j.dump());
}

/// Emet une erreur JSON sur stdout.
inline void emit_error(const std::string& msg) {
    emit(nlohmann::json{{"ok", false}, {"error", msg}});
}

} // namespace iecode::cli
