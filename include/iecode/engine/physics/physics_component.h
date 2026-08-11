#pragma once

/// @file physics_component.h
/// Composants physiques du moteur Level-5.
/// nie.exe : PhysX 3.4 statique depuis D:\SVN\PhysX3.4\.
/// iecode  : backend Bullet3 (cf. physics_world.h).
/// MXCSR = 0x9FC0 (FTZ+DAZ — flush denormals to zero).

#include "../core/object.h"
#include <cstdint>
#include <string_view>

class btCollisionShape;
class btMotionState;
class btRigidBody;
class btTriangleIndexVertexArray;
class btTransform;
class btVector3;

namespace lives {

/// Composant corps rigide (lives::CPhysicsRigidbodyComponent).
/// Backend Bullet3 : btRigidBody + btCollisionShape + btMotionState.
struct CPhysicsRigidbodyComponent : CComponent {
    // Proprietes physiques (identiques a nie.exe).
    float    mass_        = 1.f;
    float    friction_    = 0.5f;
    float    restitution_ = 0.3f;
    bool     is_kinematic_ = false;
    bool     is_static_    = false;

    /// Pointeur opaque vers PxRigidActor* (nie.exe) / btRigidBody* (iecode).
    void*    px_actor_ = nullptr;

    // Objets Bullet3 possedes (null tant que create_*() n'a pas ete appele).
    btCollisionShape* shape_  = nullptr;
    btMotionState*    motion_ = nullptr;
    btRigidBody*      body_   = nullptr;

    ~CPhysicsRigidbodyComponent() override;

    /// Cree un collider box et l'ajoute au monde physique global.
    [[nodiscard]] bool create_box(const btVector3& half_extents,
                                  const btTransform& initial_transform);

    /// Cree un collider sphere et l'ajoute au monde physique global.
    [[nodiscard]] bool create_sphere(float radius, const btTransform& initial_transform);

    /// Cree un collider triangle-mesh statique (terrain/map).
    /// Force `is_static_ = true` (masse nulle).
    [[nodiscard]] bool create_triangle_mesh(btTriangleIndexVertexArray* mesh_data);

    /// Recupere la transform courante (motion state) apres simulation.
    [[nodiscard]] btTransform get_transform() const;

    void set_velocity(const btVector3& v);
    void apply_impulse(const btVector3& impulse);

    /// Retire le rigid body du monde et libere toutes les ressources Bullet3.
    void destroy() noexcept;

    [[nodiscard]] std::string_view get_class_name() const override { return "CPhysicsRigidbodyComponent"; }
};

/// Composant cloth (lives::CPhysicsClothComponent).
/// Utilise pour les vetements et capes des personnages.
/// Note : Bullet3 propose btSoftBody, mais non implemente ici (stub POD).
struct CPhysicsClothComponent : CComponent {
    float    stiffness_ = 1.f;
    float    damping_   = 0.1f;
    uint32_t vertex_count_ = 0;

    /// Pointeur opaque vers PxCloth* (nie.exe) / btSoftBody* (iecode, a faire).
    void*    px_cloth_ = nullptr;

    [[nodiscard]] std::string_view get_class_name() const override { return "CPhysicsClothComponent"; }
};

} // namespace lives
