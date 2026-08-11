#pragma once

/// @file gmd_obj_model.h
/// Composant modele 3D (lives::gmdCObjModelComponent, gmdCObjModelLodInfo).
/// gmdCDrawObjModelPriority utilise les passes de DrawPass.
///
/// Ce composant pilote le rendu D3D11 d'un mesh G4MG charge via le
/// ModelManager (CResMesh). Il s'enregistre comme RenderFeature dans
/// le RenderPipeline sur la passe CHARA_BEFORE par defaut.

#include "../core/object.h"
#include "../render/draw_pass.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#if defined(_WIN32)
struct ID3D11DeviceContext;
struct ID3D11Buffer;
#endif

namespace lives {

class  RenderPipeline;
class  ModelManager;
struct CCamera;
struct ModelResource;
using  CResMesh = ModelResource;

/// Informations de LOD pour un modele (lives::gmdCObjModelLodInfo).
struct gmdCObjModelLodInfo {
    float    distance_   = 0.f;   ///< Distance de transition LOD (max)
    uint32_t lod_level_  = 0;     ///< Niveau de LOD (0 = plus detaille)
    uint32_t mesh_index_ = 0;     ///< Index du mesh pour ce LOD
    bool     is_visible_ = true;
};

/// Composant modele 3D (lives::gmdCObjModelComponent).
struct gmdCObjModelComponent : CComponent {
    // ── Configuration ────────────────────────────────────────────────
    std::string mesh_path_;                             ///< Chemin VFS du G4MG
    DrawPass    draw_pass_       = DrawPass::CHARA_BEFORE;
    uint32_t    material_count_  = 0;
    bool        cast_shadow_     = true;
    bool        receive_shadow_  = true;

    // ── LOD ──────────────────────────────────────────────────────────
    std::vector<gmdCObjModelLodInfo> lods_;             ///< Trie par distance_ croissante
    gmdCObjModelLodInfo              current_lod_;      ///< LOD actif courant
    float                            lod_distance_ = 0.f;

    // ── Dependances injectees (non-owning) ───────────────────────────
    ModelManager* model_manager_     = nullptr;
    void*         vfs_               = nullptr;        ///< iecode::vfs::Vfs* opaque
    CCamera*      camera_            = nullptr;
    CResMesh*     cached_mesh_       = nullptr;
    CResMesh*     material_override_ = nullptr;        ///< Mesh dont on emprunte le materiau
#if defined(_WIN32)
    ID3D11DeviceContext* d3d_context_ = nullptr;
    ID3D11Buffer*        cbuffer_mvp_ = nullptr;       ///< Constant buffer 64 octets (mat4)
#endif

    // ── Cycle de vie ─────────────────────────────────────────────────

    /// Charge le mesh via VFS -> G4MG -> ID3D11Buffer*. Necessite que
    /// `model_manager_`, `vfs_` et `mesh_path_` soient renseignes.
    /// @return true si le mesh est pret a etre dessine.
    /// @note Hide volontairement CObject::initialize() (signature differente).
    [[nodiscard]] bool load();

    void finalize() override;

    /// Selectionne le LOD actif selon une distance camera->objet.
    /// Le LOD choisi est le premier dont `distance_` >= `distance`.
    void set_lod(float distance) noexcept;

    /// Override le materiau (on emprunte les buffers d'un autre mesh).
    void set_material(CResMesh* override_mesh) noexcept { material_override_ = override_mesh; }

    /// Soumet le draw call D3D11 si la passe correspond a `draw_pass_`.
    /// No-op si le mesh n'est pas charge ou si la passe ne correspond pas.
    void on_render(DrawPass pass);

    /// Enregistre ce composant comme RenderFeature dans le pipeline donne.
    /// La feature appellera `on_render(draw_pass_)` a chaque frame.
    /// @param priority  Ordre dans la passe (0 = premier).
    void register_with_pipeline(RenderPipeline& pipeline, uint32_t priority = 100);

    /// Retire la feature precedemment enregistree.
    void unregister_from_pipeline(RenderPipeline& pipeline);

    [[nodiscard]] std::string_view get_class_name() const override {
        return "gmdCObjModelComponent";
    }

private:
    bool        registered_       = false;
    std::string registered_name_;  ///< Nom unique sous lequel la feature est enregistree
};

} // namespace lives
