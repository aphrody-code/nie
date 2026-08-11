#pragma once

/// @file listview_network.h
/// Vues liste reseau — utilisateurs bloques, salons, NFC.
/// Reseau : Epic Online Services (EOS).

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Utilisateurs bloques.
struct CMenuListViewNetworkBlockUser : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NETWORK_BLOCK_USER";
};

/// Salon reseau.
struct CMenuListViewNetworkRoom : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NETWORK_ROOM";
};

/// Membres d'un salon (ville).
struct CMenuListViewNetworkRoomMemberTown : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NETWORK_ROOM_MEMBER_TOWN";
};

/// Salons (ville).
struct CMenuListViewNetworkRoomTown : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NETWORK_ROOM_TOWN";
};

/// Liste NFC.
struct CMenuListViewNFC : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_NFC";
};

} // namespace game
