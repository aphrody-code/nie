/// @file skinned_mesh.cpp
/// Construction d'un SkinnedMesh depuis un G4mgFile et soumission bgfx.

#include "iecode/render/skinned_mesh.h"

#include <bgfx/bgfx.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <vector>

namespace iecode::render {

namespace {

/// Layout skinne statique — initialise a la premiere utilisation.
bgfx::VertexLayout g_skinned_layout{};
bool               g_skinned_layout_ready = false;

void ensure_layout() noexcept {
    if (g_skinned_layout_ready) return;
    g_skinned_layout
        .begin()
        .add(bgfx::Attrib::Position,  3, bgfx::AttribType::Float)
        .add(bgfx::Attrib::Normal,    3, bgfx::AttribType::Float)
        .add(bgfx::Attrib::TexCoord0, 2, bgfx::AttribType::Float)
        .add(bgfx::Attrib::Indices,   4, bgfx::AttribType::Uint8, /*normalized=*/false, /*asInt=*/true)
        .add(bgfx::Attrib::Weight,    4, bgfx::AttribType::Uint8, /*normalized=*/true)
        .end();
    g_skinned_layout_ready = true;
}

} // namespace

void pack_mat3x4(const glm::mat4& m, glm::vec4* out) noexcept {
    // glm est column-major. On ecrit 3 lignes (x/y/z) composees des
    // composantes issues des 4 colonnes — identique au layout mat3x4
    // row-major de la bone palette nie.exe.
    out[0] = glm::vec4(m[0][0], m[1][0], m[2][0], m[3][0]);
    out[1] = glm::vec4(m[0][1], m[1][1], m[2][1], m[3][1]);
    out[2] = glm::vec4(m[0][2], m[1][2], m[2][2], m[3][2]);
}

const bgfx::VertexLayout& skinned_vertex_layout() noexcept {
    ensure_layout();
    return g_skinned_layout;
}

// ── RAII ────────────────────────────────────────────────────────────

SkinnedMesh::SkinnedMesh(SkinnedMesh&& other) noexcept
    : vbh(other.vbh),
      dyn_vbh(other.dyn_vbh),
      ibh(other.ibh),
      u_bones(other.u_bones),
      s_albedo(other.s_albedo),
      vertex_count(other.vertex_count),
      index_count(other.index_count),
      index_32bit(other.index_32bit),
      bind_vertices(std::move(other.bind_vertices)) {
    other.vbh          = BGFX_INVALID_HANDLE;
    other.dyn_vbh      = BGFX_INVALID_HANDLE;
    other.ibh          = BGFX_INVALID_HANDLE;
    other.u_bones      = BGFX_INVALID_HANDLE;
    other.s_albedo     = BGFX_INVALID_HANDLE;
    other.vertex_count = 0;
    other.index_count  = 0;
}

SkinnedMesh& SkinnedMesh::operator=(SkinnedMesh&& other) noexcept {
    if (this != &other) {
        destroy();
        vbh           = other.vbh;
        dyn_vbh       = other.dyn_vbh;
        ibh           = other.ibh;
        u_bones       = other.u_bones;
        s_albedo      = other.s_albedo;
        vertex_count  = other.vertex_count;
        index_count   = other.index_count;
        index_32bit   = other.index_32bit;
        bind_vertices = std::move(other.bind_vertices);
        other.vbh          = BGFX_INVALID_HANDLE;
        other.dyn_vbh      = BGFX_INVALID_HANDLE;
        other.ibh          = BGFX_INVALID_HANDLE;
        other.u_bones      = BGFX_INVALID_HANDLE;
        other.s_albedo     = BGFX_INVALID_HANDLE;
        other.vertex_count = 0;
        other.index_count  = 0;
    }
    return *this;
}

SkinnedMesh::~SkinnedMesh() { destroy(); }

void SkinnedMesh::destroy() {
    if (bgfx::isValid(vbh))      { bgfx::destroy(vbh);      vbh      = BGFX_INVALID_HANDLE; }
    if (bgfx::isValid(dyn_vbh))  { bgfx::destroy(dyn_vbh);  dyn_vbh  = BGFX_INVALID_HANDLE; }
    if (bgfx::isValid(ibh))      { bgfx::destroy(ibh);      ibh      = BGFX_INVALID_HANDLE; }
    if (bgfx::isValid(u_bones))  { bgfx::destroy(u_bones);  u_bones  = BGFX_INVALID_HANDLE; }
    if (bgfx::isValid(s_albedo)) { bgfx::destroy(s_albedo); s_albedo = BGFX_INVALID_HANDLE; }
    vertex_count = 0;
    index_count  = 0;
    bind_vertices.clear();
}

// ── Factory ─────────────────────────────────────────────────────────

std::optional<SkinnedMesh> SkinnedMesh::from_g4mg(const iecode::level5::G4mgFile& mesh) {
    if (mesh.meshes.empty()) {
        spdlog::warn("SkinnedMesh::from_g4mg: aucun mesh dans le G4mgFile");
        return std::nullopt;
    }
    const auto& src = mesh.meshes.front();
    if (src.vertices.empty() || src.indices.empty()) {
        spdlog::warn("SkinnedMesh::from_g4mg: mesh '{}' vide", src.name);
        return std::nullopt;
    }

    ensure_layout();

    // G4mgVertex n'expose que pos/normal/uv — on skinne par defaut a l'os 0
    // avec weight=255 (bone data pas encore extraite par le parser).
    std::vector<Vertex> verts;
    verts.reserve(src.vertices.size());
    for (const auto& v : src.vertices) {
        Vertex sv{};
        sv.pos[0]     = v.position[0];
        sv.pos[1]     = v.position[1];
        sv.pos[2]     = v.position[2];
        sv.normal[0]  = v.normal[0];
        sv.normal[1]  = v.normal[1];
        sv.normal[2]  = v.normal[2];
        sv.uv[0]      = v.uv[0];
        sv.uv[1]      = v.uv[1];
        sv.indices[0] = 0;
        sv.indices[1] = 0;
        sv.indices[2] = 0;
        sv.indices[3] = 0;
        sv.weights[0] = 255;  // poids 1.0 normalise
        sv.weights[1] = 0;
        sv.weights[2] = 0;
        sv.weights[3] = 0;
        verts.push_back(sv);
    }

    SkinnedMesh out;
    out.vertex_count = static_cast<uint32_t>(verts.size());

    const uint32_t vb_bytes =
        static_cast<uint32_t>(verts.size() * sizeof(Vertex));
    const bgfx::Memory* vmem = bgfx::copy(verts.data(), vb_bytes);
    out.vbh = bgfx::createVertexBuffer(vmem, g_skinned_layout);

    // Dynamic VB pour recevoir les sorties du skinning (CPU ou CS).
    out.dyn_vbh = bgfx::createDynamicVertexBuffer(
        out.vertex_count, g_skinned_layout, BGFX_BUFFER_NONE);

    // Copie bind-pose cote CPU pour le fallback `skin_cpu`.
    out.bind_vertices = std::move(verts);

    // Index buffer — 32-bit si > 65535 vertices, sinon 16-bit pour economiser.
    const bool need_32 = src.vertices.size() > 0xFFFFu;
    out.index_32bit = need_32;
    out.index_count = static_cast<uint32_t>(src.indices.size());

    if (need_32) {
        const bgfx::Memory* imem = bgfx::copy(
            src.indices.data(),
            static_cast<uint32_t>(src.indices.size() * sizeof(uint32_t)));
        out.ibh = bgfx::createIndexBuffer(imem, BGFX_BUFFER_INDEX32);
    } else {
        std::vector<uint16_t> idx16;
        idx16.reserve(src.indices.size());
        for (uint32_t i : src.indices) idx16.push_back(static_cast<uint16_t>(i));
        const bgfx::Memory* imem = bgfx::copy(
            idx16.data(),
            static_cast<uint32_t>(idx16.size() * sizeof(uint16_t)));
        out.ibh = bgfx::createIndexBuffer(imem);
    }

    // Bone palette identique a nie.exe : 32 mat3x4 = 96 vec4.
    out.u_bones = bgfx::createUniform(
        "u_bones", bgfx::UniformType::Vec4, kBonesVec4Count);
    out.s_albedo = bgfx::createUniform("s_albedo", bgfx::UniformType::Sampler);

    if (!out.valid()) {
        spdlog::error("SkinnedMesh::from_g4mg: echec creation buffers bgfx");
        out.destroy();
        return std::nullopt;
    }
    return out;
}

// ── Update / draw ──────────────────────────────────────────────────

void SkinnedMesh::update_bones(std::span<const glm::mat4> bone_matrices) const noexcept {
    if (!bgfx::isValid(u_bones)) return;
    const std::size_t n =
        std::min<std::size_t>(bone_matrices.size(), kMaxBones);
    if (n == 0) return;

    // Empaquette 3 vec4 par os (mat3x4), identique layout nie.exe.
    std::array<glm::vec4, kBonesVec4Count> packed{};
    for (std::size_t i = 0; i < n; ++i) {
        pack_mat3x4(bone_matrices[i], &packed[i * 3]);
    }
    // Les os restants sont laisses a zero — le shader doit clamp ou
    // le caller doit fournir l'identite.
    bgfx::setUniform(u_bones, packed.data(), static_cast<uint16_t>(n * 3));
}

void SkinnedMesh::skin_cpu(std::span<const glm::mat4> bones,
                           std::span<Vertex> out) const noexcept {
    if (out.size() < bind_vertices.size()) return;
    const std::size_t bone_count = bones.size();
    for (std::size_t i = 0; i < bind_vertices.size(); ++i) {
        const Vertex& v = bind_vertices[i];
        Vertex& o = out[i];
        o = v;  // copie uv/indices/weights

        // Accumulation ponderee TRS — on somme les contributions de 4 os.
        const glm::vec4 p(v.pos[0], v.pos[1], v.pos[2], 1.f);
        const glm::vec4 n(v.normal[0], v.normal[1], v.normal[2], 0.f);
        glm::vec4 acc_p(0.f);
        glm::vec4 acc_n(0.f);
        float total_w = 0.f;
        for (int j = 0; j < 4; ++j) {
            const uint8_t bi = v.indices[j];
            const float   w  = static_cast<float>(v.weights[j]) / 255.f;
            if (w <= 0.f || bi >= bone_count) continue;
            const glm::mat4& m = bones[bi];
            acc_p += (m * p) * w;
            acc_n += (m * n) * w;
            total_w += w;
        }
        if (total_w <= 0.f) {
            // Pas de bones valides — passe la bind-pose telle quelle.
            continue;
        }
        o.pos[0]    = acc_p.x;
        o.pos[1]    = acc_p.y;
        o.pos[2]    = acc_p.z;
        o.normal[0] = acc_n.x;
        o.normal[1] = acc_n.y;
        o.normal[2] = acc_n.z;
    }
}

void SkinnedMesh::skin_cpu_upload(std::span<const glm::mat4> bones) noexcept {
    if (!bgfx::isValid(dyn_vbh) || bind_vertices.empty()) return;
    std::vector<Vertex> out(bind_vertices.size());
    skin_cpu(bones, out);
    const uint32_t bytes =
        static_cast<uint32_t>(out.size() * sizeof(Vertex));
    const bgfx::Memory* mem = bgfx::copy(out.data(), bytes);
    bgfx::update(dyn_vbh, 0, mem);
}

void SkinnedMesh::draw(bgfx::ProgramHandle prog,
                       uint8_t view_id,
                       bgfx::TextureHandle tex) const noexcept {
    if (!valid()) return;
    if (!bgfx::isValid(prog)) {
        // Programme non disponible (shaders 3D pas encore compiles) — skip.
        return;
    }
    if (bgfx::isValid(dyn_vbh)) {
        bgfx::setVertexBuffer(0, dyn_vbh);
    } else {
        bgfx::setVertexBuffer(0, vbh);
    }
    bgfx::setIndexBuffer(ibh, 0, index_count);
    if (bgfx::isValid(tex) && bgfx::isValid(s_albedo)) {
        bgfx::setTexture(0, s_albedo, tex);
    }
    bgfx::setState(
        BGFX_STATE_WRITE_RGB
      | BGFX_STATE_WRITE_A
      | BGFX_STATE_WRITE_Z
      | BGFX_STATE_DEPTH_TEST_LESS
      | BGFX_STATE_CULL_CCW
      | BGFX_STATE_MSAA);
    bgfx::submit(view_id, prog);
}

} // namespace iecode::render
