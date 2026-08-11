/// @file listview_shop.cpp
/// Implementation des vues liste boutique — 2 specialisations.
/// Donnees depuis CGDDShopStatus + GDS*Config.

#include "iecode/game/ui/listview/listview_shop.h"

namespace game {

// CMenuListViewShop — liste de la boutique.
// Affiche les objets en vente avec prix, stock, description.
// Le flag de boutique visitee est dans CGDDShopStatus.
// CFG_KEY = "LV_SHOP"

// CMenuListViewShopBasaraSearchChara — recherche de personnage Basara en boutique.
// Permet de chercher un personnage specifique dans la boutique Basara.
// Utilise des filtres similaires a CharaBankFilter.
// CFG_KEY = "LV_SHOP_BASARA_SEARCH_CHARA"

} // namespace game
