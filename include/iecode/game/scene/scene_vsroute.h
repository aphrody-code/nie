#pragma once

/// @file scene_vsroute.h
/// CSceneVSRoute — scene du mode VS Route (combats en ligne / IA).
/// Classe RTTI : game::CSceneVSRoute.

#include "scene_base.h"
#include "scene_manager.h"
#include <cstdint>

namespace game {

/// Scene VS Route — mode de combat competitif.
/// Gere la progression sur la route, les matchs contre IA et
/// les matchs en ligne via EOS (Epic Online Services).
class CSceneVSRoute : public CScene {
public:
    void on_enter() override;
    void on_update(float dt) override;
    void on_draw() override;
    void on_exit() override;

    [[nodiscard]] SceneId scene_id() const override { return SceneId::VSRoute; }
    [[nodiscard]] std::string_view scene_name() const override { return "CSceneVSRoute"; }

    /// Niveau de la route courante.
    [[nodiscard]] uint32_t route_level() const { return route_level_; }

    /// Indique si le match est en ligne.
    [[nodiscard]] bool is_online() const { return is_online_; }

private:
    uint32_t route_level_ = 0;
    bool is_online_ = false;
};

} // namespace game
