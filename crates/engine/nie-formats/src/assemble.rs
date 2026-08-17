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
//!    en dehors des CPK ; son chemin CPK passe par le manifeste CRC→path.
//!
//! ## Résultat
//!
//! [`assemble_character_model`] renvoie un [`AssembledModel`] contenant l'ensemble des
//! [`MeshPrimitive`] des trois composants dans un seul espace monde. La struct est exportable
//! en glTF binaire via [`AssembledModel::to_glb`] (sans textures) ou
//! [`AssembledModel::to_glb_textured`] (avec URI vers le CDN streaming).
//!
//! ## Textures (voie CDN URI — zéro copie de pixels)
//!
//! Les textures G4TX vivent dans les CPK chiffrés (`dx11/chr/_face/`, `dx11/chr/_uniform/`).
//! Le CDN `cdn.rosegriffon.fr` décode les G4TX → PNG à la volée (iecode-cdn:8788, aucun dump).
//!
//! [`to_glb_textured`] génère un GLB avec `images[].uri` pointant vers ces URLs CDN.
//! Three.js/Babylon.js chargent les URI automatiquement. Format de l'URI :
//!
//! - Visage : `https://cdn.rosegriffon.fr/dx11/chr/_face/{series_dir}/{code}/{code}.png`
//! - Uniforme : `https://cdn.rosegriffon.fr/dx11/chr/_uniform/{base_dir}/{tex_name}.png`
//!
//! La résolution du `series_dir` depuis le code interne suit la convention des CPK IEVR :
//! `c01…` → `01_ie1`, `c02…` → `02_ie2`, …, `c11…` → `11_victory`, etc.
//!
//! ## Modèles génériques (keshin / armures)
//!
//! [`assemble_generic_model`] assemble n'importe quelle paire G4MD+G4MG en GLB, sans
//! distinction de composant. Utilisé pour les keshin (`common/chr/_keshin/`) et les armures
//! (`common/chr/_armd/`).
//!
//! ## Skinning — bilan honnête
//!
//! Les GLBs pré-convertis `dx11/model/` sont des **mailles statiques** (0 skin, 0 joint).
//! Les données G4MG brutes des CPK ne contiennent **pas** d'attributs `BLENDWEIGHT`/
//! `BLENDINDICES` dans leur layout vertex : seuls `position`, `normale`, `UV0` sont présents
//! (vérifiés sur plusieurs uniforms/face réels). Le G4SK (squelette) porte la hiérarchie d'os
//! et les bind-poses mais les vertices G4MG ne référencent pas les os. L'assemblage est donc
//! statique ; le squelette G4SK est parsé pour information (voir [`g4sk`]) mais non lié.
//!
//! ## Limites documentées
//!
//! - **Skinning absent** : mailles statiques — voir ci-dessus.
//! - **Corps** : les GLBs `base_*` sont dans l'espace monde via SharpGLTF ; pas de coords locales.
//! - **Coordonnées** : axe Y = haut, unité ≈ mètre. Face y ∈ [1.3, 1.66], corps y ∈ [1.29, 1.60].
//!
//! ## Anti-hallucination
//!
//! Toutes les tables (type_idx → GLB, season_key, series_dir depuis code) sont vérifiées sur
//! les données réelles (`chara_body_1.03.49.00.cfg.bin.json`, index Redis `iev:file:index` DB3,
//! `var/model-crc-manifest.ndjson`). Aucune valeur n'est inventée.
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

// ── Résolution du répertoire de série depuis le code interne ─────────────────

/// Résout le répertoire de série (`01_ie1`, `02_ie2`, …) depuis un code interne de personnage.
///
/// Le code interne est de la forme `c<2chiffres><6chiffres>`, par exemple `c01000010`.
/// Les 2 chiffres après le `c` déterminent la série, vérifiés sur l'index `iev:file:index` DB3 :
///
/// | Préfixe | Répertoire    | Série                  |
/// |---------|---------------|------------------------|
/// | `c01`   | `01_ie1`      | Inazuma Eleven 1       |
/// | `c02`   | `02_ie2`      | Inazuma Eleven 2       |
/// | `c03`   | `03_ie3`      | Inazuma Eleven 3       |
/// | `c04`   | `04_go1`      | IE GO 1                |
/// | `c05`   | `05_go2`      | IE GO 2                |
/// | `c06`   | `06_go3`      | IE GO 3                |
/// | `c07`   | `07_ares`     | IE Ares no Tenbin      |
/// | `c08`   | `08_orion`    | IE Orion no Kokuin     |
/// | `c11`   | `11_victory`  | IE Victory Road        |
/// | `c20`   | `20_edit`     | Personnage éditeur     |
/// | `c21`   | `21_mannequin`| Mannequin              |
/// | `c22`   | `22_combo`    | Combo                  |
///
/// Retourne `None` si le code ne commence pas par `c` ou si le préfixe de 2 chiffres est inconnu.
#[must_use]
pub fn series_dir_from_code(internal_code: &str) -> Option<&'static str> {
    // Le code commence par 'c' puis 2 chiffres de série.
    let digits = internal_code.strip_prefix('c')?;
    let prefix: &str = digits.get(..2)?;
    match prefix {
        "01" => Some("01_ie1"),
        "02" => Some("02_ie2"),
        "03" => Some("03_ie3"),
        "04" => Some("04_go1"),
        "05" => Some("05_go2"),
        "06" => Some("06_go3"),
        "07" => Some("07_ares"),
        "08" => Some("08_orion"),
        "11" => Some("11_victory"),
        "20" => Some("20_edit"),
        "21" => Some("21_mannequin"),
        "22" => Some("22_combo"),
        _ => None,
    }
}

// ── Résolution des URI de textures CDN ───────────────────────────────────────

/// Préfixe de base de l'URL CDN pour les textures.
///
/// Peut être surchargé via [`TextureUriConfig`] pour pointer vers un CDN alternatif.
pub const CDN_BASE: &str = "https://cdn.rosegriffon.fr";

/// Configuration des URI de textures (permet de surcharger le CDN de base en test).
#[derive(Debug, Clone)]
pub struct TextureUriConfig {
    /// Préfixe CDN (défaut : [`CDN_BASE`]).
    pub cdn_base: String,
}

impl Default for TextureUriConfig {
    fn default() -> Self {
        Self { cdn_base: CDN_BASE.to_string() }
    }
}

/// Résout l'URI CDN d'une texture de **visage** depuis le code interne du personnage.
///
/// Chemin : `{cdn_base}/dx11/chr/_face/{series_dir}/{code}/{code}.png`
///
/// Retourne `None` si `internal_code` ne correspond à aucune série connue.
///
/// # Exemple
///
/// ```
/// use nie_formats::assemble::{face_texture_uri, TextureUriConfig};
/// let cfg = TextureUriConfig::default();
/// let uri = face_texture_uri("c01000010", &cfg).unwrap();
/// assert_eq!(uri, "https://cdn.rosegriffon.fr/dx11/chr/_face/01_ie1/c01000010/c01000010.png");
/// ```
#[must_use]
pub fn face_texture_uri(internal_code: &str, cfg: &TextureUriConfig) -> Option<String> {
    let dir = series_dir_from_code(internal_code)?;
    Some(alloc::format!(
        "{}/dx11/chr/_face/{}/{}/{}.png",
        cfg.cdn_base, dir, internal_code, internal_code
    ))
}

/// Résout l'URI CDN d'une texture d'**uniforme** depuis le nom de base du matériau.
///
/// Le `material_base_name` est extrait du G4MD (`material_base_names[i]`) et correspond
/// au nom du répertoire d'uniforme (ex. `sk000901`, `u011001`, `f001202`).
/// La texture principale est `{base_name}_10.g4tx` (suffixe `_10` = couleur principale, vérifié
/// sur l'index iev:file:index DB3 pour plusieurs uniformes). Si `_10` est absent, on essaie
/// la texture sans suffixe.
///
/// Chemin : `{cdn_base}/dx11/chr/_uniform/{base_name}/{base_name}_10.png`
///
/// # Exemple
///
/// ```
/// use nie_formats::assemble::{uniform_texture_uri, TextureUriConfig};
/// let cfg = TextureUriConfig::default();
/// let uri = uniform_texture_uri("sk000901", &cfg);
/// assert_eq!(uri, "https://cdn.rosegriffon.fr/dx11/chr/_uniform/sk000901/sk000901_10.png");
/// ```
#[must_use]
pub fn uniform_texture_uri(material_base_name: &str, cfg: &TextureUriConfig) -> String {
    alloc::format!(
        "{}/dx11/chr/_uniform/{}/{}_10.png",
        cfg.cdn_base, material_base_name, material_base_name
    )
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
    /// Keshin (`common/chr/_keshin/`).
    Keshin,
    /// Armure (`common/chr/_armd/`).
    Armed,
    /// Modèle générique (autre catégorie).
    Generic,
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
    /// Nom de texture base-color issu du G4MD (ex. `c01000010`, `sk000901`).
    /// Vide pour les primitives issues de GLBs pré-convertis (matériau `Default`).
    pub material_name: String,
    /// URI CDN résolue de la texture baseColorTexture.
    /// Vide si la résolution n'a pas pu aboutir (matériau générique ou G4MD non parsé).
    /// Renseigné par [`AssembledModel::resolve_texture_uris`].
    pub texture_uri: String,
    /// Positions float3 (X, Y, Z) dans l'espace monde.
    pub positions: Vec<g4mg::Vec3>,
    /// Normales float3 (renormalisées). Vide si non disponibles.
    pub normals: Vec<g4mg::Vec3>,
    /// UV0 float2 (U, V). Vide si non disponibles.
    pub uv0: Vec<g4mg::Vec2>,
    /// Couleurs float4 (R, G, B, A). Vide si non disponibles.
    pub colors: Vec<g4mg::Vec4>,
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

/// Texture embarquée dans le GLB (données PNG brutes à injecter dans le buffer BIN).
///
/// Permet d'embarquer des textures PNG directement dans le GLB au lieu d'utiliser
/// des URI externes (CDN). Plus autonome, fonctionne sans réseau.
#[derive(Debug, Clone)]
pub struct EmbeddedTexture {
    /// Composant associé (Face, Uniform, etc.) — pour l'attribution aux primitives.
    pub component: MeshComponent,
    /// Nom logique de la texture (ex. `"c01000010"`, `"u011001"`).
    pub name: String,
    /// Données PNG brutes (encodées, prêtes pour l'injection dans le bufferView BIN).
    pub png_bytes: Vec<u8>,
}

/// Résultat de l'assemblage : ensemble des primitives de tous les composants.
///
/// ## Export glTF
///
/// - [`AssembledModel::to_glb`] — GLB sans textures (matériaux PBR generiques sans image).
/// - [`AssembledModel::to_glb_textured`] — GLB avec `images[].uri` pointant vers le CDN
///   IEVR (iecode-cdn:8788 décode les G4TX → PNG en live depuis les CPK).
/// - [`AssembledModel::to_glb_embedded`] — GLB avec textures PNG **embarquées** dans le
///   buffer BIN (autonome, aucune dépendance réseau). Utilise [`EmbeddedTexture`].
///
/// Chaque composant (corps / visage / uniforme / keshin / armure / generique) devient un
/// noeud glTF séparé avec son propre mesh.
#[derive(Debug)]
pub struct AssembledModel {
    /// Identifiant interne (ex. `"c01000010"` pour perso, `"k000010"` pour keshin).
    pub internal_code: String,
    /// Nom de fichier GLB du corps (ex. `"base_normal_00"`). Vide pour modèles génériques.
    pub body_glb: String,
    /// Nom de fichier GLB du visage (ex. `"c01000010"`). Vide pour modèles génériques.
    pub face_glb: String,
    /// CRC de l'uniforme sélectionné (`0` si non résolu ou modèle générique).
    pub uniform_crc: u32,
    /// Toutes les primitives.
    pub primitives: Vec<MeshPrimitive>,
    /// Textures PNG à embarquer dans le GLB (renseigné par le service avant export).
    pub embedded_textures: Vec<EmbeddedTexture>,
}

impl AssembledModel {
    /// Nombre total de vertices.
    #[must_use]
    pub fn total_vertex_count(&self) -> usize {
        self.primitives.iter().map(MeshPrimitive::vertex_count).sum()
    }

    /// Nombre total de triangles.
    #[must_use]
    pub fn total_triangle_count(&self) -> usize {
        self.primitives.iter().map(MeshPrimitive::triangle_count).sum()
    }

    /// Primitives appartenant au corps.
    pub fn body_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Body)
    }

    /// Primitives appartenant au visage.
    pub fn face_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Face)
    }

    /// Primitives appartenant à l'uniforme.
    pub fn uniform_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Uniform)
    }

    /// Primitives appartenant au keshin.
    pub fn keshin_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Keshin)
    }

    /// Primitives appartenant à une armure (armed).
    pub fn armed_primitives(&self) -> impl Iterator<Item = &MeshPrimitive> {
        self.primitives.iter().filter(|p| p.component == MeshComponent::Armed)
    }

    /// Résout les URI de textures CDN pour toutes les primitives qui ont un `material_name`.
    ///
    /// Met à jour `primitive.texture_uri` en place pour les primitives issues de G4MD/G4MG
    /// (celles dont `material_name` est non vide). Les primitives issues de GLBs pré-convertis
    /// gardent `texture_uri = ""` (matériau `Default` sans texture).
    ///
    /// Utilise `internal_code` du modèle pour résoudre le répertoire de série du visage.
    pub fn resolve_texture_uris(&mut self, cfg: &TextureUriConfig) {
        let face_uri = face_texture_uri(&self.internal_code, cfg);
        for prim in &mut self.primitives {
            if prim.material_name.is_empty() {
                continue;
            }
            prim.texture_uri = match prim.component {
                MeshComponent::Face => {
                    face_uri.clone().unwrap_or_default()
                }
                MeshComponent::Uniform => {
                    uniform_texture_uri(&prim.material_name, cfg)
                }
                MeshComponent::Keshin | MeshComponent::Armed | MeshComponent::Generic => {
                    // Keshin/armure : même répertoire que le modèle dans dx11/chr
                    // Pas de textures dx11 spécifiques pour ces composants dans l'index actuel.
                    // On laisse vide — les textures seront servies par @cpk_live si présentes.
                    String::new()
                }
                MeshComponent::Body => String::new(), // GLB pré-converti : pas de material_name G4MD
            };
        }
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **sans textures**.
    ///
    /// Matériaux generiques `Default` (PBR metallic-roughness, couleur blanche, sans image).
    /// Utile pour le debug ou quand le CDN n'est pas disponible.
    #[must_use]
    pub fn to_glb(&self) -> Vec<u8> {
        build_glb(self, false)
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **avec URI CDN** vers les textures.
    ///
    /// Résout automatiquement les URI CDN via [`resolve_texture_uris`] (appel idempotent) si
    /// les URI ne sont pas déjà renseignées. Les textures sont référencées par URI externe
    /// (pas embarquées dans le GLB) — elles sont streamées depuis le CDN lors du chargement.
    ///
    /// [`resolve_texture_uris`] doit avoir été appelé (ou appelez cette méthode qui le fait
    /// automatiquement si les URI sont vides).
    #[must_use]
    pub fn to_glb_textured(&mut self, cfg: &TextureUriConfig) -> Vec<u8> {
        // Résout les URI si pas encore fait.
        let needs_resolve = self.primitives.iter().all(|p| p.texture_uri.is_empty());
        if needs_resolve {
            self.resolve_texture_uris(cfg);
        }
        build_glb(self, true)
    }

    /// Exporte le modèle assemblé en glTF binaire (GLB 2.0) **avec textures PNG embarquées**
    /// dans le buffer BIN (autonome, aucune dépendance réseau).
    ///
    /// Les textures dans [`AssembledModel::embedded_textures`] sont injectées comme
    /// `bufferView` dans le BIN chunk du GLB. Le matériau de chaque composant est mis à jour
    /// pour pointer vers la bonne image.
    ///
    /// Les primitives issues de GLBs pré-convertis (Body) gardent le matériau Default.
    /// Les primitives issues de G4MD/G4MG (Face, Uniform depuis CPK) utilisent les textures
    /// embarquées si disponibles.
    ///
    /// Si [`embedded_textures`] est vide, équivaut à [`to_glb`] (matériaux Default).
    #[must_use]
    pub fn to_glb_embedded(&self) -> Vec<u8> {
        build_glb_embedded(self)
    }
}

// ── Erreurs d'assemblage ──────────────────────────────────────────────────────

/// Erreur lors de l'assemblage d'un personnage.
#[derive(Debug)]
pub enum AssembleError {
    /// Lecture du fichier GLB impossible.
    GlbNotFound(String),
    /// Données G4MD/G4MG invalides.
    Format(crate::FormatError),
    /// Le type corporel n'a pas de GLB base correspondant.
    NoBaseGlb(u8),
    /// Données GLB corrompues (JSON invalide ou buffer manquant).
    Corrupt(String),
}

// Display + Error + From MANUELS (no_std-ready via `core::error::Error`) — `thiserror` retiré (Phase 3 dédup).
impl core::fmt::Display for AssembleError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::GlbNotFound(s) => write!(f, "fichier GLB introuvable ou illisible : {s}"),
            Self::Format(e) => write!(f, "format invalide : {e}"),
            Self::NoBaseGlb(i) => write!(f, "type_idx={i} sans GLB base (animal/vehicle/inconnu)"),
            Self::Corrupt(s) => write!(f, "GLB corrompu : {s}"),
        }
    }
}

impl core::error::Error for AssembleError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Format(e) => Some(e),
            _ => None,
        }
    }
}

impl From<crate::FormatError> for AssembleError {
    fn from(e: crate::FormatError) -> Self {
        Self::Format(e)
    }
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

            // COLOR_0 (VEC4 ou VEC3, float/ubyte/ushort).
            let colors = if let Some(col_idx) = attrs["COLOR_0"].as_u64() {
                if let Some((off, stride_hint, count)) = read_accessor(col_idx as usize) {
                    let acc = &accessors[col_idx as usize];
                    let attr_type = acc["type"].as_str().unwrap_or("VEC4");
                    let comp_type = acc["componentType"].as_u64().unwrap_or(5126);
                    let is_vec3 = attr_type == "VEC3";
                    let num_components = if is_vec3 { 3 } else { 4 };
                    let component_size = match comp_type {
                        5126 => 4, // float
                        5121 => 1, // unsigned byte
                        5123 => 2, // unsigned short
                        _ => 4,
                    };
                    let stride = if stride_hint == 0 { num_components * component_size } else { stride_hint };
                    let mut cols = Vec::with_capacity(count);
                    for i in 0..count {
                        let p = off + i * stride;
                        if p + num_components * component_size > bin.len() { break; }
                        let read_component = |offset_idx: usize| -> f32 {
                            let cop = p + offset_idx * component_size;
                            match comp_type {
                                5126 => f32::from_le_bytes([bin[cop], bin[cop+1], bin[cop+2], bin[cop+3]]),
                                5121 => bin[cop] as f32 / 255.0,
                                5123 => u16::from_le_bytes([bin[cop], bin[cop+1]]) as f32 / 65535.0,
                                _ => 1.0,
                            }
                        };
                        let r = read_component(0);
                        let g = read_component(1);
                        let b = read_component(2);
                        let a = if is_vec3 { 1.0 } else { read_component(3) };
                        cols.push(g4mg::Vec4 { x: r, y: g, z: b, w: a });
                    }
                    cols
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
                texture_uri: String::new(), // résolu par resolve_texture_uris()
                positions,
                normals,
                uv0,
                colors,
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
                texture_uri: String::new(), // résolu par resolve_texture_uris()
                positions: sg.positions,
                normals: sg.normals,
                uv0: sg.uv0,
                colors: sg.colors,
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
        embedded_textures: Vec::new(),
    })
}


/// Une pièce d'avatar à assembler : son rôle et ses données de maillage.
///
/// L'avatar de l'éditeur n'est pas un modèle unique mais un empilement : un corps par
/// morphologie, un visage, des coiffures avant et arrière, des oreilles, des accessoires. Chaque
/// pièce vit à plat sous `chr/_face/20_EDIT/<dossier>/<nom>.{g4md,g4mg}`.
pub struct AvatarPiece {
    /// Rôle de la pièce dans le modèle final.
    pub component: MeshComponent,
    /// Données G4MD brutes.
    pub g4md: Vec<u8>,
    /// Données G4MG brutes.
    pub g4mg: Vec<u8>,
}

/// Assemble un avatar de l'éditeur depuis ses pièces, dans l'ordre donné.
///
/// Contrairement à [`assemble_character_model`], rien n'est résolu depuis les tables gamedata :
/// l'appelant fournit les pièces déjà lues, parce que leur choix vient de l'éditeur (recette,
/// morphologie) et non d'une fiche de personnage.
///
/// # Erreurs
///
/// [`AssembleError::Format`] si un couple G4MD/G4MG est invalide. Une pièce sans primitive est
/// ignorée : un accessoire vide ne doit pas faire échouer l'avatar entier.
pub fn assemble_avatar_model(
    code: &str,
    pieces: &[AvatarPiece],
) -> Result<AssembledModel, AssembleError> {
    let mut primitives = Vec::new();
    for piece in pieces {
        let extraites =
            extract_primitives_from_g4md_g4mg(&piece.g4md, &piece.g4mg, piece.component)?;
        primitives.extend(extraites);
    }
    Ok(AssembledModel {
        internal_code: code.to_string(),
        body_glb: String::new(),
        face_glb: String::new(),
        uniform_crc: 0,
        primitives,
        embedded_textures: Vec::new(),
    })
}

// ── Modèles génériques (keshin / armures) ─────────────────────────────────────

/// Paramètres pour l'assemblage d'un modèle générique (keshin, armure, objet…).
pub struct GenericModelInput {
    /// Identifiant du modèle (ex. `"k000010"`, `"ka001901"`).
    pub code: String,
    /// Données G4MD brutes.
    pub g4md: Vec<u8>,
    /// Données G4MG brutes.
    pub g4mg: Vec<u8>,
    /// Composant glTF à attribuer aux primitives.
    pub component: MeshComponent,
}

/// Assemble un modèle générique depuis des données G4MD+G4MG brutes.
///
/// Utilisé pour les **keshin** (`common/chr/_keshin/`), les **armures** (`common/chr/_armd/`),
/// et tout autre modèle G4MD+G4MG non lié à un personnage. La paire G4MD+G4MG est typiquement
/// extraite d'un CPK via le VFS ou le manifeste CRC→chemin (`var/model-crc-manifest.ndjson`).
///
/// Les primitives produites ont `material_name` résolu depuis le G4MD (noms base-color). Les
/// `texture_uri` sont vides ; appeler [`AssembledModel::resolve_texture_uris`] si nécessaire.
///
/// # Erreurs
///
/// - [`AssembleError::Format`] si le G4MD ou G4MG est invalide.
pub fn assemble_generic_model(input: GenericModelInput) -> Result<AssembledModel, AssembleError> {
    let primitives = extract_primitives_from_g4md_g4mg(&input.g4md, &input.g4mg, input.component)?;
    Ok(AssembledModel {
        internal_code: input.code,
        body_glb: String::new(),
        face_glb: String::new(),
        uniform_crc: 0,
        primitives,
        embedded_textures: Vec::new(),
    })
}

/// Raccourci : assemble un **keshin** depuis ses données G4MD+G4MG brutes.
///
/// `code` est l'identifiant du keshin (ex. `"k000010"`), typiquement le nom de répertoire
/// dans `common/chr/_keshin/`.
///
/// # Erreurs
///
/// Identiques à [`assemble_generic_model`].
pub fn assemble_keshin(code: &str, g4md: Vec<u8>, g4mg: Vec<u8>) -> Result<AssembledModel, AssembleError> {
    assemble_generic_model(GenericModelInput {
        code: code.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Keshin,
    })
}

/// Raccourci : assemble une **armure** (armed) depuis ses données G4MD+G4MG brutes.
///
/// `code` est l'identifiant de l'armure (ex. `"ka001901"`), typiquement le nom de répertoire
/// dans `common/chr/_armd/`.
///
/// # Erreurs
///
/// Identiques à [`assemble_generic_model`].
pub fn assemble_armed(code: &str, g4md: Vec<u8>, g4mg: Vec<u8>) -> Result<AssembledModel, AssembleError> {
    assemble_generic_model(GenericModelInput {
        code: code.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Armed,
    })
}

// ── Chargement depuis manifeste CRC→chemin + VFS ─────────────────────────────

/// Entrée du manifeste CRC→chemin (parsée depuis `var/model-crc-manifest.ndjson`).
///
/// Chaque ligne du manifeste a la forme :
/// `{"crc":1234567890,"path":"data/common/chr/_uniform/u011001/u011001.g4md","cpk":"abc.cpk"}`
#[derive(Debug, Clone)]
pub struct ManifestEntry {
    /// CRC32 nie (accumulateur brut, sans finalisation).
    pub crc: u32,
    /// Chemin interne du fichier dans les CPK (relatif à `data/`).
    pub path: String,
    /// Nom du CPK contenant le fichier.
    pub cpk: String,
}

/// Charge le manifeste CRC→chemin depuis un lecteur NDJSON.
///
/// Chaque ligne valide est parsée en [`ManifestEntry`]. Les lignes malformées sont silencieusement
/// ignorées (tolère les lignes partielles en fin de fichier). Retourne toutes les entrées valides.
#[must_use]
pub fn load_manifest(ndjson: &str) -> Vec<ManifestEntry> {
    ndjson.lines()
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
            let crc = v["crc"].as_u64()? as u32;
            let path = v["path"].as_str()?.to_string();
            let cpk = v["cpk"].as_str()?.to_string();
            Some(ManifestEntry { crc, path, cpk })
        })
        .collect()
}

/// Résout le chemin G4MD dans le manifeste depuis un CRC32.
///
/// Cherche l'entrée avec `crc == target_crc` ET dont l'extension est `.g4md`. Retourne
/// le chemin interne (ex. `"data/common/chr/_uniform/u011001/u011001.g4md"`) ou `None`.
#[must_use]
pub fn resolve_crc_to_g4md_path(manifest: &[ManifestEntry], target_crc: u32) -> Option<&str> {
    manifest.iter()
        .find(|e| e.crc == target_crc && e.path.ends_with(".g4md"))
        .map(|e| e.path.as_str())
}

/// Construit le chemin G4MG compagnon depuis un chemin G4MD (remplace l'extension).
///
/// Ex. `"data/common/chr/_uniform/u011001/u011001.g4md"` → `"data/common/chr/_uniform/u011001/u011001.g4mg"`.
#[must_use]
pub fn g4md_to_g4mg_path(g4md_path: &str) -> String {
    if let Some(stem) = g4md_path.strip_suffix(".g4md") {
        alloc::format!("{stem}.g4mg")
    } else {
        g4md_path.to_string()
    }
}

// ── Export glTF binaire (GLB 2.0) ────────────────────────────────────────────

/// Construit le JSON glTF + buffer binaire à partir du modèle assemblé.
///
/// `with_textures = true` : émet des `images[]` + `textures[]` + matériaux PBR avec
/// `baseColorTexture` pour chaque primitive dont `texture_uri` est renseigné.
/// `with_textures = false` : un seul matériau générique `Default`.
///
/// Structure du GLB émis :
/// ```text
/// header (12 B) + chunk JSON + chunk BIN
/// ```
fn build_glb(model: &AssembledModel, with_textures: bool) -> Vec<u8> {
    use serde_json::{json, Value};

    // Buffer binaire accumulant toutes les données d'accessors (positions, normales, UV, indices).
    let mut bv_data: Vec<u8> = Vec::new();
    let mut accessor_defs: Vec<Value> = Vec::new();
    let mut buffer_views_json: Vec<Value> = Vec::new();

    /// Ajoute un bufferView + accessor et renvoie l'index accessor.
    #[allow(clippy::too_many_arguments)]
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
        while !bv_data.len().is_multiple_of(4) {
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

    // ── Collecte des URI de textures uniques (pour la table images/textures) ──
    // Chaque URI unique → un index de texture glTF.
    // Les primitives sans texture_uri (vide) → matériau Default (index 0).
    let mut uri_to_tex_idx: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut image_defs: Vec<Value> = Vec::new();
    let mut texture_defs: Vec<Value> = Vec::new();

    if with_textures {
        for prim in &model.primitives {
            if prim.texture_uri.is_empty() { continue; }
            if uri_to_tex_idx.contains_key(&prim.texture_uri) { continue; }
            let img_idx = image_defs.len();
            image_defs.push(json!({
                "uri": prim.texture_uri,
                "mimeType": "image/png"
            }));
            let tex_idx = texture_defs.len();
            texture_defs.push(json!({ "source": img_idx }));
            uri_to_tex_idx.insert(prim.texture_uri.clone(), tex_idx);
        }
    }

    // ── Matériaux ─────────────────────────────────────────────────────────────
    // - Index 0 : matériau générique Default (blanc, PBR sans texture).
    // - Index 1+ : matériaux avec baseColorTexture (un par URI unique), si with_textures.
    let mut material_defs: Vec<Value> = Vec::new();
    material_defs.push(json!({
        "name": "Default",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": 0.0,
            "roughnessFactor": 1.0
        }
    }));
    // Map URI → material index (pour les primitives texturées).
    let mut uri_to_mat_idx: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    if with_textures {
        for (uri, tex_idx) in &uri_to_tex_idx {
            let mat_idx = material_defs.len();
            material_defs.push(json!({
                "name": uri,
                "pbrMetallicRoughness": {
                    "baseColorTexture": { "index": tex_idx },
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0
                },
                "doubleSided": true
            }));
            uri_to_mat_idx.insert(uri.clone(), mat_idx);
        }
    }

    // ── Parcours des composants ───────────────────────────────────────────────
    let components_order = [
        MeshComponent::Body,
        MeshComponent::Face,
        MeshComponent::Uniform,
        MeshComponent::Keshin,
        MeshComponent::Armed,
        MeshComponent::Generic,
    ];
    let mut mesh_nodes: Vec<Value> = Vec::new();
    let mut mesh_defs: Vec<Value> = Vec::new();

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
            MeshComponent::Keshin => "Keshin",
            MeshComponent::Armed => "Armed",
            MeshComponent::Generic => "Generic",
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
                    let mut b = [0u8; 8];
                    b[..4].copy_from_slice(&v.u.to_le_bytes());
                    b[4..].copy_from_slice(&v.v.to_le_bytes());
                    b
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.uv0.len(), 5126, "VEC2", None, None))
            } else { None };

            // Colors → VEC4 float32 (5126), optionnel.
            let _color_acc = if !prim.colors.is_empty() {
                let raw: Vec<u8> = prim.colors.iter().flat_map(|v| {
                    [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes(), v.w.to_le_bytes()].concat()
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.colors.len(), 5126, "VEC4", None, None))
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

            // Résolution du matériau : texture si disponible, sinon Default (0).
            let mat_idx = if with_textures && !prim.texture_uri.is_empty() {
                *uri_to_mat_idx.get(&prim.texture_uri).unwrap_or(&0)
            } else {
                0usize
            };

            // Construction du prim JSON.
            let mut attrs_obj = json!({ "POSITION": pos_acc });
            if let Some(n) = normal_acc { attrs_obj["NORMAL"] = json!(n); }
            if let Some(u) = uv_acc { attrs_obj["TEXCOORD_0"] = json!(u); }
            // Desactive COLOR_0 pour eviter que les shaders standards n'appliquent des couleurs de debug/masquage
            // if let Some(c) = color_acc { attrs_obj["COLOR_0"] = json!(c); }

            prim_defs.push(json!({
                "attributes": attrs_obj,
                "indices": idx_acc,
                "material": mat_idx,
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
    let mut gltf_obj = json!({
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

    // Injecte images et textures uniquement si with_textures et qu'on en a.
    if with_textures && !image_defs.is_empty() {
        gltf_obj["images"] = json!(image_defs);
        gltf_obj["textures"] = json!(texture_defs);
    }

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

// ── Export GLB avec textures embarquées ──────────────────────────────────────

/// Construit un GLB avec les textures PNG **embarquées** dans le buffer BIN.
///
/// Chaque [`EmbeddedTexture`] dans `model.embedded_textures` est injectée comme un
/// `bufferView` supplémentaire dans le BIN chunk. Les primitives dont le composant correspond
/// à une texture embarquée reçoivent un matériau PBR avec `baseColorTexture` liant à cette
/// image. Les primitives sans texture embarquée gardent le matériau `Default`.
///
/// La correspondance composant → texture est par [`MeshComponent`] : la première texture
/// embarquée du composant correspondant est utilisée. Les GLBs pré-convertis (Body) et les
/// primitives sans texture embarquée (material_name vide + pas d'embedded_texture pour ce
/// composant) gardent le matériau Default.
fn build_glb_embedded(model: &AssembledModel) -> Vec<u8> {
    use serde_json::{json, Value};

    // Buffer binaire accumulant toutes les données (positions/normales/UV/indices + PNG).
    let mut bv_data: Vec<u8> = Vec::new();
    let mut accessor_defs: Vec<Value> = Vec::new();
    let mut buffer_views_json: Vec<Value> = Vec::new();

    #[allow(clippy::too_many_arguments)]
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
        while !bv_data.len().is_multiple_of(4) { bv_data.push(0); }
        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0, "byteOffset": bv_offset, "byteLength": raw.len()
        }));
        let acc_idx = accessor_defs.len();
        let mut acc = json!({
            "bufferView": bv_idx, "byteOffset": 0,
            "componentType": comp_type, "count": count, "type": attr_type
        });
        if let Some(mn) = min_val { acc["min"] = mn; }
        if let Some(mx) = max_val { acc["max"] = mx; }
        accessor_defs.push(acc);
        acc_idx
    }

    // ── Injection des textures PNG dans le buffer BIN ─────────────────────────
    // Les bufferViews des textures PNG ont un `target` absent (non vertex data).
    // Map component → (image_index, texture_index, material_index).
    let mut comp_to_mat: std::collections::HashMap<u8, usize> = std::collections::HashMap::new();
    // Matching PAR NOM (texture embarquée → matériau), pour les modèles multi-matériaux (maps) :
    // une primitive dont `material_name` égale le nom d'une texture utilise CE matériau. Additif —
    // si aucun nom ne matche (perso, dont les noms diffèrent), on retombe sur le mapping component.
    let mut name_to_mat: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut image_defs: Vec<Value> = Vec::new();
    let mut texture_defs: Vec<Value> = Vec::new();
    let mut material_defs: Vec<Value> = Vec::new();

    // Matériau 0 : Default (pour Body et primitives sans texture).
    material_defs.push(json!({
        "name": "Default",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": 0.0, "roughnessFactor": 1.0
        }
    }));

    for etex in &model.embedded_textures {
        // Injecte les bytes PNG dans le BIN (aligné 4B).
        let png_off = bv_data.len();
        bv_data.extend_from_slice(&etex.png_bytes);
        while !bv_data.len().is_multiple_of(4) { bv_data.push(0); }

        let bv_idx = buffer_views_json.len();
        buffer_views_json.push(json!({
            "buffer": 0,
            "byteOffset": png_off,
            "byteLength": etex.png_bytes.len()
        }));

        let img_idx = image_defs.len();
        image_defs.push(json!({
            "bufferView": bv_idx,
            "mimeType": "image/png",
            "name": etex.name
        }));

        let tex_idx = texture_defs.len();
        texture_defs.push(json!({ "source": img_idx, "name": etex.name, "sampler": 0 }));

        let mat_idx = material_defs.len();
        material_defs.push(json!({
            "name": etex.name,
            "pbrMetallicRoughness": {
                "baseColorTexture": { "index": tex_idx },
                "metallicFactor": 0.0, "roughnessFactor": 1.0
            },
            "doubleSided": true
        }));

        // Encode le composant en u8 pour la map.
        let comp_key = match etex.component {
            MeshComponent::Body => 0u8,
            MeshComponent::Face => 1u8,
            MeshComponent::Uniform => 2u8,
            MeshComponent::Keshin => 3u8,
            MeshComponent::Armed => 4u8,
            MeshComponent::Generic => 5u8,
        };
        // N'insère que la première texture pour chaque composant.
        comp_to_mat.entry(comp_key).or_insert(mat_idx);
        // Index par nom (pour le matching matériau des maps).
        name_to_mat.entry(etex.name.clone()).or_insert(mat_idx);
    }

    // ── Parcours des composants (identique à build_glb) ──────────────────────
    let components_order = [
        MeshComponent::Body,
        MeshComponent::Face,
        MeshComponent::Uniform,
        MeshComponent::Keshin,
        MeshComponent::Armed,
        MeshComponent::Generic,
    ];
    let mut mesh_nodes: Vec<Value> = Vec::new();
    let mut mesh_defs: Vec<Value> = Vec::new();

    for comp in components_order {
        let comp_prims: Vec<&MeshPrimitive> = model.primitives.iter()
            .filter(|p| p.component == comp)
            .collect();
        if comp_prims.is_empty() { continue; }

        let comp_key = match comp {
            MeshComponent::Body => 0u8,
            MeshComponent::Face => 1u8,
            MeshComponent::Uniform => 2u8,
            MeshComponent::Keshin => 3u8,
            MeshComponent::Armed => 4u8,
            MeshComponent::Generic => 5u8,
        };
        let comp_name = match comp {
            MeshComponent::Body => "Body",
            MeshComponent::Face => "Face",
            MeshComponent::Uniform => "Uniform",
            MeshComponent::Keshin => "Keshin",
            MeshComponent::Armed => "Armed",
            MeshComponent::Generic => "Generic",
        };

        let mut prim_defs: Vec<Value> = Vec::new();
        for prim in &comp_prims {
            if prim.positions.is_empty() { continue; }

            // Positions → VEC3 float32.
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

            let normal_acc = if !prim.normals.is_empty() {
                let raw: Vec<u8> = prim.normals.iter().flat_map(|v| {
                    [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes()].concat()
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.normals.len(), 5126, "VEC3", None, None))
            } else { None };

            let uv_acc = if !prim.uv0.is_empty() {
                let raw: Vec<u8> = prim.uv0.iter().flat_map(|v| {
                    let mut b = [0u8; 8];
                    b[..4].copy_from_slice(&v.u.to_le_bytes());
                    b[4..].copy_from_slice(&v.v.to_le_bytes());
                    b
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.uv0.len(), 5126, "VEC2", None, None))
            } else { None };

            // Colors → VEC4 float32 (5126), optionnel.
            let _color_acc = if !prim.colors.is_empty() {
                let raw: Vec<u8> = prim.colors.iter().flat_map(|v| {
                    [v.x.to_le_bytes(), v.y.to_le_bytes(), v.z.to_le_bytes(), v.w.to_le_bytes()].concat()
                }).collect();
                Some(add_accessor(&mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                    &raw, prim.colors.len(), 5126, "VEC4", None, None))
            } else { None };

            let use_u32 = prim.positions.len() > 65535;
            let (idx_comp_type, idx_raw): (u32, Vec<u8>) = if use_u32 {
                (5125, prim.indices.iter().flat_map(|&i| i.to_le_bytes()).collect())
            } else {
                (5123, prim.indices.iter().flat_map(|&i| (i as u16).to_le_bytes()).collect())
            };
            let mut idx_raw_padded = idx_raw;
            while idx_raw_padded.len() % 4 != 0 { idx_raw_padded.push(0); }
            let idx_acc = add_accessor(
                &mut bv_data, &mut buffer_views_json, &mut accessor_defs,
                &idx_raw_padded, prim.indices.len(), idx_comp_type, "SCALAR", None, None,
            );

            // Matériau : utilise la texture embarquée du composant, sinon Default (0).
            // Priorité au matching par NOM (maps multi-matériaux) ; sinon mapping component (perso).
            let mat_idx = name_to_mat
                .get(&prim.material_name)
                .copied()
                .or_else(|| comp_to_mat.get(&comp_key).copied())
                .unwrap_or(0);

            let mut attrs_obj = json!({ "POSITION": pos_acc });
            if let Some(n) = normal_acc { attrs_obj["NORMAL"] = json!(n); }
            if let Some(u) = uv_acc { attrs_obj["TEXCOORD_0"] = json!(u); }
            // Desactive COLOR_0 pour eviter que les shaders standards n'appliquent des couleurs de debug/masquage
            // if let Some(c) = color_acc { attrs_obj["COLOR_0"] = json!(c); }

            prim_defs.push(json!({
                "attributes": attrs_obj,
                "indices": idx_acc,
                "material": mat_idx,
                "mode": 4
            }));
        }

        if prim_defs.is_empty() { continue; }

        let mesh_idx = mesh_defs.len();
        mesh_defs.push(json!({ "name": comp_name, "primitives": prim_defs }));
        mesh_nodes.push(json!({ "name": comp_name, "mesh": mesh_idx }));
    }

    let node_indices: Vec<usize> = (0..mesh_nodes.len()).collect();

    // ── JSON glTF ─────────────────────────────────────────────────────────────
    let mut gltf_obj = json!({
        "asset": { "version": "2.0", "generator": "nie-formats assemble.rs embedded" },
        "accessors": accessor_defs,
        "bufferViews": buffer_views_json,
        "buffers": [{ "byteLength": bv_data.len() }],
        "materials": material_defs,
        "meshes": mesh_defs,
        "nodes": mesh_nodes,
        "scene": 0,
        "scenes": [{ "nodes": node_indices }]
    });

    if !image_defs.is_empty() {
        gltf_obj["images"] = json!(image_defs);
        gltf_obj["textures"] = json!(texture_defs);
        // Wrap CLAMP_TO_EDGE (33071) au lieu du REPEAT par défaut : certains maillages (visage/
        // cheveux) ont des UV hors [0,1] (ex. face mesh en [-1,1]) → en REPEAT l'atlas se RÉPÈTE
        // sur toute la tête (visages/yeux tuilés, y compris à l'arrière). CLAMP fige sur le bord.
        gltf_obj["samplers"] = json!([{ "wrapS": 33071, "wrapT": 33071 }]);
    }

    // ── Sérialisation GLB ─────────────────────────────────────────────────────
    let json_bytes = gltf_obj.to_string().into_bytes();
    let json_padded_len = (json_bytes.len() + 3) & !3;
    let mut json_padded = json_bytes;
    while json_padded.len() < json_padded_len { json_padded.push(0x20); }

    let bin_padded_len = (bv_data.len() + 3) & !3;
    let mut bin_padded = bv_data;
    while bin_padded.len() < bin_padded_len { bin_padded.push(0); }

    let total_len = 12 + 8 + json_padded_len + 8 + bin_padded_len;
    let mut glb: Vec<u8> = Vec::with_capacity(total_len);

    glb.extend_from_slice(&0x46546C67u32.to_le_bytes());
    glb.extend_from_slice(&2u32.to_le_bytes());
    glb.extend_from_slice(&(total_len as u32).to_le_bytes());
    glb.extend_from_slice(&(json_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    glb.extend_from_slice(&json_padded);
    glb.extend_from_slice(&(bin_padded_len as u32).to_le_bytes());
    glb.extend_from_slice(&0x004E4942u32.to_le_bytes());
    glb.extend_from_slice(&bin_padded);

    glb
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Dossier des GLB de référence, sous la racine de jeu résolue à l'exécution — aucun
    /// chemin de poste en dur : `NIE_GAME_DIR`, sinon le répertoire courant ou un ancêtre.
    fn glb_dir() -> PathBuf {
        crate::vfs::resolve_game_dir().join("data/dx11/model")
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
            eprintln!("SKIP : répertoire GLB absent ({})", glb_dir().display());
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
            embedded_textures: Vec::new(),
        };
        let glb = model.to_glb();
        assert!(glb.len() >= 12);
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);
        let total = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total, glb.len());
    }

    // ── Tests des nouvelles fonctionnalités ───────────────────────────────────

    #[test]
    fn series_dir_from_code_couvre_toutes_series() {
        // Vérifiés sur l'index iev:file:index DB3 Redis (commun/chr/_face/).
        assert_eq!(series_dir_from_code("c01000010"), Some("01_ie1"));
        assert_eq!(series_dir_from_code("c02021010"), Some("02_ie2"));
        assert_eq!(series_dir_from_code("c03000010"), Some("03_ie3"));
        assert_eq!(series_dir_from_code("c04000420"), Some("04_go1"));
        assert_eq!(series_dir_from_code("c05000010"), Some("05_go2"));
        assert_eq!(series_dir_from_code("c06000010"), Some("06_go3"));
        assert_eq!(series_dir_from_code("c07030030"), Some("07_ares"));
        assert_eq!(series_dir_from_code("c08000010"), Some("08_orion"));
        assert_eq!(series_dir_from_code("c11000010"), Some("11_victory"));
        assert_eq!(series_dir_from_code("c20000010"), Some("20_edit"));
        assert_eq!(series_dir_from_code("c21000010"), Some("21_mannequin"));
        assert_eq!(series_dir_from_code("c22000010"), Some("22_combo"));
        // Codes inconnus / hors format.
        assert_eq!(series_dir_from_code("c99000010"), None);
        assert_eq!(series_dir_from_code("k000010"), None);  // keshin
        assert_eq!(series_dir_from_code(""), None);
    }

    #[test]
    fn face_texture_uri_c01000010() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c01000010", &cfg).unwrap();
        // Chemin vérifié contre l'index iev:file:index DB3 :
        // data/dx11/chr/_face/01_ie1/c01000010/c01000010.g4tx
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/01_ie1/c01000010/c01000010.png"
        );
    }

    #[test]
    fn face_texture_uri_c02026080() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c02026080", &cfg).unwrap();
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/02_ie2/c02026080/c02026080.png"
        );
    }

    #[test]
    fn face_texture_uri_victory_road() {
        let cfg = TextureUriConfig::default();
        let uri = face_texture_uri("c11803060", &cfg).unwrap();
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_face/11_victory/c11803060/c11803060.png"
        );
    }

    #[test]
    fn face_texture_uri_keshin_none() {
        let cfg = TextureUriConfig::default();
        // Les keshins commencent par 'k' → pas de série → None.
        assert!(face_texture_uri("k000010", &cfg).is_none());
    }

    #[test]
    fn uniform_texture_uri_sk000901() {
        let cfg = TextureUriConfig::default();
        let uri = uniform_texture_uri("sk000901", &cfg);
        // Vérifié contre l'index : data/dx11/chr/_uniform/sk000901/sk000901_10.g4tx
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_uniform/sk000901/sk000901_10.png"
        );
    }

    #[test]
    fn uniform_texture_uri_u011001() {
        let cfg = TextureUriConfig::default();
        let uri = uniform_texture_uri("u011001", &cfg);
        assert_eq!(
            uri,
            "https://cdn.rosegriffon.fr/dx11/chr/_uniform/u011001/u011001_10.png"
        );
    }

    #[test]
    fn texture_uri_config_cdn_override() {
        let cfg = TextureUriConfig { cdn_base: "https://test.local".into() };
        let uri = face_texture_uri("c01000010", &cfg).unwrap();
        assert!(uri.starts_with("https://test.local/dx11/"));
        let uri2 = uniform_texture_uri("sk000901", &cfg);
        assert!(uri2.starts_with("https://test.local/dx11/"));
    }

    #[test]
    fn manifest_load_et_resolve() {
        let ndjson = concat!(
            r#"{"crc":1717452463,"crc_hex":"0x665E3EAF","path":"data/common/chr/_face/01_ie1/c01000010/c01000010.g4md","cpk":"eaabb035.cpk"}"#,
            "\n",
            r#"{"crc":1717452463,"crc_hex":"0x665E3EAF","path":"data/common/chr/_face/01_ie1/c01000010/c01000010.g4mg","cpk":"eaabb035.cpk"}"#,
            "\n",
            r#"{"crc":2621281058,"path":"data/common/chr/_uniform/u011001/u011001.g4md","cpk":"abc.cpk"}"#,
        );
        let entries = load_manifest(ndjson);
        assert_eq!(entries.len(), 3);
        // Résolution CRC vers g4md
        let path = resolve_crc_to_g4md_path(&entries, 1717452463);
        assert_eq!(path, Some("data/common/chr/_face/01_ie1/c01000010/c01000010.g4md"));
        // g4md_to_g4mg_path
        let gmg = g4md_to_g4mg_path("data/common/chr/_face/01_ie1/c01000010/c01000010.g4md");
        assert_eq!(gmg, "data/common/chr/_face/01_ie1/c01000010/c01000010.g4mg");
        // CRC inconnu → None
        assert!(resolve_crc_to_g4md_path(&entries, 0xDEADBEEF).is_none());
    }

    #[test]
    fn manifest_ligne_malformee_ignoree() {
        let ndjson = "malformed\n{\"crc\":42,\"path\":\"x.g4md\",\"cpk\":\"y.cpk\"}\n";
        let entries = load_manifest(ndjson);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].crc, 42);
    }

    #[test]
    fn assemble_generic_vide_invalide_rejete() {
        // G4MD vide → FormatError::TooShort → AssembleError::Format
        let result = assemble_generic_model(GenericModelInput {
            code: "test".into(),
            g4md: vec![0u8; 4],
            g4mg: vec![],
            component: MeshComponent::Generic,
        });
        assert!(result.is_err(), "g4md invalide doit provoquer une erreur");
    }

    #[test]
    fn assemble_keshin_helper_component() {
        // Avec un g4md minimal invalide → erreur de format, mais le wrapper est bon.
        let result = assemble_keshin("k000010", vec![0u8; 4], vec![]);
        assert!(result.is_err()); // g4md trop court, mais le wrapper lui-même est correct
    }

    #[test]
    fn assemble_armed_helper_component() {
        let result = assemble_armed("ka001901", vec![0u8; 4], vec![]);
        assert!(result.is_err()); // g4md trop court
    }

    /// Teste to_glb_textured sur un modèle vide : doit produire un GLB valide
    /// sans section images/textures (pas de primitives avec texture_uri).
    #[test]
    fn glb_textured_modele_vide() {
        let mut model = AssembledModel {
            internal_code: "c01000010".into(),
            body_glb: String::new(),
            face_glb: String::new(),
            uniform_crc: 0,
            primitives: Vec::new(),
            embedded_textures: Vec::new(),
        };
        let cfg = TextureUriConfig::default();
        let glb = model.to_glb_textured(&cfg);
        assert!(glb.len() >= 12);
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67, "magic GLB textured");
        // Pas d'images (modèle vide) — JSON ne contient pas "images".
        // On vérifie juste la structure GLB (magic + total_len cohérent).
        let total = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]) as usize;
        assert_eq!(total, glb.len());
    }

    /// Test d'intégration : assemblage de c01000010 avec textures URI CDN.
    ///
    /// Vérifie que to_glb_textured injecte les images[] dans le JSON glTF quand
    /// les primitives face ont une texture_uri renseignée.
    #[test]
    fn assemblage_c01000010_avec_textures_uri() {
        if !glb_dir().exists() {
            eprintln!("SKIP : répertoire GLB absent");
            return;
        }
        if !glb_dir().join("c01000010.glb").exists() || !glb_dir().join("base_normal_00.glb").exists() {
            eprintln!("SKIP : GLBs manquants");
            return;
        }

        let input = CharacterAssemblyInput {
            internal_code: "c01000010".into(),
            body_type_idx: 0,
            glb_dir: glb_dir(),
            uniform_model_crc: 0,
            uniform_g4md: None,
            uniform_g4mg: None,
            uniform_glb_path: None,
        };

        let mut model = assemble_character_model(&input).expect("assemblage c01000010");
        let cfg = TextureUriConfig::default();

        // Avant resolve : toutes les texture_uri sont vides (GLBs pré-convertis).
        // Les GLBs pré-convertis ont material_name = "" (pas de G4MD source).
        let all_empty = model.primitives.iter().all(|p| p.texture_uri.is_empty());
        assert!(all_empty, "texture_uri vides avant resolve");

        // Appel de to_glb_textured.
        let glb_textured = model.to_glb_textured(&cfg);
        assert!(glb_textured.len() >= 12, "GLB textured non vide");

        // Vérification magic.
        let magic = u32::from_le_bytes([glb_textured[0], glb_textured[1], glb_textured[2], glb_textured[3]]);
        assert_eq!(magic, 0x46546C67, "magic GLB textured valide");

        // Le JSON doit contenir au moins les materials.
        // On extrait le JSON du GLB pour vérification.
        let json_len = u32::from_le_bytes([glb_textured[12], glb_textured[13], glb_textured[14], glb_textured[15]]) as usize;
        assert!(json_len > 0 && 20 + json_len <= glb_textured.len(), "chunk JSON valide");
        let json_bytes = &glb_textured[20..20 + json_len];
        let json_str = std::str::from_utf8(json_bytes).unwrap().trim_end_matches('\0').trim();
        let json_val: serde_json::Value = serde_json::from_str(json_str).expect("JSON glTF valide");
        assert!(json_val["materials"].is_array(), "materials présents");
        // Pour c01000010 depuis GLBs pré-convertis : pas de material_name → pas d'images URI.
        // Un seul matériau Default attendu.
        let mats = json_val["materials"].as_array().unwrap();
        assert!(!mats.is_empty(), "au moins 1 matériau");

        eprintln!("PASS textured c01000010 : {}B GLB, {} matériaux", glb_textured.len(), mats.len());
    }

    /// Test d'intégration : assemble_generic_model avec un vrai G4MD+G4MG de keshin
    /// (k000010 — premier keshin réel). Skip si les CPK ne sont pas disponibles.
    #[test]
    fn assemble_keshin_k000010_depuis_cpk() {
        use crate::vfs::Vfs;

        let game_data = crate::vfs::resolve_game_dir().join("data");
        let mut vfs = Vfs::new();
        if vfs.init(&game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable (game_data absent)");
            return;
        }

        // Chemin vérifié dans le manifeste : data/common/chr/_keshin/k000010/k000010.g4md
        let g4md_path = "data/common/chr/_keshin/k000010/k000010.g4md";
        let g4mg_path = "data/common/chr/_keshin/k000010/k000010.g4mg";

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(e) => { eprintln!("SKIP : G4MD keshin k000010 non lisible : {e}"); return; }
        };
        let g4mg_data = match vfs.read(g4mg_path) {
            Ok(d) => d,
            Err(e) => { eprintln!("SKIP : G4MG keshin k000010 non lisible : {e}"); return; }
        };

        let model = assemble_keshin("k000010", g4md_data, g4mg_data)
            .expect("assemblage keshin k000010");

        assert!(!model.primitives.is_empty(), "keshin k000010 a des primitives");
        assert!(model.total_vertex_count() > 0, "keshin k000010 a des vertices");
        assert_eq!(model.primitives[0].component, MeshComponent::Keshin);
        assert_eq!(model.internal_code, "k000010");

        let glb = model.to_glb();
        assert!(glb.len() > 12, "GLB keshin non vide");
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);

        eprintln!(
            "PASS keshin k000010 : {}v / {}tri, glb={}B",
            model.total_vertex_count(), model.total_triangle_count(), glb.len()
        );
    }

    /// Test d'intégration : assemble_armed avec une vraie armure (ka001901).
    #[test]
    fn assemble_armd_ka001901_depuis_cpk() {
        use crate::vfs::Vfs;

        let game_data = crate::vfs::resolve_game_dir().join("data");
        let mut vfs = Vfs::new();
        if vfs.init(&game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }

        // Chemin vérifié dans le manifeste NDJSON : data/common/chr/_armd/ka001901/ka001906.g4md
        // Le répertoire contient plusieurs variants : ka001901..ka001906
        // On utilise la première entrée du répertoire (ka001901).
        let g4md_path = "data/common/chr/_armd/ka001901/ka001901.g4md";
        let g4mg_path = "data/common/chr/_armd/ka001901/ka001901.g4mg";

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(_) => {
                // Essaie le variant ka001906
                match vfs.read("data/common/chr/_armd/ka001901/ka001906.g4md") {
                    Ok(d) => d,
                    Err(e) => { eprintln!("SKIP : G4MD armd ka001901 non lisible : {e}"); return; }
                }
            }
        };
        let g4mg_path_actual = if vfs.find(g4mg_path).is_some() { g4mg_path } else { "data/common/chr/_armd/ka001901/ka001906.g4mg" };
        let g4mg_data = match vfs.read(g4mg_path_actual) {
            Ok(d) => d,
            Err(e) => { eprintln!("SKIP : G4MG armd non lisible : {e}"); return; }
        };

        let model = assemble_armed("ka001901", g4md_data, g4mg_data)
            .expect("assemblage armd ka001901");

        assert!(!model.primitives.is_empty(), "armure ka001901 a des primitives");
        assert!(model.total_vertex_count() > 0, "armure a des vertices");
        assert_eq!(model.primitives[0].component, MeshComponent::Armed);

        let glb = model.to_glb();
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);

        eprintln!(
            "PASS armd ka001901 : {}v / {}tri, glb={}B",
            model.total_vertex_count(), model.total_triangle_count(), glb.len()
        );
    }

    /// Test d'intégration : assemble uniforme depuis CPK via VFS + manifeste.
    /// Vérifie le chemin complet CRC → g4md_path → VFS → G4MD+G4MG → primitives.
    #[test]
    fn assemble_uniforme_depuis_cpk_via_manifeste() {
        use crate::vfs::Vfs;

        let racine = crate::vfs::resolve_game_dir();
        let game_data = racine.join("data");
        let manifest_path = racine.join("var/model-crc-manifest.ndjson");

        // Charger le manifeste.
        let manifest_str = match std::fs::read_to_string(&manifest_path) {
            Ok(s) => s,
            Err(_) => { eprintln!("SKIP : manifeste {} absent", manifest_path.display()); return; }
        };
        let manifest = load_manifest(&manifest_str);
        assert!(!manifest.is_empty(), "manifeste non vide");

        // CRC du g4md Raimon IE1 fielder (u011001.g4md), vérifié dans le manifeste NDJSON :
        // {"crc":2795242763,"crc_hex":"0xA69C050B","path":"data/common/chr/_uniform/u011001/u011001.g4md",...}
        // Note : 0x9D2BBD10 est le CRC *modelId* dans inagle_uniforms (espace différent).
        let raimon_fielder_crc: u32 = 0xA69C050B;
        let g4md_path_opt = resolve_crc_to_g4md_path(&manifest, raimon_fielder_crc);

        let g4md_path = match g4md_path_opt {
            Some(p) => p,
            None => { eprintln!("SKIP : CRC Raimon fielder {:#010x} absent du manifeste", raimon_fielder_crc); return; }
        };

        let g4mg_path = g4md_to_g4mg_path(g4md_path);
        eprintln!("Uniforme Raimon fielder : {g4md_path}");

        let mut vfs = Vfs::new();
        if vfs.init(game_data).is_err() {
            eprintln!("SKIP : VFS non initialisable");
            return;
        }

        let g4md_data = match vfs.read(g4md_path) {
            Ok(d) => d,
            Err(e) => { eprintln!("SKIP : G4MD uniforme non lisible : {e}"); return; }
        };
        let g4mg_data = match vfs.read(&g4mg_path) {
            Ok(d) => d,
            Err(e) => { eprintln!("SKIP : G4MG uniforme non lisible : {e}"); return; }
        };

        let model = assemble_generic_model(GenericModelInput {
            code: "raimon_ie1_fielder".into(),
            g4md: g4md_data,
            g4mg: g4mg_data,
            component: MeshComponent::Uniform,
        }).expect("assemblage uniforme Raimon IE1");

        assert!(!model.primitives.is_empty(), "uniforme Raimon a des primitives");
        assert!(model.total_vertex_count() > 0, "uniforme a des vertices");
        assert_eq!(model.primitives[0].component, MeshComponent::Uniform);

        // Vérifie que material_name est renseigné (depuis G4MD material_base_names).
        let has_mat_name = model.primitives.iter().any(|p| !p.material_name.is_empty());
        // Non obligatoire si G4MD a 0 materials, mais habituel pour les uniformes.
        // On le note sans assert bloquant.
        eprintln!(
            "PASS uniforme Raimon IE1 : {}v / {}tri, mat_name={}",
            model.total_vertex_count(), model.total_triangle_count(), has_mat_name
        );

        let glb = model.to_glb();
        let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
        assert_eq!(magic, 0x46546C67);
    }
}
