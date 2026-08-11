/// @file camera_ctrl_base.cpp
/// Implementation de CCameraCtrlBase — ancrage vtable et utilitaires
/// partages par tous les controleurs de camera game::.
///
/// Equivalent RTTI dans nie.exe : lives::CCameraCtrl (base moteur) puis
/// game::CCameraCtrlChaseBase. Les controleurs specialises derivent de
/// l'une de ces deux classes et surchargent update() avec leur propre
/// logique de mise a jour.

#include "iecode/game/camera/camera_ctrl_base.h"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/geometric.hpp>
#include <glm/common.hpp>

#include <algorithm>
#include <cmath>

namespace game {

// ── Anchors vtable ─────────────────────────────────────────────────────
// Ces definitions out-of-line evitent la duplication de la vtable dans
// chaque TU et stabilisent le RTTI emis par le compilateur.

// Note : destructeur et virtuelles par defaut sont deja definies inline
// dans le header. Ce fichier sert de TU d'ancrage et expose les helpers
// utilises par les sous-classes (interpolation, calcul de vue).

namespace {

/// Lerp simple entre deux points (clamp du facteur en [0, 1]).
[[nodiscard]] inline glm::vec3 lerp_vec3(const glm::vec3& a, const glm::vec3& b, float t) noexcept {
    const float k = std::clamp(t, 0.f, 1.f);
    return a + (b - a) * k;
}

/// Facteur de lissage exponentiel framerate-independant.
/// Equivalent de 1 - exp(-k * dt) utilise par les controleurs de poursuite.
[[nodiscard]] inline float smooth_factor(float smoothing, float dt) noexcept {
    if (smoothing <= 0.f || dt <= 0.f) {
        return 1.f;
    }
    return 1.f - std::exp(-smoothing * dt);
}

} // namespace

// ── Helpers exposes aux sous-classes ───────────────────────────────────
// Ces fonctions sont volontairement internes au fichier (anonymous ns)
// mais reexportees via des wrappers pour permettre leur reutilisation
// sans duplication dans les controleurs specialises.

glm::vec3 camera_ctrl_lerp_position(const glm::vec3& current,
                                    const glm::vec3& target,
                                    float smoothing,
                                    float dt) noexcept {
    return lerp_vec3(current, target, smooth_factor(smoothing, dt));
}

/// Calcule la matrice de vue d'un controleur base a partir de sa
/// position et de sa cible. Utilise un up fixe (0, 1, 0) — les
/// controleurs specialises (selfie, shake) peuvent le surcharger.
glm::mat4 camera_ctrl_view_from(const glm::vec3& position,
                                const glm::vec3& target) noexcept {
    const glm::vec3 diff = target - position;
    const float len2 = glm::dot(diff, diff);
    if (len2 < 1e-8f) {
        // Degenere : cible confondue avec la position
        return glm::mat4(1.f);
    }
    return glm::lookAtLH(position, target, glm::vec3{0.f, 1.f, 0.f});
}

} // namespace game
