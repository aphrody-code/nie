#pragma once

/// @file scene_manager.h
/// Gestionnaire de scenes du jeu (game::CSceneManager).
/// Singleton — DAT_142138b58 dans nie.exe.
/// Initialise via FUN_140469700 a l'adresse 0x1412a6900.

#include "scene_base.h"
#include <cstdint>
#include <memory>
#include <string_view>
#include <vector>

namespace game {

/// Types de scenes connues du jeu.
enum class SceneId : uint32_t {
    Title          = 0,
    Menu           = 1,
    Rpg            = 2,
    RpgBattle      = 3,
    Soccer         = 4,
    SoccerTraining = 5,
    Event          = 6,
    VSRoute        = 7,
};

/// Retourne le nom lisible d'un SceneId.
[[nodiscard]] constexpr std::string_view scene_id_name(SceneId id) {
    switch (id) {
    case SceneId::Title:          return "Title";
    case SceneId::Menu:           return "Menu";
    case SceneId::Rpg:            return "Rpg";
    case SceneId::RpgBattle:      return "RpgBattle";
    case SceneId::Soccer:         return "Soccer";
    case SceneId::SoccerTraining: return "SoccerTraining";
    case SceneId::Event:          return "Event";
    case SceneId::VSRoute:        return "VSRoute";
    }
    return "Unknown";
}

/// Cree une instance de scene a partir de son identifiant.
/// Retourne nullptr si l'identifiant est inconnu.
[[nodiscard]] std::unique_ptr<CScene> create_scene(SceneId id);

/// Gestionnaire de scenes (game::CSceneManager).
/// Singleton — DAT_142138b58 dans nie.exe.
/// Gere une pile de scenes avec transitions push/pop/switch.
/// Emet des evenements SCENE_LOAD / SCENE_UNLOAD / SCENE_TRANSITION
/// via lives::EventSystem.
class CSceneManager {
public:
    [[nodiscard]] static CSceneManager& instance();

    /// Empile une nouvelle scene (la scene courante est mise en pause).
    void push_scene(SceneId id);

    /// Empile une scene deja construite (prend ownership).
    void push_scene(std::unique_ptr<CScene> scene);

    /// Depile la scene courante (reprend la scene en-dessous).
    void pop_scene();

    /// Remplace la scene courante par une nouvelle (exit + enter).
    void switch_scene(SceneId id);

    /// Met a jour la scene courante.
    void update(float dt);

    /// Rend la scene courante.
    void draw();

    /// Retourne la scene courante (ou nullptr si pile vide).
    [[nodiscard]] CScene* current_scene() const;

    /// Retourne l'identifiant de la scene courante.
    [[nodiscard]] SceneId current_scene_id() const;

    /// Verifie si la pile de scenes est non vide.
    [[nodiscard]] bool has_scene() const;

    /// Nombre de scenes dans la pile.
    [[nodiscard]] size_t scene_count() const;

    /// Vide toute la pile de scenes (appelle on_exit sur chacune).
    void clear();

private:
    CSceneManager() = default;

    /// Pile de scenes — la derniere est la scene active.
    std::vector<std::unique_ptr<CScene>> scene_stack_;
};

} // namespace game
