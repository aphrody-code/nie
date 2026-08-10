/// @file menu_states.cpp
/// Implementation des etats de scene et de menu.
/// 22 classes ISceneState — chaque etat gere les transitions du jeu.
///
/// Architecture dans nie.exe :
///   - CSceneManager maintient un pointeur vers l'ISceneState courant.
///   - Chaque etat a un on_enter/on_exit/update/handle_input.
///   - Les transitions sont pilotees par CMenuStateMachine.
///
/// Les etats ici sont des structs RTTI minimalistes — le gros de la logique
/// reside dans les scripts Lua et les menus CLuaMenuObject.
/// Ce fichier documente le role de chaque etat et les adresses nie.exe associees.

#include "iecode/game/ui/states/menu_states.h"

namespace game {

// ============================================================================
// ISceneState — interface de base
// ============================================================================
//
// virtual state_name() const = 0;
// Dans nie.exe, chaque etat a une vftable avec :
//   +0x00 : destructor
//   +0x08 : on_enter()
//   +0x10 : on_exit()
//   +0x18 : update(float dt)
//   +0x20 : handle_input()
//   +0x28 : state_name() / get_class_name()

// ============================================================================
// TitleMenuState
// ============================================================================
// Ecran titre — logo Level-5, menu principal (Nouveau/Continuer/Options).
// nie.exe : CSceneTitle -> state machine avec init/logo/menu/transition.
// Lua : common/script/lua/menu/title_menu.lua.bin

// ============================================================================
// SoccerResultMenuState
// ============================================================================
// Ecran de resultat de match de soccer.
// Affiche le score, les buteurs, les statistiques.
// nie.exe : lie a CSceneSoccer::result_phase.

// ============================================================================
// SoccerState
// ============================================================================
// Etat principal du match de soccer.
// CSoccerStateMachine gere 11 phases (kickoff, play, goal, halftime, etc.).
// nie.exe : stride joueur 0x570, max joueurs 58 (0x3A).

// ============================================================================
// SoccerTrainingState
// ============================================================================
// Etat d'entrainement (exercices, mini-jeux).

// ============================================================================
// VSRouteState
// ============================================================================
// VS Route — parcours de matchs en ligne.
// Utilise funcLuaMenuVSRouteTownCommand (FUN_141116110).

// ============================================================================
// TextChatState
// ============================================================================
// Etat de chat textuel (multijoueur).
// Utilise funcLuaMenuNetworkCommand (FUN_141088380).

// ============================================================================
// InitState
// ============================================================================
// Etat d'initialisation du jeu — chargement des assets de base,
// parse de cpk_list.cfg.bin (250K entries), init du VFS.

// ============================================================================
// GameOverState
// ============================================================================
// Ecran de game over — defaite en match ou RPG.
// Propose Recommencer / Quitter.

// ============================================================================
// EventState
// ============================================================================
// Etat d'evenement scriptee (cutscenes, dialogues).
// Pilote par CSceneEvent et les scripts Lua d'evenement.

// ============================================================================
// EndTitleState
// ============================================================================
// Ecran de fin de jeu / credits.

// ============================================================================
// TrialInitState
// ============================================================================
// Initialisation de la version d'essai (demo).

// ============================================================================
// TrialThankYouState
// ============================================================================
// Ecran de remerciement de la version d'essai.

// ============================================================================
// SceneRpgBattle_MenuState
// ============================================================================
// Menu pendant un combat RPG.
// CRpgBattleTurnManager + 9 variantes de turn manager.
// Commandes via funcLuaActionCommand (FUN_140b769a0).

// ============================================================================
// SceneSoccerTrainingMenuState
// ============================================================================
// Menu pendant l'entrainement soccer (selection exercice, etc.).

// ============================================================================
// SceneCraftArrangementMember_MenuState
// ============================================================================
// Menu d'arrangement des membres dans le mode craft.
// Lie a CCraftNpcController / CCraftNpcData.

// ============================================================================
// SceneCraftEdit_MenuState
// ============================================================================
// Menu d'edition dans le mode craft.

// ============================================================================
// SceneCraftWarp_MenuState
// ============================================================================
// Menu de teleportation dans le mode craft.

// ============================================================================
// menuvsroute::MenuState
// ============================================================================
// Etat de menu dans le mode VS Route.
// Sous-namespace dedie pour eviter les collisions.

// ============================================================================
// soccerscene::MenuState
// ============================================================================
// Menu dans la scene de soccer (pause, tactiques, remplacements).

// ============================================================================
// soccerscene::ResultMenuState
// ============================================================================
// Menu de resultat dans la scene de soccer.
// Affiche score, stats, MVP, XP gagne.

} // namespace game
