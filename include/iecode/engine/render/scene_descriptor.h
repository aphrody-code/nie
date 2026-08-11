#pragma once

/// @file scene_descriptor.h
/// Description d'une scene a rendre — equivalent du SceneDescriptor d'Overload.
///
/// Le SceneDescriptor agrege les `FastAccessComponents` : les listes typees
/// d'objets utiles au renderer (cameras, modeles, lumieres) extraites de la
/// scene une seule fois par frame pour eviter les recherches recursives dans
/// l'arbre d'Actor.

#include "draw_pass.h"

#include <cstdint>
#include <vector>

#include <glm/mat4x4.hpp>
#include <glm/vec3.hpp>
#include <glm/vec4.hpp>

namespace lives {
struct CCamera;
namespace ecs { class Actor; }
} // namespace lives

namespace lives::render {

/// Reference vers un Actor portant un composant de rendu (modele 3D).
/// Le pointeur Actor est non-owning et reste valide pour la duree du frame.
struct DrawableRef {
    ecs::Actor* actor = nullptr;
    glm::mat4   world_matrix{1.0f};
    DrawPass    target_pass = DrawPass::CHARA_BEFORE;
    uint32_t    sort_key    = 0; ///< material_id << 16 | mesh_id (bgfx-friendly)
    bool        casts_shadow = true;
    bool        receives_shadow = true;
};

/// Lumiere extraite de la scene (point, directionnelle, spot).
struct LightRef {
    enum Type : uint8_t { Directional, Point, Spot };
    Type      type = Directional;
    glm::vec3 position{0.0f};
    glm::vec3 direction{0.0f, -1.0f, 0.0f};
    glm::vec4 color{1.0f}; ///< rgb = couleur, a = intensite
    float     range = 100.0f;
    float     spot_inner_cos = 0.95f;
    float     spot_outer_cos = 0.85f;
    bool      casts_shadow = false;
};

/// Composants pre-collectes pour le frame courant (FastAccessComponents).
///
/// Equivalent direct de la structure utilisee par OvCore::SceneRenderer.
/// Le renderer peut iterer chaque vecteur sans toucher l'ECS.
struct FastAccessComponents {
    std::vector<DrawableRef> drawables;
    std::vector<LightRef>    lights;
    CCamera*                 main_camera = nullptr; ///< Camera principale
    std::vector<CCamera*>    cameras;               ///< Toutes les cameras
};

/// Donnees d'entree d'un frame de rendu.
///
/// Passe au CompositeRenderer::render() puis distribue a chaque feature et
/// chaque pass. Les references CCamera et Actor* doivent rester valides pour
/// toute la duree du frame.
struct SceneDescriptor {
    uint32_t render_width  = 0;
    uint32_t render_height = 0;

    /// Ratio largeur/hauteur du viewport (auto-calcule si 0).
    float aspect_ratio = 0.0f;

    /// Composants pre-collectes (cameras, drawables, lumieres).
    FastAccessComponents components;

    /// Couleur de clear du framebuffer (RGBA8 packe).
    uint32_t clear_color = 0x1A1A2EFF;

    /// Frame index global (incremente par CompositeRenderer::render).
    uint64_t frame_index = 0;

    [[nodiscard]] bool is_valid() const noexcept {
        return render_width > 0 && render_height > 0 && components.main_camera != nullptr;
    }
};

} // namespace lives::render
