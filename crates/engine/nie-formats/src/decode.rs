//! Décodage générique « octets → JSON » : **la** table de dispatch du dépôt, partagée par la FFI
//! (`nie-ffi`) et la CLI (`niers decode`). Une famille ajoutée ici profite aux deux.
//!
//! Ordre de dispatch (le premier qui parse gagne) :
//! 1. `lip\0` — testé avant [`crate::detect`], qui ne le distingue pas ;
//! 2. `G4TX`, `G4MD`, `G4PK`/`G4PKM`, `RDBN`, `CPK ` — d'après le magic ;
//! 3. inconnu — on tente les conteneurs T2B dans l'ordre `objbin` → `cfgbin` → `mevbin`,
//!    qui partagent le même en-tête et ne se distinguent qu'au contenu.

extern crate alloc;

use alloc::vec::Vec;

use crate::FileFormat;

/// Résultat d'un décodage réussi : le JSON, et **le parseur qui l'a produit**.
///
/// Le nom vient du parseur, pas de la détection : les conteneurs T2B (`objbin`, `cfgbin` T2B,
/// `mevbin`) partagent le même en-tête et tombent tous dans `FileFormat::Unknown` — dire
/// « inconnu » d'un fichier qu'on vient de décoder n'apprend rien à l'appelant.
#[derive(Debug, Clone)]
pub struct Decoded {
    /// JSON UTF-8.
    pub json: Vec<u8>,
    /// Nom court du parseur ayant réussi (`"g4tx"`, `"cfg.bin"`, `"objbin"`…).
    pub format: &'static str,
}

/// Décode un tampon vers du JSON UTF-8, format auto-détecté.
///
/// Retourne `None` si le format n'est pas supporté ou si le parse échoue — jamais d'erreur
/// détaillée : les appelants (FFI, CLI, décodage en lot) veulent tous « ça a marché ou non ».
#[must_use]
pub fn decode(data: &[u8]) -> Option<Decoded> {
    fn done(json: Option<Vec<u8>>, format: &'static str) -> Option<Decoded> {
        json.map(|json| Decoded { json, format })
    }

    // `lip\0` n'a pas de variante dans `FileFormat` : le tester au magic.
    if data.len() >= 4 && data[..4] == *b"lip\0" {
        return done(
            crate::lip::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "lip",
        );
    }

    match crate::detect(data) {
        FileFormat::G4tx => done(
            crate::g4tx::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "g4tx",
        ),
        FileFormat::G4md => done(
            crate::g4md::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "g4md",
        ),
        // Le layout 2D menu (G4SKM encapsulé) d'abord : `g4pk::parse` accepterait le fichier
        // mais rendrait une vue moins riche.
        FileFormat::G4pk => done(
            crate::g4pkm::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "g4pkm",
        )
        .or_else(|| {
            done(
                crate::g4pk::parse(data)
                    .ok()
                    .and_then(|v| serde_json::to_vec(&v).ok()),
                "g4pk",
            )
        }),
        FileFormat::CfgBin => done(
            crate::cfgbin::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "cfg.bin",
        ),
        FileFormat::Cpk => done(
            crate::cpk::parse_cpk(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "cpk",
        ),
        FileFormat::Unknown => done(
            crate::objbin::parse(data)
                .ok()
                .and_then(|v| serde_json::to_vec(&v).ok()),
            "objbin",
        )
        .or_else(|| {
            done(
                crate::cfgbin::parse_t2b(data)
                    .ok()
                    .and_then(|v| serde_json::to_vec(&v).ok()),
                "cfg.bin (T2B)",
            )
        })
        .or_else(|| {
            done(
                crate::mevbin::parse(data)
                    .ok()
                    .and_then(|v| serde_json::to_vec(&v).ok()),
                "mevbin",
            )
        }),
        _ => None,
    }
}

/// Variante « JSON seul » de [`decode`], pour les appelants qui ignorent le format (FFI).
#[must_use]
pub fn to_json(data: &[u8]) -> Option<Vec<u8>> {
    decode(data).map(|d| d.json)
}

/// Nom court du format **détecté** (avant tout parse) : `"g4tx"`, `"cfg.bin"`, `"inconnu"`…
///
/// Pour nommer ce qui a réellement été décodé, utiliser [`Decoded::format`] : la détection
/// seule ne distingue pas les conteneurs T2B.
#[must_use]
pub fn format_name(data: &[u8]) -> &'static str {
    if data.len() >= 4 && data[..4] == *b"lip\0" {
        return "lip";
    }
    match crate::detect(data) {
        FileFormat::G4tx => "g4tx",
        FileFormat::G4md => "g4md",
        FileFormat::G4mg => "g4mg",
        FileFormat::G4sk => "g4sk",
        FileFormat::G4pk => "g4pk",
        FileFormat::CfgBin => "cfg.bin",
        FileFormat::Cpk => "cpk",
        FileFormat::Unknown => "inconnu",
        _ => "autre",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tampon_vide_ou_bruit_ne_decode_pas() {
        assert!(to_json(&[]).is_none());
        assert!(to_json(&[0xFF; 8]).is_none());
    }

    #[test]
    fn le_magic_lip_est_teste_avant_la_detection() {
        // `detect` ne connaît pas `lip\0` : sans le test préalable, ce tampon partirait dans
        // la branche `Unknown` et tenterait les parseurs T2B.
        assert_eq!(format_name(b"lip\0suite"), "lip");
    }

    #[test]
    fn un_nom_de_format_est_toujours_rendu() {
        assert_eq!(format_name(&[]), "inconnu");
        assert!(!format_name(&[0x00; 32]).is_empty());
    }

    #[test]
    fn to_json_et_decode_disent_la_meme_chose() {
        // `to_json` ne doit rester qu'une vue de `decode`, sinon les deux chemins divergent.
        let bruit = [0xAB; 32];
        assert_eq!(to_json(&bruit).is_some(), decode(&bruit).is_some());
    }
}
