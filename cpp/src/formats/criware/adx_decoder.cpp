/// @file adx_decoder.cpp
/// Decodeur ADX (CRI ADPCM) minimal.
/// Reference : spec publique du format ADX (vgmstream / CRI Middleware).

#include "iecode/formats/criware/adx_decoder.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

namespace iecode::criware {

namespace {

/// Lecture big-endian.
[[nodiscard]] uint16_t read_u16_be(const uint8_t* p) noexcept {
    return static_cast<uint16_t>((p[0] << 8) | p[1]);
}
[[nodiscard]] int16_t read_i16_be(const uint8_t* p) noexcept {
    return static_cast<int16_t>((p[0] << 8) | p[1]);
}
[[nodiscard]] uint32_t read_u32_be(const uint8_t* p) noexcept {
    return (static_cast<uint32_t>(p[0]) << 24) |
           (static_cast<uint32_t>(p[1]) << 16) |
           (static_cast<uint32_t>(p[2]) << 8)  |
            static_cast<uint32_t>(p[3]);
}

/// Extrait un nibble signe 4-bit (-8..7).
[[nodiscard]] int32_t signed_nibble(uint8_t nibble) noexcept {
    const int32_t v = static_cast<int32_t>(nibble & 0x0F);
    return (v & 0x08) ? (v - 16) : v;
}

constexpr int32_t ADX_FRAME_BYTES   = 18;
constexpr int32_t ADX_SAMPLES_FRAME = 32;

} // namespace

bool is_adx(std::span<const uint8_t> data) noexcept {
    return data.size() >= 4 && data[0] == 0x80 && data[1] == 0x00;
}

AdxPcm adx_decode(std::span<const uint8_t> data) {
    AdxPcm out;

    if (!is_adx(data)) {
        spdlog::error("adx_decode: magic invalide (attendu 0x8000)");
        return out;
    }
    if (data.size() < 20) {
        spdlog::error("adx_decode: header tronque ({} octets)", data.size());
        return out;
    }

    // Offset donnees = header[2..4] BE, puis +4 pour inclure les octets magic+offset.
    const uint32_t data_offset  = read_u16_be(data.data() + 2) + 4u;
    const uint8_t  encoding     = data[4];
    const uint8_t  block_size   = data[5];
    const uint8_t  bitdepth     = data[6];
    const uint8_t  channels     = data[7];
    const uint32_t sample_rate  = read_u32_be(data.data() + 8);
    const uint32_t total_samples = read_u32_be(data.data() + 12);
    const uint16_t highpass_hz  = read_u16_be(data.data() + 16);

    if (encoding != 3) {
        spdlog::error("adx_decode: encoding type {} non supporte (seul type 3)", encoding);
        return out;
    }
    if (block_size != ADX_FRAME_BYTES || bitdepth != 4) {
        spdlog::error("adx_decode: block_size={} bitdepth={} non supportes",
                      block_size, bitdepth);
        return out;
    }
    if (channels == 0 || channels > 2) {
        spdlog::error("adx_decode: channel_count {} non supporte", channels);
        return out;
    }
    if (sample_rate == 0 || total_samples == 0) {
        spdlog::error("adx_decode: sample_rate ou total_samples nul");
        return out;
    }
    if (data_offset >= data.size()) {
        spdlog::error("adx_decode: data_offset hors bornes");
        return out;
    }

    // --- Coefficients ADX (filtre ADPCM lineaire 2e ordre).
    // Formule officielle : a = sqrt(2) - cos(2*pi*fc/fs)
    //                      b = sqrt(2) - 1
    //                      coeff1 =  2 * (a - sqrt(a^2 - b^2)) / b * 4096
    //                      coeff2 = -(b^2) / (a - sqrt(a^2 - b^2))^2 * 4096 ... bref
    // En pratique pour highpass=500Hz / sr=44100 on obtient ~ (7298, -3535).
    // On utilise les coefficients par defaut si on ne peut pas recalculer.
    int32_t coeff1 = 7298;
    int32_t coeff2 = -3535;

    // Recalculer depuis highpass si valide (approximation reelle).
    if (highpass_hz > 0 && sample_rate > 0) {
        const double pi = 3.14159265358979323846;
        const double a  = 1.41421356 - std::cos(2.0 * pi * highpass_hz / static_cast<double>(sample_rate));
        const double b  = 1.41421356 - 1.0;
        const double c  = (a - std::sqrt((a + b) * (a - b))) / b;
        coeff1 = static_cast<int32_t>(c * 8192.0);
        coeff2 = static_cast<int32_t>(-(c * c) * 4096.0);
    }

    // --- Decodage
    out.sample_rate = sample_rate;
    out.channels    = channels;
    out.frame_count = total_samples;
    out.samples.resize(static_cast<size_t>(total_samples) * channels, 0);

    // Historique ADPCM par canal.
    std::array<int32_t, 2> prev1 = { 0, 0 };
    std::array<int32_t, 2> prev2 = { 0, 0 };

    // Les frames sont entrelacees : frame ch0, frame ch1, frame ch0, frame ch1...
    const uint8_t* stream = data.data() + data_offset;
    const size_t   avail  = data.size() - data_offset;

    const size_t frames_per_channel = (total_samples + ADX_SAMPLES_FRAME - 1) / ADX_SAMPLES_FRAME;
    const size_t need_bytes = frames_per_channel * channels * ADX_FRAME_BYTES;
    if (need_bytes > avail) {
        spdlog::warn("adx_decode: donnees tronquees ({} requis, {} disponibles)",
                     need_bytes, avail);
    }

    uint32_t written = 0;
    for (size_t f = 0; f < frames_per_channel && written < total_samples; ++f) {
        for (uint32_t ch = 0; ch < channels; ++ch) {
            const size_t frame_off = ((f * channels) + ch) * ADX_FRAME_BYTES;
            if (frame_off + ADX_FRAME_BYTES > avail) break;
            const uint8_t* frame = stream + frame_off;

            const int32_t scale = read_i16_be(frame) + 1;

            // 32 samples dans les 16 octets suivants.
            for (int32_t s = 0; s < ADX_SAMPLES_FRAME; ++s) {
                const uint8_t byte = frame[2 + (s >> 1)];
                const int32_t nib = (s & 1) ? signed_nibble(byte) : signed_nibble(byte >> 4);

                int32_t predicted = (coeff1 * prev1[ch] + coeff2 * prev2[ch]) >> 12;
                int32_t sample    = nib * scale + predicted;
                sample = std::clamp(sample, -32768, 32767);

                prev2[ch] = prev1[ch];
                prev1[ch] = sample;

                const uint32_t abs_idx = static_cast<uint32_t>(f * ADX_SAMPLES_FRAME + s);
                if (abs_idx >= total_samples) break;

                out.samples[static_cast<size_t>(abs_idx) * channels + ch] =
                    static_cast<int16_t>(sample);
            }
        }
        written += ADX_SAMPLES_FRAME;
    }

    return out;
}

} // namespace iecode::criware
