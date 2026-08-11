#pragma once

/// @file audio_engine.h
/// Backend audio natif XAudio2 (Windows) pour iecode.
/// Fournit une API de lecture de buffers PCM bruts avec gestion de voices.
/// Sur les plateformes non-Windows, l'implementation est un stub silencieux.

#include <array>
#include <cstdint>
#include <vector>

#ifdef _WIN32
struct IXAudio2;
struct IXAudio2MasteringVoice;
struct IXAudio2SourceVoice;
#endif

namespace lives {

/// Vecteur 3D leger (evite d'imposer glm dans l'API publique du backend audio).
struct AudioVec3 {
    float x = 0.f;
    float y = 0.f;
    float z = 0.f;
};

/// Etat de l'auditeur 3D (position, orientation).
struct AudioListener {
    AudioVec3 position{0.f, 0.f, 0.f};
    AudioVec3 forward {0.f, 0.f, 1.f};
    AudioVec3 up      {0.f, 1.f, 0.f};
    AudioVec3 velocity{0.f, 0.f, 0.f};
};

/// Backend audio bas-niveau (singleton).
/// Pilote XAudio2 + un pool de source voices.
class AudioEngine {
public:
    /// Identifiant opaque d'une voice active.
    struct SoundHandle {
        uint32_t id = 0;
        [[nodiscard]] bool valid() const noexcept { return id != 0; }
    };

    /// Accesseur singleton.
    static AudioEngine& get();

    AudioEngine(const AudioEngine&) = delete;
    AudioEngine& operator=(const AudioEngine&) = delete;

    /// Initialise COM + XAudio2 + la mastering voice.
    /// @return true si le backend est pret.
    bool init();

    /// Arrete toutes les voices et libere XAudio2/COM.
    void shutdown();

    /// Joue un buffer PCM 16-bit.
    /// @param samples       pointeur vers les echantillons (copie en interne)
    /// @param frame_count   nombre de frames (1 frame = channels echantillons)
    /// @param sample_rate   frequence d'echantillonnage (Hz)
    /// @param channels      1 = mono, 2 = stereo
    /// @param volume        0.0 - 1.0
    /// @param loop          true pour boucler indefiniment
    SoundHandle play_pcm(const int16_t* samples,
                         uint32_t        frame_count,
                         uint32_t        sample_rate,
                         uint32_t        channels,
                         float           volume = 1.0f,
                         bool            loop   = false);

    /// Variante positionnelle — joue un buffer mono PCM 16 bits avec
    /// panning et attenuation 3D calcules par X3DAudio. Pour rester simple,
    /// on force le mono en entree (les sources stereo sont downmixees a la
    /// volee). Sur non-Windows, fallback sur play_pcm() sans spatialisation.
    SoundHandle play_pcm_3d(const int16_t* samples,
                            uint32_t        frame_count,
                            uint32_t        sample_rate,
                            uint32_t        channels,
                            AudioVec3       position,
                            float           volume = 1.0f,
                            bool            loop   = false);

    /// Met a jour l'auditeur 3D global (position/orientation).
    void set_listener(const AudioListener& listener);

    /// Met a jour la position 3D d'une voice positionnelle existante.
    void set_voice_position(SoundHandle handle, AudioVec3 position);

    /// Arrete et detruit une voice.
    void stop(SoundHandle handle);

    /// Regle le volume d'une voice active.
    void set_volume(SoundHandle handle, float volume);

    /// Regle le volume general (mastering voice).
    void set_master_volume(float volume);

    /// Retourne true si la voice est encore en cours de lecture.
    [[nodiscard]] bool is_playing(SoundHandle handle) const;

    /// Purge les voices dont le buffer est consomme.
    /// A appeler regulierement (par tick de l'editeur ou du jeu).
    void update();

    /// Retourne true si XAudio2 est initialise.
    [[nodiscard]] bool initialized() const noexcept { return initialized_; }

private:
    AudioEngine() = default;
    ~AudioEngine();

    struct VoiceSlot {
        uint32_t id = 0;
#ifdef _WIN32
        IXAudio2SourceVoice* voice = nullptr;
#endif
        std::vector<int16_t> buffer; // possession des samples soumis
        bool                 loop          = false;
        bool                 is_3d         = false;
        uint32_t             channels      = 1;
        uint32_t             sample_rate   = 0;
        AudioVec3            position {0.f, 0.f, 0.f};
    };

#ifdef _WIN32
    IXAudio2*               xaudio2_ = nullptr;
    IXAudio2MasteringVoice* master_  = nullptr;
    bool                    com_initialized_   = false;
    bool                    x3d_initialized_   = false;
    /// X3DAUDIO_HANDLE est defini comme un tableau de 20 octets (cf x3daudio.h).
    std::array<uint8_t, 20> x3d_instance_ {};
    uint32_t                output_channels_   = 2;
    float                   output_channel_mask_ = 0.f;
#endif

    AudioListener          listener_{};
    std::vector<VoiceSlot> slots_;
    uint32_t               next_id_    = 1;
    bool                   initialized_ = false;

#ifdef _WIN32
    /// Recalcule le panning/attenuation 3D pour une voice positionnelle.
    void apply_3d(VoiceSlot& slot);
#endif
};

} // namespace lives
