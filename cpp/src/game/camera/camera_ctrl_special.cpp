/// @file camera_ctrl_special.cpp
/// Implementation de CCameraCtrlSpecialAttack et CCameraCtrlShooting.
/// Camera pour les hissatsu (attaques speciales) et les tirs au but.

#include "iecode/game/camera/camera_ctrl_special.h"


namespace game {

void CCameraCtrlSpecialAttack::update(float dt) {
    if (!is_playing_) {
        return;
    }

    sequence_time_ += dt;

    if (sequence_length_ > 0.f && sequence_time_ >= sequence_length_) {
        sequence_time_ = sequence_length_;
        is_playing_ = false;
    }

    // Les keyframes de camera de hissatsu sont stockes dans les .g4mt
    // (motion tables) et indexes par skill_id_. Le systeme d'animation
    // pousse position_/target_/fov_ a chaque frame via le bridge Lua
    // funcLuaCameraCommand. Ici on ne maintient que l'horloge locale.
    //
    // Phase normalisee (pour les effets post-process lies au hissatsu)
    const float phase = (sequence_length_ > 0.f)
                        ? (sequence_time_ / sequence_length_)
                        : 0.f;
    (void)phase;
}

void CCameraCtrlShooting::update(float dt) {
    (void)dt;

    // La camera suit la trajectoire du ballon vers les buts.
    // Interpolation de la position entre le ballon et les buts.
    const glm::vec3 dir = goal_pos_ - ball_pos_;
    const float len = glm::length(dir);

    if (len > 0.001f) {
        // Positionner la camera sur le cote, perpendiculaire a la trajectoire
        const glm::vec3 side{-dir.z, 0.f, dir.x};
        const glm::vec3 side_norm = glm::normalize(side);

        position_ = ball_pos_ + side_norm * 5.f + glm::vec3{0.f, 3.f, 0.f};
        target_   = ball_pos_;
    }

    // Slow motion reduit la vitesse du jeu mais pas le framerate
    // (gere par le systeme de temps global, pas ici)
}

} // namespace game
