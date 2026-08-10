/// @file menu_standalone.cpp
/// Implementation des menus plein ecran autonomes.
/// BeansTradeMenu (complexite 144), AbilityListMenu (55), HistoryCheckMenu.

#include "iecode/game/ui/menu_standalone.h"

#include <spdlog/spdlog.h>
#include <algorithm>

namespace game {

// ============================================================================
// BeansTradeMenu
// ============================================================================

void BeansTradeMenu::on_init() {
    phase_ = Phase::INIT;
    state_machine_.transition(0);
    offer_items_.clear();
    want_items_.clear();
    selected_offer_ = 0;
    selected_want_ = 0;
    trade_success_ = false;
    anim_timer_ = 0.f;

    // TODO: charger les objets echangeables depuis GDSShopConfig.
    // TODO: lire player_beans_ depuis CGDDInventoryConsume.

    phase_ = Phase::SELECT_OFFER;
    is_active_ = true;
    spdlog::debug("BeansTradeMenu::on_init — player_beans={}", player_beans_);
}

void BeansTradeMenu::on_update() {
    if (!is_active_) return;

    // Delta time fixe pour l'instant (1/60s).
    constexpr float DT = 1.f / 60.f;
    update_phase(DT);
}

void BeansTradeMenu::on_draw() {
    if (!is_active_) return;
    // TODO: rendu selon la phase courante.
    // Phase SELECT_OFFER : afficher la liste des objets a offrir.
    // Phase SELECT_WANT : afficher la liste des objets desires.
    // Phase CONFIRM : afficher le recapitulatif de l'echange.
    // Phase ANIMATING : animer l'echange (items qui volent, particules).
    // Phase RESULT : afficher le resultat (succes/echec).
}

void BeansTradeMenu::on_close() {
    is_active_ = false;
    phase_ = Phase::CLOSING;
    spdlog::debug("BeansTradeMenu::on_close");
}

void BeansTradeMenu::advance_phase() {
    switch (phase_) {
        case Phase::INIT:
            phase_ = Phase::SELECT_OFFER;
            break;
        case Phase::SELECT_OFFER:
            phase_ = Phase::SELECT_WANT;
            break;
        case Phase::SELECT_WANT:
            phase_ = Phase::CONFIRM;
            break;
        case Phase::CONFIRM:
            phase_ = Phase::ANIMATING;
            anim_timer_ = 0.f;
            break;
        case Phase::ANIMATING:
            phase_ = Phase::RESULT;
            break;
        case Phase::RESULT:
            phase_ = Phase::CLOSING;
            break;
        case Phase::CLOSING:
            break;
    }
    state_machine_.transition(static_cast<uint32_t>(phase_));
    spdlog::debug("BeansTradeMenu::advance_phase — phase={}", static_cast<uint32_t>(phase_));
}

void BeansTradeMenu::confirm_trade() {
    if (phase_ != Phase::CONFIRM) return;

    // Verifier que le joueur peut payer.
    if (!offer_items_.empty() && selected_offer_ < offer_items_.size()) {
        const auto& offer = offer_items_[selected_offer_];
        if (!can_afford(offer.cost_)) {
            spdlog::info("BeansTradeMenu::confirm_trade — pas assez de haricots ({} < {})",
                         player_beans_, offer.cost_);
            trade_success_ = false;
            phase_ = Phase::RESULT;
            return;
        }
        // TODO: debiter player_beans_ et ajouter l'objet voulu.
        trade_success_ = true;
    } else {
        trade_success_ = false;
    }

    phase_ = Phase::ANIMATING;
    anim_timer_ = 0.f;
    state_machine_.transition(static_cast<uint32_t>(Phase::ANIMATING));
}

void BeansTradeMenu::cancel() {
    switch (phase_) {
        case Phase::SELECT_WANT:
            phase_ = Phase::SELECT_OFFER;
            break;
        case Phase::CONFIRM:
            phase_ = Phase::SELECT_WANT;
            break;
        default:
            phase_ = Phase::CLOSING;
            break;
    }
    state_machine_.transition(static_cast<uint32_t>(phase_));
}

void BeansTradeMenu::update_phase(float dt) {
    switch (phase_) {
        case Phase::INIT:
            break;
        case Phase::SELECT_OFFER:
            // TODO: gerer la navigation dans offer_items_ avec le curseur.
            break;
        case Phase::SELECT_WANT:
            // TODO: gerer la navigation dans want_items_ avec le curseur.
            break;
        case Phase::CONFIRM:
            // Attente de la confirmation ou annulation.
            break;
        case Phase::ANIMATING:
            update_animation(dt);
            break;
        case Phase::RESULT:
            // Attente de la validation du resultat.
            break;
        case Phase::CLOSING:
            is_active_ = false;
            break;
    }
}

void BeansTradeMenu::update_animation(float dt) {
    anim_timer_ += dt;
    if (anim_timer_ >= anim_duration_) {
        advance_phase();
    }
}

// ============================================================================
// AbilityListMenu
// ============================================================================

void AbilityListMenu::on_init() {
    phase_ = Phase::INIT;
    state_machine_.transition(0);
    abilities_.clear();
    filtered_indices_.clear();
    selected_index_ = 0;
    scroll_offset_ = 0;
    filter_type_ = -1;
    sort_mode_ = 0;
    is_active_ = true;

    phase_ = Phase::BROWSING;
    spdlog::debug("AbilityListMenu::on_init — chara_id={}", chara_id_);
}

void AbilityListMenu::on_update() {
    if (!is_active_) return;

    switch (phase_) {
        case Phase::INIT:
            break;
        case Phase::BROWSING:
            // TODO: gerer la navigation dans la liste filtree.
            // Haut/Bas : changer selected_index_.
            // Droite/Gauche : changer le filtre.
            // A/Valider : entrer dans le detail.
            // B/Annuler : fermer le menu.
            break;
        case Phase::DETAIL:
            // TODO: afficher le detail de la competence selectionnee.
            // B/Annuler : retour a la liste.
            break;
        case Phase::FILTERING:
            // TODO: interface de filtre/tri.
            break;
        case Phase::CLOSING:
            is_active_ = false;
            break;
    }
}

void AbilityListMenu::on_draw() {
    if (!is_active_) return;
    // TODO: rendu de la liste de competences avec le filtre et le tri.
}

void AbilityListMenu::on_close() {
    is_active_ = false;
    phase_ = Phase::CLOSING;
    spdlog::debug("AbilityListMenu::on_close");
}

void AbilityListMenu::load_abilities(uint32_t chara_id) {
    chara_id_ = chara_id;
    abilities_.clear();
    // TODO: charger les competences depuis GDSAbilityLearningConfig
    // et CGDDChara pour savoir ce qui est appris/equipe.
    rebuild_filtered_list();
    spdlog::debug("AbilityListMenu::load_abilities — chara_id={}, total={}", chara_id, abilities_.size());
}

void AbilityListMenu::apply_filter(int32_t type) {
    filter_type_ = type;
    rebuild_filtered_list();
    selected_index_ = 0;
    scroll_offset_ = 0;
}

void AbilityListMenu::set_sort_mode(uint32_t mode) {
    sort_mode_ = mode;
    sort_filtered_list();
}

const AbilityListMenu::AbilityEntry* AbilityListMenu::selected_ability() const {
    if (selected_index_ < filtered_indices_.size()) {
        const auto idx = filtered_indices_[selected_index_];
        if (idx < abilities_.size()) {
            return &abilities_[idx];
        }
    }
    return nullptr;
}

void AbilityListMenu::rebuild_filtered_list() {
    filtered_indices_.clear();
    for (uint32_t i = 0; i < abilities_.size(); ++i) {
        if (filter_type_ < 0 || abilities_[i].type_ == static_cast<uint32_t>(filter_type_)) {
            filtered_indices_.push_back(i);
        }
    }
    sort_filtered_list();
}

void AbilityListMenu::sort_filtered_list() {
    std::sort(filtered_indices_.begin(), filtered_indices_.end(),
              [this](uint32_t a, uint32_t b) {
                  const auto& ea = abilities_[a];
                  const auto& eb = abilities_[b];
                  switch (sort_mode_) {
                      case 0: return ea.name_ < eb.name_;
                      case 1: return ea.type_ < eb.type_;
                      case 2: return ea.level_ > eb.level_; // Niveau descendant.
                      case 3: return ea.cost_ < eb.cost_;
                      default: return a < b;
                  }
              });
}

// ============================================================================
// HistoryCheckMenu
// ============================================================================

void HistoryCheckMenu::on_init() {
    phase_ = Phase::INIT;
    state_machine_.transition(0);
    records_.clear();
    selected_index_ = 0;
    scroll_offset_ = 0;
    is_active_ = true;

    load_history();
    phase_ = Phase::LIST;
    spdlog::debug("HistoryCheckMenu::on_init — {} records", records_.size());
}

void HistoryCheckMenu::on_update() {
    if (!is_active_) return;

    switch (phase_) {
        case Phase::INIT:
            break;
        case Phase::LIST:
            // TODO: gerer la navigation dans la liste.
            // Haut/Bas : changer selected_index_.
            // A/Valider : entrer dans le detail.
            // B/Annuler : fermer.
            break;
        case Phase::DETAIL:
            // TODO: afficher le detail du match selectionne.
            // B/Annuler : retour a la liste.
            break;
        case Phase::CLOSING:
            is_active_ = false;
            break;
    }
}

void HistoryCheckMenu::on_draw() {
    if (!is_active_) return;
    // TODO: rendu de la liste de matchs ou du detail.
}

void HistoryCheckMenu::on_close() {
    is_active_ = false;
    phase_ = Phase::CLOSING;
    spdlog::debug("HistoryCheckMenu::on_close");
}

void HistoryCheckMenu::load_history() {
    records_.clear();
    // TODO: charger l'historique depuis CGDDPlayData.
    // Chaque match est stocke avec le score encode minutes*10000+secondes.
    spdlog::debug("HistoryCheckMenu::load_history — {} records loaded", records_.size());
}

const HistoryCheckMenu::MatchRecord* HistoryCheckMenu::selected_record() const {
    if (selected_index_ < records_.size()) {
        return &records_[selected_index_];
    }
    return nullptr;
}

} // namespace game
