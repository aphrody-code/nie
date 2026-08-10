/// @file test_chara.cpp
/// Tests du systeme de personnages — stats, mouvement, collision, facial, voix.

#include <gtest/gtest.h>

#include "iecode/game/chara/chara_collision.h"
#include "iecode/game/chara/chara_facial.h"
#include "iecode/game/chara/chara_move_ctrl.h"
#include "iecode/game/chara/chara_param.h"
#include "iecode/game/chara/chara_voice.h"

#include <glm/geometric.hpp>

#include <cmath>

// ── CCharaParam ─────────────────────────────────────────────────────

TEST(CharaParam, ComputeStatLevel1) {
    // Au niveau 1, la stat doit etre identique a la base.
    const int16_t result = game::CCharaParam::compute_stat(50, 1.0f, 1);
    EXPECT_EQ(result, 50);
}

TEST(CharaParam, ComputeStatLevel99) {
    // Au niveau 99, la stat doit etre base + base * growth * 98/99.
    const int16_t result = game::CCharaParam::compute_stat(50, 1.0f, 99);
    // 50 + 50 * 1.0 * 98/99 ≈ 50 + 49.49 ≈ 99
    EXPECT_GE(result, 98);
    EXPECT_LE(result, 100);
}

TEST(CharaParam, ComputeStatHighGrowth) {
    // Growth rate 2.0 devrait doubler le bonus.
    const int16_t low  = game::CCharaParam::compute_stat(50, 1.0f, 50);
    const int16_t high = game::CCharaParam::compute_stat(50, 2.0f, 50);
    EXPECT_GT(high, low);
}

TEST(CharaParam, ComputeStatZeroGrowth) {
    // Growth rate 0.0 — la stat ne change pas.
    const int16_t result = game::CCharaParam::compute_stat(50, 0.0f, 99);
    EXPECT_EQ(result, 50);
}

TEST(CharaParam, ComputeStatsAtLevel) {
    game::CCharaParam base;
    base.chara_id = 1;
    base.kick     = 50;
    base.guard    = 40;
    base.catch_   = 30;
    base.body     = 45;
    base.control  = 55;
    base.speed    = 60;
    base.stamina  = 35;
    base.luck     = 20;
    base.level    = 1;
    base.growth_rates = {1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f};

    auto result = base.compute_stats_at_level(50);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->level, 50);
    EXPECT_GT(result->kick, base.kick);
    EXPECT_GT(result->speed, base.speed);
}

TEST(CharaParam, ComputeStatsAtLevelInvalid) {
    game::CCharaParam base;
    auto result = base.compute_stats_at_level(0);
    EXPECT_FALSE(result.has_value());

    result = base.compute_stats_at_level(100);
    EXPECT_FALSE(result.has_value());
}

TEST(CharaParam, TotalStats) {
    game::CCharaParam p;
    p.kick    = 10;
    p.guard   = 20;
    p.catch_  = 30;
    p.body    = 40;
    p.control = 50;
    p.speed   = 60;
    p.stamina = 70;
    p.luck    = 80;
    EXPECT_EQ(p.total_stats(), 360);
}

TEST(CharaParam, EquipPassiveSkill) {
    game::CCharaParam p;
    EXPECT_TRUE(p.equip_passive_skill(100));
    EXPECT_TRUE(p.equip_passive_skill(200));

    // Deja equipee
    EXPECT_FALSE(p.equip_passive_skill(100));

    // Remplir tous les slots
    EXPECT_TRUE(p.equip_passive_skill(300));
    EXPECT_TRUE(p.equip_passive_skill(400));
    EXPECT_TRUE(p.equip_passive_skill(500));

    // Plus de slots libres
    EXPECT_FALSE(p.equip_passive_skill(600));
}

TEST(CharaParam, UnequipPassiveSkill) {
    game::CCharaParam p;
    (void)p.equip_passive_skill(100);
    EXPECT_TRUE(p.unequip_passive_skill(100));
    EXPECT_FALSE(p.unequip_passive_skill(100));  // Deja retiree
}

TEST(CharaParam, EquipActiveSkill) {
    game::CCharaParam p;
    EXPECT_TRUE(p.equip_active_skill(1000));

    // ID 0 invalide
    EXPECT_FALSE(p.equip_active_skill(0));

    // Deja equipee
    EXPECT_FALSE(p.equip_active_skill(1000));
}

// ── CCharaMoveCtrl ──────────────────────────────────────────────────

TEST(CharaMoveCtrl, InitialState) {
    game::CCharaMoveCtrl ctrl;
    EXPECT_EQ(ctrl.anim_state_, game::MoveAnimState::Idle);
    EXPECT_FALSE(ctrl.is_moving_);
    EXPECT_TRUE(ctrl.has_reached_destination());
}

TEST(CharaMoveCtrl, MoveTo) {
    game::CCharaMoveCtrl ctrl;
    ctrl.move_to({10.f, 0.f, 0.f});
    EXPECT_TRUE(ctrl.has_target_);

    // Simuler quelques frames
    for (int i = 0; i < 100; ++i) {
        ctrl.update(0.016f);
    }

    // Le personnage doit s'etre deplace vers la cible
    EXPECT_GT(ctrl.position_.x, 0.f);
}

TEST(CharaMoveCtrl, Stop) {
    game::CCharaMoveCtrl ctrl;
    ctrl.move_to({10.f, 0.f, 0.f});
    ctrl.update(0.016f);
    ctrl.stop();

    EXPECT_FALSE(ctrl.has_target_);
    EXPECT_FALSE(ctrl.is_moving_);
    EXPECT_EQ(ctrl.speed_, 0.f);
    EXPECT_EQ(ctrl.anim_state_, game::MoveAnimState::Idle);
}

TEST(CharaMoveCtrl, WaypointPath) {
    game::CCharaMoveCtrl ctrl;
    std::vector<game::Waypoint> path = {
        {{5.f, 0.f, 0.f}, 0.5f},
        {{10.f, 0.f, 0.f}, 0.5f},
    };
    ctrl.set_path(path);
    EXPECT_TRUE(ctrl.has_target_);
    EXPECT_EQ(ctrl.waypoints_.size(), 2);
}

TEST(CharaMoveCtrl, ComputeAnimState) {
    game::CCharaMoveCtrl ctrl;
    ctrl.act_param_.walk_speed = 3.f;
    ctrl.act_param_.run_speed  = 6.f;

    ctrl.speed_ = 0.f;
    EXPECT_EQ(ctrl.compute_anim_state(), game::MoveAnimState::Idle);

    ctrl.speed_ = 2.f;
    EXPECT_EQ(ctrl.compute_anim_state(), game::MoveAnimState::Walk);

    ctrl.speed_ = 4.f;
    EXPECT_EQ(ctrl.compute_anim_state(), game::MoveAnimState::Run);

    ctrl.speed_ = 8.f;
    EXPECT_EQ(ctrl.compute_anim_state(), game::MoveAnimState::Dash);
}

TEST(CharaMoveCtrl, GravityFalling) {
    game::CCharaMoveCtrl ctrl;
    ctrl.position_ = {0.f, 5.f, 0.f};
    ctrl.is_grounded_ = false;

    // Simuler la chute
    for (int i = 0; i < 200; ++i) {
        ctrl.update(0.016f);
    }

    // Le personnage doit avoir atterri (y = 0)
    EXPECT_FLOAT_EQ(ctrl.position_.y, 0.f);
    EXPECT_TRUE(ctrl.is_grounded_);
}

// ── CCharaCollision ─────────────────────────────────────────────────

TEST(CharaCollision, SphereSphereHit) {
    const glm::vec3 pos_a = {0.f, 0.f, 0.f};
    const glm::vec3 pos_b = {0.5f, 0.f, 0.f};
    const float radius = 0.5f;

    auto result = game::CCharaCollision::test_sphere_sphere(1, pos_a, radius, 2, pos_b, radius);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->other_chara_id, 2);
    EXPECT_GT(result->penetration, 0.f);
}

TEST(CharaCollision, SphereSphereNoHit) {
    const glm::vec3 pos_a = {0.f, 0.f, 0.f};
    const glm::vec3 pos_b = {5.f, 0.f, 0.f};
    const float radius = 0.5f;

    auto result = game::CCharaCollision::test_sphere_sphere(1, pos_a, radius, 2, pos_b, radius);
    EXPECT_FALSE(result.has_value());
}

TEST(CharaCollision, CapsuleCapsuleHit) {
    game::CollisionCapsule a;
    a.base_position = {0.f, 0.f, 0.f};
    a.radius = 0.3f;
    a.height = 1.8f;

    game::CollisionCapsule b;
    b.base_position = {0.4f, 0.f, 0.f};
    b.radius = 0.3f;
    b.height = 1.8f;

    auto result = game::CCharaCollision::test_capsule_capsule(1, a, 2, b);
    ASSERT_TRUE(result.has_value());
    EXPECT_GT(result->penetration, 0.f);
}

TEST(CharaCollision, CapsuleCapsuleNoVerticalOverlap) {
    game::CollisionCapsule a;
    a.base_position = {0.f, 0.f, 0.f};
    a.radius = 0.3f;
    a.height = 1.8f;

    game::CollisionCapsule b;
    b.base_position = {0.4f, 5.f, 0.f};  // Trop haut
    b.radius = 0.3f;
    b.height = 1.8f;

    auto result = game::CCharaCollision::test_capsule_capsule(1, a, 2, b);
    EXPECT_FALSE(result.has_value());
}

TEST(CharaCollision, PointInRect) {
    const glm::vec3 rect_min = {-1.f, -1.f, -1.f};
    const glm::vec3 rect_max = {1.f, 1.f, 1.f};

    EXPECT_TRUE(game::CCharaCollision::point_in_rect({0.f, 0.f, 0.f}, rect_min, rect_max));
    EXPECT_FALSE(game::CCharaCollision::point_in_rect({2.f, 0.f, 0.f}, rect_min, rect_max));
}

TEST(CharaCollision, LayersOverlap) {
    EXPECT_TRUE(game::CCharaCollision::layers_overlap(
        static_cast<uint32_t>(game::CollisionLayer::PLAYER),
        static_cast<uint32_t>(game::CollisionLayer::ALL)));

    EXPECT_FALSE(game::CCharaCollision::layers_overlap(
        static_cast<uint32_t>(game::CollisionLayer::PLAYER),
        static_cast<uint32_t>(game::CollisionLayer::BALL)));
}

TEST(CharaCollision, CapsuleCenter) {
    game::CollisionCapsule cap;
    cap.base_position = {0.f, 0.f, 0.f};
    cap.height = 2.f;
    const auto center = cap.center();
    EXPECT_FLOAT_EQ(center.y, 1.f);
}

// ── CCharaFacial ────────────────────────────────────────────────────

TEST(CharaFacial, DefaultExpression) {
    game::CCharaFacial facial;
    EXPECT_EQ(facial.current_expression_, game::FacialExpression::Neutral);
}

TEST(CharaFacial, SetExpression) {
    game::CCharaFacial facial;

    // Configurer des presets
    std::array<game::FacialExpressionPreset, 8> presets = {};
    presets[static_cast<uint8_t>(game::FacialExpression::Happy)].weights[0] = 1.f;
    presets[static_cast<uint8_t>(game::FacialExpression::Happy)].weights[1] = 0.5f;
    facial.set_presets(presets);

    facial.set_expression(game::FacialExpression::Happy);
    EXPECT_TRUE(facial.is_transitioning());

    // Simuler la transition complete
    for (int i = 0; i < 100; ++i) {
        facial.update(0.016f);
    }

    EXPECT_EQ(facial.current_expression_, game::FacialExpression::Happy);
    EXPECT_NEAR(facial.blend_weights_[0], 1.f, 0.01f);
    EXPECT_NEAR(facial.blend_weights_[1], 0.5f, 0.01f);
}

TEST(CharaFacial, TransitionSmooth) {
    game::CCharaFacial facial;

    std::array<game::FacialExpressionPreset, 8> presets = {};
    presets[static_cast<uint8_t>(game::FacialExpression::Happy)].weights[0] = 1.f;
    facial.set_presets(presets);

    facial.set_expression(game::FacialExpression::Happy, 1.f);  // 1 seconde

    // A mi-chemin, le poids doit etre ~0.5
    facial.update(0.5f);
    EXPECT_NEAR(facial.blend_weights_[0], 0.5f, 0.05f);
}

TEST(CharaFacial, NoTransitionIfSameExpression) {
    game::CCharaFacial facial;
    facial.set_expression(game::FacialExpression::Neutral);
    // Pas de changement → pas de transition
    EXPECT_FALSE(facial.is_transitioning());
}

TEST(CharaFacial, GetBlendWeight) {
    game::CCharaFacial facial;
    facial.blend_weights_[5] = 0.75f;
    EXPECT_FLOAT_EQ(facial.get_blend_weight(5), 0.75f);
    EXPECT_FLOAT_EQ(facial.get_blend_weight(999), 0.f);  // Hors limites
}

// ── CCharaVoice ─────────────────────────────────────────────────────

TEST(CharaVoice, PlayAndStop) {
    game::CCharaVoice voice;
    voice.set_cue_mapping(game::VoiceTrigger::Shoot, 100, 1.f);

    int32_t slot = voice.play(game::VoiceTrigger::Shoot);
    EXPECT_GE(slot, 0);
    EXPECT_TRUE(voice.is_playing());
    EXPECT_EQ(voice.active_count(), 1u);

    voice.stop_all();
    EXPECT_FALSE(voice.is_playing());
    EXPECT_EQ(voice.active_count(), 0u);
}

TEST(CharaVoice, MultipleCues) {
    game::CCharaVoice voice;
    voice.set_cue_mapping(game::VoiceTrigger::Shoot, 100, 1.f);
    voice.set_cue_mapping(game::VoiceTrigger::Goal, 200, 2.f);

    voice.play(game::VoiceTrigger::Shoot);
    voice.play(game::VoiceTrigger::Goal);
    EXPECT_EQ(voice.active_count(), 2u);
}

TEST(CharaVoice, MaxSlots) {
    game::CCharaVoice voice;
    for (uint8_t i = 1; i <= 12; ++i) {
        voice.set_cue_mapping(static_cast<game::VoiceTrigger>(i), 100 + i, 10.f);
    }

    // Remplir les 4 slots
    for (uint8_t i = 1; i <= 4; ++i) {
        EXPECT_GE(voice.play(static_cast<game::VoiceTrigger>(i)), 0);
    }

    // Le 5e devrait echouer
    EXPECT_EQ(voice.play(static_cast<game::VoiceTrigger>(5)), -1);
}

TEST(CharaVoice, UpdateExpiresCues) {
    game::CCharaVoice voice;
    voice.set_cue_mapping(game::VoiceTrigger::Shoot, 100, 0.5f);

    voice.play(game::VoiceTrigger::Shoot);
    EXPECT_TRUE(voice.is_playing());

    // Simuler 1 seconde (le cue dure 0.5s)
    voice.update(1.f);
    EXPECT_FALSE(voice.is_playing());
}

TEST(CharaVoice, PlayNoneTrigger) {
    game::CCharaVoice voice;
    EXPECT_EQ(voice.play(game::VoiceTrigger::None), -1);
}

TEST(CharaVoice, PlayUnconfiguredTrigger) {
    game::CCharaVoice voice;
    // Aucun mapping configure → cue_id = 0 → retourne -1
    EXPECT_EQ(voice.play(game::VoiceTrigger::Shoot), -1);
}
