/// @file listview_chara_edit.cpp
/// Implementation des vues liste edition personnage — 2 specialisations.
/// Donnees depuis GDSCharaEditConfig + CCharaEditParam.

#include "iecode/game/ui/listview/listview_chara_edit.h"

namespace game {

// CMenuListViewCharaEditColor — selection de couleur pour l'edition.
// Affiche une palette de couleurs pour les cheveux, yeux, peau, etc.
// Chaque couleur est un index dans GDSCharaEditConfig.
// Utilise CCharaEditModelUpdater pour le preview en temps reel.
// CFG_KEY = "LV_CHARA_EDIT_COLOR"

// CMenuListViewCharaEditParts — selection de parties du corps.
// Affiche les options pour chaque partie : coiffure, visage, corps, etc.
// Chaque partie est definie dans GDSCharaEditPartsTypeConfig.
// Le modele 3D est mis a jour via CCharaEditCustomMdlComp + CCharaEditCustomTextureComp.
// CFG_KEY = "LV_CHARA_EDIT_PARTS"

} // namespace game
