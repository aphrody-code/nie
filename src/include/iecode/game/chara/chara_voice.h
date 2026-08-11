#pragma once

/// @file chara_voice.h
/// CCharaVoice — composant de voix d'un personnage.
/// Classe RTTI : game::CCharaVoice.
/// Utilise CRI Atom Ex pour la lecture des cues audio.

#include <array>
#include <cstdint>

namespace game {

/// Conditions de declenchement d'une voix.
enum class VoiceTrigger : uint8_t {
    None          = 0,
    Shoot         = 1,   // Tir
    Dribble       = 2,   // Dribble
    Pass          = 3,   // Passe
    Tackle        = 4,   // Tacle
    Catch         = 5,   // Arret (gardien)
    SpecialMove   = 6,   // Hissatsu
    Goal          = 7,   // But marque
    Hurt          = 8,   // Degats
    Victory       = 9,   // Victoire
    Defeat        = 10,  // Defaite
    Greeting      = 11,  // Salutation
    Call          = 12,  // Appel de passe
};

/// Nombre maximum de voix simultanees par personnage.
inline constexpr uint32_t MAX_CONCURRENT_VOICES = 4;

/// Cue audio en cours de lecture.
struct VoiceCue {
    VoiceTrigger trigger      = VoiceTrigger::None;
    uint32_t     cue_id       = 0;
    float        elapsed      = 0.f;
    float        duration     = 1.f;
    float        volume       = 1.f;
    bool         active       = false;
};

/// Composant de voix — gere les cues audio d'un personnage.
/// Les cues sont referencies par leur ID dans l'ACB/AWB associe.
struct CCharaVoice {
    virtual ~CCharaVoice() = default;

    /// Joue un cue audio selon le declencheur.
    /// Retourne l'index du slot utilise, ou -1 si aucun slot libre.
    virtual int32_t play(VoiceTrigger trigger);

    /// Arrete toutes les voix en cours.
    virtual void stop_all();

    /// Met a jour les cues en cours (decremente duree, libere les termines).
    virtual void update(float dt);

    /// Retourne true si au moins un cue est en cours.
    [[nodiscard]] bool is_playing() const;

    /// Retourne le nombre de cues actifs.
    [[nodiscard]] uint32_t active_count() const;

    /// Definit le mapping trigger → cue_id pour ce personnage.
    void set_cue_mapping(VoiceTrigger trigger, uint32_t cue_id, float duration = 1.f);

    uint32_t acb_id_       = 0;   ///< ID de l'archive ACB
    uint32_t voice_set_id_ = 0;   ///< ID du set de voix (depend du personnage)
    float    volume_       = 1.f;

    /// Slots de lecture simultanee.
    std::array<VoiceCue, MAX_CONCURRENT_VOICES> slots_ = {};

    /// Mapping trigger → (cue_id, duration).
    struct CueMapping {
        uint32_t cue_id   = 0;
        float    duration = 1.f;
    };
    std::array<CueMapping, 13> trigger_map_ = {};  ///< 13 triggers definis
};

} // namespace game
