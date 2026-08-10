#pragma once

/// @file shaders_3d_embedded.h
/// Sources shader bgfx pour le rendu 3D skinne (VS + FS).
/// Les sources `.sc` sont embarquees sous forme de chaines pour doc / export.
/// La compilation runtime n'est pas supportee par bgfx : ces sources servent
/// a generer les binaires via `shaderc` dans le build pipeline.
///
/// Si les binaires embedded ne sont pas disponibles, `load_mesh_program()`
/// retourne BGFX_INVALID_HANDLE et le rendu est skippe silencieusement.

#include <bgfx/bgfx.h>

namespace iecode::render {

/// Source bgfx du vertex shader mesh skinne (GLSL bgfx-style).
/// Convention bgfx : `$input` / `$output` declarations + varying.def.sc
/// `u_boneMatrices` : array de 64 mat4 (slot utilisateur 0-15).
inline constexpr const char* kMeshVsSource = R"BGFX(
$input a_position, a_normal, a_texcoord0, a_indices, a_weight
$output v_normal, v_texcoord0

#include <bgfx_shader.sh>

uniform mat4 u_boneMatrices[64];

void main()
{
    // Skinning lineaire (4 bones par vertex)
    ivec4 idx = ivec4(a_indices * 255.0);
    vec4  w   = a_weight;

    mat4 skin =
        u_boneMatrices[idx.x] * w.x +
        u_boneMatrices[idx.y] * w.y +
        u_boneMatrices[idx.z] * w.z +
        u_boneMatrices[idx.w] * w.w;

    vec4 pos_local = skin * vec4(a_position, 1.0);
    gl_Position    = mul(u_modelViewProj, pos_local);

    vec3 n_local = (skin * vec4(a_normal, 0.0)).xyz;
    v_normal     = mul(u_model[0], vec4(n_local, 0.0)).xyz;
    v_texcoord0  = a_texcoord0;
}
)BGFX";

/// Source bgfx du fragment shader — Lambert diffuse + ambient + texture.
inline constexpr const char* kMeshFsSource = R"BGFX(
$input v_normal, v_texcoord0

#include <bgfx_shader.sh>

SAMPLER2D(s_albedo, 0);

void main()
{
    vec3 n = normalize(v_normal);
    vec3 light_dir = normalize(vec3(0.3, 1.0, 0.5));
    float ndotl = max(dot(n, light_dir), 0.0);

    vec3 ambient = vec3(0.25, 0.25, 0.28);
    vec3 diffuse = vec3(ndotl);

    vec4 tex = texture2D(s_albedo, v_texcoord0);
    gl_FragColor = vec4(tex.rgb * (ambient + diffuse), tex.a);
}
)BGFX";

/// Charge le programme mesh skinne. Retourne BGFX_INVALID_HANDLE si les
/// binaires compiles ne sont pas disponibles (rendu skip).
/// TODO : integrer les binaires via `bgfx::makeRef` + generateur shaderc.
[[nodiscard]] inline bgfx::ProgramHandle load_mesh_program() noexcept {
    return BGFX_INVALID_HANDLE;
}

} // namespace iecode::render
