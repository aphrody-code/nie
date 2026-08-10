/// @file menu_controls.cpp
/// Implementation des widgets de controle menu game:: —
/// compteurs, faders, animations, gradients.

#include "iecode/game/ui/menu_controls.h"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cmath>

namespace game {

// ============================================================================
// CMenuNumRoll
// ============================================================================

void CMenuNumRoll::set_value(int32_t value) {
    target_value_ = value;
    rolling_ = (static_cast<int32_t>(display_value_) != target_value_);
    spdlog::trace("CMenuNumRoll::set_value — target={}", target_value_);
}

void CMenuNumRoll::set_value_immediate(int32_t value) {
    target_value_ = value;
    display_value_ = static_cast<float>(value);
    rolling_ = false;
}

void CMenuNumRoll::update(float dt) {
    if (!rolling_) return;

    const float target = static_cast<float>(target_value_);
    const float diff = target - display_value_;

    if (std::abs(diff) < 0.5f) {
        display_value_ = target;
        rolling_ = false;
        return;
    }

    // Approche proportionnelle pour un defilement fluide.
    // Vitesse minimale garantie pour ne pas rester bloque.
    const float sign = (diff > 0.f) ? 1.f : -1.f;
    const float speed = std::max(roll_speed_, std::abs(diff) * 3.f);
    display_value_ += sign * speed * dt;

    // Ne pas depasser la cible.
    if ((sign > 0.f && display_value_ > target) ||
        (sign < 0.f && display_value_ < target)) {
        display_value_ = target;
        rolling_ = false;
    }
}

void CMenuNumRoll::draw() {
    // TODO: rendu de chaque chiffre avec offset vertical pour l'effet odometre.
    // Chaque chiffre est un sprite defilant dans un slot.
}

// ============================================================================
// CMenuCountUpCtrl
// ============================================================================

void CMenuCountUpCtrl::start(int32_t from, int32_t to, float duration, uint32_t easing) {
    start_value_ = from;
    end_value_ = to;
    current_value_ = from;
    duration_ = duration;
    easing_ = easing;
    timer_ = 0.f;
    counting_ = true;
    finished_ = false;
    spdlog::trace("CMenuCountUpCtrl::start — from={} to={} duration={:.2f}s",
                  from, to, duration);
}

void CMenuCountUpCtrl::update(float dt) {
    if (!counting_ || finished_) return;

    timer_ += dt;
    float t = (duration_ > 0.f) ? (timer_ / duration_) : 1.f;
    if (t >= 1.f) {
        t = 1.f;
        counting_ = false;
        finished_ = true;
    }

    const float eased_t = apply_easing(t);
    const float range = static_cast<float>(end_value_ - start_value_);
    current_value_ = start_value_ + static_cast<int32_t>(range * eased_t);
}

void CMenuCountUpCtrl::skip() {
    current_value_ = end_value_;
    counting_ = false;
    finished_ = true;
}

void CMenuCountUpCtrl::reset() {
    current_value_ = start_value_;
    timer_ = 0.f;
    counting_ = false;
    finished_ = false;
}

float CMenuCountUpCtrl::apply_easing(float t) const {
    switch (easing_) {
        case 0: // Lineaire.
            return t;
        case 1: // Ease in (quadratique).
            return t * t;
        case 2: // Ease out (quadratique).
            return t * (2.f - t);
        case 3: // Ease in-out (quadratique).
            return (t < 0.5f) ? (2.f * t * t) : (-1.f + (4.f - 2.f * t) * t);
        default:
            return t;
    }
}

// ============================================================================
// CMenuRefModelFadeCtrl
// ============================================================================

void CMenuRefModelFadeCtrl::fade_in(float speed) {
    target_opacity_ = 1.f;
    fade_speed_ = speed;
    fading_ = true;
    spdlog::trace("CMenuRefModelFadeCtrl::fade_in — speed={:.1f}", speed);
}

void CMenuRefModelFadeCtrl::fade_out(float speed) {
    target_opacity_ = 0.f;
    fade_speed_ = speed;
    fading_ = true;
    spdlog::trace("CMenuRefModelFadeCtrl::fade_out — speed={:.1f}", speed);
}

void CMenuRefModelFadeCtrl::update(float dt) {
    if (!fading_) return;

    const float diff = target_opacity_ - opacity_;
    if (std::abs(diff) < 0.001f) {
        opacity_ = target_opacity_;
        fading_ = false;
        return;
    }

    const float sign = (diff > 0.f) ? 1.f : -1.f;
    opacity_ += sign * fade_speed_ * dt;

    // Clamper entre 0 et 1.
    if (opacity_ < 0.f) opacity_ = 0.f;
    if (opacity_ > 1.f) opacity_ = 1.f;

    // Verifier si on a atteint la cible.
    if ((sign > 0.f && opacity_ >= target_opacity_) ||
        (sign < 0.f && opacity_ <= target_opacity_)) {
        opacity_ = target_opacity_;
        fading_ = false;
    }
}

// ============================================================================
// CMenuLayerAnim
// ============================================================================

void CMenuLayerAnim::play(uint32_t layer_id, uint32_t mode) {
    layer_id_ = layer_id;
    play_mode_ = mode;
    playing_ = true;
    if (animation_) {
        animation_->current_time_ = 0.f;
        animation_->playing_ = true;
        animation_->looping_ = (mode == 1);
    }
    spdlog::trace("CMenuLayerAnim::play — layer={}, mode={}", layer_id, mode);
}

void CMenuLayerAnim::stop() {
    playing_ = false;
    if (animation_) {
        animation_->playing_ = false;
    }
}

void CMenuLayerAnim::update(float dt) {
    if (!playing_ || !animation_) return;

    animation_->current_time_ += dt;

    if (animation_->is_finished()) {
        switch (play_mode_) {
            case 0: // Once.
                playing_ = false;
                break;
            case 1: // Loop — gere par CMenuAnimation::looping_.
                break;
            case 2: // Ping-pong.
                // Inverse start_value et end_value si CMenuSimpleAnimation.
                // Pour l'instant, on boucle simplement.
                animation_->current_time_ = 0.f;
                break;
            default:
                playing_ = false;
                break;
        }
    }
}

// ============================================================================
// CMenuDotCharaAnim
// ============================================================================

void CMenuDotCharaAnim::load(uint32_t chara_id) {
    chara_id_ = chara_id;
    current_frame_ = 0;
    frame_timer_ = 0.f;
    // TODO: charger les sprites dot/pixel du personnage.
    spdlog::debug("CMenuDotCharaAnim::load — chara_id={}", chara_id);
}

void CMenuDotCharaAnim::play() {
    playing_ = true;
    current_frame_ = 0;
    frame_timer_ = 0.f;
}

void CMenuDotCharaAnim::stop() {
    playing_ = false;
}

void CMenuDotCharaAnim::update(float dt) {
    if (!playing_) return;

    frame_timer_ += dt;
    while (frame_timer_ >= frame_duration_ && frame_duration_ > 0.f) {
        frame_timer_ -= frame_duration_;
        current_frame_++;
        if (current_frame_ >= total_frames_) {
            if (looping_) {
                current_frame_ = 0;
            } else {
                current_frame_ = total_frames_ - 1;
                playing_ = false;
                break;
            }
        }
    }
}

void CMenuDotCharaAnim::draw() {
    // TODO: rendu du sprite de la frame courante.
}

// ============================================================================
// MenuAnimationLink
// ============================================================================

void MenuAnimationLink::add(lives::CMenuAnimation* anim, float delay) {
    chain_.push_back({anim, delay});
}

void MenuAnimationLink::start() {
    current_index_ = 0;
    delay_timer_ = 0.f;
    running_ = !chain_.empty();
    spdlog::trace("MenuAnimationLink::start — chain size={}", chain_.size());
}

void MenuAnimationLink::update(float dt) {
    if (!running_ || chain_.empty()) return;
    if (current_index_ >= chain_.size()) {
        running_ = false;
        return;
    }

    auto& entry = chain_[current_index_];

    // Phase de delai.
    if (delay_timer_ < entry.delay) {
        delay_timer_ += dt;
        return;
    }

    // Demarrer l'animation si pas encore jouee.
    if (entry.animation && !entry.animation->playing_) {
        entry.animation->playing_ = true;
        entry.animation->current_time_ = 0.f;
    }

    // Verifier si l'animation est terminee.
    if (entry.animation && entry.animation->is_finished()) {
        current_index_++;
        delay_timer_ = 0.f;
        if (current_index_ >= chain_.size()) {
            running_ = false;
        }
    }
}

void MenuAnimationLink::reset() {
    current_index_ = 0;
    delay_timer_ = 0.f;
    running_ = false;
    for (auto& entry : chain_) {
        if (entry.animation) {
            entry.animation->current_time_ = 0.f;
            entry.animation->playing_ = false;
        }
    }
}

bool MenuAnimationLink::is_finished() const {
    return !running_ && current_index_ >= chain_.size();
}

// ============================================================================
// MenuMaterialColorGradation
// ============================================================================

void MenuMaterialColorGradation::add_stop(const glm::vec4& color) {
    color_stops_.push_back(color);
}

void MenuMaterialColorGradation::clear_stops() {
    color_stops_.clear();
    progress_ = 0.f;
}

void MenuMaterialColorGradation::start() {
    active_ = true;
    progress_ = 0.f;
}

void MenuMaterialColorGradation::stop() {
    active_ = false;
}

void MenuMaterialColorGradation::update(float dt) {
    if (!active_ || color_stops_.size() < 2) return;

    progress_ += dt * speed_;

    if (progress_ >= 1.f) {
        if (looping_) {
            progress_ -= std::floor(progress_);
        } else {
            progress_ = 1.f;
            active_ = false;
        }
    }

    // Interpolation entre les stops.
    const auto segment_count = static_cast<float>(color_stops_.size() - 1);
    const float scaled = progress_ * segment_count;
    const auto idx = static_cast<uint32_t>(scaled);
    const float frac = scaled - static_cast<float>(idx);

    const uint32_t i0 = std::min(idx, static_cast<uint32_t>(color_stops_.size() - 1));
    const uint32_t i1 = std::min(idx + 1, static_cast<uint32_t>(color_stops_.size() - 1));

    current_color_ = color_stops_[i0] + (color_stops_[i1] - color_stops_[i0]) * frac;
}

} // namespace game
