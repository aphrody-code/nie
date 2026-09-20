//! Parseur **GLB** (glTF binaire 2.0) minimal — extrait la géométrie (positions/normales/UV/indices)
//! **et les textures** (PNG embarqués) des primitives de mesh. Les transforms glTF des nœuds et le
//! skinning de la pose de liaison sont cuits dans les sommets au chargement : les consommateurs
//! historiques gardent donc leur API `Model`/`Primitive`, tout en recevant de la géométrie monde.
//! La chaîne matériau→texture est résolue
//! (`primitive.material → materials[].baseColorTexture → textures[].source → images[]`).

use anyhow::{Context, Result, bail};
use nie_core::animation::{BoneId, BonePose, PoseFrame, SkeletonId};
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

const JSON_CHUNK: u32 = 0x4E4F_534A;
const BIN_CHUNK: u32 = 0x004E_4942;

/// Largest GLB accepted by the public editor interchange path.
pub const EDITOR_MAX_GLB_BYTES: usize = 64 * 1024 * 1024;
/// Largest compressed replacement PNG accepted by the public editor interchange path.
pub const EDITOR_MAX_PNG_BYTES: usize = 32 * 1024 * 1024;
/// Aggregate decoded geometry admitted by the canonical GLB reader.
pub const MODEL_GEOMETRY_BUDGET: usize = 256 * 1024 * 1024;
/// Maximum nodes/mesh instances accepted before graph working sets are allocated.
pub const MODEL_MAX_NODES: usize = 65_536;
/// Maximum parent-chain depth accepted by the iterative node resolver.
pub const MODEL_MAX_NODE_DEPTH: usize = 4_096;
/// Decoded RGBA budget for a standalone editor PNG reference.
pub const EDITOR_PNG_RGBA_BUDGET: usize = 64 * 1024 * 1024;
/// Longest accepted side of a standalone editor PNG reference.
pub const EDITOR_PNG_MAX_DIMENSION: u32 = 8192;

/// One public glTF texture slot and the embedded image it resolves to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextureReference {
    pub source: usize,
    pub name: Option<String>,
}

fn ensure_editor_input_sizes(glb_len: usize, png_len: usize) -> Result<()> {
    anyhow::ensure!(
        glb_len <= EDITOR_MAX_GLB_BYTES,
        "GLB exceeds the 64 MiB editor limit"
    );
    anyhow::ensure!(
        png_len <= EDITOR_MAX_PNG_BYTES,
        "PNG exceeds the 32 MiB editor limit"
    );
    Ok(())
}

fn ensure_editor_output_size(glb_len: usize) -> Result<()> {
    anyhow::ensure!(
        glb_len <= EDITOR_MAX_GLB_BYTES,
        "GLB remplacé dépasse la limite éditeur de 64 MiB"
    );
    Ok(())
}

fn chunks(data: &[u8]) -> Result<Vec<(u32, &[u8])>> {
    if data.len() < 12 || &data[0..4] != b"glTF" || rd_u32(data, 4) != 2 {
        bail!("pas un GLB 2.0")
    }
    if rd_u32(data, 8) as usize != data.len() {
        bail!("longueur GLB incohérente")
    }
    let mut out = Vec::new();
    let mut json_count = 0usize;
    let mut bin_count = 0usize;
    let mut offset = 12usize;
    while offset + 8 <= data.len() {
        let length = rd_u32(data, offset) as usize;
        let kind = rd_u32(data, offset + 4);
        if !length.is_multiple_of(4) {
            bail!("longueur de chunk GLB non alignée sur 4 octets")
        }
        if out.is_empty() && kind != JSON_CHUNK {
            bail!("le premier chunk GLB doit être JSON")
        }
        if kind == JSON_CHUNK {
            json_count += 1;
            if json_count > 1 {
                bail!("plusieurs chunks JSON dans le GLB")
            }
        } else if kind == BIN_CHUNK {
            bin_count += 1;
            if bin_count > 1 {
                bail!("plusieurs chunks BIN dans le GLB")
            }
        }
        let start = offset + 8;
        let end = start.checked_add(length).context("chunk hors limites")?;
        if end > data.len() {
            bail!("chunk GLB hors limites")
        }
        out.push((kind, &data[start..end]));
        offset = end;
    }
    if offset != data.len() {
        bail!("octets résiduels après les chunks GLB")
    }
    if json_count != 1 {
        bail!("chunk JSON absent")
    }
    Ok(out)
}

/// Decode a PNG of any supported color type into a bounded RGBA8 texture.
///
/// The caller supplies the remaining allocation budget. This is the shared admission path used
/// both while parsing embedded GLB images and when an editor replaces one decoded texture for a
/// session; a replacement cannot bypass the same overflow and decompression bounds as import.
///
/// # Errors
///
/// Returns an error for malformed/unsupported PNG data, arithmetic overflow, or when the decoded
/// image would exceed `max_rgba_bytes`.
pub fn decode_png(bytes: &[u8], max_rgba_bytes: usize) -> Result<Texture> {
    let mut dec = png::Decoder::new(std::io::Cursor::new(bytes));
    dec.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = dec.read_info().context("png read_info")?;
    let header = reader.info();
    let rgba_len = usize::try_from(header.width)
        .ok()
        .and_then(|width| {
            usize::try_from(header.height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .context("png RGBA size overflow")?;
    anyhow::ensure!(
        rgba_len <= max_rgba_bytes,
        "decoded PNG exceeds the remaining texture budget"
    );
    let bufsz = reader
        .output_buffer_size()
        .context("png output_buffer_size (overflow)")?;
    anyhow::ensure!(
        bufsz <= max_rgba_bytes,
        "decoded PNG buffer exceeds the remaining texture budget"
    );
    let mut buf = vec![0u8; bufsz];
    let info = reader.next_frame(&mut buf).context("png next_frame")?;
    let (w, h) = (info.width, info.height);
    let n = rgba_len / 4;
    let mut rgba = vec![0u8; rgba_len];
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

/// Decode and validate a standalone PNG admitted by the public editor.
///
/// This checks compressed size, decoded RGBA allocation and dimensions in Rust before a browser
/// creates an object URL for the reference image.
pub fn validate_editor_png(bytes: &[u8]) -> Result<(u32, u32)> {
    anyhow::ensure!(
        bytes.len() <= EDITOR_MAX_PNG_BYTES,
        "PNG exceeds the 32 MiB editor limit"
    );
    let texture = decode_png(bytes, EDITOR_PNG_RGBA_BUDGET)?;
    anyhow::ensure!(
        texture.width <= EDITOR_PNG_MAX_DIMENSION && texture.height <= EDITOR_PNG_MAX_DIMENSION,
        "PNG dimensions exceed the editor limit"
    );
    Ok((texture.width, texture.height))
}

/// Inspect the public `textures[]` slots of a GLB without inventing image indexes.
///
/// A glTF texture index is not an image index: `textures[index].source` selects the image, and
/// several texture slots may share that source. Names come from the texture first and fall back
/// to the referenced image name.
pub fn texture_references(data: &[u8]) -> Result<Vec<TextureReference>> {
    anyhow::ensure!(
        data.len() <= EDITOR_MAX_GLB_BYTES,
        "GLB exceeds the 64 MiB editor limit"
    );
    let source_chunks = chunks(data)?;
    let json_bytes = source_chunks
        .iter()
        .find_map(|(kind, bytes)| (*kind == JSON_CHUNK).then_some(*bytes))
        .context("chunk JSON absent")?;
    let root: Value = serde_json::from_slice(json_bytes).context("JSON glTF invalide")?;
    let Some(textures) = root["textures"].as_array() else {
        return Ok(Vec::new());
    };
    if textures.is_empty() {
        return Ok(Vec::new());
    }
    let images = root["images"].as_array().context("images absentes")?;
    textures
        .iter()
        .enumerate()
        .map(|(index, texture)| {
            let source = texture["source"]
                .as_u64()
                .and_then(|source| usize::try_from(source).ok())
                .with_context(|| format!("texture {index}: source absente ou invalide"))?;
            let image = images
                .get(source)
                .with_context(|| format!("texture {index}: image source {source} hors limites"))?;
            let name = texture["name"]
                .as_str()
                .or_else(|| image["name"].as_str())
                .map(str::to_owned);
            Ok(TextureReference { source, name })
        })
        .collect()
}

/// Replace one embedded image in a GLB with a caller-provided PNG.
///
/// Existing buffer views and BIN bytes remain byte-for-byte unchanged. The PNG is appended in a
/// new buffer view and the image resolved by `textures[index].source` is redirected to it. Shared
/// texture slots therefore continue to share that image. The
/// returned GLB is reparsed by this crate before it is released, so the operation cannot emit an
/// asset that the canonical renderer itself rejects.
///
/// # Errors
///
/// Returns an error for malformed GLB/PNG data, an out-of-range texture index, external buffer 0,
/// missing canonical GLB chunks, size overflow, or when decoded textures exceed
/// `max_texture_bytes`.
pub fn replace_texture_png(
    data: &[u8],
    index: usize,
    png: &[u8],
    max_texture_bytes: usize,
) -> Result<Vec<u8>> {
    ensure_editor_input_sizes(data.len(), png.len())?;
    let _ = decode_png(png, max_texture_bytes)?;
    let source_chunks = chunks(data)?;
    let json_bytes = source_chunks
        .iter()
        .find_map(|(kind, bytes)| (*kind == JSON_CHUNK).then_some(*bytes))
        .context("chunk JSON absent")?;
    let source_bin = source_chunks
        .iter()
        .find_map(|(kind, bytes)| (*kind == BIN_CHUNK).then_some(*bytes))
        .context("chunk BIN absent")?;
    let mut root: Value = serde_json::from_slice(json_bytes).context("JSON glTF invalide")?;
    let references = texture_references(data)?;
    let source = references
        .get(index)
        .with_context(|| format!("texture {index} hors limites"))?
        .source;
    let buffers = root["buffers"].as_array().context("buffers absents")?;
    let buffer = buffers.first().context("buffer 0 absent")?;
    if buffer.get("uri").is_some() {
        bail!("buffer 0 doit être le BIN embarqué (uri interdite)")
    }
    let views = root["bufferViews"]
        .as_array_mut()
        .context("bufferViews absents")?;
    let image_offset = source_bin.len();
    let buffer_length = image_offset
        .checked_add(png.len())
        .context("taille BIN remplacée déborde")?;
    let padded_bin_length = buffer_length
        .checked_add(3)
        .map(|length| length & !3)
        .context("alignement BIN remplacé déborde")?;
    views.push(serde_json::json!({
        "buffer": 0,
        "byteOffset": image_offset,
        "byteLength": png.len()
    }));
    let next_view = views.len() - 1;
    let image = root["images"]
        .as_array_mut()
        .and_then(|images| images.get_mut(source))
        .context("image hors limites")?;
    let image = image.as_object_mut().context("image glTF invalide")?;
    image.remove("uri");
    image.insert("bufferView".to_owned(), Value::from(next_view as u64));
    image.insert("mimeType".to_owned(), Value::from("image/png"));
    let buffers = root["buffers"].as_array_mut().context("buffers absents")?;
    let buffer = buffers.get_mut(0).context("buffer 0 absent")?;
    buffer["byteLength"] = Value::from(buffer_length as u64);

    let mut json = serde_json::to_vec(&root).context("sérialisation JSON glTF")?;
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let total = 12usize
        .checked_add(
            source_chunks
                .iter()
                .try_fold(0usize, |size, (kind, bytes)| {
                    let length = if *kind == JSON_CHUNK {
                        json.len()
                    } else if *kind == BIN_CHUNK {
                        padded_bin_length
                    } else {
                        bytes.len()
                    };
                    size.checked_add(8)?.checked_add(length)
                })
                .context("taille GLB déborde")?,
        )
        .context("taille GLB déborde")?;
    let total_u32 = u32::try_from(total).context("GLB dépasse 4 Gio")?;
    ensure_editor_output_size(total)?;
    let mut bin = Vec::with_capacity(padded_bin_length);
    bin.extend_from_slice(source_bin);
    bin.extend_from_slice(png);
    bin.resize(padded_bin_length, 0);
    let mut output = Vec::with_capacity(total);
    output.extend_from_slice(b"glTF");
    output.extend_from_slice(&2u32.to_le_bytes());
    output.extend_from_slice(&total_u32.to_le_bytes());
    for (kind, bytes) in source_chunks {
        let replacement = if kind == JSON_CHUNK {
            json.as_slice()
        } else if kind == BIN_CHUNK {
            bin.as_slice()
        } else {
            bytes
        };
        output.extend_from_slice(&(replacement.len() as u32).to_le_bytes());
        output.extend_from_slice(&kind.to_le_bytes());
        output.extend_from_slice(replacement);
    }
    parse_with_texture_budget(&output, max_texture_bytes)
        .context("GLB remplacé refusé lors de la relecture")?;
    Ok(output)
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

/// Result of applying one local [`nie_core::animation::PoseFrame`] to a CPU-skinned mesh.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SkinnedVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
}

/// Matrice de peau de chaque jointure pour une pose : `monde(pose) * inverseBind`.
///
/// C'est la moitié réutilisable du skinning — celle qui ne dépend pas des sommets. Un hôte GPU
/// téléverse ce vecteur dans un tampon uniforme et laisse le nuanceur mélanger les influences ;
/// [`apply_pose_cpu`] fait le même mélange sur le processeur. Les deux chemins partagent donc la
/// **même** évaluation de hiérarchie, ce qui est la seule façon qu'ils s'accordent.
///
/// Une jointure absente de la pose retombe sur son `bind_local` : une animation ne clé pas
/// forcément tous les os, et remplacer un os non clé par l'identité le déplacerait au lieu de le
/// laisser au repos.
///
/// # Errors
///
/// - la pose ne s'adresse pas à ce squelette — une pose d'un autre squelette produirait une
///   déformation plausible et fausse, le pire défaut de ce domaine ;
/// - un index de parent sort de la table ;
/// - la hiérarchie boucle.
pub fn pose_skin_matrices(
    mesh: &CpuSkinnedMesh,
    pose: &PoseFrame,
) -> Result<Vec<SkinMatrix>> {
    if pose.skeleton != mesh.skeleton {
        bail!(
            "la pose s'adresse au squelette {:?}, le maillage au squelette {:?}",
            pose.skeleton,
            mesh.skeleton
        );
    }

    let locals: Vec<Mat4> = mesh
        .joints
        .iter()
        .map(|joint| {
            pose.bone(joint.bone)
                .map_or(joint.bind_local, |bone| matrix_from_bone_pose(&bone))
        })
        .collect();

    // Résolution par passes linéaires plutôt que par un simple parcours ascendant : rien ne
    // garantit qu'un parent précède son enfant dans la table, et `resolve_node_worlds` a déjà
    // payé cette hypothèse sur les nœuds glTF (cf. le test des chaînes inversées).
    let mut worlds: Vec<Option<Mat4>> = vec![None; mesh.joints.len()];
    let mut resolved = 0usize;
    for _ in 0..=mesh.joints.len() {
        if resolved == mesh.joints.len() {
            break;
        }
        let mut progressed = false;
        for (i, joint) in mesh.joints.iter().enumerate() {
            if worlds[i].is_some() {
                continue;
            }
            let world = match joint.parent {
                None => locals[i],
                Some(parent) => {
                    let Some(parent_world) = worlds.get(parent) else {
                        bail!(
                            "la jointure {i} désigne le parent {parent}, hors d'une table de {} entrées",
                            mesh.joints.len()
                        );
                    };
                    let Some(parent_world) = parent_world else {
                        continue;
                    };
                    mat_mul(parent_world, &locals[i])
                }
            };
            worlds[i] = Some(world);
            resolved += 1;
            progressed = true;
        }
        if !progressed {
            break;
        }
    }
    if resolved != mesh.joints.len() {
        bail!(
            "hiérarchie de jointures cyclique : {resolved} résolues sur {}",
            mesh.joints.len()
        );
    }

    Ok(mesh
        .joints
        .iter()
        .enumerate()
        .map(|(i, joint)| {
            mat_mul(
                &worlds[i].unwrap_or_else(identity),
                &joint.inverse_bind,
            )
        })
        .collect())
}

/// Applique une pose locale à un maillage lié, sur le processeur.
///
/// C'est la couture que `glb` annonçait sans la fournir : les clips `.g4mt` se décodent depuis
/// 2026-09, les squelettes `.g4sk` aussi, et `assemble` écrit bien `JOINTS_0`/`WEIGHTS_0` dans
/// les GLB — mais [`parse`] n'en tirait que la **pose de liaison**, si bien qu'aucun chemin de la
/// bibliothèque ne pouvait rendre un personnage animé. Le seul rendu animé du dépôt vivait dans
/// un exemple qui refaisait la cinématique directe et le mélange à la main.
///
/// Le mélange suit exactement celui de la pose de liaison dans [`parse`] : jusqu'à huit
/// influences, pondérées puis **renormalisées par la somme des poids retenus**. Renormaliser
/// plutôt que supposer une somme de 1 compte : un poids qui désigne une jointure hors table est
/// ignoré, et sans renormalisation le sommet s'effondrerait vers l'origine au lieu de suivre ses
/// influences valides.
///
/// Les normales sont transformées en direction (sans translation) puis renormalisées. Ce n'est
/// pas la transposée de l'inverse : sous une échelle non uniforme elle s'écarte de la vraie
/// normale, et le dire vaut mieux que de le laisser découvrir.
///
/// # Errors
///
/// Les mêmes que [`pose_skin_matrices`].
pub fn apply_pose_cpu(mesh: &CpuSkinnedMesh, pose: &PoseFrame) -> Result<Vec<SkinnedVertex>> {
    let skins = pose_skin_matrices(mesh, pose)?;
    Ok(mesh
        .vertices
        .iter()
        .map(|vertex| skin_one_vertex(vertex, &skins))
        .collect())
}

/// Mélange les influences d'un sommet. Un sommet sans poids utile garde sa position de liaison.
fn skin_one_vertex(vertex: &SkinVertex, skins: &[SkinMatrix]) -> SkinnedVertex {
    let mut position = [0.0f32; 3];
    let mut normal = [0.0f32; 3];
    let mut total = 0.0f32;
    for (joint, weight) in vertex.joints.iter().zip(vertex.weights.iter()) {
        if *weight <= 0.0 {
            continue;
        }
        let Some(skin) = skins.get(*joint as usize) else {
            continue;
        };
        let p = transform(skin, vertex.position);
        let n = transform_direction(skin, vertex.normal);
        for c in 0..3 {
            position[c] += p[c] * weight;
            normal[c] += n[c] * weight;
        }
        total += weight;
    }
    if total <= 1e-6 {
        return SkinnedVertex {
            position: vertex.position,
            normal: vertex.normal,
        };
    }
    SkinnedVertex {
        position: [
            position[0] / total,
            position[1] / total,
            position[2] / total,
        ],
        normal: normalize([normal[0] / total, normal[1] / total, normal[2] / total]),
    }
}

/// `T * R * S` depuis une pose d'os, dans la convention de [`node_local`] — même ordre, même
/// disposition ligne-majeure. Les deux doivent rester d'accord : une pose et un nœud glTF
/// décrivent la même chose.
fn matrix_from_bone_pose(bone: &BonePose) -> Mat4 {
    let mut m = identity();
    let [x, y, z, w] = bone.rotation.0;
    let s = [bone.scale.x, bone.scale.y, bone.scale.z];
    m[0][0] = (1.0 - 2.0 * (y * y + z * z)) * s[0];
    m[0][1] = (2.0 * (x * y - z * w)) * s[1];
    m[0][2] = (2.0 * (x * z + y * w)) * s[2];
    m[1][0] = (2.0 * (x * y + z * w)) * s[0];
    m[1][1] = (1.0 - 2.0 * (x * x + z * z)) * s[1];
    m[1][2] = (2.0 * (y * z - x * w)) * s[2];
    m[2][0] = (2.0 * (x * z - y * w)) * s[0];
    m[2][1] = (2.0 * (y * z + x * w)) * s[1];
    m[2][2] = (1.0 - 2.0 * (x * x + y * y)) * s[2];
    m[0][3] = bone.translation.x;
    m[1][3] = bone.translation.y;
    m[2][3] = bone.translation.z;
    m
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

fn resolve_node_worlds(nodes: &[Value]) -> Result<Vec<Mat4>> {
    anyhow::ensure!(
        nodes.len() <= MODEL_MAX_NODES,
        "node count exceeds the explicit model limit"
    );

    // Build the parent table once. This also rejects DAGs that glTF cannot represent as a node
    // tree, instead of silently choosing whichever parent happens to be scanned first.
    let mut parents = vec![None; nodes.len()];
    for (parent, node) in nodes.iter().enumerate() {
        let Some(children) = node["children"].as_array() else {
            continue;
        };
        for child in children {
            let child = child
                .as_u64()
                .and_then(|child| usize::try_from(child).ok())
                .context("indice enfant absent ou trop grand")?;
            let slot = parents
                .get_mut(child)
                .context("indice enfant hors limites")?;
            if let Some(existing) = *slot {
                bail!("nœud {child} a plusieurs parents ({existing} et {parent})")
            }
            *slot = Some(parent);
        }
    }

    // 0 = unseen, 1 = on the current chain, 2 = resolved. Each edge is traversed at most once;
    // reversing a very long chain no longer creates recursion or repeated parent scans.
    let mut state = vec![0u8; nodes.len()];
    let mut worlds = vec![identity(); nodes.len()];
    let mut chain = Vec::new();
    for start in 0..nodes.len() {
        if state[start] == 2 {
            continue;
        }
        chain.clear();
        let mut cursor = Some(start);
        while let Some(index) = cursor {
            match state[index] {
                2 => break,
                1 => bail!("cycle de nœuds glTF"),
                _ => {
                    state[index] = 1;
                    chain.push(index);
                    anyhow::ensure!(
                        chain.len() <= MODEL_MAX_NODE_DEPTH,
                        "node depth exceeds the explicit model limit"
                    );
                    cursor = parents[index];
                }
            }
        }
        while let Some(index) = chain.pop() {
            let local = node_local(&nodes[index]);
            worlds[index] = parents[index]
                .map(|parent| mat_mul(&worlds[parent], &local))
                .unwrap_or(local);
            state[index] = 2;
        }
    }
    Ok(worlds)
}

fn charge_geometry(total: &mut usize, bytes: usize, budget: usize) -> Result<()> {
    *total = total
        .checked_add(bytes)
        .context("geometry allocation budget overflow")?;
    anyhow::ensure!(
        *total <= budget,
        "decoded geometry exceeds the aggregate budget"
    );
    Ok(())
}

fn accessor_allocation_bytes(
    accessors: &[Value],
    index: usize,
    components: usize,
    simultaneous_copies: usize,
) -> Result<usize> {
    let count = accessors.get(index).context("accessor hors limites")?["count"]
        .as_u64()
        .and_then(|count| usize::try_from(count).ok())
        .context("count accessor absent ou trop grand")?;
    count
        .checked_mul(components)
        .and_then(|values| values.checked_mul(std::mem::size_of::<f32>()))
        .and_then(|bytes| bytes.checked_mul(simultaneous_copies))
        .context("taille accessor déborde")
}

/// Account for every accessor decode and every instantiated primitive before any of those
/// vectors is allocated. Reusing one mesh from many nodes is therefore charged many times, as it
/// is in the returned flattened [`Model`].
fn preflight_geometry(
    root: &Value,
    accessors: &[Value],
    mesh_instances: &[(usize, Mat4, Option<usize>)],
    initial_bytes: usize,
    budget: usize,
) -> Result<()> {
    let mut total = initial_bytes;
    let meshes = root["meshes"].as_array().context("meshes absents")?;
    for (mesh_index, _, skin_index) in mesh_instances {
        let mesh = meshes
            .get(*mesh_index)
            .context("mesh de nœud hors limites")?;
        let Some(primitives) = mesh["primitives"].as_array() else {
            continue;
        };
        charge_geometry(
            &mut total,
            primitives
                .len()
                .checked_mul(std::mem::size_of::<Primitive>())
                .context("nombre de primitives déborde")?,
            budget,
        )?;
        for primitive in primitives {
            let attributes = &primitive["attributes"];
            let Some(position) = attributes["POSITION"].as_u64() else {
                continue;
            };
            let position = usize::try_from(position).context("accessor POSITION trop grand")?;
            charge_geometry(
                &mut total,
                accessor_allocation_bytes(accessors, position, 3, 2)?,
                budget,
            )?;
            if let Some(normal) = attributes["NORMAL"].as_u64() {
                charge_geometry(
                    &mut total,
                    accessor_allocation_bytes(
                        accessors,
                        usize::try_from(normal).context("accessor NORMAL trop grand")?,
                        3,
                        2,
                    )?,
                    budget,
                )?;
            }
            if let Some(uv) = attributes["TEXCOORD_0"].as_u64() {
                charge_geometry(
                    &mut total,
                    accessor_allocation_bytes(
                        accessors,
                        usize::try_from(uv).context("accessor TEXCOORD_0 trop grand")?,
                        2,
                        2,
                    )?,
                    budget,
                )?;
            }
            if let Some(indices) = primitive["indices"].as_u64() {
                charge_geometry(
                    &mut total,
                    accessor_allocation_bytes(
                        accessors,
                        usize::try_from(indices).context("accessor indices trop grand")?,
                        1,
                        2,
                    )?,
                    budget,
                )?;
            } else {
                let count = accessors[position]["count"]
                    .as_u64()
                    .and_then(|count| usize::try_from(count).ok())
                    .context("count POSITION absent ou trop grand")?;
                charge_geometry(
                    &mut total,
                    count
                        .checked_mul(std::mem::size_of::<u32>())
                        .context("indices implicites débordent")?,
                    budget,
                )?;
            }
            if skin_index.is_some() {
                for key in ["JOINTS_0", "JOINTS_1", "WEIGHTS_0", "WEIGHTS_1"] {
                    if let Some(index) = attributes[key].as_u64() {
                        charge_geometry(
                            &mut total,
                            accessor_allocation_bytes(
                                accessors,
                                usize::try_from(index).context("accessor de skin trop grand")?,
                                4,
                                1,
                            )?,
                            budget,
                        )?;
                    }
                }
            }
        }
    }
    for skin in root["skins"].as_array().into_iter().flatten() {
        let joint_count = skin["joints"].as_array().map_or(0, Vec::len);
        charge_geometry(
            &mut total,
            joint_count
                .checked_mul(std::mem::size_of::<Mat4>())
                .context("matrices de skin débordent")?,
            budget,
        )?;
        if let Some(accessor) = skin["inverseBindMatrices"].as_u64() {
            charge_geometry(
                &mut total,
                accessor_allocation_bytes(
                    accessors,
                    usize::try_from(accessor).context("inverseBindMatrices trop grand")?,
                    16,
                    1,
                )?,
                budget,
            )?;
        }
    }
    Ok(())
}

/// Parse un buffer GLB complet (géométrie + textures embarquées).
///
/// # Errors
/// Si le magic n'est pas « glTF », si les chunks JSON/BIN manquent, ou si le glTF est malformé.
#[allow(clippy::collapsible_if)]
pub fn parse(data: &[u8]) -> Result<Model> {
    parse_with_texture_budget(data, usize::MAX)
}

/// Parse a complete GLB while bounding aggregate decoded RGBA texture memory.
///
/// The budget is enforced from PNG headers before allocating decoder/output buffers, preventing
/// a small compressed GLB from expanding into an unbounded WebAssembly heap allocation.
///
/// # Errors
/// Returns an error when malformed input or decoded textures exceed `max_texture_bytes`.
#[allow(clippy::collapsible_if)]
pub fn parse_with_texture_budget(data: &[u8], max_texture_bytes: usize) -> Result<Model> {
    let source_chunks = chunks(data)?;
    let json = source_chunks
        .iter()
        .find_map(|(kind, bytes)| (*kind == JSON_CHUNK).then_some(*bytes))
        .context("chunk JSON absent")?;
    let bin = source_chunks
        .iter()
        .find_map(|(kind, bytes)| (*kind == BIN_CHUNK).then_some(*bytes))
        .context("chunk BIN absent")?;
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
    let mut decoded_texture_bytes = 0usize;
    if let Some(imgs) = root["images"].as_array() {
        for im in imgs {
            let bvi = im["bufferView"].as_u64().context("image bufferView")? as usize;
            let bv = views.get(bvi).context("image bufferView hors limites")?;
            let bo = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
            let bl = bv["byteLength"].as_u64().context("image byteLength")? as usize;
            let end = bo.checked_add(bl).context("image déborde")?;
            let remaining = max_texture_bytes
                .checked_sub(decoded_texture_bytes)
                .context("decoded textures exceed the aggregate budget")?;
            let texture = decode_png(
                bin.get(bo..end).context("image hors du chunk BIN")?,
                remaining,
            )?;
            decoded_texture_bytes = decoded_texture_bytes
                .checked_add(texture.rgba.len())
                .context("decoded texture byte count overflow")?;
            textures.push(texture);
        }
    }

    // Résout les transforms de nœuds une fois. Un mesh sans nœud reste une instance identité,
    // ce qui conserve le comportement des GLB historiques produits par `assemble`.
    let no_nodes: &[Value] = &[];
    let nodes = root["nodes"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(no_nodes);
    let node_working_bytes = nodes
        .len()
        .checked_mul(
            std::mem::size_of::<Mat4>()
                + std::mem::size_of::<Option<usize>>()
                + std::mem::size_of::<u8>(),
        )
        .context("nombre de nœuds déborde")?;
    let mesh_count = root["meshes"].as_array().map_or(0, Vec::len);
    let instance_capacity = nodes.len().max(mesh_count);
    anyhow::ensure!(
        instance_capacity <= MODEL_MAX_NODES,
        "mesh instance count exceeds the explicit model limit"
    );
    let instance_bytes = instance_capacity
        .checked_mul(std::mem::size_of::<(usize, Mat4, Option<usize>)>())
        .context("nombre d'instances déborde")?;
    let structural_bytes = node_working_bytes
        .checked_add(instance_bytes)
        .context("working set de géométrie déborde")?;
    anyhow::ensure!(
        structural_bytes <= MODEL_GEOMETRY_BUDGET,
        "node working set exceeds the aggregate geometry budget"
    );
    let node_worlds = resolve_node_worlds(nodes)?;
    let mut mesh_instances: Vec<(usize, Mat4, Option<usize>)> =
        Vec::with_capacity(instance_capacity);
    for (ni, node) in nodes.iter().enumerate() {
        if let Some(mesh) = node["mesh"].as_u64() {
            let world = node_worlds[ni];
            mesh_instances.push((
                mesh as usize,
                world,
                node["skin"].as_u64().map(|s| s as usize),
            ));
        }
    }
    if mesh_instances.is_empty() {
        mesh_instances.extend((0..mesh_count).map(|i| (i, identity(), None)));
    }
    preflight_geometry(
        &root,
        accessors,
        &mesh_instances,
        structural_bytes,
        MODEL_GEOMETRY_BUDGET,
    )?;

    // Matrices de skin de la pose de liaison : jointWorld * inverseBind. Elles ne sont
    // calculées que si le GLB contient réellement un skin exploitable.
    let mut skin_matrices: Vec<Vec<Mat4>> = Vec::new();
    let no_skins: &[Value] = &[];
    for skin in root["skins"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(no_skins)
    {
        let joints = skin["joints"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(no_nodes);
        let ibm = skin["inverseBindMatrices"]
            .as_u64()
            .map(|a| read_floats(a as usize, 16))
            .transpose()?;
        let mut matrices = Vec::with_capacity(joints.len());
        for (i, joint) in joints.iter().enumerate() {
            let joint_idx = joint.as_u64().context("indice de joint hors limites")? as usize;
            let world = node_worlds.get(joint_idx).copied().unwrap_or_else(identity);
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

    /// The first real keshin uses indices in the global G4MG vertex space.  The assembler must
    /// compact them into each glTF primitive before the canonical renderer sees the GLB.
    ///
    /// This is conditional because the copyrighted fixture remains in the user's game install;
    /// no game bytes or generated GLB are written by the test.
    #[test]
    fn assembled_keshin_k000010_has_local_indices_and_parses() {
        use nie_formats::assemble::assemble_keshin;
        use nie_formats::vfs::Vfs;

        let game_data = nie_formats::vfs::resolve_game_dir().join("data");
        let mut vfs = Vfs::new();
        if vfs.init(&game_data).is_err() {
            eprintln!("SKIP: game VFS unavailable");
            return;
        }

        let g4md = match vfs.read("data/common/chr/_keshin/k000010/k000010.g4md") {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("SKIP: k000010 G4MD unavailable: {error}");
                return;
            }
        };
        let g4mg = match vfs.read("data/common/chr/_keshin/k000010/k000010.g4mg") {
            Ok(bytes) => bytes,
            Err(error) => {
                eprintln!("SKIP: k000010 G4MG unavailable: {error}");
                return;
            }
        };

        let assembled = assemble_keshin("k000010", g4md, g4mg).expect("assemble k000010");
        assert!(!assembled.primitives.is_empty(), "k000010 has primitives");
        for primitive in &assembled.primitives {
            assert!(
                primitive
                    .indices
                    .iter()
                    .all(|&index| (index as usize) < primitive.positions.len()),
                "assembled primitive {} contains a non-local vertex index",
                primitive.source_index
            );
        }

        let glb = assembled.to_glb_embedded();
        let parsed = parse(&glb).expect("canonical renderer parses assembled k000010 GLB");
        assert!(
            !parsed.primitives.is_empty(),
            "parsed k000010 has primitives"
        );
        assert!(
            parsed.primitives.iter().all(|primitive| primitive
                .indices
                .iter()
                .all(|&index| (index as usize) < primitive.positions.len())),
            "parsed k000010 primitives keep local indices"
        );
        assert!(
            parsed
                .primitives
                .iter()
                .map(|primitive| primitive.indices.len() / 3)
                .sum::<usize>()
                > 0,
            "parsed k000010 has renderable triangles"
        );
    }

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

    fn raw_glb(parts: &[(u32, Vec<u8>)]) -> Vec<u8> {
        let total = 12
            + parts
                .iter()
                .map(|(_, bytes)| 8 + bytes.len())
                .sum::<usize>();
        let mut data = b"glTF".to_vec();
        data.extend_from_slice(&2u32.to_le_bytes());
        data.extend_from_slice(&(total as u32).to_le_bytes());
        for (kind, bytes) in parts {
            data.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            data.extend_from_slice(&kind.to_le_bytes());
            data.extend_from_slice(bytes);
        }
        data
    }

    #[test]
    fn inverted_large_node_chain_resolves_iteratively_in_linear_passes() {
        let count = 2_048usize;
        let mut nodes = Vec::with_capacity(count);
        for index in 0..count {
            let mut node = serde_json::json!({"translation": [1.0, 0.0, 0.0]});
            if index > 0 {
                node["children"] = serde_json::json!([index - 1]);
            }
            nodes.push(node);
        }
        let worlds = resolve_node_worlds(&nodes).expect("iterative reversed chain");
        assert_eq!(worlds[0][0][3], count as f32);
        assert_eq!(worlds[count - 1][0][3], 1.0);
    }

    #[test]
    fn node_graph_rejects_cycles_multiple_parents_and_excessive_depth() {
        let cycle = [
            serde_json::json!({"children": [1]}),
            serde_json::json!({"children": [0]}),
        ];
        assert!(
            resolve_node_worlds(&cycle)
                .unwrap_err()
                .to_string()
                .contains("cycle")
        );

        let multiple = [
            serde_json::json!({"children": [2]}),
            serde_json::json!({"children": [2]}),
            serde_json::json!({}),
        ];
        assert!(
            resolve_node_worlds(&multiple)
                .unwrap_err()
                .to_string()
                .contains("plusieurs parents")
        );

        let count = MODEL_MAX_NODE_DEPTH + 1;
        let mut too_deep = Vec::with_capacity(count);
        for index in 0..count {
            let mut node = serde_json::json!({});
            if index > 0 {
                node["children"] = serde_json::json!([index - 1]);
            }
            too_deep.push(node);
        }
        assert!(
            resolve_node_worlds(&too_deep)
                .unwrap_err()
                .to_string()
                .contains("depth")
        );
    }

    #[test]
    fn strict_glb2_chunks_are_shared_by_parse_inspection_and_replacement() {
        let json = b"{}  ".to_vec();
        let bin = vec![0; 4];
        let malformed = [
            raw_glb(&[(BIN_CHUNK, bin.clone()), (JSON_CHUNK, json.clone())]),
            raw_glb(&[
                (JSON_CHUNK, json.clone()),
                (JSON_CHUNK, json.clone()),
                (BIN_CHUNK, bin.clone()),
            ]),
            raw_glb(&[
                (JSON_CHUNK, json.clone()),
                (BIN_CHUNK, bin.clone()),
                (BIN_CHUNK, bin.clone()),
            ]),
            raw_glb(&[(JSON_CHUNK, b"{} ".to_vec()), (BIN_CHUNK, bin)]),
        ];
        let png = {
            let mut bytes = Vec::new();
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[1, 2, 3, 4])
                .unwrap();
            bytes
        };
        for bytes in malformed {
            assert!(chunks(&bytes).is_err());
            assert!(parse(&bytes).is_err());
            assert!(texture_references(&bytes).is_err());
            assert!(replace_texture_png(&bytes, 0, &png, 1024).is_err());
        }
    }

    #[test]
    fn geometry_budget_rejects_accessor_and_instance_amplification_before_decode() {
        let huge_count = MODEL_GEOMETRY_BUDGET / (3 * 4 * 2) + 1;
        let root = serde_json::json!({
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": 12}],
            "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 12}],
            "accessors": [{
                "bufferView": 0,
                "componentType": 5126,
                "count": huge_count,
                "type": "VEC3"
            }],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]
        });
        let error = match parse(&fixture(root)) {
            Ok(_) => panic!("geometry amplification unexpectedly admitted"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("aggregate budget"), "{error}");

        let small_root = serde_json::json!({
            "accessors": [{"count": 1}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]
        });
        let one_instance_budget = std::mem::size_of::<Primitive>() + 3 * 4 * 2 + 4;
        let one = [(0, identity(), None)];
        assert!(
            preflight_geometry(
                &small_root,
                small_root["accessors"].as_array().unwrap(),
                &one,
                0,
                one_instance_budget
            )
            .is_ok()
        );
        let two = [(0, identity(), None), (0, identity(), None)];
        assert!(
            preflight_geometry(
                &small_root,
                small_root["accessors"].as_array().unwrap(),
                &two,
                0,
                one_instance_budget
            )
            .is_err()
        );
    }

    #[test]
    fn editor_png_and_rewritten_glb_have_independent_hard_limits() {
        assert!(ensure_editor_input_sizes(EDITOR_MAX_GLB_BYTES, EDITOR_MAX_PNG_BYTES).is_ok());
        assert!(ensure_editor_input_sizes(EDITOR_MAX_GLB_BYTES + 1, 0).is_err());
        assert!(ensure_editor_input_sizes(0, EDITOR_MAX_PNG_BYTES + 1).is_err());
        assert!(ensure_editor_output_size(EDITOR_MAX_GLB_BYTES).is_ok());
        assert!(ensure_editor_output_size(EDITOR_MAX_GLB_BYTES + 1).is_err());

        let mut oversized_side = Vec::new();
        let mut encoder = png::Encoder::new(&mut oversized_side, EDITOR_PNG_MAX_DIMENSION + 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let row = vec![0; (EDITOR_PNG_MAX_DIMENSION as usize + 1) * 4];
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&row)
            .unwrap();
        assert!(validate_editor_png(&oversized_side).is_err());
    }

    #[test]
    fn decoded_texture_budget_is_aggregate_and_checked_before_rgba_allocation() {
        let mut png_bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[1, 2, 3, 4])
                .unwrap();
        }
        let root = serde_json::json!({
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}],
            "bufferViews": [
                {"byteLength": 12},
                {"byteOffset": 12, "byteLength": png_bytes.len()}
            ],
            "images": [{"bufferView": 1}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]
        });
        let mut bin = vec![0; 12];
        bin.extend_from_slice(&png_bytes);
        let glb = fixture_bin(root, bin);

        assert!(parse_with_texture_budget(&glb, 3).is_err());
        let model = parse_with_texture_budget(&glb, 4).expect("one RGBA texel fits the budget");
        assert_eq!(model.textures.len(), 1);
        assert_eq!(model.textures[0].rgba, [1, 2, 3, 4]);
    }

    #[test]
    fn texture_replacement_appends_png_and_preserves_existing_buffer_views() {
        fn solid_png(color: [u8; 4]) -> Vec<u8> {
            let mut bytes = Vec::new();
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&color)
                .unwrap();
            bytes
        }

        let green = solid_png([0, 255, 0, 255]);
        let red = solid_png([255, 0, 0, 255]);
        let blue = solid_png([0, 0, 255, 255]);
        let mut bin = vec![0; 12];
        let green_offset = bin.len();
        bin.extend_from_slice(&green);
        while !bin.len().is_multiple_of(4) {
            bin.push(0);
        }
        let red_offset = bin.len();
        bin.extend_from_slice(&red);
        let root = serde_json::json!({
            "asset": {"version": "2.0"},
            "buffers": [{"byteLength": bin.len()}],
            "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}],
            "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 12},
                {"buffer": 0, "byteOffset": green_offset, "byteLength": green.len()},
                {"buffer": 0, "byteOffset": red_offset, "byteLength": red.len()}
            ],
            "images": [
                {"name": "unused", "bufferView": 1, "mimeType": "image/png"},
                {
                    "name": "shirt-image",
                    "uri": "data:image/png;base64,invalid-when-buffer-view-is-present",
                    "bufferView": 2,
                    "mimeType": "image/png"
                }
            ],
            "textures": [
                {"name": "shirt", "source": 1},
                {"name": "shirt-shared", "source": 1}
            ],
            "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}]
        });
        let original = fixture_bin(root.clone(), bin.clone());
        let original_chunks = chunks(&original).unwrap();
        let original_json: Value = serde_json::from_slice(
            original_chunks
                .iter()
                .find(|(kind, _)| *kind == JSON_CHUNK)
                .unwrap()
                .1,
        )
        .unwrap();
        let original_bin = original_chunks
            .iter()
            .find(|(kind, _)| *kind == BIN_CHUNK)
            .unwrap()
            .1;

        let replaced = replace_texture_png(&original, 0, &blue, 1024).expect("replace GLB PNG");
        let model = parse_with_texture_budget(&replaced, 1024).expect("reparse replaced GLB");
        assert_eq!(model.textures[0].rgba, [0, 255, 0, 255]);
        assert_eq!(model.textures[1].rgba, [0, 0, 255, 255]);
        assert_eq!(model.primitives[0].texture, Some(1));

        let replaced_chunks = chunks(&replaced).unwrap();
        let replaced_json: Value = serde_json::from_slice(
            replaced_chunks
                .iter()
                .find(|(kind, _)| *kind == JSON_CHUNK)
                .unwrap()
                .1,
        )
        .unwrap();
        let replaced_bin = replaced_chunks
            .iter()
            .find(|(kind, _)| *kind == BIN_CHUNK)
            .unwrap()
            .1;
        let replaced_views = replaced_json["bufferViews"].as_array().unwrap();
        let original_views = original_json["bufferViews"].as_array().unwrap();
        assert_eq!(&replaced_views[..3], original_views.as_slice());
        assert_eq!(&replaced_bin[..original_bin.len()], original_bin);
        assert_eq!(replaced_json["images"][0]["bufferView"], 1);
        assert_eq!(replaced_json["images"][1]["bufferView"], 3);
        assert!(replaced_json["images"][1].get("uri").is_none());
        assert_eq!(replaced_json["bufferViews"][3]["byteLength"], blue.len());
        assert_eq!(replaced_json["textures"][0]["source"], 1);
        assert_eq!(replaced_json["textures"][1]["source"], 1);

        let references = texture_references(&replaced).expect("inspect texture slots");
        assert_eq!(references[0].source, 1);
        assert_eq!(references[0].name.as_deref(), Some("shirt"));
        assert_eq!(references[1].source, 1, "shared source must be preserved");

        assert!(replace_texture_png(&original, 2, &blue, 1024).is_err());
        assert!(replace_texture_png(&original, 0, b"not png", 1024).is_err());

        let mut external_root = root;
        external_root["buffers"][0]["uri"] = Value::from("external.bin");
        let external = fixture_bin(external_root, bin);
        assert!(replace_texture_png(&external, 0, &blue, 1024).is_err());
    }

    #[test]
    fn editor_texture_replacement_caps_compressed_inputs_before_copy() {
        assert!(ensure_editor_input_sizes(EDITOR_MAX_GLB_BYTES, EDITOR_MAX_PNG_BYTES).is_ok());
        assert!(ensure_editor_input_sizes(EDITOR_MAX_GLB_BYTES + 1, 0).is_err());
        assert!(ensure_editor_input_sizes(0, EDITOR_MAX_PNG_BYTES + 1).is_err());
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

    // ─── Skinning par pose (apply_pose_cpu) ──────────────────────────────────────────────

    use nie_core::animation::{BonePose, PoseFrame, Rotation};

    const SQUELETTE: SkeletonId = SkeletonId::new(7);
    const RACINE: BoneId = BoneId::new(1);
    const ENFANT: BoneId = BoneId::new(2);

    /// Deux os en chaîne le long de +X : la racine à l'origine, l'enfant à `x = 1`.
    ///
    /// Les `inverse_bind` sont les inverses exacts des mondes de liaison, donc appliquer la pose
    /// de liaison doit rendre la géométrie inchangée — c'est ce qu'un skinning correct garantit
    /// et ce qu'un skinning faux casse en premier.
    fn chaine() -> CpuSkinnedMesh {
        let translation = |x: f32| {
            let mut m = super::identity();
            m[0][3] = x;
            m
        };
        CpuSkinnedMesh {
            skeleton: SQUELETTE,
            joints: vec![
                SkinJoint {
                    bone: RACINE,
                    parent: None,
                    bind_local: super::identity(),
                    inverse_bind: super::identity(),
                },
                SkinJoint {
                    bone: ENFANT,
                    parent: Some(0),
                    bind_local: translation(1.0),
                    inverse_bind: translation(-1.0),
                },
            ],
            vertices: vec![
                SkinVertex {
                    position: [1.0, 0.0, 0.0],
                    normal: [0.0, 1.0, 0.0],
                    joints: [1, 0, 0, 0, 0, 0, 0, 0],
                    weights: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                },
                SkinVertex {
                    position: [2.0, 0.0, 0.0],
                    normal: [0.0, 1.0, 0.0],
                    joints: [1, 0, 0, 0, 0, 0, 0, 0],
                    weights: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                },
            ],
        }
    }

    fn pose(bones: Vec<(BoneId, BonePose)>) -> PoseFrame {
        PoseFrame {
            skeleton: SQUELETTE,
            time_seconds: 0.0,
            bones,
        }
    }

    /// Une pose VIDE laisse la géométrie au repos, elle ne l'écrase pas.
    ///
    /// C'est le test qui attrape la faute la plus tentante : remplacer un os non clé par
    /// l'identité. Ici l'enfant vit à `x = 1` ; l'identité le ramènerait à l'origine et tout le
    /// maillage se replierait, ce qui se voit comme un personnage écrasé plutôt que comme un bug.
    #[test]
    fn une_pose_vide_rend_la_pose_de_liaison() {
        let mesh = chaine();
        let rendu = apply_pose_cpu(&mesh, &pose(Vec::new())).expect("pose applicable");
        assert_eq!(rendu.len(), 2);
        for (obtenu, attendu) in rendu.iter().zip(&mesh.vertices) {
            for c in 0..3 {
                assert!(
                    (obtenu.position[c] - attendu.position[c]).abs() < 1e-5,
                    "sommet déplacé sans pose : {obtenu:?} au lieu de {attendu:?}"
                );
            }
        }
    }

    /// Une translation de la RACINE emmène l'enfant avec elle — la hiérarchie compose.
    ///
    /// Sans composition parent→enfant, le second sommet ne bougerait pas : c'est exactement la
    /// différence entre une chaîne d'os et une liste d'os.
    #[test]
    fn la_translation_de_la_racine_entraine_lenfant() {
        let mesh = chaine();
        let racine = BonePose {
            translation: nie_core::Vec3::new(0.0, 5.0, 0.0),
            ..Default::default()
        };
        let rendu = apply_pose_cpu(&mesh, &pose(vec![(RACINE, racine)])).expect("pose applicable");
        for (i, v) in rendu.iter().enumerate() {
            assert!(
                (v.position[1] - 5.0).abs() < 1e-5,
                "le sommet {i} n'a pas suivi la racine : {v:?}"
            );
        }
    }

    /// Un quart de tour de la racine autour de +Z envoie l'axe X sur l'axe Y, normale comprise.
    ///
    /// Valeurs attendues calculées à la main, pas relevées sur la sortie : un golden pris sur
    /// l'implémentation décrirait le défaut au lieu de la règle.
    #[test]
    fn un_quart_de_tour_de_la_racine_tourne_sommets_et_normales() {
        let mesh = chaine();
        let demi = core::f32::consts::FRAC_1_SQRT_2;
        // +90° autour de Z
        let racine = BonePose {
            rotation: Rotation::new(0.0, 0.0, demi, demi),
            ..Default::default()
        };
        let rendu = apply_pose_cpu(&mesh, &pose(vec![(RACINE, racine)])).expect("pose applicable");

        // (1,0,0) → (0,1,0) et (2,0,0) → (0,2,0)
        for (i, attendu) in [[0.0, 1.0, 0.0], [0.0, 2.0, 0.0]].iter().enumerate() {
            for c in 0..3 {
                assert!(
                    (rendu[i].position[c] - attendu[c]).abs() < 1e-4,
                    "sommet {i} : {:?} au lieu de {attendu:?}",
                    rendu[i].position
                );
            }
        }
        // La normale +Y part sur -X, et reste unitaire.
        assert!((rendu[0].normal[0] + 1.0).abs() < 1e-4, "{:?}", rendu[0].normal);
        assert!((rendu[0].normal[1]).abs() < 1e-4, "{:?}", rendu[0].normal);
    }

    /// Une pose d'un AUTRE squelette est refusée, pas appliquée au jugé.
    ///
    /// Appliquée, elle rendrait une déformation d'apparence plausible et fausse — le défaut le
    /// plus coûteux de ce domaine, parce que rien dans l'image ne le signale.
    #[test]
    fn une_pose_dun_autre_squelette_est_refusee() {
        let mesh = chaine();
        let etrangere = PoseFrame {
            skeleton: SkeletonId::new(99),
            time_seconds: 0.0,
            bones: Vec::new(),
        };
        let erreur = apply_pose_cpu(&mesh, &etrangere).expect_err("squelettes différents");
        assert!(
            format!("{erreur}").contains("squelette"),
            "l'erreur doit nommer la cause : {erreur}"
        );
    }

    /// Un parent déclaré APRÈS son enfant se résout quand même — la table n'est pas triée.
    ///
    /// `resolve_node_worlds` a déjà payé cette hypothèse sur les nœuds glTF ; la refaire ici
    /// aurait produit un enfant figé à sa pose de liaison, sans erreur.
    #[test]
    fn un_parent_declare_apres_son_enfant_se_resout() {
        let mut mesh = chaine();
        mesh.joints.swap(0, 1);
        mesh.joints[0].parent = Some(1); // l'enfant est maintenant en tête
        mesh.joints[1].parent = None;
        for vertex in &mut mesh.vertices {
            vertex.joints[0] = 0; // les sommets suivent l'enfant, désormais à l'index 0
        }
        let racine = BonePose {
            translation: nie_core::Vec3::new(0.0, 5.0, 0.0),
            ..Default::default()
        };
        let rendu = apply_pose_cpu(&mesh, &pose(vec![(RACINE, racine)])).expect("pose applicable");
        assert!(
            (rendu[0].position[1] - 5.0).abs() < 1e-5,
            "l'enfant n'a pas suivi un parent déclaré après lui : {:?}",
            rendu[0].position
        );
    }

    /// Une hiérarchie cyclique est refusée au lieu de boucler.
    #[test]
    fn une_hierarchie_cyclique_est_refusee() {
        let mut mesh = chaine();
        mesh.joints[0].parent = Some(1);
        mesh.joints[1].parent = Some(0);
        let erreur = apply_pose_cpu(&mesh, &pose(Vec::new())).expect_err("cycle");
        assert!(
            format!("{erreur}").contains("cyclique"),
            "l'erreur doit nommer la cause : {erreur}"
        );
    }

    /// Un poids qui désigne une jointure hors table est ignoré, et le reste est RENORMALISÉ.
    ///
    /// Sans renormalisation le sommet s'effondrerait vers l'origine en proportion du poids perdu,
    /// ce qui se lit comme un maillage qui fond plutôt que comme un index invalide.
    #[test]
    fn un_poids_vers_une_jointure_absente_est_ignore_et_le_reste_renormalise() {
        let mut mesh = chaine();
        mesh.vertices[0].joints = [1, 240, 0, 0, 0, 0, 0, 0];
        mesh.vertices[0].weights = [0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        let racine = BonePose {
            translation: nie_core::Vec3::new(0.0, 4.0, 0.0),
            ..Default::default()
        };
        let rendu = apply_pose_cpu(&mesh, &pose(vec![(RACINE, racine)])).expect("pose applicable");
        assert!(
            (rendu[0].position[1] - 4.0).abs() < 1e-5,
            "le poids restant doit porter tout le sommet : {:?}",
            rendu[0].position
        );
    }

    /// `pose_skin_matrices` rend bien une matrice par jointure — c'est le contrat du chemin GPU.
    #[test]
    fn les_matrices_de_peau_couvrent_chaque_jointure() {
        let mesh = chaine();
        let matrices = pose_skin_matrices(&mesh, &pose(Vec::new())).expect("pose applicable");
        assert_eq!(matrices.len(), mesh.joints.len());
        // Pose de liaison : monde * inverseBind == identité.
        for (i, m) in matrices.iter().enumerate() {
            for r in 0..3 {
                for c in 0..4 {
                    let attendu = if r == c { 1.0 } else { 0.0 };
                    assert!(
                        (m[r][c] - attendu).abs() < 1e-5,
                        "jointure {i} : la pose de liaison doit donner l'identité, {m:?}"
                    );
                }
            }
        }
    }

    /// La composition de hiérarchie de [`pose_skin_matrices`] DOIT donner, sur un vrai squelette
    /// du jeu, exactement ce que `g4sk` compose de son côté — à la transposition près.
    ///
    /// Les deux conventions ne coïncident pas par accident : `g4sk` stocke ses matrices en
    /// colonne-majeure (`m[col][row]`) et compose `mat_mul(a, b) = a·b` dans cette disposition,
    /// tandis que ce module est en ligne-majeure. Transposer chaque entrée et composer ici rend
    /// le MÊME produit mathématique — ce qui se démontre, mais qu'une erreur d'un caractère
    /// inverserait en `b·a` sans rien casser d'autre. L'exemple `anim_char` refait d'ailleurs
    /// cette composition à la main dans la convention de `g4sk` : c'est précisément la paire
    /// d'implémentations que ce test empêche de diverger.
    ///
    /// La pose n'est PAS la pose de repos : un os est tourné d'un quart de tour, sinon le produit
    /// `monde · inverseBind` vaudrait l'identité partout et le test passerait quelle que soit
    /// l'implémentation.
    ///
    /// Conditionnel : le squelette reste dans l'installation du joueur, aucun octet du jeu n'est
    /// écrit par ce test.
    #[test]
    fn la_composition_de_hierarchie_egale_celle_de_g4sk_sur_un_vrai_squelette() {
        use nie_formats::vfs::Vfs;
        use nie_formats::{g4sk, vfs};

        const SQUELETTE_REEL: SkeletonId = SkeletonId::new(1);
        const CHEMIN: &str = "data/common/chr/_face/11_VICTORY/c11010010/c11010010.g4sk";

        let mut v = Vfs::new();
        if v.init(vfs::resolve_game_dir().join("data")).is_err() {
            eprintln!("SKIP: VFS du jeu indisponible");
            return;
        }
        let Ok(bytes) = v.read(CHEMIN) else {
            eprintln!("SKIP: {CHEMIN} absent de ce VFS");
            return;
        };
        let Ok(header) = g4sk::parse_header(&bytes) else {
            eprintln!("SKIP: en-tête g4sk illisible");
            return;
        };
        let Some(poses) = g4sk::parse_poses(&bytes, &header) else {
            eprintln!("SKIP: poses de repos absentes");
            return;
        };
        let hierarchie = g4sk::parse_hierarchy(&bytes, &header);
        let parents: Vec<i16> = hierarchie.bones.iter().map(|b| b.parent_index).collect();
        if poses.len() < 4 || parents.len() != poses.len() {
            eprintln!("SKIP: squelette trop petit ou incohérent");
            return;
        }

        // Le quart de tour porte sur un os qui a des descendants, pour que la composition compte.
        let tourne = (0..poses.len())
            .find(|i| parents.contains(&(*i as i16)))
            .expect("au moins un os parent");
        let demi = core::f32::consts::FRAC_1_SQRT_2;
        let quat_tourne = [0.0, 0.0, demi, demi];

        // Référence : la composition de `g4sk`, dans sa propre convention.
        let mut poses_mod = poses.clone();
        poses_mod[tourne].local.quat = quat_tourne;
        let mondes = g4sk::rest_world_matrices(&poses_mod, &parents);
        let reference: Vec<[[f32; 4]; 4]> = (0..poses.len())
            .map(|i| g4sk::mat_mul(&mondes[i], &poses[i].inverse_bind))
            .collect();

        // Le même calcul par la bibliothèque, entrées transposées en ligne-majeure.
        let transposer = |m: &[[f32; 4]; 4]| -> SkinMatrix {
            let mut out = [[0.0f32; 4]; 4];
            for (r, row) in out.iter_mut().enumerate() {
                for (c, cell) in row.iter_mut().enumerate() {
                    *cell = m[c][r];
                }
            }
            out
        };
        let mesh = CpuSkinnedMesh {
            skeleton: SQUELETTE_REEL,
            joints: (0..poses.len())
                .map(|i| SkinJoint {
                    bone: BoneId::new(u16::try_from(i).expect("index d'os")),
                    parent: (parents[i] >= 0 && (parents[i] as usize) < poses.len())
                        .then(|| parents[i] as usize),
                    bind_local: transposer(&g4sk::local_matrix(&poses[i].local)),
                    inverse_bind: transposer(&poses[i].inverse_bind),
                })
                .collect(),
            vertices: Vec::new(),
        };
        let pose = PoseFrame {
            skeleton: SQUELETTE_REEL,
            time_seconds: 0.0,
            bones: vec![(
                BoneId::new(u16::try_from(tourne).expect("index d'os")),
                BonePose {
                    translation: nie_core::Vec3::new(
                        poses[tourne].local.translation[0],
                        poses[tourne].local.translation[1],
                        poses[tourne].local.translation[2],
                    ),
                    rotation: Rotation::new(0.0, 0.0, demi, demi),
                    scale: nie_core::Vec3::new(
                        poses[tourne].local.scale[0],
                        poses[tourne].local.scale[1],
                        poses[tourne].local.scale[2],
                    ),
                },
            )],
        };
        let obtenu = pose_skin_matrices(&mesh, &pose).expect("pose applicable");

        assert_eq!(obtenu.len(), reference.len());
        let mut ecart_max = 0.0f32;
        for (i, (mine, theirs)) in obtenu.iter().zip(&reference).enumerate() {
            for r in 0..4 {
                for c in 0..4 {
                    let ecart = (mine[r][c] - theirs[c][r]).abs();
                    ecart_max = ecart_max.max(ecart);
                    assert!(
                        ecart < 1e-3,
                        "os {i}, ligne {r} colonne {c} : {} contre {} (g4sk)",
                        mine[r][c],
                        theirs[c][r]
                    );
                }
            }
        }
        eprintln!(
            "{} os comparés sur {CHEMIN}, écart maximal {ecart_max:.2e}",
            obtenu.len()
        );
    }
}
