/// @file test_physics.cpp
/// Tests du backend physique Bullet3 : PhysicsWorld, CPhysxStepper,
/// CPhysicsRigidbodyComponent.

#include "iecode/engine/physics/physics_component.h"
#include "iecode/engine/physics/physics_world.h"
#include "iecode/engine/physics/physx_stepper.h"

#include <btBulletDynamicsCommon.h>
#include <gtest/gtest.h>

using namespace lives;

namespace {

/// Fixture qui reinitialise le monde avant et nettoie apres chaque test.
class PhysicsTest : public ::testing::Test {
protected:
    void SetUp() override
    {
        PhysicsWorld::get().shutdown();
        ASSERT_TRUE(PhysicsWorld::get().init());
    }
    void TearDown() override
    {
        PhysicsWorld::get().shutdown();
    }
};

} // namespace

TEST_F(PhysicsTest, WorldInitAndGravity)
{
    auto* w = PhysicsWorld::get().world.get();
    ASSERT_NE(w, nullptr);
    const btVector3 g = w->getGravity();
    EXPECT_FLOAT_EQ(g.getY(), -9.81f);
}

TEST_F(PhysicsTest, StepperInitAndStep)
{
    auto& stepper = CPhysxStepper::get_instance();
    // PhysicsWorld est deja init par la fixture — stepper.init() doit etre idempotent.
    EXPECT_TRUE(stepper.init());
    EXPECT_TRUE(stepper.initialized_);
    EXPECT_NE(stepper.world(), nullptr);

    // Un step ne doit pas crasher sur un monde vide.
    stepper.step(1.f / 60.f);
    EXPECT_EQ(stepper.sim_state_, PhysxSimState::FETCHED);
}

TEST_F(PhysicsTest, StepperPauseBlocksSimulation)
{
    auto& stepper = CPhysxStepper::get_instance();
    ASSERT_TRUE(stepper.init());
    stepper.sim_state_ = PhysxSimState::IDLE;
    stepper.is_paused_ = true;
    stepper.step(1.f / 60.f);
    // Etat inchange si pause.
    EXPECT_EQ(stepper.sim_state_, PhysxSimState::IDLE);
    stepper.is_paused_ = false;
}

TEST_F(PhysicsTest, RigidbodyBoxFallsUnderGravity)
{
    CPhysicsRigidbodyComponent rb;
    rb.mass_ = 1.f;

    btTransform start;
    start.setIdentity();
    start.setOrigin(btVector3(0, 10, 0));
    ASSERT_TRUE(rb.create_box(btVector3(0.5f, 0.5f, 0.5f), start));
    ASSERT_NE(rb.body_, nullptr);

    // Simule 60 steps (~1s) — la box doit tomber sous la gravite.
    for (int i = 0; i < 60; ++i) {
        PhysicsWorld::get().step(1.f / 60.f);
    }
    const btTransform t = rb.get_transform();
    EXPECT_LT(t.getOrigin().getY(), 10.f);
}

TEST_F(PhysicsTest, StaticBoxDoesNotMove)
{
    CPhysicsRigidbodyComponent rb;
    rb.is_static_ = true;

    btTransform start;
    start.setIdentity();
    start.setOrigin(btVector3(0, 0, 0));
    ASSERT_TRUE(rb.create_box(btVector3(10.f, 0.5f, 10.f), start));

    for (int i = 0; i < 10; ++i) {
        PhysicsWorld::get().step(1.f / 60.f);
    }
    const btTransform t = rb.get_transform();
    EXPECT_FLOAT_EQ(t.getOrigin().getY(), 0.f);
}

TEST_F(PhysicsTest, RigidbodyDestroyCleansUp)
{
    auto* w = PhysicsWorld::get().world.get();
    const int before = w->getNumCollisionObjects();
    {
        CPhysicsRigidbodyComponent rb;
        btTransform t;
        t.setIdentity();
        ASSERT_TRUE(rb.create_sphere(1.f, t));
        EXPECT_EQ(w->getNumCollisionObjects(), before + 1);
    } // destructeur
    EXPECT_EQ(w->getNumCollisionObjects(), before);
}

TEST_F(PhysicsTest, ApplyImpulseChangesVelocity)
{
    CPhysicsRigidbodyComponent rb;
    rb.mass_ = 1.f;
    btTransform t;
    t.setIdentity();
    ASSERT_TRUE(rb.create_sphere(0.5f, t));

    rb.apply_impulse(btVector3(5.f, 0.f, 0.f));
    const btVector3 v = rb.body_->getLinearVelocity();
    EXPECT_GT(v.getX(), 0.f);
}
