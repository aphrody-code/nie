/// @file listview_soccer.cpp
/// Implementation des vues liste soccer — 15 specialisations.
/// nie.exe : 1218 slots passive skill, 1344 slots command effect.
/// Les donnees proviennent de GDSSoccerGameConfig et CGDDPartyStatus.

#include "iecode/game/ui/listview/listview_soccer.h"

#include <spdlog/spdlog.h>

namespace game {

// ============================================================================
// CMenuListViewSoccerAuraParameter
// ============================================================================
// Parametres d'aura pour les competences soccer.
// Affiche la liste des auras disponibles avec leurs effets.
// nie.exe : 1218 slots passive skill — chaque aura est un set de passives.
// CFG_KEY = "LV_SOCCER_AURA_PARAMETER"

// ============================================================================
// CMenuListViewSoccerGameOptionBgm
// ============================================================================
// Selection de la musique de fond pour un match.
// Lit la liste depuis GDSBgmConfig.
// CFG_KEY = "LV_SOCCER_GAME_OPTION_BGM"

// ============================================================================
// CMenuListViewSoccerGameOptionCommentator
// ============================================================================
// Selection du commentateur de match.
// Les commentateurs sont des assets audio CRI ADX2.
// CFG_KEY = "LV_SOCCER_GAME_OPTION_COMMENTATOR"

// ============================================================================
// CMenuListViewSoccerGameOptionField
// ============================================================================
// Selection du terrain de jeu.
// Chaque terrain a un G4MG/G4TX associe et des stats de gimmick (464 slots).
// CFG_KEY = "LV_SOCCER_GAME_OPTION_FIELD"

// ============================================================================
// CMenuListViewSoccerHarfTimeScorer
// ============================================================================
// Buteurs a la mi-temps — affiche qui a marque et quand.
// Le score est encode : minutes * 10000 + secondes.
// CFG_KEY = "LV_SOCCER_HARF_TIME_SCORER" (note: "harf" = typo dans nie.exe)

// ============================================================================
// CMenuListViewSoccerOverrideSkillParameter
// ============================================================================
// Override des parametres de competences soccer.
// Permet de modifier temporairement les stats d'une competence.
// CFG_KEY = "LV_SOCCER_OVERRIDE_SKILL_PARAMETER"

// ============================================================================
// CMenuListViewSoccerParameter
// ============================================================================
// Parametres generaux de soccer (difficulte, temps de match, etc.).
// Lit depuis GDSSoccerGameConfig.
// CFG_KEY = "LV_SOCCER_PARAMETER"

// ============================================================================
// CMenuListViewSoccerPracticeMatch
// ============================================================================
// Selection de match d'entrainement — choix de l'adversaire et des conditions.
// CFG_KEY = "LV_SOCCER_PRACTICE_MATCH"

// ============================================================================
// CMenuListViewSoccerResult
// ============================================================================
// Resultats de match — score, buteurs, statistiques, MVP.
// Stride par equipe : 0x1028. Max joueurs : 58.
// CFG_KEY = "LV_SOCCER_RESULT"

// ============================================================================
// CMenuListViewSoccerSpirit
// ============================================================================
// Liste des esprits soccer (Basara, Element, Hero, Normal, Token).
// Affiche l'esprit, son niveau, son effet et sa jauge.
// CFG_KEY = "LV_SOCCER_SPIRIT"

// ============================================================================
// CMenuListViewSoccerSpiritFilter
// ============================================================================
// Filtre pour la liste des esprits soccer.
// Criteres : type d'esprit, element, rarete.
// CFG_KEY = "LV_SOCCER_SPIRIT_FILTER"

// ============================================================================
// CMenuListViewSoccerSummon
// ============================================================================
// Selection d'invocation (summon) pendant un match.
// 32 slots special tactics (soccer_command_effect.c).
// CFG_KEY = "LV_SOCCER_SUMMON"

// ============================================================================
// CMenuListViewSoccerSummonChara
// ============================================================================
// Selection du personnage a invoquer.
// Affiche les personnages compatibles avec l'invocation selectionnee.
// CFG_KEY = "LV_SOCCER_SUMMON_CHARA"

// ============================================================================
// CMenuListViewSoccerVsCpu
// ============================================================================
// Configuration du match VS CPU — selection equipe adverse, difficulte.
// CFG_KEY = "LV_SOCCER_VS_CPU"

// ============================================================================
// CMenuListViewSpecialTrainingBgm
// ============================================================================
// Selection BGM pour l'entrainement special.
// CFG_KEY = "LV_SPECIAL_TRAINING_BGM"

} // namespace game
