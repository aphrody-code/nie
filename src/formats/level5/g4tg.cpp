#include "iecode/formats/level5/g4tg.h"

#include <spdlog/spdlog.h>
#include <fstream>

namespace iecode::level5 {

std::optional<G4Tg> g4tg_load(std::span<const uint8_t> data) {
    if (data.empty()) {
        return std::nullopt;
    }
    G4Tg result;
    result.gpu_data.assign(data.begin(), data.end());
    return result;
}

bool g4tg_has_companion(const std::filesystem::path& g4tx_path) {
    auto companion = g4tx_path;
    companion.replace_extension(".g4tg");
    std::error_code ec;
    return std::filesystem::exists(companion, ec) && !ec;
}

std::optional<G4Tg> g4tg_load_companion(const std::filesystem::path& g4tx_path) {
    auto companion = g4tx_path;
    companion.replace_extension(".g4tg");

    std::error_code ec;
    if (!std::filesystem::exists(companion, ec) || ec) {
        return std::nullopt;
    }

    std::ifstream file(companion, std::ios::binary | std::ios::ate);
    if (!file) {
        spdlog::error("g4tg_load_companion: impossible d'ouvrir '{}'", companion.string());
        return std::nullopt;
    }

    const auto size = static_cast<size_t>(file.tellg());
    file.seekg(0);

    G4Tg result;
    result.gpu_data.resize(size);
    if (size > 0) {
        file.read(reinterpret_cast<char*>(result.gpu_data.data()),
                  static_cast<std::streamsize>(size));
    }

    if (!file.good() && !file.eof()) {
        spdlog::error("g4tg_load_companion: erreur de lecture pour '{}'", companion.string());
        return std::nullopt;
    }

    spdlog::debug("g4tg_load_companion: '{}' ({} octets)", companion.string(), size);
    return result;
}

} // namespace iecode::level5
