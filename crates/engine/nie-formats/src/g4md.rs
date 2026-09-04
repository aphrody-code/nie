//! Lecteur de métadonnées de modèle G4MD (Level-5 « Graphics 4 Model Data »).
//!
//! Port Rust de `IECODE.Core/Formats/Level5/G4mdParser.cs` :
//! - `G4mdHeader` (L38, offsets annotés) ;
//! - `ParseSubmeshes` (L481, records 0x50 : champs +0x00/+0x04/+0x08/+0x0C/+0x2E/+0x32/+0x33) ;
//! - table d'attributs vertex (`ReadVertexAttributes`, 8 octets/attribut) ;
//! - `ExtractMaterialBaseNames` (L261, run terminal de 2·material_count chaînes).
//!
//! Header issu du RE de `nie.exe` FUN_14056d530 (cité G4mdParser.cs L11-14), formule
//! `GetSectionOffset = (section_base + offset) * 4` (L468).
//!
//! ## Endianness
//!
//! Le magic est stocké little-endian (`0x444D3447`) ou big-endian (`0x47344D44`) ; tous les
//! champs multi-octets suivent l'endianness détectée au magic.
//!
//! ## Validation
//!
//! Aucun `.g4md` isolé n'est présent sur le VPS (ils vivent dans les `.cpk` chr chiffrés). La
//! logique d'offsets est donc validée par un **fixture synthétique** reproduisant le record 0x50
//! ainsi que la table d'attributs (1er attribut toujours `vtype=1 offset=0`), conformément à la
//! consigne du livrable. Les valeurs de champs (stride 68, normale short×3 @12, uv ushort×2 @64,
//! base `[u11130090_10]`) proviennent du RE C# vérifié octet par octet sur chr/_uniform u11130090.
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::{string::String, vec::Vec};

use crate::FormatError;

/// Magic « G4MD » little-endian (`0x444D3447`).
pub const MAGIC_LE: u32 = 0x444D_3447;
/// Magic « G4MD » big-endian (`0x47344D44`).
pub const MAGIC_BE: u32 = 0x4734_4D44;

/// Taille d'un record de sous-maille (octets).
pub const SUBMESH_RECORD_SIZE: usize = 0x50;
/// Taille d'un attribut de layout vertex (octets).
pub const ATTR_SIZE: usize = 8;

/// En-tête G4MD (champs vérifiés sur fichiers réels).
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4mdHeader {
    /// Vrai si le fichier est big-endian.
    pub big_endian: bool,
    /// Offset de la table des sous-mailles (@0x04).
    pub submesh_info: u16,
    /// Base pour le calcul des offsets de section (@0x0A).
    pub section_base: u16,
    /// Nombre de sous-mailles (@0x20).
    pub submesh_count: u16,
    /// Nombre de matériaux (@0x22).
    pub material_count: u16,
    /// Nombre de références d'os (@0x24).
    pub bone_count: u8,
    /// Nombre d'attributs dans la table de layout vertex (@0x26).
    pub vlayout_count: u8,
    /// Base du bloc de données d'index (face_data) dans le .g4mg compagnon (@0x5C).
    pub face_data_base: u32,
}

/// Sous-maille décodée (record 0x50).
///
/// ## Deux lectures du même record
///
/// Les champs `stride`, `layout_num` et `material_index` (@+0x2E/+0x32/+0x33) sont ceux du
/// port C# d'origine. Recoupés octet par octet le 2026-09-04 sur des fichiers réels du jeu
/// (`_face/01_IE1/c01001900`, `_uniform/u011001`, `_uniform/sk000101`, `_base/base_normal_00`),
/// ces trois offsets tombent dans les **bornes flottantes** du record et valent 0 partout. Les
/// vrais champs sont 0x10 plus loin :
///
/// ```text
/// +0x00 u32 vertex_offset    +0x04 u32 index_offset    +0x08 u32 vertex_count
/// +0x0C u32 index_count      +0x10 f32×4 centre        +0x20 f32×4 étendue
/// +0x30 u32 triangle_count   +0x34 u16 lod_id (0xFF = niveau unique, 1/2/0xFC = chaîne LOD)
/// +0x38 u16 name_index       +0x3A u16 palette_offset  +0x3C u16 flags0 (0x100 | longueur palette)
/// +0x3E u16 flags1 (octet bas = stride)                 +0x42 u8 layout_index  +0x43 u8 material_slot
/// ```
///
/// Les anciens champs sont conservés (le fixture synthétique et les maps les remplissent) ; les
/// nouveaux sont préférés quand ils sont non nuls. `material_slot` est la vraie table de matériau :
/// sur `c01001900`, elle vaut `[2, 0, 1]` (chevelure, œil, bouche) là où +0x33 donne `[0, 0, 0]`.
#[derive(Debug, Clone, Copy)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Submesh {
    /// Offset du buffer vertex en octets (@+0x00).
    pub vertex_offset: u32,
    /// Offset du buffer d'index en octets, à ajouter à `face_data_base` (@+0x04).
    pub index_offset: u32,
    /// Nombre de vertices (@+0x08).
    pub vertex_count: u32,
    /// Nombre d'indices (= face_count) (@+0x0C).
    pub index_count: u32,
    /// Pas (stride) du vertex en octets (@+0x2E, lecture historique — souvent 0 sur le réel).
    pub stride: u8,
    /// Numéro de layout vertex (@+0x32, lecture historique).
    pub layout_num: u8,
    /// Index de matériau (@+0x33, lecture historique — 0 sur tous les fichiers réels mesurés).
    pub material_index: u8,
    /// Nombre de triangles (@+0x30).
    pub triangle_count: u32,
    /// Identifiant de niveau de détail (@+0x34) : `0xFF` = niveau unique.
    pub lod_id: u16,
    /// Index du nom de maille dans la table de noms (@+0x38).
    pub name_index: u16,
    /// Premier slot de cette maille dans la table de palette d'os (@+0x3A).
    pub palette_offset: u16,
    /// Longueur de la palette d'os (octet bas de +0x3C, valide si le bit 0x100 est levé).
    pub palette_len: u8,
    /// Stride réel du vertex (octet bas de +0x3E), 0 si absent.
    pub vertex_stride: u8,
    /// Index du layout vertex de cette maille (@+0x42).
    pub layout_index: u8,
    /// Index de matériau réel (@+0x43).
    pub material_slot: u8,
}

impl Submesh {
    /// Stride effectif déclaré : le champ historique s'il est renseigné, sinon le champ réel.
    #[must_use]
    pub fn declared_stride(&self) -> usize {
        if self.stride > 0 {
            self.stride as usize
        } else {
            self.vertex_stride as usize
        }
    }
}

/// Attribut de layout vertex (8 octets) : `vtype` (1=pos, 2=normale, 10=UV0), `offset` dans le
/// vertex, `datatype` (2/3=float, 14=ushort, 18/20=short SNORM16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct VertexAttribute {
    /// Type d'attribut (1=position, 2=normale, 10=UV0…).
    pub vtype: u8,
    /// Offset de l'attribut dans le vertex.
    pub offset: u16,
    /// Type de donnée (2/3=float32, 14=ushort, 18/20=short SNORM16).
    pub datatype: u32,
}

/// Données G4MD parsées.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct G4md {
    /// En-tête.
    pub header: G4mdHeader,
    /// Sous-mailles.
    pub submeshes: Vec<Submesh>,
    /// Premier layout d'attributs vertex (table à `submesh_info + submesh_count*0x50 + 8`).
    pub attributes: Vec<VertexAttribute>,
    /// Tous les layouts vertex, dans l'ordre de la table (`vlayout_count` entrées). Une
    /// sous-maille désigne le sien par [`Submesh::layout_index`].
    pub layouts: Vec<Vec<VertexAttribute>>,
    /// Noms de texture base-color par index de matériau : la table d'offsets `u16 @0x86`
    /// débarrassée de son `M` final (`u011001_20M` → `u011001_20`), sinon la seconde moitié du
    /// run terminal de chaînes.
    pub material_base_names: Vec<String>,
    /// Noms de matériaux tels qu'écrits (`u011001_20M`), depuis la table `u16 @0x86`. Vide si
    /// le fichier ne la déclare pas.
    pub material_names: Vec<String>,
    /// Nom de chaque sous-maille (`u011001_20_LOD1`…), depuis la table `u16 @0x84`, dans l'ordre
    /// des records. Vide si absente.
    pub mesh_names: Vec<String>,
    /// Table de hachage des os référencés : `bone_count` CRC32 (IEEE, standard) de noms d'os,
    /// à la section `u16 @0x74`. Les slots de palette y indexent.
    pub joint_hashes: Vec<u32>,
    /// Table de palette d'os (`u16 @0x82`) : chaque valeur est un index dans `joint_hashes`.
    /// Une sous-maille lit `palette_offset..palette_offset+palette_len` dedans, et ses indices
    /// d'os par vertex (`BLENDINDICES`) sont locaux à cette tranche.
    pub joint_palette: Vec<u16>,
}

impl G4md {
    /// Offset absolu d'une section : `(section_base + relative) * 4` (FUN_14056d530, L468).
    #[must_use]
    pub fn section_offset(&self, relative: u16) -> usize {
        (self.header.section_base as usize + relative as usize) * 4
    }

    /// Premier attribut du `vtype` demandé (position=1, normale=2, UV0=10), ou `None`.
    #[must_use]
    pub fn find_attribute(&self, vtype: u8) -> Option<VertexAttribute> {
        self.attributes.iter().copied().find(|a| a.vtype == vtype)
    }

    /// Layout vertex d'une sous-maille : le sien si la table le connaît, sinon le premier.
    #[must_use]
    pub fn layout_of(&self, sm: &Submesh) -> &[VertexAttribute] {
        self.layouts
            .get(sm.layout_index as usize)
            .filter(|l| !l.is_empty())
            .map_or(self.attributes.as_slice(), Vec::as_slice)
    }

    /// Attribut `vtype` dans le layout propre à la sous-maille.
    #[must_use]
    pub fn find_attribute_of(&self, sm: &Submesh, vtype: u8) -> Option<VertexAttribute> {
        self.layout_of(sm)
            .iter()
            .copied()
            .find(|a| a.vtype == vtype)
    }

    /// Taille en octets occupée par un attribut dans le vertex : jusqu'à l'attribut suivant du
    /// layout (par offset croissant), sinon jusqu'à la fin du stride.
    #[must_use]
    pub fn attribute_extent(&self, sm: &Submesh, attr: VertexAttribute, stride: usize) -> usize {
        let next = self
            .layout_of(sm)
            .iter()
            .map(|a| a.offset as usize)
            .filter(|&o| o > attr.offset as usize)
            .min()
            .unwrap_or(stride);
        next.min(stride).saturating_sub(attr.offset as usize)
    }

    /// Tranche de palette d'os d'une sous-maille (indices dans `joint_hashes`). Vide si la
    /// maille n'en déclare pas ou si la table ne la couvre pas.
    #[must_use]
    pub fn palette_of(&self, sm: &Submesh) -> &[u16] {
        let start = sm.palette_offset as usize;
        let end = start + sm.palette_len as usize;
        if sm.palette_len == 0 || end > self.joint_palette.len() {
            return &[];
        }
        &self.joint_palette[start..end]
    }

    /// Hachage d'os (CRC32 du nom) pour un index local de palette d'une sous-maille.
    #[must_use]
    pub fn joint_hash_for(&self, sm: &Submesh, local: usize) -> Option<u32> {
        let slot = *self.palette_of(sm).get(local)?;
        self.joint_hashes.get(slot as usize).copied()
    }

    /// Nom de la `i`-ème sous-maille (`u011001_20_LOD1`), si la table de noms est connue.
    ///
    /// La table est **positionnelle** : le `name_index` du record n'y indexe pas (il vaut 1..6
    /// sur `u011001` mais 95..97 sur `c01001900` et 157..159 sur `s011001`). Recoupé sur
    /// `u011001` : record 0 = 1178 sommets, LOD id 1 (le plus fin) = `u011001_20`.
    #[must_use]
    pub fn mesh_name_at(&self, index: usize) -> Option<&str> {
        self.mesh_names.get(index).map(String::as_str)
    }

    /// Niveau de détail de la `i`-ème sous-maille d'après son nom : `None` pour la maille de
    /// base, `Some(n)` pour `_LODn` (`_LOD` sans chiffre vaut 1). `None` aussi si les noms
    /// manquent.
    #[must_use]
    pub fn lod_level_at(&self, index: usize) -> Option<u8> {
        let name = self.mesh_name_at(index)?;
        let pos = name.rfind("_LOD")?;
        let digits = &name[pos + 4..];
        if digits.is_empty() {
            Some(1)
        } else {
            digits.parse().ok()
        }
    }

    /// Index de matériau à utiliser pour une sous-maille : le champ réel (+0x43) si la table
    /// entière est plausible (chaque valeur < nombre de matériaux, et au moins une non nulle),
    /// sinon le champ historique.
    #[must_use]
    pub fn material_index_of(&self, sm: &Submesh) -> u8 {
        if self.material_slots_plausible() {
            sm.material_slot
        } else {
            sm.material_index
        }
    }

    /// Vrai si les `material_slot` (+0x43) forment une table exploitable.
    #[must_use]
    pub fn material_slots_plausible(&self) -> bool {
        let n = self
            .material_base_names
            .len()
            .max(self.header.material_count as usize);
        n > 0
            && self
                .submeshes
                .iter()
                .all(|s| (s.material_slot as usize) < n)
            && self.submeshes.iter().any(|s| s.material_slot != 0)
    }
}

/// Vrai si `data` commence par un magic G4MD (LE ou BE).
#[must_use]
pub fn is_g4md(data: &[u8]) -> bool {
    if data.len() < 4 {
        return false;
    }
    let le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    le == MAGIC_LE || le == MAGIC_BE
}

/// Parse un fichier G4MD.
///
/// # Erreurs
///
/// - [`FormatError::TooShort`] si `data` est trop court pour l'en-tête (< 0x60).
/// - [`FormatError::BadMagic`] si le magic n'est pas G4MD.
pub fn parse(data: &[u8]) -> Result<G4md, FormatError> {
    if data.len() < 0x60 {
        return Err(FormatError::TooShort {
            got: data.len(),
            need: 0x60,
        });
    }
    let le = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let big_endian = match le {
        MAGIC_LE => false,
        MAGIC_BE => true,
        _ => return Err(FormatError::BadMagic { format: "G4MD" }),
    };

    let header = G4mdHeader {
        big_endian,
        submesh_info: read_u16(data, 0x04, big_endian)?,
        section_base: read_u16(data, 0x0A, big_endian)?,
        submesh_count: read_u16(data, 0x20, big_endian)?,
        material_count: read_u16(data, 0x22, big_endian)?,
        bone_count: data[0x24],
        vlayout_count: data[0x26],
        face_data_base: read_u32(data, 0x5C, big_endian)?,
    };

    let submeshes = parse_submeshes(data, &header);
    let layouts = read_vertex_layouts(data, &header);
    let attributes = match layouts.first() {
        Some(first) if !first.is_empty() => first.clone(),
        _ => read_vertex_attributes(data, &header),
    };
    // Les tables d'offsets de noms (`u16 @0x86` matériaux, `u16 @0x84` mailles) sont la source
    // exacte ; le run terminal n'est qu'un repli quand un fichier ne les déclare pas.
    let material_names =
        read_offset_table_names(data, &header, 0x86, header.material_count as usize);
    let material_base_names =
        if material_names.len() == header.material_count as usize && !material_names.is_empty() {
            material_names
                .iter()
                .map(|n| n.strip_suffix('M').unwrap_or(n).to_string())
                .collect()
        } else {
            extract_material_base_names(data, header.material_count as usize)
        };
    let mesh_names = read_offset_table_names(data, &header, 0x84, header.submesh_count as usize);
    let joint_hashes = read_joint_hashes(data, &header, &submeshes);
    let joint_palette = read_joint_palette(data, &header, &submeshes);

    Ok(G4md {
        header,
        submeshes,
        attributes,
        layouts,
        material_base_names,
        material_names,
        mesh_names,
        joint_hashes,
        joint_palette,
    })
}

/// Lit une table de `count` offsets `u16` à la section `field`, chaque offset étant relatif à
/// la base de la table, et renvoie les chaînes nulles-terminées visées. Vide si la section
/// est absente, hors fichier, ou si une chaîne n'est pas de l'ASCII imprimable — on ne garde
/// jamais une table partiellement lue.
fn read_offset_table_names(
    data: &[u8],
    header: &G4mdHeader,
    field: usize,
    count: usize,
) -> Vec<String> {
    let Some(base) = header_section(data, header, field) else {
        return Vec::new();
    };
    if count == 0 || base + count * 2 > data.len() {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let Ok(off) = read_u16(data, base + i * 2, header.big_endian) else {
            return Vec::new();
        };
        let start = base + off as usize;
        if start >= data.len() {
            return Vec::new();
        }
        let end = data[start..]
            .iter()
            .position(|&b| b == 0)
            .map_or(data.len(), |p| start + p);
        let bytes = &data[start..end];
        if bytes.is_empty() || !bytes.iter().all(|b| (0x20..=0x7E).contains(b)) {
            return Vec::new();
        }
        out.push(String::from_utf8_lossy(bytes).into_owned());
    }
    out
}

/// Offset de section pour un champ `u16` de l'en-tête (formule `(section_base + rel) * 4`).
/// `None` si l'en-tête est trop court pour porter ce champ.
fn header_section(data: &[u8], header: &G4mdHeader, field: usize) -> Option<usize> {
    let rel = read_u16(data, field, header.big_endian).ok()? as usize;
    if rel == 0 {
        return None;
    }
    Some((header.section_base as usize + rel) * 4)
}

/// Table de hachage des os (`u16 @0x74`, entrées de 4 octets). Vide si l'en-tête ne la déclare
/// pas ou si elle sort du fichier — on ne fabrique rien.
///
/// Le nombre d'entrées n'est pas fiable dans l'en-tête : `bone_count` (@0x24) est un **octet**,
/// et un modèle Victory Road à 266 os (`c11010019`) y écrit 10. La vraie longueur est celle que
/// la palette adresse (plus grand slot + 1), bornée par la section suivante (la palette,
/// `u16 @0x82`) puis par le fichier ; `bone_count` sert de plancher.
fn read_joint_hashes(data: &[u8], header: &G4mdHeader, submeshes: &[Submesh]) -> Vec<u32> {
    let Some(base) = header_section(data, header, 0x74) else {
        return Vec::new();
    };
    let palette_max = read_joint_palette(data, header, submeshes)
        .iter()
        .map(|&s| s as usize + 1)
        .max()
        .unwrap_or(0);
    let wanted = palette_max.max(header.bone_count as usize);
    let limit = header_section(data, header, 0x82)
        .filter(|&p| p > base)
        .unwrap_or(data.len())
        .min(data.len());
    let available = (limit - base) / 4;
    let count = wanted.min(available);
    if count == 0 {
        return Vec::new();
    }
    (0..count)
        .filter_map(|i| read_u32(data, base + i * 4, header.big_endian).ok())
        .collect()
}

/// Table de palette d'os (`u16 @0x82`). Sa longueur n'est pas stockée : c'est le plus grand
/// `palette_offset + palette_len` déclaré par les sous-mailles, borné par le début de la table
/// de noms de mailles (`u16 @0x84`) et par la fin du fichier.
fn read_joint_palette(data: &[u8], header: &G4mdHeader, submeshes: &[Submesh]) -> Vec<u16> {
    let needed = submeshes
        .iter()
        .filter(|s| s.palette_len > 0)
        .map(|s| s.palette_offset as usize + s.palette_len as usize)
        .max()
        .unwrap_or(0);
    let Some(base) = header_section(data, header, 0x82) else {
        return Vec::new();
    };
    if needed == 0 {
        return Vec::new();
    }
    let limit = header_section(data, header, 0x84)
        .filter(|&names| names > base)
        .unwrap_or(data.len())
        .min(data.len());
    if base + needed * 2 > limit {
        return Vec::new();
    }
    (0..needed)
        .filter_map(|i| read_u16(data, base + i * 2, header.big_endian).ok())
        .collect()
}

/// Lit **tous** les layouts vertex : `vlayout_count` blocs consécutifs à
/// `submesh_info + submesh_count*0x50`, chacun = 8 octets d'en-tête (nombre d'entrées à +1)
/// puis `n` entrées de 8 octets (`vtype u8, offset u16, pad u8, datatype u32`, little-endian).
/// Layout recoupé sur `c01001900.g4md` (3 layouts de 10 entrées) et `u011001.g4md` (12 + 10).
fn read_vertex_layouts(data: &[u8], header: &G4mdHeader) -> Vec<Vec<VertexAttribute>> {
    let submesh_info = header.submesh_info as usize;
    let submesh_count = header.submesh_count as usize;
    if submesh_info == 0 || submesh_count == 0 {
        return Vec::new();
    }
    let mut cursor = submesh_info + submesh_count * SUBMESH_RECORD_SIZE;
    let mut layouts = Vec::with_capacity(header.vlayout_count as usize);
    for _ in 0..header.vlayout_count {
        if cursor + 8 > data.len() {
            break;
        }
        let entry_count = data[cursor + 1] as usize;
        let size = 8 + entry_count * ATTR_SIZE;
        if cursor + size > data.len() {
            break;
        }
        let mut attrs = Vec::with_capacity(entry_count);
        for i in 0..entry_count {
            let o = cursor + 8 + i * ATTR_SIZE;
            let vtype = data[o];
            if vtype == 0 {
                break;
            }
            let offset = u16::from_le_bytes([data[o + 1], data[o + 2]]);
            let datatype = u32::from_le_bytes([data[o + 4], data[o + 5], data[o + 6], data[o + 7]]);
            attrs.push(VertexAttribute {
                vtype,
                offset,
                datatype,
            });
        }
        // Un layout dont la première entrée n'est pas la position à 0 n'est pas une table
        // d'attributs : on s'arrête là plutôt que d'inventer la suite.
        if attrs.first().is_none_or(|a| a.vtype != 1 || a.offset != 0) {
            break;
        }
        layouts.push(attrs);
        cursor += size;
    }
    layouts
}

/// Table des sous-mailles : records 0x50 à `submesh_info`, `submesh_count` entrées
/// (port de `ParseSubmeshes`, L481).
fn parse_submeshes(data: &[u8], header: &G4mdHeader) -> Vec<Submesh> {
    let table = header.submesh_info as usize;
    let count = header.submesh_count as usize;
    if table == 0 || table >= data.len() || count == 0 {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let off = table + i * SUBMESH_RECORD_SIZE;
        if off + SUBMESH_RECORD_SIZE > data.len() {
            break;
        }
        let be = header.big_endian;
        let flags0 = read_u16(data, off + 0x3C, be).unwrap_or(0);
        let flags1 = read_u16(data, off + 0x3E, be).unwrap_or(0);
        out.push(Submesh {
            vertex_offset: read_u32(data, off, be).unwrap_or(0),
            index_offset: read_u32(data, off + 0x04, be).unwrap_or(0),
            vertex_count: read_u32(data, off + 0x08, be).unwrap_or(0),
            index_count: read_u32(data, off + 0x0C, be).unwrap_or(0),
            stride: data.get(off + 0x2E).copied().unwrap_or(0),
            layout_num: data.get(off + 0x32).copied().unwrap_or(0),
            material_index: data.get(off + 0x33).copied().unwrap_or(0),
            triangle_count: read_u32(data, off + 0x30, be).unwrap_or(0),
            lod_id: read_u16(data, off + 0x34, be).unwrap_or(0xFF),
            name_index: read_u16(data, off + 0x38, be).unwrap_or(0),
            palette_offset: read_u16(data, off + 0x3A, be).unwrap_or(0),
            palette_len: if flags0 & 0x100 != 0 {
                (flags0 & 0xFF) as u8
            } else {
                0
            },
            vertex_stride: (flags1 & 0xFF) as u8,
            layout_index: data.get(off + 0x42).copied().unwrap_or(0),
            material_slot: data.get(off + 0x43).copied().unwrap_or(0),
        });
    }
    out
}

/// Lit le premier layout d'attributs vertex à `submesh_info + submesh_count*0x50 + 8`.
/// Le 1er attribut doit être `vtype=1` (position) `offset=0` sinon on n'a pas la bonne table.
/// `vtype=0` marque la fin (port de `ReadVertexAttributes`, plafond 16). Toujours little-endian
/// pour offset/datatype (la table est lue telle quelle dans le port C#).
fn read_vertex_attributes(data: &[u8], header: &G4mdHeader) -> Vec<VertexAttribute> {
    let submesh_info = header.submesh_info as usize;
    let submesh_count = header.submesh_count as usize;
    if submesh_info == 0 || submesh_count == 0 {
        return Vec::new();
    }

    let table = submesh_info + submesh_count * SUBMESH_RECORD_SIZE + 8;
    if table + ATTR_SIZE > data.len() || data[table] != 1 {
        return Vec::new();
    }

    let mut attrs = Vec::new();
    for i in 0..16 {
        let o = table + i * ATTR_SIZE;
        if o + ATTR_SIZE > data.len() {
            break;
        }
        let vtype = data[o];
        if vtype == 0 {
            break;
        }
        let offset = u16::from_le_bytes([data[o + 1], data[o + 2]]);
        let datatype = u32::from_le_bytes([data[o + 4], data[o + 5], data[o + 6], data[o + 7]]);
        attrs.push(VertexAttribute {
            vtype,
            offset,
            datatype,
        });
    }
    attrs
}

/// Extrait les noms de texture **par matériau** d'un g4md de **MAP** via la table d'offsets u16
/// (structure RE distincte des perso). Layout (validé sur s02g001g02) : un pool terminal de noms
/// NUL-séparés, précédé d'une table d'offsets `u16` ; `base = pool_start − 2·N − 2`, la table à
/// `base+2`, et `nom[i] = pool[base + offsets[i]]`. On essaie N ∈ {mc−2..=mc+1} et on retient le N
/// qui résout le plus d'offsets vers de vrais débuts de noms. Renvoie les noms dans l'ordre des
/// matériaux (vide si la structure n'est pas reconnue de façon fiable).
#[must_use]
pub fn extract_map_material_names(data: &[u8], material_count: usize) -> Vec<String> {
    if material_count == 0 || data.len() < 32 {
        return Vec::new();
    }
    // 1) Pool terminal : région de noms ASCII NUL-séparés en fin de fichier.
    let mut end = data.len();
    while end > 0 && data[end - 1] == 0 {
        end -= 1;
    }
    // Détecte le pool par son PREMIER vrai nom : un run ≥6 d'ASCII débutant par une lettre,
    // NUL-terminé (la table d'offsets en amont a des octets imprimables mais en runs de 1 → exclue).
    // On scrute la dernière moitié du fichier.
    let mut pool_start = end;
    let mut i = data.len() / 2;
    while i + 6 < end {
        if data[i].is_ascii_alphabetic() {
            let s = i;
            while i < end && (0x20..=0x7E).contains(&data[i]) {
                i += 1;
            }
            if i - s >= 6 && i < data.len() && data[i] == 0 {
                pool_start = s;
                break;
            }
        } else {
            i += 1;
        }
    }
    if pool_start >= end {
        return Vec::new();
    }
    // Offsets (depuis pool_start) des débuts de noms.
    let mut starts = alloc::collections::BTreeSet::new();
    let mut at_start = true;
    for (rel, &b) in data[pool_start..end].iter().enumerate() {
        if b == 0 {
            at_start = true;
        } else {
            if at_start {
                starts.insert(rel);
            }
            at_start = false;
        }
    }
    // 2) Cherche (N, base) maximisant les offsets résolvant un début de nom.
    let mc = material_count as isize;
    let mut best: Option<(usize, usize, usize)> = None; // (table_off, base, hits)
    for n in (mc - 2).max(1)..=(mc + 1) {
        let n = n as usize;
        if pool_start < 2 * n + 2 {
            continue;
        }
        let base = pool_start - 2 * n - 2;
        let table = base + 2;
        let hits = (0..n)
            .filter(|&i| {
                let off =
                    u16::from_le_bytes([data[table + 2 * i], data[table + 2 * i + 1]]) as usize;
                let abs = base + off;
                abs >= pool_start && starts.contains(&(abs - pool_start))
            })
            .count();
        if best.is_none_or(|(_, _, h)| hits > h) {
            best = Some((table, base, hits));
        }
    }
    let Some((table, base, hits)) = best else {
        return Vec::new();
    };
    let n = (pool_start - table) / 2; // N = nombre d'offsets entre la table et le pool
    if hits * 2 < n {
        return Vec::new(); // moins de la moitié résolus → structure non reconnue
    }
    // 3) Lit les N noms.
    (0..n)
        .map(|i| {
            let off = u16::from_le_bytes([data[table + 2 * i], data[table + 2 * i + 1]]) as usize;
            let abs = base + off;
            if abs < pool_start || abs >= end {
                return String::new();
            }
            let mut e = abs;
            while e < end && data[e] != 0 {
                e += 1;
            }
            String::from_utf8_lossy(&data[abs..e]).into_owned()
        })
        .collect()
}

/// Extrait les noms base-color par matériau depuis le run terminal de chaînes
/// (port de `ExtractMaterialBaseNames`, L261) : collecte les chaînes ASCII null-terminées
/// contiguës en partant de la fin, garde les `2 * material_count` dernières et renvoie la
/// seconde moitié (les noms de base).
fn extract_material_base_names(data: &[u8], material_count: usize) -> Vec<String> {
    let mut result = Vec::new();
    if material_count == 0 || data.is_empty() {
        return result;
    }

    // Saute le padding final 0x00.
    let mut end = data.len();
    while end > 0 && data[end - 1] == 0 {
        end -= 1;
    }

    let mut tail: Vec<String> = Vec::new();
    let mut i = end;
    while i > 0 {
        let str_end = i;
        // Remonte tant que c'est de l'ASCII imprimable.
        let mut j = i as isize - 1;
        while j >= 0 && data[j as usize] >= 0x20 && data[j as usize] <= 0x7E {
            j -= 1;
        }
        let str_start = (j + 1) as usize;
        if str_end <= str_start {
            break;
        }
        // Le séparateur attendu est un 0x00 ; sinon la contiguïté est rompue.
        let preceded_by_nul = j < 0 || data[j as usize] == 0;
        if !preceded_by_nul {
            break;
        }
        let s = String::from_utf8_lossy(&data[str_start..str_end]).into_owned();
        if !is_material_name(&s) {
            break;
        }
        tail.insert(0, s);
        if j < 0 {
            break;
        }
        i = j as usize; // poursuit avant le séparateur 0x00
    }

    let need = 2 * material_count;
    if tail.len() < need {
        return result; // disposition inattendue : on ne fabrique rien
    }
    let run = &tail[tail.len() - need..];
    for m in 0..material_count {
        result.push(run[material_count + m].clone());
    }
    result
}

/// Vrai si la chaîne ressemble à un nom de texture/material (≥3, débute par une lettre,
/// alphanumérique + '_'). Port de `IsMaterialName` (G4mdParser.cs L322).
fn is_material_name(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes
        .iter()
        .all(|&c| c.is_ascii_alphanumeric() || c == b'_')
}

fn read_u16(data: &[u8], off: usize, big_endian: bool) -> Result<u16, FormatError> {
    let b: [u8; 2] = data
        .get(off..off + 2)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4MD : lecture u16 hors limites"))?;
    Ok(if big_endian {
        u16::from_be_bytes(b)
    } else {
        u16::from_le_bytes(b)
    })
}

fn read_u32(data: &[u8], off: usize, big_endian: bool) -> Result<u32, FormatError> {
    let b: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(FormatError::Corrupt("G4MD : lecture u32 hors limites"))?;
    Ok(if big_endian {
        u32::from_be_bytes(b)
    } else {
        u32::from_le_bytes(b)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit un G4MD synthétique reproduisant le layout réel de chr/_uniform u11130090
    /// (RE C# vérifié octet par octet) : 1 sous-maille (stride 68, vert_count 100, index_count 6,
    /// material_index 0), table d'attributs [pos float@0, normale short@12, uv ushort@64],
    /// 1 matériau → run terminal `["u11130090_10M", "u11130090_10"]` (base = seconde moitié).
    fn build_uniform_like() -> Vec<u8> {
        let submesh_info = 0x60usize;
        let submesh_count = 1usize;
        let attr_table = submesh_info + submesh_count * SUBMESH_RECORD_SIZE + 8; // 0x60+0x50+8 = 0xB8
        let str_region = attr_table + 4 * ATTR_SIZE; // place pour 3 attrs + terminateur

        let mut buf = alloc::vec![0u8; str_region];
        // En-tête.
        buf[0..4].copy_from_slice(&MAGIC_LE.to_le_bytes());
        buf[0x04..0x06].copy_from_slice(&(submesh_info as u16).to_le_bytes());
        buf[0x0A..0x0C].copy_from_slice(&0u16.to_le_bytes()); // section_base = 0
        buf[0x20..0x22].copy_from_slice(&(submesh_count as u16).to_le_bytes());
        buf[0x22..0x24].copy_from_slice(&1u16.to_le_bytes()); // material_count = 1
        buf[0x24] = 0; // bone_count
        buf[0x26] = 3; // vlayout_count
        buf[0x5C..0x60].copy_from_slice(&0x1000u32.to_le_bytes()); // face_data_base

        // Record de sous-maille @0x60.
        let r = submesh_info;
        buf[r..r + 4].copy_from_slice(&0u32.to_le_bytes()); // vertex_offset
        buf[r + 0x04..r + 0x08].copy_from_slice(&0x200u32.to_le_bytes()); // index_offset
        buf[r + 0x08..r + 0x0C].copy_from_slice(&100u32.to_le_bytes()); // vertex_count
        buf[r + 0x0C..r + 0x10].copy_from_slice(&6u32.to_le_bytes()); // index_count
        buf[r + 0x2E] = 68; // stride
        buf[r + 0x32] = 0; // layout_num
        buf[r + 0x33] = 0; // material_index

        // Table d'attributs @attr_table : pos(1)/float(3)@0, normale(2)/short(18)@12, uv(10)/ushort(14)@64.
        let put_attr = |buf: &mut [u8], base: usize, vtype: u8, off: u16, dt: u32| {
            buf[base] = vtype;
            buf[base + 1..base + 3].copy_from_slice(&off.to_le_bytes());
            buf[base + 4..base + 8].copy_from_slice(&dt.to_le_bytes());
        };
        put_attr(&mut buf, attr_table, 1, 0, 3);
        put_attr(&mut buf, attr_table + ATTR_SIZE, 2, 12, 18);
        put_attr(&mut buf, attr_table + 2 * ATTR_SIZE, 10, 64, 14);
        // 4e enregistrement = terminateur vtype=0 (déjà à 0).

        // Run terminal de chaînes : "u11130090_10M\0u11130090_10\0".
        buf.extend_from_slice(b"u11130090_10M\0");
        buf.extend_from_slice(b"u11130090_10\0");
        buf
    }

    #[test]
    fn is_g4md_detection() {
        assert!(is_g4md(b"G4MD...."));
        assert!(is_g4md(&MAGIC_BE.to_le_bytes()));
        assert!(!is_g4md(b"G4MG"));
    }

    #[test]
    fn header_et_submesh_golden() {
        let buf = build_uniform_like();
        let g = parse(&buf).expect("parse g4md synthétique");
        assert!(!g.header.big_endian);
        assert_eq!(g.header.submesh_info, 0x60);
        assert_eq!(g.header.submesh_count, 1);
        assert_eq!(g.header.material_count, 1);
        assert_eq!(g.header.face_data_base, 0x1000);

        assert_eq!(g.submeshes.len(), 1);
        let sm = &g.submeshes[0];
        assert_eq!(sm.vertex_offset, 0);
        assert_eq!(sm.index_offset, 0x200);
        assert_eq!(sm.vertex_count, 100);
        assert_eq!(sm.index_count, 6);
        assert_eq!(sm.stride, 68);
        assert_eq!(sm.material_index, 0);
    }

    #[test]
    fn attributs_vertex_golden() {
        let buf = build_uniform_like();
        let g = parse(&buf).unwrap();
        // Layout réel chr/_uniform : pos float@0, normale short@12, uv ushort@64.
        assert_eq!(g.attributes.len(), 3);
        assert_eq!(
            g.attributes[0],
            VertexAttribute {
                vtype: 1,
                offset: 0,
                datatype: 3
            }
        );
        assert_eq!(
            g.attributes[1],
            VertexAttribute {
                vtype: 2,
                offset: 12,
                datatype: 18
            }
        );
        assert_eq!(
            g.attributes[2],
            VertexAttribute {
                vtype: 10,
                offset: 64,
                datatype: 14
            }
        );
        // 1er attribut toujours position offset 0.
        assert_eq!(g.find_attribute(1).unwrap().offset, 0);
        assert_eq!(g.find_attribute(2).unwrap().offset, 12);
        assert_eq!(g.find_attribute(10).unwrap().offset, 64);
    }

    #[test]
    fn material_base_names_golden() {
        let buf = build_uniform_like();
        let g = parse(&buf).unwrap();
        // 1 matériau → base = seconde moitié du run = ["u11130090_10"].
        assert_eq!(
            g.material_base_names,
            alloc::vec![String::from("u11130090_10")]
        );
    }

    #[test]
    fn section_offset_formule() {
        let buf = build_uniform_like();
        let g = parse(&buf).unwrap();
        // section_base = 0 → section_offset(relative) = relative * 4.
        assert_eq!(g.section_offset(0x10), 0x40);
    }

    #[test]
    fn rejette_mauvais_magic() {
        let mut buf = alloc::vec![0u8; 0x60];
        buf[..4].copy_from_slice(b"XXXX");
        assert!(matches!(parse(&buf), Err(FormatError::BadMagic { .. })));
    }
}
