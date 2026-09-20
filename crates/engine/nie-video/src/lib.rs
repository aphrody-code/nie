//! Encodage vidéo : des trames RGBA vers un fichier, **en flux**.
//!
//! # Pourquoi cette crate existe
//!
//! Le motif « écrire N fichiers PNG dans un répertoire temporaire, puis lancer `ffmpeg -i
//! f_%04d.png` » était recopié à l'identique sur **trois** sites :
//! `nie-render3d/src/main.rs`, `nie-runtime/src/main.rs` et `nie-runtime/src/bin/match3d.rs`.
//! Les trois ne différaient que par le gabarit du nom de fichier (`f_%04d.png` contre
//! `frame_%05d.png`) et le texte de l'erreur. Un quatrième appelant arrivant (l'orchestrateur de
//! séquences), la duplication est extraite ici AVANT d'être augmentée.
//!
//! Ce qui n'est **pas** dans le périmètre : `nie-explore/src/cinema/browser_video.rs` remuxe une
//! vidéo produite par un navigateur, il n'encode pas une séquence rendue. Ne pas le « dédupliquer »
//! vers ici — il ne fait pas le même travail.
//!
//! # Flux, et non répertoire
//!
//! L'API prend les trames une à une ([`Encodeur::pousser_rgba`]) et les pousse sur l'entrée
//! standard de l'encodeur. Aucun PNG intermédiaire, aucun répertoire temporaire, et l'empreinte
//! mémoire ne dépend pas de la longueur de la séquence. Une séquence de 465 images en 1280×720
//! coûtait 465 encodages PNG et ~400 Mio de disque ; elle ne coûte plus rien de tout cela.
//!
//! # Licence
//!
//! La dorsale par défaut **lance le binaire `ffmpeg` en sous-processus**. Ce n'est pas de
//! l'édition de liens, donc aucune contamination GPL, y compris avec le build
//! `--enable-gpl --enable-libx264` installé sur cette machine. Lier `ffmpeg-next` / `video-rs`
//! ferait basculer le binaire en GPL-2.0+ ; voir `docs/VIDEO-STACK.md`, qui a déjà tranché.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

/// Ce qui peut échouer à l'encodage.
#[derive(Debug, thiserror::Error)]
pub enum VideoError {
    /// Le binaire de l'encodeur n'a pas pu être lancé (absent du `PATH`, le plus souvent).
    #[error("lancer `{outil}` : {source} — est-il installé et dans le PATH ?")]
    Lancement {
        /// Nom du binaire recherché.
        outil: &'static str,
        /// L'erreur système d'origine.
        #[source]
        source: std::io::Error,
    },
    /// L'écriture d'une trame sur l'entrée de l'encodeur a échoué.
    #[error("écrire la trame {image} : {source}")]
    Ecriture {
        /// Numéro (0-indexé) de la trame fautive.
        image: u64,
        /// L'erreur système d'origine.
        #[source]
        source: std::io::Error,
    },
    /// La trame n'a pas la taille attendue pour les dimensions déclarées.
    #[error("trame {image} : {recu} octets reçus, {attendu} attendus ({largeur}×{hauteur}×4)")]
    TailleTrame {
        /// Numéro (0-indexé) de la trame fautive.
        image: u64,
        /// Octets effectivement fournis.
        recu: usize,
        /// Octets exigés par les dimensions.
        attendu: usize,
        /// Largeur déclarée.
        largeur: u32,
        /// Hauteur déclarée.
        hauteur: u32,
    },
    /// L'encodeur s'est terminé sur un code non nul.
    #[error("`{outil}` a échoué (code {code:?})")]
    Sortie {
        /// Nom du binaire.
        outil: &'static str,
        /// Code de sortie, `None` si tué par un signal.
        code: Option<i32>,
    },
    /// Dimensions ou cadence invalides.
    #[error("paramètres invalides : {0}")]
    Parametres(&'static str),
}

/// Le codec de sortie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    /// H.264 en MP4, par sous-processus `ffmpeg`. Le défaut : lisible partout.
    H264,
    /// VP9 en WebM, par sous-processus `ffmpeg`.
    Vp9,
    /// AV1 en WebM, par sous-processus `ffmpeg` (`libaom-av1`).
    Av1,
}

impl Codec {
    /// L'encodeur `ffmpeg` correspondant.
    #[must_use]
    pub const fn encodeur_ffmpeg(self) -> &'static str {
        match self {
            Self::H264 => "libx264",
            Self::Vp9 => "libvpx-vp9",
            Self::Av1 => "libaom-av1",
        }
    }

    /// Le nom que `ffprobe` rend dans `stream=codec_name` — c'est par lui que la vérification
    /// de bout en bout s'écrit, donc il vaut mieux qu'il soit porté par le type.
    #[must_use]
    pub const fn nom_ffprobe(self) -> &'static str {
        match self {
            Self::H264 => "h264",
            Self::Vp9 => "vp9",
            Self::Av1 => "av1",
        }
    }
}

/// Les paramètres d'une séquence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Params {
    /// Largeur en pixels.
    pub largeur: u32,
    /// Hauteur en pixels.
    pub hauteur: u32,
    /// Cadence, en images par seconde.
    pub fps: u32,
    /// Codec de sortie.
    pub codec: Codec,
    /// Qualité, au sens du CRF de `ffmpeg` : 0 = sans perte, 51 = infâme. 23 est le défaut de
    /// x264 ; on retient 18, « visuellement sans perte », parce que ces sorties servent de
    /// référence de comparaison et non de diffusion.
    pub crf: u8,
}

impl Params {
    /// Des paramètres H.264 720p60, le cas courant.
    #[must_use]
    pub const fn h264_720p60() -> Self {
        Self { largeur: 1280, hauteur: 720, fps: 60, codec: Codec::H264, crf: 18 }
    }

    /// Octets attendus pour une trame RGBA.
    #[must_use]
    pub const fn octets_par_trame(&self) -> usize {
        self.largeur as usize * self.hauteur as usize * 4
    }

    fn valider(&self) -> Result<(), VideoError> {
        if self.largeur == 0 || self.hauteur == 0 {
            return Err(VideoError::Parametres("largeur et hauteur doivent être non nulles"));
        }
        // yuv420p sous-échantillonne la chrominance d'un facteur 2 sur les deux axes : une
        // dimension impaire fait échouer ffmpeg avec un message qui accuse le filtre, pas l'appelant.
        if !self.largeur.is_multiple_of(2) || !self.hauteur.is_multiple_of(2) {
            return Err(VideoError::Parametres("largeur et hauteur doivent être paires (yuv420p)"));
        }
        if self.fps == 0 {
            return Err(VideoError::Parametres("fps doit être non nul"));
        }
        Ok(())
    }
}

/// Ce qu'a produit un encodage terminé.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resume {
    /// Taille du fichier écrit, en octets.
    pub octets: u64,
    /// Nombre de trames poussées.
    pub images: u64,
    /// Codec employé.
    pub codec: Codec,
    /// Cadence déclarée.
    pub fps: u32,
    /// Chemin du fichier écrit.
    pub sortie: PathBuf,
}

/// Un encodeur ouvert, qui consomme des trames RGBA dans l'ordre.
pub trait Encodeur {
    /// Pousse une trame RGBA de `largeur × hauteur × 4` octets.
    ///
    /// # Errors
    ///
    /// [`VideoError::TailleTrame`] si la tranche n'a pas la longueur attendue,
    /// [`VideoError::Ecriture`] si l'encodeur a fermé son entrée (typiquement parce qu'il a
    /// lui-même échoué — [`Encodeur::finir`] en rendra alors la cause).
    fn pousser_rgba(&mut self, px: &[u8]) -> Result<(), VideoError>;

    /// Ferme l'entrée, attend l'encodeur et rend le bilan.
    ///
    /// # Errors
    ///
    /// [`VideoError::Sortie`] si l'encodeur s'est terminé sur un code non nul.
    fn finir(self: Box<Self>) -> Result<Resume, VideoError>;

    /// Nombre de trames déjà poussées.
    fn images(&self) -> u64;
}

/// Ouvre un encodeur vers `sortie`.
///
/// # Errors
///
/// [`VideoError::Parametres`] si les dimensions ou la cadence sont invalides,
/// [`VideoError::Lancement`] si `ffmpeg` est introuvable.
pub fn ouvrir(params: &Params, sortie: &Path) -> Result<Box<dyn Encodeur>, VideoError> {
    params.valider()?;
    Ok(Box::new(SousProcessus::ouvrir(*params, sortie)?))
}

/// L'encodeur par sous-processus `ffmpeg`, alimenté en `rawvideo` sur `stdin`.
struct SousProcessus {
    params: Params,
    sortie: PathBuf,
    enfant: Child,
    images: u64,
}

const OUTIL: &str = "ffmpeg";

impl SousProcessus {
    fn ouvrir(params: Params, sortie: &Path) -> Result<Self, VideoError> {
        let taille = format!("{}x{}", params.largeur, params.hauteur);
        let fps = params.fps.to_string();
        let crf = params.crf.to_string();

        let mut cmd = Command::new(OUTIL);
        cmd.args(["-y", "-loglevel", "error"])
            // Entrée : trames brutes, pas un conteneur. `-framerate` DOIT précéder `-i` : placé
            // après, ffmpeg le lit comme une option de sortie et réinterprète les horodatages.
            .args(["-f", "rawvideo", "-pix_fmt", "rgba"])
            .args(["-s", &taille])
            .args(["-framerate", &fps])
            .args(["-i", "-"])
            .args(["-c:v", params.codec.encodeur_ffmpeg()])
            .args(["-crf", &crf])
            .args(["-pix_fmt", "yuv420p"])
            // Sans cela, la cadence du conteneur peut diverger de celle de l'entrée, et
            // `ffprobe … r_frame_rate` — le critère de vérification — ne rend plus `fps/1`.
            .args(["-r", &fps])
            .arg(sortie)
            .stdin(Stdio::piped())
            .stdout(Stdio::null());

        let enfant = cmd
            .spawn()
            .map_err(|source| VideoError::Lancement { outil: OUTIL, source })?;

        Ok(Self { params, sortie: sortie.to_path_buf(), enfant, images: 0 })
    }
}

impl Encodeur for SousProcessus {
    fn pousser_rgba(&mut self, px: &[u8]) -> Result<(), VideoError> {
        let attendu = self.params.octets_par_trame();
        if px.len() != attendu {
            return Err(VideoError::TailleTrame {
                image: self.images,
                recu: px.len(),
                attendu,
                largeur: self.params.largeur,
                hauteur: self.params.hauteur,
            });
        }
        let entree = self
            .enfant
            .stdin
            .as_mut()
            .ok_or(VideoError::Parametres("entrée de l'encodeur déjà fermée"))?;
        entree
            .write_all(px)
            .map_err(|source| VideoError::Ecriture { image: self.images, source })?;
        self.images += 1;
        Ok(())
    }

    fn finir(mut self: Box<Self>) -> Result<Resume, VideoError> {
        // Fermer l'entrée est ce qui signale la fin du flux : sans ce `take`, ffmpeg attend
        // indéfiniment et `wait` ne rend jamais la main.
        let _ = self.enfant.stdin.take();
        let status = self
            .enfant
            .wait()
            .map_err(|source| VideoError::Lancement { outil: OUTIL, source })?;
        if !status.success() {
            return Err(VideoError::Sortie { outil: OUTIL, code: status.code() });
        }
        let octets = std::fs::metadata(&self.sortie).map(|m| m.len()).unwrap_or(0);
        Ok(Resume {
            octets,
            images: self.images,
            codec: self.params.codec,
            fps: self.params.fps,
            sortie: self.sortie.clone(),
        })
    }

    fn images(&self) -> u64 {
        self.images
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_dimensions_impaires_sont_refusees_avant_de_lancer_ffmpeg() {
        // yuv420p ne peut pas sous-échantillonner une dimension impaire. Refuser ici donne une
        // erreur qui nomme l'appelant ; laisser passer donne un message de ffmpeg sur un filtre.
        let p = Params { largeur: 1281, hauteur: 720, fps: 60, codec: Codec::H264, crf: 18 };
        assert!(matches!(p.valider(), Err(VideoError::Parametres(_))));
        let p = Params { largeur: 1280, hauteur: 0, fps: 60, codec: Codec::H264, crf: 18 };
        assert!(matches!(p.valider(), Err(VideoError::Parametres(_))));
        let p = Params { largeur: 1280, hauteur: 720, fps: 0, codec: Codec::H264, crf: 18 };
        assert!(matches!(p.valider(), Err(VideoError::Parametres(_))));
        assert!(Params::h264_720p60().valider().is_ok());
    }

    #[test]
    fn la_taille_de_trame_est_le_produit_exact() {
        let p = Params::h264_720p60();
        assert_eq!(p.octets_par_trame(), 1280 * 720 * 4);
        assert_eq!(p.octets_par_trame(), 3_686_400);
    }

    #[test]
    fn les_noms_ffprobe_sont_ceux_sur_lesquels_la_verification_s_ecrit() {
        assert_eq!(Codec::H264.nom_ffprobe(), "h264");
        assert_eq!(Codec::Vp9.nom_ffprobe(), "vp9");
        assert_eq!(Codec::Av1.nom_ffprobe(), "av1");
    }

    /// Une trame de la mauvaise taille doit être refusée AVANT d'atteindre ffmpeg : sinon le flux
    /// se désaligne et toutes les images suivantes sont décalées, ce qui se voit à l'image mais
    /// pas dans un code de retour.
    #[test]
    fn une_trame_de_mauvaise_taille_est_refusee() {
        if Command::new(OUTIL).arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().is_err() {
            eprintln!("ffmpeg absent : test ignoré");
            return;
        }
        let sortie = std::env::temp_dir().join("nie_video_taille.mp4");
        let params = Params { largeur: 16, hauteur: 16, fps: 30, codec: Codec::H264, crf: 18 };
        let mut enc = ouvrir(&params, &sortie).expect("ouvrir");
        let err = enc.pousser_rgba(&[0u8; 10]).expect_err("doit refuser");
        assert!(matches!(err, VideoError::TailleTrame { recu: 10, attendu: 1024, .. }));
        let _ = enc.finir();
        let _ = std::fs::remove_file(&sortie);
    }
}
