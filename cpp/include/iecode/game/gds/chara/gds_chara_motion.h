#pragma once

/// @file gds_chara_motion.h
/// Donnees d'animation des personnages — motion, facial, son.
/// Source : fichiers cfg.bin (CHARA_MOTION, CHARA_MENU_MOTION, etc.).

#include "../gds_types.h"
#include <string>

namespace game {

/// Animation d'un personnage — GDSCharaMotion.
struct GDSCharaMotion {
    uint32_t      chara_id   = 0;
    uint32_t      motion_id  = 0;
    lives::hash32 anim_hash;       ///< CRC32 du fichier .g4mt
    std::string   anim_name;
    float         speed      = 1.f;
    bool          loop       = false;

    static constexpr std::string_view CFG_KEY = "CHARA_MOTION";
};

/// Animation menu d'un personnage — GDSCharaMenuMotion.
struct GDSCharaMenuMotion {
    uint32_t    chara_id  = 0;
    uint32_t    motion_id = 0;
    std::string anim_name;

    static constexpr std::string_view CFG_KEY = "CHARA_MENU_MOTION";
};

/// Blend shape (morph) facial — GDSCharaFacial.
struct GDSCharaFacial {
    uint32_t    chara_id     = 0;
    uint32_t    facial_id    = 0;
    std::string target_name;       ///< Nom du blend shape target
    float       weight       = 1.f;

    static constexpr std::string_view CFG_KEY = "CHARA_FACIAL";
};

/// Trigger son lie a une animation — GDSCharaSeTrigger.
struct GDSCharaSeTrigger {
    uint32_t      chara_id   = 0;
    uint32_t      motion_id  = 0;
    float         trigger_time = 0.f; ///< Temps en secondes dans l'animation
    lives::hash32 se_hash;            ///< CRC32 du son a jouer

    static constexpr std::string_view CFG_KEY = "CHARA_SE_TRIGGER";
};

} // namespace game
