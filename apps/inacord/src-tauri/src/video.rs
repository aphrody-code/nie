//! Lecture native des cinématiques du jeu — catalogue, métadonnées, flux vidéo.
//!
//! ## Ce qui a changé, et pourquoi
//!
//! L'aperçu vidéo passait par `ffmpeg` en sous-processus, puis renvoyait le MP4 **en base64**
//! avec un plafond de 40 Mo. Trois murs :
//!
//! 1. `ffmpeg` n'est pas installé ici — l'aperçu échouait sur `échec de lancement de ffmpeg` ;
//! 2. 40 Mo, quand une cinématique de chapitre pèse jusqu'à 300 Mo : la moitié du corpus était
//!    hors de portée par construction ;
//! 3. le base64 gonfle de 33 % et interdit le `seek` — un `<video src="data:…">` doit tout
//!    charger avant de jouer la première image.
//!
//! Ici, [`nie_formats::usm`] démultiplexe, puis [`nie_formats::mp4`] (H.264) ou
//! [`nie_formats::webm`] (VP9) remuxe, en pur Rust et sans réencodage. Le résultat est servi par
//! le protocole `nievideo://` avec **support des requêtes `Range`** : le `<video>` de la webview
//! ne charge que l'intervalle dont il a besoin, ce qui rend le déplacement dans la timeline
//! instantané quelle que soit la taille du film.
//!
//! ## Ce que le protocole expose
//!
//! | URL | Contenu |
//! |-----|---------|
//! | `nievideo://localhost/<chemin VFS>` | la piste vidéo : MP4 si H.264, WebM si VP9 |
//! | `nievideo://localhost/<chemin VFS>?track=audio` | la bande-son décodée, en WAV |
//!
//! La bande-son est un flux **séparé** parce qu'elle est en HCA Criware : aucun conteneur MP4
//! ne la transporte, et l'encoder en AAC demanderait un encodeur C et dégraderait une piste
//! qu'on vient de décoder sans perte. Le lecteur les resynchronise (cf. `VideoPlayer.tsx`).

use std::sync::Mutex;

use nie_formats::vfs::Vfs;
use serde::{Deserialize, Serialize};

/// Budget mémoire du cache vidéo, en octets. Deux cinématiques de chapitre y tiennent.
const BUDGET_CACHE: usize = 768 * 1024 * 1024;

/// Nombre maximal de films gardés simultanément.
const ENTREES_CACHE: usize = 4;

/// Cache mémoire des flux produits (MP4 ou WAV), par clé d'URL.
///
/// Deux usages le rendent indispensable :
///
/// * le lecteur émet une requête `Range` par saut dans la timeline — sans cache, chaque saut
///   redémultiplexerait le conteneur entier ;
/// * la page Cinéma prévisualise au survol, et l'aller-retour entre deux cartes voisines
///   rejouerait le même travail à chaque passage.
///
/// D'où un petit LRU plutôt qu'une entrée unique : borné par [`ENTREES_CACHE`] **et** par
/// [`BUDGET_CACHE`], parce qu'un film de chapitre pèse à lui seul 300 Mo.
#[derive(Default)]
pub struct CacheVideo(pub Mutex<Vec<(String, &'static str, Vec<u8>)>>);

impl CacheVideo {
    /// Rend **la tranche demandée** d'un flux déjà produit, avec son type MIME et la taille
    /// totale, et remet l'entrée en tête (usage le plus récent).
    ///
    /// La tranche, et pas tout le flux : un `<video>` émet une requête `Range` par saut et par
    /// remplissage de tampon. Cloner les 300 Mo à chaque fois faisait monter la mémoire de
    /// travail de l'explorateur à 15 Go — l'allocateur de Windows garde ces blocs. Ici on ne
    /// copie que ce qui part sur le fil.
    pub fn tranche(
        &self,
        cle: &str,
        plage: Option<(u64, u64)>,
    ) -> Option<(&'static str, Vec<u8>, u64)> {
        let mut g = self.0.lock().ok()?;
        let i = g.iter().position(|(k, _, _)| k == cle)?;
        let entree = g.remove(i);
        let total = entree.2.len() as u64;
        let morceau = decouper(&entree.2, plage);
        let mime = entree.1;
        g.push(entree);
        Some((mime, morceau, total))
    }

    /// Range des octets produits, en évinçant les plus anciens si les bornes sont dépassées.
    ///
    /// Prend la propriété du tampon : le ranger ne doit pas coûter une copie de 300 Mo.
    pub fn ranger(&self, cle: String, mime: &'static str, octets: Vec<u8>) {
        let Ok(mut g) = self.0.lock() else { return };
        g.retain(|(k, _, _)| *k != cle);
        g.push((cle, mime, octets));
        while g.len() > ENTREES_CACHE
            || (g.len() > 1 && g.iter().map(|(_, _, v)| v.len()).sum::<usize>() > BUDGET_CACHE)
        {
            g.remove(0);
        }
    }
}

/// Extrait `plage` d'un tampon, bornes comprises. `None` rend le tampon entier.
pub fn decouper(octets: &[u8], plage: Option<(u64, u64)>) -> Vec<u8> {
    match plage {
        None => octets.to_vec(),
        Some((debut, fin)) => {
            if octets.is_empty() {
                return Vec::new();
            }
            let debut = (debut as usize).min(octets.len() - 1);
            let fin = (fin as usize).min(octets.len() - 1).max(debut);
            octets[debut..=fin].to_vec()
        }
    }
}

/// Piste sonore d'un film.
///
/// Elle vient de deux endroits, et c'est le fait marquant du corpus : **2 films sur 97 seulement**
/// portent leur son dans leur propre conteneur (les deux logos). Pour tous les autres, il vit
/// dans la banque `anime_stream`, à côté — cf. [`nie_explore::soundtrack`].
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct PisteAudioDto {
    /// Numéro de canal (toujours `0` pour une piste externe).
    pub canal: u8,
    /// Codec détecté (`hca`, `adx`).
    pub codec: String,
    /// Fréquence d'échantillonnage en Hz.
    pub frequence: u32,
    /// Nombre de canaux.
    pub canaux: u32,
    /// Taille du flux brut, en octets — `0` pour une piste externe (connue seulement à l'ouverture
    /// de la banque, qui pèse 654 Mo).
    pub octets: u32,
    /// D'où vient la piste : `conteneur` (dans le `.usm`) ou le nom de la cue de `anime_stream`.
    pub source: String,
}

/// Une entrée du catalogue. Les champs issus du démultiplexage sont `None` tant que
/// [`video_info`] n'a pas été appelé sur ce film — le catalogue s'ouvre instantanément et se
/// complète à mesure que les cartes deviennent visibles.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct FilmDto {
    /// Chemin VFS complet.
    pub chemin: String,
    /// Radical du nom de fichier (`ev01_00050`).
    pub nom: String,
    /// Rubrique d'affichage — une rubrique = une rangée.
    pub rubrique: String,
    /// Code de langue (`fr`, `JP`…) quand le nom en porte un.
    pub langue: Option<String>,
    /// Taille du conteneur USM, en octets.
    pub octets: u32,
    /// Codec vidéo (`h264`, `mpeg2`), une fois le film inspecté.
    pub codec: Option<String>,
    /// Le navigateur sait-il décoder ce codec ?
    pub lisible: Option<bool>,
    /// Largeur en pixels.
    pub largeur: Option<u32>,
    /// Hauteur en pixels.
    pub hauteur: Option<u32>,
    /// Nombre d'images démultiplexées.
    pub images: Option<u32>,
    /// Cadence en images par seconde.
    pub cadence: Option<f64>,
    /// Durée en secondes.
    pub duree: Option<f64>,
    /// Pistes sonores.
    pub audio: Vec<PisteAudioDto>,
    /// Le conteneur était-il enveloppé par le XOR CRI ?
    pub chiffre: Option<bool>,
    /// Nom du fichier source chez l'encodeur, tel qu'inscrit dans le conteneur.
    pub nom_origine: Option<String>,
    /// Musique de fond déclarée par le `gamedata` (hash).
    pub bgm: Option<String>,
    /// Chemin du `.cfg.bin` de texte des sous-titres, quand il y en a un.
    pub sous_titres: Option<String>,
}

/// Le catalogue complet renvoyé au frontend.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct CatalogueVideoDto {
    /// Films, triés par chemin.
    pub films: Vec<FilmDto>,
    /// Rubriques distinctes, dans l'ordre d'affichage.
    pub rubriques: Vec<String>,
}

impl From<nie_explore::native_video::MovieInfo> for FilmDto {
    fn from(movie: nie_explore::native_video::MovieInfo) -> Self {
        Self {
            chemin: movie.path,
            nom: movie.name,
            rubrique: movie.section,
            langue: movie.locale,
            octets: movie.byte_length,
            codec: movie.codec,
            lisible: movie.browser_playable,
            largeur: movie.width,
            hauteur: movie.height,
            images: movie.frame_count,
            cadence: movie.frame_rate,
            duree: movie.duration_seconds,
            audio: movie
                .audio_tracks
                .into_iter()
                .map(|track| PisteAudioDto {
                    canal: track.channel,
                    codec: track.codec,
                    frequence: track.sample_rate,
                    canaux: track.channels,
                    octets: track.byte_length,
                    source: if track.source == "container" {
                        "conteneur".to_owned()
                    } else {
                        track.source
                    },
                })
                .collect(),
            chiffre: movie.decrypted,
            nom_origine: movie.original_name,
            bgm: movie.background_music,
            sous_titres: movie.subtitle_path,
        }
    }
}

/// Construit le catalogue **sans** démultiplexer : instantané, complété ensuite par
/// [`info_film`] au fil de l'affichage.
///
/// # Erreurs
///
/// Aucune : un VFS vide rend un catalogue vide.
pub fn catalogue(vfs: &Vfs) -> CatalogueVideoDto {
    let catalogue = nie_explore::native_video::movie_catalog(vfs);
    CatalogueVideoDto {
        films: catalogue.movies.into_iter().map(FilmDto::from).collect(),
        rubriques: catalogue.sections,
    }
}

/// Démultiplexe un film et rend sa fiche complète.
///
/// # Erreurs
///
/// Chemin absent du VFS, ou conteneur qui ne se démultiplexe pas (même déchiffré).
pub fn info_film(vfs: &Vfs, chemin: &str) -> Result<FilmDto, String> {
    nie_explore::native_video::movie_info(vfs, chemin).map(FilmDto::from)
}

/// Emballe la piste vidéo d'un `.usm` dans son conteneur web, **sans réencodage ni processus
/// externe**. Rend `(type MIME, octets)` : H.264 → MP4, VP9 → WebM.
///
/// # Erreurs
///
/// Conteneur illisible, ou codec que le navigateur ne décode pas (MPEG-2) : le message le dit
/// explicitement plutôt que de produire un fichier que rien n'ouvrira.
pub fn flux_web_depuis_usm(octets: &[u8], nom: &str) -> Result<(&'static str, Vec<u8>), String> {
    nie_explore::native_video::web_video_stream(octets, nom)
}

/// Même chose, quand seul le contenu importe (aperçu base64 borné).
///
/// # Erreurs
///
/// Voir [`flux_web_depuis_usm`].
pub fn mp4_depuis_usm(octets: &[u8], nom: &str) -> Result<Vec<u8>, String> {
    flux_web_depuis_usm(octets, nom).map(|(_, o)| o)
}

/// Décode la bande-son d'un film en WAV, d'où qu'elle vienne.
///
/// D'abord la piste du conteneur (les deux logos), sinon la cue de `anime_stream` qui porte le
/// nom du film. C'est ce second chemin qui donne du son aux cinématiques : **95 des 97 `.usm`
/// sont muets**, leur bande-son vit dans une banque Criware à côté.
///
/// # Erreurs
///
/// Conteneur illisible, film sans son ni dans le conteneur ni dans la banque, ou décodage HCA
/// refusé. Le message dit LEQUEL des deux chemins a échoué.
pub fn wav_bande_son(
    vfs: &Vfs,
    cache_dir: &std::path::Path,
    chemin: &str,
    octets: &[u8],
) -> Result<Vec<u8>, String> {
    nie_explore::native_video::movie_audio_wav(vfs, cache_dir, chemin, octets)
}

// Pas de module de tests ici : `cargo test` dans `src-tauri` ne DÉMARRE pas sur cette machine
// (`STATUS_ENTRYPOINT_NOT_FOUND` avant le premier test, cf. CLAUDE.md « Pièges d'environnement »),
// donc un test écrit ici ne serait jamais exécuté — un faux vert. Les conventions de nommage que
// ce module consomme sont testées à leur source, dans `nie_formats::usm` (`cargo test -p
// nie-formats --lib usm::`), là où elles tournent vraiment.
