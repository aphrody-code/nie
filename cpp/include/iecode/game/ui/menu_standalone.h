#pragma once

/// @file menu_standalone.h
/// Menus plein ecran autonomes (game::BeansTradeMenu, AbilityListMenu,
/// HistoryCheckMenu).
/// Ces menus ont leur propre machine d'etat et ne sont pas pilotes par Lua.

#include "menu_controller.h"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace game {

// ============================================================================
// Menu de trade de haricots (game::BeansTradeMenu)
// ============================================================================

/// Menu d'echange de haricots — plus haute complexite identifiee (144).
/// Gere la selection, l'echange, la confirmation et l'animation de trade.
struct BeansTradeMenu : CMenuController {
    static constexpr std::string_view CLASS_NAME = "BeansTradeMenu";

    /// Phase du menu.
    enum class Phase : uint8_t {
        INIT          = 0,  ///< Initialisation, chargement des donnees.
        SELECT_OFFER  = 1,  ///< Selection de l'objet a offrir.
        SELECT_WANT   = 2,  ///< Selection de l'objet desire.
        CONFIRM       = 3,  ///< Confirmation de l'echange.
        ANIMATING     = 4,  ///< Animation de l'echange en cours.
        RESULT        = 5,  ///< Affichage du resultat.
        CLOSING       = 6,  ///< Fermeture du menu.
    };

    /// Element echangeable.
    struct TradeItem {
        uint32_t    item_id_   = 0;
        std::string name_;
        uint32_t    quantity_  = 0;
        uint32_t    cost_      = 0;   ///< Cout en haricots.
        bool        available_ = true;
    };

    /// Phase courante.
    Phase phase_ = Phase::INIT;
    /// Machine a etats interne.
    CMenuStateMachine state_machine_;
    /// Objets disponibles a l'offre.
    std::vector<TradeItem> offer_items_;
    /// Objets disponibles a la demande.
    std::vector<TradeItem> want_items_;
    /// Index de l'objet selectionne pour l'offre.
    uint32_t selected_offer_ = 0;
    /// Index de l'objet selectionne pour la demande.
    uint32_t selected_want_ = 0;
    /// Nombre de haricots du joueur.
    uint32_t player_beans_ = 0;
    /// Timer d'animation.
    float anim_timer_ = 0.f;
    /// Duree de l'animation d'echange.
    float anim_duration_ = 1.5f;
    /// Trade reussi ?
    bool trade_success_ = false;

    void on_init() override;
    void on_update() override;
    void on_draw() override;
    void on_close() override;

    /// Passe a la phase suivante.
    void advance_phase();
    /// Confirme l'echange.
    void confirm_trade();
    /// Annule et revient en arriere.
    void cancel();

    [[nodiscard]] bool can_afford(uint32_t cost) const { return player_beans_ >= cost; }

private:
    /// Met a jour selon la phase courante.
    void update_phase(float dt);
    /// Met a jour l'animation d'echange.
    void update_animation(float dt);
};

// ============================================================================
// Menu de liste de competences (game::AbilityListMenu)
// ============================================================================

/// Menu de liste de competences — complexite 55.
/// Affiche, filtre et trie les competences du personnage.
struct AbilityListMenu : CMenuController {
    static constexpr std::string_view CLASS_NAME = "AbilityListMenu";

    /// Phase du menu.
    enum class Phase : uint8_t {
        INIT       = 0,
        BROWSING   = 1,  ///< Navigation dans la liste.
        DETAIL     = 2,  ///< Affichage du detail d'une competence.
        FILTERING  = 3,  ///< Filtre actif.
        CLOSING    = 4,
    };

    /// Competence affichee.
    struct AbilityEntry {
        uint32_t    ability_id_  = 0;
        std::string name_;
        std::string description_;
        uint32_t    type_        = 0;   ///< 0=actif, 1=passif, 2=special.
        uint32_t    level_       = 0;
        uint32_t    cost_        = 0;
        bool        learned_     = false;
        bool        equipped_    = false;
    };

    /// Phase courante.
    Phase phase_ = Phase::INIT;
    /// Machine a etats interne.
    CMenuStateMachine state_machine_;
    /// Liste complete des competences.
    std::vector<AbilityEntry> abilities_;
    /// Liste filtree (indices dans abilities_).
    std::vector<uint32_t> filtered_indices_;
    /// Index de selection dans la liste filtree.
    uint32_t selected_index_ = 0;
    /// Offset de defilement.
    uint32_t scroll_offset_ = 0;
    /// Nombre d'elements visibles.
    uint32_t visible_count_ = 10;
    /// Filtre actif par type (-1 = tous).
    int32_t filter_type_ = -1;
    /// Tri : 0=nom, 1=type, 2=niveau, 3=cout.
    uint32_t sort_mode_ = 0;
    /// Identifiant du personnage.
    uint32_t chara_id_ = 0;

    void on_init() override;
    void on_update() override;
    void on_draw() override;
    void on_close() override;

    /// Charge les competences pour un personnage.
    void load_abilities(uint32_t chara_id);
    /// Applique un filtre par type.
    void apply_filter(int32_t type);
    /// Change le mode de tri.
    void set_sort_mode(uint32_t mode);

    [[nodiscard]] const AbilityEntry* selected_ability() const;

private:
    /// Reconstruit la liste filtree.
    void rebuild_filtered_list();
    /// Trie la liste filtree.
    void sort_filtered_list();
};

// ============================================================================
// Menu d'historique de matchs (game::HistoryCheckMenu)
// ============================================================================

/// Menu de consultation de l'historique des matchs.
struct HistoryCheckMenu : CMenuController {
    static constexpr std::string_view CLASS_NAME = "HistoryCheckMenu";

    /// Phase du menu.
    enum class Phase : uint8_t {
        INIT     = 0,
        LIST     = 1,  ///< Liste des matchs.
        DETAIL   = 2,  ///< Detail d'un match.
        CLOSING  = 3,
    };

    /// Entree d'historique de match.
    struct MatchRecord {
        uint32_t    match_id_      = 0;
        std::string opponent_name_;
        uint32_t    score_home_    = 0;
        uint32_t    score_away_    = 0;
        uint32_t    match_type_    = 0;  ///< 0=amical, 1=ligue, 2=tournoi, 3=vs_route.
        bool        is_win_        = false;
    };

    /// Phase courante.
    Phase phase_ = Phase::INIT;
    /// Machine a etats interne.
    CMenuStateMachine state_machine_;
    /// Historique des matchs.
    std::vector<MatchRecord> records_;
    /// Index de selection.
    uint32_t selected_index_ = 0;
    /// Offset de defilement.
    uint32_t scroll_offset_ = 0;
    /// Nombre d'elements visibles.
    uint32_t visible_count_ = 8;

    void on_init() override;
    void on_update() override;
    void on_draw() override;
    void on_close() override;

    /// Charge l'historique depuis les donnees de sauvegarde.
    void load_history();

    [[nodiscard]] const MatchRecord* selected_record() const;
};

} // namespace game
