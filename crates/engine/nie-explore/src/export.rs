//! Export d'un fichier du jeu **au format voulu** — quels formats sont possibles pour un fichier
//! donné, comment nommer le résultat, et comment produire les octets.
//!
//! Les décodeurs existaient tous (`nie_formats::image_out`, `::decode`, `::cri_audio`) ; ce qui
//! manquait, c'est la table qui dit **ce qui est possible pour ce fichier-ci**. Sans elle, une
//! interface ne peut que proposer un catalogue optimiste et échouer après coup, ou n'offrir que
//! l'extraction brute — un `.g4tx` sorti tel quel restant illisible hors du jeu.
//!
//! | Source | Formats |
//! |---|---|
//! | `.g4tx` | png, webp, jpg, bmp, tga, tiff, qoi, gif + json (en-têtes) |
//! | `.g4md`/`.g4mg` | glb *(contextuel, cf. plus bas)* + json |
//! | `.acb`/`.awb`/`.hca`/`.adx` | wav |
//! | `.usm` | mp4 *(contextuel)* |
//! | `.cfg.bin`, `.objbin`, `.mevbin`, `.lip`, `.g4pk`… | json |
//! | tout | **brut** — les octets du jeu, inchangés |
//!
//! ## Formats contextuels
//!
//! Deux conversions ne se déduisent pas des octets du fichier seul :
//!
//! * **`glb`** a besoin des fichiers FRÈRES (le `.g4mg` et le `.g4tx` de même radical), donc d'un
//!   VFS monté et d'une résolution de voisinage ;
//! * **`mp4`** a besoin de `ffmpeg`, un binaire externe.
//!
//! [`produire`] les REFUSE explicitement plutôt que de les rater en silence
//! ([`necessite_contexte`] permet à l'appelant de les intercepter avant). Ils restent listés par
//! [`formats_pour`] : c'est bien l'interface qui doit les proposer, simplement pas cette fonction
//! qui les produit.

use alloc::string::{String, ToString};
use alloc::vec;
use alloc::vec::Vec;

extern crate alloc;

/// Un format d'export proposé pour un fichier donné.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatExport {
    /// Identifiant à repasser à [`produire`] (`raw`, `png`, `glb`, `json`, `wav`, `mp4`…).
    pub id: String,
    /// Extension du fichier produit, sans le point.
    pub ext: String,
    /// Libellé affichable.
    pub label: String,
    /// Vrai pour « tel quel » : aucune conversion, donc aucune perte possible.
    pub brut: bool,
    /// Faux quand la conversion peut dégrader (JPEG, GIF) — à dire AVANT l'export, pas après.
    pub sans_perte: bool,
}

impl FormatExport {
    fn new(id: &str, ext: &str, label: &str, brut: bool, sans_perte: bool) -> Self {
        Self {
            id: id.to_string(),
            ext: ext.to_string(),
            label: label.to_string(),
            brut,
            sans_perte,
        }
    }
}

/// Extension en minuscules d'un chemin VFS (`""` s'il n'en a pas).
fn ext_de(path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    base.rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// Vrai pour les conteneurs que `nie_formats::decode` sait rendre en JSON.
fn est_donnee_structuree(path: &str, ext: &str) -> bool {
    let bas = path.to_ascii_lowercase();
    bas.ends_with(".cfg.bin")
        || matches!(
            ext,
            "bin" | "objbin" | "mevbin" | "lip" | "g4pk" | "g4pkm" | "cpk" | "clobin" | "linb"
        )
}

/// Vrai si `format` exige un contexte que [`produire`] n'a pas — cf. § « Formats contextuels ».
#[must_use]
pub fn necessite_contexte(format: &str) -> bool {
    matches!(format, "glb" | "mp4")
}

/// Formats d'image proposés pour une texture, dans l'ordre d'affichage.
fn formats_image() -> Vec<FormatExport> {
    nie_formats::image_out::ImageOut::TOUS
        .iter()
        .map(|f| {
            let ext = f.extension();
            let label = match ext {
                "png" => "PNG (sans perte, référence)",
                "webp" => "WebP (sans perte)",
                "gif" => "GIF (256 couleurs — avec perte)",
                "jpg" => "JPEG (avec perte)",
                "bmp" => "BMP",
                "tga" => "TGA",
                "tiff" => "TIFF",
                "qoi" => "QOI",
                autre => autre,
            };
            FormatExport::new(ext, ext, label, false, f.sans_perte())
        })
        .collect()
}

/// Formats d'export possibles pour `path`, le brut en tête.
///
/// Dérivé du NOM seul : aucune lecture du fichier, donc appelable à chaque changement de
/// sélection dans une interface sans coût.
#[must_use]
pub fn formats_pour(path: &str) -> Vec<FormatExport> {
    let ext = ext_de(path);
    let mut out = vec![FormatExport::new(
        "raw",
        if ext.is_empty() { "bin" } else { &ext },
        "Fichier d'origine (aucune conversion)",
        true,
        true,
    )];

    match ext.as_str() {
        "g4tx" => {
            out.extend(formats_image());
            out.push(FormatExport::new("json", "json", "JSON (en-têtes de texture)", false, true));
        }
        "g4md" | "g4mg" => {
            out.push(FormatExport::new("glb", "glb", "glTF binaire (géométrie + texture)", false, true));
            out.push(FormatExport::new("json", "json", "JSON (structure décodée)", false, true));
        }
        "acb" | "awb" | "hca" | "adx" => {
            out.push(FormatExport::new("wav", "wav", "WAV PCM 16 bits", false, true));
        }
        "usm" => {
            out.push(FormatExport::new("mp4", "mp4", "MP4 (H.264 remuxé, ffmpeg requis)", false, true));
        }
        _ => {}
    }

    // `.cfg.bin` a une DOUBLE extension : le match ci-dessus ne la voit pas. Le JSON n'est ajouté
    // qu'une fois — un `.g4tx` a déjà le sien.
    if est_donnee_structuree(path, &ext) && !out.iter().any(|f| f.id == "json") {
        out.push(FormatExport::new("json", "json", "JSON (données décodées)", false, true));
    }
    out
}

/// Nom de fichier proposé pour `path` exporté en `format` : le nom d'origine avec l'extension du
/// format, sans le chemin.
///
/// `.cfg.bin` → `x.json`, pas `x.cfg.json` : c'est la double extension qui piège une simple
/// substitution du dernier segment.
#[must_use]
pub fn nom_propose(path: &str, format: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    if format == "raw" {
        return base.to_string();
    }
    let ext_sortie = formats_pour(path)
        .into_iter()
        .find(|f| f.id == format)
        .map_or_else(|| format.to_string(), |f| f.ext);
    let radical = base
        .strip_suffix(".cfg.bin")
        .unwrap_or_else(|| base.rsplit_once('.').map_or(base, |(s, _)| s));
    alloc::format!("{radical}.{ext_sortie}")
}

/// Convertit `data` (le contenu de `path`) vers `format`.
///
/// # Erreurs
///
/// Rend un message si le format est inconnu, s'il exige un contexte que cette fonction n'a pas
/// (cf. [`necessite_contexte`]), ou si le décodage échoue.
pub fn produire(path: &str, data: Vec<u8>, format: &str) -> Result<Vec<u8>, String> {
    match format {
        "raw" => Ok(data),

        "json" => nie_formats::decode::to_json(&data)
            .ok_or_else(|| alloc::format!("aucun décodeur JSON ne reconnaît « {path} »")),

        "wav" => nie_formats::cri_audio::decode_to_wav(&data),

        f if necessite_contexte(f) => Err(alloc::format!(
            "le format « {f} » demande un contexte que ce décodeur n'a pas \
             (fichiers frères pour glb, ffmpeg pour mp4)"
        )),

        autre => {
            let img = nie_formats::image_out::ImageOut::depuis_extension(autre)
                .ok_or_else(|| alloc::format!("format d'export inconnu : « {autre} »"))?;
            nie_formats::image_out::g4tx_vers(&data, nie_formats::g4tx_decode::basename_of(path), img)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_brut_est_toujours_propose_et_en_tete() {
        for p in ["a/b.g4tx", "a/b.g4md", "a/b.awb", "a/b.usm", "a/b.cfg.bin", "a/b.inconnu", "sansext"] {
            let f = formats_pour(p);
            assert_eq!(f[0].id, "raw", "{p}");
            assert!(f[0].brut, "{p}");
        }
    }

    #[test]
    fn une_texture_propose_les_huit_formats_image_et_le_json() {
        let ids: Vec<String> = formats_pour("x/y.g4tx").into_iter().map(|f| f.id).collect();
        for attendu in ["raw", "png", "webp", "gif", "jpg", "bmp", "tga", "tiff", "qoi", "json"] {
            assert!(ids.contains(&attendu.to_string()), "{attendu} manquant : {ids:?}");
        }
    }

    #[test]
    fn les_formats_avec_perte_sont_annonces() {
        let f = formats_pour("x/y.g4tx");
        let perte = |id: &str| f.iter().find(|f| f.id == id).expect("format présent").sans_perte;
        assert!(perte("png"));
        assert!(perte("webp"));
        assert!(!perte("jpg"), "JPEG perd de l'information");
        assert!(!perte("gif"), "GIF quantifie sur 256 couleurs");
    }

    #[test]
    fn chaque_famille_propose_sa_conversion() {
        let ids = |p: &str| formats_pour(p).into_iter().map(|f| f.id).collect::<Vec<_>>();
        assert!(ids("c/x.g4md").contains(&"glb".to_string()));
        assert!(ids("c/x.awb").contains(&"wav".to_string()));
        assert!(ids("c/x.hca").contains(&"wav".to_string()));
        assert!(ids("c/x.usm").contains(&"mp4".to_string()));
        assert!(ids("c/x.cfg.bin").contains(&"json".to_string()));
        // Un fichier sans décodeur connu ne propose QUE le brut : proposer un JSON qui échouera
        // vaut moins que de dire tout de suite qu'il n'y en a pas.
        assert_eq!(ids("c/x.p3lip"), vec!["raw".to_string()]);
    }

    #[test]
    fn le_json_n_est_jamais_propose_deux_fois() {
        let ids = formats_pour("x/y.g4tx").into_iter().map(|f| f.id).collect::<Vec<_>>();
        assert_eq!(ids.iter().filter(|i| *i == "json").count(), 1);
    }

    #[test]
    fn le_nom_propose_remplace_la_bonne_extension() {
        assert_eq!(nom_propose("a/b/c01000010.g4tx", "png"), "c01000010.png");
        assert_eq!(nom_propose("a/b/c01000010.g4tx", "raw"), "c01000010.g4tx");
        assert_eq!(nom_propose("a/b/x.g4md", "glb"), "x.glb");
        assert_eq!(nom_propose("a/b/x.awb", "wav"), "x.wav");
        // La double extension doit disparaître ENTIÈREMENT, pas laisser un `.cfg`.
        assert_eq!(nom_propose("a/b/skill_config.cfg.bin", "json"), "skill_config.json");
        // `jpg`, pas `jpeg` : le nom suit l'extension canonique du format.
        assert_eq!(nom_propose("a/b/t.g4tx", "jpg"), "t.jpg");
    }

    #[test]
    fn le_brut_ne_touche_pas_aux_octets() {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF];
        assert_eq!(produire("x/y.zzz", data.clone(), "raw").unwrap(), data);
    }

    #[test]
    fn un_format_inconnu_ou_contextuel_est_refuse_explicitement() {
        assert!(produire("x/y.g4tx", vec![0; 4], "psd").is_err());
        // Contextuels : refusés ICI, mais bien proposés par `formats_pour` — c'est l'appelant qui
        // les sert. Les rater en silence serait pire que les refuser.
        assert!(necessite_contexte("glb") && necessite_contexte("mp4"));
        assert!(produire("x/y.g4md", vec![0; 4], "glb").is_err());
        assert!(produire("x/y.usm", vec![0; 4], "mp4").is_err());
    }

    /// Chaîne d'export sur le VRAI jeu. Le magic est vérifié : un décodeur qui rendrait du brut
    /// déguisé ou un tampon vide passerait n'importe quel test de taille.
    ///
    /// Le corpus (`data/`, 57 Go, © Level-5) est absent du clone public : le test ANNONCE son
    /// saut plutôt que de passer en silence.
    #[test]
    fn conversion_reelle_texture_et_donnees() {
        // `resolve_game_dir` : `NIE_GAME_DIR`, sinon un ancêtre du répertoire courant portant
        // `data/cpk_list.cfg.bin`. Le cwd d'un `cargo test` est le dossier de la CRATE, pas la
        // racine du dépôt — sans la remontée d'ancêtres, le corpus réel serait toujours « absent »
        // et ces deux tests passeraient en sautant, pour toujours.
        let racine = nie_formats::vfs::resolve_game_dir();
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(racine.join("data")).is_err() {
            eprintln!("SAUTÉ : VFS réel indisponible sous {} (corpus du jeu absent)", racine.display());
            return;
        }

        let tex = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.ends_with(".g4tx"));
        let Some(tex) = tex else {
            eprintln!("SAUTÉ : aucune texture dans le VFS monté");
            return;
        };
        let data = vfs.read(&tex).expect("lecture g4tx");

        let png = produire(&tex, data.clone(), "png").expect("export PNG");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "PNG attendu");
        let webp = produire(&tex, data.clone(), "webp").expect("export WebP");
        assert_eq!(&webp[..4], b"RIFF");
        assert_eq!(&webp[8..12], b"WEBP");
        let qoi = produire(&tex, data.clone(), "qoi").expect("export QOI");
        assert_eq!(&qoi[..4], b"qoif");
        assert_eq!(produire(&tex, data.clone(), "raw").expect("brut"), data);

        // Données structurées → JSON réellement parsable.
        if let Some(cfg) = vfs.iter().map(|(p, _)| p.to_string()).find(|p| p.ends_with(".cfg.bin")) {
            let brut = vfs.read(&cfg).expect("lecture cfg.bin");
            let json = produire(&cfg, brut, "json").expect("export JSON");
            let valeur: serde_json::Value = serde_json::from_slice(&json).expect("JSON valide");
            assert!(valeur.is_object() || valeur.is_array(), "JSON structuré attendu");
        }
    }

    /// Ce que coûte une grille de fichiers : vignette bornée contre pleine résolution, sur les
    /// VRAIES icônes du dossier qui tuait la fenêtre
    /// (`data/dx11/menu/200_icon/10_icon_chr/uniform`, 12 560 `.g4tx`).
    ///
    /// C'est la mesure qui justifie `vfs_texture_thumb_png_b64` : la grille affiche des images de
    /// moins de 90 px, et servir la pleine résolution transférait puis décodait des mégaoctets par
    /// entrée dans le processus de rendu.
    #[test]
    fn une_vignette_coute_bien_moins_que_la_pleine_resolution() {
        let racine = nie_formats::vfs::resolve_game_dir();
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(racine.join("data")).is_err() {
            eprintln!("SAUTÉ : VFS réel indisponible (corpus du jeu absent)");
            return;
        }
        let echantillon: Vec<String> = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .filter(|p| p.ends_with(".g4tx"))
            .take(12)
            .collect();
        if echantillon.is_empty() {
            eprintln!("SAUTÉ : aucune texture dans le VFS monté");
            return;
        }

        let (mut total_plein, mut total_vignette) = (0usize, 0usize);
        for path in &echantillon {
            let data = vfs.read(path).expect("lecture g4tx");
            let base = nie_formats::g4tx_decode::basename_of(path);
            let plein = nie_formats::g4tx_decode::decode_best_to_png(&data, base).expect("PNG plein");
            let vignette = nie_formats::image_out::g4tx_vignette(
                &data,
                base,
                128,
                nie_formats::image_out::ImageOut::Png,
            )
            .expect("vignette");
            total_plein += plein.len();
            total_vignette += vignette.len();
        }

        let facteur = total_plein as f64 / total_vignette.max(1) as f64;
        eprintln!(
            "{} textures : pleine résolution {} kio, vignettes {} kio (÷{facteur:.1})",
            echantillon.len(),
            total_plein / 1024,
            total_vignette / 1024,
        );
        assert!(
            facteur >= 4.0,
            "la vignette doit coûter au moins 4× moins que la pleine résolution (mesuré ÷{facteur:.1})"
        );
    }

    /// Audio réel → WAV. Séparé : il passe par un décodeur indépendant (`cri_audio`, clé IEVR).
    #[test]
    fn conversion_reelle_audio() {
        // `resolve_game_dir` : `NIE_GAME_DIR`, sinon un ancêtre du répertoire courant portant
        // `data/cpk_list.cfg.bin`. Le cwd d'un `cargo test` est le dossier de la CRATE, pas la
        // racine du dépôt — sans la remontée d'ancêtres, le corpus réel serait toujours « absent »
        // et ces deux tests passeraient en sautant, pour toujours.
        let racine = nie_formats::vfs::resolve_game_dir();
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(racine.join("data")).is_err() {
            eprintln!("SAUTÉ : VFS réel indisponible (corpus du jeu absent)");
            return;
        }
        // `.awb` et non `.hca` : le jeu n'expose pas de HCA autonome, ils vivent tous dans un banc
        // AWB — c'est donc le vrai chemin d'export audio de l'explorateur.
        let Some(son) = vfs.iter().map(|(p, _)| p.to_string()).find(|p| p.ends_with(".awb")) else {
            eprintln!("SAUTÉ : aucun .awb dans le VFS monté");
            return;
        };
        let data = vfs.read(&son).expect("lecture awb");
        let wav = produire(&son, data, "wav").expect("export WAV");
        assert_eq!(&wav[..4], b"RIFF", "WAV attendu");
        assert_eq!(&wav[8..12], b"WAVE");
    }
}
