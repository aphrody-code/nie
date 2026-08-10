//! `CharaCostume` — port du noeud `CHARA_COSTUME_MODEL_LIST_BEG_*` du
//! `chara_costume.cfg.bin` (liste des modeles de costume des personnages).
//!
//! ## Verite terrain
//!
//! - Parser TS : `packages/inagle/src/parsers/chara-costume-config.ts`
//!   (`parseEntries` l.39-61), port **1:1**.
//! - Donnees : VFS `data/common/gamedata/character/chara_costume_1.02.28.00.cfg.bin`.
//!
//! ## Structure (format `entries`)
//!
//! Le fichier T2B contient trois listes freres au niveau racine :
//! `CHARA_COSTUME_MODEL_LIST_BEG`, `CHARA_COSTUME_DATA_LIST_BEG`,
//! `CHARA_COSTUME_INFO_LIST_BEG`. Seule la **premiere** est portee ici (comme inagle).
//!
//! `CHARA_COSTUME_MODEL_LIST_BEG_0` contient 577 enfants `CHARA_COSTUME_MODEL_*`
//! (sa variable d'en-tete = 577, le compte reel verifie dans le dump). Chaque enfant
//! porte exactement **4 variables Int** :
//! `[type, modelRefCrc, flag1, flag2]`. `modelRefCrc` est un hash 32 bits signe rendu
//! en hex non signe via `toHex` (cf. [`crate::hash::HashId`]).
//!
//! Note : le commentaire d'en-tete d'inagle mentionne « 576 entries », mais le dump
//! reel `1.02.28.00` en contient **577** (la variable d'en-tete du `LIST_BEG` vaut 577).
//! Le parser n'utilise pas ce compte : il itere les enfants comme inagle.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;
use crate::hash::HashId;

/// Nombre de variables Int attendues par enfant `CHARA_COSTUME_MODEL_*` (port 1:1 :
/// inagle saute les enfants ayant `vars.length < 4`).
pub const COSTUME_VAR_COUNT: usize = 4;

/// Un modele de costume porte (`CHARA_COSTUME_MODEL_*`).
///
/// Champs ordonnes comme les 4 variables Int de l'enfant, plus l'`index` (position
/// dans le tableau d'enfants du `LIST_BEG`, exactement le `i` de la boucle inagle).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaCostume {
    /// Position de l'enfant dans le `LIST_BEG` (le `i` de la boucle inagle, 0-base).
    pub index: usize,
    /// var0 — champ `type` d'inagle (renomme `kind`, `type` etant un mot-cle Rust).
    pub kind: i64,
    /// var1 — `modelRef` : hash CRC du modele (rendu hex via `toHex` cote inagle).
    pub model_ref: HashId,
    /// var2 — `flag1`.
    pub flag1: i64,
    /// var3 — `flag2`.
    pub flag2: i64,
}

impl CharaCostume {
    /// Construit un costume depuis un enfant `CHARA_COSTUME_MODEL_*` et sa position.
    /// `None` si l'enfant a moins de [`COSTUME_VAR_COUNT`] variables (comme le
    /// `if (vars.length < 4) continue;` d'inagle).
    #[must_use]
    pub fn from_child(index: usize, child: Node<'_>) -> Option<Self> {
        if child.var_count() < COSTUME_VAR_COUNT {
            return None;
        }
        Some(CharaCostume {
            index,
            kind: child.int(0),
            model_ref: child.hash(1),
            flag1: child.int(2),
            flag2: child.int(3),
        })
    }
}

/// Parse tous les costumes d'un `chara_costume_*.cfg.bin.json` deserialise (forme iecode
/// `entries`). Port 1:1 d'inagle `parseEntries` (`chara-costume-config.ts` l.39-61) :
/// pour chaque entree racine dont le nom commence par `CHARA_COSTUME_MODEL_LIST_BEG`,
/// on itere ses enfants ; ceux dont le nom commence par `CHARA_COSTUME_MODEL_` et qui ont
/// au moins 4 variables deviennent des costumes. L'`index` est la **position brute** dans
/// le tableau d'enfants (le `i` d'inagle), pas le rang des costumes valides.
#[must_use]
pub fn parse_all_chara_costumes(root: &Value) -> Vec<CharaCostume> {
    let mut out = Vec::new();
    let Some(entries) = root.get("entries").and_then(Value::as_array) else {
        return out;
    };
    for entry in entries {
        let node = Node::new(entry);
        if !node.name().starts_with("CHARA_COSTUME_MODEL_LIST_BEG") {
            continue;
        }
        for (i, child) in node.children().into_iter().enumerate() {
            if !child.name().starts_with("CHARA_COSTUME_MODEL_") {
                continue;
            }
            if let Some(c) = CharaCostume::from_child(i, child) {
                out.push(c);
            }
        }
    }
    out
}
