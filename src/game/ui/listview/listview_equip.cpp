/// @file listview_equip.cpp
/// Implementation des vues liste equipement — 4 specialisations.
/// Donnees depuis CGDDInventoryEquipment + GDSSkillConfig.

#include "iecode/game/ui/listview/listview_equip.h"

namespace game {

// CMenuListViewEquip — liste d'equipement general.
// Affiche les objets equipables : chaussures, gants, accessoires.
// Chaque entree montre : nom, stats, rarete, compatibilite.
// CFG_KEY = "LV_EQUIP"

// CMenuListViewEquipAuraSkill — selection d'aura skill a equiper.
// Filtre les competences d'aura disponibles pour le personnage selectionne.
// nie.exe : le systeme d'aura est lie aux 1344 slots command effect.
// CFG_KEY = "LV_EQUIP_AURA_SKILL"

// CMenuListViewEquipMedalSet — sets de medailles.
// Affiche les sets de medailles disponibles avec leurs bonus de set.
// CFG_KEY = "LV_EQUIP_MEDAL_SET"

// CMenuListViewEquipMedalSetPos — position dans un set de medailles.
// Permet de choisir quel emplacement de medaille modifier.
// CFG_KEY = "LV_EQUIP_MEDAL_SET_POS"

} // namespace game
