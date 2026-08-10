/// @file test_ecs.cpp
/// Tests unitaires pour le systeme ECS (Actor, Component, Behaviour).

#include <iecode/engine/ecs/actor.h>
#include <iecode/engine/ecs/behaviour.h>
#include <iecode/engine/ecs/component.h>

#include <gtest/gtest.h>

#include <string>

namespace {

// ── Composants de test ───────────────────────────────────────────────

/// Composant de test qui trace les appels de cycle de vie.
class TestComponent : public lives::ecs::Component {
public:
    int awake_count     = 0;
    int start_count     = 0;
    int update_count    = 0;
    int late_count      = 0;
    int destroy_count   = 0;
    int enable_count    = 0;
    int disable_count   = 0;
    float last_dt       = 0.0f;

    void on_awake() override { ++awake_count; }
    void on_start() override { ++start_count; }
    void on_update(float dt) override { ++update_count; last_dt = dt; }
    void on_late_update(float dt) override { ++late_count; last_dt = dt; }
    void on_destroy() override { ++destroy_count; }
    void on_enable() override { ++enable_count; }
    void on_disable() override { ++disable_count; }

    [[nodiscard]] std::string_view component_name() const override {
        return "TestComponent";
    }
};

/// Deuxieme type pour tester la resolution par type.
class AnotherComponent : public lives::ecs::Component {
public:
    int value = 42;

    [[nodiscard]] std::string_view component_name() const override {
        return "AnotherComponent";
    }
};

// ── Tests Actor ──────────────────────────────────────────────────────

TEST(ActorTest, DefaultConstruction) {
    lives::ecs::Actor actor;
    EXPECT_EQ(actor.name(), "Actor");
    EXPECT_TRUE(actor.is_active());
    EXPECT_EQ(actor.component_count(), 0u);
    EXPECT_EQ(actor.child_count(), 0u);
    EXPECT_EQ(actor.parent(), nullptr);
    EXPECT_TRUE(actor.tag().empty());
}

TEST(ActorTest, NamedConstruction) {
    lives::ecs::Actor actor("Player");
    EXPECT_EQ(actor.name(), "Player");
}

TEST(ActorTest, GetClassName) {
    lives::ecs::Actor actor;
    EXPECT_EQ(actor.get_class_name(), "Actor");
}

TEST(ActorTest, TagSystem) {
    lives::ecs::Actor actor;
    actor.set_tag("ball");
    EXPECT_EQ(actor.tag(), "ball");
}

TEST(ActorTest, ActiveState) {
    lives::ecs::Actor actor;
    EXPECT_TRUE(actor.is_active());

    actor.set_active(false);
    EXPECT_FALSE(actor.is_active());

    actor.set_active(true);
    EXPECT_TRUE(actor.is_active());
}

TEST(ActorTest, TransformDefault) {
    lives::ecs::Actor actor;
    const auto& t = actor.transform();

    EXPECT_FLOAT_EQ(t.position.x, 0.0f);
    EXPECT_FLOAT_EQ(t.position.y, 0.0f);
    EXPECT_FLOAT_EQ(t.position.z, 0.0f);

    EXPECT_FLOAT_EQ(t.scale.x, 1.0f);
    EXPECT_FLOAT_EQ(t.scale.y, 1.0f);
    EXPECT_FLOAT_EQ(t.scale.z, 1.0f);

    // Quaternion identite : w=1, x=y=z=0
    EXPECT_FLOAT_EQ(t.rotation.w, 1.0f);
    EXPECT_FLOAT_EQ(t.rotation.x, 0.0f);
    EXPECT_FLOAT_EQ(t.rotation.y, 0.0f);
    EXPECT_FLOAT_EQ(t.rotation.z, 0.0f);
}

TEST(ActorTest, TransformModification) {
    lives::ecs::Actor actor;
    actor.transform().position = glm::vec3(10.0f, 20.0f, 30.0f);
    actor.transform().scale = glm::vec3(2.0f);

    EXPECT_FLOAT_EQ(actor.transform().position.x, 10.0f);
    EXPECT_FLOAT_EQ(actor.transform().scale.y, 2.0f);
}

// ── Tests Component ──────────────────────────────────────────────────

TEST(ActorTest, AddComponent) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    EXPECT_EQ(actor.component_count(), 1u);
    EXPECT_EQ(comp.owner(), &actor);
    EXPECT_EQ(comp.component_name(), "TestComponent");
}

TEST(ActorTest, GetComponent) {
    lives::ecs::Actor actor;
    actor.add_component<TestComponent>();

    auto* found = actor.get_component<TestComponent>();
    ASSERT_NE(found, nullptr);
    EXPECT_EQ(found->component_name(), "TestComponent");
}

TEST(ActorTest, GetComponentAbsent) {
    lives::ecs::Actor actor;
    auto* found = actor.get_component<TestComponent>();
    EXPECT_EQ(found, nullptr);
}

TEST(ActorTest, HasComponent) {
    lives::ecs::Actor actor;
    EXPECT_FALSE(actor.has_component<TestComponent>());

    actor.add_component<TestComponent>();
    EXPECT_TRUE(actor.has_component<TestComponent>());
}

TEST(ActorTest, RemoveComponent) {
    lives::ecs::Actor actor;
    actor.add_component<TestComponent>();

    EXPECT_TRUE(actor.remove_component<TestComponent>());
    EXPECT_EQ(actor.component_count(), 0u);
    EXPECT_FALSE(actor.has_component<TestComponent>());
}

TEST(ActorTest, RemoveComponentAbsent) {
    lives::ecs::Actor actor;
    EXPECT_FALSE(actor.remove_component<TestComponent>());
}

TEST(ActorTest, MultipleComponentTypes) {
    lives::ecs::Actor actor;
    auto& test_comp = actor.add_component<TestComponent>();
    auto& another = actor.add_component<AnotherComponent>();

    EXPECT_EQ(actor.component_count(), 2u);

    auto* tc = actor.get_component<TestComponent>();
    auto* ac = actor.get_component<AnotherComponent>();

    ASSERT_NE(tc, nullptr);
    ASSERT_NE(ac, nullptr);
    EXPECT_EQ(tc, &test_comp);
    EXPECT_EQ(ac, &another);
    EXPECT_EQ(ac->value, 42);
}

// ── Tests cycle de vie ───────────────────────────────────────────────

TEST(ActorTest, LifecycleAwake) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    actor.awake();
    EXPECT_EQ(comp.awake_count, 1);
    EXPECT_EQ(comp.start_count, 0);
}

TEST(ActorTest, LifecycleStart) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    actor.start();
    EXPECT_EQ(comp.start_count, 1);
}

TEST(ActorTest, LifecycleUpdate) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    actor.update(0.016f);
    EXPECT_EQ(comp.update_count, 1);
    EXPECT_FLOAT_EQ(comp.last_dt, 0.016f);
}

TEST(ActorTest, LifecycleLateUpdate) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    actor.late_update(0.033f);
    EXPECT_EQ(comp.late_count, 1);
    EXPECT_FLOAT_EQ(comp.last_dt, 0.033f);
}

TEST(ActorTest, LifecycleDestroy) {
    lives::ecs::Actor actor;
    actor.add_component<TestComponent>();

    actor.destroy();
    // Apres destroy, les composants sont vides.
    EXPECT_EQ(actor.component_count(), 0u);
}

TEST(ActorTest, UpdateSkipsInactive) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();
    actor.set_active(false);

    actor.update(0.016f);
    EXPECT_EQ(comp.update_count, 0);
}

TEST(ActorTest, UpdateSkipsDisabledComponent) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();
    comp.set_enabled(false);

    actor.update(0.016f);
    EXPECT_EQ(comp.update_count, 0);
}

// ── Tests enable/disable ─────────────────────────────────────────────

TEST(ComponentTest, EnableDisableNotification) {
    lives::ecs::Actor actor;
    auto& comp = actor.add_component<TestComponent>();

    EXPECT_TRUE(comp.is_enabled());
    EXPECT_EQ(comp.enable_count, 0);
    EXPECT_EQ(comp.disable_count, 0);

    comp.set_enabled(false);
    EXPECT_FALSE(comp.is_enabled());
    EXPECT_EQ(comp.disable_count, 1);

    comp.set_enabled(true);
    EXPECT_TRUE(comp.is_enabled());
    EXPECT_EQ(comp.enable_count, 1);

    // Pas de notification si l'etat ne change pas.
    comp.set_enabled(true);
    EXPECT_EQ(comp.enable_count, 1);
}

// ── Tests hierarchie ─────────────────────────────────────────────────

TEST(ActorTest, SetParent) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor child("Child");

    child.set_parent(&parent);

    EXPECT_EQ(child.parent(), &parent);
    EXPECT_EQ(parent.child_count(), 1u);
    EXPECT_EQ(parent.get_children()[0], &child);
}

TEST(ActorTest, AddChild) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor child("Child");

    parent.add_child(&child);

    EXPECT_EQ(child.parent(), &parent);
    EXPECT_EQ(parent.child_count(), 1u);
}

TEST(ActorTest, RemoveChild) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor child("Child");

    parent.add_child(&child);
    parent.remove_child(&child);

    EXPECT_EQ(child.parent(), nullptr);
    EXPECT_EQ(parent.child_count(), 0u);
}

TEST(ActorTest, ReparentDetachesFromOldParent) {
    lives::ecs::Actor parent1("Parent1");
    lives::ecs::Actor parent2("Parent2");
    lives::ecs::Actor child("Child");

    child.set_parent(&parent1);
    EXPECT_EQ(parent1.child_count(), 1u);

    child.set_parent(&parent2);
    EXPECT_EQ(parent1.child_count(), 0u);
    EXPECT_EQ(parent2.child_count(), 1u);
    EXPECT_EQ(child.parent(), &parent2);
}

TEST(ActorTest, SetParentNull) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor child("Child");

    child.set_parent(&parent);
    child.set_parent(nullptr);

    EXPECT_EQ(child.parent(), nullptr);
    EXPECT_EQ(parent.child_count(), 0u);
}

TEST(ActorTest, CannotBeSelfParent) {
    lives::ecs::Actor actor("Self");
    actor.set_parent(&actor);
    EXPECT_EQ(actor.parent(), nullptr);
}

TEST(ActorTest, DestroyPropagesToChildren) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor child("Child");
    child.add_component<TestComponent>();

    parent.add_child(&child);
    // destroy() est recursif sur les enfants
    parent.destroy();

    // L'enfant a ete destroy (composants vides).
    EXPECT_EQ(child.component_count(), 0u);
}

TEST(ActorTest, MultipleChildren) {
    lives::ecs::Actor parent("Parent");
    lives::ecs::Actor c1("C1");
    lives::ecs::Actor c2("C2");
    lives::ecs::Actor c3("C3");

    parent.add_child(&c1);
    parent.add_child(&c2);
    parent.add_child(&c3);

    EXPECT_EQ(parent.child_count(), 3u);

    parent.remove_child(&c2);
    EXPECT_EQ(parent.child_count(), 2u);
    EXPECT_EQ(c2.parent(), nullptr);
}

// ── Tests Component type_id ──────────────────────────────────────────

TEST(ComponentTest, TypeIndex) {
    TestComponent tc;
    AnotherComponent ac;

    EXPECT_NE(tc.component_type_id(), ac.component_type_id());
    EXPECT_EQ(tc.component_type_id(), std::type_index(typeid(TestComponent)));
}

// ── Tests Behaviour ──────────────────────────────────────────────────

TEST(BehaviourTest, DefaultState) {
    lives::ecs::Behaviour b;
    EXPECT_FALSE(b.has_script());
    EXPECT_TRUE(b.script_path().empty());
    EXPECT_EQ(b.component_name(), "Behaviour");
}

TEST(BehaviourTest, TypeIdIsBehaviour) {
    lives::ecs::Behaviour b;
    EXPECT_EQ(b.component_type_id(), std::type_index(typeid(lives::ecs::Behaviour)));
}

TEST(BehaviourTest, AttachToActor) {
    lives::ecs::Actor actor("Scripted");
    auto& b = actor.add_component<lives::ecs::Behaviour>();

    EXPECT_TRUE(actor.has_component<lives::ecs::Behaviour>());
    EXPECT_EQ(b.owner(), &actor);
}

TEST(BehaviourTest, LifecycleWithoutScript) {
    // Verifier que les callbacks ne crashent pas sans script charge.
    lives::ecs::Actor actor;
    actor.add_component<lives::ecs::Behaviour>();

    actor.awake();
    actor.start();
    actor.update(0.016f);
    actor.late_update(0.016f);
    actor.destroy();
    // Pas de crash = succes.
}

TEST(BehaviourTest, SetScriptInvalidPath) {
    sol::state lua;
    lua.open_libraries(sol::lib::base);

    lives::ecs::Behaviour b;
    // Un chemin inexistant doit retourner false.
    EXPECT_FALSE(b.set_script(lua, "nonexistent_script.lua"));
    EXPECT_FALSE(b.has_script());
}

// ── Tests Actor move semantics ───────────────────────────────────────

TEST(ActorTest, MoveConstruction) {
    lives::ecs::Actor original("Movable");
    original.set_tag("test");
    original.add_component<TestComponent>();

    lives::ecs::Actor moved(std::move(original));

    EXPECT_EQ(moved.name(), "Movable");
    EXPECT_EQ(moved.tag(), "test");
    EXPECT_EQ(moved.component_count(), 1u);
    EXPECT_EQ(moved.get_component<TestComponent>()->owner(), &moved);
}

} // namespace
