/// @file physics_component.cpp
/// Implementation des composants physiques (lives::CPhysicsRigidbodyComponent,
/// CPhysicsClothComponent) — backend Bullet3.

#include "iecode/engine/physics/physics_component.h"
#include "iecode/engine/physics/physics_world.h"

#include <btBulletDynamicsCommon.h>
#include <BulletCollision/CollisionShapes/btBvhTriangleMeshShape.h>
#include <BulletCollision/CollisionShapes/btTriangleIndexVertexArray.h>

namespace lives {

namespace {

/// Attache un rigid body neuf au monde Bullet3 global. No-op si non initialise.
void attach_to_world(btRigidBody* body) noexcept
{
    if (auto* w = PhysicsWorld::get().world.get(); w && body) {
        w->addRigidBody(body);
    }
}

} // namespace

CPhysicsRigidbodyComponent::~CPhysicsRigidbodyComponent()
{
    destroy();
}

bool CPhysicsRigidbodyComponent::create_box(const btVector3& half_extents,
                                            const btTransform& initial_transform)
{
    destroy();
    shape_  = new btBoxShape(half_extents);
    motion_ = new btDefaultMotionState(initial_transform);

    const btScalar m = is_static_ ? btScalar(0) : btScalar(mass_);
    btVector3 inertia(0, 0, 0);
    if (m > 0.f) shape_->calculateLocalInertia(m, inertia);

    btRigidBody::btRigidBodyConstructionInfo info(m, motion_, shape_, inertia);
    info.m_friction    = friction_;
    info.m_restitution = restitution_;
    body_ = new btRigidBody(info);

    if (is_kinematic_) {
        body_->setCollisionFlags(body_->getCollisionFlags()
                                 | btCollisionObject::CF_KINEMATIC_OBJECT);
        body_->setActivationState(DISABLE_DEACTIVATION);
    }

    px_actor_ = static_cast<void*>(body_);
    attach_to_world(body_);
    return true;
}

bool CPhysicsRigidbodyComponent::create_sphere(float radius,
                                               const btTransform& initial_transform)
{
    destroy();
    shape_  = new btSphereShape(radius);
    motion_ = new btDefaultMotionState(initial_transform);

    const btScalar m = is_static_ ? btScalar(0) : btScalar(mass_);
    btVector3 inertia(0, 0, 0);
    if (m > 0.f) shape_->calculateLocalInertia(m, inertia);

    btRigidBody::btRigidBodyConstructionInfo info(m, motion_, shape_, inertia);
    info.m_friction    = friction_;
    info.m_restitution = restitution_;
    body_ = new btRigidBody(info);

    px_actor_ = static_cast<void*>(body_);
    attach_to_world(body_);
    return true;
}

bool CPhysicsRigidbodyComponent::create_triangle_mesh(btTriangleIndexVertexArray* mesh_data)
{
    if (!mesh_data) return false;
    destroy();
    is_static_ = true;

    shape_ = new btBvhTriangleMeshShape(mesh_data, /*useQuantizedAabbCompression*/ true);

    btTransform identity;
    identity.setIdentity();
    motion_ = new btDefaultMotionState(identity);

    btRigidBody::btRigidBodyConstructionInfo info(0.f, motion_, shape_);
    info.m_friction    = friction_;
    info.m_restitution = restitution_;
    body_ = new btRigidBody(info);

    px_actor_ = static_cast<void*>(body_);
    attach_to_world(body_);
    return true;
}

btTransform CPhysicsRigidbodyComponent::get_transform() const
{
    btTransform t;
    if (motion_) {
        motion_->getWorldTransform(t);
    } else {
        t.setIdentity();
    }
    return t;
}

void CPhysicsRigidbodyComponent::set_velocity(const btVector3& v)
{
    if (body_) body_->setLinearVelocity(v);
}

void CPhysicsRigidbodyComponent::apply_impulse(const btVector3& impulse)
{
    if (body_) {
        body_->activate();
        body_->applyCentralImpulse(impulse);
    }
}

void CPhysicsRigidbodyComponent::destroy() noexcept
{
    if (body_) {
        if (auto* w = PhysicsWorld::get().world.get()) {
            w->removeRigidBody(body_);
        }
        delete body_;
        body_ = nullptr;
    }
    delete motion_;
    motion_ = nullptr;
    delete shape_;
    shape_ = nullptr;
    px_actor_ = nullptr;
}

} // namespace lives
