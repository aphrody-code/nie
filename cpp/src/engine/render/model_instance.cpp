/// @file model_instance.cpp
/// Soumission d'une instance 3D au renderer bgfx.

#include "iecode/render/model_instance.h"

#include <bgfx/bgfx.h>

#include <array>

namespace iecode::render {

void ModelInstance::update(float dt) noexcept {
    if (anim != nullptr) anim->update(dt);
}

void ModelInstance::draw(bgfx::ProgramHandle prog) const noexcept {
    if (mesh == nullptr || !mesh->valid()) return;

    // Matrice modele globale.
    bgfx::setTransform(&transform[0][0]);

    // Bone palette locale — 32 slots (identique nie.exe).
    std::array<glm::mat4, kMaxBones> bones{};
    for (auto& m : bones) m = glm::mat4(1.f);

    if (anim != nullptr && anim->clip() != nullptr) {
        const auto* clip = anim->clip();
        for (const auto& track : clip->tracks) {
            if (track.bone_index < kMaxBones) {
                bones[track.bone_index] = anim->get_bone_transform(track.bone_index);
            }
        }
    }

    // Uniform mat3x4 (futur chemin GPU VS).
    mesh->update_bones(std::span<const glm::mat4>(bones.data(), bones.size()));

    // Skinning CPU fallback : ecrit les positions skinnees dans le
    // dynamic vertex buffer. Quand le compute shader skinning
    // (`shaders3d::H_CS_SKINNING = 0xa935f748`) sera branche, cet appel
    // sera remplace par un dispatch.
    mesh->skin_cpu_upload(std::span<const glm::mat4>(bones.data(), bones.size()));

    bgfx::TextureHandle tex = BGFX_INVALID_HANDLE;
    if (albedo != nullptr && albedo->valid()) tex = albedo->handle;

    mesh->draw(prog, draw_pass, tex);
}

} // namespace iecode::render

