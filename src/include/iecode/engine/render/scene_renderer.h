#pragma once

/// @file scene_renderer.h
/// Collecteur et rendu de scene — enregistre les drawables dans le pipeline.
/// Pour l'instant, fournit des stubs (grille editeur, skybox placeholder).

#include "render_pipeline.h"

#include <cstdint>

namespace lives::ecs { class Scene; }

namespace lives {

/// Rendu de scene — enregistre des RenderFeatures dans le RenderPipeline.
///
/// Responsabilites :
/// - Grille de l'editeur (pass MAP_BEFORE)
/// - Skybox / fond (pass ZERO)
/// - Rendu d'objets 3D (futur — pass CHARA_BEFORE, MAP_AFTER, etc.)
class SceneRenderer {
public:
    /// @param pipeline  Reference vers le pipeline de rendu actif.
    explicit SceneRenderer(RenderPipeline& pipeline);

    /// Enregistre les features de scene dans le pipeline.
    /// Appeler une fois apres l'initialisation du pipeline.
    void register_features();

    /// Retire les features de scene du pipeline.
    void unregister_features();

    /// Rend la grille de l'editeur dans le pass MAP_BEFORE.
    /// Utilise bgfx debug draw pour tracer les lignes.
    static void render_grid(uint16_t view_id);

    /// Clear le fond avec la couleur skybox dans le pass ZERO.
    static void render_skybox(uint16_t view_id);

    /// Itere les drawables d'une Scene via FastAccessComponents (acces O(1)).
    /// A appeler une fois par frame avant le submit du pipeline.
    /// Soumet chaque ModelRenderer au view_id correspondant a son DrawPass.
    void submit_scene_drawables(const ecs::Scene& scene, uint16_t view_id);

private:
    RenderPipeline& pipeline_;
    bool registered_ = false;
};

} // namespace lives
