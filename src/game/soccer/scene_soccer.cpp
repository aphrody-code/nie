/// @file scene_soccer.cpp
/// Implementation de SceneSoccer — match 11v11.

#include "iecode/game/soccer/scene_soccer.h"

#include "iecode/engine/ecs/actor.h"

#include <spdlog/spdlog.h>

#include <array>
#include <cmath>
#include <string>

namespace game {

namespace {

/// Composant balle (wrapper ECS).
struct BallComponentECS : lives::ecs::Component {
    BallComponent ball;
    void on_update(float dt) override { ball.update_physics(dt); }
    [[nodiscard]] std::string_view component_name() const override {
        return "BallComponentECS";
    }
};

/// Formation 4-4-2 : 11 positions (x, z) sur la moitie de terrain
/// du cote home (x negatif). L'equipe away est miroir.
constexpr std::array<std::pair<float, float>, 11> FORMATION_442 = {{
    {-45.f,   0.f}, // GK
    {-30.f, -20.f}, // DL
    {-30.f,  -7.f}, // DCL
    {-30.f,   7.f}, // DCR
    {-30.f,  20.f}, // DR
    {-15.f, -20.f}, // ML
    {-15.f,  -7.f}, // MCL
    {-15.f,   7.f}, // MCR
    {-15.f,  20.f}, // MR
    { -5.f,  -8.f}, // FL
    { -5.f,   8.f}, // FR
}};

} // namespace

void SceneSoccer::init(lives::ecs::Scene& scene) {
    scene_ = &scene;
    players_.clear();
    players_.reserve(22);

    // Configurer les controleurs AI : home tape vers x=+50, away vers x=-50.
    ai_home_.target_goal_x_ = +SOCCER_FIELD_HALF_LENGTH;
    ai_away_.target_goal_x_ = -SOCCER_FIELD_HALF_LENGTH;

    // Creer la balle au centre.
    auto& ball_actor = scene.create_actor("Ball");
    ball_actor.set_tag("ball");
    auto& ball_comp = ball_actor.add_component<BallComponentECS>();
    ball_comp.ball.reset_at({0.f, 0.f, 0.f});
    ball_ = &ball_comp.ball;

    // Creer les 11 joueurs home (x negatif).
    for (uint32_t i = 0; i < 11; ++i) {
        auto& actor = scene.create_actor("PlayerHome_" + std::to_string(i));
        actor.set_tag("soccer_player");
        auto& comp = actor.add_component<SoccerPlayerComponent>();
        comp.player_id_ = i;
        comp.team_id_ = 0;
        comp.position_ = {FORMATION_442[i].first, 0.f, FORMATION_442[i].second};
        actor.transform().position = comp.position_;
        players_.push_back(&comp);
    }

    // Creer les 11 joueurs away (miroir x).
    for (uint32_t i = 0; i < 11; ++i) {
        auto& actor = scene.create_actor("PlayerAway_" + std::to_string(i));
        actor.set_tag("soccer_player");
        auto& comp = actor.add_component<SoccerPlayerComponent>();
        comp.player_id_ = 100 + i;
        comp.team_id_ = 1;
        comp.position_ = {-FORMATION_442[i].first, 0.f, -FORMATION_442[i].second};
        actor.transform().position = comp.position_;
        players_.push_back(&comp);
    }

    match_active_ = true;
    match_time_ = 0.f;
    score_home_ = 0;
    score_away_ = 0;

    spdlog::info("SceneSoccer: match initialise (22 joueurs, balle au centre)");
}

void SceneSoccer::update(float dt) {
    if (!match_active_ || ball_ == nullptr) {
        return;
    }

    // Le timer match avance independamment des updates ECS pour permettre
    // une simulation pilotee meme sans Scene::update.
    match_time_ += dt;
    if (match_time_ >= SOCCER_MATCH_DURATION) {
        match_active_ = false;
    }

    // Mise a jour AI : les composants ECS ne sont pas copiables, on
    // applique l'AI joueur par joueur en construisant un pseudo-span d'un
    // seul element. La logique d'AI accepte un span de taille variable.
    if (players_.size() >= 22) {
        for (size_t i = 0; i < 11; ++i) {
            ai_home_.update_team(dt, *ball_,
                std::span<SoccerPlayerComponent>{players_[i], 1});
        }
        for (size_t i = 11; i < 22; ++i) {
            ai_away_.update_team(dt, *ball_,
                std::span<SoccerPlayerComponent>{players_[i], 1});
        }
    }

    // Physique de la balle.
    ball_->update_physics(dt);

    // Detection de but.
    handle_goal();
}

void SceneSoccer::handle_goal() {
    if (ball_ == nullptr) {
        return;
    }

    const float bx = ball_->position_.x;
    const float bz = ball_->position_.z;

    // But cote away (home a marque) — x > +50 et z dans la cage.
    if (bx >= SOCCER_FIELD_HALF_LENGTH && std::abs(bz) <= SOCCER_GOAL_HALF_WIDTH) {
        ++score_home_;
        spdlog::info("SceneSoccer: BUT home ! Score = {} - {}", score_home_, score_away_);
        ball_->reset_at({0.f, 0.f, 0.f});
        return;
    }

    // But cote home (away a marque) — x < -50 et z dans la cage.
    if (bx <= -SOCCER_FIELD_HALF_LENGTH && std::abs(bz) <= SOCCER_GOAL_HALF_WIDTH) {
        ++score_away_;
        spdlog::info("SceneSoccer: BUT away ! Score = {} - {}", score_home_, score_away_);
        ball_->reset_at({0.f, 0.f, 0.f});
        return;
    }
}

} // namespace game
