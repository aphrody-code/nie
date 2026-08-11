/// @file physics_world.cpp
/// Implementation du monde physique global (Bullet3).

#include "iecode/engine/physics/physics_world.h"

#include <btBulletDynamicsCommon.h>

namespace lives {

PhysicsWorld& PhysicsWorld::get() noexcept
{
    static PhysicsWorld instance;
    return instance;
}

bool PhysicsWorld::init()
{
    if (world) return true; // deja initialise

    collision_config = std::make_unique<btDefaultCollisionConfiguration>();
    dispatcher       = std::make_unique<btCollisionDispatcher>(collision_config.get());
    broadphase       = std::make_unique<btDbvtBroadphase>();
    solver           = std::make_unique<btSequentialImpulseConstraintSolver>();
    world            = std::make_unique<btDiscreteDynamicsWorld>(
        dispatcher.get(), broadphase.get(), solver.get(), collision_config.get());

    world->setGravity(btVector3(0.f, -9.81f, 0.f));
    return true;
}

void PhysicsWorld::shutdown() noexcept
{
    // Ordre inverse de creation — obligatoire pour Bullet3.
    world.reset();
    solver.reset();
    broadphase.reset();
    dispatcher.reset();
    collision_config.reset();
}

void PhysicsWorld::step(float dt) noexcept
{
    if (world && dt > 0.f) {
        world->stepSimulation(dt, 3, 1.f / 60.f);
    }
}

} // namespace lives
