#pragma once

/// @file listview_misc.h
/// Vues liste diverses — configuration, archives, univers, posts, VS Route, etc.
/// Regroupe toutes les CMenuListView* qui n'ont pas de fichier dedie.

#include "../../../engine/menu/menu_list_view.h"

namespace game {

/// Configuration des touches.
struct CMenuListViewKeyConfig : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_KEY_CONFIG";
};

/// Parametres.
struct CMenuListViewSetting : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SETTING";
};

/// Records/statistiques.
struct CMenuListViewRecord : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_RECORD";
};

/// Resultats RPG.
struct CMenuListViewRpgResult : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_RPG_RESULT";
};

/// Archives de scene.
struct CMenuListViewSceneArchive : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SCENE_ARCHIVE";
};

/// Sous-fenetre commune.
struct CMenuListViewSubWindowCommon : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SUB_WINDOW_COMMON";
};

/// Deblocages systeme.
struct CMenuListViewSystemUnlock : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_SYSTEM_UNLOCK";
};

/// Personnage univers.
struct CMenuListViewUniverseChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_UNIVERSE_CHARA";
};

/// Recherche personnage univers.
struct CMenuListViewUniverseSearchChara : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_UNIVERSE_SEARCH_CHARA";
};

/// Resultats de recherche univers.
struct CMenuListViewUniverseSearchResult : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_UNIVERSE_SEARCH_RESULT";
};

/// Plaque de nom utilisateur.
struct CMenuListViewUserNamePlate : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_USER_NAME_PLATE";
};

/// VS Route.
struct CMenuListViewVsRoute : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_VS_ROUTE";
};

/// Mode vestimentaire.
struct CMenuListViewFashion : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_FASHION";
};

/// Aide.
struct CMenuListViewHelp : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_HELP";
};

/// Favoris d'informations.
struct CMenuListViewInfoBookmark : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INFO_BOOKMARK";
};

/// Livraison d'informations.
struct CMenuListViewInformationDelivery : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INFORMATION_DELIVERY";
};

/// Commentaires Inacode.
struct CMenuListViewInacodeComment : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INACODE_COMMENT";
};

/// Salle Inacode.
struct CMenuListViewInacodeRoom : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_INACODE_ROOM";
};

/// Lien Kizuna.
struct CMenuListViewKizunaLink : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_KIZUNA_LINK";
};

/// Posts.
struct CMenuListViewPost : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_POST";
};

/// Detail d'un post.
struct CMenuListViewPostDetail : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_POST_DETAIL";
};

/// Equipe adverse.
struct CMenuListViewOpponentTeam : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_OPPONENT_TEAM";
};

/// Info photo.
struct CMenuListViewPhotoInfo : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_PHOTO_INFO";
};

/// Gestion photos.
struct CMenuListViewPhotoManage : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_PHOTO_MANAGE";
};

/// Liste de visiteurs.
struct CMenuListViewVisitorList : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_VISITOR_LIST";
};

/// Taux de drop.
struct CMenuListViewDropRateList : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_DROP_RATE_LIST";
};

/// Dictionnaire.
struct CMenuListViewDictionary : lives::CMenuListView {
    static constexpr std::string_view CFG_KEY = "LV_DICTIONARY";
};

} // namespace game
