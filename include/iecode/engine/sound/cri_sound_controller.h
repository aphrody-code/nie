#pragma once

/// @file cri_sound_controller.h
/// Controleur audio CRI (lives::CCriSoundController).
/// CRI Atom Ex v2.29.4 / CRI FS v2.88.15.
/// Implementation native : decode ADX -> XAudio2.

#include "../core/object.h"
#include "../hash/hash_types.h"
#include "audio_engine.h"

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace lives {

/// Canal logique (mixage par canal dans le jeu).
enum class SoundChannel : uint8_t {
    MASTER = 0,
    BGM    = 1,
    SE     = 2,
    VOICE  = 3,
};

/// Interface controleur audio (lives::ISoundController).
struct ISoundController {
    virtual ~ISoundController() = default;

    /// Joue un son identifie par hash CRC32.
    virtual bool play(hash32 sound_hash) = 0;

    /// Arrete un son.
    virtual void stop(hash32 sound_hash) = 0;

    /// Verifie si un son est en cours de lecture.
    [[nodiscard]] virtual bool is_playing(hash32 sound_hash) const = 0;

    /// Regle le volume global (0.0 - 1.0).
    virtual void set_volume(float volume) = 0;
};

/// Entree du banque audio : mappe un hash vers un chemin de fichier decodable.
struct SoundBankEntry {
    uint32_t    hash = 0;
    std::string path;         ///< Chemin absolu (ADX, HCA, ou AWB+index)
    uint32_t    awb_entry_idx = 0xFFFFFFFFu;
};

/// Controleur audio CRI Atom Ex (lives::CCriSoundController).
/// Supporte :
///  - Decodage ADX -> PCM via iecode::criware::adx_decode
///  - Lecture XAudio2 via lives::AudioEngine
///  - HCA : non supporte (log "silence")
struct CCriSoundController : CObject, ISoundController {
    float master_volume_ = 1.f;
    float bgm_volume_    = 1.f;
    float se_volume_     = 1.f;
    float voice_volume_  = 1.f;
    bool  initialized_   = false;

    /// Initialise le backend audio et scanne les banques de sons.
    /// @param data_root racine data/ (contenant common/sound/...)
    bool init(const std::filesystem::path& data_root);

    /// Libere les ressources audio.
    void shutdown();

    /// Tick — purge les voices terminees (a appeler par frame).
    void tick();

    /// Joue directement un fichier ADX/AWB depuis le disque.
    /// @return handle opaque, ou invalide si echec.
    AudioEngine::SoundHandle play_file(const std::filesystem::path& path,
                                       float volume = 1.0f,
                                       bool  loop   = false);

    /// Joue un fichier en 2D (UI / BGM).
    AudioEngine::SoundHandle play_2d(const std::string& asset_path,
                                     float volume = 1.0f);

    /// Joue un fichier en 3D positionnel (mix par X3DAudio).
    AudioEngine::SoundHandle play_3d(const std::string& asset_path,
                                     AudioVec3 position,
                                     float volume = 1.0f);

    /// Met a jour l'auditeur 3D (camera/joueur).
    void set_listener(AudioVec3 position, AudioVec3 forward, AudioVec3 up);

    /// Met a jour la position d'une voice 3D existante.
    void set_voice_position(AudioEngine::SoundHandle handle, AudioVec3 position);

    /// Arrete un son par handle.
    void stop_handle(AudioEngine::SoundHandle handle);

    /// Regle le volume d'un canal logique (persiste pour les prochains play).
    void set_channel_volume(SoundChannel channel, float volume);

    /// Retourne le volume courant d'un canal.
    [[nodiscard]] float channel_volume(SoundChannel channel) const;

    // --- ISoundController ---
    bool play(hash32 sound_hash) override;
    void stop(hash32 sound_hash) override;
    [[nodiscard]] bool is_playing(hash32 sound_hash) const override;
    void set_volume(float volume) override;

    [[nodiscard]] std::string_view get_class_name() const override { return "CCriSoundController"; }

private:
    /// Scanne data_root/common/sound/ pour indexer les fichiers audio.
    void scan_sound_banks(const std::filesystem::path& data_root);

    std::unordered_map<uint32_t, SoundBankEntry>          bank_;
    std::unordered_map<uint32_t, AudioEngine::SoundHandle> active_; // hash.value -> voice
};

} // namespace lives
