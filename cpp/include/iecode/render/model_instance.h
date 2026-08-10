#pragma once

/// @file model_instance.h
/// Instance 3D a dessiner : transform monde + mesh skinne + texture albedo
/// + player d'animation. Reference non-owning — le proprietaire des ressources
/// est responsable de leur cycle de vie.

#include "iecode/engine/anim/anim_player.h"
#include "iecode/render/res_texture.h"
#include "iecode/render/skinned_mesh.h"

#include <bgfx/bgfx.h>
#include <glm/glm.hpp>

#include <cstdint>
#include <string>
#include <string_view>

namespace iecode::render {

/// Convention de chemin VFS pour un modele personnage nie.exe :
/// `common/chr/{charaId}/{charaId}.g4md`. Le loader du moteur applique
/// ce pattern sur l'identifiant de personnage.
inline constexpr std::string_view kCharaModelPathFmt =
    "common/chr/{0}/{0}.g4md";

/// Construit le chemin VFS du modele d'un personnage a partir de son id.
/// Ex : `build_chara_model_path("chr001")` -> `"common/chr/chr001/chr001.g4md"`.
[[nodiscard]] inline std::string build_chara_model_path(std::string_view chara_id) {
    std::string out;
    out.reserve(11 + 2 * chara_id.size() + 5);
    out.append("common/chr/");
    out.append(chara_id);
    out.push_back('/');
    out.append(chara_id);
    out.append(".g4md");
    return out;
}

/// Instance de modele — transform + ressources partagees + anim player.
/// Les pointeurs mesh/albedo/anim peuvent etre null (rendu skip / pas d'anim).
struct ModelInstance {
    glm::mat4      transform = glm::mat4(1.f);
    SkinnedMesh*   mesh      = nullptr;
    ResTexture*    albedo    = nullptr;
    lives::AnimPlayer* anim  = nullptr;
    uint8_t        draw_pass = 10;  ///< View id bgfx — 10 = pass MAP/3D par defaut

    /// Avance le temps de l'animation attachee (no-op si anim == nullptr).
    void update(float dt) noexcept;

    /// Calcule les matrices d'os depuis l'anim player et soumet un drawcall.
    /// Si pas d'anim, toutes les matrices sont identite.
    void draw(bgfx::ProgramHandle prog) const noexcept;
};

} // namespace iecode::render
