// Shader plein écran — un triangle couvrant tout le framebuffer.
// Les coordonnées UV sont dérivées des positions NDC pour que :
//   NDC (-1, +1) → UV (0, 0) = coin supérieur gauche de la texture
//   NDC (+1, -1) → UV (1, 1) = coin inférieur droit

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Vertex shader : génère un grand triangle depuis le vertex_index seul (pas de VBO).
// Sommet 0 : NDC (-1, -1) → UV (0, 1)
// Sommet 1 : NDC ( 3, -1) → UV (2, 1)
// Sommet 2 : NDC (-1,  3) → UV (0,-1)
// La formule UV : uv.x = (ndc.x + 1) / 2, uv.y = (1 - ndc.y) / 2
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
    var ndc = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 3.0, -1.0),
        vec2<f32>(-1.0,  3.0),
    );
    var uv = array<vec2<f32>, 3>(
        vec2<f32>(0.0,  1.0),
        vec2<f32>(2.0,  1.0),
        vec2<f32>(0.0, -1.0),
    );
    var out: VertexOutput;
    out.position = vec4<f32>(ndc[idx], 0.0, 1.0);
    out.uv = uv[idx];
    return out;
}

@group(0) @binding(0) var t_texture: texture_2d<f32>;
@group(0) @binding(1) var s_sampler: sampler;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return textureSample(t_texture, s_sampler, in.uv);
}
