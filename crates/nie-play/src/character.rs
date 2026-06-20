//! Rendu d'un **personnage 3D** (mesh skinné + texture BC7) en frame RGBA, pour servir de toile de
//! fond aux écrans du jeu (menu, histoire). Réutilise la chaîne validée : g4sk poses + skinning +
//! texture BC7 + `nie_render3d::scene::render_scene`. Pose de repos (pas d'animation ici).

use anyhow::{Context, Result};
use nie_formats::{g4md, g4mg, g4sk};
use nie_render3d::glb::{Model, Primitive, Texture};
use nie_render3d::scene::{self, Camera, Instance};

fn xf(m: &[[f32; 4]; 4], p: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * p[0] + m[1][0] * p[1] + m[2][0] * p[2] + m[3][0],
        m[0][1] * p[0] + m[1][1] * p[1] + m[2][1] * p[2] + m[3][1],
        m[0][2] * p[0] + m[1][2] * p[1] + m[2][2] * p[2] + m[3][2],
    ]
}

fn decode_bc7(bytes: &[u8]) -> Result<Texture> {
    use nie_formats::g4tx;
    let tx = g4tx::parse(bytes).map_err(|e| anyhow::anyhow!("g4tx: {e:?}"))?;
    let t = tx.textures.first().context("texture")?;
    let dds = &bytes[t.data_offset..];
    let off = if dds.len() >= 88 && &dds[84..88] == b"DX10" { 148 } else { 128 };
    let data = &dds[off..];
    let (w, h) = (t.width as usize, t.height as usize);
    let (bw, bh) = (w / 4, h / 4);
    let mut rgba = vec![0u8; w * h * 4];
    let mut blk = [0u8; 64];
    for by in 0..bh {
        for bx in 0..bw {
            let o = (by * bw + bx) * 16;
            if o + 16 > data.len() {
                break;
            }
            bcdec_rs::bc7(&data[o..o + 16], &mut blk, 16);
            for ry in 0..4 {
                for rx in 0..4 {
                    let d = ((by * 4 + ry) * w + bx * 4 + rx) * 4;
                    rgba[d..d + 4].copy_from_slice(&blk[ry * 16 + rx * 4..ry * 16 + rx * 4 + 4]);
                }
            }
        }
    }
    Ok(Texture { width: w as u32, height: h as u32, rgba })
}

/// Rend le personnage (pose de repos skinnée, texturé) sur un cadre `w×h`, fond dégradé.
/// `x_off` décale le perso horizontalement (espace monde) pour le placer à droite/gauche.
#[allow(clippy::too_many_arguments)] // fn de rendu : assets + dims + placement + fond.
pub fn render_character(
    md_bytes: &[u8],
    mg: &[u8],
    sk: &[u8],
    tex_bytes: &[u8],
    w: u32,
    h: u32,
    x_off: f32,
    bg_top: [u8; 3],
    bg_bot: [u8; 3],
) -> Result<Vec<u8>> {
    let md = g4md::parse(md_bytes).map_err(|e| anyhow::anyhow!("g4md: {e:?}"))?;
    let geo = g4mg::extract_geometry(mg, &md);
    let geo = geo.first().context("géométrie")?;
    let skin = g4mg::extract_skin(mg, &md, 0).context("skin")?;
    let pos: Vec<[f32; 3]> = geo.positions.iter().map(|p| [p.x, p.y, p.z]).collect();
    let uv: Vec<[f32; 2]> = geo.uv0.iter().map(|u| [u.u, u.v]).collect();
    let tex = decode_bc7(tex_bytes)?;

    let header = g4sk::parse_header(sk).map_err(|e| anyhow::anyhow!("g4sk: {e:?}"))?;
    let bones = g4sk::parse_hierarchy(sk, &header);
    let poses = g4sk::parse_poses(sk, &header).context("poses g4sk")?;
    let parents: Vec<i16> = bones.bones.iter().map(|b| b.parent_index).collect();
    let world = g4sk::rest_world_matrices(&poses, &parents);
    let nb = poses.len();
    let skinm: Vec<[[f32; 4]; 4]> =
        (0..nb).map(|i| g4sk::mat_mul(&world[i], &poses[i].inverse_bind)).collect();

    let sp: Vec<[f32; 3]> = (0..pos.len())
        .map(|v| {
            let s = &skin[v];
            let (mut acc, mut wsum) = ([0.0f32; 3], 0.0f32);
            for k in 0..8 {
                let (wt, b) = (s.weights[k], s.bones[k] as usize);
                if wt <= 0.0 || b >= nb {
                    continue;
                }
                let tp = xf(&skinm[b], pos[v]);
                for j in 0..3 {
                    acc[j] += wt * tp[j];
                }
                wsum += wt;
            }
            if wsum > 0.0 { [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum] } else { pos[v] }
        })
        .collect();

    let has_uv = uv.len() == pos.len();
    let prim = Primitive {
        positions: sp,
        normals: Vec::new(),
        uv: if has_uv { uv } else { Vec::new() },
        indices: geo.indices.clone(),
        texture: if has_uv { Some(0) } else { None },
    };
    let model = Model { primitives: vec![prim], textures: vec![tex] };
    let inst = Instance { model: &model, transform: scene::mat_translate([x_off, 0.0, 0.0]), two_sided: true };
    let cam = Camera { eye: [0.0, 1.05, 2.7], target: [x_off * 0.6, 0.95, 0.0], up: [0.0, 1.0, 0.0], fov_y: 0.62 };
    Ok(scene::render_scene(&[], &[inst], &cam, w, h, bg_top, bg_bot))
}
