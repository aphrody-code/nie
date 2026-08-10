/// @file cri_sound_controller.cpp
/// Implementation du controleur audio CRI (lives::CCriSoundController).
/// CRI Atom Ex v2.29.4 / CRI FS v2.88.15.
/// Reference RE : audio_criatom_init.c.

#include "iecode/engine/sound/cri_sound_controller.h"

#include "iecode/formats/criware/adx_decoder.h"
#include "iecode/formats/criware/awb_reader.h"

#include <spdlog/spdlog.h>

#include <algorithm>
#include <fstream>
#include <system_error>

namespace lives {

namespace {

/// Charge un fichier binaire entier en memoire.
[[nodiscard]] std::vector<uint8_t> read_file(const std::filesystem::path& path) {
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return {};
    const auto size = f.tellg();
    if (size <= 0) return {};
    f.seekg(0, std::ios::beg);
    std::vector<uint8_t> data(static_cast<size_t>(size));
    f.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

/// Hash CRC32 simple d'une string (compatible hash VFS du jeu).
[[nodiscard]] uint32_t hash_path(std::string_view s) noexcept {
    // CRC32 IEEE polynomial reverse — implementation minimale.
    uint32_t crc = 0xFFFFFFFFu;
    for (unsigned char c : s) {
        crc ^= c;
        for (int i = 0; i < 8; ++i) {
            crc = (crc >> 1) ^ (0xEDB88320u & -static_cast<int32_t>(crc & 1u));
        }
    }
    return ~crc;
}

} // namespace

bool CCriSoundController::init(const std::filesystem::path& data_root) {
    if (initialized_) return true;

    if (!AudioEngine::get().init()) {
        spdlog::error("CCriSoundController: echec d'initialisation du backend audio");
        return false;
    }

    scan_sound_banks(data_root);
    initialized_ = true;
    spdlog::info("CCriSoundController: initialise ({} entrees)", bank_.size());
    return true;
}

void CCriSoundController::shutdown() {
    if (!initialized_) return;

    for (auto& [h, handle] : active_) {
        AudioEngine::get().stop(handle);
    }
    active_.clear();
    bank_.clear();
    AudioEngine::get().shutdown();
    initialized_ = false;
}

void CCriSoundController::tick() {
    if (!initialized_) return;
    AudioEngine::get().update();

    // Purger les entrees actives dont la voice est terminee.
    for (auto it = active_.begin(); it != active_.end();) {
        if (!AudioEngine::get().is_playing(it->second)) {
            it = active_.erase(it);
        } else {
            ++it;
        }
    }
}

void CCriSoundController::scan_sound_banks(const std::filesystem::path& data_root) {
    namespace fs = std::filesystem;

    std::error_code ec;
    const auto sound_dir = data_root / "common" / "sound";
    if (!fs::exists(sound_dir, ec) || !fs::is_directory(sound_dir, ec)) {
        spdlog::debug("CCriSoundController: pas de repertoire sound ({})", sound_dir.string());
        return;
    }

    uint32_t indexed = 0;
    for (const auto& e : fs::recursive_directory_iterator(sound_dir, ec)) {
        if (ec) break;
        if (!e.is_regular_file(ec)) continue;

        const auto ext = e.path().extension().string();
        if (ext != ".adx" && ext != ".hca" && ext != ".acb" && ext != ".awb") continue;

        // Clef = hash CRC32 du chemin relatif en lower-case.
        auto rel = fs::relative(e.path(), data_root, ec).generic_string();
        std::transform(rel.begin(), rel.end(), rel.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

        SoundBankEntry entry;
        entry.hash = hash_path(rel);
        entry.path = e.path().string();
        bank_[entry.hash] = std::move(entry);
        ++indexed;
    }

    spdlog::info("CCriSoundController: {} fichiers sonores indexes", indexed);
}

namespace {

/// Decode un fichier audio en PCM 16 bits (ADX direct ou premier element AWB).
struct DecodedPcm {
    std::vector<int16_t> samples;
    uint32_t frame_count = 0;
    uint32_t sample_rate = 0;
    uint32_t channels    = 0;
    bool ok = false;
};

[[nodiscard]] DecodedPcm decode_audio_file(const std::filesystem::path& path) {
    DecodedPcm result;
    std::ifstream f(path, std::ios::binary | std::ios::ate);
    if (!f) return result;
    const auto size = f.tellg();
    if (size <= 0) return result;
    f.seekg(0, std::ios::beg);
    std::vector<uint8_t> data(static_cast<size_t>(size));
    f.read(reinterpret_cast<char*>(data.data()), size);

    std::span<const uint8_t> audio_span{ data };
    const auto ext = path.extension().string();
    if (ext == ".awb" || (data.size() >= 4 && data[0] == 'A' && data[1] == 'F' &&
                          data[2] == 'S' && data[3] == '2')) {
        auto awb = iecode::criware::awb_parse(audio_span);
        if (!awb || awb->entries.empty()) return result;
        audio_span = iecode::criware::awb_extract_entry(audio_span, awb->entries.front());
        if (audio_span.empty()) return result;
    }

    if (audio_span.size() >= 4) {
        const bool is_hca = (audio_span[0] == 'H' && audio_span[1] == 'C' && audio_span[2] == 'A') ||
                            (audio_span[0] == 0x80 && audio_span[1] == 'H');
        if (is_hca) {
            spdlog::warn("CCriSoundController: format HCA non supporte ('{}')", path.string());
            return result;
        }
    }

    if (!iecode::criware::is_adx(audio_span)) return result;

    auto pcm = iecode::criware::adx_decode(audio_span);
    if (pcm.samples.empty()) return result;

    result.samples     = std::move(pcm.samples);
    result.frame_count = pcm.frame_count;
    result.sample_rate = pcm.sample_rate;
    result.channels    = pcm.channels;
    result.ok          = true;
    return result;
}

} // namespace

AudioEngine::SoundHandle CCriSoundController::play_file(const std::filesystem::path& path,
                                                        float volume,
                                                        bool  loop) {
    if (!initialized_) {
        spdlog::warn("CCriSoundController::play_file: non initialise");
        return {};
    }

    const auto data = read_file(path);
    if (data.empty()) {
        spdlog::error("CCriSoundController::play_file: impossible de lire '{}'", path.string());
        return {};
    }

    // Dispatch selon le magic.
    std::span<const uint8_t> audio_span{ data };

    const auto ext = path.extension().string();
    if (ext == ".awb" || (data.size() >= 4 && data[0] == 'A' && data[1] == 'F' &&
                          data[2] == 'S' && data[3] == '2')) {
        // AWB : prendre la premiere entree.
        auto awb = iecode::criware::awb_parse(audio_span);
        if (!awb || awb->entries.empty()) {
            spdlog::error("CCriSoundController: AWB invalide ou vide ('{}')", path.string());
            return {};
        }
        audio_span = iecode::criware::awb_extract_entry(audio_span, awb->entries.front());
        if (audio_span.empty()) return {};
    }

    // HCA non supporte.
    if (audio_span.size() >= 4) {
        const bool is_hca = (audio_span[0] == 'H' && audio_span[1] == 'C' && audio_span[2] == 'A') ||
                            (audio_span[0] == 0x80 && audio_span[1] == 'H');
        if (is_hca) {
            spdlog::warn("CCriSoundController: format HCA non supporte, silence ('{}')",
                         path.string());
            return {};
        }
    }

    // ADX ?
    if (!iecode::criware::is_adx(audio_span)) {
        spdlog::error("CCriSoundController: format audio non reconnu ('{}')", path.string());
        return {};
    }

    const auto pcm = iecode::criware::adx_decode(audio_span);
    if (pcm.samples.empty()) {
        spdlog::error("CCriSoundController: decodage ADX echoue ('{}')", path.string());
        return {};
    }

    const float effective = std::clamp(volume * master_volume_, 0.0f, 1.0f);
    return AudioEngine::get().play_pcm(pcm.samples.data(),
                                       pcm.frame_count,
                                       pcm.sample_rate,
                                       pcm.channels,
                                       effective,
                                       loop);
}

void CCriSoundController::stop_handle(AudioEngine::SoundHandle handle) {
    AudioEngine::get().stop(handle);
}

AudioEngine::SoundHandle CCriSoundController::play_2d(const std::string& asset_path,
                                                      float volume) {
    return play_file(asset_path, volume, false);
}

AudioEngine::SoundHandle CCriSoundController::play_3d(const std::string& asset_path,
                                                     AudioVec3 position,
                                                     float volume) {
    if (!initialized_) return {};
    auto pcm = decode_audio_file(asset_path);
    if (!pcm.ok) {
        spdlog::error("CCriSoundController::play_3d: decode '{}' echoue", asset_path);
        return {};
    }
    const float effective = std::clamp(volume * master_volume_, 0.0f, 1.0f);
    return AudioEngine::get().play_pcm_3d(pcm.samples.data(),
                                          pcm.frame_count,
                                          pcm.sample_rate,
                                          pcm.channels,
                                          position,
                                          effective,
                                          false);
}

void CCriSoundController::set_voice_position(AudioEngine::SoundHandle handle, AudioVec3 position) {
    AudioEngine::get().set_voice_position(handle, position);
}

void CCriSoundController::set_listener(AudioVec3 position, AudioVec3 forward, AudioVec3 up) {
    AudioListener l{};
    l.position = position;
    l.forward  = forward;
    l.up       = up;
    AudioEngine::get().set_listener(l);
}

void CCriSoundController::set_channel_volume(SoundChannel channel, float volume) {
    volume = std::clamp(volume, 0.0f, 1.0f);
    switch (channel) {
        case SoundChannel::MASTER:
            master_volume_ = volume;
            AudioEngine::get().set_master_volume(volume);
            break;
        case SoundChannel::BGM:   bgm_volume_   = volume; break;
        case SoundChannel::SE:    se_volume_    = volume; break;
        case SoundChannel::VOICE: voice_volume_ = volume; break;
    }
}

float CCriSoundController::channel_volume(SoundChannel channel) const {
    switch (channel) {
        case SoundChannel::MASTER: return master_volume_;
        case SoundChannel::BGM:    return bgm_volume_;
        case SoundChannel::SE:     return se_volume_;
        case SoundChannel::VOICE:  return voice_volume_;
    }
    return 1.0f;
}

// --- ISoundController -------------------------------------------------------

bool CCriSoundController::play(hash32 sound_hash) {
    if (!initialized_) return false;

    auto it = bank_.find(sound_hash.value);
    if (it == bank_.end()) {
        spdlog::debug("CCriSoundController::play: hash {:#x} introuvable", sound_hash.value);
        return false;
    }

    const auto handle = play_file(it->second.path, 1.0f, false);
    if (!handle.valid()) return false;

    active_[sound_hash.value] = handle;
    return true;
}

void CCriSoundController::stop(hash32 sound_hash) {
    auto it = active_.find(sound_hash.value);
    if (it != active_.end()) {
        AudioEngine::get().stop(it->second);
        active_.erase(it);
    }
}

bool CCriSoundController::is_playing(hash32 sound_hash) const {
    auto it = active_.find(sound_hash.value);
    if (it == active_.end()) return false;
    return AudioEngine::get().is_playing(it->second);
}

void CCriSoundController::set_volume(float volume) {
    set_channel_volume(SoundChannel::MASTER, volume);
}

} // namespace lives
