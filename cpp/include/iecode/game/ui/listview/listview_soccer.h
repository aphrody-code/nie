#pragma once

/// @file listview_soccer.h
/// Vues liste soccer — parametres aura, options match, resultats, esprits.
/// nie.exe : 1218 slots passive skill, 1344 slots command effect.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Parametres aura soccer.
struct CMenuListViewSoccerAuraParameter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_AURA_PARAMETER";
};

/// Option BGM match.
struct CMenuListViewSoccerGameOptionBgm : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_GAME_OPTION_BGM";
};

/// Option commentateur match.
struct CMenuListViewSoccerGameOptionCommentator : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_GAME_OPTION_COMMENTATOR";
};

/// Option terrain match.
struct CMenuListViewSoccerGameOptionField : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_GAME_OPTION_FIELD";
};

/// Buteurs a la mi-temps.
struct CMenuListViewSoccerHarfTimeScorer : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_HARF_TIME_SCORER";
};

/// Parametres d'override de competence soccer.
struct CMenuListViewSoccerOverrideSkillParameter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_OVERRIDE_SKILL_PARAMETER";
};

/// Parametres soccer generaux.
struct CMenuListViewSoccerParameter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_PARAMETER";
};

/// Match d'entrainement.
struct CMenuListViewSoccerPracticeMatch : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_PRACTICE_MATCH";
};

/// Resultats de match.
struct CMenuListViewSoccerResult : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_RESULT";
};

/// Esprits soccer.
struct CMenuListViewSoccerSpirit : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_SPIRIT";
};

/// Filtre esprits soccer.
struct CMenuListViewSoccerSpiritFilter : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_SPIRIT_FILTER";
};

/// Invocation (summon).
struct CMenuListViewSoccerSummon : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_SUMMON";
};

/// Selection personnage a invoquer.
struct CMenuListViewSoccerSummonChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_SUMMON_CHARA";
};

/// Match VS CPU.
struct CMenuListViewSoccerVsCpu : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SOCCER_VS_CPU";
};

/// BGM entrainement special.
struct CMenuListViewSpecialTrainingBgm : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SPECIAL_TRAINING_BGM";
};

} // namespace game
