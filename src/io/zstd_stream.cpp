/// @file zstd_stream.cpp
/// Implementation de ZstdInputStream.

#include "iecode/io/zstd_stream.h"

#include <zstd.h>

#include <algorithm>
#include <cstring>

namespace iecode::io {

ZstdInputStream::ZstdInputStream(const std::filesystem::path& compressed_path,
                                 std::size_t read_buffer_size) {
    file_.open(compressed_path, std::ios::binary);
    if (!file_) {
        error_ = "impossible d'ouvrir le fichier .zst";
        return;
    }

    dctx_ = ZSTD_createDCtx();
    if (!dctx_) {
        error_ = "ZSTD_createDCtx a echoue";
        return;
    }

    const std::size_t in_size  = read_buffer_size != 0 ? read_buffer_size
                                                       : ZSTD_DStreamInSize();
    const std::size_t out_size = ZSTD_DStreamOutSize();

    in_buf_.resize(in_size);
    out_buf_.resize(out_size);

    ok_ = true;
}

ZstdInputStream::~ZstdInputStream() {
    if (dctx_) {
        ZSTD_freeDCtx(dctx_);
        dctx_ = nullptr;
    }
}

ZstdInputStream::ZstdInputStream(ZstdInputStream&& other) noexcept
    : file_(std::move(other.file_)),
      in_buf_(std::move(other.in_buf_)),
      out_buf_(std::move(other.out_buf_)),
      out_view_(other.out_view_),
      in_size_(other.in_size_),
      in_pos_(other.in_pos_),
      dctx_(other.dctx_),
      decompressed_offset_(other.decompressed_offset_),
      compressed_offset_(other.compressed_offset_),
      ok_(other.ok_),
      eof_(other.eof_),
      error_(std::move(other.error_)) {
    other.dctx_ = nullptr;
    other.ok_ = false;
    other.out_view_ = {};
}

ZstdInputStream& ZstdInputStream::operator=(ZstdInputStream&& other) noexcept {
    if (this != &other) {
        if (dctx_) ZSTD_freeDCtx(dctx_);
        file_ = std::move(other.file_);
        in_buf_ = std::move(other.in_buf_);
        out_buf_ = std::move(other.out_buf_);
        out_view_ = other.out_view_;
        in_size_ = other.in_size_;
        in_pos_ = other.in_pos_;
        dctx_ = other.dctx_;
        decompressed_offset_ = other.decompressed_offset_;
        compressed_offset_ = other.compressed_offset_;
        ok_ = other.ok_;
        eof_ = other.eof_;
        error_ = std::move(other.error_);
        other.dctx_ = nullptr;
        other.ok_ = false;
        other.out_view_ = {};
    }
    return *this;
}

bool ZstdInputStream::refill() {
    if (!ok_) return false;
    if (!out_view_.empty()) return true;
    if (eof_) return false;

    while (out_view_.empty()) {
        // Recharger le buffer compresse si vide
        if (in_pos_ >= in_size_) {
            file_.read(reinterpret_cast<char*>(in_buf_.data()),
                       static_cast<std::streamsize>(in_buf_.size()));
            const auto got = file_.gcount();
            in_size_ = got > 0 ? static_cast<std::size_t>(got) : 0;
            in_pos_ = 0;
            compressed_offset_ += in_size_;

            if (in_size_ == 0) {
                // Fin du fichier compresse — verifier que le frame est complet
                eof_ = true;
                return false;
            }
        }

        ZSTD_inBuffer  zin { in_buf_.data() + in_pos_, in_size_ - in_pos_, 0 };
        ZSTD_outBuffer zout{ out_buf_.data(), out_buf_.size(), 0 };

        const std::size_t rc = ZSTD_decompressStream(dctx_, &zout, &zin);
        if (ZSTD_isError(rc)) {
            ok_ = false;
            error_ = std::string("zstd: ") + ZSTD_getErrorName(rc);
            return false;
        }

        in_pos_ += zin.pos;

        if (zout.pos > 0) {
            out_view_ = std::span<const std::uint8_t>(out_buf_.data(), zout.pos);
        }

        // rc == 0 : frame complet. Si plus de donnees compressees disponibles,
        // ZSTD_decompressStream redemarre automatiquement sur le prochain frame.
        if (rc == 0 && zout.pos == 0 && in_pos_ >= in_size_) {
            // Boucle pour recharger
            continue;
        }
    }

    return true;
}

std::size_t ZstdInputStream::read(std::span<std::uint8_t> dst) {
    std::size_t written = 0;
    while (written < dst.size()) {
        if (out_view_.empty() && !refill()) break;
        const std::size_t n = std::min(out_view_.size(), dst.size() - written);
        std::memcpy(dst.data() + written, out_view_.data(), n);
        out_view_ = out_view_.subspan(n);
        written += n;
        decompressed_offset_ += n;
    }
    return written;
}

bool ZstdInputStream::read_exact(std::span<std::uint8_t> dst) {
    return read(dst) == dst.size();
}

bool ZstdInputStream::skip(std::uint64_t count) {
    // Reutilise out_buf_ comme sink poubelle pour reduire les copies inutiles.
    while (count > 0) {
        if (out_view_.empty() && !refill()) return false;
        const std::size_t n = static_cast<std::size_t>(
            std::min<std::uint64_t>(out_view_.size(), count));
        out_view_ = out_view_.subspan(n);
        count -= n;
        decompressed_offset_ += n;
    }
    return true;
}

} // namespace iecode::io
