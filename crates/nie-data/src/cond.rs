//! `cond` — décodeur du **cadrage (framing)** des blobs de condition d'IEVR.
//!
//! Le même blob base64 « condition » apparaît **partout** dans les données du jeu : `openCond`
//! (gallery), `cond` (happen_event_npc, triggers `DATA_ITEM`), `condition` (trial_take_over),
//! `runCond` (soccer_drop), `aocCondition` (add_content_equip)… C'est le **système d'expressions
//! de condition** générique (déblocages, déclencheurs). Sa sémantique d'évaluation est portée par
//! `game::ValidConditionManager` (VM de conditions) — **non encore reversée** (arc multi-session).
//!
//! ## Ce qui est VALIDÉ ici (sans tricher : contre le corpus réel entier)
//!
//! Le **cadrage externe** du blob, prouvé sur **17 806 blobs réels** extraits de
//! `data/common/gamedata/**` (la donnée du jeu = vérité terrain du format) :
//!
//! - `b[0..4]` = **version** (u32 big-endian), toujours `0` ou `1` ;
//! - **version 0** (17 772/17 772, 99,8 %) : `b[4]` = **longueur** du reste (= `len − 5`),
//!   `b[5]` = **opcode** de l'expression, `b[6..]` = charge utile ;
//! - **version 1** (34 blobs, 0,2 %) : **forme liste** (concaténation de sous-expressions) — le
//!   cadrage interne n'est pas encore reversé (`framing_valid_v0` renvoie `false`).
//!
//! ## Ce qui RESTE (INCOMPLET — exige l'évaluateur binaire, pas de devinette)
//!
//! La **sémantique des clauses** (le CRC32 de flag, les opérateurs de comparaison, AND/OR, la
//! forme liste v1) n'est **pas** décodée : la reverser exige l'évaluateur `ValidConditionManager`
//! (la valider = differential-testing via uemu avec un état de flags). Observation non assérée :
//! les opcodes v0 observés suivent `5, 11, 17, 23, 29, 35, 41, 47` (pas de 6) — cohérent avec
//! « 6·n − 1 clauses » mais **non prouvé** sans l'évaluateur → laissé brut.

use alloc::vec::Vec;

/// Cadrage décodé d'un blob de condition (en-tête + charge utile brute).
///
/// Seul le **cadrage** est interprété ; la charge utile (`payload`) reste **brute** (sa
/// structure de clauses n'est pas reversée — anti-hallucination).
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CondBlob {
    /// `b[0..4]` — version du format (u32 **big-endian**) : `0` (expression simple) ou `1` (forme liste).
    pub version: u32,
    /// `b[4]` — longueur déclarée du reste (octets depuis `b[5]`). Pour version 0,
    /// vaut `payload.len() + 1` (validé sur tout le corpus, cf. [`CondBlob::framing_valid_v0`]).
    pub declared_len: u8,
    /// `b[5]` — opcode de l'expression (type d'opération ; sémantique non reversée).
    pub opcode: u8,
    /// `b[6..]` — charge utile **brute** (clauses non décodées).
    pub payload: Vec<u8>,
}

impl CondBlob {
    /// Décode le cadrage d'un blob de condition (octets bruts, déjà base64-décodés).
    ///
    /// `None` si trop court (`< 6` octets). N'interprète **que** l'en-tête ; ne valide pas la
    /// cohérence (utiliser [`CondBlob::framing_valid_v0`] pour ça).
    #[must_use]
    pub fn parse(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 6 {
            return None;
        }
        // En-tête **big-endian** : `00 00 00 00` → 0, `00 00 00 01` → 1 (validé sur le corpus réel).
        let version = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        Some(Self {
            version,
            declared_len: bytes[4],
            opcode: bytes[5],
            payload: bytes[6..].to_vec(),
        })
    }

    /// `true` si le cadrage **version 0** est cohérent : `version == 0` et `declared_len` == longueur
    /// réelle du reste (`payload.len() + 1`). Prouvé sur 17 772/17 772 blobs version-0 réels.
    #[must_use]
    pub fn framing_valid_v0(&self) -> bool {
        self.version == 0 && self.declared_len as usize == self.payload.len() + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Blobs réels (base64-décodés) extraits des données du jeu — vérité terrain du cadrage.
    /// gallery `openCond`, happen_event `cond[0]`, happen_event `cond[1]` (2 clauses).
    const GALLERY: [u8; 20] = [
        0x00, 0x00, 0x00, 0x00, 0x0f, 0x05, 0x35, 0xb9, 0x19, 0x36, 0xda, 0x00, 0x01, 0x00, 0x32,
        0x00, 0x00, 0x4e, 0x2a, 0x71,
    ];
    const HAPPEN1: [u8; 35] = [
        0x00, 0x00, 0x00, 0x00, 0x1e, 0x0b, 0x35, 0xb9, 0x19, 0x36, 0xda, 0x00, 0x01, 0x00, 0x32,
        0x00, 0x00, 0x27, 0x38, 0x71, 0x35, 0xb9, 0x19, 0x36, 0xda, 0x00, 0x01, 0x00, 0x32, 0x00,
        0x00, 0x75, 0x62, 0x79, 0x8f,
    ];

    #[test]
    fn parse_version0_framing_valide() {
        let b = CondBlob::parse(&GALLERY).expect("≥6 octets");
        assert_eq!(b.version, 0);
        assert_eq!(b.declared_len, 0x0f); // 15 = len(20) − 5
        assert_eq!(b.opcode, 0x05);
        assert_eq!(b.payload.len(), 14);
        assert!(b.framing_valid_v0(), "0x0f == payload.len()+1 (15)");
    }

    #[test]
    fn parse_multi_clauses_framing_valide() {
        let b = CondBlob::parse(&HAPPEN1).expect("≥6 octets");
        assert_eq!(b.version, 0);
        assert_eq!(b.declared_len, 0x1e); // 30 = len(35) − 5
        assert_eq!(b.opcode, 0x0b); // 2 clauses
        assert!(b.framing_valid_v0());
    }

    #[test]
    fn trop_court_rejete() {
        assert!(CondBlob::parse(&[0, 0, 0, 0, 5]).is_none());
        assert!(CondBlob::parse(&[]).is_none());
    }

    #[test]
    fn version1_non_v0() {
        // Préfixe version 1 (forme liste) : le cadrage v0 ne s'applique pas.
        let v1 = [0x00, 0x00, 0x00, 0x01, 0x2f, 0x4d, 0xaa, 0xbb];
        let b = CondBlob::parse(&v1).unwrap();
        assert_eq!(b.version, 1);
        assert!(!b.framing_valid_v0(), "version 1 ⇒ cadrage v0 invalide (forme liste, INCOMPLET)");
    }
}
