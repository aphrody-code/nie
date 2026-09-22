//! Recoloration d'un conteneur `.g4tx` entier — décodage réel, filtre [`crate::recolor`],
//! réencodage réel.
//!
//! Ce module est le seul endroit du dépôt qui reconstruit un conteneur G4TX en ne remplaçant
//! qu'une partie de ses textures : [`reencode_with_payloads`] recopie **octet pour octet** les
//! charges non touchées et reporte toutes les régions d'atlas, et `nie mod texture` comme
//! `nie mod recolor` passent par lui. Deux reconstructions dériveraient.
//!
//! ## Pourquoi la recoloration accepte les atlas, là où le remplacement les refuse
//!
//! Remplacer une texture découpée en régions n'a pas de sens univoque : plusieurs régions se
//! partagent une image, et l'image de remplacement ne dit pas laquelle elle vise. Une
//! recoloration, elle, est une transformation **par pixel à géométrie constante** : la largeur,
//! la hauteur et donc chaque rectangle de région restent exactement ce qu'ils étaient. Les
//! régions sont reportées telles quelles et restent valides.

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::g4tx::{G4tx, G4txTexture};
use crate::g4tx_encode::{RegionAEcrire, TextureAEcrire, encode_g4tx_multi_texture};
use crate::recolor::Recolor;

/// Ce qu'une texture devient dans le conteneur reconstruit.
pub enum NouvelleCharge {
    /// Recopiée octet pour octet depuis la source — rien n'est ré-encodé, donc rien ne peut se
    /// dégrader au passage.
    Inchangee,
    /// Remplacée par un DDS, avec ses nouvelles dimensions.
    Dds {
        /// Octets DDS complets (magic `DDS ` inclus).
        dds: Vec<u8>,
        /// Largeur de l'image portée par ce DDS.
        width: i16,
        /// Hauteur de l'image portée par ce DDS.
        height: i16,
    },
}

/// Reconstruit un conteneur G4TX en remplaçant les textures désignées et en recopiant les autres.
///
/// `charges` est indexé comme `atlas.textures` et doit avoir la même longueur.
///
/// # Errors
///
/// Si `charges` n'a pas la longueur de `atlas.textures`, si la charge d'origine d'une texture
/// recopiée tombe hors du tampon source, si l'encodage échoue, ou si le conteneur produit ne se
/// relit pas à l'identique (mêmes noms, mêmes ids, mêmes comptes de régions).
pub fn reencode_with_payloads(
    src: &[u8],
    atlas: &G4tx,
    charges: &[NouvelleCharge],
) -> Result<Vec<u8>, String> {
    if charges.len() != atlas.textures.len() {
        return Err(format!(
            "{} charge(s) pour {} texture(s)",
            charges.len(),
            atlas.textures.len()
        ));
    }

    let mut entrees = Vec::with_capacity(atlas.textures.len());
    for (t, charge) in atlas.textures.iter().zip(charges) {
        match charge {
            NouvelleCharge::Dds { dds, width, height } => entrees.push(TextureAEcrire {
                name: t.name.as_str(),
                id: t.id,
                width: *width,
                height: *height,
                dds: dds.as_slice(),
            }),
            NouvelleCharge::Inchangee => {
                let fin = t.data_offset.saturating_add(t.data_size);
                let payload = src.get(t.data_offset..fin).ok_or_else(|| {
                    format!(
                        "charge de « {} » hors limites ({}..{fin} sur {} octets)",
                        t.name,
                        t.data_offset,
                        src.len()
                    )
                })?;
                entrees.push(TextureAEcrire {
                    name: t.name.as_str(),
                    id: t.id,
                    width: i16::try_from(t.width).unwrap_or(0),
                    height: i16::try_from(t.height).unwrap_or(0),
                    dds: payload,
                });
            }
        }
    }

    let mut regions = Vec::new();
    for (i, t) in atlas.textures.iter().enumerate() {
        let parent = i16::try_from(i).map_err(|_| "plus de 32 767 textures".to_string())?;
        for s in &t.sub_textures {
            regions.push(RegionAEcrire {
                entry_index: parent,
                name: s.name.as_str(),
                id: s.id,
                x: s.x,
                y: s.y,
                width: s.width,
                height: s.height,
            });
        }
    }

    let nouveaux = encode_g4tx_multi_texture(&entrees, &regions)
        .map_err(|e| format!("encodage G4TX : {e}"))?;
    verifier_relecture(atlas, &nouveaux)?;
    Ok(nouveaux)
}

/// Relit le conteneur produit et vérifie qu'il rend la même structure que l'original.
///
/// Un conteneur qui ne se reparse pas doit échouer ici, pas dans le jeu.
fn verifier_relecture(avant: &G4tx, octets: &[u8]) -> Result<(), String> {
    let relu = crate::g4tx::parse(octets)
        .map_err(|e| format!("le G4TX réencodé ne se relit pas : {e}"))?;
    if relu.textures.len() != avant.textures.len() {
        return Err(format!(
            "le G4TX réencodé rend {} texture(s) au lieu de {}",
            relu.textures.len(),
            avant.textures.len()
        ));
    }
    for (a, b) in avant.textures.iter().zip(&relu.textures) {
        if a.name != b.name || a.id != b.id {
            return Err(format!(
                "le G4TX réencodé rend « {} » (id {}) là où « {} » (id {}) était attendu",
                b.name, b.id, a.name, a.id
            ));
        }
        if a.sub_textures.len() != b.sub_textures.len() {
            return Err(format!(
                "le G4TX réencodé rend {} région(s) sur « {} » au lieu de {}",
                b.sub_textures.len(),
                a.name,
                a.sub_textures.len()
            ));
        }
    }
    Ok(())
}

/// Ce qu'une recoloration a fait, texture par texture.
#[derive(Debug, Clone)]
pub struct Recoloration {
    /// Conteneur G4TX reconstruit.
    pub octets: Vec<u8>,
    /// Noms des textures effectivement recolorées, avec leurs dimensions.
    pub recolorees: Vec<(String, u32, u32)>,
    /// Textures écartées par `cible` — choisies par l'appelant, donc sans surprise.
    pub hors_cible: Vec<String>,
    /// Textures que le décodeur n'a pas su rendre en RGBA. Leur charge a été **recopiée**, jamais
    /// remplacée par du vide, et ce champ est le seul endroit qui le dise : confondu avec
    /// [`Self::hors_cible`], un conteneur à moitié recoloré passerait pour entièrement recoloré.
    pub illisibles: Vec<String>,
}

/// Recolore un conteneur `.g4tx`.
///
/// `cible` restreint la recoloration à une texture principale par son nom ; `None` recolore
/// toutes celles qui se décodent. Les textures que le décodeur ne sait pas rendre en RGBA sont
/// recopiées telles quelles et listées dans [`Recoloration::illisibles`] — une charge illisible
/// est signalée, jamais remplacée par du vide.
///
/// Les textures recolorées ressortent en **BGRA8 non compressé** : le conteneur est reconstruit,
/// donc les offsets sont recalculés et un changement de taille ne casse rien. C'est le même
/// choix que `nie mod texture`.
///
/// # Errors
///
/// Si le tampon n'est pas un G4TX lisible, si `cible` ne nomme aucune texture, si le filtre est
/// l'identité (rien à écrire), si aucune texture n'a pu être décodée, ou si le réencodage ou sa
/// relecture échouent.
pub fn recolour(src: &[u8], filtre: &Recolor, cible: Option<&str>) -> Result<Recoloration, String> {
    if filtre.is_identity() {
        return Err(
            "le filtre ne change rien — préciser au moins --teinte, --saturation, --valeur ou \
             --rampe"
                .to_string(),
        );
    }
    let atlas = crate::g4tx::parse(src).map_err(|e| format!("G4TX illisible : {e}"))?;
    if atlas.textures.is_empty() {
        return Err("aucune texture dans le conteneur".to_string());
    }
    if let Some(nom) = cible
        && !atlas.textures.iter().any(|t| t.name == nom)
    {
        return Err(format!(
            "pas de texture « {nom} » ; disponibles : {}",
            noms(&atlas.textures)
        ));
    }

    let mut charges = Vec::with_capacity(atlas.textures.len());
    let mut recolorees = Vec::new();
    let mut hors_cible = Vec::new();
    let mut illisibles = Vec::new();
    for t in &atlas.textures {
        if cible.is_some_and(|n| n != t.name) {
            charges.push(NouvelleCharge::Inchangee);
            hors_cible.push(t.name.clone());
            continue;
        }
        let Some((w, h, mut rgba)) = crate::g4tx_decode::decode_texture_rgba(src, t) else {
            charges.push(NouvelleCharge::Inchangee);
            illisibles.push(t.name.clone());
            continue;
        };
        filtre.apply_rgba(&mut rgba);
        let dds = crate::g4tx_encode::encode_dds_bgra8(w, h, &rgba)
            .map_err(|e| format!("encodage DDS de « {} » : {e}", t.name))?;
        let width = i16::try_from(w).map_err(|_| format!("largeur {w} hors i16"))?;
        let height = i16::try_from(h).map_err(|_| format!("hauteur {h} hors i16"))?;
        charges.push(NouvelleCharge::Dds { dds, width, height });
        recolorees.push((t.name.clone(), w, h));
    }

    if recolorees.is_empty() {
        return Err(format!(
            "aucune texture décodable — {} charge(s) illisible(s) : {}",
            illisibles.len(),
            illisibles.join(", ")
        ));
    }

    let octets = reencode_with_payloads(src, &atlas, &charges)?;
    Ok(Recoloration {
        octets,
        recolorees,
        hors_cible,
        illisibles,
    })
}

/// Noms des textures principales, pour les messages d'erreur.
#[must_use]
pub fn noms(textures: &[G4txTexture]) -> String {
    textures
        .iter()
        .map(|t| t.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::g4tx_encode::{encode_dds_bgra8, encode_g4tx_single_texture};
    use crate::recolor::Ramp;

    /// Un conteneur G4TX RÉEL, construit par l'encodeur du dépôt — pas par la fiction du lecteur
    /// GameBanana (magic + trois `u32` + pixels bruts), qui ne décrit aucun fichier du jeu.
    fn conteneur(nom: &str, w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let dds = encode_dds_bgra8(w, h, rgba).expect("DDS encodable");
        encode_g4tx_single_texture(nom, 0, w as i16, h as i16, &dds)
    }

    fn damier() -> (u32, u32, Vec<u8>) {
        let (w, h) = (4u32, 4u32);
        let mut rgba = Vec::with_capacity((w * h * 4) as usize);
        for i in 0..w * h {
            let rouge = i % 2 == 0;
            rgba.extend_from_slice(if rouge {
                &[255, 0, 0, 255]
            } else {
                &[0, 0, 255, 128]
            });
        }
        (w, h, rgba)
    }

    #[test]
    fn le_lecteur_g4tx_de_l_outil_gamebanana_ne_decrit_pas_le_format_reel() {
        // Mesure, pas opinion : l'outil lit `width` en `<I` à l'offset 8 et `height` à 12, et
        // attend `width*height*4` octets RGBA après un en-tête fixe. Sur un conteneur réel de
        // 4×4, ces offsets ne rendent pas 4 et 4.
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        assert_eq!(&octets[0..4], b"G4TX");
        let lu_w = u32::from_le_bytes(octets[8..12].try_into().unwrap());
        let lu_h = u32::from_le_bytes(octets[12..16].try_into().unwrap());
        assert!(
            lu_w != w || lu_h != h,
            "l'offset naïf rendrait {lu_w}×{lu_h} — s'il tombait juste, ce test dirait le contraire"
        );
        // Le vrai chemin, lui, retrouve les dimensions.
        let atlas = crate::g4tx::parse(&octets).expect("G4TX lisible");
        assert_eq!(
            (atlas.textures[0].width, atlas.textures[0].height),
            (w as i32, h as i32)
        );
    }

    #[test]
    fn la_recoloration_fait_l_aller_retour_et_garde_l_alpha() {
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        let filtre = Recolor {
            hue_shift: 120.0,
            ..Recolor::identity()
        };
        let r = recolour(&octets, &filtre, None).expect("recoloration");
        assert_eq!(r.recolorees, alloc::vec![("essai".to_string(), w, h)]);
        assert!(r.hors_cible.is_empty());
        assert!(r.illisibles.is_empty());

        let atlas = crate::g4tx::parse(&r.octets).expect("relecture");
        let (rw, rh, apres) =
            crate::g4tx_decode::decode_texture_rgba(&r.octets, &atlas.textures[0]).expect("décodé");
        assert_eq!((rw, rh), (w, h));
        // Rouge opaque → vert ; bleu semi-transparent → rouge ; les deux alphas tiennent.
        assert_eq!(&apres[0..4], &[0, 255, 0, 255]);
        assert_eq!(&apres[4..8], &[255, 0, 0, 128]);
    }

    #[test]
    fn une_rampe_repeint_sans_bouger_la_geometrie() {
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        let filtre = Recolor {
            ramp: Some(Ramp::from_three([0, 0, 0], [10, 20, 30], [255, 255, 255])),
            ..Recolor::identity()
        };
        let r = recolour(&octets, &filtre, None).expect("recoloration");
        let atlas = crate::g4tx::parse(&r.octets).expect("relecture");
        assert_eq!(
            (atlas.textures[0].width, atlas.textures[0].height),
            (w as i32, h as i32),
            "une rampe est à géométrie constante — les régions d'atlas restent valides"
        );
    }

    #[test]
    fn un_filtre_identite_est_refuse_plutot_que_de_reecrire_a_l_identique() {
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        let e = recolour(&octets, &Recolor::identity(), None).expect_err("refus attendu");
        assert!(e.contains("ne change rien"), "{e}");
    }

    #[test]
    fn une_cible_inconnue_liste_les_textures_disponibles() {
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        let filtre = Recolor {
            hue_shift: 30.0,
            ..Recolor::identity()
        };
        let e = recolour(&octets, &filtre, Some("absente")).expect_err("refus attendu");
        assert!(e.contains("essai"), "{e}");
    }

    #[test]
    fn une_charge_inchangee_est_recopiee_octet_pour_octet() {
        let (w, h, rgba) = damier();
        let octets = conteneur("essai", w, h, &rgba);
        let atlas = crate::g4tx::parse(&octets).expect("G4TX lisible");
        let refait =
            reencode_with_payloads(&octets, &atlas, &alloc::vec![NouvelleCharge::Inchangee])
                .expect("reconstruction");
        let a = &octets[atlas.textures[0].data_offset
            ..atlas.textures[0].data_offset + atlas.textures[0].data_size];
        let refaite = crate::g4tx::parse(&refait).expect("relecture");
        let b = &refait[refaite.textures[0].data_offset
            ..refaite.textures[0].data_offset + refaite.textures[0].data_size];
        assert_eq!(a, b);
    }
}
