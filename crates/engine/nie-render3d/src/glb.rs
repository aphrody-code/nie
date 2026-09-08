//! Parseur **GLB** (glTF binaire 2.0) minimal — extrait la géométrie (positions/normales/UV/indices)
//! **et les textures** (PNG embarqués) des primitives de mesh. Les transforms glTF des nœuds et le
//! skinning de la pose de liaison sont cuits dans les sommets au chargement : les consommateurs
//! historiques gardent donc leur API `Model`/`Primitive`, tout en recevant de la géométrie monde.
//! La chaîne matériau→texture est résolue
//! (`primitive.material → materials[].baseColorTexture → textures[].source → images[]`).

use anyhow::{Context, Result, bail};
use nie_core::animation::{BoneId, BonePose, PoseFrame, Rotation, SkeletonId};
use serde_json::Value;

/// Une texture décodée en RGBA8 (atlas du modèle : corps, visage, uniforme…).
#[derive(Clone)]
pub struct Texture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Une primitive de mesh : triangles indexés, positions + normales + UV (espace monde),
/// et l'indice de sa texture dans [`Model::textures`] (s'il y en a une).
#[derive(Clone)]
pub struct Primitive {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uv: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub texture: Option<usize>,
}

/// Modèle GLB chargé : toutes les primitives + les atlas de textures décodés.
#[derive(Clone)]
pub struct Model {
    pub primitives: Vec<Primitive>,
    pub textures: Vec<Texture>,
}

fn rd_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// Décode un PNG (n'importe quel type de couleur) en RGBA8.
fn decode_png(bytes: &[u8]) -> Result<Texture> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = dec.read_info().context("png read_info")?;
    let bufsz = reader
        .output_buffer_size()
        .context("png output_buffer_size (overflow)")?;
    let mut buf = vec![0u8; bufsz];
    let info = reader.next_frame(&mut buf).context("png next_frame")?;
    let (w, h) = (info.width, info.height);
    let n = (w as usize) * (h as usize);
    let mut rgba = vec![0u8; n * 4];
    match info.color_type {
        png::ColorType::Rgba => rgba.copy_from_slice(&buf[..n * 4]),
        png::ColorType::Rgb => {
            for i in 0..n {
                rgba[i * 4] = buf[i * 3];
                rgba[i * 4 + 1] = buf[i * 3 + 1];
                rgba[i * 4 + 2] = buf[i * 3 + 2];
                rgba[i * 4 + 3] = 255;
            }
        }
        png::ColorType::Grayscale => {
            for i in 0..n {
                let g = buf[i];
                rgba[i * 4] = g;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = g;
                rgba[i * 4 + 3] = 255;
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for i in 0..n {
                let g = buf[i * 2];
                rgba[i * 4] = g;
                rgba[i * 4 + 1] = g;
                rgba[i * 4 + 2] = g;
                rgba[i * 4 + 3] = buf[i * 2 + 1];
            }
        }
        png::ColorType::Indexed => bail!("PNG indexé non normalisé"),
    }
    Ok(Texture {
        width: w,
        height: h,
        rgba,
    })
}

/// `primitive.material → materials[m].pbr.baseColorTexture.index → textures[t].source` (indice image).
fn material_image(root: &Value, mat_idx: usize) -> Option<usize> {
    let m = root["materials"].as_array()?.get(mat_idx)?;
    let t = m["pbrMetallicRoughness"]["baseColorTexture"]["index"].as_u64()? as usize;
    let src = root["textures"].as_array()?.get(t)?["source"].as_u64()? as usize;
    Some(src)
}

type Mat4 = [[f32; 4]; 4];

/// A matrix accepted by the CPU skinning adapter (row-major affine convention).
pub type SkinMatrix = [[f32; 4]; 4];

/// One joint in a format-neutral CPU skinning binding.
///
/// This is deliberately separate from [`Model`] and [`Primitive`].  Existing callers that only
/// need the historical bind-pose geometry therefore keep compiling unchanged, while loaders that
/// retain skin metadata can opt into [`apply_pose_cpu`].  `inverse_bind` must be the inverse of
/// the joint's world matrix in the bind pose; `bind_local` is the local matrix used when a pose
/// does not contain this bone.
#[derive(Debug, Clone, Copy)]
pub struct SkinJoint {
    pub bone: BoneId,
    pub parent: Option<usize>,
    pub bind_local: SkinMatrix,
    pub inverse_bind: SkinMatrix,
}

/// Vertex attributes required by the CPU skinning adapter (up to eight influences).
#[derive(Debug, Clone, Copy)]
pub struct SkinVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub joints: [u16; 8],
    pub weights: [f32; 8],
}

/// A mesh plus its skeleton binding, independent of any file format.
#[derive(Debug, Clone)]
pub struct CpuSkinnedMesh {
    pub skeleton: SkeletonId,
    pub joints: Vec<SkinJoint>,
    pub vertices: Vec<SkinVertex>,
}

/// Result of applying one local [`PoseFrame`] to a CPU-skinned mesh.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SkinnedVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

fn identity() -> Mat4 {
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut out = [[0.0; 4]; 4];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    out
}

fn transform(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    ]
}

fn transform_direction(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2],
    ]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l > 1e-8 {
        [v[0] / l, v[1] / l, v[2] / l]
    } else {
        v
    }
}

/// glTF stores matrices column-major, while the renderer uses row-major affine matrices.
fn matrix_from_gltf(values: &[f32]) -> Mat4 {
    let mut m = [[0.0; 4]; 4];
    for r in 0..4 {
        for c in 0..4 {
            m[r][c] = values[c * 4 + r];
        }
    }
    m
}

#[allow(clippy::collapsible_if)]
fn node_local(node: &Value) -> Mat4 {
    if let Some(values) = node["matrix"].as_array() {
        if values.len() == 16 {
            let mut v = [0.0; 16];
            for (i, value) in values.iter().enumerate() {
                v[i] = value.as_f64().unwrap_or(0.0) as f32;
            }
            return matrix_from_gltf(&v);
        }
    }
    let mut m = identity();
    let t = node["translation"]
        .as_array()
        .map(|a| {
            [
                a.first().and_then(Value::as_f64).unwrap_or(0.0) as f32,
                a.get(1).and_then(Value::as_f64).unwrap_or(0.0) as f32,
                a.get(2).and_then(Value::as_f64).unwrap_or(0.0) as f32,
            ]
        })
        .unwrap_or([0.0; 3]);
    let s = node["scale"]
        .as_array()
        .map(|a| {
            [
                a.first().and_then(Value::as_f64).unwrap_or(1.0) as f32,
                a.get(1).and_then(Value::as_f64).unwrap_or(1.0) as f32,
                a.get(2).and_then(Value::as_f64).unwrap_or(1.0) as f32,
            ]
        })
        .unwrap_or([1.0; 3]);
    let q = node["rotation"]
        .as_array()
        .map(|a| {
            [
                a.first().and_then(Value::as_f64).unwrap_or(0.0) as f32,
                a.get(1).and_then(Value::as_f64).unwrap_or(0.0) as f32,
                a.get(2).and_then(Value::as_f64).unwrap_or(0.0) as f32,
                a.get(3).and_then(Value::as_f64).unwrap_or(1.0) as f32,
            ]
        })
        .unwrap_or([0.0, 0.0, 0.0, 1.0]);
    let [x, y, z, w] = q;
    m[0][0] = (1.0 - 2.0 * (y * y + z * z)) * s[0];
    m[0][1] = (2.0 * (x * y - z * w)) * s[1];
    m[0][2] = (2.0 * (x * z + y * w)) * s[2];
    m[1][0] = (2.0 * (x * y + z * w)) * s[0];
    m[1][1] = (1.0 - 2.0 * (x * x + z * z)) * s[1];
    m[1][2] = (2.0 * (y * z - x * w)) * s[2];
    m[2][0] = (2.0 * (x * z - y * w)) * s[0];
    m[2][1] = (2.0 * (y * z + x * w)) * s[1];
    m[2][2] = (1.0 - 2.0 * (x * x + y * y)) * s[2];
    m[0][3] = t[0];
    m[1][3] = t[1];
    m[2][3] = t[2];
    m
}

fn node_world(
    index: usize,
    nodes: &[Value],
    cache: &mut [Option<Mat4>],
    state: &mut [bool],
) -> Result<Mat4> {
    if let Some(m) = cache[index] {
        return Ok(m);
    }
    if state[index] {
        bail!("cycle de nœuds glTF");
    }
    state[index] = true;
    let parent = nodes.iter().enumerate().find_map(|(i, n)| {
        n["children"]
            .as_array()?
            .iter()
            .any(|c| c.as_u64() == Some(index as u64))
            .then_some(i)
    });
    let local = node_local(&nodes[index]);
    let world = match parent {
        Some(p) => mat_mul(&node_world(p, nodes, cache, state)?, &local),
        None => local,
    };
    state[index] = false;
    cache[index] = Some(world);
    Ok(world)
}

/// Parse un buffer GLB complet (géométrie + textures embarquées).
///
/// # Errors
/// Si le magic n'est pas « glTF », si les chunks JSON/BIN manquent, ou si le glTF est malformé.
#[allow(clippy::collapsible_if)]
pub fn parse(data: &[u8]) -> Result<Model> {
    if data.len() < 12 || &data[0..4] != b"glTF" {
        bail!("pas un GLB (magic 'glTF' absent)");
    }
    // En-tête 12 o, puis chunks {len u32, type u32, data}.
    let mut json: Option<&[u8]> = None;
    let mut bin: Option<&[u8]> = None;
    let mut off = 12usize;
    while off + 8 <= data.len() {
        let clen = rd_u32(data, off) as usize;
        let ctype = rd_u32(data, off + 4);
        let start = off + 8;
        let end = start.checked_add(clen).context("chunk hors limites")?;
        if end > data.len() {
            bail!("chunk GLB hors limites");
        }
        match ctype {
            0x4E4F_534A => json = Some(&data[start..end]), // "JSON"
            0x004E_4942 => bin = Some(&data[start..end]),  // "BIN\0"
            _ => {}
        }
        off = end;
    }
    let json = json.context("chunk JSON absent")?;
    let bin = bin.context("chunk BIN absent")?;
    let root: Value = serde_json::from_slice(json).context("JSON glTF invalide")?;

    let accessors = root["accessors"].as_array().context("accessors absents")?;
    let views = root["bufferViews"]
        .as_array()
        .context("bufferViews absents")?;

    // Lit un accessor scalaire/vecteur en f32 (composantes consécutives).
    let read_floats = |acc_idx: usize, ncomp: usize| -> Result<Vec<f32>> {
        let acc = accessors.get(acc_idx).context("accessor hors limites")?;
        let bv = views
            .get(acc["bufferView"].as_u64().context("bufferView")? as usize)
            .context("bufferView hors limites")?;
        let comp_ty = acc["componentType"].as_u64().context("componentType")?;
        let count = acc["count"].as_u64().context("count")? as usize;
        let view_start = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
        let view_end = view_start
            .checked_add(bv["byteLength"].as_u64().context("byteLength")? as usize)
            .context("bufferView déborde")?;
        let base = view_start
            .checked_add(acc["byteOffset"].as_u64().unwrap_or(0) as usize)
            .context("offset accessor déborde")?;
        let comp_sz = match comp_ty {
            5126 => 4,
            5125 => 4,
            5123 => 2,
            5121 => 1,
            other => bail!("componentType {other} non géré"),
        };
        let stride = bv["byteStride"]
            .as_u64()
            .map(|s| s as usize)
            .unwrap_or(ncomp * comp_sz);
        let element_size = ncomp * comp_sz;
        let end = if count == 0 {
            base
        } else {
            (count - 1)
                .checked_mul(stride)
                .and_then(|n| base.checked_add(n))
                .and_then(|n| n.checked_add(element_size))
                .context("taille accessor déborde")?
        };
        if stride < element_size || end > view_end || view_end > bin.len() {
            bail!("accessor hors du bufferView ou du chunk BIN");
        }
        let mut out = Vec::with_capacity(count * ncomp);
        for i in 0..count {
            let p = base + i * stride;
            for c in 0..ncomp {
                let q = p + c * comp_sz;
                let v = match comp_ty {
                    5126 => f32::from_le_bytes([bin[q], bin[q + 1], bin[q + 2], bin[q + 3]]),
                    5125 => rd_u32(bin, q) as f32,
                    5123 => u16::from_le_bytes([bin[q], bin[q + 1]]) as f32,
                    5121 => f32::from(bin[q]),
                    _ => unreachable!(),
                };
                out.push(v);
            }
        }
        Ok(out)
    };

    // Décode les atlas PNG embarqués (indexés par numéro d'image glTF).
    let mut textures = Vec::new();
    if let Some(imgs) = root["images"].as_array() {
        for im in imgs {
            let bvi = im["bufferView"].as_u64().context("image bufferView")? as usize;
            let bv = views.get(bvi).context("image bufferView hors limites")?;
            let bo = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
            let bl = bv["byteLength"].as_u64().context("image byteLength")? as usize;
            let end = bo.checked_add(bl).context("image déborde")?;
            textures.push(decode_png(
                bin.get(bo..end).context("image hors du chunk BIN")?,
            )?);
        }
    }

    // Résout les transforms de nœuds une fois. Un mesh sans nœud reste une instance identité,
    // ce qui conserve le comportement des GLB historiques produits par `assemble`.
    let nodes = root["nodes"].as_array().cloned().unwrap_or_default();
    let mut node_worlds = vec![None; nodes.len()];
    let mut node_state = vec![false; nodes.len()];
    let mut mesh_instances: Vec<(usize, Mat4, Option<usize>)> = Vec::new();
    for (ni, node) in nodes.iter().enumerate() {
        if let Some(mesh) = node["mesh"].as_u64() {
            let world = node_world(ni, &nodes, &mut node_worlds, &mut node_state)?;
            mesh_instances.push((
                mesh as usize,
                world,
                node["skin"].as_u64().map(|s| s as usize),
            ));
        }
    }
    if mesh_instances.is_empty() {
        mesh_instances.extend(
            (0..root["meshes"].as_array().map_or(0, Vec::len)).map(|i| (i, identity(), None)),
        );
    }

    // Matrices de skin de la pose de liaison : jointWorld * inverseBind. Elles ne sont
    // calculées que si le GLB contient réellement un skin exploitable.
    let mut skin_matrices: Vec<Vec<Mat4>> = Vec::new();
    let empty_nodes = Vec::new();
    for skin in root["skins"].as_array().unwrap_or(&Vec::new()) {
        let joints = skin["joints"].as_array().unwrap_or(&empty_nodes);
        let ibm = skin["inverseBindMatrices"]
            .as_u64()
            .map(|a| read_floats(a as usize, 16))
            .transpose()?;
        let mut matrices = Vec::with_capacity(joints.len());
        for (i, joint) in joints.iter().enumerate() {
            let joint_idx = joint.as_u64().context("indice de joint hors limites")? as usize;
            let world = nodes
                .get(joint_idx)
                .map(|_| node_world(joint_idx, &nodes, &mut node_worlds, &mut node_state))
                .transpose()?
                .unwrap_or_else(identity);
            let bind = ibm
                .as_ref()
                .and_then(|v| v.get(i * 16..i * 16 + 16))
                .map(matrix_from_gltf)
                .unwrap_or_else(identity);
            matrices.push(mat_mul(&world, &bind));
        }
        skin_matrices.push(matrices);
    }

    let mut primitives = Vec::new();
    let empty = Vec::new();
    for (mesh_idx, node_transform, skin_idx) in mesh_instances {
        let Some(mesh) = root["meshes"]
            .as_array()
            .and_then(|meshes| meshes.get(mesh_idx))
        else {
            bail!("mesh de nœud hors limites")
        };
        for prim in mesh["primitives"].as_array().unwrap_or(&empty) {
            let attrs = &prim["attributes"];
            let Some(pos_acc) = attrs["POSITION"].as_u64() else {
                continue;
            };
            let pf = read_floats(pos_acc as usize, 3)?;
            let mut positions: Vec<[f32; 3]> =
                pf.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            let mut normals: Vec<[f32; 3]> = match attrs["NORMAL"].as_u64() {
                Some(a) => read_floats(a as usize, 3)?
                    .chunks_exact(3)
                    .map(|c| [c[0], c[1], c[2]])
                    .collect(),
                None => Vec::new(),
            };
            if let Some(si) = skin_idx.and_then(|i| skin_matrices.get(i)) {
                let joint_sets = ["JOINTS_0", "JOINTS_1"];
                let weight_sets = ["WEIGHTS_0", "WEIGHTS_1"];
                let joints: Vec<Vec<f32>> = joint_sets
                    .iter()
                    .filter_map(|key| attrs[*key].as_u64().map(|a| read_floats(a as usize, 4)))
                    .collect::<Result<_>>()?;
                let weights: Vec<Vec<f32>> = weight_sets
                    .iter()
                    .filter_map(|key| attrs[*key].as_u64().map(|a| read_floats(a as usize, 4)))
                    .collect::<Result<_>>()?;
                if !joints.is_empty() && joints.len() == weights.len() {
                    for (vi, p) in positions.iter_mut().enumerate() {
                        let mut skinned = [0.0; 3];
                        let mut total = 0.0;
                        for (js, ws) in joints.iter().zip(&weights) {
                            for k in 0..4 {
                                let w = ws.get(vi * 4 + k).copied().unwrap_or(0.0);
                                let ji = js.get(vi * 4 + k).copied().unwrap_or(0.0) as usize;
                                if w > 0.0 {
                                    if let Some(m) = si.get(ji) {
                                        let q = transform(m, *p);
                                        for c in 0..3 {
                                            skinned[c] += q[c] * w;
                                        }
                                        total += w;
                                    }
                                }
                            }
                        }
                        if total > 1e-6 {
                            *p = [skinned[0] / total, skinned[1] / total, skinned[2] / total];
                        }
                    }
                    for (vi, n) in normals.iter_mut().enumerate() {
                        let mut skinned = [0.0; 3];
                        let mut total = 0.0;
                        for (js, ws) in joints.iter().zip(&weights) {
                            for k in 0..4 {
                                let w = ws.get(vi * 4 + k).copied().unwrap_or(0.0);
                                let ji = js.get(vi * 4 + k).copied().unwrap_or(0.0) as usize;
                                if w > 0.0 {
                                    if let Some(m) = si.get(ji) {
                                        let q = transform_direction(m, *n);
                                        for c in 0..3 {
                                            skinned[c] += q[c] * w;
                                        }
                                        total += w;
                                    }
                                }
                            }
                        }
                        if total > 1e-6 {
                            *n = normalize([
                                skinned[0] / total,
                                skinned[1] / total,
                                skinned[2] / total,
                            ]);
                        }
                    }
                }
            }
            for p in &mut positions {
                *p = transform(&node_transform, *p);
            }
            for n in &mut normals {
                *n = normalize(transform_direction(&node_transform, *n));
            }
            let uv: Vec<[f32; 2]> = match attrs["TEXCOORD_0"].as_u64() {
                Some(a) => read_floats(a as usize, 2)?
                    .chunks_exact(2)
                    .map(|c| [c[0], c[1]])
                    .collect(),
                None => Vec::new(),
            };
            let indices: Vec<u32> = match prim["indices"].as_u64() {
                Some(a) => read_floats(a as usize, 1)?
                    .iter()
                    .map(|&f| f as u32)
                    .collect(),
                None => (0..positions.len() as u32).collect(),
            };
            let texture = prim["material"]
                .as_u64()
                .and_then(|mi| material_image(&root, mi as usize))
                .filter(|&src| src < textures.len());
            if indices.iter().any(|&i| i as usize >= positions.len()) {
                bail!("indice de sommet hors limites");
            }
            primitives.push(Primitive {
                positions,
                normals,
                uv,
                indices,
                texture,
            });
        }
    }
    if primitives.is_empty() {
        bail!("aucune primitive de mesh dans le GLB");
    }
    Ok(Model {
        primitives,
        textures,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(root: Value) -> Vec<u8> {
        fixture_bin(root, vec![0; 12])
    }

    fn fixture_bin(root: Value, mut bin: Vec<u8>) -> Vec<u8> {
        let mut json = serde_json::to_vec(&root).unwrap();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
        let mut data = b"glTF".to_vec();
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&((12 + 8 + json.len() + 8 + bin.len()) as u32).to_le_bytes());
        data.extend_from_slice(&(json.len() as u32).to_le_bytes());
        data.extend_from_slice(&0x4E4F_534Au32.to_le_bytes());
        data.extend(json);
        data.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        data.extend_from_slice(&0x004E_4942u32.to_le_bytes());
        data.extend_from_slice(&bin);
        data
    }

    #[test]
    fn rejette_accessors_et_images_hors_limites_sans_panique() {
        let root = serde_json::json!({
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}],
            "bufferViews": [{"byteLength": 12}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]
        });
        assert!(parse(&fixture(root.clone())).is_ok());
        for (pointer, value) in [
            ("/meshes/0/primitives/0/attributes/POSITION", 99),
            ("/accessors/0/bufferView", 99),
            ("/accessors/0/count", 2),
            ("/bufferViews/0/byteLength", 4),
        ] {
            let mut invalid = root.clone();
            *invalid.pointer_mut(pointer).unwrap() = serde_json::json!(value);
            assert!(parse(&fixture(invalid)).is_err(), "{pointer}");
        }
        let mut invalid = root;
        invalid["images"] = serde_json::json!([{"bufferView": 99}]);
        assert!(parse(&fixture(invalid)).is_err());
    }

    #[test]
    fn rejette_non_glb() {
        assert!(parse(b"pas un glb").is_err());
        assert!(parse(b"glTF").is_err()); // magic mais trop court
    }

    #[test]
    fn applique_transform_de_noeud_sur_une_instance_de_mesh() {
        let root = serde_json::json!({
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}],
            "bufferViews": [{"byteLength": 12}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "nodes": [{"mesh": 0, "translation": [2.0, 3.0, 4.0]}]
        });
        let mut bin = Vec::new();
        for value in [1.0_f32, 2.0, 3.0] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
        let model = parse(&fixture_bin(root, bin)).unwrap();
        assert_eq!(model.primitives[0].positions, [[3.0, 5.0, 7.0]]);
    }

    #[test]
    fn applique_skin_de_pose_de_liaison_avant_le_transform_du_noeud() {
        let root = serde_json::json!({
            "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5121, "count": 1, "type": "VEC4"},
                {"bufferView": 2, "componentType": 5126, "count": 1, "type": "VEC4"},
                {"bufferView": 3, "componentType": 5126, "count": 1, "type": "MAT4"}
            ],
            "bufferViews": [
                {"byteOffset": 0, "byteLength": 12},
                {"byteOffset": 12, "byteLength": 4},
                {"byteOffset": 16, "byteLength": 16},
                {"byteOffset": 32, "byteLength": 64}
            ],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "JOINTS_0": 1, "WEIGHTS_0": 2}}]}],
            "nodes": [
                {"mesh": 0, "skin": 0, "translation": [1.0, 0.0, 0.0]},
                {"translation": [2.0, 0.0, 0.0]}
            ],
            "skins": [{"joints": [1], "inverseBindMatrices": 3}]
        });
        let mut bin = Vec::new();
        for value in [1.0_f32, 0.0, 0.0] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
        bin.extend_from_slice(&[0, 0, 0, 0]);
        bin.extend_from_slice(&1.0_f32.to_le_bytes());
        bin.extend_from_slice(&[0; 12]);
        for value in [
            1.0_f32, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ] {
            bin.extend_from_slice(&value.to_le_bytes());
        }
        let model = parse(&fixture_bin(root, bin)).unwrap();
        assert_eq!(model.primitives[0].positions, [[4.0, 0.0, 0.0]]);
    }
}
