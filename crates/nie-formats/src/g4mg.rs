//! Extraction de géométrie G4MG (Level-5 « Graphics 4 Mesh Geometry »).
//!
//! Port Rust de `IECODE.Core/Formats/Level5/G4mgParser.cs` (`ExtractGeometry` L178,
//! `DecodeNormal` L364, `DecodeUv` L392, `Snorm16` L415, `Vec3ByteSize`/`Vec2ByteSize`
//! L341/L352). Commits de référence : `e59f0b3` (normales SNORM16 + UV0) et `e444a88`.
//!
//! ## Les .g4mg réels sont SANS EN-TÊTE
//!
//! L'offset 0 d'un .g4mg est directement de la donnée vertex (un float, pas de magic). TOUTES
//! les métadonnées (stride, offsets/comptes des buffers, table d'attributs, sous-mailles)
//! viennent du `.g4md` compagnon de même basename. On ne peut donc PAS décoder un .g4mg seul :
//! [`extract_geometry`] prend un [`crate::g4md::G4md`] déjà parsé.
//!
//! ## Règles de décodage (vérifiées sur chr/_uniform u11130090)
//!
//! - **stride** = `submesh.stride` (sinon dérivé `face_data_base / total_verts`) ;
//! - **positions** = float3 LE à +0 de chaque vertex (`v_offset + i*stride`) ;
//! - **normale** (vtype=2) à son offset réel : float32×3, ou SNORM16 short×3 → `max(s/32767,-1)`,
//!   renormalisée ;
//! - **UV0** (vtype=10) : float32×2, ushort UNORM16 → `u/65535`, short SNORM16 → `s/32767` ;
//! - **indices** à `face_data_base + submesh.index_offset`, u16 par défaut, u32 si
//!   `vertex_count > 65535`, LOCAUX à la sous-maille.
//!
//! On ne fabrique JAMAIS de normale/UV si l'attribut est absent ou ne tient pas dans le stride
//! (liste vide → le writer GLB n'émet pas l'accessor correspondant).
//!
//! Référence externe : loader Noesis `inazuma_switch.py` (AFGRocha), seul loader IEVR public.
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::g4md::{G4md, VertexAttribute};

/// Vecteur 3 composantes (positions / normales).
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vec3 {
    /// Composante X.
    pub x: f32,
    /// Composante Y.
    pub y: f32,
    /// Composante Z.
    pub z: f32,
}

/// Vecteur 2 composantes (UV).
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Vec2 {
    /// Composante U.
    pub u: f32,
    /// Composante V.
    pub v: f32,
}

/// Géométrie d'une sous-maille extraite.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SubmeshGeometry {
    /// Index de la sous-maille dans le .g4md.
    pub index: usize,
    /// Nombre de vertices.
    pub vertex_count: usize,
    /// Stride effectif (octets).
    pub stride: usize,
    /// Index de matériau.
    pub material_index: u8,
    /// Indices 32 bits ? (vertex_count > 65535).
    pub index32: bool,
    /// Positions (float3 à +0).
    pub positions: Vec<Vec3>,
    /// Normales décodées (vide si attribut absent/illisible).
    pub normals: Vec<Vec3>,
    /// UV0 décodés (vide si attribut absent/illisible).
    pub uv0: Vec<Vec2>,
    /// Indices locaux à la sous-maille.
    pub indices: Vec<u32>,
}

/// Extrait la géométrie de toutes les sous-mailles d'un .g4mg piloté par le .g4md compagnon.
#[must_use]
pub fn extract_geometry(g4mg: &[u8], g4md: &G4md) -> Vec<SubmeshGeometry> {
    let face_data_base = g4md.header.face_data_base as usize;
    let normal_attr = g4md.find_attribute(2);
    let uv_attr = g4md.find_attribute(10);

    // Stride dérivé : région vertex [0, face_data_base) / nombre total de vertices.
    let total_verts: usize = g4md.submeshes.iter().map(|s| s.vertex_count as usize).sum();
    let derived_stride = if face_data_base > 0 && total_verts > 0 {
        face_data_base / total_verts
    } else {
        0
    };

    let mut out = Vec::with_capacity(g4md.submeshes.len());

    for (idx, sm) in g4md.submeshes.iter().enumerate() {
        let vertex_count = sm.vertex_count as usize;
        if vertex_count == 0 {
            continue;
        }

        let stride = if sm.stride > 0 { sm.stride as usize } else { derived_stride };
        if stride < 12 {
            continue; // pas de place pour une position float3
        }

        let v_offset = sm.vertex_offset as usize;
        let v_end = v_offset + vertex_count * stride;
        if v_end > g4mg.len() {
            continue;
        }

        // Décodage conditionnel des normales/UV : l'attribut doit tenir dans le stride.
        let decode_normal = normal_attr.filter(|a| {
            let sz = vec3_byte_size(a.datatype);
            sz > 0 && a.offset as usize + sz <= stride
        });
        let decode_uv = uv_attr.filter(|a| {
            let sz = vec2_byte_size(a.datatype);
            sz > 0 && a.offset as usize + sz <= stride
        });

        let mut positions = Vec::with_capacity(vertex_count);
        let mut normals = Vec::with_capacity(if decode_normal.is_some() { vertex_count } else { 0 });
        let mut uv0 = Vec::with_capacity(if decode_uv.is_some() { vertex_count } else { 0 });

        for i in 0..vertex_count {
            let p = v_offset + i * stride;
            positions.push(Vec3 {
                x: sanitize(read_f32(g4mg, p)),
                y: sanitize(read_f32(g4mg, p + 4)),
                z: sanitize(read_f32(g4mg, p + 8)),
            });
            if let Some(a) = decode_normal {
                normals.push(decode_normal_at(g4mg, p + a.offset as usize, a.datatype));
            }
            if let Some(a) = decode_uv {
                uv0.push(decode_uv_at(g4mg, p + a.offset as usize, a.datatype));
            }
        }

        // Indices.
        let index_count = sm.index_count as usize;
        let index32 = vertex_count > 65535;
        let idx_size = if index32 { 4 } else { 2 };
        let i_offset = face_data_base + sm.index_offset as usize;
        let i_end = i_offset + index_count * idx_size;

        let mut indices = Vec::with_capacity(index_count);
        if index_count > 0 && i_end <= g4mg.len() {
            for i in 0..index_count {
                let p = i_offset + i * idx_size;
                let v = if index32 {
                    read_u32(g4mg, p)
                } else {
                    u32::from(read_u16(g4mg, p))
                };
                indices.push(v);
            }
        }

        out.push(SubmeshGeometry {
            index: idx,
            vertex_count,
            stride,
            material_index: sm.material_index,
            index32,
            positions,
            normals,
            uv0,
            indices,
        });
    }

    out
}

/// Nom de texture base-color pour la sous-maille (via `material_index` → `material_base_names`).
#[must_use]
pub fn material_base_name<'a>(g4md: &'a G4md, sm: &SubmeshGeometry) -> Option<&'a String> {
    g4md.material_base_names.get(sm.material_index as usize)
}

/// Taille (octets) d'un vecteur 3 composantes (2/3=float→12 ; 18/20=short SNORM16→6).
#[must_use]
pub fn vec3_byte_size(datatype: u32) -> usize {
    match datatype {
        2 | 3 => 12,
        18 | 20 => 6,
        _ => 0,
    }
}

/// Taille (octets) d'un vecteur 2 composantes (2/3=float→8 ; 14=ushort→4 ; 18/20=short→4).
#[must_use]
pub fn vec2_byte_size(datatype: u32) -> usize {
    match datatype {
        2 | 3 => 8,
        14 | 18 | 20 => 4,
        _ => 0,
    }
}

/// SNORM16 : `max(s/32767, -1)` (convention glTF/OpenGL).
#[must_use]
pub fn snorm16(s: i16) -> f32 {
    (s as f32 / 32767.0).max(-1.0)
}

/// Décode une normale à `off` et la renormalise (port de `DecodeNormal`).
fn decode_normal_at(data: &[u8], off: usize, datatype: u32) -> Vec3 {
    let (mut x, mut y, mut z) = match datatype {
        2 | 3 => (read_f32(data, off), read_f32(data, off + 4), read_f32(data, off + 8)),
        _ => (
            snorm16(read_i16(data, off)),
            snorm16(read_i16(data, off + 2)),
            snorm16(read_i16(data, off + 4)),
        ),
    };
    x = sanitize(x);
    y = sanitize(y);
    z = sanitize(z);
    let len = (x * x + y * y + z * z).sqrt();
    if len > 1e-6 {
        Vec3 { x: x / len, y: y / len, z: z / len }
    } else {
        Vec3 { x: 0.0, y: 0.0, z: 1.0 } // normale dégénérée : repli sûr
    }
}

/// Décode un UV0 à `off` (port de `DecodeUv`).
fn decode_uv_at(data: &[u8], off: usize, datatype: u32) -> Vec2 {
    let (u, v) = match datatype {
        2 | 3 => (read_f32(data, off), read_f32(data, off + 4)),
        14 => (
            f32::from(read_u16(data, off)) / 65535.0,
            f32::from(read_u16(data, off + 2)) / 65535.0,
        ),
        _ => (snorm16(read_i16(data, off)), snorm16(read_i16(data, off + 2))),
    };
    Vec2 { u: sanitize(u), v: sanitize(v) }
}

fn sanitize(f: f32) -> f32 {
    if f.is_finite() { f } else { 0.0 }
}

fn read_f32(data: &[u8], off: usize) -> f32 {
    data.get(off..off + 4)
        .and_then(|s| <[u8; 4]>::try_from(s).ok())
        .map_or(0.0, f32::from_le_bytes)
}

fn read_u16(data: &[u8], off: usize) -> u16 {
    data.get(off..off + 2)
        .and_then(|s| <[u8; 2]>::try_from(s).ok())
        .map_or(0, u16::from_le_bytes)
}

fn read_i16(data: &[u8], off: usize) -> i16 {
    read_u16(data, off) as i16
}

fn read_u32(data: &[u8], off: usize) -> u32 {
    data.get(off..off + 4)
        .and_then(|s| <[u8; 4]>::try_from(s).ok())
        .map_or(0, u32::from_le_bytes)
}

/// Expose la table d'attributs résolue (pour les writers GLB).
#[must_use]
pub fn attributes(g4md: &G4md) -> &[VertexAttribute] {
    &g4md.attributes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::g4md;

    /// Construit un g4md + g4mg synthétiques cohérents avec le layout chr/_uniform :
    /// stride 68, normale short×3 @12, uv ushort×2 @64, face_data_base placé après les vertices.
    fn build_pair(vertex_count: usize) -> (g4md::G4md, Vec<u8>) {
        let stride = 68usize;
        let face_data_base = vertex_count * stride; // bloc d'index juste après les vertices
        let submesh_info = 0x60usize;
        let attr_table = submesh_info + SUBMESH_RECORD_SIZE_LOCAL + 8;
        let str_region = attr_table + 4 * 8;

        let mut md = alloc::vec![0u8; str_region];
        md[0..4].copy_from_slice(&g4md::MAGIC_LE.to_le_bytes());
        md[0x04..0x06].copy_from_slice(&(submesh_info as u16).to_le_bytes());
        md[0x20..0x22].copy_from_slice(&1u16.to_le_bytes()); // submesh_count
        md[0x22..0x24].copy_from_slice(&1u16.to_le_bytes()); // material_count
        md[0x26] = 3; // vlayout_count
        md[0x5C..0x60].copy_from_slice(&(face_data_base as u32).to_le_bytes());

        let r = submesh_info;
        md[r..r + 4].copy_from_slice(&0u32.to_le_bytes()); // vertex_offset
        md[r + 0x04..r + 0x08].copy_from_slice(&0u32.to_le_bytes()); // index_offset (relatif)
        md[r + 0x08..r + 0x0C].copy_from_slice(&(vertex_count as u32).to_le_bytes());
        md[r + 0x0C..r + 0x10].copy_from_slice(&3u32.to_le_bytes()); // index_count = 3 (1 tri)
        md[r + 0x2E] = stride as u8;

        let put = |buf: &mut [u8], base: usize, vt: u8, off: u16, dt: u32| {
            buf[base] = vt;
            buf[base + 1..base + 3].copy_from_slice(&off.to_le_bytes());
            buf[base + 4..base + 8].copy_from_slice(&dt.to_le_bytes());
        };
        put(&mut md, attr_table, 1, 0, 3); // position float
        put(&mut md, attr_table + 8, 2, 12, 18); // normale short SNORM16
        put(&mut md, attr_table + 16, 10, 64, 14); // uv ushort UNORM16
        md.extend_from_slice(b"mat_10M\0mat_10\0");

        let parsed = g4md::parse(&md).expect("g4md synthétique");

        // g4mg : vertices puis 3 indices u16.
        let mut mg = alloc::vec![0u8; face_data_base + 3 * 2];
        for i in 0..vertex_count {
            let p = i * stride;
            // position (i, 0, 0)
            mg[p..p + 4].copy_from_slice(&(i as f32).to_le_bytes());
            // normale @12 : (0, 0, 32767) → SNORM16 (0,0,1) après renorm
            mg[p + 12..p + 14].copy_from_slice(&0i16.to_le_bytes());
            mg[p + 14..p + 16].copy_from_slice(&0i16.to_le_bytes());
            mg[p + 16..p + 18].copy_from_slice(&32767i16.to_le_bytes());
            // uv @64 : (65535, 0) → UNORM16 (1.0, 0.0)
            mg[p + 64..p + 66].copy_from_slice(&65535u16.to_le_bytes());
            mg[p + 66..p + 68].copy_from_slice(&0u16.to_le_bytes());
        }
        // indices 0,1,2
        for (k, v) in [0u16, 1, 2].into_iter().enumerate() {
            let q = face_data_base + k * 2;
            mg[q..q + 2].copy_from_slice(&v.to_le_bytes());
        }

        (parsed, mg)
    }

    const SUBMESH_RECORD_SIZE_LOCAL: usize = 0x50;

    #[test]
    fn extract_positions_normales_uv_golden() {
        let (md, mg) = build_pair(3);
        let geo = extract_geometry(&mg, &md);
        assert_eq!(geo.len(), 1);
        let g = &geo[0];
        assert_eq!(g.vertex_count, 3);
        assert_eq!(g.stride, 68);

        // Positions = (0,0,0),(1,0,0),(2,0,0).
        assert_eq!(g.positions[0], Vec3 { x: 0.0, y: 0.0, z: 0.0 });
        assert_eq!(g.positions[1].x, 1.0);
        assert_eq!(g.positions[2].x, 2.0);

        // Normales décodées & renormalisées : |n| = 1, ≈ (0,0,1).
        assert_eq!(g.normals.len(), 3);
        for n in &g.normals {
            let len = (n.x * n.x + n.y * n.y + n.z * n.z).sqrt();
            assert!((len - 1.0).abs() < 1e-4, "normale non unitaire: {len}");
            assert!((n.z - 1.0).abs() < 1e-3);
        }

        // UV0 ∈ [0,1] : (1.0, 0.0).
        assert_eq!(g.uv0.len(), 3);
        for uv in &g.uv0 {
            assert!((uv.u - 1.0).abs() < 1e-4);
            assert!(uv.v.abs() < 1e-4);
        }

        // Indices locaux 0,1,2.
        assert_eq!(g.indices, alloc::vec![0u32, 1, 2]);
        assert!(!g.index32);
    }

    #[test]
    fn pas_de_fabrication_si_attribut_hors_stride() {
        // Construit une paire dont le stride (20) ne couvre PAS l'UV (@64) : aucun UV émis,
        // mais la normale (@12, short×3 = 6 octets, 12+6=18 ≤ 20) reste décodée. Vérifie qu'on
        // ne FABRIQUE rien hors stride (liste vide), tout en gardant les positions.
        let stride = 20u8;
        let vertex_count = 2usize;
        let face_data_base = vertex_count * stride as usize;
        let submesh_info = 0x60usize;
        let attr_table = submesh_info + SUBMESH_RECORD_SIZE_LOCAL + 8;
        let str_region = attr_table + 4 * 8;

        let mut md = alloc::vec![0u8; str_region];
        md[0..4].copy_from_slice(&g4md::MAGIC_LE.to_le_bytes());
        md[0x04..0x06].copy_from_slice(&(submesh_info as u16).to_le_bytes());
        md[0x20..0x22].copy_from_slice(&1u16.to_le_bytes());
        md[0x22..0x24].copy_from_slice(&1u16.to_le_bytes());
        md[0x5C..0x60].copy_from_slice(&(face_data_base as u32).to_le_bytes());
        let r = submesh_info;
        md[r + 0x08..r + 0x0C].copy_from_slice(&(vertex_count as u32).to_le_bytes());
        md[r + 0x0C..r + 0x10].copy_from_slice(&0u32.to_le_bytes());
        md[r + 0x2E] = stride;
        let put = |buf: &mut [u8], base: usize, vt: u8, off: u16, dt: u32| {
            buf[base] = vt;
            buf[base + 1..base + 3].copy_from_slice(&off.to_le_bytes());
            buf[base + 4..base + 8].copy_from_slice(&dt.to_le_bytes());
        };
        put(&mut md, attr_table, 1, 0, 3);
        put(&mut md, attr_table + 8, 2, 12, 18);
        put(&mut md, attr_table + 16, 10, 64, 14); // UV @64 : hors d'un stride de 20
        md.extend_from_slice(b"mat_10M\0mat_10\0");
        let md = g4md::parse(&md).unwrap();

        let mg = alloc::vec![0u8; face_data_base];
        let geo = extract_geometry(&mg, &md);
        assert_eq!(geo.len(), 1);
        let g = &geo[0];
        assert_eq!(g.positions.len(), 2);
        // Normale dans le stride → décodée ; UV hors stride → liste vide (pas de fabrication).
        assert_eq!(g.normals.len(), 2);
        assert!(g.uv0.is_empty(), "UV hors stride NE doit PAS être fabriqué");
    }

    #[test]
    fn snorm16_borne() {
        assert_eq!(snorm16(32767), 1.0);
        assert_eq!(snorm16(0), 0.0);
        // -32768/32767 = -1.00003 → clampé à -1.
        assert_eq!(snorm16(-32768), -1.0);
    }

    #[test]
    fn material_base_name_via_index() {
        let (md, mg) = build_pair(3);
        let geo = extract_geometry(&mg, &md);
        let base = material_base_name(&md, &geo[0]);
        assert_eq!(base.map(String::as_str), Some("mat_10"));
    }
}
