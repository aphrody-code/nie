#pragma once

/// @file zstd_stream.h
/// Streaming Zstandard decompression wrapper.
///
/// ZSTD_inBuffer/outBuffer + ZSTD_decompressStream encapsules dans une
/// classe RAII presentant une interface pull-based (read N bytes) sur un
/// fichier zstd. Pas d'allocations dans le hot path : buffers reutilisables.

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <memory>
#include <span>
#include <string>
#include <vector>

struct ZSTD_DCtx_s;

namespace iecode::io {

/// Streaming reader over a file compressed with Zstandard.
///
/// Consomme un .zst sequentiellement et expose des lectures arbitraires
/// du stream decompresse via read() / read_exact() / skip(). Maintient
/// un compteur de la position decompressee (decompressed_offset()).
///
/// N'est pas thread-safe — usage mono-thread uniquement.
class ZstdInputStream {
public:
    /// @param compressed_path  Chemin vers le fichier .zst
    /// @param read_buffer_size Taille du buffer de lecture du fichier (defaut: ZSTD_DStreamInSize)
    explicit ZstdInputStream(const std::filesystem::path& compressed_path,
                             std::size_t read_buffer_size = 0);
    ~ZstdInputStream();

    ZstdInputStream(const ZstdInputStream&) = delete;
    ZstdInputStream& operator=(const ZstdInputStream&) = delete;
    ZstdInputStream(ZstdInputStream&&) noexcept;
    ZstdInputStream& operator=(ZstdInputStream&&) noexcept;

    /// @return true si le stream est ouvert et utilisable.
    [[nodiscard]] bool ok() const noexcept { return ok_; }

    /// @return Message d'erreur si ok() == false.
    [[nodiscard]] const std::string& error() const noexcept { return error_; }

    /// @return true si on a atteint la fin du stream decompresse.
    [[nodiscard]] bool eof() const noexcept { return eof_ && out_view_.empty(); }

    /// @return Position actuelle dans le stream decompresse.
    [[nodiscard]] std::uint64_t decompressed_offset() const noexcept { return decompressed_offset_; }

    /// @return Position actuelle dans le fichier compresse (octets lus).
    [[nodiscard]] std::uint64_t compressed_offset() const noexcept { return compressed_offset_; }

    /// Lit jusqu'a `dst.size()` octets dans `dst`. Peut retourner moins
    /// si EOF est atteint. @return Nombre d'octets effectivement lus.
    [[nodiscard]] std::size_t read(std::span<std::uint8_t> dst);

    /// Lit exactement `dst.size()` octets, ou false si EOF atteint avant.
    [[nodiscard]] bool read_exact(std::span<std::uint8_t> dst);

    /// Saute `count` octets en consommant le stream. @return true si OK.
    [[nodiscard]] bool skip(std::uint64_t count);

private:
    [[nodiscard]] bool refill();

    std::ifstream file_;
    std::vector<std::uint8_t> in_buf_;
    std::vector<std::uint8_t> out_buf_;
    std::span<const std::uint8_t> out_view_;
    std::size_t in_size_ = 0;     // octets valides dans in_buf_
    std::size_t in_pos_ = 0;      // position de lecture dans in_buf_

    ZSTD_DCtx_s* dctx_ = nullptr;

    std::uint64_t decompressed_offset_ = 0;
    std::uint64_t compressed_offset_ = 0;

    bool ok_ = false;
    bool eof_ = false;
    std::string error_;
};

} // namespace iecode::io
