/// @file camera.cpp
/// Implementation de la camera du moteur Level-5 (lives::CCamera, CCameraAnimeCtrl).

#include "iecode/engine/camera/camera.h"

#include <glm/ext/matrix_clip_space.hpp>  // glm::perspective
#include <glm/ext/matrix_transform.hpp>   // glm::lookAt
#include <glm/geometric.hpp>              // glm::normalize
#include <glm/matrix.hpp>                 // glm::inverse

namespace lives {

void CCamera::update_matrices() {
    view_matrix_ = glm::lookAt(position_, target_, up_);
    proj_matrix_ = glm::perspective(fov_, aspect_ratio_, near_, far_);
}

void CCamera::set_viewport(float width, float height) {
    // Garde-fou : un viewport degenere casserait la matrice de projection.
    if (height <= 0.f || width <= 0.f) {
        return;
    }
    aspect_ratio_ = width / height;
    update_matrices();
}

void CCamera::set_position(const glm::vec3& position) {
    position_ = position;
    update_matrices();
}

void CCamera::set_target(const glm::vec3& target) {
    target_ = target;
    update_matrices();
}

glm::mat4 CCamera::get_view_proj() const {
    return proj_matrix_ * view_matrix_;
}

Ray CCamera::screen_to_world_ray(glm::vec2 screen_pos,
                                 glm::vec2 viewport_size) const {
    // Garde-fou viewport invalide.
    if (viewport_size.x <= 0.f || viewport_size.y <= 0.f) {
        return Ray{position_, glm::normalize(target_ - position_)};
    }

    // Coordonnees normalisees [-1, 1], origine ecran top-left donc on inverse Y.
    const float ndc_x = (2.f * screen_pos.x) / viewport_size.x - 1.f;
    const float ndc_y = 1.f - (2.f * screen_pos.y) / viewport_size.y;

    const glm::mat4 inv_view_proj = glm::inverse(proj_matrix_ * view_matrix_);

    // Deux points dans le frustum : near plane (z=-1 OpenGL) et far plane (z=1).
    glm::vec4 near_point = inv_view_proj * glm::vec4(ndc_x, ndc_y, -1.f, 1.f);
    glm::vec4 far_point  = inv_view_proj * glm::vec4(ndc_x, ndc_y,  1.f, 1.f);

    // Division perspective.
    if (near_point.w != 0.f) near_point /= near_point.w;
    if (far_point.w  != 0.f) far_point  /= far_point.w;

    Ray ray;
    ray.origin    = position_;
    ray.direction = glm::normalize(glm::vec3(far_point) - glm::vec3(near_point));
    return ray;
}

} // namespace lives
