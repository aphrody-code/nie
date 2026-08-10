/// @file test_rpg_battle.cpp
/// Tests du systeme RPG Battle — state machine, tours, degats, bonus elementaire.

#include "iecode/game/rpg/rpg_state_machine.h"
#include "iecode/game/rpg/rpg_battle_turn_manager.h"
#include "iecode/game/rpg/rpg_battle_shoot.h"
#include "iecode/game/rpg/rpg_battle_dribble.h"
#include "iecode/game/rpg/rpg_battle_dance.h"
#include "iecode/game/rpg/rpg_battle_lifting.h"
#include "iecode/game/rpg/rpg_battle_scramble.h"
#include "iecode/game/rpg/rpg_battle_sled_dash.h"
#include "iecode/game/rpg/rpg_battle_stairs.h"
#include "iecode/game/rpg/rpg_battle_ball_trap.h"
#include "iecode/game/rpg/rpg_target_manager.h"

#include <gtest/gtest.h>

#include <cmath>

// ═════════════════════════════════════════════════════════════════════════
// CRpgStateMachine
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgStateMachine, InitialState) {
    game::CRpgStateMachine sm;
    EXPECT_EQ(sm.current_phase_, game::RpgPhase::Idle);
    EXPECT_EQ(sm.prev_phase_, game::RpgPhase::Idle);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 0.f);
    EXPECT_FALSE(sm.is_in_battle());
    EXPECT_FALSE(sm.is_field_move());
}

TEST(RpgStateMachine, TransitionIdleToField) {
    game::CRpgStateMachine sm;
    sm.transition(game::RpgPhase::FieldMove);
    EXPECT_EQ(sm.current_phase_, game::RpgPhase::FieldMove);
    EXPECT_EQ(sm.prev_phase_, game::RpgPhase::Idle);
    EXPECT_TRUE(sm.is_field_move());
}

TEST(RpgStateMachine, TransitionFieldToBattle) {
    game::CRpgStateMachine sm;
    sm.transition(game::RpgPhase::FieldMove);
    sm.transition(game::RpgPhase::BattleInit);
    EXPECT_EQ(sm.current_phase_, game::RpgPhase::BattleInit);
    EXPECT_TRUE(sm.is_in_battle());
}

TEST(RpgStateMachine, InvalidTransitionBlocked) {
    game::CRpgStateMachine sm;
    // Depuis Idle, on ne peut pas aller directement en BattleInit
    sm.transition(game::RpgPhase::BattleInit);
    EXPECT_EQ(sm.current_phase_, game::RpgPhase::Idle);
}

TEST(RpgStateMachine, FullBattleCycle) {
    game::CRpgStateMachine sm;
    sm.transition(game::RpgPhase::FieldMove);
    sm.transition(game::RpgPhase::BattleInit);
    sm.transition(game::RpgPhase::BattleInProgress);
    sm.transition(game::RpgPhase::BattleResult);
    sm.transition(game::RpgPhase::FieldMove);
    EXPECT_TRUE(sm.is_field_move());
    EXPECT_FALSE(sm.is_in_battle());
}

TEST(RpgStateMachine, TimerAccumulates) {
    game::CRpgStateMachine sm;
    sm.update(1.5f);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 1.5f);
    sm.update(0.5f);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 2.f);
}

TEST(RpgStateMachine, TimerResetOnTransition) {
    game::CRpgStateMachine sm;
    sm.update(5.f);
    sm.transition(game::RpgPhase::FieldMove);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 0.f);
}

TEST(RpgStateMachine, Reset) {
    game::CRpgStateMachine sm;
    sm.transition(game::RpgPhase::FieldMove);
    sm.current_map_id_ = 42;
    sm.area_id_ = 7;
    sm.update(10.f);

    sm.reset();
    EXPECT_EQ(sm.current_phase_, game::RpgPhase::Idle);
    EXPECT_EQ(sm.current_map_id_, 0u);
    EXPECT_EQ(sm.area_id_, 0u);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 0.f);
}

TEST(RpgStateMachine, PhaseName) {
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::Idle), "Idle");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::FieldMove), "FieldMove");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::BattleInit), "BattleInit");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::BattleInProgress), "BattleInProgress");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::BattleResult), "BattleResult");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::EventCutscene), "EventCutscene");
    EXPECT_EQ(game::rpg_phase_name(game::RpgPhase::MapTransition), "MapTransition");
}

TEST(RpgStateMachine, SameTransitionNoOp) {
    game::CRpgStateMachine sm;
    sm.transition(game::RpgPhase::FieldMove);
    sm.update(5.f);
    // Transition vers le meme etat — pas de reset du timer
    sm.transition(game::RpgPhase::FieldMove);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 5.f);
}

// ═════════════════════════════════════════════════════════════════════════
// CRpgBattleStateMachine
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgBattleStateMachine, InitialState) {
    game::CRpgBattleStateMachine sm;
    EXPECT_EQ(sm.current_phase_, game::RpgBattlePhase::Init);
    EXPECT_EQ(sm.turn_count_, 0u);
    EXPECT_FALSE(sm.is_finished());
}

TEST(RpgBattleStateMachine, TransitionIncrementsTurn) {
    game::CRpgBattleStateMachine sm;
    sm.transition(game::RpgBattlePhase::TurnStart);
    EXPECT_EQ(sm.turn_count_, 1u);
    sm.transition(game::RpgBattlePhase::PlayerInput);
    EXPECT_EQ(sm.turn_count_, 1u); // Pas d'increment hors TurnStart
}

TEST(RpgBattleStateMachine, FullTurnCycle) {
    game::CRpgBattleStateMachine sm;
    sm.transition(game::RpgBattlePhase::TurnStart);
    sm.transition(game::RpgBattlePhase::PlayerInput);
    sm.transition(game::RpgBattlePhase::Execute);
    sm.transition(game::RpgBattlePhase::Result);
    sm.transition(game::RpgBattlePhase::TurnEnd);
    EXPECT_EQ(sm.turn_count_, 1u);
}

TEST(RpgBattleStateMachine, Reset) {
    game::CRpgBattleStateMachine sm;
    sm.transition(game::RpgBattlePhase::TurnStart);
    sm.update(5.f);
    sm.reset();
    EXPECT_EQ(sm.current_phase_, game::RpgBattlePhase::Init);
    EXPECT_EQ(sm.turn_count_, 0u);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 0.f);
}

TEST(RpgBattleStateMachine, Finished) {
    game::CRpgBattleStateMachine sm;
    sm.transition(game::RpgBattlePhase::Finish);
    EXPECT_TRUE(sm.is_finished());
}

TEST(RpgBattleStateMachine, PhaseName) {
    EXPECT_EQ(game::rpg_battle_phase_name(game::RpgBattlePhase::Init), "Init");
    EXPECT_EQ(game::rpg_battle_phase_name(game::RpgBattlePhase::Execute), "Execute");
    EXPECT_EQ(game::rpg_battle_phase_name(game::RpgBattlePhase::Finish), "Finish");
}

// ═════════════════════════════════════════════════════════════════════════
// Bonus elementaire
// ═════════════════════════════════════════════════════════════════════════

TEST(ElementBonus, FireBeatsWood) {
    // Fire(0) > Wood(1)
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Fire, game::Element::Wood), 1.5f);
}

TEST(ElementBonus, WoodBeatsEarth) {
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Wood, game::Element::Earth), 1.5f);
}

TEST(ElementBonus, EarthBeatsWind) {
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Earth, game::Element::Wind), 1.5f);
}

TEST(ElementBonus, WindBeatsFire) {
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Wind, game::Element::Fire), 1.5f);
}

TEST(ElementBonus, Disadvantage) {
    // Wood perd contre Fire
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Wood, game::Element::Fire), 0.75f);
}

TEST(ElementBonus, SameElement) {
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Fire, game::Element::Fire), 1.0f);
}

TEST(ElementBonus, NoneElementNeutral) {
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::None, game::Element::Fire), 1.0f);
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Fire, game::Element::None), 1.0f);
}

TEST(ElementBonus, NonAdjacentNeutral) {
    // Fire vs Earth — pas adjacents dans le cycle
    EXPECT_FLOAT_EQ(game::element_bonus(game::Element::Fire, game::Element::Earth), 1.0f);
}

// ═════════════════════════════════════════════════════════════════════════
// Calcul de degats
// ═════════════════════════════════════════════════════════════════════════

TEST(DamageCalculation, BasicDamage) {
    // power=100, defense=40 => 100 - 20 = 80
    auto dmg = game::CRpgBattleTurnManager::calculate_damage(
        100, 40, game::Element::None, game::Element::None);
    EXPECT_EQ(dmg, 80u);
}

TEST(DamageCalculation, MinimumDamage) {
    // power=10, defense=100 => max(1, 10-50) = 1
    auto dmg = game::CRpgBattleTurnManager::calculate_damage(
        10, 100, game::Element::None, game::Element::None);
    EXPECT_EQ(dmg, 1u);
}

TEST(DamageCalculation, ElementalAdvantage) {
    // power=100, defense=40 => base=80, * 1.5 = 120
    auto dmg = game::CRpgBattleTurnManager::calculate_damage(
        100, 40, game::Element::Fire, game::Element::Wood);
    EXPECT_EQ(dmg, 120u);
}

TEST(DamageCalculation, ElementalDisadvantage) {
    // power=100, defense=40 => base=80, * 0.75 = 60
    auto dmg = game::CRpgBattleTurnManager::calculate_damage(
        100, 40, game::Element::Wood, game::Element::Fire);
    EXPECT_EQ(dmg, 60u);
}

TEST(DamageCalculation, ZeroPower) {
    // power=0 => au minimum 1
    auto dmg = game::CRpgBattleTurnManager::calculate_damage(
        0, 0, game::Element::None, game::Element::None);
    EXPECT_GE(dmg, 1u);
}

// ═════════════════════════════════════════════════════════════════════════
// File d'attente d'actions
// ═════════════════════════════════════════════════════════════════════════

TEST(ActionQueue, EnqueueSortsBySpeed) {
    game::CRpgBattleTurnManager mgr;
    mgr.enqueue_action({.chara_id = 1, .speed = 50});
    mgr.enqueue_action({.chara_id = 2, .speed = 100});
    mgr.enqueue_action({.chara_id = 3, .speed = 75});

    // Le plus rapide en premier
    auto a1 = mgr.dequeue_action();
    EXPECT_EQ(a1.chara_id, 2u);
    EXPECT_EQ(a1.speed, 100u);

    auto a2 = mgr.dequeue_action();
    EXPECT_EQ(a2.chara_id, 3u);

    auto a3 = mgr.dequeue_action();
    EXPECT_EQ(a3.chara_id, 1u);
}

TEST(ActionQueue, DequeueEmpty) {
    game::CRpgBattleTurnManager mgr;
    auto action = mgr.dequeue_action();
    EXPECT_EQ(action.chara_id, 0u);
}

TEST(ActionQueue, ClearQueue) {
    game::CRpgBattleTurnManager mgr;
    mgr.enqueue_action({.chara_id = 1, .speed = 50});
    mgr.enqueue_action({.chara_id = 2, .speed = 100});
    mgr.clear_queue();
    EXPECT_TRUE(mgr.action_queue_.empty());
}

// ═════════════════════════════════════════════════════════════════════════
// CRpgBattleShootTurnManager
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgBattleShoot, InitialState) {
    game::CRpgBattleShootTurnManager shoot;
    EXPECT_EQ(shoot.battle_type_name(), "Shoot");
    EXPECT_FALSE(shoot.is_charging_);
    EXPECT_FLOAT_EQ(shoot.shoot_accuracy_, 0.5f);
}

TEST(RpgBattleShoot, TurnStartReset) {
    game::CRpgBattleShootTurnManager shoot;
    shoot.turn_finished_ = true;
    shoot.damage_result_ = 42;
    shoot.on_turn_start();
    EXPECT_FALSE(shoot.turn_finished_);
    EXPECT_EQ(shoot.damage_result_, 0u);
}

TEST(RpgBattleShoot, ChargingAccumulates) {
    game::CRpgBattleShootTurnManager shoot;
    shoot.on_turn_start();
    shoot.is_charging_ = true;
    shoot.update(1.f);
    EXPECT_NEAR(shoot.shoot_power_, 0.5f, 0.01f); // 1.0 / 2.0 max_charge
    shoot.update(1.f);
    EXPECT_NEAR(shoot.shoot_power_, 1.f, 0.01f);  // Plafond
}

TEST(RpgBattleShoot, EvaluateShotOnTarget) {
    game::CRpgBattleShootTurnManager shoot;
    shoot.on_turn_start();
    shoot.aim_x_ = 0.5f;
    shoot.aim_y_ = 0.5f;
    shoot.keeper_zone_x_ = -0.5f;
    shoot.keeper_zone_y_ = -0.5f;
    shoot.shoot_accuracy_ = 1.f;
    shoot.shoot_power_ = 1.f;
    shoot.kick_power_ = 100;
    shoot.keeper_catch_ = 30;
    shoot.shooter_element_ = game::Element::Fire;
    shoot.keeper_element_ = game::Element::Wood;

    shoot.evaluate_shot();
    EXPECT_TRUE(shoot.shot_on_target_);
    EXPECT_TRUE(shoot.player_won_);
    EXPECT_GT(shoot.damage_result_, 0u);
    EXPECT_TRUE(shoot.turn_finished_);
}

TEST(RpgBattleShoot, EvaluateShotOffTarget) {
    game::CRpgBattleShootTurnManager shoot;
    shoot.on_turn_start();
    shoot.aim_x_ = 2.f;  // Hors cadre
    shoot.aim_y_ = 2.f;

    shoot.evaluate_shot();
    EXPECT_FALSE(shoot.shot_on_target_);
    EXPECT_FALSE(shoot.player_won_);
    EXPECT_EQ(shoot.damage_result_, 0u);
}

TEST(RpgBattleShoot, EvaluateShotNearKeeper) {
    game::CRpgBattleShootTurnManager shoot;
    shoot.on_turn_start();
    // Tir cadre mais juste sur la zone du gardien
    shoot.aim_x_ = 0.f;
    shoot.aim_y_ = 0.f;
    shoot.keeper_zone_x_ = 0.1f;
    shoot.keeper_zone_y_ = 0.1f;
    shoot.shoot_accuracy_ = 1.f;
    shoot.shoot_power_ = 1.f;
    shoot.kick_power_ = 50;
    shoot.keeper_catch_ = 80;

    shoot.evaluate_shot();
    EXPECT_TRUE(shoot.shot_on_target_);
    EXPECT_FALSE(shoot.player_won_); // Trop pres du gardien
}

// ═════════════════════════════════════════════════════════════════════════
// CRpgBattleDribbleTurnManager
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgBattleDribble, InitialState) {
    game::CRpgBattleDribbleTurnManager dribble;
    EXPECT_EQ(dribble.battle_type_name(), "Dribble");
    EXPECT_EQ(dribble.total_segments_, 3u);
    EXPECT_EQ(dribble.current_segment_, 0u);
}

TEST(RpgBattleDribble, TurnStartReset) {
    game::CRpgBattleDribbleTurnManager dribble;
    dribble.current_segment_ = 2;
    dribble.successful_dodges_ = 2;
    dribble.on_turn_start();
    EXPECT_EQ(dribble.current_segment_, 0u);
    EXPECT_EQ(dribble.successful_dodges_, 0u);
    EXPECT_FALSE(dribble.turn_finished_);
}

TEST(RpgBattleDribble, EvaluateSegmentHighControl) {
    game::CRpgBattleDribbleTurnManager dribble;
    dribble.on_turn_start();
    dribble.attacker_control_ = 100;
    dribble.defender_body_ = 30;
    dribble.attacker_element_ = game::Element::Fire;
    dribble.defender_element_ = game::Element::Wood;

    dribble.evaluate_segment();
    EXPECT_EQ(dribble.successful_dodges_, 1u);
}

TEST(RpgBattleDribble, FullDribbleVictory) {
    game::CRpgBattleDribbleTurnManager dribble;
    dribble.total_segments_ = 3;
    dribble.attacker_control_ = 100;
    dribble.defender_body_ = 30;
    dribble.on_turn_start();

    // Simuler 3 segments en lancant les esquives
    for (uint32_t i = 0; i < 3; ++i) {
        dribble.is_dodging_ = true;
        // Avancer assez pour terminer le segment (progress >= 1)
        dribble.update(1.f); // control=100, progress += dt * (100/50) = 2.0 > 1.0
    }

    EXPECT_TRUE(dribble.turn_finished_);
    EXPECT_TRUE(dribble.player_won_); // 3/3 esquives > 3/2
}

// ═════════════════════════════════════════════════════════════════════════
// Autres types de combat — tests de base
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgBattleDance, TypeName) {
    game::CRpgBattleDanceTurnManager dance;
    EXPECT_EQ(dance.battle_type_name(), "Dance");
}

TEST(RpgBattleDance, TurnStart) {
    game::CRpgBattleDanceTurnManager dance;
    dance.on_turn_start();
    EXPECT_EQ(dance.current_beat_, 0u);
    EXPECT_EQ(dance.perfect_count_, 0u);
    EXPECT_EQ(dance.miss_count_, 0u);
    EXPECT_FALSE(dance.turn_finished_);
}

TEST(RpgBattleLifting, Gravity) {
    game::CRpgBattleLiftingTurnManager lift;
    lift.on_turn_start();
    float initial = lift.ball_height_;
    lift.update(0.5f);
    EXPECT_LT(lift.ball_height_, initial);
}

TEST(RpgBattleLifting, BallHitsGround) {
    game::CRpgBattleLiftingTurnManager lift;
    lift.gravity_ = 100.f; // Gravite tres elevee
    lift.on_turn_start();
    lift.update(1.f);
    EXPECT_TRUE(lift.turn_finished_);
    EXPECT_FLOAT_EQ(lift.ball_height_, 0.f);
}

TEST(RpgBattleScramble, TypeName) {
    game::CRpgBattleScrambleTurnManager scramble;
    EXPECT_EQ(scramble.battle_type_name(), "Scramble");
}

TEST(RpgBattleScramble, TimeOut) {
    game::CRpgBattleScrambleTurnManager scramble;
    scramble.time_limit_ = 1.f;
    scramble.on_turn_start();
    scramble.power_gauge_ = 0.f; // Le joueur ne fait rien
    scramble.update(1.5f);
    EXPECT_TRUE(scramble.turn_finished_);
    EXPECT_FALSE(scramble.player_won_); // L'adversaire gagne
}

TEST(RpgBattleScramble, PlayerWins) {
    game::CRpgBattleScrambleTurnManager scramble;
    scramble.time_limit_ = 1.f;
    scramble.on_turn_start();
    scramble.power_gauge_ = 1.f; // Le joueur est a fond
    scramble.update(1.5f);
    EXPECT_TRUE(scramble.turn_finished_);
    EXPECT_TRUE(scramble.player_won_);
}

TEST(RpgBattleSledDash, ReachesTarget) {
    game::CRpgBattleSledDashTurnManager sled;
    sled.target_distance_ = 10.f;
    sled.acceleration_ = 100.f;
    sled.max_speed_ = 1000.f;
    sled.on_turn_start();
    sled.update(1.f);
    EXPECT_TRUE(sled.turn_finished_);
    EXPECT_TRUE(sled.player_won_);
}

TEST(RpgBattleSledDash, SpeedCapped) {
    game::CRpgBattleSledDashTurnManager sled;
    sled.acceleration_ = 100.f;
    sled.max_speed_ = 5.f;
    sled.on_turn_start();
    sled.update(1.f);
    EXPECT_LE(sled.speed_, 5.f);
}

TEST(RpgBattleStairs, OpponentAdvances) {
    game::CRpgBattleStairsRaceTurnManager stairs;
    stairs.total_stairs_ = 100;
    stairs.on_turn_start();
    stairs.update(3.f);
    EXPECT_GT(stairs.opponent_stair_, 0u);
}

TEST(RpgBattleStairs, PlayerWins) {
    game::CRpgBattleStairsRaceTurnManager stairs;
    stairs.total_stairs_ = 5;
    stairs.on_turn_start();
    stairs.current_stair_ = 5; // Tricher pour tester
    stairs.update(0.1f);
    EXPECT_TRUE(stairs.turn_finished_);
    EXPECT_TRUE(stairs.player_won_);
}

TEST(RpgBattleStairs, OpponentWins) {
    game::CRpgBattleStairsRaceTurnManager stairs;
    stairs.total_stairs_ = 10;
    stairs.on_turn_start();
    // L'adversaire monte ~3.3 marches/s, donc en 4s il depasse 10
    stairs.update(4.f);
    EXPECT_TRUE(stairs.turn_finished_);
    EXPECT_FALSE(stairs.player_won_);
}

TEST(RpgBattleBallTrapFielder, TrapCount) {
    game::CRpgBattleBallTrapFielderTurnManager fielder;
    fielder.target_count_ = 3;
    fielder.on_turn_start();

    // Simuler 3 traps reussis
    fielder.trap_count_ = 3;
    fielder.update(0.1f);
    EXPECT_TRUE(fielder.turn_finished_);
    EXPECT_TRUE(fielder.player_won_);
}

TEST(RpgBattleBallTrapKeeper, Constants) {
    game::CRpgBattleBallTrapKeeperTurnManager keeper;
    // Verifier les constantes du jeu
    EXPECT_FLOAT_EQ(keeper.save_radius_, 1.0f);
    EXPECT_FLOAT_EQ(keeper.max_distance_, 5.0f);
    EXPECT_FLOAT_EQ(keeper.save_prob_, 0.8f);
    EXPECT_FLOAT_EQ(keeper.reaction_time_, 4.73f);
    EXPECT_FLOAT_EQ(keeper.dive_speed_, 2.67f);
}

// ═════════════════════════════════════════════════════════════════════════
// CRpgTargetManager
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgTargetManager, SelectNext) {
    game::CRpgTargetManager tm;
    tm.target_count_ = 3;
    tm.selected_index_ = 0;

    tm.select_next();
    EXPECT_EQ(tm.selected_index_, 1u);
    EXPECT_TRUE(tm.has_selection_);

    tm.select_next();
    EXPECT_EQ(tm.selected_index_, 2u);

    // Wraparound
    tm.select_next();
    EXPECT_EQ(tm.selected_index_, 0u);
}

TEST(RpgTargetManager, SelectPrev) {
    game::CRpgTargetManager tm;
    tm.target_count_ = 3;
    tm.selected_index_ = 0;

    // Wraparound arriere
    tm.select_prev();
    EXPECT_EQ(tm.selected_index_, 2u);

    tm.select_prev();
    EXPECT_EQ(tm.selected_index_, 1u);
}

TEST(RpgTargetManager, EmptyTargetList) {
    game::CRpgTargetManager tm;
    tm.target_count_ = 0;

    tm.select_next();
    EXPECT_EQ(tm.selected_index_, 0u);
    EXPECT_FALSE(tm.has_selection_);
}

TEST(RpgTargetManager, Confirm) {
    game::CRpgTargetManager tm;
    tm.target_count_ = 3;
    tm.select_next();
    tm.selected_chara_id_ = 42;
    tm.confirm();
    // Pas de crash, le confirm log simplement la selection
    EXPECT_TRUE(tm.has_selection_);
}

// ═════════════════════════════════════════════════════════════════════════
// Integration : cycle complet d'un combat RPG
// ═════════════════════════════════════════════════════════════════════════

TEST(RpgBattleIntegration, FullShootBattle) {
    // Scenario : RPG -> combat -> tir -> resultat
    game::CRpgStateMachine rpg_sm;
    game::CRpgBattleStateMachine battle_sm;

    // Entrer en combat
    rpg_sm.transition(game::RpgPhase::FieldMove);
    rpg_sm.transition(game::RpgPhase::BattleInit);
    EXPECT_TRUE(rpg_sm.is_in_battle());

    // Initialiser le combat
    battle_sm.transition(game::RpgBattlePhase::TurnStart);
    EXPECT_EQ(battle_sm.turn_count_, 1u);

    // Creer un tir
    game::CRpgBattleShootTurnManager shoot;
    shoot.kick_power_ = 80;
    shoot.keeper_catch_ = 40;
    shoot.shooter_element_ = game::Element::Fire;
    shoot.keeper_element_ = game::Element::Wood;
    shoot.aim_x_ = 0.8f;
    shoot.aim_y_ = 0.3f;
    shoot.keeper_zone_x_ = -0.5f;
    shoot.keeper_zone_y_ = 0.f;
    shoot.shoot_accuracy_ = 0.9f;
    shoot.shoot_power_ = 0.8f;

    shoot.on_turn_start();
    shoot.evaluate_shot();

    EXPECT_TRUE(shoot.turn_finished_);
    EXPECT_TRUE(shoot.shot_on_target_);
    EXPECT_GT(shoot.damage_result_, 0u);

    // Finir le combat
    battle_sm.transition(game::RpgBattlePhase::Execute);
    battle_sm.transition(game::RpgBattlePhase::Result);
    battle_sm.transition(game::RpgBattlePhase::TurnEnd);
    battle_sm.transition(game::RpgBattlePhase::Finish);
    EXPECT_TRUE(battle_sm.is_finished());

    // Retour a l'exploration
    rpg_sm.transition(game::RpgPhase::BattleInProgress);
    rpg_sm.transition(game::RpgPhase::BattleResult);
    rpg_sm.transition(game::RpgPhase::FieldMove);
    EXPECT_TRUE(rpg_sm.is_field_move());
}
