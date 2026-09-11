//! `encode_dds_bc7` — le format de payload que portent réellement les icônes de portrait.
//!
//! Un conteneur en BGRA8 non compressé est structurellement correct et pèse quatre fois le
//! fichier mesuré. La référence `c02023290_l.g4tx` fait **131 648 octets** pour deux textures
//! 256×256 : c'est `2 × 65 536` octets de blocs BC7 plus les en-têtes, pas `2 × 262 144`.
//!
//! Ces tests ne tournent qu'avec la feature `textures-encode`.
#![cfg(feature = "textures-encode")]

use nie_formats::{g4tx, g4tx_decode, g4tx_encode};

/// Une image test 64×64 avec des aplats et un dégradé — de quoi que la compression ait
/// quelque chose à faire sans que la comparaison devienne un test de qualité de compresseur.
fn image_test(side: u32) -> Vec<u8> {
    let mut rgba = Vec::with_capacity((side * side * 4) as usize);
    for y in 0..side {
        for x in 0..side {
            let quadrant = (x < side / 2, y < side / 2);
            let pixel = match quadrant {
                (true, true) => [31, 127, 208, 255],
                (false, true) => [240, 160, 30, 255],
                (true, false) => [17, 18, 39, 255],
                (false, false) => {
                    let ramp = u8::try_from(x * 255 / side).unwrap_or(255);
                    [ramp, ramp, ramp, 255]
                }
            };
            rgba.extend_from_slice(&pixel);
        }
    }
    rgba
}

#[test]
fn le_bc7_pese_un_octet_par_pixel_la_ou_le_bgra8_en_pese_quatre() {
    let side = 256;
    let rgba = image_test(side);
    let bc7 = g4tx_encode::encode_dds_bc7(side, side, &rgba).expect("encodage BC7");
    let bgra = g4tx_encode::encode_dds_bgra8(side, side, &rgba).expect("encodage BGRA8");

    let pixels_bc7 = bc7.len() - 148; // magic + DDS_HEADER + DDS_HEADER_DXT10
    let pixels_bgra = bgra.len() - 128; // magic + DDS_HEADER
    assert_eq!(
        pixels_bc7,
        (side * side) as usize,
        "BC7 : un octet par pixel (blocs 4x4 sur 16 octets)"
    );
    assert_eq!(pixels_bgra, (side * side * 4) as usize, "BGRA8 : quatre");

    // Deux textures de cette taille plus les en-têtes : l'ordre de grandeur du fichier mesuré.
    let deux_textures = 2 * pixels_bc7;
    assert_eq!(deux_textures, 131_072);
    assert!(
        deux_textures < 131_648,
        "la référence mesurée laisse la place aux en-têtes"
    );
}

#[test]
fn un_conteneur_bc7_se_reparse_et_se_redecode() {
    let side = 64;
    let rgba = image_test(side);
    let dds = g4tx_encode::encode_dds_bc7(side, side, &rgba).expect("encodage BC7");

    let cote = i16::try_from(side).expect("côté");
    let conteneur = g4tx_encode::encode_g4tx_multi_texture(
        &[g4tx_encode::TextureAEcrire {
            name: "essai_1_l00",
            id: 0,
            width: cote,
            height: cote,
            dds: &dds,
        }],
        &[],
    )
    .expect("conteneur");

    let relu = g4tx::parse(&conteneur).expect("le conteneur BC7 doit se reparser");
    assert_eq!(relu.textures.len(), 1);
    assert_eq!(relu.textures[0].name, "essai_1_l00");
    assert_eq!(relu.textures[0].width, i32::from(cote));

    let (w, h, decode) = g4tx_decode::decode_texture_rgba(&conteneur, &relu.textures[0])
        .expect("le payload BC7 doit se redécoder");
    assert_eq!((w, h), (side, side));
    assert_eq!(decode.len(), rgba.len());

    // BC7 est un codec **avec perte** : on mesure l'écart, on ne prétend pas à l'identité. Les
    // aplats doivent revenir très proches ; le seuil est là pour attraper un canal inversé ou un
    // en-tête mal écrit, pas pour noter le compresseur.
    let ecart_max = rgba
        .chunks_exact(4)
        .zip(decode.chunks_exact(4))
        .flat_map(|(attendu, obtenu)| {
            (0..3).map(move |canal| i32::from(attendu[canal]).abs_diff(i32::from(obtenu[canal])))
        })
        .max()
        .unwrap_or(0);
    assert!(
        ecart_max <= 12,
        "écart maximal de {ecart_max} : un canal inversé ou un en-tête faux, pas de la compression"
    );
}
