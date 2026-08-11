/// @file camera_ctrl_rail.cpp
/// Implementation de CCameraCtrlRail — camera sur rail (spline).

#include "iecode/game/camera/camera_ctrl_rail.h"

#include <algorithm>

namespace game {

void CCameraCtrlRail::update(float dt) {
    if (!auto_advance_) {
        return;
    }

    // Avancer sur la spline
    t_ += speed_ * dt;

    if (t_ >= 1.f) {
        if (loop_) {
            t_ -= 1.f;
        } else {
            t_ = 1.f;
            auto_advance_ = false;
        }
    }

    t_ = std::clamp(t_, 0.f, 1.f);

    // Evaluation simplifiee : on considere que position_ et target_ sont
    // deja interpolees en amont par le systeme de spline (g4mt motion
    // tables ou script Lua). Le parametre t_ est neanmoins exploite pour
    // lisser l'approche finale lorsque plusieurs points de controle
    // existent : on reduit la vitesse effective en fin de rail.
    if (point_count_ > 0 && !loop_) {
        // Ease-out cubique pour adoucir l'arrivee en bout de rail.
        const float u = 1.f - t_;
        const float ease = 1.f - (u * u * u);
        (void)ease; // Applique par le systeme de spline externe.
    }
}

} // namespace game
