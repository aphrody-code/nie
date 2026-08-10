/// @file test_scene_soccer.cpp
/// Tests Phase 4 — SceneSoccer (init 22 joueurs, gravite balle, but).

#include "iecode/engine/ecs/scene.h"
#include "iecode/game/soccer/scene_soccer.h"

#include <gtest/gtest.h>

TEST(SceneSoccer, Init22Players) {
    lives::ecs::Scene scene;
    game::SceneSoccer match;
    match.init(scene);

    EXPECT_EQ(match.players().size(), 22u);
    EXPECT_NE(match.ball(), nullptr);
    EXPECT_TRUE(match.match_active_);
    EXPECT_EQ(match.score_home_, 0);
    EXPECT_EQ(match.score_away_, 0);

    // Verifie repartition des equipes.
    int home = 0;
    int away = 0;
    for (auto* p : match.players()) {
        if (p->team_id_ == 0) ++home;
        else if (p->team_id_ == 1) ++away;
    }
    EXPECT_EQ(home, 11);
    EXPECT_EQ(away, 11);
}

TEST(SceneSoccer, BallGravity) {
    lives::ecs::Scene scene;
    game::SceneSoccer match;
    match.init(scene);

    auto* ball = match.ball();
    ASSERT_NE(ball, nullptr);

    // Place la balle en altitude.
    ball->reset_at({0.f, 5.f, 0.f});
    const float y0 = ball->position_.y;

    ball->update_physics(1.0f / 60.0f);

    // La gravite (2.0f par frame) doit avoir applique une velocite negative.
    EXPECT_LT(ball->velocity_.y, 0.f);
    // La position doit avoir baisse.
    EXPECT_LT(ball->position_.y, y0);
}

TEST(SceneSoccer, GoalDetection) {
    lives::ecs::Scene scene;
    game::SceneSoccer match;
    match.init(scene);

    auto* ball = match.ball();
    ASSERT_NE(ball, nullptr);

    // Ballon dans le but cote home (x = -51, dans la cage).
    ball->position_ = {-51.f, 0.f, 0.f};
    ball->velocity_ = {0.f, 0.f, 0.f};

    const int score_away_before = match.score_away_;
    match.handle_goal();

    EXPECT_EQ(match.score_away_, score_away_before + 1);
    // Apres le but, la balle est replacee au centre.
    EXPECT_FLOAT_EQ(ball->position_.x, 0.f);
    EXPECT_FLOAT_EQ(ball->position_.z, 0.f);
}

TEST(SceneSoccer, GoalHomeScores) {
    lives::ecs::Scene scene;
    game::SceneSoccer match;
    match.init(scene);

    auto* ball = match.ball();
    ASSERT_NE(ball, nullptr);

    ball->position_ = {51.f, 0.f, 1.f};
    const int score_home_before = match.score_home_;
    match.handle_goal();

    EXPECT_EQ(match.score_home_, score_home_before + 1);
}
