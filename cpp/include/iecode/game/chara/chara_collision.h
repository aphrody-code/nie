#pragma once

/// @file chara_collision.h
/// CCharaCollision — composant de collision d'un personnage.
/// CCharaColHitReport — rapport de collision.
/// Classes RTTI : game::CCharaCollision, game::CCharaColHitReport.

#include <glm/vec3.hpp>
#include <cstdint>
#include <optional>

namespace game {

/// Layers de collision (bitmask).
enum class CollisionLayer : uint32_t {
    PLAYER  = 1u << 0,
    BALL    = 1u << 1,
    TERRAIN = 1u << 2,
    ZONE    = 1u << 3,
    WALL    = 1u << 4,
    ALL     = 0xFFFFFFFF,
};

/// Rapport de collision entre deux personnages.
struct CCharaColHitReport {
    uint32_t  other_chara_id = 0;       ///< ID du personnage impacte
    glm::vec3 contact_point  = {0.f, 0.f, 0.f};
    glm::vec3 contact_normal = {0.f, 1.f, 0.f};
    float     penetration    = 0.f;     ///< Profondeur de penetration
};

/// Capsule de collision pour un personnage (cylindre + hemispheres).
struct CollisionCapsule {
    glm::vec3 base_position  = {0.f, 0.f, 0.f};   ///< Position des pieds
    float     radius         = 0.3f;                ///< Rayon de la capsule
    float     height         = 1.8f;                ///< Hauteur totale

    /// Retourne le centre de la capsule.
    [[nodiscard]] glm::vec3 center() const;

    /// Retourne le sommet de la capsule.
    [[nodiscard]] glm::vec3 top() const;
};

/// Composant de collision d'un personnage (capsule englobante).
struct CCharaCollision {
    virtual ~CCharaCollision() = default;

    /// Rayon de la sphere de collision (compatibilite — utilise capsule_ de preference).
    float radius        = 0.5f;

    /// Hauteur du centre de la sphere par rapport aux pieds.
    float center_height = 0.9f;

    /// Masque de collision (bitmask de layers).
    uint32_t layer_mask = static_cast<uint32_t>(CollisionLayer::ALL);

    /// Indique si la collision est active.
    bool enabled        = true;

    /// Capsule de collision (plus precise que la sphere).
    CollisionCapsule capsule_;

    /// Callback virtuel de collision.
    virtual void on_hit(const CCharaColHitReport& /*report*/) {}

    /// Teste la collision capsule-capsule entre deux personnages.
    /// Retourne le rapport de collision si intersection, nullopt sinon.
    [[nodiscard]] static std::optional<CCharaColHitReport> test_capsule_capsule(
        uint32_t id_a, const CollisionCapsule& a,
        uint32_t id_b, const CollisionCapsule& b);

    /// Teste la collision sphere-sphere (approximation rapide).
    [[nodiscard]] static std::optional<CCharaColHitReport> test_sphere_sphere(
        uint32_t id_a, const glm::vec3& pos_a, float radius_a,
        uint32_t id_b, const glm::vec3& pos_b, float radius_b);

    /// Teste si un point est dans une zone rectangulaire (terrain).
    [[nodiscard]] static bool point_in_rect(
        const glm::vec3& point,
        const glm::vec3& rect_min, const glm::vec3& rect_max);

    /// Verifie si deux layers sont compatibles (intersection bitmask).
    [[nodiscard]] static bool layers_overlap(uint32_t mask_a, uint32_t mask_b);
};

} // namespace game
