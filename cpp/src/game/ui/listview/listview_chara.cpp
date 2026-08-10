/// @file listview_chara.cpp
/// Implementation des vues liste personnages — 6 specialisations.
/// Chaque listview gere une liste de personnages avec filtre et selection.

#include "iecode/game/ui/listview/listview_chara.h"

#include <spdlog/spdlog.h>

namespace game {

// ============================================================================
// CMenuListViewChara
// ============================================================================
// Liste principale de selection de personnage.
// Utilisee dans l'ecran de formation d'equipe.
// Affiche : icone, nom, position, niveau, stats cles.
// nie.exe : pilote par funcLuaMenuCommand, donnees depuis GDSCharaParam + CGDDChara.
// CFG_KEY = "LV_CHARA" — lu depuis cfg.bin pour la configuration du layout.

// ============================================================================
// CMenuListViewCharaBank
// ============================================================================
// Collection complete des personnages possedes.
// Accessible depuis le menu principal -> Personnages -> Banque.
// Affiche tous les personnages debloques avec leurs stats.
// CFG_KEY = "LV_CHARA_BANK"

// ============================================================================
// CMenuListViewCharaBankFilter
// ============================================================================
// Filtre applique a la banque de personnages.
// Criteres : element, position, rarete, equipe d'origine, serie.
// Les filtres sont combines (AND logique).
// CFG_KEY = "LV_CHARA_BANK_FILTER"

// ============================================================================
// CMenuListViewCharaFilter
// ============================================================================
// Filtre general pour les listes de personnages.
// Utilise par la liste de selection (pas la banque).
// CFG_KEY = "LV_CHARA_FILTER"

// ============================================================================
// CMenuListViewCharaReverseLookup
// ============================================================================
// Recherche inverse — trouve quel personnage possede une competence donnee.
// Utilise dans l'ecran de detail de competence.
// CFG_KEY = "LV_CHARA_REVERSE_LOOKUP"

// ============================================================================
// CMenuListViewCharaEquip
// ============================================================================
// Liste des personnages pour l'ecran d'equipement.
// Affiche les slots d'equipement et les competences equipees.
// CFG_KEY = "LV_CHARA_EQUIP"

} // namespace game
