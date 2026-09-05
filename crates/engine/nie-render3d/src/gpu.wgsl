// Pipeline de rendu 3D GPU du viewport niers.
//
// Reproduit les règles du rastériseur CPU de référence (`render.rs`) pour que les deux chemins
// restent comparables : projection perspective, éclairage Lambert sur la normale, échantillonnage
// de l'atlas texture, découpe alpha (cutout) plutôt que transparence triée, et repli « argile »
// gris pour les primitives sans texture.

struct Camera {
    view_proj: mat4x4<f32>,
    // Rotation des normales : le CPU tourne le modèle sous une lumière fixe, ici la caméra
    // orbite — sans cette matrice, la lumière tournerait avec l'objet.
    normal_rot: mat4x4<f32>,
    // xyz = direction de la lumière (normalisée), w = padding explicite.
    light: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var atlas: texture_2d<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct VertexIn {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) has_texture: f32,
};

struct VertexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) has_texture: f32,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_position = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.normal = in.normal;
    out.uv = in.uv;
    out.has_texture = in.has_texture;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    // Éclairage aligné sur le rastériseur CPU de référence (`render.rs`), qui est la vérité
    // terrain des goldens — il ne l'était pas : borne 0.25/0.75 contre 0.35/0.65, et `max(·,0)`
    // contre `abs(·)`. La valeur absolue éclaire une face dos à la lumière comme si elle lui
    // faisait face : ce n'est pas physique, mais sur des modèles dont le winding n'est pas
    // toujours cohérent, cela évite des pans entièrement noirs.
    let n = normalize((camera.normal_rot * vec4<f32>(in.normal, 0.0)).xyz);
    let lambert = abs(dot(n, normalize(camera.light.xyz)));
    let lit = 0.35 + 0.65 * lambert;

    var base: vec4<f32>;
    if (in.has_texture > 0.5) {
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
