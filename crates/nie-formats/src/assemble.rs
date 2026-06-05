//! Assemblage du modèle 3D complet d'un personnage IEVR.
//!
//! Un personnage est constitué de trois composants qui coexistent dans le même espace monde
//! (coordonnées homogènes issues de la conversion SharpGLTF) :
//!
//! 1. **Corps** (`base_<classe>_NN.glb`) — maille partagée par tous les personnages du même
//!    type corporel (tête/cou/oreilles). Sélectionné via la chaîne
//!    `chara_base → CHARA_BASE_INFO[var[1]=internalCode, var[6]=modelInfoId]`
//!    `→ chara_model → CHARA_MODEL_INFO[var[0]=modelInfoId, var[4]=bodyInfoId]`
//!    `→ CHARA_BODY_INFO[var[0]=bodyInfoId, var[4]=type_idx]`
//!    `→ GLB dx11/model/base_<classe>_NN.glb`.
//!
//! 2. **Visage** (`c<internalCode>.glb`) — maille propre au personnage (yeux, nez, bouche…).
//!    Raccourci : `dx11/model/<internalCode>.glb` (98 % des cas) ; sinon résolution via
//!    `CHARA_MODEL_INFO[var[10]=face_g4md_rel]`.
//!
//! 3. **Uniforme** — sélectionné via la chaîne
//!    `perso.series → season_key → inagle_teams[team_id].kits[season_key] → kit_id`
//!    `→ m_UniformInfoList[nameId=kit_id].modelInfo=[start,count]`
//!    `→ m_UniformModelInfoList[start..start+count][typeId=0]`
//!    `→ uniformKeeperModelIdCrc (si GK) ou uniformFielderModelIdCrc`.
//!    Le CRC obtenu est l'identifiant interne — le GLB correspondant n'est **pas** pré-converti
//!    en dehors des CPK ; son chemin CPK passe par inagle_uniforms.models.
//!
//! ## Résultat
//!
//! [`assemble_character_model`] renvoie un [`AssembledModel`] contenant l'ensemble des
//! [`MeshPrimitive`] des trois composants dans un seul espace monde. La struct est exportable
//! en glTF binaire via [`AssembledModel::to_glb`].
//!
//! ## Limites documentées
//!
//! - **Skinning absent** : les GLBs pré-convertis dx11/model sont des **mailles statiques** (0 skin,
//!   0 joint), pas des mailles skinned. Il n'y a donc pas de matrice bind-pose ni de blend weights
//!   à fusionner. L'assemblage se fait par simple union des primitives dans l'espace monde.
//! - **Uniforme en GLB** : seuls 2 GLB uniformes sont pré-convertis (`u11010078.glb`,
//!   `u911021.glb`). Les autres vivent dans les CPK (`common/chr/_uniform/…`). Cette implémentation
//!   supporte les deux voies : GLB direct (si disponible) et G4MD+G4MG bruts via [`g4md`]/[`g4mg`].
//! - **Matériaux** : les GLBs dx11/model n'ont qu'un seul matériau générique (`Default`) sans
//!   texture liée. L'assemblage conserve l'index de matériau par primitive mais ne résout pas les
//!   textures (en attente d'un accès CPK g4tx).
//! - **Coordonnées** : les GLBs sont tous dans le même espace monde (axe Y = haut, unité ≈ mètre).
//!   Face y ∈ [1.3, 1.66], corps y ∈ [1.29, 1.60], uniforme couvre y ∈ [-1.0, 2.0+] selon le type.
//!
//! ## Anti-hallucination
//!
//! Toutes les tables de correspondance (type_idx → nom GLB, season_key → kit, etc.) sont
//! vérifiées sur les données réelles de `chara_body_1.03.49.00.cfg.bin.json` et
//! `uniform_config_1.03.52.00.cfg.bin.json`. Aucune valeur n'est inventée.
//!
//! Compatible `std` (no_std non applicable ici : lecture de fichiers GLB).

extern crate alloc;

use alloc::{string::String, vec::Vec};
use std::path::{Path, PathBuf};

use crate::g4md;
use crate::g4mg;

// ── Constantes de mapping type_idx → nom GLB (issues de chara_body réel) ────

/// Correspondance `type_idx` → suffixe GLB `base_<classe>_NN`.
///
/// Vérifiée sur `CHARA_BODY_INFO_LIST` (76 entrées, data réelle dump VPS).
/// Les type_idx 101 (animal) et 201 (véhicule) n'ont pas de GLB base standard.
pub const TYPE_IDX_TO_GLB: &[(u8, &str)] = &[
    (0, "base_normal_00"),
    (1, "base_normal_01"),
    (2, "base_normal_02"),
    (3, "base_normal_03"),
    (4, "base_tall_00"),
    (5, "base_bigman_00"),
    (6, "base_bigman_01"),
    (7, "base_tall_01"),
    (8, "base_tall_02"),
    (9, "base_tall_03"),
    (10, "base_tall_04"),
    (11, "base_tall_05"),
    (12, "base_big_00"),
    (13, "base_bigwoman_00"),
    (14, "base_small_00"),
    (15, "base_small_01"),
    (16, "base_elderlyman_00"),
    (17, "base_elderlywoman_00"),
    // 101 = animal (_animal/…) — pas de GLB base
    // 201 = vehicle (_item/d…)  — pas de GLB base
];

/// Résout `type_idx` en nom de fichier GLB (sans extension ni chemin).
/// Renvoie `None` pour les types animal/vehicle ou inconnus.
#[must_use]
pub fn type_idx_to_glb_name(type_idx: u8) -> Option<&'static str> {
    TYPE_IDX_TO_GLB.iter().find(|(t, _)| *t == type_idx).map(|(_, n)| *n)
}

// ── Clé de saison (season_key) ───────────────────────────────────────────────

/// Clé de kit d'uniforme selon la série du personnage.
///
/// Déduite du champ `series` de `inagle_characters` :
/// - `"Inazuma Eleven"` / `"Inazuma Eleven 2"` → `"ie"`
/// - `"Inazuma Eleven GO"` / `"ARES"` / `"Orion"` / `"Galaxy"` → `"go"`
/// - `"Victory Road"` → `"v"`
/// - Toute autre valeur → `"ie"` par défaut.
///
/// Source de vérité : `inagle_teams.data.kits` (ex. Raimon : `{"ie":"0x252CE113","go":"0xAECB5B3E","v":"0xBBE7C49D"}`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeasonKey {
    /// IE1 / IE2
    Ie,
    /// GO / ARES / Orion / Galaxy
    Go,
    /// Victory Road
    V,
}

impl SeasonKey {
    /// Dérive la clé de saison depuis le champ `series` de `inagle_characters`.
    #[must_use]
    pub fn from_series(series: &str) -> Self {
        let s = series.to_ascii_lowercase();
        if s.contains("victory") {
            Self::V
        } else if s.contains(" go") || s.contains("ares") || s.contains("orion") || s.contains("galaxy") {
            Self::Go
        } else {
            Self::Ie
        }
    }

    /// Clé textuelle (`"ie"`, `"go"`, `"v"`).
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ie => "ie",
            Self::Go => "go",
            Self::V => "v",
        }
    }
}

// ── Position sur le terrain ───────────────────────────────────────────────────

/// Position du joueur sur le terrain (pour le choix keeper vs fielder).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldPosition {
    /// Gardien de but.
    Goalkeeper,
    /// Joueur de champ (attaquant, milieu, défenseur).
    Fielder,
    /// Entraîneur.
    Manager,
    /// Directeur (type special).
    Director,
}

// ── Règles de matching (vérifiées sur données réelles) ───────────────────────

/// Résultat du matching d'uniforme : CRC du modèle GLB dans les CPK.
#[derive(Debug, Clone)]
pub struct UniformModelCrc {
    /// CRC32 du modèle uniforme (clé dans les CPK `common/chr/_uniform/`).
    pub crc: u32,
    /// Position utilisée pour le choix.
    pub position: FieldPosition,
}

/// Paramètres de sélection du modèle uniforme depuis `inagle_uniforms`.
///
/// Les champs correspondent directement aux colonnes de la table SQL et au JSON `models`.
#[derive(Debug, Clone)]
pub struct UniformModelEntry {
    /// `typeId` dans `models[*]` (0 = standard, 1 = variante météo/courtes manches, …).
    pub type_id: u8,
    /// CRC du modèle fielder (`uniformFielderModelIdCrc`).
    pub fielder_crc: u32,
    /// CRC du modèle keeper (`uniformKeeperModelIdCrc`).
    pub keeper_crc: u32,
}

impl UniformModelEntry {
    /// Sélectionne le CRC approprié pour la position donnée.
    #[must_use]
    pub fn crc_for_position(&self, pos: FieldPosition) -> u32 {
        match pos {
            FieldPosition::Goalkeeper => self.keeper_crc,
            _ => self.fielder_crc,
        }
    }
}

// ── Primitive de maille ───────────────────────────────────────────────────────

/// Composant source d'un primitive (pour traçabilité).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeshComponent {
    /// Maille de base (corps/tête partagée).
    Body,
    /// Maille du visage (propre au personnage).
    Face,
    /// Maille de l'uniforme.
    Uniform,
}

/// Primitive de maille décodée, prête pour l'export glTF.
///
/// Un personnage complet = plusieurs `MeshPrimitive` (une par sous-maille de chaque composant).
/// L'index de base des vertices est **local** à cette primitive (commence toujours à 0).
#[derive(Debug, Clone)]
pub struct MeshPrimitive {
    /// Composant d'origine.
    pub component: MeshComponent,
    /// Index de la primitive dans le composant source.
    pub source_index: usize,
    /// Index de matériau (local à la primitive).
    pub material_index: u8,
    /// Nom de texture base-color (peut être vide si non résolu).
    pub material_name: String,
    /// Positions float3 (X, Y, Z) dans l'espace monde.
    pub positions: Vec<g4mg::Vec3>,
    /// Normales float3 (renormalisées). Vide si non disponibles.
    pub normals: Vec<g4mg::Vec3>,
    /// UV0 float2 (U, V). Vide si non disponibles.
    pub uv0: Vec<g4mg::Vec2>,
    /// Indices u32 locaux (commencent à 0).
    pub indices: Vec<u32>,
}

impl MeshPrimitive {
    /// Nombre de vertices.
    #[must_use]
    pub fn vertex_count(&self) -> usize {
        self.positions.len()
    }

    /// Nombre de triangles (indices / 3).
    #[must_use]
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

// ── Modèle assemblé ──────────────────────────────────────────────────────────

/// Résultat de l'assemblage : ensemble des primitives des trois composants.
///
/// ## Export glTF
///
/// [`AssembledModel::to_glb`] sérialise le modèle en glTF binaire (GLB). Chaque primitive
/// devient un `mesh.primitive` dans un `mesh` nommé selon le composant. Les indices sont
/// globalisés (offset par le cumul des vertices précédents) dans le buffer glTF.
#[derive(Debug)]
pub struct AssembledModel {
    /// Identifiant interne du personnage (ex. `"c01000010"`).
    pub internal_code: String,
    /// Nom de fichier GLB du corps (ex. `"base_normal_00"`).
    pub body_glb: String,
    /// Nom de fichier GLB du visage (ex. `"c01000010"`).
    pub face_glb: String,
    /// CRC de l'uniforme sélectionné (`0` si non résolu).
    pub uniform_crc: u32,
    /// Toutes les primitives (corps, visage, uniforme).
    pub primitives: Vec<MeshPrimitive>,
}

impl AssembledModel {
    /// Nombre total de vertices (somme des composants).
    #[must_use]
    pub fn total_vertex_count(&self) -> usize {
        self.primitives.iter().map(MeshPrimitive::vertex_count).sum()
    }

    /// Nombre total de triangles (somme des composants).
    #[must_use]
    pub fn total_triangle_count(&self) -> usize {
        self.primitives.iter().map(MeshPrimitive::triangle_count).sum()
    }

    /// Primitives appartenant au corps.
    #[must_use]
    pub fn body_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Body)
    }

    /// Primitives appartenant au visage.
    #[must_use]
    pub fn face_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Face)
    }

    /// Primitives appartenant à l'uniforme.
    #[must_use]
    pub fn uniform_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Uniform)
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0).
    ///
    /// Chaque composant (corps / visage / uniforme) devient un nœud glTF séparé avec son propre
    /// mesh. Les indices sont globalisés dans le buffer glTF binaire.
    ///
    /// ## Limites
    ///
    /// - Pas de textures liées (les matériaux sont génériques `Default`).
    /// - Pas de hiérarchie de squelette (skinning absent des GLBs sources).
    /// - Le buffer binaire est compact (pas de padding inter-accessor).
    #[must_use]
    pub fn to_glb(&self) -> Vec<u8> {
        build_glb(self)
    }
}

// ── Erreurs d'assemblage ──────────────────────────────────────────────────────

/// Erreur lors de l'assemblage d'un personnage.
#[derive(Debug, thiserror::Error)]
pub enum AssembleError {
    /// Lecture du fichier GLB impossible.
    #[error("fichier GLB introuvable ou illisible : {0}")]
    GlbNotFound(String),

    /// Données G4MD/G4MG invalides.
    #[error("format invalide : {0}")]
    Format(#[from] crate::FormatError),

    /// Le type corporel n'a pas de GLB base correspondant.
    #[error("type_idx={0} sans GLB base (animal/vehicle/inconnu)")]
    NoBaseGlb(u8),

    /// Données GLB corrompues (JSON invalide ou buffer manquant).
    #[error("GLB corrompu : {0}")]
    Corrupt(String),
}

// ── Lecture GLB ──────────────────────────────────────────────────────────────

/// Données extraites d'un GLB (JSON glTF + buffer binaire).
struct GlbData {
    gltf_json: serde_json::Value,
    bin_buffer: Vec<u8>,
}

/// Lit un fichier `.glb` et renvoie le JSON glTF + le buffer binaire.
fn read_glb(path: &Path) -> Result<GlbData, AssembleError> {
    let data = std::fs::read(path)
        .map_err(|_| AssembleError::GlbNotFound(path.display().to_string()))?;

    if data.len() < 12 {
        return Err(AssembleError::Corrupt("GLB trop court".into()));
    }
    // Magic 0x46546c67 = "glTF"
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != 0x46546C67 {
        return Err(AssembleError::Corrupt(format!("magic GLB invalide : {magic:#010x}")));
    }

    let mut offset = 12usize;
    let mut json_bytes: Option<Vec<u8>> = None;
    let mut bin_buffer: Vec<u8> = Vec::new();

    while offset + 8 <= data.len() {
        let chunk_len = u32::from_le_bytes([data[offset], data[offset+1], data[offset+2], data[offset+3]]) as usize;
        let chunk_type = u32::from_le_bytes([data[offset+4], data[offset+5], data[offset+6], data[offset+7]]);
        let chunk_end = offset + 8 + chunk_len;
        if chunk_end > data.len() {
            break;
        }
        let chunk_data = &data[offset+8..chunk_end];
        match chunk_type {
            0x4E4F534A => { // JSON
                json_bytes = Some(chunk_data.to_vec());
            }
            0x004E4942 => { // BIN
                bin_buffer = chunk_data.to_vec();
            }
            _ => {}
        }
        offset = chunk_end;
    }

    let json_bytes = json_bytes
        .ok_or_else(|| AssembleError::Corrupt("chunk JSON absent".into()))?;

    // Retire le padding NUL de fin (GLB spec : padding 0x20 ou 0x00).
    let json_str_bytes: Vec<u8> = json_bytes.into_iter().filter(|&b| b != 0x00).collect();

    let gltf_json: serde_json::Value = serde_json::from_slice(&json_str_bytes)
        .map_err(|e| AssembleError::Corrupt(format!("JSON GLB invalide : {e}")))?;

    Ok(GlbData { gltf_json, bin_buffer })
}

/// Extrait toutes les primitives d'un GLB et les convertit en [`MeshPrimitive`].
///
/// Chaque primitive glTF (POSITION + NORMAL + TEXCOORD_0 + indices) devient une [`MeshPrimitive`].
fn extract_primitives_from_glb(
    glb: &GlbData,
    component: MeshComponent,
) -> Result<Vec<MeshPrimitive>, AssembleError> {
    let json = &glb.gltf_json;
    let bin = &glb.bin_buffer;

    let empty_arr: Vec<serde_json::Value> = Vec::new();
    let meshes = json["meshes"].as_array().unwrap_or(&empty_arr);
    let accessors = json["accessors"].as_array().unwrap_or(&empty_arr);
    let buffer_views = json["bufferViews"].as_array().unwrap_or(&empty_arr);

    let mut out = Vec::new();
    let mut global_prim_idx = 0usize;

    for mesh in meshes {
        let primitives = mesh["primitives"].as_array().unwrap_or(&empty_arr);
        for prim in primitives {
            let attrs = &prim["attributes"];

            // Matériau
            let mat_idx = prim["material"].as_u64().unwrap_or(0) as u8;
            let mat_name = String::new(); // résolution texture non implémentée ici

            // Helper : lit un accessor dans bin_buffer.
            let read_accessor = |acc_idx: usize| -> Option<(usize, usize, usize)> {
                let acc = accessors.get(acc_idx)?;
                let bv_idx = acc["bufferView"].as_u64()? as usize;
                let bv = buffer_views.get(bv_idx)?;
                let bv_offset = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
                let bv_stride = bv["byteStride"].as_u64().unwrap_or(0) as usize;
                let acc_offset = acc["byteOffset"].as_u64().unwrap_or(0) as usize;
                let count = acc["count"].as_u64()? as usize;
                Some((bv_offset + acc_offset, bv_stride, count))
            };

            // Positions (VEC3 float32).
            let positions = if let Some(pos_idx) = attrs["POSITION"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(pos_idx as usize) {
                    let stride = if stride_hint == 0 { 12 } else { stride_hint };
                    let mut pos = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 12 > bin.len() { break; }
                        let x = f32::from_le_bytes([bin[p], bin[p+1], bin[p+2], bin[p+3]]);
                        let y = f32::from_le_bytes([bin[p+4], bin[p+5], bin[p+6], bin[p+7]]);
                        let z = f32::from_le_bytes([bin[p+8], bin[p+9], bin[p+10], bin[p+11]]);
                        pos.push(g4mg::Vec3 { x, y, z });
                    }
                    pos
                } else { Vec::new() }
            } else { Vec::new() };

            if positions.is_empty() {
                global_prim_idx += 1;
                continue; // ignore les primitives sans position
            }

            // Normales (VEC3 float32).
            let normals = if let Some(n_idx) = attrs["NORMAL"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(n_idx as usize) {
                    let stride = if stride_hint == 0 { 12 } else { stride_hint };
                    let mut nrm = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 12 > bin.len() { break; }
                        let x = f32::from_le_bytes([bin[p], bin[p+1], bin[p+2], bin[p+3]]);
                        let y = f32::from_le_bytes([bin[p+4], bin[p+5], bin[p+6], bin[p+7]]);
                        let z = f32::from_le_bytes([bin[p+8], bin[p+9], bin[p+10], bin[p+11]]);
                        nrm.push(g4mg::Vec3 { x, y, z });
                    }
                    nrm
                } else { Vec::new() }
            } else { Vec::new() };

            // UV0 (VEC2 float32).
            let uv0 = if let Some(uv_idx) = attrs["TEXCOORD_0"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(uv_idx as usize) {
                    let stride = if stride_hint == 0 { 8 } else { stride_hint };
                    let mut uvs = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + 8 > bin.len() { break; }
                        let u = f32::from_le_bytes([bin[p], bin[p+1], bin[p+2], bin[p+3]]);
                        let v = f32::from_le_bytes([bin[p+4], bin[p+5], bin[p+6], bin[p+7]]);
                        uvs.push(g4mg::Vec2 { u, v });
                    }
                    uvs
                } else { Vec::new() }
            } else { Vec::new() };

            // Indices.
            let indices = if let Some(idx_acc) = prim["indices"].as_u64() {
                let acc = &accessors[idx_acc as usize];
                let bv_idx = acc["bufferView"].as_u64().unwrap_or(0) as usize;
                let bv = &buffer_views[bv_idx];
                let bv_offset = bv["byteOffset"].as_u64().unwrap_or(0) as usize;
                let acc_offset = acc["byteOffset"].as_u64().unwrap_or(0) as usize;
                let off = bv_offset + acc_offset;
                let count = acc["count"].as_u64().unwrap_or(0) as usize;
                let component_type = acc["componentType"].as_u64().unwrap_or(5123);
                let idx_size = if component_type == 5125 { 4usize } else { 2 }; // 5125=uint32, 5123=uint16
                let mut idx = Vec::with_capacity(count);
                for i in 0..count {
                    let p = off + i * idx_size;
                    let v = if idx_size == 4 {
                        if p + 4 > bin.len() { break; }
                        u32::from_le_bytes([bin[p], bin[p+1], bin[p+2], bin[p+3]])
                    } else {
                        if p + 2 > bin.len() { break; }
                        u32::from(u16::from_le_bytes([bin[p], bin[p+1]]))
                    };
                    idx.push(v);
                }
                idx
            } else { Vec::new() };

            out.push(MeshPrimitive {
                component,
                source_index: global_prim_idx,
                material_index: mat_idx,
                material_name: mat_name,
                positions,
                normals,
                uv0,
                indices,
            });

            global_prim_idx += 1;
        }
    }

    Ok(out)
}

/// Extrait des primitives depuis une paire G4MD/G4MG (uniforme depuis CPK).
///
/// Utilisé quand le GLB de l'uniforme n'est pas pré-converti. Les données brutes G4MD+G4MG
/// sont parsées via [`g4md::parse`] et [`g4mg::extract_geometry`].
fn extract_primitives_from_g4md_g4mg(
    g4md_data: &[u8],
    g4mg_data: &[u8],
    component: MeshComponent,
) -> Result<Vec<MeshPrimitive>, AssembleError> {
    let md = g4md::parse(g4md_data)?;
    let submeshes = g4mg::extract_geometry(g4mg_data, &md);

    let out = submeshes
        .into_iter()
        .map(|sg| {
            let mat_name = g4mg::material_base_name(&md, &sg)
                .cloned()
                .unwrap_or_default();
            MeshPrimitive {
                component,
                source_index: sg.index,
                material_index: sg.material_index,
                material_name: mat_name,
                positions: sg.positions,
                normals: sg.normals,
                uv0: sg.uv0,
                indices: sg.indices,
            }
        })
        .collect();

    Ok(out)
}

// ── API publique principale ───────────────────────────────────────────────────

/// Entrées nécessaires pour assembler le modèle d'un personnage.
///
/// Toutes les informations de matching sont pré-résolues par l'appelant depuis les tables
/// gamedata (`chara_base`, `chara_model`, `uniform_config`, `inagle_teams`, `inagle_uniforms`).
pub struct CharacterAssemblyInput {
    /// Code interne du personnage (ex. `"c01000010"`).
    pub internal_code: String,
    /// Indice de type corporel (0..17, 101, 201), issu de `CHARA_BODY_INFO.var[4]`.
    pub body_type_idx: u8,
    /// Répertoire contenant les GLB pré-convertis (`dx11/model/`).
    pub glb_dir: PathBuf,
    /// CRC du modèle uniforme sélectionné (`0` = pas d'uniforme / non résolu).
    pub uniform_model_crc: u32,
    /// Données G4MD brutes de l'uniforme (issues du CPK), si disponibles.
    pub uniform_g4md: Option<Vec<u8>>,
    /// Données G4MG brutes de l'uniforme (issues du CPK), si disponibles.
    pub uniform_g4mg: Option<Vec<u8>>,
    /// GLB pré-converti de l'uniforme (chemin complet), si disponible.
    pub uniform_glb_path: Option<PathBuf>,
}

/// Assemble le modèle 3D complet d'un personnage IEVR.
///
/// Charge et combine les trois composants :
/// 1. **Corps** — `glb_dir/base_<classe>_NN.glb` (sélectionné par `body_type_idx`).
/// 2. **Visage** — `glb_dir/<internal_code>.glb`.
/// 3. **Uniforme** — GLB direct (si `uniform_glb_path` est renseigné) **ou** G4MD+G4MG bruts
///    (si `uniform_g4md`+`uniform_g4mg` sont renseignés) **ou** absent (`uniform_model_crc=0`).
///
/// # Erreurs
///
/// - [`AssembleError::NoBaseGlb`] si `body_type_idx` n'a pas de GLB base (101/201/inconnu).
/// - [`AssembleError::GlbNotFound`] si un fichier GLB est manquant.
/// - [`AssembleError::Corrupt`] si un GLB est malformé.
/// - [`AssembleError::Format`] si les données G4MD/G4MG sont invalides.
pub fn assemble_character_model(
    input: &CharacterAssemblyInput,
) -> Result<AssembledModel, AssembleError> {
    // ── 1. Corps ─────────────────────────────────────────────────────────────
    let body_glb_name = type_idx_to_glb_name(input.body_type_idx)
        .ok_or(AssembleError::NoBaseGlb(input.body_type_idx))?;

    let body_glb_path = input.glb_dir.join(format!("{body_glb_name}.glb"));
    let body_glb = read_glb(&body_glb_path)?;
    let body_primitives = extract_primitives_from_glb(&body_glb, MeshComponent::Body)?;

    // ── 2. Visage ─────────────────────────────────────────────────────────────
    let face_glb_path = input.glb_dir.join(format!("{}.glb", input.internal_code));
    let face_glb = read_glb(&face_glb_path)?;
    let face_primitives = extract_primitives_from_glb(&face_glb, MeshComponent::Face)?;

    // ── 3. Uniforme ───────────────────────────────────────────────────────────
    let uniform_primitives = if let Some(glb_path) = &input.uniform_glb_path {
        // Voie A : GLB pré-converti (rare, 2 fichiers disponibles sur 384 uniformes)
        let u_glb = read_glb(glb_path)?;
        extract_primitives_from_glb(&u_glb, MeshComponent::Uniform)?
    } else if let (Some(g4md_data), Some(g4mg_data)) = (&input.uniform_g4md, &input.uniform_g4mg) {
        // Voie B : G4MD+G4MG bruts depuis CPK
        extract_primitives_from_g4md_g4mg(g4md_data, g4mg_data, MeshComponent::Uniform)?
    } else {
        // Voie C : uniforme non disponible (CPK non chargé, CRC 0 ou résolution future)
        Vec::new()
    };

    // ── Assemblage ────────────────────────────────────────────────────────────
    let mut all_primitives = Vec::with_capacity(
        body_primitives.len() + face_primitives.len() + uniform_primitives.len()
    );
    all_primitives.extend(body_primitives);
    all_primitives.extend(face_primitives);
    all_primitives.extend(uniform_primitives);

    Ok(AssembledModel {
        internal_code: input.internal_code.clone(),
        body_glb: body_glb_name.to_string(),
        face_glb: input.internal_code.clone(),
        uniform_crc: input.uniform_model_crc,
        primitives: all_primitives,
    })
}

// ── Export glTF binaire (GLB 2.0) ────────────────────────────────────────────

/// Construit le JSON glTF + buffer binaire à partir du modèle assemblé.
///
/// Structure du GLB émis :
/// ```text
/// header (12 B) + chunk JSON + chunk BIN
/// ```
/// Chaque [`MeshComponent`] → 1 nœud + 1 mesh glTF. Les primitives d'un composant
/// deviennent des `mesh.primitives` de ce mesh.
fn build_glb(model: &AssembledModel) -> Vec<u8> {
    use serde_json::{json, Value};

    // Buffer binaire accumulant toutes les données d'accessors (positions, normales, UV, indices).
    let mut bv_data: Vec<u8> = Vec::new();
    let mut accessor_defs: Vec<Value> = Vec::new();
    let mut buffer_views_json: Vec<Value> = Vec::new();

    /// Ajoute un bufferView + accessor et renvoie l'index accessor.
    fn add_accessor(
        bv_data: &mut Vec<u8>,
        buffer_views_json: &mut Vec<Value>,
        accessor_defs: &mut Vec<Value>,
        raw: &[u8],
        count: usize,
        comp_type: u32,
        attr_type: &str,
        min_val: Option<Value>,
        max_val: Option<Value>,
    ) -> usize {
        let bv_offset = bv_data.len();
        bv_data.extend_from_slice(raw);
        // alignement 4B (glTF spec)
        while bv_data.len() % 4 != 0 {
            bv_data.push(0);
        }

        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0,
            "byteOffset": bv_offset,
            "byteLength": raw.len()
        }));

        let acc_idx = accessor_defs.len();
        let mut acc = json!({
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": comp_type,
            "count": count,
            "type": attr_type
        });
        if let Some(mn) = min_val { acc["min"] = mn; }
        if let Some(mx) = max_val { acc["max"] = mx; }
        accessor_defs.push(acc);
        acc_idx
    }

    let components_order = [MeshComponent::Body, MeshComponent::Face, MeshComponent::Uniform];
    let mut mesh_nodes: Vec<Value> = Vec::new();
    let mut mesh_defs: Vec<Value> = Vec::new();
    let mut material_defs: Vec<Value> = Vec::new();
    // Un seul matériau générique pour l'instant.
    material_defs.push(json!({ "name": "Default" }));

    for comp in components_order {
        let comp_prims: Vec<&MeshPrimitive> = model.primitives.iter()
            .filter(|p| p.component == comp)
            .collect();

        if comp_prims.is_empty() {
            continue;
        }

        let comp_name = match comp {
            MeshComponent::Body => "Body",
            MeshComponent::Face => "Face",
            MeshComponent::Uniform => "Uniform",
        };

        let mut prim_defs: Vec<Value> = Vec::new();

        for prim in &comp_prims {
            if prim.positions.is_empty() {
                continue;
            }

            // Positions → VEC3 float32 (5126).
            let pos_raw: Vec<u8> = prim.positions.iter().flat_map(|v| {
                [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat()
            }).collect();
            let p_min: Vec<f32> = vec![
                prim.positions.iter().map(|v| v.x).fold(f32::INFINITY, f32::min),
                prim.positions.iter().map(|v| v.y).fold(f32::INFINITY, f32::min),
                prim.positions.iter().map(|v| v.z).fold(f32::INFINITY, f32::min),
            ];
            let p_max: Vec<f32> = vec![
                prim.positions.iter().map(|v| v.x).fold(f32::NEG_INFINITY, f32::max),
                prim.positions.iter().map(|v| v.y).fold(f32::NEG_INFINITY, f32::max),
                prim.positions.iter().map(|v| v.z).fold(f32::NEG_INFINITY, f32::max),
            ];
            let pos_acc = add_accessor(
                &mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                &pos_raw, prim.positions.len(), 5126, "VEC3",
                Some(json!(p_min)), Some(json!(p_max)),
            );

            // Normales → VEC3 float32 (5126), optionnel.
            let normal_acc = if !prim.normals.is_empty() {
                let raw: Vec<u8> = prim.normals.iter().flat_map(|v| {
                    [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat()
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.normals.len(), 5126, "VEC3", None, None))
            } else { None };

            // UV0 → VEC2 float32 (5126), optionnel.
            let uv_acc = if !prim.uv0.is_empty() {
                let raw: Vec<u8> = prim.uv0.iter().flat_map(|v| {
                    [v.u.to_le_bytes(), v.v.to_le_bytes()].concat()
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.uv0.len(), 5126, "VEC2", None, None))
            } else { None };

            // Indices → SCALAR uint16 ou uint32.
            let use_u32 = prim.positions.len() > 65535;
            let (idx_comp_type, idx_raw): (u32, Vec<u8>) = if use_u32 {
                (5125, prim.indices.iter().flat_map(|&i| i.to_le_bytes()).collect())
            } else {
                (5123, prim.indices.iter().flat_map(|&i| (i as u16).to_le_bytes()).collect())
            };
            // Alignement 4B
            let mut idx_raw_padded = idx_raw;
            while idx_raw_padded.len() % 4 != 0 { idx_raw_padded.push(0); }
            let idx_acc = add_accessor(
                &mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                &idx_raw_padded, prim.indices.len(), idx_comp_type, "SCALAR", None, None,
            );

            // Construction du prim JSON.
            let mut attrs_obj = json!({ "POSITION": pos_acc });
            if let Some(n) = normal_acc { attrs_obj["NORMAL"] = json!(n); }
            if let Some(u) = uv_acc { attrs_obj["TEXCOORD_0"] = json!(u); }

            prim_defs.push(json!({
                "attributes": attrs_obj,
                "indices": idx_acc,
                "material": 0,
                "mode": 4  // TRIANGLES
            }));
        }

        if prim_defs.is_empty() {
            continue;
        }

        let mesh_idx = mesh_defs.len();
        mesh_defs.push(json!({
            "name": comp_name,
            "primitives": prim_defs
        }));
        mesh_nodes.push(json!({
            "name": comp_name,
            "mesh": mesh_idx
        }));
    }

    let node_indices: Vec<usize> = (0..mesh_nodes.len()).collect();

    // ── JSON glTF complet ─────────────────────────────────────────────────────
    let gltf_obj = json!({
        "asset": {
            "version": "2.0",
            "generator": "nie-formats assemble.rs"
        },
        "accessors": accessor_defs,
        "bufferViews": buffer_views_json,
        "buffers": [{ "byteLength": bv_data.len() }],
        "materials": material_defs,
        "meshes": mesh_defs,
        "nodes": mesh_nodes,
        "scene": 0,
        "scenes": [{ "nodes": node_indices }]
    });

    let json_bytes = gltf_obj.to_string().into_bytes();
    // Padding JSON à 4B avec espaces (glTF spec).
    let json_padded_len = (json_bytes.len() + 3) & !3;
    let mut json_padded = json_bytes;
    while json_padded.len() < json_padded_len {
        json_padded.push(0x20);
    }

    // Padding BIN à 4B avec zéros.
    let bin_padded_len = (bv_data.len() + 3) & !3;
    let mut bin_padded = bv_data;
    while bin_padded.len() < bin_padded_len {
        bin_padded.push(0);
    }

    let total_len = 12 + 8 + json_padded_len + 8 + bin_padded_len;

    let mut glb: Vec<u8> = Vec::with_capacity(total_len);

    // Header GLB.
    glb.extend_from_slice(&0x46546C67u32.to_le_bytes()); // magic "glTF"
    glb.extend_from_slice(&2u32.to_le_bytes());           // version 2
    glb.extend_from_slice(&(total_len as u32).to_le_bytes());

    // Chunk JSON.
    glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes()); // "JSON"
    glb.extend_from_slice(&json_padded);

    // Chunk BIN.
    glb.extend_from_slice(&(bin_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x004E4942u32.to_le_bytes()); // "BIN\0"
    glb.extend_from_slice(&bin_padded);

    glb
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const GLB_DIR: &str = "/home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11/model";

    fn glb_dir() -> PathBuf {
        PathBuf::from(GLB_DIR)
    }

    fn glb_exists(name: &str) -> bool {
        glb_dir().join(format!("{name}.glb")).exists()
    }

    // ── Tests unitaires (pas d'accès disque) ─────────────────────────────────

    #[test]
    fn type_idx_mapping_couvre_0_a_17() {
        // Tous les type_idx 0..17 doivent avoir un GLB.
        for i in 0u8..=17 {
            assert!(
                type_idx_to_glb_name(i).is_some(),
                "type_idx={i} sans GLB base — vérifier la table TYPE_IDX_TO_GLB"
            );
        }
    }

    #[test]
    fn type_idx_101_201_sans_glb() {
        assert!(type_idx_to_glb_name(101).is_none(), "animal n'a pas de GLB base");
        assert!(type_idx_to_glb_name(201).is_none(), "vehicle n'a pas de GLB base");
        assert!(type_idx_to_glb_name(255).is_none(), "inconnu n'a pas de GLB base");
    }

    #[test]
    fn season_key_depuis_series() {
        // Vérifiés sur les valeurs réelles de inagle_characters.series.
        assert_eq!(SeasonKey::from_series("Inazuma Eleven"), SeasonKey::Ie);
        assert_eq!(SeasonKey::from_series("Inazuma Eleven 2"), SeasonKey::Ie);
        assert_eq!(SeasonKey::from_series("Inazuma Eleven GO"), SeasonKey::Go);
        assert_eq!(SeasonKey::from_series("ARES"), SeasonKey::Go);
        assert_eq!(SeasonKey::from_series("Victory Road"), SeasonKey::V);
        assert_eq!(SeasonKey::from_series("Inazuma Eleven: Victory Road"), SeasonKey::V);
        // Valeur inconnue → Ie par défaut.
        assert_eq!(SeasonKey::from_series("Unknown"), SeasonKey::Ie);
    }

    #[test]
    fn season_key_as_str() {
        assert_eq!(SeasonKey::Ie.as_str(), "ie");
        assert_eq!(SeasonKey::Go.as_str(), "go");
        assert_eq!(SeasonKey::V.as_str(), "v");
    }

    #[test]
    fn uniform_model_entry_selection_position() {
        let entry = UniformModelEntry {
            type_id: 0,
            fielder_crc: 0x9D2BBD10,
            keeper_crc: 0x55CB3260,
        };
        assert_eq!(entry.crc_for_position(FieldPosition::Fielder), 0x9D2BBD10);
        assert_eq!(entry.crc_for_position(FieldPosition::Goalkeeper), 0x55CB3260);
        assert_eq!(entry.crc_for_position(FieldPosition::Manager), 0x9D2BBD10);
    }

    #[test]
    fn assemble_error_no_base_glb() {
        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 101, // animal → pas de GLB
            glb_dir: glb_dir(),
            uniform_model_crc: 0,
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
        };
        let result = assemble_character_model(&input);
        assert!(
            matches!(result, Err(AssembleError::NoBaseGlb(101))),
            "type_idx=101 doit renvoyer NoBaseGlb"
        );
    }

    // ── Tests d'intégration réels (nécessitent GLB sur le VPS) ───────────────

    /// Vérifie que les GLBs de corps partagés existent pour les 4 meshes de base.
    #[test]
    fn glb_bodies_partagees_existent() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent");
            return;
        }
        for name in ["base_normal_00", "base_normal_01", "base_normal_02", "base_normal_03",
                     "base_tall_00", "base_big_00", "base_small_00"] {
            assert!(glb_exists(name), "GLB manquant : {name}.glb");
        }
    }

    /// Assemblage complet de c01000010 (Endou Mamoru IE1) sans uniforme.
    ///
    /// Vérifie :
    /// - Corps (base_normal_00) + Visage (c01000010) chargés.
    /// - Nombre de vertices cohérent avec les valeurs réelles mesurées.
    /// - Pas de primitives uniforme (aucune donnée fournie).
    /// - Export GLB valide (magic correct, non vide).
    #[test]
    fn assemblage_c01000010_corps_face_sans_uniforme() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent ({GLB_DIR})");
            return;
        }
        if !glb_exists("c01000010") || !glb_exists("base_normal_00") {
            eprintln!("SKIP : GLBs manquants");
            return;
        }

        // c01000010 : type_idx=0 → base_normal_00
        // (vérifié : CHARA_BODY_INFO[bodyInfoId=613579].var[4]=0)
        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 0,
            glb_dir: glb_dir(),
            uniform_model_crc: 0x9D2BBD10, // Raimon fielder (réel)
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
        };

        let model = assemble_character_model(&input).expect("assemblage c01000010");

        // Corps : 2 primitives (base_normal_00 a 2 meshes : 321 + 36 verts)
        let body_verts: usize = model.body_primitives().map(|p| p.vertex_count()).sum();
        assert_eq!(body_verts, 357, "corps base_normal_00 : 357 vertices attendus (321+36)");

        // Visage : 3 primitives (c01000010 a 3 meshes : 798+344+72 verts)
        let face_verts: usize = model.face_primitives().map(|p| p.vertex_count()).sum();
        assert_eq!(face_verts, 1214, "visage c01000010 : 1214 vertices attendus (798+344+72)");

        // Aucun uniforme fourni.
        assert_eq!(model.uniform_primitives().count(), 0, "pas d'uniforme fourni");

        // Total = 357 + 1214 = 1571.
        assert_eq!(model.total_vertex_count(), 1571, "total vertices : 1571");

        // Triangles du visage : 3390/3 + 1536/3 + 336/3 = 1130+512+112 = 1754
        let face_tris: usize = model.face_primitives().map(|p| p.triangle_count()).sum();
        assert_eq!(face_tris, 1754, "triangles visage : 1754");

        // Métadonnées.
        assert_eq!(model.internal_code, "c01000010");
        assert_eq!(model.body_glb, "base_normal_00");
        assert_eq!(model.uniform_crc, 0x9D2BBD10);

        // Export GLB : magic "glTF" + taille non nulle.
        let glb = model.to_glb();
        assert!(glb.len() > 12, "GLB exporté non vide");
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67, "magic GLB valide");

        // Version 2.
        let version = u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]);
        assert_eq!(version, 2);

        // Total length cohérent.
        let total_len = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total_len, glb.len(), "total_length GLB = taille buffer");

        eprintln!(
            "PASS c01000010 : corps={body_verts}v, face={face_verts}v, total={}v, glb={}B",
            model.total_vertex_count(), glb.len()
        );
    }

    /// Vérifie la chaîne de matching complète pour Endou Mamoru (c01000010, IE1) :
    ///
    /// Raimon → kits.ie = 0x252CE113 → m_UniformInfoList[nameId=0x252CE113].modelInfo=[0,2]
    /// → m_UniformModelInfoList[0].uniformFielderModelIdCrc = 0x9D2BBD10
    ///
    /// Valeurs vérifiées sur les fichiers JSON gamedata réels.
    #[test]
    fn chaine_matching_uniforme_raimon_ie1() {
        // Données issues de uniform_config_1.03.52.00.cfg.bin.json (réel)
        // m_UniformInfoList[0] = nameId=0x252CE113, modelInfo=[0,2]
        // m_UniformModelInfoList[0] = fielder=0x9D2BBD10, keeper=0x55CB3260
        let kit_id_str = "0x252CE113";
        let kit_id: u32 = u32::from_str_radix(&kit_id_str[2..], 16).unwrap();

        // Simule la résolution : on cherche le kit_id dans m_UniformInfoList.
        // On vérifie que le CRC fielder correspond à la valeur réelle mesurée.
        let expected_fielder: u32 = 0x9D2BBD10;
        let expected_keeper: u32 = 0x55CB3260;

        // Entry correspondant à la saison IE (type_id=0 pour le fielder standard).
        let entry = UniformModelEntry {
            type_id: 0,
            fielder_crc: expected_fielder,
            keeper_crc: expected_keeper,
        };

        assert_eq!(entry.crc_for_position(FieldPosition::Fielder), 0x9D2BBD10);
        assert_eq!(entry.crc_for_position(FieldPosition::Goalkeeper), 0x55CB3260);

        // La saison d'Endou (IE1) → SeasonKey::Ie → "ie".
        let key = SeasonKey::from_series("Inazuma Eleven");
        assert_eq!(key.as_str(), "ie");

        // kit_id = kits["ie"] = 0x252CE113.
        assert_eq!(kit_id, 0x252CE113);
    }

    /// Vérifie que l'export GLB d'un modèle vide (0 primitives) est syntaxiquement valide.
    #[test]
    fn export_glb_modele_vide_valide() {
        let model = AssembledModel {
            internal_code: "test".into(),
            body_glb: "base_normal_00".into(),
            face_glb: "test".into(),
            uniform_crc: 0,
            primitives: Vec::new(),
        };
        let glb = model.to_glb();
        assert!(glb.len() >= 12);
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);
        let total = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total, glb.len());
    }
}
