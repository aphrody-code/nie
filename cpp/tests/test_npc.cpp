/// @file test_npc.cpp
/// Tests du systeme NPC — lifecycle, detection, transitions d'etat, interaction.

#include "iecode/game/npc/npc_base.h"
#include "iecode/game/npc/npc_happen_event.h"
#include "iecode/game/npc/npc_mob.h"
#include "iecode/game/npc/npc_cmn_task.h"
#include "iecode/game/npc/npc_craft.h"

#include <gtest/gtest.h>

// ═════════════════════════════════════════════════════════════════════════
// CBaseNpcController
// ═════════════════════════════════════════════════════════════════════════

TEST(NpcBase, InitialState) {
    game::CBaseNpcController npc;
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Idle);
    EXPECT_TRUE(npc.is_interactable_);
    EXPECT_FLOAT_EQ(npc.move_speed_, 2.f);
    EXPECT_FLOAT_EQ(npc.detection_radius_, 5.f);
    EXPECT_FALSE(npc.is_talking());
}

TEST(NpcBase, SetBehavior) {
    game::CBaseNpcController npc;
    npc.set_behavior(game::NpcBehavior::Patrol);
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Patrol);
}

TEST(NpcBase, SetBehaviorSameNoChange) {
    game::CBaseNpcController npc;
    npc.set_behavior(game::NpcBehavior::Idle);
    // Pas de changement — l'etat reste Idle
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Idle);
}

TEST(NpcBase, IsTalking) {
    game::CBaseNpcController npc;
    EXPECT_FALSE(npc.is_talking());
    npc.set_behavior(game::NpcBehavior::Talk);
    EXPECT_TRUE(npc.is_talking());
}

TEST(NpcBase, PlayerInRange) {
    game::CBaseNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.detection_radius_ = 5.f;

    // Joueur a 3 metres — dans le rayon
    EXPECT_TRUE(npc.is_player_in_range({3.f, 0.f, 0.f}));

    // Joueur a 10 metres — hors du rayon
    EXPECT_FALSE(npc.is_player_in_range({10.f, 0.f, 0.f}));

    // Joueur exactement a la limite
    EXPECT_TRUE(npc.is_player_in_range({5.f, 0.f, 0.f}));
}

TEST(NpcBase, PlayerInRangeZeroRadius) {
    game::CBaseNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.detection_radius_ = 0.f;

    // Seul le joueur a la meme position est detecte
    EXPECT_TRUE(npc.is_player_in_range({0.f, 0.f, 0.f}));
    EXPECT_FALSE(npc.is_player_in_range({0.01f, 0.f, 0.f}));
}

TEST(NpcBase, ControllerName) {
    game::CBaseNpcController npc;
    EXPECT_EQ(npc.controller_name(), "CBaseNpcController");
}

TEST(NpcBase, BehaviorName) {
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Idle), "Idle");
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Patrol), "Patrol");
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Talk), "Talk");
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Follow), "Follow");
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Flee), "Flee");
    EXPECT_EQ(game::npc_behavior_name(game::NpcBehavior::Custom), "Custom");
}

TEST(NpcBase, DataDialogueIndex) {
    game::CBaseNpcData data;
    EXPECT_EQ(data.dialogue_index, 0u);
    data.dialogue_index = 42;
    EXPECT_EQ(data.dialogue_index, 42u);
}

// ═════════════════════════════════════════════════════════════════════════
// CHappenEventNpcController
// ═════════════════════════════════════════════════════════════════════════

TEST(NpcHappenEvent, InitialState) {
    game::CHappenEventNpcController npc;
    EXPECT_FALSE(npc.is_triggered_);
    EXPECT_FLOAT_EQ(npc.dist_to_player_, 0.f);
    EXPECT_EQ(npc.controller_name(), "CHappenEventNpcController");
}

TEST(NpcHappenEvent, InteractTriggersEvent) {
    game::CHappenEventNpcController npc;
    npc.is_interactable_ = true;
    npc.interact();
    EXPECT_TRUE(npc.is_triggered_);
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Custom);
}

TEST(NpcHappenEvent, OneShotDoesNotRetrigger) {
    game::CHappenEventNpcController npc;
    npc.is_interactable_ = true;
    npc.interact();
    EXPECT_TRUE(npc.is_triggered_);

    // Deuxieme interaction — ne change rien
    npc.set_behavior(game::NpcBehavior::Idle);
    npc.interact();
    // Le comportement ne change pas car is_triggered_ est toujours true
    EXPECT_TRUE(npc.is_triggered_);
}

TEST(NpcHappenEvent, NotInteractable) {
    game::CHappenEventNpcController npc;
    npc.is_interactable_ = false;
    npc.interact();
    EXPECT_FALSE(npc.is_triggered_);
}

TEST(NpcHappenEvent, DataFields) {
    game::CHappenEventNpcData data;
    EXPECT_EQ(data.event_id, 0u);
    EXPECT_FLOAT_EQ(data.trigger_radius, 5.f);
    EXPECT_TRUE(data.one_shot);
    EXPECT_FALSE(data.has_triggered);
}

// ═════════════════════════════════════════════════════════════════════════
// CMobNpcController
// ═════════════════════════════════════════════════════════════════════════

TEST(NpcMob, InitialState) {
    game::CMobNpcController npc;
    EXPECT_EQ(npc.current_waypoint_, 0u);
    EXPECT_FALSE(npc.is_waiting_);
    EXPECT_FALSE(npc.is_hostile_);
    EXPECT_FALSE(npc.combat_engaged_);
    EXPECT_EQ(npc.controller_name(), "CMobNpcController");
}

TEST(NpcMob, StartPatrol) {
    game::CMobNpcController npc;
    npc.start_patrol();
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Patrol);
    EXPECT_EQ(npc.current_waypoint_, 0u);
    EXPECT_FALSE(npc.is_waiting_);
}

TEST(NpcMob, PatrolMovement) {
    game::CMobNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.direction_ = {1.f, 0.f, 0.f};
    npc.move_speed_ = 10.f;
    npc.start_patrol();

    npc.update(1.f);

    // Devrait avoir avance de 10 metres sur l'axe X
    EXPECT_NEAR(npc.position_.x, 10.f, 0.01f);
}

TEST(NpcMob, PatrolWaiting) {
    game::CMobNpcController npc;
    npc.start_patrol();
    npc.is_waiting_ = true;
    npc.wait_timer_ = 1.f;

    auto pos_before = npc.position_;
    npc.update(0.5f);

    // Ne devrait pas bouger pendant l'attente
    EXPECT_FLOAT_EQ(npc.position_.x, pos_before.x);
    EXPECT_FLOAT_EQ(npc.wait_timer_, 0.5f);

    // Apres le timer, reprendre la marche
    npc.update(0.6f);
    EXPECT_FALSE(npc.is_waiting_);
    EXPECT_EQ(npc.current_waypoint_, 1u);
}

TEST(NpcMob, CombatEngaged) {
    game::CMobNpcController npc;
    npc.is_hostile_ = true;
    npc.is_interactable_ = true;
    npc.interact();
    EXPECT_TRUE(npc.combat_engaged_);
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Custom);
}

TEST(NpcMob, CombatEngagedStopsMovement) {
    game::CMobNpcController npc;
    npc.start_patrol();
    npc.direction_ = {1.f, 0.f, 0.f};
    npc.move_speed_ = 10.f;
    npc.combat_engaged_ = true;

    auto pos_before = npc.position_;
    npc.update(1.f);

    // Ne devrait pas bouger pendant le combat
    EXPECT_FLOAT_EQ(npc.position_.x, pos_before.x);
}

TEST(NpcMob, CanEngage) {
    game::CMobNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.is_hostile_ = true;
    npc.engage_radius_ = 3.f;

    // Joueur a 2 metres — engagement possible
    EXPECT_TRUE(npc.can_engage({2.f, 0.f, 0.f}));

    // Joueur a 5 metres — trop loin
    EXPECT_FALSE(npc.can_engage({5.f, 0.f, 0.f}));
}

TEST(NpcMob, CannotEngageIfNotHostile) {
    game::CMobNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.is_hostile_ = false;
    npc.engage_radius_ = 3.f;

    EXPECT_FALSE(npc.can_engage({1.f, 0.f, 0.f}));
}

TEST(NpcMob, CannotEngageIfAlreadyEngaged) {
    game::CMobNpcController npc;
    npc.position_ = {0.f, 0.f, 0.f};
    npc.is_hostile_ = true;
    npc.combat_engaged_ = true;
    npc.engage_radius_ = 3.f;

    EXPECT_FALSE(npc.can_engage({1.f, 0.f, 0.f}));
}

TEST(NpcMob, NonHostileInteractDoesNotEngage) {
    game::CMobNpcController npc;
    npc.is_hostile_ = false;
    npc.is_interactable_ = true;
    npc.interact();
    EXPECT_FALSE(npc.combat_engaged_);
}

TEST(NpcMob, DataFields) {
    game::CMobNpcData data;
    EXPECT_EQ(data.battle_group_id, 0u);
    EXPECT_FLOAT_EQ(data.engage_radius, 3.f);
    EXPECT_FALSE(data.is_hostile);
}

// ═════════════════════════════════════════════════════════════════════════
// CCmnTaskNpcController
// ═════════════════════════════════════════════════════════════════════════

TEST(NpcCmnTask, InteractSetsTalkState) {
    game::CCmnTaskNpcController npc;
    npc.is_interactable_ = true;
    npc.interact();
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Talk);
    EXPECT_EQ(npc.controller_name(), "CCmnTaskNpcController");
}

TEST(NpcCmnTask, NotInteractableIgnores) {
    game::CCmnTaskNpcController npc;
    npc.is_interactable_ = false;
    npc.interact();
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Idle);
}

// ═════════════════════════════════════════════════════════════════════════
// CCraftNpcController
// ═════════════════════════════════════════════════════════════════════════

TEST(NpcCraft, InteractOpensCraft) {
    game::CCraftNpcController npc;
    npc.is_interactable_ = true;
    EXPECT_FALSE(npc.is_crafting_);
    npc.interact();
    EXPECT_TRUE(npc.is_crafting_);
    EXPECT_EQ(npc.behavior_, game::NpcBehavior::Talk);
    EXPECT_EQ(npc.controller_name(), "CCraftNpcController");
}

TEST(NpcCraft, NotInteractableIgnores) {
    game::CCraftNpcController npc;
    npc.is_interactable_ = false;
    npc.interact();
    EXPECT_FALSE(npc.is_crafting_);
}
