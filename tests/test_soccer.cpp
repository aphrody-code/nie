/// @file test_soccer.cpp
/// Tests du systeme soccer — state machine, physique balle, formations, IA.

#include "iecode/game/soccer/soccer_state_machine.h"
#include "iecode/game/soccer/ball_component.h"
#include "iecode/game/soccer/ball_move.h"
#include "iecode/game/soccer/soccer_ctrl.h"
#include "iecode/game/soccer/soccer_ctrl_ai.h"
#include "iecode/game/soccer/soccer_team_dock.h"

#include <gtest/gtest.h>

#include <cmath>

// ═════════════════════════════════════════════════════════════════════════
// CSoccerStateMachine
// ═════════════════════════════════════════════════════════════════════════

TEST(SoccerStateMachine, InitialState) {
    game::CSoccerStateMachine sm;
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Idle);
    EXPECT_EQ(sm.score_home_, 0);
    EXPECT_EQ(sm.score_away_, 0);
    EXPECT_EQ(sm.half_, 1);
    EXPECT_FLOAT_EQ(sm.match_time_, 0.f);
    EXPECT_FALSE(sm.is_in_play());
    EXPECT_FALSE(sm.is_finished());
}

TEST(SoccerStateMachine, TransitionIdleToKickoff) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::KickOff);
    EXPECT_EQ(sm.prev_phase_, game::SoccerPhase::Idle);
}

TEST(SoccerStateMachine, TransitionKickoffToInPlay) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::InPlay);
    EXPECT_TRUE(sm.is_in_play());
}

TEST(SoccerStateMachine, InvalidTransitionBlocked) {
    game::CSoccerStateMachine sm;
    // Depuis Idle, on ne peut pas aller directement en InPlay
    sm.transition(game::SoccerPhase::InPlay);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Idle);
}

TEST(SoccerStateMachine, FullTimeIsTerminal) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    // Forcer la fin de match
    sm.transition(game::SoccerPhase::FullTime);
    EXPECT_TRUE(sm.is_finished());
    // Aucune transition possible depuis FullTime
    EXPECT_FALSE(sm.can_transition_to(game::SoccerPhase::KickOff));
    sm.transition(game::SoccerPhase::KickOff);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::FullTime);
}

TEST(SoccerStateMachine, ScoreGoal) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    sm.score_goal(0); // but domicile
    EXPECT_EQ(sm.score_home_, 1);
    EXPECT_EQ(sm.score_away_, 0);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Goal);
}

TEST(SoccerStateMachine, ScoreGoalAway) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    sm.score_goal(1); // but exterieur
    EXPECT_EQ(sm.score_home_, 0);
    EXPECT_EQ(sm.score_away_, 1);
}

TEST(SoccerStateMachine, PhaseTimerReset) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.update(1.f); // accumule du temps
    EXPECT_GT(sm.phase_timer_, 0.f);
    sm.transition(game::SoccerPhase::InPlay);
    EXPECT_FLOAT_EQ(sm.phase_timer_, 0.f); // remis a zero
}

TEST(SoccerStateMachine, EncodeTime) {
    game::CSoccerStateMachine sm;
    sm.match_time_ = 125.f; // 2 minutes 5 secondes
    int encoded = sm.encode_time();
    // 2 * 10000 + 5 = 20005
    EXPECT_EQ(encoded, 20005);
}

TEST(SoccerStateMachine, EncodeTimeZero) {
    game::CSoccerStateMachine sm;
    EXPECT_EQ(sm.encode_time(), 0);
}

TEST(SoccerStateMachine, HalfTimeTransition) {
    game::CSoccerStateMachine sm;
    sm.half_duration_ = 10.f; // mi-temps courte pour le test
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    // Simuler le temps qui passe jusqu'a la mi-temps
    sm.update(10.5f);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::HalfTime);
    EXPECT_EQ(sm.half_, 2); // Auto-incremente lors de la transition
}

TEST(SoccerStateMachine, FullMatchCycle) {
    game::CSoccerStateMachine sm;
    sm.half_duration_ = 5.f;

    // Idle -> KickOff -> InPlay
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);

    // Premiere mi-temps
    sm.update(5.5f);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::HalfTime);
    // half_ est automatiquement incremente a 2 lors de la transition vers HalfTime
    EXPECT_EQ(sm.half_, 2);

    // Mi-temps -> KickOff -> InPlay (seconde mi-temps)
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);

    // Seconde mi-temps
    sm.update(5.5f);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::FullTime);
    EXPECT_TRUE(sm.is_finished());
}

TEST(SoccerStateMachine, Reset) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    sm.score_goal(0);
    sm.reset();
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Idle);
    EXPECT_EQ(sm.score_home_, 0);
    EXPECT_EQ(sm.score_away_, 0);
    EXPECT_EQ(sm.half_, 1);
    EXPECT_FLOAT_EQ(sm.match_time_, 0.f);
}

TEST(SoccerStateMachine, GoalToKickoff) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    sm.score_goal(0);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Goal);
    // Apres un but, on peut relancer
    sm.transition(game::SoccerPhase::KickOff);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::KickOff);
}

TEST(SoccerStateMachine, FocusBattle) {
    game::CSoccerStateMachine sm;
    sm.transition(game::SoccerPhase::KickOff);
    sm.transition(game::SoccerPhase::InPlay);
    sm.transition(game::SoccerPhase::FocusBattle);
    EXPECT_TRUE(sm.is_in_battle());
    // Retour en jeu apres le combat
    sm.transition(game::SoccerPhase::InPlay);
    EXPECT_TRUE(sm.is_in_play());
}

TEST(SoccerStateMachine, PhaseName) {
    EXPECT_EQ(game::soccer_phase_name(game::SoccerPhase::Idle), "Idle");
    EXPECT_EQ(game::soccer_phase_name(game::SoccerPhase::InPlay), "InPlay");
    EXPECT_EQ(game::soccer_phase_name(game::SoccerPhase::FocusBattle), "FocusBattle");
}

// ═════════════════════════════════════════════════════════════════════════
// BallComponent
// ═════════════════════════════════════════════════════════════════════════

TEST(BallComponent, InitialState) {
    game::BallComponent ball;
    EXPECT_FALSE(ball.is_owned());
    EXPECT_FALSE(ball.is_airborne());
    EXPECT_EQ(ball.move_type_, game::BallMoveType::Normal);
    EXPECT_EQ(ball.owner_chara_id_, game::BALL_INVALID_TARGET);
}

TEST(BallComponent, SetOwner) {
    game::BallComponent ball;
    ball.set_owner(42);
    EXPECT_TRUE(ball.is_owned());
    EXPECT_EQ(ball.owner_chara_id_, 42u);
}

TEST(BallComponent, Release) {
    game::BallComponent ball;
    ball.set_owner(42);
    ball.release();
    EXPECT_FALSE(ball.is_owned());
    EXPECT_EQ(ball.owner_chara_id_, game::BALL_INVALID_TARGET);
}

TEST(BallComponent, PossessionHistory) {
    game::BallComponent ball;
    ball.set_owner(1);
    ball.set_owner(2);
    ball.set_owner(3);
    // Le slot 0 devrait contenir l'avant-dernier possesseur (2)
    EXPECT_EQ(ball.possession_slots_[0], 2);
    EXPECT_EQ(ball.possession_slots_[1], 1);
}

TEST(BallComponent, GravityFall) {
    game::BallComponent ball;
    ball.position_ = {0.f, 5.f, 0.f};
    ball.velocity_ = {0.f, 0.f, 0.f};

    // Simuler quelques frames
    for (int i = 0; i < 100; ++i) {
        ball.update_physics(0.016f);
    }

    // La balle devrait etre au sol
    EXPECT_LE(ball.position_.y, 0.2f);
}

TEST(BallComponent, BounceAtGround) {
    game::BallComponent ball;
    ball.position_ = {0.f, 1.f, 0.f};
    ball.velocity_ = {0.f, -5.f, 0.f};

    ball.update_physics(0.5f);

    // Apres le rebond, la vitesse Y devrait etre positive ou nulle
    EXPECT_GE(ball.velocity_.y, 0.f);
    EXPECT_GE(ball.position_.y, 0.f);
}

TEST(BallComponent, ApplyImpulse) {
    game::BallComponent ball;
    ball.apply_impulse({10.f, 5.f, 0.f});
    EXPECT_FLOAT_EQ(ball.velocity_.x, 10.f);
    EXPECT_FLOAT_EQ(ball.velocity_.y, 5.f);
    EXPECT_GT(ball.shot_power_, 0.f);
}

TEST(BallComponent, ResetAt) {
    game::BallComponent ball;
    ball.set_owner(42);
    ball.apply_impulse({10.f, 0.f, 0.f});
    ball.reset_at({5.f, 0.f, 3.f});
    EXPECT_FLOAT_EQ(ball.position_.x, 5.f);
    EXPECT_FLOAT_EQ(ball.position_.z, 3.f);
    EXPECT_FLOAT_EQ(ball.velocity_.x, 0.f);
    EXPECT_FALSE(ball.is_owned());
}

TEST(BallComponent, Airborne) {
    game::BallComponent ball;
    ball.position_.y = 0.f;
    EXPECT_FALSE(ball.is_airborne());
    ball.position_.y = 1.f;
    EXPECT_TRUE(ball.is_airborne());
}

TEST(BallComponent, FrictionStopsBall) {
    game::BallComponent ball;
    ball.position_ = {0.f, 0.f, 0.f};
    ball.velocity_ = {0.5f, 0.f, 0.f};

    // Simuler beaucoup de frames — la balle doit finir par s'arreter
    for (int i = 0; i < 500; ++i) {
        ball.update_physics(0.016f);
    }

    float speed = std::sqrt(ball.velocity_.x * ball.velocity_.x
                          + ball.velocity_.z * ball.velocity_.z);
    EXPECT_LT(speed, 0.01f);
}

// ═════════════════════════════════════════════════════════════════════════
// BallMove
// ═════════════════════════════════════════════════════════════════════════

TEST(BallMove, NormalFinishes) {
    game::BallMoveNormal move;
    move.position_ = {0.f, 0.f, 0.f};
    move.velocity_ = {0.f, 0.f, 0.f};
    move.update(0.1f);
    EXPECT_TRUE(move.is_finished());
}

TEST(BallMove, BezierReachesEnd) {
    game::BallMoveBezier move;
    move.start_   = {0.f, 0.f, 0.f};
    move.control_ = {5.f, 5.f, 0.f};
    move.end_     = {10.f, 0.f, 0.f};
    move.duration_ = 1.f;

    // A mi-parcours
    move.update(0.5f);
    EXPECT_FALSE(move.is_finished());

    // A la fin
    move.update(0.6f);
    EXPECT_TRUE(move.is_finished());

    // La position devrait etre proche de end_
    EXPECT_NEAR(move.position_.x, 10.f, 0.01f);
    EXPECT_NEAR(move.position_.y, 0.f, 0.01f);
}

TEST(BallMove, LerpInterpolation) {
    game::BallMoveLerp move;
    move.start_    = {0.f, 0.f, 0.f};
    move.end_      = {10.f, 0.f, 0.f};
    move.duration_ = 1.f;

    move.update(0.5f);
    EXPECT_NEAR(move.position_.x, 5.f, 0.01f);

    move.update(0.5f);
    EXPECT_TRUE(move.is_finished());
    EXPECT_NEAR(move.position_.x, 10.f, 0.01f);
}

TEST(BallMove, ParabolaArc) {
    game::BallMoveSimpleParabora move;
    move.start_    = {0.f, 0.f, 0.f};
    move.end_      = {10.f, 0.f, 0.f};
    move.height_   = 5.f;
    move.duration_ = 1.f;

    // A mi-parcours, la hauteur devrait etre maximale
    move.update(0.5f);
    EXPECT_NEAR(move.position_.y, 5.f, 0.01f);
    EXPECT_NEAR(move.position_.x, 5.f, 0.01f);
}

TEST(BallMove, TargetFollowArrives) {
    game::BallMoveTargetFollow move;
    move.position_     = {0.f, 0.f, 0.f};
    move.target_pos_   = {1.f, 0.f, 0.f};
    move.follow_speed_ = 100.f;
    move.arrive_dist_  = 0.5f;

    move.update(0.1f);
    EXPECT_TRUE(move.is_finished());
}

TEST(BallMove, RateConstantSpeed) {
    game::BallMoveRate move;
    move.direction_ = {1.f, 0.f, 0.f};
    move.speed_     = 10.f;
    move.max_time_  = 2.f;

    move.update(1.f);
    EXPECT_NEAR(move.position_.x, 10.f, 0.01f);
    EXPECT_FALSE(move.is_finished());

    move.update(1.f);
    EXPECT_TRUE(move.is_finished());
}

TEST(BallMove, GoalnetDecelerates) {
    game::BallMoveGoalnet move;
    move.velocity_ = {0.f, 0.f, -10.f};
    move.deceleration_ = 20.f;

    move.update(0.5f);
    // La vitesse devrait avoir diminue
    float speed = std::sqrt(move.velocity_.x * move.velocity_.x
                          + move.velocity_.z * move.velocity_.z);
    EXPECT_LT(speed, 10.f);
}

TEST(BallMove, CubicBezierReachesEnd) {
    game::BallMoveRealSkillShootBezier move;
    move.start_    = {0.f, 0.f, 0.f};
    move.control1_ = {3.f, 5.f, 0.f};
    move.control2_ = {7.f, 5.f, 0.f};
    move.end_      = {10.f, 0.f, 0.f};
    move.duration_ = 1.f;

    move.update(1.1f);
    EXPECT_TRUE(move.is_finished());
    EXPECT_NEAR(move.position_.x, 10.f, 0.01f);
}

// ═════════════════════════════════════════════════════════════════════════
// CSoccerCtrl
// ═════════════════════════════════════════════════════════════════════════

TEST(SoccerCtrl, SelectChara) {
    game::CSoccerCtrl ctrl;
    ctrl.active_ = true;
    ctrl.select_chara(42);
    EXPECT_EQ(ctrl.selected_chara_id_, 42u);
}

TEST(SoccerCtrl, ExecuteAction) {
    game::CSoccerCtrl ctrl;
    ctrl.active_ = true;
    ctrl.execute_action(game::SoccerAction::SHOOT);
    EXPECT_EQ(ctrl.current_action_, game::SoccerAction::SHOOT);
}

TEST(SoccerCtrl, TackleSetFlag) {
    game::CSoccerCtrl ctrl;
    ctrl.active_ = true;
    ctrl.execute_action(game::SoccerAction::TACKLE);
    EXPECT_TRUE(ctrl.is_tackling_);
}

TEST(SoccerCtrl, InactiveIgnoresAction) {
    game::CSoccerCtrl ctrl;
    ctrl.active_ = false;
    ctrl.execute_action(game::SoccerAction::SHOOT);
    EXPECT_EQ(ctrl.current_action_, game::SoccerAction::NONE);
}

TEST(SoccerCtrl, ShootZone) {
    game::CSoccerCtrl ctrl;
    // Au milieu du terrain
    ctrl.player_z_ = 0.f;
    EXPECT_FALSE(ctrl.is_in_shoot_zone());

    // Pres du but adverse
    ctrl.player_z_ = 40.f;
    EXPECT_TRUE(ctrl.is_in_shoot_zone());
}

TEST(SoccerCtrl, PenaltyZone) {
    game::CSoccerCtrl ctrl;
    ctrl.player_x_ = 0.f;
    ctrl.player_z_ = 50.f; // tres pres du but
    EXPECT_TRUE(ctrl.is_in_penalty_zone());

    // Trop loin lateralement
    ctrl.player_x_ = 30.f;
    EXPECT_FALSE(ctrl.is_in_penalty_zone());
}

TEST(SoccerCtrl, ActionName) {
    EXPECT_EQ(game::soccer_action_name(game::SoccerAction::SHOOT), "Shoot");
    EXPECT_EQ(game::soccer_action_name(game::SoccerAction::NONE), "None");
    EXPECT_EQ(game::soccer_action_name(game::SoccerAction::THROUGH), "Through");
}

// ═════════════════════════════════════════════════════════════════════════
// CSoccerCtrlAI
// ═════════════════════════════════════════════════════════════════════════

TEST(SoccerCtrlAI, EvaluateWithBall) {
    game::CSoccerCtrlAI ai;
    ai.active_ = true;
    ai.aggression_ = 0.8f;
    ai.evaluate(true);
    EXPECT_EQ(ai.state_machine_.current_state_, game::SoccerAIState::Attack);
}

TEST(SoccerCtrlAI, EvaluateWithoutBall) {
    game::CSoccerCtrlAI ai;
    ai.active_ = true;
    ai.aggression_ = 0.3f;
    ai.evaluate(false);
    EXPECT_EQ(ai.state_machine_.current_state_, game::SoccerAIState::Defend);
}

TEST(SoccerCtrlAI, DecideActionShoot) {
    game::CSoccerCtrlAI ai;
    ai.shoot_distance_ = 30.f;
    ai.shot_accuracy_ = 0.8f;
    auto action = ai.decide_action(true, 20.f);
    EXPECT_EQ(action, game::SoccerAction::SHOOT);
}

TEST(SoccerCtrlAI, DecideActionTackle) {
    game::CSoccerCtrlAI ai;
    ai.tackle_distance_ = 5.f;
    ai.aggression_ = 0.5f;
    auto action = ai.decide_action(false, 3.f);
    EXPECT_EQ(action, game::SoccerAction::TACKLE);
}

TEST(SoccerCtrlAI, DecideActionNone) {
    game::CSoccerCtrlAI ai;
    ai.tackle_distance_ = 3.f;
    ai.aggression_ = 0.1f;
    auto action = ai.decide_action(false, 10.f);
    EXPECT_EQ(action, game::SoccerAction::NONE);
}

TEST(SoccerCtrlAI, StateMachineTimer) {
    game::CSoccerCtrlAIStateMachine sm;
    sm.transition(game::SoccerAIState::Attack);
    sm.update(1.5f);
    EXPECT_FLOAT_EQ(sm.state_timer_, 1.5f);
}

TEST(SoccerCtrlAI, AIStateName) {
    EXPECT_EQ(game::soccer_ai_state_name(game::SoccerAIState::Attack), "Attack");
    EXPECT_EQ(game::soccer_ai_state_name(game::SoccerAIState::Defend), "Defend");
}

// ═════════════════════════════════════════════════════════════════════════
// CSoccerTeamDock
// ═════════════════════════════════════════════════════════════════════════

TEST(SoccerTeamDock, DefaultFormation) {
    game::CSoccerTeamDock dock;
    dock.apply_formation(game::FormationType::F_4_4_2);
    EXPECT_EQ(dock.formation_, game::FormationType::F_4_4_2);

    // Le GK est au centre arriere
    EXPECT_NEAR(dock.formation_slots_[0].x, 0.5f, 0.01f);
    EXPECT_LT(dock.formation_slots_[0].z, 0.1f);
}

TEST(SoccerTeamDock, AllFormationsValid) {
    // Verifier que toutes les formations generent des slots sensibles
    game::CSoccerTeamDock dock;

    auto formations = {
        game::FormationType::F_4_4_2, game::FormationType::F_4_3_3,
        game::FormationType::F_3_5_2, game::FormationType::F_4_5_1,
        game::FormationType::F_5_3_2, game::FormationType::F_3_4_3,
        game::FormationType::F_4_2_4, game::FormationType::F_5_4_1,
    };

    for (auto ft : formations) {
        dock.apply_formation(ft);
        for (uint32_t i = 0; i < game::TEAM_STARTERS; ++i) {
            EXPECT_GE(dock.formation_slots_[i].x, 0.f)
                << "Formation " << game::formation_name(ft) << " slot " << i;
            EXPECT_LE(dock.formation_slots_[i].x, 1.f)
                << "Formation " << game::formation_name(ft) << " slot " << i;
            EXPECT_GE(dock.formation_slots_[i].z, 0.f)
                << "Formation " << game::formation_name(ft) << " slot " << i;
            EXPECT_LE(dock.formation_slots_[i].z, 1.f)
                << "Formation " << game::formation_name(ft) << " slot " << i;
        }
    }
}

TEST(SoccerTeamDock, FindPlayer) {
    game::CSoccerTeamDock dock;
    dock.players_[0].chara_id = 100;
    dock.players_[1].chara_id = 200;

    auto* player = dock.find_player(200);
    ASSERT_NE(player, nullptr);
    EXPECT_EQ(player->chara_id, 200u);

    auto* not_found = dock.find_player(999);
    EXPECT_EQ(not_found, nullptr);
}

TEST(SoccerTeamDock, OnFieldCount) {
    game::CSoccerTeamDock dock;
    dock.active_count_ = 11;
    for (uint32_t i = 0; i < 11; ++i) {
        dock.players_[i].is_on_field = true;
    }
    EXPECT_EQ(dock.on_field_count(), 11u);

    // Un joueur quitte le terrain
    dock.players_[5].is_on_field = false;
    EXPECT_EQ(dock.on_field_count(), 10u);
}

TEST(SoccerTeamDock, HasCaptainOnField) {
    game::CSoccerTeamDock dock;
    dock.active_count_ = 11;
    dock.players_[0].is_on_field = true;
    dock.players_[0].is_captain  = true;
    EXPECT_TRUE(dock.has_captain_on_field());

    dock.players_[0].is_on_field = false;
    EXPECT_FALSE(dock.has_captain_on_field());
}

TEST(SoccerTeamDock, Score) {
    game::CSoccerTeamDock dock;
    dock.score_ = 0;
    dock.record_.goals_scored = 0;
    dock.score_ = 3;
    dock.record_.goals_scored = 3;
    EXPECT_EQ(dock.score_, 3);
    EXPECT_EQ(dock.record_.goals_scored, 3u);
}

TEST(SoccerTeamDock, FormationName) {
    EXPECT_EQ(game::formation_name(game::FormationType::F_4_4_2), "4-4-2");
    EXPECT_EQ(game::formation_name(game::FormationType::F_3_5_2), "3-5-2");
}

TEST(SoccerTeamDock, Constants) {
    EXPECT_EQ(game::MAX_SOCCER_PLAYERS, 58u);
    EXPECT_EQ(game::SOCCER_PLAYER_STRIDE, 0x570u);
    EXPECT_EQ(game::SOCCER_TEAM_STRIDE, 0x1028u);
    EXPECT_EQ(game::TEAM_STARTERS, 11u);
    EXPECT_EQ(game::TEAM_MAX_PLAYERS, 16u);
}

// ═════════════════════════════════════════════════════════════════════════
// Cycle de match complet
// ═════════════════════════════════════════════════════════════════════════

TEST(SoccerIntegration, FullMatchCycleWithGoal) {
    // Scenario : kickoff -> jeu -> but -> kickoff -> jeu -> mi-temps
    game::CSoccerStateMachine sm;
    sm.half_duration_ = 10.f;
    game::BallComponent ball;
    game::CSoccerTeamDock home;
    game::CSoccerTeamDock away;
    home.apply_formation(game::FormationType::F_4_4_2);
    away.apply_formation(game::FormationType::F_4_3_3);

    // Coup d'envoi
    sm.transition(game::SoccerPhase::KickOff);
    ball.reset_at({0.f, 0.f, 0.f});
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::KickOff);

    // Jeu en cours
    sm.transition(game::SoccerPhase::InPlay);
    ball.set_owner(1);
    ball.apply_impulse({5.f, 2.f, 8.f});
    EXPECT_TRUE(ball.is_owned());

    // Simulation physique
    for (int i = 0; i < 30; ++i) {
        ball.update_physics(0.016f);
        sm.update(0.016f);
    }

    // But !
    sm.score_goal(0);
    home.score_ = sm.score_home_;
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::Goal);
    EXPECT_EQ(home.score_, 1);

    // Relance
    sm.transition(game::SoccerPhase::KickOff);
    ball.reset_at({0.f, 0.f, 0.f});
    sm.transition(game::SoccerPhase::InPlay);

    // Avance rapide jusqu'a la mi-temps
    sm.update(10.f);
    EXPECT_EQ(sm.current_phase_, game::SoccerPhase::HalfTime);
}
