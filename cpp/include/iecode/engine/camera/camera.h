#pragma once

/// @file camera.h
/// Camera du moteur Level-5 (lives::CCamera, CCameraAnimeCtrl).
/// Le bridge Lua expose funcLuaCameraCommand a FUN_140b799f0.

#include "../core/object.h"
#include <glm/mat4x4.hpp>
#include <glm/vec2.hpp>
#include <glm/vec3.hpp>
#include <glm/vec4.hpp>
#include <glm/trigonometric.hpp>
#include <glm/gtc/constants.hpp>
#include <string_view>

namespace lives {

/// Rayon 3D pour le picking (origine + direction normalisee).
struct Ray {
    glm::vec3 origin{0.f};
    glm::vec3 direction{0.f, 0.f, -1.f};
};

/// Camera du moteur (lives::CCamera).
/// Valeurs par defaut alignees sur nie.exe : fov = pi/4 rad (45 deg),
/// near = 0.1, far = 5000.
struct CCamera : CObject {
    glm::vec3  position_{0.f, 0.f, 0.f};
    glm::vec3  target_{0.f, 0.f, -1.f};
    glm::vec3  up_{0.f, 1.f, 0.f};
    float      fov_   = glm::quarter_pi<float>();  ///< Champ de vision en radians (pi/4)
    float      near_  = 0.1f;
    float      far_   = 5000.f;
    float      aspect_ratio_ = 16.f / 9.f;

    glm::mat4  view_matrix_{1.f};
    glm::mat4  proj_matrix_{1.f};

    [[nodiscard]] std::string_view get_class_name() const override { return "CCamera"; }

    /// Recalcule view_matrix_ et proj_matrix_ depuis les parametres courants.
    void update_matrices();

    /// Met a jour aspect_ratio_ et recalcule les matrices.
    void set_viewport(float width, float height);

    /// Setters qui reconstruisent automatiquement les matrices.
    void set_position(const glm::vec3& position);
    void set_target(const glm::vec3& target);

    /// Retourne la matrice combinee proj * view (column-major glm).
    [[nodiscard]] glm::mat4 get_view_proj() const;

    /// Unproject d'une position ecran (pixels, origine top-left) vers un rayon
    /// monde, utilise pour le picking / selection d'entites.
    /// @param screen_pos coordonnees ecran en pixels
    /// @param viewport_size taille du viewport en pixels
    [[nodiscard]] Ray screen_to_world_ray(glm::vec2 screen_pos,
                                          glm::vec2 viewport_size) const;
};

/// Controleur d'animation de camera (lives::CCameraAnimeCtrl).
struct CCameraAnimeCtrl : CObject {
    CCamera*  camera_       = nullptr;
    float     blend_time_   = 0.f;
    float     blend_factor_ = 0.f;
    bool      active_       = false;

    [[nodiscard]] std::string_view get_class_name() const override { return "CCameraAnimeCtrl"; }
};

} // namespace lives
