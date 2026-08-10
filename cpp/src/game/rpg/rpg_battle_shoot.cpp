/// @file rpg_battle_shoot.cpp
/// Implementation de CRpgBattleShootTurnManager — combat de type tir.
/// Le plus courant des mini-jeux RPG. Le joueur vise et tire au but.
/// Degats : kick_power vs keeper_catch avec bonus elementaire.

#include "iecode/game/rpg/rpg_battle_shoot.h"

#include <spdlog/spdlog.h>

#include <cmath>

namespace game {

void CRpgBattleShootTurnManager::on_turn_start() {
    turn_finished_ = false;
    player_won_    = false;
    is_charging_   = false;
    charge_time_   = 0.f;
    damage_result_ = 0;
    shot_on_target_ = false;

    spdlog::info("[Shoot] Tour {} demarre (kick={}, catch={})",
                 turn_number_, kick_power_, keeper_catch_);
}

void CRpgBattleShootTurnManager::update(float dt) {
    if (turn_finished_) {
        return;
    }

    turn_timer_ += dt;

    // Phase de charge — le joueur maintient le bouton
    if (is_charging_) {
        charge_time_ += dt;
        // La puissance augmente avec le temps de charge
        shoot_power_ = std::min(charge_time_ / max_charge_, 1.f);
    }
}

void CRpgBattleShootTurnManager::on_turn_end() {
    turn_finished_ = true;

    spdlog::info("[Shoot] Tour {} termine — {} (degats={})",
                 turn_number_,
                 player_won_ ? "BUT !" : "arrete",
                 damage_result_);
}

void CRpgBattleShootTurnManager::evaluate_shot() {
    // Distance entre la visee et la zone du gardien
    float dx = aim_x_ - keeper_zone_x_;
    float dy = aim_y_ - keeper_zone_y_;
    float aim_distance = std::sqrt(dx * dx + dy * dy);

    // Le tir est cadre si la visee est dans [-1, 1] sur les deux axes
    shot_on_target_ = (std::abs(aim_x_) <= 1.f && std::abs(aim_y_) <= 1.f);

    if (!shot_on_target_) {
        // Tir non cadre — pas de but
        player_won_ = false;
        damage_result_ = 0;
        turn_finished_ = true;
        return;
    }

    // Calcul de degats : kick * precision * puissance vs catch du gardien
    float effective_power = static_cast<float>(kick_power_)
                          * shoot_accuracy_
                          * shoot_power_;
    auto power_u32 = static_cast<uint32_t>(std::round(effective_power));

    damage_result_ = calculate_damage(
        power_u32, keeper_catch_,
        shooter_element_, keeper_element_);

    // Le gardien arrete si le tir est trop pres de sa zone
    // Seuil : distance > 0.3 pour marquer (sinon arrete)
    player_won_ = (aim_distance > 0.3f) && (damage_result_ > keeper_catch_ / 2);

    turn_finished_ = true;
}

} // namespace game
