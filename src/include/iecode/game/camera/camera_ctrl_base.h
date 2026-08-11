#pragma once

/// @file camera_ctrl_base.h
/// Classe de base pour tous les controleurs de camera.
/// Classe RTTI base : lives::CCameraCtrl (moteur).
/// Sous-classe game:: : game::CCameraCtrlChaseBase.

#include <glm/vec3.hpp>
#include <glm/mat4x4.hpp>
#include <cstdint>
#include <string_view>

namespace game {

/// Base de tous les controleurs de camera du jeu.
/// Fournit position, cible, FOV, plans de clipping, et interfaces
/// virtuelles pour mise a jour et calcul de matrice de vue.
struct CCameraCtrlBase {
    virtual ~CCameraCtrlBase() = default;

    /// Mise a jour du controleur (appelee chaque frame).
    virtual void update(float dt) {}

    /// Calcule et retourne la matrice de vue.
    [[nodiscard]] virtual glm::mat4 get_view_matrix() const { return glm::mat4(1.f); }

    /// Nom RTTI du controleur.
    [[nodiscard]] virtual std::string_view ctrl_name() const { return "CCameraCtrlBase"; }

    glm::vec3 position_  = {0.f, 0.f, 0.f};
    glm::vec3 target_    = {0.f, 0.f, 0.f};
    float     fov_       = 60.f;
    float     near_clip_ = 0.1f;
    float     far_clip_  = 10000.f;
};

} // namespace game

// La base des cameras de poursuite (CCameraCtrlChaseBase) a ete deplacee
// dans camera_ctrl_chase_base.h pour accueillir le layout binaire complet
// reverse de nie.exe.
#include "camera_ctrl_chase_base.h"
