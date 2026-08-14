//! Parseur de fichiers `.objbin` (OBJB — définitions d'objets-menu IEVR).
//!
//! Port Rust fidèle de `IECODE.Core/Formats/Menu/ObjbParser.cs` (790 lignes).
//!
//! ## Format
//!
//! Un `.objbin` est un conteneur T2B Level-5 auto-contenu (identique à `cfg.bin`) :
//!
//! ```text
//! Offset  Taille  Champ
//!  0x00     4     entry_count     (i32 LE)
//!  0x04     4     str_table_off   (i32 LE, offset absolu de la string table)
//!  0x08     4     str_table_len   (i32 LE, longueur de la string table)
//!  0x0C     4     str_table_count (i32 LE, non utilisé par le parseur)
//!  0x10    ...    zone d'entrées  [0x10 .. str_table_off)
//!  ...     ...    string table    [str_table_off .. str_table_off + str_table_len)
//!  ...     ...    key table       (alignée 16 octets après la string table)
//!  ...      4     pied de page    01 74 32 62
//! ```
//!
//! Chaque entrée = u32 CRC + u8 paramCount + ⌈paramCount/4⌉ type-bytes (2 bits/param :
//! 0=String, 1=Int, 2=Float, 3=Unknown) + alignement à 4 octets + paramCount×i32 valeurs.
//!
//! ## Arbre sémantique
//!
//! ```text
//! OBJ_BGN("name")
//!   SETUP_BGN("gmdMenuObj")
//!     SETUP_PARAM("SkeletonAnime", "path/to.g4pkm")
//!     SETUP_PARAM("Texture",       "#/path/<LG>/file.g4tx")
//!   SETUP_END
//!   PROP_INFO_BGN("CMenuRenderComponent")
//!     PROP_PARAM("m_drawPriority", int)
//!     …
//!   PROP_INFO_END
//!   …
//! OBJ_END
//! ```
//!
//! Compatible `no_std + alloc`.

extern crate alloc;
use alloc::{
    collections::BTreeMap,
    string::String,
    vec::Vec,
};

use crate::FormatError;

// ── Constantes CRC-32 des records connus ────────────────────────────────────

const CRC_OBJ_BGN: u32       = 0xB1D0_C26E;
const CRC_SETUP_BGN: u32     = 0xB14D_CDB0;
const CRC_SETUP_PARAM: u32   = 0x8BB1_3144;
const CRC_SETUP_END: u32     = 0x8515_8962;
const CRC_PROP_INFO_BGN: u32 = 0x6899_52A2;
const CRC_PROP_PARAM: u32    = 0xBD06_4D3E;
const CRC_PROP_INFO_END: u32 = 0x5CC1_1670;
const CRC_PROP_PARAM_BGN: u32 = 0x6454_D5A5;
const CRC_PROP_PARAM_END: u32 = 0x500C_9177;
const CRC_OBJ_END: u32       = 0x8588_86BC;

// ── Modèles publics ──────────────────────────────────────────────────────────

/// Objet de menu parsé depuis un fichier `.objbin`.
/// Chaque fichier contient exactement un objet racine.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MenuObject {
    /// Nom de l'objet (paramètre de `OBJ_BGN`, ex. `"title00_09_version"`).
    pub name: String,
    /// Type moteur (`SETUP_BGN`, toujours `"gmdMenuObj"` dans IEVR).
    pub engine_type: String,
    /// Référence au paquet d'animation 3D (`.g4pkm`) — chemin logique relatif.
    pub g4pkm_path: Option<String>,
    /// Chemin logique de la texture principale (`.g4tx`, avec `<LG>` pour la locale).
    pub g4tx_path: Option<String>,
    /// Composants attachés à l'objet (un par `PROP_INFO_BGN…PROP_INFO_END`).
    pub components: Vec<MenuComponent>,
}

/// Composant de menu — enum idomatique remplaçant la hiérarchie de classes C#.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub enum MenuComponent {
    /// `CMenuRenderComponent` — rendu (z-order, mode, caméra).
    Render(RenderComponent),
    /// `CMenuAnimation` — animations d'ouverture / fermeture / sélection.
    Animation(AnimationComponent),
    /// `MenuTextSetting` — clés de texte localisées.
    Text(TextComponent),
    /// `CMenuCreatePrimitiveComponent` — primitives graphiques (jauges…).
    Primitive(PrimitiveComponent),
    /// `CMenuAttachLocator` — points d'attache (null layers).
    AttachLocator(AttachLocatorComponent),
    /// `MenuCollisionSetting` — zones de collision tactile.
    Collision(CollisionComponent),
    /// `CMenuSoundCmdProperty` — commandes sonores associées à l'objet.
    SoundCmd(SoundCmdComponent),
    /// `CSetupMeshVisible` — visibilité de meshes nommés par CRC.
    MeshVisible(MeshVisibleComponent),
    /// Composant générique pour les types RTTI non reconnus.
    Unknown(UnknownComponent),
}

/// `CMenuRenderComponent` — rendu (z-order, mode de dessin, caméra).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct RenderComponent {
    /// Nom RTTI (`"CMenuRenderComponent"`).
    pub type_name: String,
    /// Priorité de dessin (z-order croissant = au-dessus).
    pub draw_priority: i32,
    /// Mode de dessin (0 = normal, 1 = additif, …).
    pub draw_type: i32,
    /// CRC-32 du nom de caméra (ex. `0x02D8_FB06`).
    pub camera_name_hash: u32,
}

/// `CMenuAnimation` — animations d'ouverture / fermeture / sélection.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct AnimationComponent {
    /// Nom RTTI (`"CMenuAnimation"`).
    pub type_name: String,
    /// Hash CRC-32 de la motion d'ouverture (`m_nameMotOpen`).
    pub mot_open_hash: u32,
    /// Hash CRC-32 de la motion de fermeture.
    pub mot_close_hash: u32,
    /// Hash CRC-32 de la motion de sélection.
    pub mot_select_hash: u32,
}

/// `MenuTextSetting` — clés de texte localisées.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct TextComponent {
    /// Nom RTTI (`"MenuTextSetting"`).
    pub type_name: String,
    /// Index / mode de la table texte (paramètre entier de `PROP_INFO_BGN`).
    pub table_index: i32,
    /// Entrées texte : slot nommé + hash(es) CRC-32 de résolution.
    pub entries: Vec<TextEntry>,
}

/// Entrée texte : slot nommé + hash(es) CRC-32.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct TextEntry {
    /// Nom du slot (ex. `"_text_choice01_on"`).
    pub key: String,
    /// Hash(es) de résolution (CRC-32 de la chaîne dans le dictionnaire).
    pub hashes: Vec<u32>,
}

/// `CMenuCreatePrimitiveComponent` — primitives graphiques (rectangles, jauges…).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct PrimitiveComponent {
    /// Nom RTTI (`"CMenuCreatePrimitiveComponent"`).
    pub type_name: String,
    /// Hash(es) de noms de primitives enregistrées (`MenuNumberSettingName`).
    pub number_setting_hashes: Vec<u32>,
    /// Maximums par primitive (`DispMaxValue`) : hash primitif + valeur max.
    pub disp_max_values: Vec<DispMaxEntry>,
}

/// Valeur maximale d'affichage pour une primitive (`DispMaxValue`).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct DispMaxEntry {
    /// Hash CRC-32 de la primitive.
    pub primitive_hash: u32,
    /// Valeur maximale.
    pub max_value: i32,
}

/// `CMenuAttachLocator` — points d'attache (null layers).
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct AttachLocatorComponent {
    /// Nom RTTI (`"CMenuAttachLocator"`).
    pub type_name: String,
    /// Hash(es) CRC-32 du nom de couche null (`NullLayerName`).
    pub null_layer_hashes: Vec<u32>,
}

/// `MenuCollisionSetting` — zones de collision tactile.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct CollisionComponent {
    /// Nom RTTI (`"MenuCollisionSetting"`).
    pub type_name: String,
    /// Mode de collision (0 = standard).
    pub mode: i32,
    /// Entrées de collision : nom de touch + paramètres.
    pub entries: Vec<CollisionEntry>,
}

/// Entrée de collision tactile.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct CollisionEntry {
    /// Nom du touch.
    pub key: String,
    /// Activé (0 = non, 1 = oui).
    pub enabled: i32,
    /// Type de collision.
    pub kind: i32,
    /// Paramètre supplémentaire.
    pub extra: i32,
}

/// `CMenuSoundCmdProperty` — commandes sonores associées à l'objet.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct SoundCmdComponent {
    /// Nom RTTI (`"CMenuSoundCmdProperty"`).
    pub type_name: String,
    /// Entrées son : commande nommée + paramètre entier.
    pub entries: Vec<SoundCmdEntry>,
}

/// Entrée son : commande nommée + paramètre entier.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct SoundCmdEntry {
    /// Nom de la commande sonore.
    pub command: String,
    /// Paramètre entier.
    pub param: i32,
}

/// `CSetupMeshVisible` — visibilité de meshes nommés par CRC.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MeshVisibleComponent {
    /// Nom RTTI (`"CSetupMeshVisible"`).
    pub type_name: String,
    /// Entrées de visibilité : hash du mesh → booléen visible.
    pub params: Vec<MeshVisibleEntry>,
}

/// Entrée de visibilité de mesh.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MeshVisibleEntry {
    /// CRC-32 du nom du mesh (`meshNameCrc`).
    pub mesh_name_crc: u32,
    /// Visible si `true` (`isVisible`).
    pub is_visible: bool,
}

/// Valeur d'un paramètre de `PROP_PARAM`, avec le type déclaré par l'entrée T2B.
///
/// Les type-bytes de l'entrée (2 bits par paramètre) portent déjà l'information ; la conserver
/// évite de deviner à la lecture qu'un `-1082130432` est en fait `-1.0f`, et surtout de perdre
/// les chaînes — un `m_texPath` est un **chemin de texture**, pas un scalaire.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub enum PropValue {
    /// type-byte `0` — chaîne résolue depuis la string table (chaîne vide si l'offset est `-1`).
    Str(String),
    /// type-byte `1` ou `3` — entier signé, ou hash CRC-32 réinterprété par l'appelant.
    Int(i32),
    /// type-byte `2` — flottant (bits de l'`i32` réinterprétés).
    Float(f32),
}

/// Composant générique pour les types RTTI non reconnus.
///
/// Ces composants portent l'essentiel de l'UI : **106 des 114 types** du corpus menu tombent
/// ici (2844 occurrences sur 3179 objbin), dont `CMenuCaptionInfoProperty` (1311),
/// `CMenuIconSwapComponent` (439) et `MenuAnchorComponent` (209). Leurs paramètres sont donc
/// préservés **typés** : les réduire à des entiers jetait silencieusement toutes les chaînes,
/// c.-à-d. les chemins d'asset que ces composants référencent.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct UnknownComponent {
    /// Nom RTTI du composant (ex. `"CMenuScrollMaskComponent"`).
    pub type_name: String,
    /// Paramètres : `(clé, valeurs typées)`, la clé exclue des valeurs.
    pub params: Vec<(String, Vec<PropValue>)>,
}

impl UnknownComponent {
    /// Valeurs du paramètre `key`, ou `None` s'il est absent.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<&[PropValue]> {
        self.params.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }

    /// Première valeur de `key` si c'est une chaîne **non vide** — le cas utile pour les
    /// paramètres qui référencent un asset (`m_texPath`, chemins de modèle…).
    #[must_use]
    pub fn str_param(&self, key: &str) -> Option<&str> {
        match self.get(key)?.first()? {
            PropValue::Str(s) if !s.is_empty() => Some(s.as_str()),
            _ => None,
        }
    }

    /// Toutes les chaînes non vides portées par ce composant, quel que soit le paramètre.
    /// C'est ce qui permet de rattacher un composant non typé à ses assets sans connaître sa
    /// sémantique champ par champ.
    pub fn strings(&self) -> impl Iterator<Item = &str> {
        self.params.iter().flat_map(|(_, vals)| {
            vals.iter().filter_map(|v| match v {
                PropValue::Str(s) if !s.is_empty() => Some(s.as_str()),
                _ => None,
            })
        })
    }
}

// ── Structure interne : entrée brute T2B ─────────────────────────────────────

/// Entrée brute parsée depuis la zone d'entrées T2B.
///
/// - `param_types[j]` : 0 = String, 1 = Int, 2 = Float, 3 = Unknown.
/// - `str_params[j]`  : `Some(s)` si type == 0 et résolution réussie, `None` sinon.
/// - `int_params[j]`  : valeur brute i32 si type != 0, `0` sinon (ignoré).
struct RawEntry {
    crc: u32,
    param_types: Vec<u8>,
    str_params: Vec<Option<String>>,
    int_params: Vec<i32>,
}

// ── API publique ─────────────────────────────────────────────────────────────

/// Vérifie rapidement si un tampon est un fichier `.objbin` valide.
///
/// Recherche le pied de page cfg.bin `01 74 32 62` dans les 32 derniers octets.
pub fn is_objb(data: &[u8]) -> bool {
    if data.len() < 16 {
        return false;
    }
    let search_start = data.len().saturating_sub(32);
    let last_possible = data.len() - 4;
    for i in search_start..=last_possible {
        if data[i] == 0x01
            && data[i + 1] == 0x74
            && data[i + 2] == 0x32
            && data[i + 3] == 0x62
        {
            return true;
        }
    }
    false
}

/// Parse un fichier `.objbin` depuis un tampon d'octets.
///
/// Retourne `Err(FormatError::Corrupt(...))` si le fichier est invalide ou corrompu.
///
/// # Exemple
///
/// ```no_run
/// # fn main() -> Result<(), nie_formats::FormatError> {
/// let data = std::fs::read("menu/title00_09_version.objbin").unwrap();
/// let obj = nie_formats::objbin::parse(&data)?;
/// println!("{} — {}", obj.name, obj.engine_type);
/// # Ok(()) }
/// ```
pub fn parse(data: &[u8]) -> Result<MenuObject, FormatError> {
    if data.len() < 16 {
        return Err(FormatError::Corrupt("objbin : fichier trop petit (< 16 octets)"));
    }
    if !is_objb(data) {
        return Err(FormatError::Corrupt("objbin : pied de page cfg.bin absent"));
    }

    // En-tête : 4 × i32 LE
    let entry_count = i32::from_le_bytes(data[0..4].try_into().unwrap());
    let str_table_off_i = i32::from_le_bytes(data[4..8].try_into().unwrap());
    let str_table_len_i = i32::from_le_bytes(data[8..12].try_into().unwrap());
    // Champ strTableCount : présent dans le format mais non utilisé par le parseur.
    let _str_table_count = i32::from_le_bytes(data[12..16].try_into().unwrap());

    if entry_count < 0 || str_table_off_i < 0 || str_table_len_i < 0 {
        return Err(FormatError::Corrupt("objbin : en-tête avec valeur négative"));
    }
    let sto = str_table_off_i as usize;
    let stl = str_table_len_i as usize;

    if sto < 0x10 || sto > data.len() {
        return Err(FormatError::Corrupt("objbin : strTableOffset invalide"));
    }
    let ste = sto
        .checked_add(stl)
        .ok_or(FormatError::Corrupt("objbin : overflow strTable offset+length"))?;
    if ste > data.len() {
        return Err(FormatError::Corrupt("objbin : strTable dépasse la fin du fichier"));
    }

    // Table de chaînes : slice [sto .. ste]
    let strings = parse_string_table(&data[sto..ste]);

    // Table de clés : après les chaînes, alignée à 16 octets
    let kt_offset = (ste + 15) & !15usize;
    let key_table = parse_key_table(data, kt_offset);

    // Zone d'entrées : [0x10 .. sto)
    let entries_buf = &data[0x10..sto];
    let entries = parse_entries(entries_buf, entry_count as usize, &strings, &key_table)?;

    build_object(entries)
}

// ── Table de chaînes ─────────────────────────────────────────────────────────

/// Construit la table `offset → chaîne` depuis la slice de la string table T2B.
///
/// Seules les chaînes non vides sont indexées (conforme au comportement C# de référence).
fn parse_string_table(buf: &[u8]) -> BTreeMap<i32, String> {
    let mut result = BTreeMap::new();
    let mut pos = 0usize;
    while pos < buf.len() {
        let start = pos;
        while pos < buf.len() && buf[pos] != 0 {
            pos += 1;
        }
        if pos > start {
            let s = String::from_utf8_lossy(&buf[start..pos]).into_owned();
            result.insert(start as i32, s);
        }
        pos += 1; // saute le null terminateur
    }
    result
}

// ── Table de clés ────────────────────────────────────────────────────────────

/// Construit la table `CRC → nom` depuis la section key table T2B.
///
/// En-tête key table (16 octets) : keyLength, keyCount, keyStringOffset, keyStringLength.
/// Entrées : keyCount × 8 octets (u32 CRC + i32 strOff).
fn parse_key_table(data: &[u8], kt_offset: usize) -> BTreeMap<u32, String> {
    let mut result = BTreeMap::new();
    if kt_offset + 16 > data.len() {
        return result;
    }

    let key_length =
        i32::from_le_bytes(data[kt_offset..kt_offset + 4].try_into().unwrap()) as usize;
    let key_count =
        i32::from_le_bytes(data[kt_offset + 4..kt_offset + 8].try_into().unwrap()) as usize;
    let key_string_offset =
        i32::from_le_bytes(data[kt_offset + 8..kt_offset + 12].try_into().unwrap()) as usize;

    // Vérification de cohérence : la table de clés ne doit pas dépasser les données.
    if key_length == 0 || kt_offset + key_length > data.len() {
        return result;
    }

    let entries_base = kt_offset + 0x10; // après l'en-tête de 16 octets
    let string_base = kt_offset + key_string_offset;

    for i in 0..key_count {
        let pos = entries_base + i * 8;
        if pos + 8 > data.len() {
            break;
        }
        let crc = u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap());
        let str_off =
            i32::from_le_bytes(data[pos + 4..pos + 8].try_into().unwrap()) as usize;
        let str_start = string_base.saturating_add(str_off);
        if str_start >= data.len() {
            continue;
        }
        let nul_pos = data[str_start..]
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(data.len() - str_start);
        let str_end = str_start + nul_pos;
        let s = String::from_utf8_lossy(&data[str_start..str_end]).into_owned();
        result.insert(crc, s);
    }

    result
}

// ── Entrées brutes ───────────────────────────────────────────────────────────

fn parse_entries(
    buf: &[u8],
    count: usize,
    strings: &BTreeMap<i32, String>,
    _key_table: &BTreeMap<u32, String>,
) -> Result<Vec<RawEntry>, FormatError> {
    let mut result = Vec::with_capacity(count);
    let mut pos = 0usize;

    for _ in 0..count {
        if pos + 5 > buf.len() {
            return Err(FormatError::Corrupt("objbin : entrée dépasse le buffer des entrées"));
        }

        let crc = u32::from_le_bytes(buf[pos..pos + 4].try_into().unwrap());
        let param_count = buf[pos + 4] as usize;
        let type_bytes = param_count.div_ceil(4);
        pos += 5;

        // Lecture des bits de type : 2 bits par paramètre, poids faible en premier.
        let mut param_types = vec![0u8; param_count];
        let mut pi = 0usize;
        for _ in 0..type_bytes {
            if pos >= buf.len() {
                return Err(FormatError::Corrupt("objbin : type bytes dépassent le buffer"));
            }
            let tb = buf[pos];
            pos += 1;
            for k in 0..4usize {
                if pi < param_count {
                    param_types[pi] = (tb >> (2 * k)) & 3;
                    pi += 1;
                }
            }
        }

        // Alignement à 4 octets depuis le début du buffer des entrées.
        if !pos.is_multiple_of(4) {
            pos = (pos + 3) & !3usize;
        }

        // Lecture des valeurs (i32 LE × param_count).
        let mut str_params: Vec<Option<String>> = vec![None; param_count];
        let mut int_params: Vec<i32> = vec![0; param_count];

        for j in 0..param_count {
            if pos + 4 > buf.len() {
                return Err(FormatError::Corrupt("objbin : valeur de paramètre dépasse le buffer"));
            }
            let raw = i32::from_le_bytes(buf[pos..pos + 4].try_into().unwrap());
            pos += 4;

            if param_types[j] == 0 {
                // String : raw est l'offset dans la string table ; -1 = null/vide.
                str_params[j] = if raw != -1 {
                    strings.get(&raw).cloned()
                } else {
                    None
                };
            } else {
                // Int, Float ou Unknown : valeur brute.
                int_params[j] = raw;
            }
        }

        result.push(RawEntry { crc, param_types, str_params, int_params });
    }

    Ok(result)
}

// ── Extraction des valeurs entières ─────────────────────────────────────────

/// Extrait les valeurs numériques (non-String) d'une entrée.
///
/// Dans les `PROP_PARAM`, le paramètre 0 est toujours la clé String ; les suivants
/// sont des entiers (hash CRC-32 ou valeurs scalaires).
fn extract_int_values(e: &RawEntry) -> Vec<i32> {
    let mut result = Vec::new();
    for (j, &ty) in e.param_types.iter().enumerate() {
        if ty != 0 {
            result.push(e.int_params[j]);
        }
    }
    result
}

/// Extrait les valeurs d'une entrée `PROP_PARAM` **en préservant leur type**, clé exclue.
///
/// Diffère de [`extract_int_values`], qui écarte *toute* valeur de type String : le paramètre 0
/// est bien la clé, mais les suivants peuvent être des chaînes (chemins d'asset), et celles-là
/// n'ont aucune raison d'être perdues.
fn extract_values(e: &RawEntry) -> Vec<PropValue> {
    let mut result = Vec::new();
    for (j, &ty) in e.param_types.iter().enumerate() {
        // Paramètre 0 = la clé, déjà lue par l'appelant.
        if j == 0 {
            continue;
        }
        result.push(match ty {
            0 => PropValue::Str(e.str_params[j].clone().unwrap_or_default()),
            2 => PropValue::Float(f32::from_bits(e.int_params[j] as u32)),
            _ => PropValue::Int(e.int_params[j]),
        });
    }
    result
}

// ── Construction de l'objet ──────────────────────────────────────────────────

fn build_object(entries: Vec<RawEntry>) -> Result<MenuObject, FormatError> {
    let mut i = 0usize;

    // Tout fichier .objbin valide commence par OBJ_BGN.
    if i >= entries.len() || entries[i].crc != CRC_OBJ_BGN {
        return Err(FormatError::Corrupt("objbin : OBJ_BGN attendu en position 0"));
    }
    let obj_name = entries[i]
        .str_params
        .first()
        .and_then(|s| s.as_deref())
        .unwrap_or("")
        .to_string();
    i += 1;

    // SETUP_BGN … SETUP_END : type moteur + chemins d'assets.
    let mut engine_type = String::new();
    let mut g4pkm_path: Option<String> = None;
    let mut g4tx_path: Option<String> = None;

    if i < entries.len() && entries[i].crc == CRC_SETUP_BGN {
        engine_type = entries[i]
            .str_params
            .first()
            .and_then(|s| s.as_deref())
            .unwrap_or("")
            .to_string();
        i += 1;

        while i < entries.len() && entries[i].crc == CRC_SETUP_PARAM {
            let key = entries[i].str_params.first().and_then(|s| s.as_deref());
            let val = if entries[i].str_params.len() > 1 {
                entries[i].str_params[1].clone()
            } else {
                None
            };
            match key {
                Some("SkeletonAnime") => g4pkm_path = val,
                Some("Texture") => g4tx_path = normalize_g4tx_path(val),
                _ => {}
            }
            i += 1;
        }

        if i < entries.len() && entries[i].crc == CRC_SETUP_END {
            i += 1;
        }
    }

    // PROP_INFO_BGN … PROP_INFO_END (répété pour chaque composant).
    let mut components = Vec::new();

    while i < entries.len() && entries[i].crc != CRC_OBJ_END {
        if entries[i].crc == CRC_PROP_INFO_BGN {
            let comp_type = entries[i]
                .str_params
                .first()
                .and_then(|s| s.as_deref())
                .unwrap_or("")
                .to_string();
            let mode_vals = extract_int_values(&entries[i]);
            let comp_mode = mode_vals.first().copied().unwrap_or(0);
            i += 1;

            let mut raw_props: Vec<(String, Vec<i32>)> = Vec::new();
            // Collecte parallèle typée : les 8 builders spécialisés consomment `raw_props` tel
            // quel (comportement inchangé, au bit près), seuls les composants non reconnus
            // reçoivent la version typée — là où les chaînes étaient perdues.
            let mut typed_props: Vec<(String, Vec<PropValue>)> = Vec::new();
            let mut nested_groups: Vec<Vec<(String, Vec<i32>)>> = Vec::new();

            while i < entries.len() && entries[i].crc != CRC_PROP_INFO_END {
                if entries[i].crc == CRC_PROP_PARAM {
                    let key = entries[i]
                        .str_params
                        .first()
                        .and_then(|s| s.as_deref())
                        .unwrap_or("")
                        .to_string();
                    typed_props.push((key.clone(), extract_values(&entries[i])));
                    raw_props.push((key, extract_int_values(&entries[i])));
                    i += 1;
                } else if entries[i].crc == CRC_PROP_PARAM_BGN {
                    // Nom du sous-bloc (non utilisé dans la logique de construction).
                    let _group_name: Option<&str> =
                        entries[i].str_params.first().and_then(|s| s.as_deref());
                    i += 1;
                    let mut group: Vec<(String, Vec<i32>)> = Vec::new();
                    while i < entries.len() && entries[i].crc != CRC_PROP_PARAM_END {
                        if entries[i].crc == CRC_PROP_PARAM {
                            let key = entries[i]
                                .str_params
                                .first()
                                .and_then(|s| s.as_deref())
                                .unwrap_or("")
                                .to_string();
                            group.push((key, extract_int_values(&entries[i])));
                        }
                        i += 1;
                    }
                    if i < entries.len() {
                        i += 1; // saute PROP_PARAM_END
                    }
                    nested_groups.push(group);
                } else {
                    i += 1;
                }
            }
            if i < entries.len() {
                i += 1; // saute PROP_INFO_END
            }

            components.push(build_component(
                &comp_type,
                comp_mode,
                &raw_props,
                &typed_props,
                &nested_groups,
            ));
        } else {
            i += 1;
        }
    }

    Ok(MenuObject {
        name: obj_name,
        engine_type,
        g4pkm_path,
        g4tx_path,
        components,
    })
}

// ── Construction des composants ──────────────────────────────────────────────

fn build_component(
    type_name: &str,
    mode: i32,
    props: &[(String, Vec<i32>)],
    typed: &[(String, Vec<PropValue>)],
    nested: &[Vec<(String, Vec<i32>)>],
) -> MenuComponent {
    match type_name {
        "CMenuRenderComponent" => {
            MenuComponent::Render(build_render_component(type_name, props))
        }
        "CMenuAnimation" => {
            MenuComponent::Animation(build_animation_component(type_name, props))
        }
        "MenuTextSetting" => {
            MenuComponent::Text(build_text_component(type_name, mode, props))
        }
        "CMenuCreatePrimitiveComponent" => {
            MenuComponent::Primitive(build_primitive_component(type_name, props))
        }
        "CMenuAttachLocator" => {
            MenuComponent::AttachLocator(build_attach_locator_component(type_name, props))
        }
        "MenuCollisionSetting" => {
            MenuComponent::Collision(build_collision_component(type_name, mode, props))
        }
        "CMenuSoundCmdProperty" => {
            MenuComponent::SoundCmd(build_sound_cmd_component(type_name, props))
        }
        "CSetupMeshVisible" => {
            MenuComponent::MeshVisible(build_mesh_visible_component(type_name, nested))
        }
        _ => MenuComponent::Unknown(build_unknown_component(type_name, typed)),
    }
}

fn build_render_component(type_name: &str, props: &[(String, Vec<i32>)]) -> RenderComponent {
    let mut draw_priority = 0i32;
    let mut draw_type = 0i32;
    let mut camera_name_hash = 0u32;

    for (key, vals) in props {
        if vals.is_empty() {
            continue;
        }
        match key.as_str() {
            "m_drawPriority" => draw_priority = vals[0],
            "m_drawType" => draw_type = vals[0],
            "m_cameraName" => camera_name_hash = vals[0] as u32,
            _ => {}
        }
    }

    RenderComponent {
        type_name: type_name.to_string(),
        draw_priority,
        draw_type,
        camera_name_hash,
    }
}

fn build_animation_component(type_name: &str, props: &[(String, Vec<i32>)]) -> AnimationComponent {
    let mut mot_open = 0u32;
    let mut mot_close = 0u32;
    let mut mot_select = 0u32;

    for (key, vals) in props {
        if vals.is_empty() {
            continue;
        }
        if key == "m_nameMotOpen" {
            mot_open = vals[0] as u32;
            if vals.len() > 1 {
                mot_close = vals[1] as u32;
            }
            if vals.len() > 2 {
                mot_select = vals[2] as u32;
            }
        }
    }

    AnimationComponent {
        type_name: type_name.to_string(),
        mot_open_hash: mot_open,
        mot_close_hash: mot_close,
        mot_select_hash: mot_select,
    }
}

fn build_text_component(
    type_name: &str,
    mode: i32,
    props: &[(String, Vec<i32>)],
) -> TextComponent {
    let entries = props
        .iter()
        .map(|(key, vals)| {
            let hashes = vals.iter().map(|&v| v as u32).collect();
            TextEntry { key: key.clone(), hashes }
        })
        .collect();

    TextComponent {
        type_name: type_name.to_string(),
        table_index: mode,
        entries,
    }
}

fn build_primitive_component(type_name: &str, props: &[(String, Vec<i32>)]) -> PrimitiveComponent {
    let mut number_setting_hashes = Vec::new();
    let mut disp_max_values = Vec::new();

    for (key, vals) in props {
        match key.as_str() {
            "MenuNumberSettingName" => {
                for &v in vals {
                    number_setting_hashes.push(v as u32);
                }
            }
            "DispMaxValue" if vals.len() >= 2 => {
                disp_max_values.push(DispMaxEntry {
                    primitive_hash: vals[0] as u32,
                    max_value: vals[1],
                });
            }
            _ => {}
        }
    }

    PrimitiveComponent {
        type_name: type_name.to_string(),
        number_setting_hashes,
        disp_max_values,
    }
}

fn build_attach_locator_component(
    type_name: &str,
    props: &[(String, Vec<i32>)],
) -> AttachLocatorComponent {
    let mut hashes = Vec::new();
    for (key, vals) in props {
        if key == "NullLayerName" {
            for &v in vals {
                hashes.push(v as u32);
            }
        }
    }
    AttachLocatorComponent {
        type_name: type_name.to_string(),
        null_layer_hashes: hashes,
    }
}

fn build_collision_component(
    type_name: &str,
    mode: i32,
    props: &[(String, Vec<i32>)],
) -> CollisionComponent {
    let entries = props
        .iter()
        .map(|(key, vals)| CollisionEntry {
            key: key.clone(),
            enabled: vals.first().copied().unwrap_or(0),
            kind: vals.get(1).copied().unwrap_or(0),
            extra: vals.get(2).copied().unwrap_or(0),
        })
        .collect();

    CollisionComponent {
        type_name: type_name.to_string(),
        mode,
        entries,
    }
}

fn build_sound_cmd_component(type_name: &str, props: &[(String, Vec<i32>)]) -> SoundCmdComponent {
    let entries = props
        .iter()
        .map(|(key, vals)| SoundCmdEntry {
            command: key.clone(),
            param: vals.first().copied().unwrap_or(0),
        })
        .collect();

    SoundCmdComponent {
        type_name: type_name.to_string(),
        entries,
    }
}

fn build_mesh_visible_component(
    type_name: &str,
    nested: &[Vec<(String, Vec<i32>)>],
) -> MeshVisibleComponent {
    let params = nested
        .iter()
        .map(|group| {
            let mut crc = 0u32;
            let mut vis = false;
            for (k, v) in group {
                match k.as_str() {
                    "meshNameCrc" => {
                        if let Some(&val) = v.first() {
                            crc = val as u32;
                        }
                    }
                    "isVisible" => {
                        if let Some(&val) = v.first() {
                            vis = val != 0;
                        }
                    }
                    _ => {}
                }
            }
            MeshVisibleEntry { mesh_name_crc: crc, is_visible: vis }
        })
        .collect();

    MeshVisibleComponent {
        type_name: type_name.to_string(),
        params,
    }
}

fn build_unknown_component(
    type_name: &str,
    typed: &[(String, Vec<PropValue>)],
) -> UnknownComponent {
    UnknownComponent {
        type_name: type_name.to_string(),
        params: typed.to_vec(),
    }
}

// ── Normalisation des chemins ────────────────────────────────────────────────

/// Normalise un chemin de texture `.g4tx` : remplace le préfixe `"#/"` par `"dx11/"`.
///
/// Le préfixe `#/` est une convention Level-5 pour les chemins résolus depuis la racine
/// du VFS. Le serveur d'assets azalee/CDN attend le préfixe `"dx11/"`.
fn normalize_g4tx_path(path: Option<String>) -> Option<String> {
    path.map(|p| {
        if let Some(rest) = p.strip_prefix("#/") {
            alloc::format!("dx11/{rest}")
        } else {
            p
        }
    })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Tests is_objb (non-gated) ────────────────────────────────────────────

    #[test]
    fn is_objb_pied_de_page_valide() {
        // Footer cfg.bin 01 74 32 62 aux derniers octets.
        let mut data = vec![0u8; 64];
        data[60] = 0x01;
        data[61] = 0x74;
        data[62] = 0x32;
        data[63] = 0x62;
        assert!(is_objb(&data), "footer présent dans les 32 derniers octets");
    }

    #[test]
    fn is_objb_trop_petit() {
        assert!(!is_objb(&[]), "tampon vide → false");
        assert!(!is_objb(&[0u8; 4]), "4 octets < 16 → false");
        assert!(!is_objb(&[0u8; 15]), "15 octets < 16 → false");
    }

    #[test]
    fn is_objb_footer_absent() {
        assert!(!is_objb(&[0u8; 32]), "32 zéros sans footer → false");
        let mut data = vec![0u8; 64];
        // Footer incorrect (01 74 32 63 — dernier octet différent)
        data[60] = 0x01;
        data[61] = 0x74;
        data[62] = 0x32;
        data[63] = 0x63;
        assert!(!is_objb(&data), "footer invalide → false");
    }

    // ── Tests sur fichiers réels (gated : NIE_GAME_DIR ou /mnt/c/…) ─────────

    /// Lit les 3 fichiers golden via le VFS et valide les valeurs de référence.
    ///
    /// Le test se skip automatiquement si le jeu est absent (CI sans Steam).
    /// Lorsque le jeu est présent il DOIT passer — toute assertion fausse
    /// indique un bug de parser à corriger.
    #[test]
    fn real_files_golden_values() {
        let dir = crate::vfs::resolve_game_dir().to_string_lossy().into_owned();
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip real_files_golden_values : jeu absent ({}/data)", dir);
            return;
        }

        let mut vfs = crate::vfs::Vfs::new();
        if vfs.init(&data_dir).is_err() {
            eprintln!("skip real_files_golden_values : init VFS échoué");
            return;
        }

        // ── title00_09_version.objbin ────────────────────────────────────────
        {
            let raw = vfs
                .read("data/common/gamedata/menu/obj/title00_09_version.objbin")
                .expect("lecture title00_09_version.objbin");
            let obj = parse(&raw).expect("parse title00_09_version");

            assert_eq!(obj.name, "title00_09_version",
                "name incorrect : {:?}", obj.name);
            assert_eq!(obj.engine_type, "gmdMenuObj",
                "engine_type incorrect : {:?}", obj.engine_type);

            let g4pkm = obj.g4pkm_path.as_deref().unwrap_or("");
            assert!(g4pkm.contains("title00_09.g4pkm"),
                "g4pkm_path ne contient pas title00_09.g4pkm : {:?}", g4pkm);
            assert!(g4pkm.contains("50_title"),
                "g4pkm_path ne contient pas 50_title : {:?}", g4pkm);

            let g4tx = obj.g4tx_path.as_deref().unwrap_or("");
            assert!(g4tx.starts_with("dx11/"),
                "g4tx_path ne commence pas par dx11/ : {:?}", g4tx);
            assert!(g4tx.contains("title00_09.g4tx"),
                "g4tx_path ne contient pas title00_09.g4tx : {:?}", g4tx);
            assert!(g4tx.contains("<LG>"),
                "g4tx_path ne contient pas <LG> : {:?}", g4tx);

            let render = obj.components.iter().find_map(|c| {
                if let MenuComponent::Render(r) = c { Some(r) } else { None }
            });
            assert!(render.is_some(), "CMenuRenderComponent absent");
            assert!(render.unwrap().draw_priority > 0,
                "draw_priority doit être > 0, obtenu {}", render.unwrap().draw_priority);

            let prim = obj.components.iter().find_map(|c| {
                if let MenuComponent::Primitive(p) = c { Some(p) } else { None }
            });
            assert!(prim.is_some(), "CMenuCreatePrimitiveComponent absent");

            assert!(obj.components.len() >= 3,
                "attendu ≥3 composants, obtenu {}", obj.components.len());

            eprintln!("title00_09_version : {} composants, draw_priority={}",
                obj.components.len(),
                render.unwrap().draw_priority);
        }

        // ── win01_21_select_button.objbin ────────────────────────────────────
        {
            let raw = vfs
                .read("data/common/gamedata/menu/obj/win01_21_select_button.objbin")
                .expect("lecture win01_21_select_button.objbin");
            let obj = parse(&raw).expect("parse win01_21_select_button");

            assert!(obj.name.contains("cmn_button_s"),
                "name ne contient pas cmn_button_s : {:?}", obj.name);

            let g4pkm = obj.g4pkm_path.as_deref().unwrap_or("");
            assert!(g4pkm.contains("win01_21.g4pkm"),
                "g4pkm_path ne contient pas win01_21.g4pkm : {:?}", g4pkm);

            let anim = obj.components.iter().find_map(|c| {
                if let MenuComponent::Animation(a) = c { Some(a) } else { None }
            });
            assert!(anim.is_some(), "CMenuAnimation absent");
            assert_ne!(anim.unwrap().mot_open_hash, 0, "mot_open_hash doit être != 0");

            let text = obj.components.iter().find_map(|c| {
                if let MenuComponent::Text(t) = c { Some(t) } else { None }
            });
            assert!(text.is_some(), "MenuTextSetting absent");
            let text = text.unwrap();
            assert!(text.entries.iter().any(|e| e.key == "_text_choice01_on"),
                "clé _text_choice01_on absente; clés : {:?}",
                text.entries.iter().map(|e| &e.key).collect::<Vec<_>>());
            assert!(text.entries.iter().any(|e| e.key == "_text_choice01_off"),
                "clé _text_choice01_off absente");

            let render = obj.components.iter().find_map(|c| {
                if let MenuComponent::Render(r) = c { Some(r) } else { None }
            });
            assert!(render.is_some(), "CMenuRenderComponent absent");
            assert_eq!(render.unwrap().draw_priority, 300,
                "draw_priority attendu 300, obtenu {}", render.unwrap().draw_priority);

            eprintln!("win01_21_select_button : {} composants, draw_priority={}",
                obj.components.len(), render.unwrap().draw_priority);
        }

        // ── save01_04_savedata_detail_window.objbin ──────────────────────────
        {
            let raw = vfs
                .read("data/common/gamedata/menu/obj/save01_04_savedata_detail_window.objbin")
                .expect("lecture save01_04_savedata_detail_window.objbin");
            let obj = parse(&raw).expect("parse save01_04_savedata_detail_window");

            assert_eq!(obj.name, "save01_04_savedata_detail_window",
                "name incorrect : {:?}", obj.name);

            let g4pkm = obj.g4pkm_path.as_deref().unwrap_or("");
            assert!(g4pkm.contains("save01_04.g4pkm"),
                "g4pkm_path ne contient pas save01_04.g4pkm : {:?}", g4pkm);

            let text = obj.components.iter().find_map(|c| {
                if let MenuComponent::Text(t) = c { Some(t) } else { None }
            });
            assert!(text.is_some(), "MenuTextSetting absent");
            let text = text.unwrap();
            assert!(text.entries.len() >= 10,
                "attendu ≥10 clés texte, obtenu {}", text.entries.len());

            let mesh = obj.components.iter().find_map(|c| {
                if let MenuComponent::MeshVisible(m) = c { Some(m) } else { None }
            });
            assert!(mesh.is_some(), "CSetupMeshVisible absent");
            assert_eq!(mesh.unwrap().params.len(), 4,
                "attendu 4 params MeshVisible, obtenu {}", mesh.unwrap().params.len());

            let prim = obj.components.iter().find_map(|c| {
                if let MenuComponent::Primitive(p) = c { Some(p) } else { None }
            });
            assert!(prim.is_some(), "CMenuCreatePrimitiveComponent absent");
            assert!(prim.unwrap().disp_max_values.len() >= 10,
                "attendu ≥10 DispMaxValues, obtenu {}", prim.unwrap().disp_max_values.len());

            assert!(obj.components.len() >= 5,
                "attendu ≥5 composants, obtenu {}", obj.components.len());

            eprintln!(
                "save01_04_savedata_detail_window : {} composants, {} text, {} meshvis, {} dispmax",
                obj.components.len(),
                text.entries.len(),
                mesh.unwrap().params.len(),
                prim.unwrap().disp_max_values.len(),
            );
        }
    }
}
