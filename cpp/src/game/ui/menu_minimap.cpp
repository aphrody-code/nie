/// @file menu_minimap.cpp
/// Implementation du widget minimap (game::CMenuMinimap).
/// Charge les textures mmp_%s_00.g4tx depuis le VFS (FUN_141079750).

#include "iecode/game/ui/menu_minimap.h"

#include <spdlog/spdlog.h>
#include <algorithm>
#include <cmath>

namespace game {

// ============================================================================
// CMenuMinimap
// ============================================================================

void CMenuMinimap::load_map(const std::string& map_id) {
    map_id_ = map_id;
    markers_.clear();
    // TODO: FUN_141079750 — charger la texture depuis le VFS.
    // Path : fmt::format(TEXTURE_PATH_FMT, map_id, map_id).
    texture_loaded_ = true;
    spdlog::debug("CMenuMinimap::load_map — map_id='{}' (texture path: #/menu/210_minimap/{}/mmp_{}_00.g4tx)",
                  map_id, map_id, map_id);
}

void CMenuMinimap::set_player_position(const glm::vec2& world_pos, float direction) {
    player_world_pos_ = world_pos;
    player_direction_ = direction;
}

void CMenuMinimap::add_marker(const MinimapMarker& marker) {
    // Remplace si le meme id existe deja.
    for (auto& existing : markers_) {
        if (existing.id_ == marker.id_) {
            existing = marker;
            return;
        }
    }
    markers_.push_back(marker);
}

void CMenuMinimap::remove_marker(uint32_t marker_id) {
    markers_.erase(
        std::remove_if(markers_.begin(), markers_.end(),
                       [marker_id](const MinimapMarker& m) { return m.id_ == marker_id; }),
        markers_.end());
}

void CMenuMinimap::clear_markers() {
    markers_.clear();
}

void CMenuMinimap::update(float dt) {
    // Mise a jour du timer de clignotement.
    constexpr float BLINK_PERIOD = 0.5f;
    blink_timer_ += dt;
    if (blink_timer_ >= BLINK_PERIOD) {
        blink_timer_ -= BLINK_PERIOD;
        blink_state_ = !blink_state_;
    }
}

void CMenuMinimap::draw() {
    if (!texture_loaded_) return;

    // TODO: rendu de la texture de carte avec transformation.
    // 1. Appliquer le zoom et la rotation (si rotate_with_player_).
    // 2. Dessiner la texture centree sur la position du joueur.
    // 3. Dessiner chaque marqueur visible.
    // 4. Les marqueurs clignotants utilisent blink_state_.
    // 5. Dessiner l'icone du joueur avec sa direction.
}

glm::vec2 CMenuMinimap::world_to_minimap(const glm::vec2& world_pos) const {
    // Convertit des coordonnees monde en coordonnees minimap.
    // La minimap est centree sur player_world_pos_.
    const glm::vec2 relative = (world_pos - player_world_pos_) * world_scale_ * zoom_;

    // Appliquer la rotation si necessaire.
    glm::vec2 rotated = relative;
    if (rotate_with_player_) {
        const float cos_d = std::cos(-player_direction_);
        const float sin_d = std::sin(-player_direction_);
        rotated.x = relative.x * cos_d - relative.y * sin_d;
        rotated.y = relative.x * sin_d + relative.y * cos_d;
    }

    // Centrer sur l'affichage.
    return (display_size_ * 0.5f) + rotated;
}

} // namespace game
