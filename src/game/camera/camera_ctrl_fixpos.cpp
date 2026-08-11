/// @file camera_ctrl_fixpos.cpp
/// Implementation de CCameraCtrlFixPos — camera a position fixe.

#include "iecode/game/camera/camera_ctrl_fixpos.h"

namespace game {

void CCameraCtrlFixPos::update(float /*dt*/) {
    // La position est fixe
    position_ = fixed_position_;

    // Si le tracking est active, la camera regarde toujours la cible
    // (target_ est mise a jour de l'exterieur par le systeme de scene).
    // Sinon, la cible reste inchangee.
    if (!track_target_) {
        // Position fixe, cible fixe — rien a faire
    }
}

} // namespace game
