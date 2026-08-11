/// @file chara_collision.cpp
/// Implementation de CCharaCollision — detection de collisions capsule et sphere.

#include "iecode/game/chara/chara_collision.h"

#include <glm/geometric.hpp>

#include <algorithm>
#include <cmath>

namespace game {

glm::vec3 CollisionCapsule::center() const {
    return {base_position.x, base_position.y + height * 0.5f, base_position.z};
}

glm::vec3 CollisionCapsule::top() const {
    return {base_position.x, base_position.y + height, base_position.z};
}

std::optional<CCharaColHitReport> CCharaCollision::test_capsule_capsule(
    uint32_t id_a, const CollisionCapsule& a,
    uint32_t id_b, const CollisionCapsule& b)
{
    (void)id_a; // Caller's own ID — not needed in the report
    // Simplification : on traite les capsules comme des segments verticaux
    // et on calcule la distance minimale entre les deux segments.
    // Segment A : de a.base_position a a.top()
    // Segment B : de b.base_position a b.top()

    // Pour des capsules verticales, la distance horizontale est constante
    // sur toute la hauteur. On doit juste verifier le chevauchement vertical.
    const glm::vec3 center_a = a.center();
    const glm::vec3 center_b = b.center();

    // Distance horizontale entre les axes des capsules
    const float dx = center_a.x - center_b.x;
    const float dz = center_a.z - center_b.z;
    const float horiz_dist_sq = dx * dx + dz * dz;
    const float sum_radii = a.radius + b.radius;

    if (horiz_dist_sq >= sum_radii * sum_radii) {
        return std::nullopt;  // Trop loin horizontalement
    }

    // Verifier le chevauchement vertical
    const float a_bottom = a.base_position.y;
    const float a_top    = a.base_position.y + a.height;
    const float b_bottom = b.base_position.y;
    const float b_top    = b.base_position.y + b.height;

    if (a_top < b_bottom || b_top < a_bottom) {
        return std::nullopt;  // Pas de chevauchement vertical
    }

    // Collision detectee
    const float horiz_dist = std::sqrt(horiz_dist_sq);
    const float penetration = sum_radii - horiz_dist;

    glm::vec3 normal = {0.f, 0.f, 1.f};
    if (horiz_dist > 0.001f) {
        normal = glm::vec3(dx, 0.f, dz) / horiz_dist;
    }

    // Point de contact : milieu entre les surfaces des deux capsules
    const glm::vec3 contact = center_b + normal * (b.radius + penetration * 0.5f);

    return CCharaColHitReport{
        .other_chara_id = id_b,
        .contact_point  = contact,
        .contact_normal = normal,
        .penetration    = penetration,
    };
}

std::optional<CCharaColHitReport> CCharaCollision::test_sphere_sphere(
    uint32_t id_a, const glm::vec3& pos_a, float radius_a,
    uint32_t id_b, const glm::vec3& pos_b, float radius_b)
{
    (void)id_a;
    const glm::vec3 diff = pos_a - pos_b;
    const float dist_sq = glm::dot(diff, diff);
    const float sum_radii = radius_a + radius_b;

    if (dist_sq >= sum_radii * sum_radii) {
        return std::nullopt;
    }

    const float dist = std::sqrt(dist_sq);
    const float penetration = sum_radii - dist;

    glm::vec3 normal = {0.f, 1.f, 0.f};
    if (dist > 0.001f) {
        normal = diff / dist;
    }

    const glm::vec3 contact = pos_b + normal * (radius_b + penetration * 0.5f);

    return CCharaColHitReport{
        .other_chara_id = id_b,
        .contact_point  = contact,
        .contact_normal = normal,
        .penetration    = penetration,
    };
}

bool CCharaCollision::point_in_rect(
    const glm::vec3& point,
    const glm::vec3& rect_min, const glm::vec3& rect_max)
{
    return point.x >= rect_min.x && point.x <= rect_max.x &&
           point.y >= rect_min.y && point.y <= rect_max.y &&
           point.z >= rect_min.z && point.z <= rect_max.z;
}

bool CCharaCollision::layers_overlap(uint32_t mask_a, uint32_t mask_b) {
    return (mask_a & mask_b) != 0;
}

} // namespace game
