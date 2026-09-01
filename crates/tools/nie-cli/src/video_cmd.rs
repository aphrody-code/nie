//! `niers video` — inventaire, mesure, remux et export des cinématiques du jeu.
//!
//! Les 97 films d'Inazuma Eleven: Victory Road (194 entrées VFS, chaque film étant présent sous
//! `common/movie` et `dx11/movie`) sont des conteneurs **USM / Sofdec2** : du H.264 et du HCA
//! Criware entrelacés par blocs. Aucun lecteur ne sait ouvrir ça directement.
//!
//! Cette commande s'appuie sur trois briques pures Rust :
//!
//! * [`nie_formats::usm`] — démultiplexage, métadonnées `@UTF`, une unité d'accès par image ;
//! * [`nie_formats::mp4`] — remux MP4 des flux H.264 (les octets sont conservés, seuls les
//!   start-codes Annex-B deviennent des préfixes de longueur AVCC) ;
//! * [`nie_formats::webm`] — muxage WebM des flux VP9, après retrait de leur emballage IVF.
//!
//! Le remux est donc sans perte ET compressant : tout ce que perd le fichier, c'est l'entrelacement
//! du conteneur USM (en-têtes de bloc de 32 octets, bourrage d'alignement sur 32, et la piste
//! sonore quand elle est exportée à part). `info` et `export` chiffrent ce gain.
//!
//! Les trois codecs du corpus, mesurés par `niers video catalogue` : **75 H.264**, **20 MPEG-2**,
//! **2 VP9**. Les MPEG-2 (les écrans-titres et les deux logos) n'ont pas de conteneur web — ils
//! sortent en flux élémentaire `.m2v`, que VLC et mpv lisent.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_formats::usm::{
    self, Usm, langue_de as langue, nom_fichier_de as nom_fichier, radical_de as radical,
    rubrique_de as rubrique,
};
use nie_formats::vfs::Vfs;
use serde_json::{Value, json};

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
        #[arg(long, default_value = "data/common/movie")]
        prefixe: String,
        /// Sortie JSON.
        #[arg(long)]
        json: bool,
        /// Nombre maximal de films traités.
        #[arg(long)]
        limit: Option<usize>,
        /// Ne pas démultiplexer : taille seule, immédiat.
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
        /// Ne pas démultiplexer : catalogue immédiat, sans durée ni dimensions.
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
        VideoCmd::Info { chemin, json, tables } => info(vfs, chemin, *json, *tables),
        VideoCmd::Liste { prefixe, json, limit, rapide } => {
            liste(vfs, prefixe, *json, *limit, *rapide)
        }
        VideoCmd::Export { chemin, out, audio, brut } => export(vfs, chemin, out, *audio, *brut),
        VideoCmd::Catalogue { out, rapide } => catalogue(vfs, out.as_deref(), *rapide),
    }
}

// ── Résolution de chemin ──────────────────────────────────────────────────────

/// Complète un nom court en chemin VFS. `ev01_00050` → `data/common/movie/ev01_00050.usm`.
fn resoudre(vfs: &Vfs, entree: &str) -> String {
    if entree.contains('/') {
        let p = if entree.starts_with("data/") {
            entree.to_string()
        } else {
            format!("data/{entree}")
        };
        return p;
    }
    let nom = entree.strip_suffix(".usm").unwrap_or(entree);
    for base in ["data/common/movie", "data/dx11/movie"] {
        let cand = format!("{base}/{nom}.usm");
        if vfs.is_readable(&cand) {
            return cand;
        }
    }
    format!("data/common/movie/{nom}.usm")
}

/// Lit et démultiplexe un film. Renvoie aussi la taille brute du conteneur.
fn charger(vfs: &Vfs, chemin: &str) -> Result<(Usm, usize)> {
    let brut = vfs.read(chemin).with_context(|| format!("lecture VFS {chemin}"))?;
    let taille = brut.len();
    let u = usm::demuxer_nomme(&brut, nom_fichier(chemin))
        .with_context(|| format!("démultiplexage {chemin}"))?;
    Ok((u, taille))
}

// ── Jointure avec les données de jeu ──────────────────────────────────────────

/// Ce que le `gamedata` dit d'un film, indexé par son chemin logique (`common/movie/x.usm`).
type Jointure = BTreeMap<String, Value>;

/// Construit la jointure depuis `movie_playing_config` et `event_movie_config`.
///
/// Ces deux tables RDBN portent le `moviePath` de chaque cinématique, avec sa musique, ses
/// fondus et le chemin de ses sous-titres. Absentes ou illisibles, la jointure reste vide —
/// le catalogue est alors dégradé, pas faux.
fn jointure_gamedata(vfs: &Vfs) -> Jointure {
    let mut out = Jointure::new();
    let chemins: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| {
            p.contains("gamedata/movie/movie_playing_config")
                || p.contains("gamedata/event/event_movie_config")
        })
        .collect();

    for chemin in chemins {
        let Ok(octets) = vfs.read(&chemin) else { continue };
        let Some(root) = nie_formats::cfgbin::rdbn_to_iecode_json(&octets) else { continue };
        let Some(listes) = root.get("lists").and_then(Value::as_array) else { continue };
        for liste in listes {
            let Some(lignes) = liste.get("values").and_then(Value::as_array) else { continue };
            for ligne in lignes {
                let Some(mp) = ligne.get("moviePath").and_then(Value::as_str) else { continue };
                if !mp.ends_with(".usm") {
                    continue;
                }
                let mut fiche = json!({ "source": nom_fichier(&chemin) });
                for champ in [
                    "movieId",
                    "eventId",
                    "menuId",
                    "captionId",
                    "bgmName",
                    "fedeInTime",
                    "fedeOutTime",
                    "staffrollDataName",
                    "subtitleTextPath",
                    "subtitleSettingPath",
                ] {
                    if let Some(v) = ligne.get(champ) {
                        fiche[champ] = v.clone();
                    }
                }
                out.entry(mp.to_string()).or_insert(fiche);
            }
        }
    }
    out
}

/// Clé de jointure d'un chemin VFS (`data/common/movie/x.usm` → `common/movie/x.usm`).
fn cle_jointure(chemin: &str) -> String {
    chemin.strip_prefix("data/").unwrap_or(chemin).to_string()
}

// ── Fiches ────────────────────────────────────────────────────────────────────

/// Fiche JSON d'un film, avec ou sans démultiplexage.
fn fiche(vfs: &Vfs, chemin: &str, rapide: bool) -> Value {
    let rad = radical(chemin).to_string();
    let mut v = json!({
        "chemin": chemin,
        "nom": rad,
        "rubrique": rubrique(&rad),
        "langue": langue(&rad),
    });

    if rapide {
        if let Some(e) = vfs.find(chemin) {
            v["octets"] = json!(e.file_size);
        }
        return v;
    }

    match charger(vfs, chemin) {
        Err(e) => {
            v["erreur"] = json!(e.to_string());
        }
        Ok((u, taille)) => {
            v["octets"] = json!(taille);
            v["codec"] = json!(u.codec.nom());
            v["lisibleNavigateur"] = json!(u.codec.lisible_par_navigateur());
            v["images"] = json!(u.images.len());
            v["octetsVideo"] = json!(u.octets_video);
            // Dimensions déclarées par `VIDEO_HDRINFO` — le SPS les affinera si le remux passe.
            v["largeur"] = json!(u.entete.largeur_affichee.max(u.entete.largeur));
            v["hauteur"] = json!(u.entete.hauteur_affichee.max(u.entete.hauteur));
            v["totalImagesDeclare"] = json!(u.entete.total_images);
            if u.dechiffre {
                v["dechiffre"] = json!(true);
            }
            if let Some(n) = &u.nom {
                v["nomOrigine"] = json!(n);
            }
            if let Some((n, d)) = u.cadence() {
                v["cadence"] = json!(f64::from(n) / f64::from(d));
            }
            if let Some(s) = u.duree() {
                v["duree"] = json!((s * 1000.0).round() / 1000.0);
            }
            // Le remux mesure aussi ce que le conteneur USM coûtait : c'est la seule façon
            // honnête de chiffrer le gain, sans avoir à croire une estimation.
            match u.en_conteneur_web() {
                Ok(c) => {
                    v["conteneur"] = json!(c.mime);
                    v["conteneurOctets"] = json!(c.octets.len());
                    v["cles"] = json!(c.cles);
                    // Dimensions lues dans le bitstream : elles priment sur l'en-tête USM, qui
                    // déclare la taille codée là où le SPS donne la taille effective.
                    v["largeur"] = json!(c.largeur);
                    v["hauteur"] = json!(c.hauteur);
                    if taille > 0 {
                        let gain = 100.0 - (c.octets.len() as f64 * 100.0 / taille as f64);
                        v["gainRemux"] = json!((gain * 100.0).round() / 100.0);
                    }
                }
                Err(e) => {
                    v["remuxImpossible"] = json!(e.to_string());
                }
            }
            let pistes: Vec<Value> = u
                .pistes
                .iter()
                .map(|p| {
                    json!({
                        "canal": p.canal,
                        "codec": p.codec.nom(),
                        "frequence": p.frequence,
                        "canaux": p.canaux,
                        "octets": p.octets.len(),
                    })
                })
                .collect();
            v["audio"] = json!(pistes);
            if !u.sous_titres.is_empty() {
                v["sousTitres"] = json!(u.sous_titres.len());
            }
        }
    }
    v
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

fn info(vfs: &Vfs, entree: &str, en_json: bool, tables: bool) -> Result<()> {
    let chemin = resoudre(vfs, entree);
    if tables {
        vider_tables(vfs, &chemin)?;
    }
    let f = fiche(vfs, &chemin, false);
    if en_json {
        println!("{}", serde_json::to_string_pretty(&f)?);
        return Ok(());
    }

    println!("{chemin}");
    if let Some(e) = f.get("erreur").and_then(Value::as_str) {
        println!("  erreur      {e}");
        return Ok(());
    }
    let n = |c: &str| f.get(c).and_then(Value::as_i64).unwrap_or(0);
    let r = |c: &str| f.get(c).and_then(Value::as_f64).unwrap_or(0.0);
    println!("  rubrique    {}", f["rubrique"].as_str().unwrap_or("-"));
    if let Some(l) = f.get("langue").and_then(Value::as_str) {
        println!("  langue      {l}");
    }
    if let Some(o) = f.get("nomOrigine").and_then(Value::as_str) {
        println!("  nom encodé  {o}");
    }
    if f.get("dechiffre").is_some() {
        println!("  chiffrement enveloppe CRI (clé dérivée du nom de fichier)");
    }
    println!(
        "  vidéo       {}×{} {} — {} images, {:.3} i/s, {:.2} s",
        n("largeur"),
        n("hauteur"),
        f["codec"].as_str().unwrap_or("?"),
        n("images"),
        r("cadence"),
        r("duree")
    );
    println!("  clés        {} image(s) de synchronisation", n("cles"));
    for p in f.get("audio").and_then(Value::as_array).into_iter().flatten() {
        println!(
            "  audio {}     {} — {} Hz, {} canal/aux, {} o",
            p["canal"],
            p["codec"].as_str().unwrap_or("?"),
            p["frequence"],
            p["canaux"],
            p["octets"]
        );
    }
    if let Some(m) = f.get("conteneurOctets").and_then(Value::as_i64) {
        println!(
            "  remux       {} — {} o depuis {} o, {:.2} % de moins, sans réencodage",
            f["conteneur"].as_str().unwrap_or("?"),
            m,
            n("octets"),
            r("gainRemux")
        );
    } else if let Some(e) = f.get("remuxImpossible").and_then(Value::as_str) {
        println!("  remux       impossible : {e}");
    }
    Ok(())
}

fn liste(
    vfs: &Vfs,
    prefixe: &str,
    en_json: bool,
    limit: Option<usize>,
    rapide: bool,
) -> Result<()> {
    let mut chemins: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| p.starts_with(prefixe) && p.ends_with(".usm"))
        .collect();
    chemins.sort();
    if let Some(n) = limit {
        chemins.truncate(n);
    }

    let fiches: Vec<Value> = chemins.iter().map(|c| fiche(vfs, c, rapide)).collect();
    if en_json {
        println!("{}", serde_json::to_string_pretty(&json!({ "films": fiches }))?);
        return Ok(());
    }

    println!(
        "{:<24} {:>10} {:>11} {:>8} {:>9}  rubrique",
        "film", "octets", "définition", "durée", "cadence"
    );
    for f in &fiches {
        let n = |c: &str| f.get(c).and_then(Value::as_i64).unwrap_or(0);
        let definition = if n("largeur") > 0 {
            format!("{}×{}", n("largeur"), n("hauteur"))
        } else {
            "-".to_string()
        };
        println!(
            "{:<24} {:>10} {:>11} {:>7.2}s {:>8.3}  {}",
            f["nom"].as_str().unwrap_or("?"),
            n("octets"),
            definition,
            f.get("duree").and_then(Value::as_f64).unwrap_or(0.0),
            f.get("cadence").and_then(Value::as_f64).unwrap_or(0.0),
            f["rubrique"].as_str().unwrap_or("-"),
        );
    }
    println!("\n{} film(s)", fiches.len());
    Ok(())
}

fn export(vfs: &Vfs, entree: &str, out: &Path, avec_audio: bool, brut: bool) -> Result<()> {
    let chemin = resoudre(vfs, entree);
    let (u, taille) = charger(vfs, &chemin)?;

    // `--out` accepte un dossier : c'est la forme naturelle pour exporter plusieurs films.
    let cible = if out.is_dir() {
        out.join(format!("{}.mp4", radical(&chemin)))
    } else {
        out.to_path_buf()
    };
    if let Some(parent) = cible.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
    }

    if u.codec.lisible_par_navigateur() && !brut {
        let c = u.en_conteneur_web().map_err(|e| anyhow::anyhow!("remux : {e}"))?;
        // L'extension suit le conteneur choisi par le codec, pas celle demandée : écrire un
        // WebM sous un nom `.mp4` tromperait tous les lecteurs qui se fient à l'extension.
        let cible = cible.with_extension(if c.mime == "video/webm" { "webm" } else { "mp4" });
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
        let Some(piste) = u.pistes.first() else {
            println!("  (aucune piste sonore dans ce film)");
            return Ok(());
        };
        let wav = nie_formats::cri_audio::decode_to_wav(&piste.octets)
            .map_err(|e| anyhow::anyhow!("décodage audio : {e}"))?;
        let cible_wav = cible.with_extension("wav");
        std::fs::write(&cible_wav, &wav)
            .with_context(|| format!("écriture {}", cible_wav.display()))?;
        println!("{} — {} o ({})", cible_wav.display(), wav.len(), piste.codec.nom());
    }
    Ok(())
}

fn catalogue(vfs: &Vfs, out: Option<&Path>, rapide: bool) -> Result<()> {
    // `common/movie` seul : `dx11/movie` porte les mêmes films en définition supérieure, et le
    // VFS bascule tout seul de l'un à l'autre. Deux entrées par film feraient un doublon.
    let mut chemins: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| p.starts_with("data/common/movie") && p.ends_with(".usm"))
        .collect();
    chemins.sort();

    let liens = jointure_gamedata(vfs);
    let mut fiches: Vec<Value> = Vec::with_capacity(chemins.len());
    for c in &chemins {
        let mut f = fiche(vfs, c, rapide);
        if let Some(j) = liens.get(&cle_jointure(c)) {
            f["gamedata"] = j.clone();
        }
        fiches.push(f);
    }

    // Rubriques dans un ordre stable : les chapitres d'abord, dans l'ordre du jeu.
    let mut rubriques: Vec<String> =
        fiches.iter().filter_map(|f| f["rubrique"].as_str().map(str::to_string)).collect();
    rubriques.sort();
    rubriques.dedup();

    let doc = json!({
        "films": fiches,
        "rubriques": rubriques,
        "langues": usm::LANGUES.iter().map(|(c, n)| json!({ "code": c, "nom": n })).collect::<Vec<_>>(),
    });
    let texte = serde_json::to_string_pretty(&doc)?;
    match out {
        None => println!("{texte}"),
        Some(p) => {
            if let Some(parent) = p.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(p, &texte).with_context(|| format!("écriture {}", p.display()))?;
            println!("{} — {} film(s), {} rubrique(s)", p.display(), chemins.len(), rubriques.len());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Les conventions de nom sont testées à leur source (`nie_formats::usm`) ; ici on ne
    /// vérifie que ce que ce module ajoute — la clé de jointure avec le `gamedata`.
    #[test]
    fn la_cle_de_jointure_retire_le_prefixe_data() {
        assert_eq!(cle_jointure("data/common/movie/x.usm"), "common/movie/x.usm");
        // Un chemin déjà sans préfixe `data/` reste intact.
        assert_eq!(cle_jointure("common/movie/x.usm"), "common/movie/x.usm");
    }
}
