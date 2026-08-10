#pragma once

/// @file skinned_mesh.h
/// Mesh 3D skinne — layout fidele a nie.exe.
///
/// nie.exe realise le skinning via un **compute shader** (`0xa935f748`,
/// groupe `0xefb0323b`, type 0x19) qui ecrit les positions skinnees dans
/// un dynamic vertex buffer. La bone palette est a `renderObj+0x1D98`
/// et contient 32 matrices mat3x4 (0x200 bytes).
///
/// Cote iecode on expose :
///  - un chemin CPU fallback (`skin_cpu`) pour bootstraper sans compute
///    shader compile
///  - un uniform bgfx `u_bones` de 96 vec4 (32 * mat3x4) pour un futur
///    chemin GPU (VS classique ou CS)
///  - un dynamic vertex buffer optionnel pour recevoir les sorties du CS.

#include "iecode/formats/level5/g4mg.h"
#include "iecode/render/shaders_3d.h"

#include <bgfx/bgfx.h>
#include <glm/glm.hpp>

#include <cstdint>
#include <optional>
#include <span>
#include <vector>

namespace iecode::render {

/// Nombre maximum d'os — fixe a 32 pour matcher la bone palette nie.exe
/// (`renderObj+0x1D98`, 0x200 bytes = 32 mat3x4).
inline constexpr uint32_t kMaxBones = shaders3d::MAX_BONES_NIE;

/// Nombre de vec4 dans l'uniform `u_bones` : 32 os * 3 lignes = 96.
inline constexpr uint32_t kBonesVec4Count = kMaxBones * 3U;

/// Vertex CPU-side (position + normal + uv + bone indices/weights).
/// Utilise pour le fallback CPU skinning.
struct Vertex {
    float   pos[3]{};
    float   normal[3]{};
    float   uv[2]{};
    uint8_t indices[4]{};
    uint8_t weights[4]{};
};
static_assert(sizeof(Vertex) == 40, "Vertex doit faire 40 octets (layout bgfx)");

/// Mesh skinne pret a etre soumis au GPU. Move-only, RAII.
struct SkinnedMesh {
    bgfx::VertexBufferHandle        vbh          = BGFX_INVALID_HANDLE; ///< Bind-pose statique (source)
    bgfx::DynamicVertexBufferHandle dyn_vbh      = BGFX_INVALID_HANDLE; ///< Sortie skinning CPU/CS
    bgfx::IndexBufferHandle         ibh          = BGFX_INVALID_HANDLE;
    /// Uniform `u_bones` : 32 matrices mat3x4 empaquetees en 96 vec4.
    /// Correspond a la bone palette nie.exe (`renderObj+0x1D98`).
    bgfx::UniformHandle             u_bones      = BGFX_INVALID_HANDLE;
    bgfx::UniformHandle             s_albedo     = BGFX_INVALID_HANDLE; ///< sampler texture diffuse
    uint32_t                        vertex_count = 0;
    uint32_t                        index_count  = 0;
    bool                            index_32bit  = false;

    /// Copie CPU des vertices bind-pose (utilisee par `skin_cpu`).
    std::vector<Vertex> bind_vertices;

    SkinnedMesh() = default;
    SkinnedMesh(const SkinnedMesh&)            = delete;
    SkinnedMesh& operator=(const SkinnedMesh&) = delete;
    SkinnedMesh(SkinnedMesh&& other) noexcept;
    SkinnedMesh& operator=(SkinnedMesh&& other) noexcept;
    ~SkinnedMesh();

    /// Indique si le mesh est pret a etre dessine.
    [[nodiscard]] bool valid() const noexcept {
        return bgfx::isValid(vbh) && bgfx::isValid(ibh);
    }

    /// Libere les handles bgfx.
    void destroy();

    /// Cree un mesh skinne depuis un G4mgFile. Utilise le premier mesh + ses vertices.
    /// Si le G4mgFile ne contient pas de bone indices/weights, les vertices sont
    /// skinnes a l'os 0 avec weight 1.0 (equivalent a un mesh statique).
    [[nodiscard]] static std::optional<SkinnedMesh> from_g4mg(
        const iecode::level5::G4mgFile& mesh);

    /// Met a jour l'uniform `u_bones` pour le prochain drawcall.
    /// Chaque mat4 est compresse en mat3x4 (3 lignes * vec4), identique
    /// au layout de la bone palette nie.exe. Tronque a `kMaxBones`.
    void update_bones(std::span<const glm::mat4> bone_matrices) const noexcept;

    /// Skinning CPU fallback — applique `bones` a `bind_vertices`, ecrit
    /// les positions/normales skinnees dans `out` et pousse le resultat
    /// dans le dynamic vertex buffer si present.
    /// `out.size()` doit etre >= `bind_vertices.size()`.
    void skin_cpu(std::span<const glm::mat4> bones,
                  std::span<Vertex> out) const noexcept;

    /// Variante qui alloue et upload directement dans le dynamic VB.
    /// No-op si `dyn_vbh` invalide.
    void skin_cpu_upload(std::span<const glm::mat4> bones) noexcept;

    /// Soumet un drawcall. `tex` peut etre BGFX_INVALID_HANDLE (pas de sampler bind).
    /// Utilise `dyn_vbh` s'il est valide (sortie skinning), sinon `vbh` (bind-pose).
    void draw(bgfx::ProgramHandle prog,
              uint8_t view_id,
              bgfx::TextureHandle tex = BGFX_INVALID_HANDLE) const noexcept;
};

/// Vertex layout skinne : position(3f) + normal(3f) + uv(2f) + indices(4u8)
/// + weights(4u8 normalized). Stride total : 40 octets.
[[nodiscard]] const bgfx::VertexLayout& skinned_vertex_layout() noexcept;

/// Empaquette une mat4 en 3 vec4 (mat3x4, row-major) — layout bone palette
/// nie.exe. `out` doit pointer sur au moins 3 vec4 consecutifs.
void pack_mat3x4(const glm::mat4& m, glm::vec4* out) noexcept;

} // namespace iecode::render
