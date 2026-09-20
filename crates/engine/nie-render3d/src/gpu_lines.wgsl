// Pipeline de LIGNES du viewport niers — grille, fil de fer, contour de sélection, gizmo.
//
// Séparé de `gpu.wgsl` parce qu'il ne partage presque rien avec lui : pas de normale, pas d'UV,
// pas d'atlas, pas d'éclairage. Un segment porte sa couleur et rien d'autre. Les fusionner
// aurait demandé de transporter quatre attributs morts par sommet de ligne, et un branchement
// dans le fragment shader pour les ignorer.
//
// Il réutilise en revanche le MÊME uniforme de caméra (`@group(0) @binding(0)`), et c'est la
// condition pour que les lignes et la géométrie se superposent exactement : deux matrices de vue
// calculées séparément dériveraient d'un demi-pixel, et une grille de sol flotterait au-dessus
// du sol.

struct Camera {
    view_proj: mat4x4<f32>,
    normal_rot: mat4x4<f32>,
    light: vec4<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexIn {
    @location(0) position: vec3<f32>,
    // Couleur linéaire 0..1. La conversion depuis l'octet est faite côté Rust, une fois par
    // téléversement, plutôt qu'à chaque sommet.
    @location(1) color: vec3<f32>,
};

struct VertexOut {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out: VertexOut;
    out.clip_position = camera.view_proj * vec4<f32>(in.position, 1.0);
    out.color = in.color;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color, 1.0);
}
