//! Famille `stadium` — port du parseur de configuration des stades / terrains de match.
//!
//! ## Périmètre porté
//!
//! | Fichier | Format | Noeud | Structs | Statut |
//! |---------|--------|-------|---------|--------|
//! | `soccer/soccer_game_option.cfg.bin.json` | `entries` | `SOCCER_OPTION_FIELD_INFO_*` | [`Stadium`] | FAIT |
//!
//! Port 1:1 d'inagle `packages/inagle/src/parsers/stadium-config.ts`
//! (`parseFieldEntry` / `parseContent`).
//!
//! ## Structure (vérité terrain)
//!
//! Le dump réel `soccer_game_option.cfg.bin` (12464 octets, format T2B `entries`) contient
//! trois listes top-level :
//! - `SOCCER_OPTION_BGM_INFO_LIST_BEG_0` (77 enfants) — musiques de match,
//! - `SOCCER_OPTION_FIELD_INFO_LIST_BEG_0` (81 enfants) — **les stades** (ce module),
//! - `SOCCER_OPTION_COMMENTATOR_INFO_LIST_BEG_0` (8 enfants) — commentateurs.
//!
//! Chaque `SOCCER_OPTION_FIELD_INFO_N` porte 6 variables positionnelles :
//! `[fieldId (Int), index (Int), condition (Int=0 ou String base64), imagePath (String), _ (Int), _ (Int)]`.
//!
//! Le parseur n'utilise que `fieldId`, `index`, `condition` et `imagePath` (comme inagle) ;
//! les deux derniers entiers (rôle inconnu sans le header C++ `GDSSoccerGameOption`) sont ignorés.

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Un stade / terrain de match (`SOCCER_OPTION_FIELD_INFO_N`, type `GDSSoccerGameOptionFieldInfo`).
///
/// ## Vérité terrain
///
/// `soccer_game_option.cfg.bin.json`, `SOCCER_OPTION_FIELD_INFO_0` :
/// `[ -826611768, 0, 0, "#/menu/220_img/stadium/img_room_s90g001.g4tx", 1045184524, -1488645706 ]`
/// → `field_id = 0xCEBAE7C8`, `index = 0`, `condition = ""`, `image_path = "stadium/img_room_s90g001"`.
///
/// `SOCCER_OPTION_FIELD_INFO_1` :
/// `[ 585721253, 1, "AAAAABgFNRftNPcACgEoAAYCNI7qCisyAAAAAXg=", "#/menu/220_img/stadium/img_room_s10g001.g4tx", … ]`
/// → `field_id = 0x22E965A5`, `index = 1`, `condition = "AAAAABgF…"`, `image_path = "stadium/img_room_s10g001"`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Stadium {
    /// `var[0]` — hash identifiant le terrain (`toHex(fieldId)` côté inagle).
    ///
    /// Vérité terrain : `SOCCER_OPTION_FIELD_INFO_0.var[0]` = -826611768 → `0xCEBAE7C8`.
    pub field_id: HashId,
    /// `var[1]` — index d'affichage (0-based ; non contigu : va de 0 à 90 pour 81 entrées).
    pub index: i64,
    /// Chemin d'image dépouillé du préfixe `#/menu/220_img/` et du suffixe `.g4tx`
    /// (ex. `"stadium/img_room_s90g001"`). Issu de la variable `String` contenant
    /// `"220_img/stadium/"`. Toujours non vide pour un [`Stadium`] valide.
    pub image_path: String,
    /// Condition de déverrouillage encodée (chaîne base64 > 20 caractères ; vide si absente).
    ///
    /// Vérité terrain : entrée 0 → `""` (sa `var[2]` vaut l'entier 0), entrées 1..80 →
    /// une chaîne base64 de 40 caractères (80 conditions distinctes au total).
    pub condition: String,
    /// Dernier segment de [`Stadium::image_path`] (ex. `"img_room_s90g001"`).
    ///
    /// Réplique le `name` d'inagle : `imagePath.split("/").pop() || fieldId`. Retombe sur
    /// le hash hex du terrain si le chemin n'a pas de segment.
    pub name: String,
}

impl Stadium {
    /// Représentation hexadécimale du [`Stadium::field_id`] (`"0xXXXXXXXX"`), = `fieldId`/`id` d'inagle.
    #[must_use]
    pub fn field_id_hex(&self) -> String {
        self.field_id.to_hex()
    }
}

/// Retire le préfixe `#/menu/220_img/` et le suffixe `.g4tx` d'un chemin de texture.
///
/// Port de `extractImageName` (inagle) : `replace` JS ne retire que la **première**
/// occurrence, d'où `replacen(.., 1)`.
fn extract_image_name(texture_path: &str) -> String {
    texture_path
        .replacen("#/menu/220_img/", "", 1)
        .replacen(".g4tx", "", 1)
}

/// Parse un noeud `SOCCER_OPTION_FIELD_INFO_N`. `None` si aucune image de stade n'est trouvée.
///
/// Port 1:1 de `parseFieldEntry` (inagle) : on balaie les variables positionnelles ;
/// une `String` contenant `"220_img/stadium/"` donne l'image, une autre `String` de plus
/// de 20 caractères donne la condition, `Int` en position 0 → `fieldId`, position 1 → `index`.
fn parse_field_entry(node: Node<'_>) -> Option<Stadium> {
    let mut image_path = String::new();
    let mut condition = String::new();
    let mut field_id_raw: i64 = 0;
    let mut index: i64 = 0;

    for i in 0..node.var_count() {
        let Some(v) = node.var(i) else { continue };
        if v.ty == "String" {
            if v.value.contains("220_img/stadium/") {
                image_path = extract_image_name(v.value);
            } else if v.value.len() > 20 {
                condition = v.value.to_string();
            }
        } else if v.ty == "Int" && i == 0 {
            field_id_raw = v.as_i64();
        } else if v.ty == "Int" && i == 1 {
            index = v.as_i64();
        }
    }

    if image_path.is_empty() {
        return None;
    }

    let field_id = HashId::from_i64(field_id_raw);
    // `imagePath.split("/").pop() || fieldId` — dernier segment, sinon le hash hex.
    let name = match image_path.rsplit('/').next() {
        Some(seg) if !seg.is_empty() => seg.to_string(),
        _ => field_id.to_hex(),
    };

    Some(Stadium {
        field_id,
        index,
        image_path,
        condition,
        name,
    })
}

/// Parse tous les stades de `soccer_game_option.cfg.bin.json`.
///
/// Port 1:1 de `parseContent` (inagle) : gère les deux dispositions on-disk —
/// entrées `SOCCER_OPTION_FIELD_INFO_N` plates (hors `_LIST_`) **et** entrées imbriquées
/// dans `SOCCER_OPTION_FIELD_INFO_LIST_BEG_*`. Le dump réel utilise la seconde (81 enfants).
///
/// Comptes réels : 81 [`Stadium`] (tous avec image), dont 80 portent une condition.
#[must_use]
pub fn parse_stadium_config(root: &Value) -> Vec<Stadium> {
    let mut out = Vec::new();
    let Some(entries) = root.get("entries").and_then(Value::as_array) else {
        return out;
    };
    for entry in entries {
        let node = Node::new(entry);
        let name = node.name();
        // Entrées FIELD_INFO plates (format aplati, hors noeud LIST).
        if name.starts_with("SOCCER_OPTION_FIELD_INFO_") && !name.contains("_LIST_") {
            out.extend(parse_field_entry(node));
        }
        // Entrées imbriquées dans un noeud LIST_BEG (format à enfants — cas réel).
        if name.starts_with("SOCCER_OPTION_FIELD_INFO_LIST_BEG_") {
            for child in node.children() {
                out.extend(parse_field_entry(child));
            }
        }
    }
    out
}

// ─── Tests unitaires ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn field_node(vars: Value) -> Value {
        json!({ "name": "SOCCER_OPTION_FIELD_INFO_0", "variables": vars, "children": [] })
    }

    #[test]
    fn extract_image_name_strip() {
        assert_eq!(
            extract_image_name("#/menu/220_img/stadium/img_room_s90g001.g4tx"),
            "stadium/img_room_s90g001"
        );
    }

    #[test]
    fn entree_sans_condition() {
        // SOCCER_OPTION_FIELD_INFO_0 : var[2] est l'entier 0 → pas de condition.
        let node = field_node(json!([
            { "type": "Int", "value": "-826611768" },
            { "type": "Int", "value": "0" },
            { "type": "Int", "value": "0" },
            { "type": "String", "value": "#/menu/220_img/stadium/img_room_s90g001.g4tx" },
            { "type": "Int", "value": "1045184524" },
            { "type": "Int", "value": "-1488645706" }
        ]));
        let s = parse_field_entry(Node::new(&node)).unwrap();
        assert_eq!(s.field_id, HashId(0xCEBA_E7C8));
        assert_eq!(s.field_id_hex(), "0xCEBAE7C8");
        assert_eq!(s.index, 0);
        assert_eq!(s.image_path, "stadium/img_room_s90g001");
        assert_eq!(s.name, "img_room_s90g001");
        assert!(s.condition.is_empty());
    }

    #[test]
    fn entree_avec_condition() {
        // SOCCER_OPTION_FIELD_INFO_1 : var[2] est une chaîne base64 (> 20 car.) → condition.
        let node = field_node(json!([
            { "type": "Int", "value": "585721253" },
            { "type": "Int", "value": "1" },
            { "type": "String", "value": "AAAAABgFNRftNPcACgEoAAYCNI7qCisyAAAAAXg=" },
            { "type": "String", "value": "#/menu/220_img/stadium/img_room_s10g001.g4tx" },
            { "type": "Int", "value": "-2053840364" },
            { "type": "Int", "value": "480097198" }
        ]));
        let s = parse_field_entry(Node::new(&node)).unwrap();
        assert_eq!(s.field_id, HashId(0x22E9_65A5));
        assert_eq!(s.index, 1);
        assert_eq!(s.condition, "AAAAABgFNRftNPcACgEoAAYCNI7qCisyAAAAAXg=");
        assert_eq!(s.image_path, "stadium/img_room_s10g001");
    }

    #[test]
    fn sans_image_rejete() {
        // Aucune variable String de stade → None (comme inagle `if (!imagePath) return null`).
        let node = field_node(json!([
            { "type": "Int", "value": "1" },
            { "type": "Int", "value": "0" }
        ]));
        assert!(parse_field_entry(Node::new(&node)).is_none());
    }

    #[test]
    fn parse_content_format_liste() {
        // Disposition réelle : enfants imbriqués dans LIST_BEG.
        let root = json!({
            "entries": [{
                "name": "SOCCER_OPTION_FIELD_INFO_LIST_BEG_0",
                "variables": [{ "type": "Int", "value": "2" }],
                "children": [
                    field_node(json!([
                        { "type": "Int", "value": "-826611768" },
                        { "type": "Int", "value": "0" },
                        { "type": "Int", "value": "0" },
                        { "type": "String", "value": "#/menu/220_img/stadium/img_room_s90g001.g4tx" },
                        { "type": "Int", "value": "1" },
                        { "type": "Int", "value": "2" }
                    ])),
                    field_node(json!([
                        { "type": "Int", "value": "585721253" },
                        { "type": "Int", "value": "1" },
                        { "type": "String", "value": "AAAAABgFNRftNPcACgEoAAYCNI7qCisyAAAAAXg=" },
                        { "type": "String", "value": "#/menu/220_img/stadium/img_room_s10g001.g4tx" },
                        { "type": "Int", "value": "3" },
                        { "type": "Int", "value": "4" }
                    ]))
                ]
            }]
        });
        let stadiums = parse_stadium_config(&root);
        assert_eq!(stadiums.len(), 2);
        assert_eq!(stadiums[0].name, "img_room_s90g001");
        assert_eq!(stadiums[1].field_id, HashId(0x22E9_65A5));
    }
}
