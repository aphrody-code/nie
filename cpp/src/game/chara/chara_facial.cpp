/// @file chara_facial.cpp
/// Implementation de CCharaFacial — transitions de blend shapes entre expressions.

#include "iecode/game/chara/chara_facial.h"

#include <algorithm>
#include <cmath>

namespace game {

void CCharaFacial::update(float dt) {
    if (dt <= 0.f) {
        return;
    }

    // Pas de transition necessaire
    if (current_expression_ == target_expression_ && transition_elapsed_ >= transition_time_) {
        return;
    }

    // Avancer la transition
    transition_elapsed_ += dt;
    const float t = std::clamp(transition_elapsed_ / transition_time_, 0.f, 1.f);

    // Interpolation lineaire des poids de blend shapes
    if (presets_loaded_) {
        const auto& target_weights = presets_[static_cast<uint8_t>(target_expression_)].weights;
        for (uint32_t i = 0; i < MAX_FACIAL_BLEND_SHAPES; ++i) {
            blend_weights_[i] = source_weights_[i] + (target_weights[i] - source_weights_[i]) * t;
        }
    }

    // Transition terminee
    if (t >= 1.f) {
        current_expression_ = target_expression_;
    }
}

void CCharaFacial::set_expression(FacialExpression expr) {
    set_expression(expr, transition_time_);
}

void CCharaFacial::set_expression(FacialExpression expr, float transition_sec) {
    if (expr == target_expression_) {
        return;
    }

    target_expression_ = expr;
    transition_time_ = std::max(transition_sec, 0.001f);  // Eviter division par zero
    transition_elapsed_ = 0.f;

    // Sauvegarder les poids actuels comme source de la transition
    source_weights_ = blend_weights_;
}

bool CCharaFacial::is_transitioning() const {
    // Pas de transition si l'expression cible est deja l'expression courante.
    return current_expression_ != target_expression_;
}

float CCharaFacial::get_blend_weight(uint32_t index) const {
    if (index >= MAX_FACIAL_BLEND_SHAPES) {
        return 0.f;
    }
    return blend_weights_[index];
}

void CCharaFacial::set_presets(const std::array<FacialExpressionPreset, 8>& presets) {
    presets_ = presets;
    presets_loaded_ = true;
}

} // namespace game
