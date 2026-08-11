/// @file listview_misc.cpp
/// Implementation des vues liste diverses — 26 specialisations CMenuListView*
/// sans fichier dedie.
/// Couvre : config, archives, univers, posts, VS Route, mode, aide,
/// information, inacode, kizuna, photos, visiteurs, dictionnaire.

#include "iecode/game/ui/listview/listview_misc.h"

#include <spdlog/spdlog.h>

namespace game {

// ============================================================================
// Configuration et parametres
// ============================================================================

// CMenuListViewKeyConfig — configuration des touches/boutons.
// Affiche les actions et les touches assignees (clavier, manette).
// Correspond aux 8 sets gaiji (PS4, PS5, Xbox, SteamDeck, Key, NX, Game, Game2).
// CFG_KEY = "LV_KEY_CONFIG"

// CMenuListViewSetting — parametres generaux du jeu.
// Audio, video, gameplay, langue, accessibilite.
// Lit/ecrit depuis app_config_5.00.24.00.cfg.bin.
// CFG_KEY = "LV_SETTING"

// ============================================================================
// Records et resultats
// ============================================================================

// CMenuListViewRecord — statistiques et records du joueur.
// Matchs joues, victoires, buts marques, etc.
// Lit depuis CGDDPlayData.
// CFG_KEY = "LV_RECORD"

// CMenuListViewRpgResult — resultats d'un combat RPG.
// XP gagnee, objets obtenus, competences apprises.
// CFG_KEY = "LV_RPG_RESULT"

// ============================================================================
// Archives et historique
// ============================================================================

// CMenuListViewSceneArchive — archives de scenes (cinematiques revues).
// Permet de revoir les evenements deja vus.
// CFG_KEY = "LV_SCENE_ARCHIVE"

// CMenuListViewSubWindowCommon — sous-fenetre generique (info detail).
// Utilisee par plusieurs menus pour afficher des details contextuels.
// CFG_KEY = "LV_SUB_WINDOW_COMMON"

// ============================================================================
// Systeme et deblocage
// ============================================================================

// CMenuListViewSystemUnlock — liste des elements debloques.
// Affiche les fonctionnalites nouvellement accessibles.
// CFG_KEY = "LV_SYSTEM_UNLOCK"

// ============================================================================
// Univers et recherche
// ============================================================================

// CMenuListViewUniverseChara — personnage dans l'univers partage.
// Affiche les personnages des autres joueurs (online).
// Utilise funcLuaMenuNetworkCommand (FUN_141088380).
// CFG_KEY = "LV_UNIVERSE_CHARA"

// CMenuListViewUniverseSearchChara — recherche de personnage dans l'univers.
// Criteres de filtre similaires a CharaBankFilter.
// CFG_KEY = "LV_UNIVERSE_SEARCH_CHARA"

// CMenuListViewUniverseSearchResult — resultats de recherche univers.
// CFG_KEY = "LV_UNIVERSE_SEARCH_RESULT"

// ============================================================================
// Plaque de nom et mode
// ============================================================================

// CMenuListViewUserNamePlate — plaques de nom decoratives.
// Collection de plaques avec differents designs.
// Donnees depuis CGDDInventoryNamePlate.
// CFG_KEY = "LV_USER_NAME_PLATE"

// CMenuListViewFashion — mode vestimentaire.
// Costumes et accessoires pour les personnages.
// Lit depuis GDSCharaCostumeConfig + CGDDInventoryEquipment.
// CFG_KEY = "LV_FASHION"

// ============================================================================
// VS Route
// ============================================================================

// CMenuListViewVsRoute — parcours VS Route.
// Affiche les adversaires et les recompenses du parcours.
// Utilise funcLuaMenuVSRouteTownCommand (FUN_141116110).
// CFG_KEY = "LV_VS_ROUTE"

// ============================================================================
// Aide et information
// ============================================================================

// CMenuListViewHelp — tutoriels et aide en jeu.
// CFG_KEY = "LV_HELP"

// CMenuListViewInfoBookmark — favoris d'informations.
// Permet de marquer des infos comme favorites pour y revenir.
// CFG_KEY = "LV_INFO_BOOKMARK"

// CMenuListViewInformationDelivery — livraison d'informations.
// Notifications et nouvelles du jeu.
// CFG_KEY = "LV_INFORMATION_DELIVERY"

// ============================================================================
// Inacode (reseau social in-game)
// ============================================================================

// CMenuListViewInacodeComment — commentaires sur les publications Inacode.
// CFG_KEY = "LV_INACODE_COMMENT"

// CMenuListViewInacodeRoom — salles de discussion Inacode.
// CFG_KEY = "LV_INACODE_ROOM"

// ============================================================================
// Kizuna et liens
// ============================================================================

// CMenuListViewKizunaLink — liens d'amitie (kizuna) entre personnages.
// Affiche le niveau de lien et les bonus associes.
// Donnees depuis CGDDInventoryKizunaLink.
// CFG_KEY = "LV_KIZUNA_LINK"

// ============================================================================
// Posts et courrier
// ============================================================================

// CMenuListViewPost — boite de reception de posts.
// Utilise funcLuaMenuPostCommand (FUN_1410b8580).
// CFG_KEY = "LV_POST"

// CMenuListViewPostDetail — detail d'un post recu.
// Utilise funcLuaMenuPostListCommand (FUN_1410b7ed0).
// CFG_KEY = "LV_POST_DETAIL"

// ============================================================================
// Adversaires et photos
// ============================================================================

// CMenuListViewOpponentTeam — equipe adverse (preview avant match).
// Textures chargees depuis #/menu/220_img/opponent_img/%s.g4tx (FUN_140bd5b00).
// CFG_KEY = "LV_OPPONENT_TEAM"

// CMenuListViewPhotoInfo — infos sur une photo (mode photo in-game).
// CFG_KEY = "LV_PHOTO_INFO"

// CMenuListViewPhotoManage — gestion des photos prises.
// CFG_KEY = "LV_PHOTO_MANAGE"

// ============================================================================
// Visiteurs et divers
// ============================================================================

// CMenuListViewVisitorList — visiteurs dans le camp de base.
// CFG_KEY = "LV_VISITOR_LIST"

// CMenuListViewDropRateList — taux de drop (probabilites de recompenses).
// Affiche les tables de drop pour la transparence (gacha-adjacent).
// CFG_KEY = "LV_DROP_RATE_LIST"

// CMenuListViewDictionary — dictionnaire in-game.
// Utilise funcLuaMenuDictCommand (FUN_140fc2530).
// CFG_KEY = "LV_DICTIONARY"

} // namespace game
