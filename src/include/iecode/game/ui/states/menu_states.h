#pragma once

/// @file menu_states.h
/// Etats de scene et de menu — toutes les classes RTTI d'etat identifiees.
/// Chaque ecran du jeu transite entre ces etats via CMenuStateMachine.

#include <cstdint>
#include <string_view>

namespace game {

/// Interface d'etat de scene.
struct ISceneState {
    virtual ~ISceneState() = default;
    [[nodiscard]] virtual std::string_view state_name() const = 0;
};

/// Interface d'etat reseau.
struct IGameNetState {
    virtual ~IGameNetState() = default;
};

// ---- Etats generaux ---------------------------------------------------------

struct TitleMenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "TitleMenuState"; }
};

struct SoccerResultMenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SoccerResultMenuState"; }
};

struct SoccerState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SoccerState"; }
};

struct SoccerTrainingState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SoccerTrainingState"; }
};

struct VSRouteState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "VSRouteState"; }
};

struct TextChatState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "TextChatState"; }
};

struct InitState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "InitState"; }
};

struct GameOverState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "GameOverState"; }
};

struct EventState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "EventState"; }
};

struct EndTitleState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "EndTitleState"; }
};

struct TrialInitState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "TrialInitState"; }
};

struct TrialThankYouState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "TrialThankYouState"; }
};

// ---- Etats specifiques a une scene ------------------------------------------

struct SceneRpgBattle_MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SceneRpgBattle_MenuState"; }
};

struct SceneSoccerTrainingMenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SceneSoccerTrainingMenuState"; }
};

struct SceneCraftArrangementMember_MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SceneCraftArrangementMember_MenuState"; }
};

struct SceneCraftEdit_MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SceneCraftEdit_MenuState"; }
};

struct SceneCraftWarp_MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "SceneCraftWarp_MenuState"; }
};

// ---- Etats dans des sous-namespaces -----------------------------------------

namespace menuvsroute {

struct MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "menuvsroute::MenuState"; }
};

} // namespace menuvsroute

namespace soccerscene {

struct MenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "soccerscene::MenuState"; }
};

struct ResultMenuState : ISceneState {
    [[nodiscard]] std::string_view state_name() const override { return "soccerscene::ResultMenuState"; }
};

} // namespace soccerscene

} // namespace game
