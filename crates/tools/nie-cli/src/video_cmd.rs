//! `niers video` — inventaire, mesure, remux et export des cinématiques du jeu.
//!
//! Les 97 films d'Inazuma Eleven: Victory Road (194 entrées VFS, chaque film étant présent sous
//! `common/movie` et `dx11/movie`) sont des conteneurs **USM / Sofdec2** : du H.264 et du HCA
//! Criware entrelacés par blocs. Aucun lecteur ne sait ouvrir ça directement.
//!
//! Cette commande n'est qu'une **façade texte** : la fiche d'un film vit dans
//! [`nie_explore::cinema`], la même que sert `nie-model-serve` à la page `/videos` d'azalée et
//! que lit l'explorateur. Trois fiches concurrentes décrivaient les mêmes octets sans en dire la
//! même chose ; il n'y en a plus qu'une.
//!
//! Sous elle, trois briques pures Rust :
//!
//! * [`nie_formats::usm`] — démultiplexage, métadonnées `@UTF`, une unité d'accès par image ;
//! * [`nie_formats::mp4`] — remux MP4 des flux H.264 (les octets sont conservés, seuls les
//!   start-codes Annex-B deviennent des préfixes de longueur AVCC) ;
//! * [`nie_formats::webm`] — muxage WebM des flux VP9, après retrait de leur emballage IVF.
//!
//! Le remux est donc sans perte ET compressant : tout ce que perd le fichier, c'est
//! l'entrelacement du conteneur USM (en-têtes de bloc de 32 octets, bourrage d'alignement sur 32,
//! et la piste sonore quand elle est exportée à part). `info` et `export` chiffrent ce gain.
//!
//! Les trois codecs du corpus, mesurés par `niers video catalogue` : **75 H.264**, **20 MPEG-2**,
//! **2 VP9**. Les MPEG-2 (les écrans-titres et les deux logos) n'ont pas de conteneur web — ils
//! sortent en flux élémentaire `.m2v`, que VLC et mpv lisent.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_explore::cinema::{self, Film};
use nie_formats::usm::{self, Usm};
use nie_formats::vfs::Vfs;

/// Sous-commandes de `niers video`.
#[derive(clap::Subcommand, Debug)]
pub enum VideoCmd {
    /// Métadonnées d'un film + mesure du remux MP4 (dimensions, cadence, durée, gain).
    Info {
        /// Chemin VFS (`data/common/movie/ev01_00050.usm`) ou nom court (`ev01_00050`).
        chemin: String,
        /// Sortie JSON.
        #[arg(long)]
        json: bool,
        /// Vide aussi les tables `@UTF` d'en-tête du conteneur (diagnostic de format).
        #[arg(long)]
        tables: bool,
    },

    /// Inventaire des films, avec leurs métadonnées réelles.
    Liste {
        /// Préfixe VFS à parcourir.
        #[arg(long, default_value = cinema::DOSSIER_FILMS)]
        prefixe: String,
        /// Sortie JSON.
        #[arg(long)]
        json: bool,
        /// Nombre maximal de films traités.
        #[arg(long)]
        limit: Option<usize>,
        /// Ne pas mesurer le remux : durée, définition et bande-son restent lues, à mémoire
        /// constante (aucune image n'est retenue).
        #[arg(long)]
        rapide: bool,
    },

    /// Exporte un film en MP4 (piste vidéo) et, avec `--audio`, sa bande-son en WAV.
    Export {
        /// Chemin VFS ou nom court du film.
        chemin: String,
        /// Fichier `.mp4` de sortie, ou dossier (le nom du film est alors repris).
        #[arg(long)]
        out: PathBuf,
        /// Écrit aussi `<sortie>.wav` — la piste sonore décodée depuis le HCA.
        #[arg(long)]
        audio: bool,
        /// Écrit le flux vidéo élémentaire tel quel, sans conteneur — diagnostic de format, ou
        /// lecture dans VLC/mpv quand aucun navigateur ne décode le codec.
        #[arg(long)]
        brut: bool,
    },

    /// Catalogue complet, prêt pour l'interface : rubriques, langues, durées, jointure gamedata.
    Catalogue {
        /// Fichier JSON de sortie (défaut : la sortie standard).
        #[arg(long)]
        out: Option<PathBuf>,
        /// Ne pas mesurer le remux — catalogue à mémoire constante, celui que sert le CDN.
        #[arg(long)]
        rapide: bool,
    },
}

/// Point d'entrée de la commande.
///
/// # Erreurs
///
/// Remonte les échecs de lecture VFS, de démultiplexage et d'écriture de fichier.
pub fn run(op: &VideoCmd, vfs: &Vfs) -> Result<()> {
    match op {
        VideoCmd::Info {
            chemin,
            json,
            tables,
        } => info(vfs, chemin, *json, *tables),
        VideoCmd::Liste {
            prefixe,
            json,
            limit,
            rapide,
        } => liste(vfs, prefixe, *json, *limit, *rapide),
        VideoCmd::Export {
            chemin,
            out,
            audio,
            brut,
        } => export(vfs, chemin, out, *audio, *brut),
        VideoCmd::Catalogue { out, rapide } => catalogue(vfs, out.as_deref(), *rapide),
    }
}

/// Lit et démultiplexe un film. Renvoie aussi la taille brute du conteneur.
fn charger(vfs: &Vfs, chemin: &str) -> Result<(Usm, u64)> {
    let brut = vfs
        .read(chemin)
        .with_context(|| format!("lecture VFS {chemin}"))?;
    let taille = brut.len() as u64;
    let u = usm::demuxer_nomme(&brut, usm::nom_fichier_de(chemin))
        .with_context(|| format!("démultiplexage {chemin}"))?;
    Ok((u, taille))
}

// ── Opérations ────────────────────────────────────────────────────────────────

/// Vide les tables `@UTF` d'en-tête d'un conteneur, colonne par colonne.
///
/// C'est le seul moyen de trancher entre « ce film ne se démuxe pas » et « ce film est chiffré » :
/// les en-têtes restent en clair même quand la charge utile ne l'est pas, et ce sont eux qui
/// déclarent la définition, la cadence et le codec réellement encodés.
fn vider_tables(vfs: &Vfs, chemin: &str) -> Result<()> {
    let (u, _) = charger(vfs, chemin)?;
    for t in &u.entetes {
        println!("── {} ({} ligne(s)) ──", t.name, t.row_count());
        for (i, ligne) in t.rows.iter().enumerate() {
            for (col, val) in t.columns.iter().zip(ligne) {
                let rendu = match val {
                    nie_formats::cpk::UtfValue::String(s) => s.clone(),
                    nie_formats::cpk::UtfValue::Bytes(b) => format!("<{} octets>", b.len()),
                    autre => format!("{autre:?}"),
                };
                println!("  [{i}] {:<22} {rendu}", col.name);
            }
        }
    }
    println!();
    Ok(())
}

/// Rend la fiche d'un film en texte, telle qu'on la lit dans un terminal.
fn afficher(f: &Film) {
    println!("{}", f.chemin);
    if let Some(e) = &f.erreur {
        println!("  erreur      {e}");
        return;
    }
    println!("  rubrique    {}", f.rubrique);
    if let Some(l) = &f.langue {
        println!("  langue      {l}");
    }
    if let Some(o) = &f.nom_origine {
        println!("  nom encodé  {o}");
    }
    if f.dechiffre {
        println!("  chiffrement enveloppe CRI (clé dérivée du nom de fichier)");
    }
    println!(
        "  vidéo       {}×{} {} — {} images, {:.3} i/s, {:.2} s",
        f.largeur,
        f.hauteur,
        f.codec,
        f.images,
        f.cadence.unwrap_or(0.0),
        f.duree.unwrap_or(0.0)
    );
    if let Some(c) = f.cles {
        println!("  clés        {c} image(s) de synchronisation");
    }
    for p in &f.audio {
        println!(
            "  audio {}     {} — {} Hz, {} canal/aux, {} o",
            p.canal, p.codec, p.frequence, p.canaux, p.octets
        );
    }
    match &f.bande_son {
        Some(b) => println!(
            "  bande-son   anime_stream / cue {} — {} {} Hz, {} canal/aux, {:.2} s{}",
            b.cue,
            b.codec,
            b.frequence,
            b.canaux,
            f64::from(b.duree_ms) / 1000.0,
            if b.confirme_par_hash {
                " (confirmée par le bgmName)"
            } else {
                ""
            },
        ),
        None if f.audio.is_empty() => {
            println!("  bande-son   aucune (ni conteneur, ni anime_stream)");
        }
        None => {}
    }
    if let Some(m) = f.conteneur_octets {
        println!(
            "  remux       {} — {} o depuis {} o, {:.2} % de moins, sans réencodage",
            f.conteneur.as_deref().unwrap_or("?"),
            m,
            f.octets,
            f.gain_remux.unwrap_or(0.0)
        );
    } else if let Some(e) = &f.remux_impossible {
        println!("  remux       impossible : {e}");
    }
    if let Some(g) = &f.gamedata {
        println!("  gamedata    {}", g.source);
        if let Some(s) = &g.subtitle_text_path {
            println!("  sous-titres {s}");
        }
    }
}

fn info(vfs: &Vfs, entree: &str, en_json: bool, tables: bool) -> Result<()> {
    let chemin = cinema::resoudre(vfs, entree);
    if tables {
        vider_tables(vfs, &chemin)?;
    }
    let jointure = cinema::jointure_gamedata(vfs);
    let f = cinema::complet(vfs, &chemin, Some(&jointure));
    if en_json {
        println!("{}", serde_json::to_string_pretty(&f)?);
        return Ok(());
    }
    afficher(&f);
    Ok(())
}

fn liste(
    vfs: &Vfs,
    prefixe: &str,
    en_json: bool,
    limit: Option<usize>,
    rapide: bool,
) -> Result<()> {
    let mut chemins = cinema::chemins_films(vfs, prefixe);
    if let Some(n) = limit {
        chemins.truncate(n);
    }

    let jointure = cinema::jointure_gamedata(vfs);
    let fiches: Vec<Film> = chemins
        .iter()
        .map(|c| {
            if rapide {
                cinema::apercu(vfs, c, Some(&jointure))
            } else {
                cinema::complet(vfs, c, Some(&jointure))
            }
        })
        .collect();

    if en_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({ "films": fiches }))?
        );
        return Ok(());
    }

    println!(
        "{:<24} {:>10} {:>11} {:>8} {:>9}  {:<5} rubrique",
        "film", "octets", "définition", "durée", "cadence", "son"
    );
    for f in &fiches {
        let definition = if f.largeur > 0 {
            format!("{}×{}", f.largeur, f.hauteur)
        } else {
            "-".to_string()
        };
        println!(
            "{:<24} {:>10} {:>11} {:>7.2}s {:>8.3}  {:<5} {}",
            f.nom,
            f.octets,
            definition,
            f.duree.unwrap_or(0.0),
            f.cadence.unwrap_or(0.0),
            if f.a_du_son() { "oui" } else { "—" },
            f.rubrique,
        );
    }
    let sonores = fiches.iter().filter(|f| f.a_du_son()).count();
    println!("\n{} film(s), {sonores} avec bande-son", fiches.len());
    Ok(())
}

fn export(vfs: &Vfs, entree: &str, out: &Path, avec_audio: bool, brut: bool) -> Result<()> {
    let chemin = cinema::resoudre(vfs, entree);
    let (u, taille) = charger(vfs, &chemin)?;

    // `--out` accepte un dossier : c'est la forme naturelle pour exporter plusieurs films.
    let cible = if out.is_dir() {
        out.join(format!("{}.mp4", usm::radical_de(&chemin)))
    } else {
        out.to_path_buf()
    };
    if let Some(parent) = cible.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }

    if u.codec.lisible_par_navigateur() && !brut {
        let c = u
            .en_conteneur_web()
            .map_err(|e| anyhow::anyhow!("remux : {e}"))?;
        // L'extension suit le conteneur choisi par le codec, pas celle demandée : écrire un
        // WebM sous un nom `.mp4` tromperait tous les lecteurs qui se fient à l'extension.
        let cible = cible.with_extension(if c.mime == "video/webm" {
            "webm"
        } else {
            "mp4"
        });
        std::fs::write(&cible, &c.octets)
            .with_context(|| format!("écriture {}", cible.display()))?;
        println!(
            "{} — {}×{} {}, {} images ({} clés), {:.2} s, {} o (USM : {} o, {:.2} % de moins)",
            cible.display(),
            c.largeur,
            c.hauteur,
            u.codec.nom(),
            c.images,
            c.cles,
            c.secondes,
            c.octets.len(),
            taille,
            100.0 - (c.octets.len() as f64 * 100.0 / taille as f64),
        );
    } else {
        // MPEG-2 (ou VP9) : le MP4 `avc1` serait un mensonge. On sort le flux élémentaire tel
        // quel, que VLC/mpv lisent directement, plutôt qu'un conteneur que rien ne décode.
        let cible = cible.with_extension(u.codec.extension());
        let flux = u.flux_brut();
        std::fs::write(&cible, &flux).with_context(|| format!("écriture {}", cible.display()))?;
        println!(
            "{} — {}×{} {}, {} images, {:.2} s, {} o — flux élémentaire (pas de remux MP4 : \
             aucun navigateur ne décode ce codec)",
            cible.display(),
            u.entete.largeur,
            u.entete.hauteur,
            u.codec.nom(),
            u.images.len(),
            u.duree().unwrap_or(0.0),
            flux.len(),
        );
    }

    if avec_audio {
        // Le conteneur d'abord, la banque `anime_stream` ensuite : c'est là que vivent 95 des
        // 97 bandes-son. L'archive est matérialisée dans `var/audio-cache` — 654 Mo extraits une
        // seule fois, puis seule l'entrée voulue est relue. La résolution est celle du catalogue,
        // pas une seconde implémentation : le `bgmName` du gamedata y confirme la cue.
        let jointure = cinema::jointure_gamedata(vfs);
        let film = cinema::fiche_de_usm(vfs, &chemin, taille, &u, Some(&jointure));
        if !film.a_du_son() {
            println!("  (aucune bande-son : ni dans le conteneur, ni dans anime_stream)");
            return Ok(());
        }
        let cache = Path::new("var/audio-cache");
        let wav = cinema::wav_bande_son(vfs, cache, &film)
            .map_err(|e| anyhow::anyhow!("bande-son : {e}"))?;
        let provenance = match (&film.bande_son, film.audio.first()) {
            (Some(b), _) => format!("anime_stream, cue {}, {}", b.cue, b.codec),
            (None, Some(p)) => format!("conteneur, {}", p.codec),
            (None, None) => "inconnue".to_string(),
        };
        let cible_wav = cible.with_extension("wav");
        std::fs::write(&cible_wav, &wav)
            .with_context(|| format!("écriture {}", cible_wav.display()))?;
        println!("{} — {} o ({provenance})", cible_wav.display(), wav.len());
    }
    Ok(())
}

fn catalogue(vfs: &Vfs, out: Option<&Path>, rapide: bool) -> Result<()> {
    // `common/movie` seul : `dx11/movie` porte les mêmes films en définition supérieure, et le
    // VFS bascule tout seul de l'un à l'autre. Deux entrées par film feraient un doublon.
    let cat = cinema::catalogue(vfs, cinema::DOSSIER_FILMS, !rapide);
    match out {
        // À l'écran on lit ; dans un fichier on sert. `--out` produit exactement ce que
        // `nie-model-serve` publie sur `/video/catalog.json` : compact, empreinte comprise.
        None => println!("{}", serde_json::to_string_pretty(&cat)?),
        Some(p) => {
            let texte = serde_json::to_string(&cat)?;
            if let Some(parent) = p.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(p, &texte).with_context(|| format!("écriture {}", p.display()))?;
            let sonores = cat.films.iter().filter(|f| f.a_du_son()).count();
            println!(
                "{} — {} film(s), {} rubrique(s), {sonores} avec bande-son",
                p.display(),
                cat.films.len(),
                cat.rubriques.len()
            );
        }
    }
    Ok(())
}
