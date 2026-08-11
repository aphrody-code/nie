#pragma once

/// @file menu_minimap.h
/// Widget minimap (game::CMenuMinimap).
/// Charge les textures mmp_%s_00.g4tx depuis le VFS (FUN_141079750).
/// Config : menu_paths::config::MINIMAP_CONFIG
/// Textures : menu_paths::minimap::texture(map_name)

#include "menu_paths.h"
#include "../../engine/menu/menu_object.h"
#include <glm/vec2.hpp>
#include <glm/vec4.hpp>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace game {

/// Marqueur sur la minimap.
struct MinimapMarker {
    uint32_t  id_       = 0;       ///< Identifiant unique du marqueur.
    uint32_t  type_     = 0;       ///< Type : 0=joueur, 1=quete, 2=PNJ, 3=boutique, 4=evenement.
    glm::vec2 position_{0.f, 0.f}; ///< Position sur la carte (coordonnees monde).
    glm::vec4 color_{1.f, 1.f, 1.f, 1.f}; ///< Couleur du marqueur.
    bool      visible_  = true;    ///< Marqueur visible ?
    bool      blinking_ = false;   ///< Marqueur clignotant ?
};

/// Widget minimap (game::CMenuMinimap).
/// Affiche une carte reduite avec la position du joueur et des marqueurs.
/// Chemin texture : #/menu/210_minimap/%s/mmp_%s_00.g4tx (FUN_141079750).
struct CMenuMinimap : lives::CMenuObject {
    static constexpr std::string_view CLASS_NAME = "CMenuMinimap";

    /// Format du chemin texture minimap.
    /// @see menu_paths::minimap::texture() pour construire un chemin complet.
    static constexpr std::string_view TEXTURE_PATH_FMT = "#/menu/210_minimap/{}/mmp_{}_00.g4tx";

    /// Config cfg.bin de la minimap.
    /// @see menu_paths::config::MINIMAP_CONFIG
    static constexpr std::string_view CONFIG_PATH = menu_paths::config::MINIMAP_CONFIG;

    /// Identifiant de la carte courante.
    std::string map_id_;
    /// Taille d'affichage de la minimap en pixels.
    glm::vec2 display_size_{200.f, 200.f};
    /// Position du joueur (coordonnees monde).
    glm::vec2 player_world_pos_{0.f, 0.f};
    /// Direction du joueur en radians.
    float player_direction_ = 0.f;
    /// Echelle monde -> minimap.
    float world_scale_ = 0.01f;
    /// Rotation de la minimap (suit le joueur ?).
    bool rotate_with_player_ = true;
    /// Zoom courant.
    float zoom_ = 1.f;
    /// Marqueurs affiches.
    std::vector<MinimapMarker> markers_;
    /// Texture chargee ?
    bool texture_loaded_ = false;

    /// Charge la texture de carte pour un identifiant donne.
    void load_map(const std::string& map_id);
    /// Met a jour la position du joueur.
    void set_player_position(const glm::vec2& world_pos, float direction);
    /// Ajoute un marqueur.
    void add_marker(const MinimapMarker& marker);
    /// Retire un marqueur par identifiant.
    void remove_marker(uint32_t marker_id);
    /// Efface tous les marqueurs.
    void clear_markers();
    /// Met a jour les animations (clignotement, etc.).
    void update(float dt) override;
    /// Rendu de la minimap.
    void draw() override;

    /// Convertit des coordonnees monde en coordonnees minimap.
    [[nodiscard]] glm::vec2 world_to_minimap(const glm::vec2& world_pos) const;

    [[nodiscard]] std::string_view get_class_name() const override { return CLASS_NAME; }

private:
    /// Timer de clignotement.
    float blink_timer_ = 0.f;
    /// Etat de clignotement.
    bool blink_state_ = true;
};

} // namespace game
