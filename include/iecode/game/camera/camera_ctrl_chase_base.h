#pragma once

/// @file camera_ctrl_chase_base.h
/// CCameraCtrlChaseBase — base abstraite de tous les controleurs de
/// camera de poursuite (game::CCameraCtrlChase, game::CCameraCtrlChaseSoccer,
/// et les specialises NearFar/Offset/Shooting/SoccerMenu).
///
/// Classe RTTI : game::CCameraCtrlChaseBase.
/// Heritage reel dans nie.exe : lives::TAddPropertyCreator (composant ECS)
/// + lives::CCameraCtrl (controleur camera moteur).
///
/// Le layout ci-dessous correspond au reverse engineering de nie.exe.
/// Taille totale de l'instance : ~0x3A8 octets.

#include "camera_ctrl_base.h"

#include <glm/vec2.hpp>
#include <glm/vec4.hpp>

#include <cstdint>
#include <string_view>

namespace game {

/// Base abstraite des cameras de poursuite.
/// Regroupe l'etat d'interpolation partage par tous les CCameraCtrl*Chase*.
///
/// Layout binaire (reverse de nie.exe, taille ~0x3A8) :
///   +0x080 vec4   target_pos_prev     — position cible frame precedente
///   +0x0C8 float  fov_interp          — FOV interpole en cours
///   +0x0CC uint8  interp_active       — flag d'interpolation active
///   +0x140 vec4   dynamic_offset      — offset dynamique (shake, zoom…)
///   +0x32C vec2   interp_state        — etat interp (sentinel -FLT_MAX)
///   +0x334 uint8  interp_mode         — mode d'interpolation (0..N)
///   +0x340 uint8  additive_offset     — flag offset additif
///   +0x350 vec4   pos_start           — position de depart
///   +0x360 vec4   pos_target          — position cible
///   +0x370 vec2   dist_params         — parametres de distance (min, cur)
///   +0x37C float  dist_max            — distance maximale
///   +0x38C vec4   target2             — cible secondaire
///   +0x3A4 uint32 state_counter       — compteur d'etat/tick
struct CCameraCtrlChaseBase : CCameraCtrlBase {
    [[nodiscard]] std::string_view ctrl_name() const override { return "CCameraCtrlChaseBase"; }

    // ── Methodes communes confirmees ───────────────────────────────────

    /// Remet tous les vecteurs d'interpolation a l'origine.
    /// Efface target_pos_prev, dynamic_offset, pos_start, pos_target, target2
    /// et reinitialise les flags d'interpolation.
    virtual void reset();

    /// Setup avec 10 parametres flottants (signature nie.exe).
    /// Layout : [fov, near, far, dist_min, dist_max, yaw, pitch, height,
    ///           smoothing, interp_mode].
    virtual void initialize(const float params[10]);

    /// Definit le blend de FOV (cible d'interpolation).
    virtual void set_fov_blend(float fov);

    /// Avance l'interpolation d'un pas de temps.
    virtual void update_interp(float dt);

    // ── Champs partages (correspondance binaire) ───────────────────────

    // +0x080
    glm::vec4 target_pos_prev_ = {0.f, 0.f, 0.f, 0.f};
    // +0x0C8 / +0x0CC
    float   fov_interp_    = 60.f;
    uint8_t interp_active_ = 0;
    // +0x140
    glm::vec4 dynamic_offset_ = {0.f, 0.f, 0.f, 0.f};
    // +0x32C — sentinel -FLT_MAX signifie "pas d'interpolation en cours"
    glm::vec2 interp_state_   = {-3.4028235e38f, -3.4028235e38f};
    // +0x334 / +0x340
    uint8_t interp_mode_     = 0;
    uint8_t additive_offset_ = 0;
    // +0x350 / +0x360
    glm::vec4 pos_start_  = {0.f, 0.f, 0.f, 0.f};
    glm::vec4 pos_target_ = {0.f, 0.f, 0.f, 0.f};
    // +0x370 / +0x37C
    glm::vec2 dist_params_ = {0.f, 0.f};
    float     dist_max_    = 0.f;
    // +0x38C
    glm::vec4 target2_ = {0.f, 0.f, 0.f, 0.f};
    // +0x3A4
    uint32_t state_counter_ = 0;

    // ── Champs classiques de poursuite ─────────────────────────────────
    float distance_  = 10.f;   // Distance cible-camera
    float height_    = 3.f;    // Hauteur relative
    float yaw_       = 0.f;    // Angle horizontal (degres)
    float pitch_     = -15.f;  // Angle vertical (degres)
    float smoothing_ = 5.f;    // Facteur de lissage
};

} // namespace game
