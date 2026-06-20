//! Parseur **GLB** (glTF binaire 2.0) minimal — extrait la géométrie (positions/normales/indices)
//! des primitives de mesh. Cible : les GLB produits par `nie_formats::assemble::to_glb_embedded`
//! (positions déjà en espace monde) ; on ignore donc les transforms de nœuds.

use anyhow::{Context, Result, bail};
use serde_json::Value;

/// Une primitive de mesh : triangles indexés, positions + normales (espace monde).
pub struct Primitive {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

/// Modèle GLB chargé : toutes les primitives de tous les meshes.
pub struct Model {
    pub primitives: Vec<Primitive>,
}

fn rd_u32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}

/// Parse un buffer GLB complet.
///
/// # Errors
/// Si le magic n'est pas « glTF », si les chunks JSON/BIN manquent, ou si le glTF est malformé.
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
    let views = root["bufferViews"].as_array().context("bufferViews absents")?;

    // Lit un accessor scalaire/vecteur en f32 (composantes consécutives).
    let read_floats = |acc_idx: usize, ncomp: usize| -> Result<Vec<f32>> {
        let acc = &accessors[acc_idx];
        let bv = &views[acc["bufferView"].as_u64().context("bufferView")? as usize];
        let comp_ty = acc["componentType"].as_u64().context("componentType")?;
        let count = acc["count"].as_u64().context("count")? as usize;
        let base = bv["byteOffset"].as_u64().unwrap_or(0) as usize
            + acc["byteOffset"].as_u64().unwrap_or(0) as usize;
        let comp_sz = match comp_ty {
            5126 => 4,
            5125 => 4,
            5123 => 2,
            5121 => 1,
            other => bail!("componentType {other} non géré"),
        };
        let stride = bv["byteStride"].as_u64().map(|s| s as usize).unwrap_or(ncomp * comp_sz);
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

    let mut primitives = Vec::new();
    let empty = Vec::new();
    for mesh in root["meshes"].as_array().unwrap_or(&empty) {
        for prim in mesh["primitives"].as_array().unwrap_or(&empty) {
            let attrs = &prim["attributes"];
            let Some(pos_acc) = attrs["POSITION"].as_u64() else { continue };
            let pf = read_floats(pos_acc as usize, 3)?;
            let positions: Vec<[f32; 3]> = pf.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            let normals: Vec<[f32; 3]> = match attrs["NORMAL"].as_u64() {
                Some(a) => read_floats(a as usize, 3)?
                    .chunks_exact(3)
                    .map(|c| [c[0], c[1], c[2]])
                    .collect(),
                None => Vec::new(),
            };
            let indices: Vec<u32> = match prim["indices"].as_u64() {
                Some(a) => read_floats(a as usize, 1)?.iter().map(|&f| f as u32).collect(),
                None => (0..positions.len() as u32).collect(),
            };
            primitives.push(Primitive { positions, normals, indices });
        }
    }
    if primitives.is_empty() {
        bail!("aucune primitive de mesh dans le GLB");
    }
    Ok(Model { primitives })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejette_non_glb() {
        assert!(parse(b"pas un glb").is_err());
        assert!(parse(b"glTF").is_err()); // magic mais trop court
    }
}
