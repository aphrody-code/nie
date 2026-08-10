// Pipeline de rendu 3D GPU du viewport niers.
//
// Reproduit les règles du rastériseur CPU de référence (`render.rs`) pour que les deux chemins
// restent comparables : projection perspective, éclairage Lambert sur la normale, échantillonnage
// de l'atlas texture, découpe alpha (cutout) plutôt que transparence triée, et repli « argile »
// gris pour les primitives sans texture.

struct Camera {
    view_proj: mat4x4<f32>,
    // xyz = direction de la lumière (normalisée), w = 1.0 si la primitive a une texture.
    light: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var atlas: texture_2d<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
};

struct VertexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_position = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.normal = in.normal;
    out.uv = in.uv;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    // Lambert borné à 0.25 d'ambiante : sans plancher, les faces opposées à la lumière tombent à
    // zéro et le modèle devient une silhouette noire — le rastériseur CPU applique la même borne.
    let n = normalize(in.normal);
    let lambert = max(dot(n, normalize(camera.light.xyz)), 0.0);
    let lit = 0.25 + 0.75 * lambert;

    var base: vec4<f32>;
    if (camera.light.w > 0.5) {
        base = textureSample(atlas, atlas_sampler, in.uv);
    } else {
        // Repli argile — même gris neutre que le CPU pour les primitives sans atlas.
        base = vec4<f32>(0.72, 0.72, 0.74, 1.0);
    }

    // Cutout : un fragment quasi transparent est rejeté au lieu d'être mélangé. Les atlas du jeu
    // utilisent l'alpha comme masque (cheveux, cils), pas comme translucidité — le mélanger
    // donnerait des halos et exigerait un tri par profondeur qu'un éditeur n'a pas à faire.
    if (base.a < 0.5) {
        discard;
    }

    return vec4<f32>(base.rgb * lit, 1.0);
}
