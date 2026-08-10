/// @file gmd_obj_model.cpp
/// Implementation du composant modele 3D (lives::gmdCObjModelComponent).
///
/// Charge un mesh G4MG via le ModelManager et soumet les drawcalls D3D11
/// dans la passe CHARA_BEFORE du RenderPipeline.

#include "iecode/engine/gmd/gmd_obj_model.h"

#include "iecode/engine/camera/camera.h"
#include "iecode/engine/render/render_pipeline.h"
#include "iecode/engine/res/model_manager.h"
#include "iecode/vfs/vfs.h"

#include <fmt/format.h>
#include <glm/mat4x4.hpp>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <cstdint>
#include <cstring>

#if defined(_WIN32)
#include <d3d11.h>
#endif

namespace lives {

// ── Helpers ─────────────────────────────────────────────────────────

namespace {

#if defined(_WIN32)
/// Cree un constant buffer dynamique de 64 octets pour la matrice MVP.
[[nodiscard]] ID3D11Buffer* create_mvp_cbuffer(ID3D11DeviceContext* ctx) noexcept {
    if (ctx == nullptr) return nullptr;

    ID3D11Device* device = nullptr;
    ctx->GetDevice(&device);
    if (device == nullptr) return nullptr;

    D3D11_BUFFER_DESC desc{};
    desc.ByteWidth      = sizeof(glm::mat4); // 64 octets
    desc.Usage          = D3D11_USAGE_DYNAMIC;
    desc.BindFlags      = D3D11_BIND_CONSTANT_BUFFER;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;

    ID3D11Buffer* buf = nullptr;
    const HRESULT hr = device->CreateBuffer(&desc, nullptr, &buf);
    device->Release();
    if (FAILED(hr)) {
        spdlog::error("gmdCObjModelComponent: CreateBuffer (cbuffer MVP) HRESULT={:#x}",
                      static_cast<uint32_t>(hr));
        return nullptr;
    }
    return buf;
}

/// Met a jour le cbuffer MVP avec la matrice courante de la camera.
void update_mvp_cbuffer(ID3D11DeviceContext* ctx, ID3D11Buffer* cbuffer,
                        const CCamera* camera) noexcept {
    if (ctx == nullptr || cbuffer == nullptr) return;

    glm::mat4 mvp(1.f);
    if (camera != nullptr) {
        mvp = camera->get_view_proj();
    }

    D3D11_MAPPED_SUBRESOURCE mapped{};
    const HRESULT hr = ctx->Map(cbuffer, 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped);
    if (FAILED(hr)) {
        spdlog::warn("gmdCObjModelComponent: Map cbuffer MVP HRESULT={:#x}",
                     static_cast<uint32_t>(hr));
        return;
    }
    std::memcpy(mapped.pData, &mvp[0][0], sizeof(glm::mat4));
    ctx->Unmap(cbuffer, 0);
}
#endif // _WIN32

} // namespace

// ── Cycle de vie ────────────────────────────────────────────────────

bool gmdCObjModelComponent::load() {
    if (cached_mesh_ != nullptr) {
        return true; // deja charge
    }

    if (model_manager_ == nullptr) {
        spdlog::error("gmdCObjModelComponent::initialize: model_manager_ nul");
        return false;
    }
    if (vfs_ == nullptr) {
        spdlog::error("gmdCObjModelComponent::initialize: vfs_ nul");
        return false;
    }
    if (mesh_path_.empty()) {
        spdlog::error("gmdCObjModelComponent::initialize: mesh_path_ vide");
        return false;
    }

    auto* vfs = static_cast<iecode::vfs::Vfs*>(vfs_);
    const ResourceId id = model_manager_->load_from_vfs(*vfs, mesh_path_);
    if (id == INVALID_RESOURCE_ID) {
        spdlog::error("gmdCObjModelComponent::initialize: load_from_vfs echec '{}'",
                      mesh_path_);
        return false;
    }

    cached_mesh_ = model_manager_->get(id);
    if (cached_mesh_ == nullptr) {
        spdlog::error("gmdCObjModelComponent::initialize: get(id={}) nul", id);
        return false;
    }

#if defined(_WIN32)
    if (d3d_context_ != nullptr && cbuffer_mvp_ == nullptr) {
        cbuffer_mvp_ = create_mvp_cbuffer(d3d_context_);
    }
#endif

    spdlog::debug("gmdCObjModelComponent: '{}' charge ({} vertices, {} indices)",
                  mesh_path_, cached_mesh_->vertex_count, cached_mesh_->index_count);
    return true;
}

void gmdCObjModelComponent::finalize() {
#if defined(_WIN32)
    if (cbuffer_mvp_ != nullptr) {
        cbuffer_mvp_->Release();
        cbuffer_mvp_ = nullptr;
    }
#endif
    // Le ModelManager possede les CResMesh — on ne libere pas cached_mesh_ ici.
    cached_mesh_       = nullptr;
    material_override_ = nullptr;
}

// ── LOD ─────────────────────────────────────────────────────────────

void gmdCObjModelComponent::set_lod(float distance) noexcept {
    lod_distance_ = distance;

    if (lods_.empty()) {
        current_lod_.lod_level_ = 0;
        current_lod_.distance_  = distance;
        return;
    }

    // lods_ doit etre trie par distance_ croissante. On selectionne le premier
    // dont la distance de transition est >= distance courante. Sinon le dernier.
    auto it = std::find_if(lods_.begin(), lods_.end(),
                           [distance](const gmdCObjModelLodInfo& l) {
                               return l.distance_ >= distance;
                           });
    if (it == lods_.end()) {
        it = std::prev(lods_.end());
    }
    current_lod_ = *it;
}

// ── Rendu D3D11 ─────────────────────────────────────────────────────

void gmdCObjModelComponent::on_render(DrawPass pass) {
    if (!enabled_) return;
    if (pass != draw_pass_) return;
    if (cached_mesh_ == nullptr) return;
    if (!current_lod_.is_visible_) return;

#if defined(_WIN32)
    if (d3d_context_ == nullptr) return;

    // Mesh dont on prend les buffers : override ou cache.
    const CResMesh* mesh = (material_override_ != nullptr) ? material_override_ : cached_mesh_;
    if (mesh->d3d_vertex_buffer == nullptr || mesh->d3d_index_buffer == nullptr) {
        return;
    }
    if (mesh->vertex_stride == 0 || mesh->index_count == 0) {
        return;
    }

    // Cbuffer MVP — cree paresseusement si pas encore alloue.
    if (cbuffer_mvp_ == nullptr) {
        cbuffer_mvp_ = create_mvp_cbuffer(d3d_context_);
    }
    update_mvp_cbuffer(d3d_context_, cbuffer_mvp_, camera_);

    // Bind cbuffer MVP au slot 0 du vertex shader.
    if (cbuffer_mvp_ != nullptr) {
        ID3D11Buffer* cbs[1] = { cbuffer_mvp_ };
        d3d_context_->VSSetConstantBuffers(0, 1, cbs);
    }

    // Bind vertex/index buffers.
    ID3D11Buffer* vbs[1] = { mesh->d3d_vertex_buffer };
    const UINT    strides[1] = { mesh->vertex_stride };
    const UINT    offsets[1] = { 0 };
    d3d_context_->IASetVertexBuffers(0, 1, vbs, strides, offsets);
    d3d_context_->IASetIndexBuffer(mesh->d3d_index_buffer, DXGI_FORMAT_R32_UINT, 0);
    d3d_context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);

    d3d_context_->DrawIndexed(mesh->index_count, 0, 0);
#else
    (void)pass;
#endif
}

// ── Enregistrement RenderPipeline ──────────────────────────────────

void gmdCObjModelComponent::register_with_pipeline(RenderPipeline& pipeline,
                                                   uint32_t priority) {
    if (registered_) {
        return;
    }

    // Nom unique base sur l'adresse du composant (evite les collisions).
    registered_name_ = fmt::format("gmd_obj_model@{:p}", static_cast<void*>(this));

    RenderFeature feature{
        .name     = registered_name_,
        .priority = priority,
        .execute  = [this](uint16_t /*view_id*/) { on_render(draw_pass_); },
        .enabled  = true,
    };
    pipeline.add_feature(draw_pass_, std::move(feature));
    registered_ = true;

    spdlog::debug("gmdCObjModelComponent: '{}' enregistre dans {} (prio={})",
                  mesh_path_, draw_pass_name(draw_pass_), priority);
}

void gmdCObjModelComponent::unregister_from_pipeline(RenderPipeline& pipeline) {
    if (!registered_) return;
    pipeline.remove_feature(draw_pass_, registered_name_);
    registered_      = false;
    registered_name_.clear();
}

} // namespace lives
