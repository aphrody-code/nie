#pragma once

/// @file physx_stepper.h
/// Stepper PhysX du moteur Level-5 (lives::CPhysxStepper).
/// Boucle simulation : physx_npscene_simulate_fetch.c (FUN_14070fe50).
/// State machine NpScene a +0x1F14 : 0=idle, 1=colliding, 2=fetched, 3=advancing.
///
/// Backend reel : Bullet3 (cf. physics_world.h).
/// Correspond au CPhysxStepper<> de nie.exe (9 groupes de step par bitmask,
/// layout : pxScene@0x08, flags@0x32, dtScale@0x218, isPaused@0x21e).

#include "../core/object.h"
#include <cstdint>
#include <string_view>

class btDiscreteDynamicsWorld;

namespace lives {

/// Etats de la simulation PhysX.
enum class PhysxSimState : uint32_t {
    IDLE      = 0,
    COLLIDING = 1,
    FETCHED   = 2,
    ADVANCING = 3,
};

/// Stepper PhysX (lives::CPhysxStepper).
/// Gere le pas de temps fixe et la simulation. Backend : Bullet3.
struct CPhysxStepper : CObject {
    float          fixed_timestep_ = 1.f / 60.f;   ///< 60 Hz par defaut
    float          accumulator_    = 0.f;
    PhysxSimState  sim_state_      = PhysxSimState::IDLE;
    uint32_t       substeps_       = 1;

    /// Pointeur opaque vers NpScene* (PhysX 3.4 dans nie.exe ;
    /// btDiscreteDynamicsWorld* dans iecode).
    void*          np_scene_ = nullptr;

    /// Echelle de temps (dtScale@0x218 dans nie.exe).
    float          dt_scale_   = 1.f;
    /// Pause (isPaused@0x21e dans nie.exe).
    bool           is_paused_  = false;
    /// Flag d'initialisation du backend Bullet3.
    bool           initialized_ = false;

    /// Valeur MXCSR pour flush denormals (standard jeux).
    static constexpr uint32_t MXCSR_FTZ_DAZ = 0x9FC0;
    static constexpr float    kFixedDt      = 1.f / 60.f;

    /// Accesseur singleton — un CPhysxStepper global (comme nie.exe).
    [[nodiscard]] static CPhysxStepper& get_instance() noexcept;

    /// Initialise le monde physique Bullet3.
    [[nodiscard]] bool init();

    /// Libere le monde physique.
    void shutdown() noexcept;

    /// Pas de simulation — appele chaque frame.
    /// @param raw_dt   Delta temps reel de la frame (secondes).
    /// @param group_mask Bitmask des 9 groupes de step (comme nie.exe).
    void step(float raw_dt, uint32_t group_mask = 0xFFu) noexcept;

    /// Accesseur vers le monde Bullet3 sous-jacent (null si non initialise).
    [[nodiscard]] btDiscreteDynamicsWorld* world() noexcept;

    [[nodiscard]] std::string_view get_class_name() const override { return "CPhysxStepper"; }
};

/// Collider mesh de map (lives::CPxMapMeshCollider).
struct CPxMapMeshCollider : CObject {
    uint32_t triangle_count_ = 0;
    uint32_t vertex_count_   = 0;

    /// Pointeur opaque vers PxTriangleMesh* (PhysX 3.4 dans nie.exe ;
    /// btBvhTriangleMeshShape* dans iecode).
    void*    px_mesh_ = nullptr;

    [[nodiscard]] std::string_view get_class_name() const override { return "CPxMapMeshCollider"; }
};

} // namespace lives
