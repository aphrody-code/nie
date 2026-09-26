//! Atlas d'icônes du jeu → feuille de sprites exploitable sur le web.
//!
//! Les `.g4tx` d'interface ne sont pas des images simples : ce sont des **atlas**. Le conteneur
//! décrit lui-même ses régions ([`crate::g4tx::G4txSubTexture`] : nom + rectangle), et le jeu les
//! adresse au runtime par `SetIconSprite(obj, CRC32(chemin), CRC32(région))`. `gaiji_game.g4tx`
//! en compte 117.
//!
//! Seule la lecture des régions d'un `.g4tx` ([`depuis_g4tx`]) est propre au jeu et reste ici.
//! La feuille elle-même (CSS image/masque, SVG `<symbol>`, JSON) appartient à la crate
//! `aphrody-sprite-sheet` d'aphrody-ui, réexportée telle quelle : un sprite du jeu et un sprite
//! du pet Aphrody s'écrivent par le même code.

pub use aphrody_sprite_sheet::{ModeCss, PREFIXE, Sprite, SpriteSheet, assainir_nom, data_uri};

use crate::g4tx::G4tx;

/// Extrait la feuille de sprites d'un atlas déjà parsé.
///
/// `index_texture` désigne la texture porteuse (0 pour la principale). Rend `None` si l'index
/// n'existe pas. Une texture **sans** région rend une feuille vide : ce n'est pas une erreur, la
/// plupart des `.g4tx` sont des images simples.
#[must_use]
pub fn depuis_g4tx(g4tx: &G4tx, index_texture: usize) -> Option<SpriteSheet> {
    let t = g4tx.textures.get(index_texture)?;
    let sprites = t
        .sub_textures
        .iter()
        .map(|s| Sprite {
            nom: s.name.clone(),
            classe: assainir_nom(&s.name),
            x: i32::from(s.x),
            y: i32::from(s.y),
            largeur: i32::from(s.width),
            hauteur: i32::from(s.height),
        })
        .collect();
    Some(SpriteSheet {
        nom: t.name.clone(),
        largeur: t.width,
        hauteur: t.height,
        sprites,
    })
}

#[cfg(test)]
mod tests {
    extern crate alloc;
    use super::*;
    use crate::g4tx::{G4txSubTexture, G4txTexture};
    use alloc::vec::Vec;

    #[test]
    fn les_regions_du_g4tx_deviennent_des_sprites() {
        let mut t = G4txTexture {
            id: 0,
            name: "gaiji_game".into(),
            width: 512,
            height: 256,
            is_dds: true,
            data_offset: 0,
            data_size: 0,
            sub_textures: Vec::new(),
        };
        t.sub_textures.push(G4txSubTexture {
            id: 1,
            name: "gtxt_rarity01_05".into(),
            x: 128,
            y: 64,
            width: 96,
            height: 32,
        });
        let entete = crate::g4tx::G4txHeader {
            header_size: 0x60,
            file_type: 0x65,
            table_size: 0,
            texture_count: 1,
            total_count: 2,
            sub_texture_count: 1,
            texture_data_size: 0,
        };
        let g = G4tx {
            header: entete,
            textures: alloc::vec![t],
        };

        let f = depuis_g4tx(&g, 0).expect("texture 0");
        assert_eq!(f.nom, "gaiji_game");
        assert_eq!(f.len(), 1);
        assert_eq!(f.sprites[0].x, 128);
        assert_eq!(f.sprites[0].largeur, 96);
        assert!(depuis_g4tx(&g, 9).is_none(), "index hors bornes");
    }
}
