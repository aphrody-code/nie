/// @file test_ecs_scene.cpp
/// Tests unitaires pour lives::ecs::Scene et FastAccessComponents.

#include <iecode/engine/ecs/actor.h>
#include <iecode/engine/ecs/component.h>
#include <iecode/engine/ecs/scene.h>

#include <gtest/gtest.h>

namespace {

using lives::ecs::Actor;
using lives::ecs::Component;
using lives::ecs::ComponentKind;
using lives::ecs::Scene;

class FakeModelRenderer : public Component {
public:
    [[nodiscard]] ComponentKind component_kind() const noexcept override {
        return ComponentKind::MODEL_RENDERER;
    }
};

class FakeCamera : public Component {
public:
    [[nodiscard]] ComponentKind component_kind() const noexcept override {
        return ComponentKind::CAMERA;
    }
};

class FakeLight : public Component {
public:
    [[nodiscard]] ComponentKind component_kind() const noexcept override {
        return ComponentKind::LIGHT;
    }
};

class FakeNpc : public Component {
public:
    [[nodiscard]] ComponentKind component_kind() const noexcept override {
        return ComponentKind::NPC;
    }
};

class FakeGeneric : public Component {};

// ── Tests ────────────────────────────────────────────────────────────

TEST(EcsScene, CreateActorAttachesScene) {
    Scene scene;
    auto& actor = scene.create_actor("player");
    EXPECT_EQ(actor.scene(), &scene);
    EXPECT_EQ(actor.name(), "player");
    EXPECT_EQ(scene.actors().size(), 1u);
}

TEST(EcsScene, AddComponentRoutesToFastAccess) {
    Scene scene;
    auto& actor = scene.create_actor();

    actor.add_component<FakeModelRenderer>();
    actor.add_component<FakeCamera>();
    actor.add_component<FakeLight>();
    actor.add_component<FakeNpc>();
    actor.add_component<FakeGeneric>();

    const auto& fac = scene.fast_access();
    EXPECT_EQ(fac.model_renderers.size(), 1u);
    EXPECT_EQ(fac.cameras.size(), 1u);
    EXPECT_EQ(fac.lights.size(), 1u);
    EXPECT_EQ(fac.npcs.size(), 1u);
    EXPECT_EQ(fac.soccer_players.size(), 0u);
}

TEST(EcsScene, RemoveComponentUnregistersFastAccess) {
    Scene scene;
    auto& actor = scene.create_actor();
    actor.add_component<FakeCamera>();
    EXPECT_EQ(scene.fast_access().cameras.size(), 1u);

    EXPECT_TRUE(actor.remove_component<FakeCamera>());
    EXPECT_EQ(scene.fast_access().cameras.size(), 0u);
}

TEST(EcsScene, ComponentsAddedBeforeSceneAttachAreRegisteredOnSetScene) {
    // Actor cree hors Scene puis attache ensuite.
    Actor orphan("orphan");
    orphan.add_component<FakeModelRenderer>();
    orphan.add_component<FakeCamera>();

    Scene scene;
    EXPECT_EQ(scene.fast_access().model_renderers.size(), 0u);

    orphan.set_scene(&scene);
    EXPECT_EQ(scene.fast_access().model_renderers.size(), 1u);
    EXPECT_EQ(scene.fast_access().cameras.size(), 1u);

    // Detachement.
    orphan.set_scene(nullptr);
    EXPECT_EQ(scene.fast_access().model_renderers.size(), 0u);
    EXPECT_EQ(scene.fast_access().cameras.size(), 0u);
}

TEST(EcsScene, MainCameraReturnsFirstRegistered) {
    Scene scene;
    auto& a = scene.create_actor();
    EXPECT_EQ(scene.main_camera(), nullptr);

    auto& cam = a.add_component<FakeCamera>();
    EXPECT_EQ(scene.main_camera(), &cam);
}

TEST(EcsScene, DestroyActorPurgesFastAccess) {
    Scene scene;
    auto& a = scene.create_actor("npc1");
    a.add_component<FakeNpc>();
    EXPECT_EQ(scene.fast_access().npcs.size(), 1u);

    EXPECT_TRUE(scene.destroy_actor(a));
    scene.collect_garbage();
    EXPECT_EQ(scene.fast_access().npcs.size(), 0u);
    EXPECT_EQ(scene.actors().size(), 0u);
}

TEST(EcsScene, FindActorByNameAndTag) {
    Scene scene;
    auto& a = scene.create_actor("hero");
    a.set_tag("player");
    (void)scene.create_actor("enemy");

    EXPECT_EQ(scene.find_actor_by_name("hero"), &a);
    EXPECT_EQ(scene.find_actor_by_tag("player"), &a);
    EXPECT_EQ(scene.find_actor_by_name("ghost"), nullptr);
}

TEST(EcsScene, UpdatePropagatesToActiveActors) {
    Scene scene;
    auto& a = scene.create_actor();

    struct Counter : Component {
        int updates = 0;
        void on_update(float /*dt*/) override { ++updates; }
    };

    auto& c = a.add_component<Counter>();
    scene.update(0.016f);
    EXPECT_EQ(c.updates, 1);

    a.set_active(false);
    scene.update(0.016f);
    EXPECT_EQ(c.updates, 1);
}

} // namespace
