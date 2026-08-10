/// @file listview_inventory.cpp
/// Implementation des vues liste inventaire — 3 specialisations.
/// Donnees depuis CGDDInventory* (Consume, Equipment, Collection, etc.).

#include "iecode/game/ui/listview/listview_inventory.h"

namespace game {

// CMenuListViewInventory — inventaire principal.
// Affiche tous les objets possedes par categorie.
// Les categories sont : consommables, equipement, materiaux, cles.
// Donnees depuis CGDDInventoryConsume + CGDDInventoryEquipment.
// Icones objets : #/menu/200_icon/02_icon_item/icon_item90.g4tx (FUN_140fb3210).
// CFG_KEY = "LV_INVENTORY"

// CMenuListViewItem — liste d'objets individuels.
// Sous-ensemble de l'inventaire pour un contexte specifique
// (utilisation, echange, vente).
// CFG_KEY = "LV_ITEM"

// CMenuListViewItemFilter — filtre d'objets.
// Criteres : type, rarete, effet, recemment obtenu.
// CFG_KEY = "LV_ITEM_FILTER"

} // namespace game
