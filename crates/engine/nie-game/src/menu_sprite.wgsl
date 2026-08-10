// menu_sprite.wgsl — shader de rendu de sprite 2D pour le compositeur GPU menu.
//
// Vertex input : positions NDC précalculées (depuis les coins du quad affine du sprite)
// + coordonnées UV normalisées (0..1, ClampToEdge).
//
// Flux blend (premultiplié-alpha over) :
//   Les textures sont uploadées pré-multipliées (RGB *= A/255 côté CPU).
//   Le pipeline est configuré avec blend (One, OneMinusSrcAlpha) pour color ET alpha :
//     out_pm_color = pm_src + (1 - src_alpha) * pm_dst
//     out_alpha    = src_alpha + (1 - src_alpha) * dst_alpha
//   Après readback, les valeurs RGB sont dépré-multipliées côté CPU pour restaurer
//   des valeurs straight-alpha comparables au compositeur de référence.
//
//   Écart vs CPU straight-alpha : ≤1-2 LSB par canal (arrondi entier pré/dépré-mult).

struct VertexInput {
    @location(0) pos: vec2<f32>,
    @location(1) uv:  vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0)       uv:      vec2<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(in.pos, 0.0, 1.0);
    out.uv = in.uv;
    return out;
}

@group(0) @binding(0) var t_sprite: texture_2d<f32>;
@group(0) @binding(1) var s_linear: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(t_sprite, s_linear, in.uv);
}
