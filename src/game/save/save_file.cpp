#include "iecode/game/save/save_file.h"

#include "iecode/game/save/save_container.h"
#include "iecode/game/save/save_crypto.h"

#include <cstdio>
#include <system_error>

namespace iecode::game {

namespace {

[[nodiscard]] std::optional<std::vector<uint8_t>>
read_all(const std::filesystem::path& path) {
    std::error_code ec;
    const auto size = std::filesystem::file_size(path, ec);
    if (ec) {
        return std::nullopt;
    }

#ifdef _WIN32
    FILE* fp = nullptr;
    if (_wfopen_s(&fp, path.wstring().c_str(), L"rb") != 0 || !fp) {
        return std::nullopt;
    }
#else
    FILE* fp = std::fopen(path.string().c_str(), "rb");
    if (!fp) {
        return std::nullopt;
    }
#endif

    std::vector<uint8_t> buffer(static_cast<size_t>(size));
    const size_t read = std::fread(buffer.data(), 1, buffer.size(), fp);
    std::fclose(fp);
    if (read != buffer.size()) {
        return std::nullopt;
    }
    return buffer;
}

} // namespace

std::optional<SaveFile>
load_save_file(const std::filesystem::path& path,
               std::span<const uint8_t, 16> key) {
    auto raw = read_all(path);
    if (!raw.has_value()) {
        return std::nullopt;
    }

    auto decrypted = save_decrypt(*raw, key);
    if (!decrypted.has_value()) {
        return std::nullopt;
    }

    auto data_bin = extract_data_bin(*decrypted);
    if (!data_bin.has_value()) {
        return std::nullopt;
    }

    SaveFile result;
    result.raw = std::move(*raw);
    result.decrypted = std::move(*decrypted);
    result.data_bin = std::move(*data_bin);
    return result;
}

} // namespace iecode::game
