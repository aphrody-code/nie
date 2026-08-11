/// @file camera_ctrl_event.cpp
/// Implementation de CCameraCtrlEvent — camera scriptee pour les cinematiques.
/// Equivalent nie.exe : game::CCameraCtrlEvent + funcLuaCameraCommand
/// (FUN_140b799f0). Les keyframes (position, cible, FOV) sont charges
/// depuis les scripts Lua de cutscene et interpoles lineairement.

#include "iecode/game/camera/camera_ctrl_event.h"

#include <algorithm>
#include <cmath>

namespace game {

void CCameraCtrlEvent::update(float dt) {
    if (!is_playing_) {
        return;
    }

    timeline_pos_ += dt;

    // Fin de sequence : soit boucler, soit stopper.
    if (timeline_len_ > 0.f && timeline_pos_ >= timeline_len_) {
        if (is_looping_) {
            // Conserver la phase pour ne pas perdre de sous-frames.
            timeline_pos_ = std::fmod(timeline_pos_, timeline_len_);
        } else {
            timeline_pos_ = timeline_len_;
            is_playing_   = false;
        }
    }

    // Les keyframes effectives (position/cible/FOV) sont poussees par le
    // script Lua via funcLuaCameraCommand. Ce controleur ne fait que
    // maintenir l'etat temporel de la sequence : les champs hérites
    // (position_, target_, fov_) sont directement ecrits par le bridge Lua.
}

} // namespace game
