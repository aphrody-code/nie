//! Vérification de bout en bout : ce que `ffprobe` lit dans le fichier produit.
//!
//! Le critère n'est JAMAIS l'apparence d'une image. Ce sont des compteurs : le nombre de trames
//! décodables, le nom du codec, les dimensions et la cadence. Un encodeur qui perd une image ou
//! qui réinterprète les horodatages est invisible à l'œil et net dans ces quatre nombres.

use nie_video::{Codec, Params, ouvrir};
use std::process::{Command, Stdio};

/// `true` si les deux binaires sont disponibles. Leur absence fait sauter le test plutôt
/// qu'échouer : l'encodage par sous-processus est un choix de licence, pas une dépendance dure.
fn outils_presents() -> bool {
    ["ffmpeg", "ffprobe"].iter().all(|o| {
        Command::new(o)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    })
}

fn sonder(fichier: &std::path::Path, champ: &str) -> String {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "v:0", "-count_frames"])
        .args(["-show_entries", &format!("stream={champ}")])
        .args(["-of", "default=noprint_wrappers=1:nokey=1"])
        .arg(fichier)
        .output()
        .expect("lancer ffprobe");
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

/// Une mire synthétique qui BOUGE : un dégradé dont l'origine se décale avec le numéro d'image.
/// Un contenu fixe se compresse en quelques octets et masquerait une trame perdue.
fn trame(params: &Params, i: u32) -> Vec<u8> {
    let mut px = vec![0u8; params.octets_par_trame()];
    for y in 0..params.hauteur {
        for x in 0..params.largeur {
            let o = ((y * params.largeur + x) * 4) as usize;
            px[o] = ((x + i * 3) % 256) as u8;
            px[o + 1] = ((y + i * 5) % 256) as u8;
            px[o + 2] = ((x + y + i * 7) % 256) as u8;
            px[o + 3] = 255;
        }
    }
    px
}

#[test]
fn cent_vingt_trames_poussees_donnent_cent_vingt_trames_decodables() {
    if !outils_presents() {
        eprintln!("ffmpeg/ffprobe absents : test ignoré");
        return;
    }
    let sortie = std::env::temp_dir().join("nie_video_bout_en_bout.mp4");
    let params = Params { largeur: 320, hauteur: 240, fps: 60, codec: Codec::H264, crf: 18 };

    let mut enc = ouvrir(&params, &sortie).expect("ouvrir l'encodeur");
    for i in 0..120u32 {
        enc.pousser_rgba(&trame(&params, i)).expect("pousser la trame");
    }
    assert_eq!(enc.images(), 120, "le compteur interne doit suivre les poussées");
    let resume = enc.finir().expect("finir l'encodage");

    assert_eq!(resume.images, 120);
    assert!(resume.octets > 0, "le fichier ne doit pas être vide");

    assert_eq!(sonder(&sortie, "codec_name"), "h264");
    assert_eq!(sonder(&sortie, "width"), "320");
    assert_eq!(sonder(&sortie, "height"), "240");
    assert_eq!(sonder(&sortie, "r_frame_rate"), "60/1");
    // Le compteur qui tranche : `nb_read_frames` compte les trames RÉELLEMENT décodées, là où
    // `nb_frames` peut venir d'un en-tête que personne n'a vérifié.
    assert_eq!(sonder(&sortie, "nb_read_frames"), "120");

    let _ = std::fs::remove_file(&sortie);
}

/// La cadence déclarée doit atteindre le conteneur : une séquence à 24 i/s ne doit pas ressortir
/// à 60. C'est exactement ce qu'un `-framerate` placé après `-i` casserait, en silence.
#[test]
fn la_cadence_declaree_atteint_le_conteneur() {
    if !outils_presents() {
        eprintln!("ffmpeg/ffprobe absents : test ignoré");
        return;
    }
    let sortie = std::env::temp_dir().join("nie_video_cadence.mp4");
    let params = Params { largeur: 64, hauteur: 64, fps: 24, codec: Codec::H264, crf: 18 };
    let mut enc = ouvrir(&params, &sortie).expect("ouvrir");
    for i in 0..24u32 {
        enc.pousser_rgba(&trame(&params, i)).expect("pousser");
    }
    let resume = enc.finir().expect("finir");
    assert_eq!(resume.fps, 24);
    assert_eq!(sonder(&sortie, "r_frame_rate"), "24/1");
    assert_eq!(sonder(&sortie, "nb_read_frames"), "24");
    let _ = std::fs::remove_file(&sortie);
}

/// Le même flux poussé deux fois doit donner le même fichier. Sans cette propriété, aucune
/// séquence rendue n'est régressable — c'est elle qui rend un golden possible en aval.
#[test]
fn deux_encodages_du_meme_flux_donnent_le_meme_fichier() {
    if !outils_presents() {
        eprintln!("ffmpeg/ffprobe absents : test ignoré");
        return;
    }
    let params = Params { largeur: 64, hauteur: 64, fps: 30, codec: Codec::H264, crf: 18 };
    let mut tailles = Vec::new();
    let mut contenus = Vec::new();
    for tour in 0..2 {
        let sortie = std::env::temp_dir().join(format!("nie_video_det_{tour}.mp4"));
        let mut enc = ouvrir(&params, &sortie).expect("ouvrir");
        for i in 0..30u32 {
            enc.pousser_rgba(&trame(&params, i)).expect("pousser");
        }
        let r = enc.finir().expect("finir");
        tailles.push(r.octets);
        contenus.push(std::fs::read(&sortie).expect("relire"));
        let _ = std::fs::remove_file(&sortie);
    }
    assert_eq!(tailles[0], tailles[1], "tailles divergentes");
    assert_eq!(contenus[0], contenus[1], "octets divergents");
}
