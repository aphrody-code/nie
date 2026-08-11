#pragma once

/// @file physics_world.h
/// Monde physique global du moteur iecode (backend Bullet3).
/// Equivalent du PxScene de nie.exe (CPhysxStepper pilote ce monde).
///
/// Bullet3 remplace PhysX 3.4 — memes concepts :
///   PxScene              -> btDiscreteDynamicsWorld
///   PxRigidActor         -> btRigidBody
///   PxTriangleMesh       -> btBvhTriangleMeshShape
///   PxScene::simulate    -> btDiscreteDynamicsWorld::stepSimulation
///   PxScene::fetchResults-> (implicite dans stepSimulation avec maxSubSteps)

#include <memory>

// Forward decls Bullet3 — les includes lourds restent dans le .cpp.
class btDefaultCollisionConfiguration;
class btCollisionDispatcher;
class btDbvtBroadphase;
class btSequentialImpulseConstraintSolver;
class btDiscreteDynamicsWorld;

namespace lives {

/// Singleton du monde physique. Un seul monde actif a la fois
/// (comme nie.exe : 1 NpScene global pilote par CPhysxStepper).
struct PhysicsWorld {
    std::unique_ptr<btDefaultCollisionConfiguration>     collision_config;
    std::unique_ptr<btCollisionDispatcher>               dispatcher;
    std::unique_ptr<btDbvtBroadphase>                    broadphase;
    std::unique_ptr<btSequentialImpulseConstraintSolver> solver;
    std::unique_ptr<btDiscreteDynamicsWorld>             world;

    /// Accesseur singleton.
    [[nodiscard]] static PhysicsWorld& get() noexcept;

    /// Initialise les sous-systemes Bullet3 et cree le monde.
    /// Gravite par defaut : (0, -9.81, 0).
    [[nodiscard]] bool init();

    /// Libere le monde et tous les sous-systemes dans le bon ordre.
    void shutdown() noexcept;

    /// Avance la simulation de `dt` secondes.
    /// Timestep fixe interne de 1/60s, max 3 substeps (valeur type nie.exe).
    void step(float dt) noexcept;

    [[nodiscard]] bool is_initialized() const noexcept { return world != nullptr; }
};

} // namespace lives
