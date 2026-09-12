//! La chaîne complète du rendu 3D, mesurée sur les VRAIS octets du jeu.
//!
//! `.g4md` + `.g4mg` → GLB → image RGBA8, par les mêmes fonctions que le module WebAssembly
//! appelle. Ce qui est éprouvé n'est pas la conformité à `nie.exe` — elle n'est pas mesurée ici,
//! et rien dans cette surface ne l'affirme — mais que la chaîne produit des pixels de modèle
//! plutôt qu'un fond vide, ce qui est exactement ce qu'un maillon cassé rendrait.
//!
//! Le test est conditionné aux données : la paire vit sous `var/`, hors dépôt. Sur une machine
//! qui ne porte pas le jeu il passe sans rien affirmer, comme les ~55 golden de `nie-data`.

use std::path::PathBuf;

/// Une paire de modèle réelle de ce montage.
fn paire() -> Option<(Vec<u8>, Vec<u8>)> {
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../var/outputs/hakuren-shawn/assets/character");
    let g4md = std::fs::read(base.join("c05024700.g4md")).ok()?;
    let g4mg = std::fs::read(base.join("c05024700.g4mg")).ok()?;
    Some((g4md, g4mg))
}

/// La couleur de fond à une ligne donnée, telle que le rastériseur la pose.
fn fond(y: u32, hauteur: u32) -> [u8; 4] {
    nie_render3d::render::couleur_fond(y, hauteur)
}

#[test]
fn les_octets_du_jeu_deviennent_des_pixels_de_modele() {
    let Some((g4md, g4mg)) = paire() else {
        eprintln!("paire de modèle absente de ce montage : test sauté");
        return;
    };

    let glb = nie_wasm::model_to_glb(&g4md, &g4mg).expect("assemblage GLB");
    assert_eq!(&glb[0..4], b"glTF", "l'assemblage doit rendre un GLB");

    let (largeur, hauteur) = (192, 192);
    let image = nie_wasm::model_render_rgba(&glb, 0.0, largeur, hauteur).expect("rendu");
    assert_eq!(image.len(), (largeur * hauteur * 4) as usize);

    // Un maillon cassé — géométrie vide, caméra hors champ, textures perdues — rendrait le fond
    // seul. On compte donc les pixels qui s'en écartent, et on en exige une part réelle.
    let mut peints = 0usize;
    for y in 0..hauteur {
        let attendu = fond(y, hauteur);
        for x in 0..largeur {
            let index = ((y * largeur + x) * 4) as usize;
            if image[index..index + 4] != attendu {
                peints += 1;
            }
        }
    }
    let total = (largeur * hauteur) as usize;
    eprintln!(
        "couverture mesurée : {peints}/{total} pixels ({} %), {} primitives",
        peints * 100 / total,
        nie_render3d::glb::parse_with_texture_budget(&glb, usize::MAX)
            .map_or(0, |model| model.primitives.len())
    );
    assert!(
        peints * 100 / total >= 5,
        "le modèle ne couvre que {peints}/{total} pixels : la chaîne rend un fond, pas un modèle"
    );

    // Tourner le modèle change l'image : sans cela, l'angle serait ignoré et le « rendu » ne
    // serait qu'une image figée.
    let tournee = nie_wasm::model_render_rgba(&glb, 1.57, largeur, hauteur).expect("rendu tourné");
    assert_ne!(image, tournee, "l'angle doit changer l'image rendue");
}

#[test]
fn des_octets_qui_ne_sont_pas_un_glb_sont_refuses() {
    let erreur = nie_wasm::model_render_rgba(b"pas un glb", 0.0, 8, 8).expect_err("doit refuser");
    assert!(
        erreur.contains("glTF"),
        "l'erreur doit nommer ce qui manque : {erreur}"
    );
}

/// Le CRC-32 exposé au navigateur est bien celui du jeu.
///
/// Il avait un jumeau en TypeScript, que rien ne comparait à celui-ci. Le vecteur canonique du
/// CRC-32 (IEEE 802.3) fixe la référence, et un nom d'objet réel fixe l'usage.
#[test]
fn le_crc32_du_navigateur_est_celui_du_jeu() {
    assert_eq!(nie_wasm::crc32("123456789"), 0xCBF4_3926);
    assert_eq!(nie_wasm::crc32(""), 0);
    // `layer_id == crc32(nom)` : le calque de la Banque, tel que le layout le nomme.
    assert_eq!(
        nie_wasm::crc32("team14_01_chara_bank_list"),
        nie_formats::cfgbin::crc32(b"team14_01_chara_bank_list")
    );
}

/// Les identifiants de calque FIGÉS dans les écrans valent bien ce que la fonction rend.
///
/// `PlayerBank.tsx` et `Shop.tsx` portent ces nombres en dur, parce qu'un module WebAssembly
/// n'est pas chargé quand un module TypeScript s'évalue. Une constante figée sans vérification
/// dérive dès que le calque est renommé, et l'écran se contenterait de ne rien peupler. Ici,
/// elle échoue au test.
#[test]
fn les_identifiants_de_calque_figes_dans_les_ecrans_sont_exacts() {
    // apps/nie-web/src/screens/PlayerBank.tsx
    assert_eq!(nie_wasm::crc32("team14_01_chara_bank_list"), 0x1ac9_9083);
    // apps/nie-web/src/screens/Shop.tsx
    assert_eq!(nie_wasm::crc32("shop01_01_list_base"), 0x992e_f302);
}
