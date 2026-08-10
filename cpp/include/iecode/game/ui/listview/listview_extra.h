#pragma once

/// @file listview_extra.h
/// Vues liste supplementaires — toutes les CMenuListView* manquantes.
/// 18 specialisations couvrant formation, records, craft, animaux, etc.

#include "../../../engine/menu/menu_list_view.h"
#include <string>
#include <vector>

namespace game {

/// Vue liste imbriquee/hierarchique (game::MenuNestListView).
/// Permet la navigation dans des listes arborescentes.
struct MenuNestListView : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NEST";

    /// Profondeur courante dans la hierarchie.
    uint32_t depth_ = 0;
    /// Pile des indices parents (pour revenir en arriere).
    std::vector<uint32_t> parent_indices_;

    /// Descend dans un sous-niveau.
    void enter_child(uint32_t index);
    /// Remonte au niveau parent.
    void go_back();

    [[nodiscard]] bool can_go_back() const { return depth_ > 0; }
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuNestListView"; }
};

/// Formation de soccer — editeur de placement (game::MenuListViewSoccerFormation).
struct MenuListViewSoccerFormation : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_FORMATION";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewSoccerFormation"; }
};

/// Historique de matchs (game::MenuListViewMatchRecord).
struct MenuListViewMatchRecord : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_MATCH_RECORD";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewMatchRecord"; }
};

/// Rapport d'apprentissage de competences (game::MenuListViewAbilityLearningReport).
struct MenuListViewAbilityLearningReport : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ABILITY_LEARNING_REPORT";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewAbilityLearningReport"; }
};

/// Resultat de livraison d'information (game::MenuListViewInformationDeliveryResult).
struct MenuListViewInformationDeliveryResult : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INFORMATION_DELIVERY_RESULT";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewInformationDeliveryResult"; }
};

/// Element de livraison d'information (game::MenuListViewInformationDeliveryItem).
struct MenuListViewInformationDeliveryItem : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INFORMATION_DELIVERY_ITEM";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewInformationDeliveryItem"; }
};

/// Liste de communication (game::MenuListViewCommunication).
struct MenuListViewCommunication : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_COMMUNICATION";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewCommunication"; }
};

/// Liste d'animaux/mascottes (game::MenuListViewAnimal).
struct MenuListViewAnimal : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ANIMAL";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewAnimal"; }
};

/// Selection d'utilisation d'objet (game::MenuListViewItemUse).
struct MenuListViewItemUse : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ITEM_USE";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewItemUse"; }
};

/// Liste de recettes de craft (game::MenuListViewCraft).
struct MenuListViewCraft : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_CRAFT";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewCraft"; }
};

/// Menu de selection de carte (game::MenuListViewMapMenu).
struct MenuListViewMapMenu : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_MAP_MENU";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewMapMenu"; }
};

/// Navigateur de fichiers de donnees (game::MenuListViewDatafile).
struct MenuListViewDatafile : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_DATAFILE";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewDatafile"; }
};

/// Liste de personnages equipes (game::MenuListViewArmedChara).
struct MenuListViewArmedChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_ARMED_CHARA";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewArmedChara"; }
};

/// Utilisation de boite de victoire (game::MenuListViewUseVictoryBox).
struct MenuListViewUseVictoryBox : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_USE_VICTORY_BOX";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewUseVictoryBox"; }
};

/// Voyage rapide en entrainement special (game::MenuListViewSpecialTrainingFasttravel).
struct MenuListViewSpecialTrainingFasttravel : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SPECIAL_TRAINING_FASTTRAVEL";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewSpecialTrainingFasttravel"; }
};

/// Selection de personnage a recruter (game::MenuListViewSelectScoutChara).
struct MenuListViewSelectScoutChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SELECT_SCOUT_CHARA";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewSelectScoutChara"; }
};

/// Banniere d'information (game::MenuListViewInformationBanner).
struct MenuListViewInformationBanner : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INFORMATION_BANNER";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewInformationBanner"; }
};

/// Liste de performance de personnages soccer (game::MenuListViewSoccerPerformanceCharaList).
struct MenuListViewSoccerPerformanceCharaList : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_PERFORMANCE_CHARA_LIST";
    [[nodiscard]] std::string_view get_class_name() const override { return "MenuListViewSoccerPerformanceCharaList"; }
};

} // namespace game
