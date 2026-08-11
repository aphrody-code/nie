/// @file ball_move.cpp
/// Implementation des 10 types de mouvement de balle.
/// Chaque type derive de IBallMoveController et implemente update/is_finished.

#include "iecode/game/soccer/ball_move.h"
#include "iecode/game/soccer/ball_component.h"

#include <glm/geometric.hpp>
#include <algorithm>
#include <cmath>

namespace game {

// ── BallMoveNormal ──────────────────────────────────────────────────────
// Physique simple : gravite + friction + rebond au sol.

void BallMoveNormal::update(float dt) {
    elapsed_ += dt;

    // Si la balle est deja au repos au sol, ne rien faire (mouvement termine).
    const float horiz_sq = velocity_.x * velocity_.x + velocity_.z * velocity_.z;
    if (position_.y <= 0.f && std::abs(velocity_.y) < 1e-3f && horiz_sq < 1e-4f) {
        position_.y = 0.f;
        velocity_   = {0.f, 0.f, 0.f};
        return;
    }

    // Gravite (par frame, convention nie.exe a 60Hz).
    velocity_.y -= gravity_;

    // Deplacement
    position_ += velocity_ * dt;

    // Rebond au sol
    if (position_.y < 0.f) {
        position_.y = 0.f;
        velocity_.y = -velocity_.y * bounce_;

        if (std::abs(velocity_.y) < 0.1f) {
            velocity_.y = 0.f;
        }

        // Friction horizontale au sol
        velocity_.x *= friction_;
        velocity_.z *= friction_;
    }
}

bool BallMoveNormal::is_finished() const {
    // Termine quand la balle est au sol et quasi immobile
    float speed_sq = velocity_.x * velocity_.x
                   + velocity_.y * velocity_.y
                   + velocity_.z * velocity_.z;
    return position_.y <= 0.f && speed_sq < 0.01f;
}

// ── BallMoveBezier ──────────────────────────────────────────────────────
// Courbe de Bezier quadratique : B(t) = (1-t)^2*P0 + 2*(1-t)*t*P1 + t^2*P2.

void BallMoveBezier::update(float dt) {
    elapsed_ += dt;

    float t = std::clamp(elapsed_ / duration_, 0.f, 1.f);
    float u = 1.f - t;

    // Bezier quadratique
    position_ = u * u * start_
              + 2.f * u * t * control_
              + t * t * end_;

    // Vitesse approximee par la derivee
    velocity_ = 2.f * u * (control_ - start_)
              + 2.f * t * (end_ - control_);
}

bool BallMoveBezier::is_finished() const {
    return elapsed_ >= duration_;
}

// ── BallMoveMultiBezier ─────────────────────────────────────────────────
// Sequence de courbes de Bezier (simplifie — un seul segment actif).

void BallMoveMultiBezier::update(float dt) {
    elapsed_ += dt;
    segment_time_ += dt;

    // Avancer au segment suivant si le temps du segment est ecoule
    if (segment_count_ > 0 && current_segment_ < segment_count_) {
        float segment_duration = 1.f; // duree par segment (simplifiee)
        if (segment_time_ >= segment_duration) {
            segment_time_ = 0.f;
            ++current_segment_;
        }
    }
}

bool BallMoveMultiBezier::is_finished() const {
    return segment_count_ == 0 || current_segment_ >= segment_count_;
}

// ── BallMoveDribble ─────────────────────────────────────────────────────
// Suit le joueur avec un leger decalage.

void BallMoveDribble::update(float dt) {
    elapsed_ += dt;

    // La balle suit le possesseur avec un decalage
    glm::vec3 target = owner_position_;
    target.y = height_;

    // Interpolation douce vers la position cible
    constexpr float FOLLOW_SPEED = 15.f;
    glm::vec3 old_pos = position_;
    glm::vec3 diff = target - position_;
    float dist = glm::length(diff);

    if (dist > 0.01f) {
        glm::vec3 dir = diff / dist;
        float move = std::min(FOLLOW_SPEED * dt, dist);
        position_ += dir * move;
    }

    // Vitesse estimee a partir du deplacement effectif
    velocity_ = (dt > 0.f) ? (position_ - old_pos) / dt : glm::vec3{0.f, 0.f, 0.f};
}

bool BallMoveDribble::is_finished() const {
    // Le dribble ne se termine jamais de lui-meme
    return false;
}

// ── BallMoveGoalnet ─────────────────────────────────────────────────────
// La balle entre dans le filet et decelere.

void BallMoveGoalnet::update(float dt) {
    elapsed_ += dt;

    // Deceleration dans le filet
    float speed = glm::length(velocity_);
    if (speed > 0.1f) {
        glm::vec3 dir = velocity_ / speed;
        float new_speed = std::max(0.f, speed - deceleration_ * dt);
        velocity_ = dir * new_speed;
    } else {
        velocity_ = {0.f, 0.f, 0.f};
    }

    position_ += velocity_ * dt;
}

bool BallMoveGoalnet::is_finished() const {
    float speed_sq = velocity_.x * velocity_.x
                   + velocity_.y * velocity_.y
                   + velocity_.z * velocity_.z;
    return speed_sq < 0.01f;
}

// ── BallMoveLerp ────────────────────────────────────────────────────────
// Interpolation lineaire entre deux points.

void BallMoveLerp::update(float dt) {
    elapsed_ += dt;

    float t = std::clamp(elapsed_ / duration_, 0.f, 1.f);
    position_ = start_ + t * (end_ - start_);
    velocity_ = (end_ - start_) / duration_;
}

bool BallMoveLerp::is_finished() const {
    return elapsed_ >= duration_;
}

// ── BallMoveRate ────────────────────────────────────────────────────────
// Vitesse constante dans une direction donnee.

void BallMoveRate::update(float dt) {
    elapsed_ += dt;

    velocity_ = direction_ * speed_;
    position_ += velocity_ * dt;
}

bool BallMoveRate::is_finished() const {
    return elapsed_ >= max_time_;
}

// ── BallMoveRealSkillShootBezier ────────────────────────────────────────
// Bezier cubique pour les tirs speciaux (hissatsu).

void BallMoveRealSkillShootBezier::update(float dt) {
    elapsed_ += dt;

    float t = std::clamp(elapsed_ / duration_, 0.f, 1.f);
    float u = 1.f - t;

    // Bezier cubique : B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
    position_ = u * u * u * start_
              + 3.f * u * u * t * control1_
              + 3.f * u * t * t * control2_
              + t * t * t * end_;

    // Derivee de Bezier cubique pour la vitesse
    velocity_ = 3.f * u * u * (control1_ - start_)
              + 6.f * u * t * (control2_ - control1_)
              + 3.f * t * t * (end_ - control2_);
}

bool BallMoveRealSkillShootBezier::is_finished() const {
    return elapsed_ >= duration_;
}

// ── BallMoveSimpleParabora ──────────────────────────────────────────────
// Trajectoire parabolique simple (arc).

void BallMoveSimpleParabora::update(float dt) {
    elapsed_ += dt;

    float t = std::clamp(elapsed_ / duration_, 0.f, 1.f);

    // Interpolation horizontale lineaire
    position_.x = start_.x + t * (end_.x - start_.x);
    position_.z = start_.z + t * (end_.z - start_.z);

    // Hauteur parabolique : h(t) = 4*H*t*(1-t) pour un max a t=0.5
    float base_y = start_.y + t * (end_.y - start_.y);
    position_.y = base_y + 4.f * height_ * t * (1.f - t);

    // Vitesse approximee
    velocity_ = (end_ - start_) / duration_;
    velocity_.y = 4.f * height_ * (1.f - 2.f * t) / duration_;
}

bool BallMoveSimpleParabora::is_finished() const {
    return elapsed_ >= duration_;
}

// ── BallMoveTargetFollow ────────────────────────────────────────────────
// Suit une cible mobile avec une vitesse donnee.

void BallMoveTargetFollow::update(float dt) {
    elapsed_ += dt;

    glm::vec3 diff = target_pos_ - position_;
    float dist = glm::length(diff);

    if (dist > arrive_dist_) {
        glm::vec3 dir = diff / dist;
        float move = std::min(follow_speed_ * dt, dist);
        position_ += dir * move;
        velocity_ = dir * follow_speed_;
    } else {
        position_ = target_pos_;
        velocity_ = {0.f, 0.f, 0.f};
    }
}

bool BallMoveTargetFollow::is_finished() const {
    float dist = glm::length(target_pos_ - position_);
    return dist <= arrive_dist_;
}

} // namespace game
