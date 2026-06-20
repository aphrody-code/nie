//! Rendu SOLIDE d'un personnage skinné animé : mesh (g4md/g4mg) déformé par un squelette g4sk
//! animé d'un g4mt, rasterisé en triangles pleins ombrés (Lambert + z-buffer) → frames PNG.
//! Usage : `cargo run -p nie-render3d --example anim_char -- <md> <mg> <g4sk> <g4pk> <outdir>`

use nie_formats::{g4md, g4mg, g4mt, g4pk, g4sk};
use nie_render3d::scene::{self, Camera, Tri};

fn xf(m: &[[f32; 4]; 4], p: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * p[0] + m[1][0] * p[1] + m[2][0] * p[2] + m[3][0],
        m[0][1] * p[0] + m[1][1] * p[1] + m[2][1] * p[2] + m[3][1],
        m[0][2] * p[0] + m[1][2] * p[1] + m[2][2] * p[2] + m[3][2],
    ]
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let md = g4md::parse(&std::fs::read(&a[1]).unwrap()).unwrap();
    let mg = std::fs::read(&a[2]).unwrap();
    let sk_bytes = std::fs::read(&a[3]).unwrap();
    let pk_bytes = std::fs::read(&a[4]).unwrap();
    let outdir = a.get(5).map_or("/tmp/animchar", String::as_str);
    std::fs::create_dir_all(outdir).unwrap();

    let geo = &g4mg::extract_geometry(&mg, &md)[0];
    let skin = g4mg::extract_skin(&mg, &md, 0).unwrap();
    let pos: Vec<[f32; 3]> = geo.positions.iter().map(|p| [p.x, p.y, p.z]).collect();
    let idx = &geo.indices;

    let header = g4sk::parse_header(&sk_bytes).unwrap();
    let bones = g4sk::parse_hierarchy(&sk_bytes, &header);
    let poses = g4sk::parse_poses(&sk_bytes, &header).unwrap();
    let parents: Vec<i16> = bones.bones.iter().map(|b| b.parent_index).collect();
    let nb = poses.len();

    let pk = g4pk::parse(&pk_bytes).unwrap();
    let f = pk.files.iter().find(|f| f.name.ends_with(".g4mt")).unwrap();
    let anim = g4mt::parse_animation(&pk_bytes[f.offset..f.offset + f.size]).unwrap();
    let rot: Vec<&g4mt::AnimChannel> = anim.channels.iter().filter(|c| c.is_rotation()).collect();
    let mut bone_chan = vec![None; nb];
    for (i, slot) in bone_chan.iter_mut().enumerate().take(rot.len() + 1).skip(1) {
        *slot = Some(i - 1);
    }
    println!("verts={} tris={} os={nb} frames={}", pos.len(), idx.len() / 3, anim.frame_count);

    // Caméra : devant le perso (~1.8 m), regard sur le tronc.
    let cam = Camera { eye: [0.0, 1.0, 3.2], target: [0.0, 0.95, 0.0], up: [0.0, 1.0, 0.0], fov_y: 0.6 };

    for frame in 0..anim.frame_count as usize {
        let mut world: Vec<[[f32; 4]; 4]> = Vec::with_capacity(nb);
        for i in 0..nb {
            let mut trs = poses[i].local;
            if let Some(ci) = bone_chan[i] {
                let s = &rot[ci].samples;
                let q = s[frame.min(s.len() - 1)];
                let n = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt().max(1e-6);
                trs.quat = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
            }
            let local = g4sk::local_matrix(&trs);
            let par = parents[i];
            world.push(if par < 0 || (par as usize) >= i {
                local
            } else {
                g4sk::mat_mul(&world[par as usize], &local)
            });
        }
        let skinm: Vec<[[f32; 4]; 4]> =
            (0..nb).map(|i| g4sk::mat_mul(&world[i], &poses[i].inverse_bind)).collect();

        // Positions skinnées.
        let sp: Vec<[f32; 3]> = (0..pos.len())
            .map(|v| {
                let s = &skin[v];
                let mut acc = [0.0f32; 3];
                let mut wsum = 0.0f32;
                for k in 0..8 {
                    let w = s.weights[k];
                    let b = s.bones[k] as usize;
                    if w <= 0.0 || b >= nb {
                        continue;
                    }
                    let tp = xf(&skinm[b], pos[v]);
                    for j in 0..3 {
                        acc[j] += w * tp[j];
                    }
                    wsum += w;
                }
                if wsum > 0.0 { [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum] } else { pos[v] }
            })
            .collect();

        // Triangles pleins (couleur peau/tissu uniforme).
        let mut tris = Vec::with_capacity(idx.len() / 3);
        for t in idx.chunks_exact(3) {
            let (i0, i1, i2) = (t[0] as usize, t[1] as usize, t[2] as usize);
            if i0 < sp.len() && i1 < sp.len() && i2 < sp.len() {
                tris.push(Tri { p: [sp[i0], sp[i1], sp[i2]], color: [180, 150, 130] });
            }
        }
        let px = scene::render_scene(&tris, &[], &cam, 480, 640, [30, 36, 54], [12, 14, 22]);
        // RGBA → écrire PNG.
        let mut out = Vec::new();
        {
            let mut e = png::Encoder::new(std::io::Cursor::new(&mut out), 480, 640);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            e.write_header().unwrap().write_image_data(&px).unwrap();
        }
        std::fs::write(format!("{outdir}/f{frame:03}.png"), &out).unwrap();
    }
    println!("→ {outdir}/f###.png");
}
