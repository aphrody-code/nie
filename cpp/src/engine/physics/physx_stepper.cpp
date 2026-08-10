/// @file physx_stepper.cpp
/// Implementation du stepper PhysX (lives::CPhysxStepper, CPxMapMeshCollider).
/// Boucle de simulation : physx_npscene_simulate_fetch.c (FUN_14070fe50).
/// State machine NpScene a +0x1F14 : 0=idle, 1=colliding, 2=fetched, 3=advancing.
/// MXCSR = 0x9FC0 (FTZ+DAZ — flush denormals to zero).
///
/// Backend : Bullet3 (btDiscreteDynamicsWorld).

#include "iecode/engine/physics/physx_stepper.h"
#include "iecode/engine/physics/physics_world.h"

#include <btBulletDynamicsCommon.h>

namespace lives {

CPhysxStepper& CPhysxStepper::get_instance() noexcept
{
    static CPhysxStepper instance;
    return instance;
}

bool CPhysxStepper::init()
{
    if (initialized_) return true;
    if (!PhysicsWorld::get().init()) return false;
    np_scene_    = static_cast<void*>(PhysicsWorld::get().world.get());
    initialized_ = true;
    sim_state_   = PhysxSimState::IDLE;
    return true;
}

void CPhysxStepper::shutdown() noexcept
{
    PhysicsWorld::get().shutdown();
    np_scene_    = nullptr;
    initialized_ = false;
    sim_state_   = PhysxSimState::IDLE;
}

void CPhysxStepper::step(float raw_dt, uint32_t /*group_mask*/) noexcept
{
    if (!initialized_ || is_paused_) return;

    // Pattern nie.exe : preStepCallback -> flush transforms -> simulate(dt)
    //                  -> fetchResults -> postStepCallback.
    // Bullet3 encapsule simulate+fetch dans stepSimulation().
    sim_state_ = PhysxSimState::ADVANCING;
    PhysicsWorld::get().step(raw_dt * dt_scale_);
    sim_state_ = PhysxSimState::FETCHED;
}

btDiscreteDynamicsWorld* CPhysxStepper::world() noexcept
{
    return PhysicsWorld::get().world.get();
}

} // namespace lives
