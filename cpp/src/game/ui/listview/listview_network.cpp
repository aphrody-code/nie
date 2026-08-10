/// @file listview_network.cpp
/// Implementation des vues liste reseau — EOS (Epic Online Services).
/// 5 specialisations pour le systeme multijoueur et NFC.

#include "iecode/game/ui/listview/listview_network.h"

namespace game {

// CMenuListViewNetworkBlockUser — liste des utilisateurs bloques.
// Gestion de la blocklist via EOS SDK.
// funcLuaMenuNetworkCommand (FUN_141088380) pour les operations reseau.
// CFG_KEY = "LV_NETWORK_BLOCK_USER"

// CMenuListViewNetworkRoom — salles de jeu en ligne.
// Affiche les salles disponibles avec nombre de joueurs, mode, region.
// Utilise le lobby system EOS.
// CFG_KEY = "LV_NETWORK_ROOM"

// CMenuListViewNetworkRoomMemberTown — membres d'une salle (vue ville).
// Affiche les joueurs presents dans la ville en ligne.
// funcLuaMenuMultiplayCommand (FUN_141091350).
// CFG_KEY = "LV_NETWORK_ROOM_MEMBER_TOWN"

// CMenuListViewNetworkRoomTown — salles de la ville en ligne.
// CFG_KEY = "LV_NETWORK_ROOM_TOWN"

// CMenuListViewNFC — cartes NFC (amiibo-like).
// Affiche les cartes NFC scannees et leurs bonus.
// funcLuaMenuNfcCommand (FUN_141097110).
// CFG_KEY = "LV_NFC"

} // namespace game
