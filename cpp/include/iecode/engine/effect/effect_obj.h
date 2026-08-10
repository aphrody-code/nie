#pragma once

/// @file effect_obj.h
/// Composants d'effets visuels (lives::CEffectObjComponent, CParticleRootComponent, CLineEffRootComponent).
/// Formats associes : .vfxo (visual effects), .pfxo (particle effects).
/// Bridge Lua : funcLuaEffectCommand a FUN_140c39dc0.

#include "../core/object.h"
#include <cstdint>
#include <string_view>

namespace lives {

/// Composant d'effet visuel (lives::CEffectObjComponent).
struct CEffectObjComponent : CComponent {
    float    life_time_     = 0.f;     ///< Duree de vie de l'effet (0 = infini)
    float    elapsed_time_  = 0.f;
    float    playback_rate_ = 1.f;
    bool     active_        = false;
    bool     looping_       = false;

    [[nodiscard]] bool is_expired() const {
        return life_time_ > 0.f && elapsed_time_ >= life_time_;
    }

    [[nodiscard]] std::string_view get_class_name() const override { return "CEffectObjComponent"; }
};

/// Composant racine de particules (lives::CParticleRootComponent).
/// Gere les .vfxo (2448 fichiers dans le jeu).
struct CParticleRootComponent : CComponent {
    uint32_t max_particles_    = 0;
    uint32_t active_particles_ = 0;
    float    emission_rate_    = 0.f;

    [[nodiscard]] std::string_view get_class_name() const override { return "CParticleRootComponent"; }
};

/// Composant racine d'effets de ligne (lives::CLineEffRootComponent).
struct CLineEffRootComponent : CComponent {
    uint32_t segment_count_ = 0;
    float    width_         = 1.f;

    [[nodiscard]] std::string_view get_class_name() const override { return "CLineEffRootComponent"; }
};

} // namespace lives
