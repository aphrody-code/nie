//! `niers vn` — alimente un projet de visual novel avec les assets réels du jeu.
//!
//! Le VN (`nie-vn-engine`, un fork de Ren'Py) ne contient aucun asset : il lit un **catalogue**
//! produit ici, sur la machine de l'utilisateur, depuis son installation du jeu. Rien de ce que
//! cette commande écrit n'est destiné à entrer dans un dépôt — la sortie va dans un dossier que
//! le projet Ren'Py ignore explicitement.
//!
//! Deux opérations :
//!
//! * [`VnCmd::Casting`] — dit quels personnages sont **doublés**, par taille de banque
//!   décroissante : les rôles principaux ont le plus de lignes enregistrées.
//! * [`VnCmd::Export`] — extrait voix (HCA → WAV), atlas d'expressions (G4TX → PNG) et musique,
//!   puis écrit `catalogue.json`, la seule interface que connaît le côté Ren'Py.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_explore::audio;
use nie_formats::vfs::Vfs;

/// Sous-commandes de `niers vn`.
#[derive(clap::Subcommand, Debug)]
pub enum VnCmd {
    /// Liste les personnages doublés, du plus fourni au moins fourni.
    Casting {
        /// Langue des voix (`ja`, `en`, …).
        #[arg(long, default_value = "ja")]
        langue: String,
        /// Nombre de personnages affichés.
        #[arg(long, default_value_t = 30)]
        limit: usize,
        /// Sortie JSON plutôt que tabulaire.
        #[arg(long)]
        json: bool,
        /// Ne garde que les personnages dont le nom contient ce motif (sans accent ni casse).
        #[arg(long)]
        chercher: Option<String>,
        /// Langue des noms affichés (`fr`, `en`, `ja`, …).
        #[arg(long, default_value = "fr")]
        langue_noms: String,
        /// Ne garde qu'un genre : `m` ou `f`.
        #[arg(long)]
        genre: Option<String>,
    },

    /// Extrait voix, portraits et musique vers un dossier consommable par le projet Ren'Py.
    Export {
        /// Dossier de sortie — typiquement `<projet-renpy>/game/nie`.
        #[arg(long)]
        out: PathBuf,
        /// Codes internes à extraire (`c01000010,c01000020`). Défaut : les mieux doublés.
        #[arg(long, value_delimiter = ',')]
        casting: Vec<String>,
        /// Noms à extraire, résolus sur la table maîtresse locale (`--noms "Kazemaru,Byron"`).
        #[arg(long, value_delimiter = ',')]
        noms: Vec<String>,
        /// Langue des noms résolus (`fr`, `en`, `ja`, …).
        #[arg(long, default_value = "fr")]
        langue_noms: String,
        /// Langue des voix.
        #[arg(long, default_value = "ja")]
        langue: String,
        /// Nombre de personnages retenus quand `--casting` est absent.
        #[arg(long, default_value_t = 6)]
        roles: usize,
        /// Nombre maximal de répliques extraites par personnage.
        #[arg(long, default_value_t = 24)]
        voix_max: usize,
        /// Nombre maximal de pistes extraites de `bgm.acb` (0 = aucune).
        #[arg(long, default_value_t = 6)]
        bgm_max: usize,
        /// Nombre maximal de textures extraites par personnage.
        #[arg(long, default_value_t = 4)]
        textures_max: usize,
    },
}

/// Une banque de voix repérée dans le VFS.
#[derive(Debug, Clone)]
struct Banque {
    /// Code interne du personnage (`c01000010`).
    code: String,
    /// Chemin VFS de l'ACB.
    acb: String,
    /// Taille de l'AWB frère, en octets — le proxy de « combien ce rôle parle ».
    poids: u64,
}

/// Identité d'un personnage, résolue depuis les tables locales du jeu.
#[derive(Debug, Clone)]
pub struct Fiche {
    /// Code interne (`c01000010`).
    pub code: String,
    /// Nom d'affichage complet, dans la langue demandée.
    pub nom: String,
    /// `"m"` ou `"f"`, d'après la table maîtresse.
    pub genre: &'static str,
}

/// Point d'entrée de `niers vn`.
pub fn run(cmd: &VnCmd, vfs: &Vfs) -> Result<()> {
    match cmd {
        VnCmd::Casting {
            langue,
            limit,
            json,
            chercher,
            langue_noms,
            genre,
        } => casting(
            vfs,
            langue,
            *limit,
            *json,
            chercher.as_deref(),
            langue_noms,
            genre.as_deref(),
        ),
        VnCmd::Export {
            out,
            casting: codes,
            noms,
            langue_noms,
            langue,
            roles,
            voix_max,
            bgm_max,
            textures_max,
        } => export(
            vfs,
            out,
            codes,
            noms,
            langue_noms,
            langue,
            *roles,
            *voix_max,
            *bgm_max,
            *textures_max,
        ),
    }
}

// ---------------------------------------------------------------------------
// Identités : code interne <-> nom, lus dans l'installation locale
// ---------------------------------------------------------------------------

/// Convertit les frères T2B en forme `iecode`, celle qu'attendent les parseurs de `nie-data`.
fn t2b_vers_iecode(entrees: &[nie_formats::cfgbin::CfgEntry]) -> Vec<serde_json::Value> {
    use nie_formats::cfgbin;
    entrees
        .iter()
        .map(|e| {
            let variables: Vec<serde_json::Value> = e
                .variables
                .iter()
                .map(|v| match v {
                    cfgbin::Value::String(s) => serde_json::json!({ "type": "String", "value": s }),
                    cfgbin::Value::Int(n) => {
                        serde_json::json!({ "type": "Int", "value": n.to_string() })
                    }
                    cfgbin::Value::Float(f) => {
                        serde_json::json!({ "type": "Float", "value": f.to_string() })
                    }
                })
                .collect();
            serde_json::json!({
                "name": e.name,
                "variables": variables,
                "children": t2b_vers_iecode(&e.children),
            })
        })
        .collect()
}

/// Lit un `cfg.bin` T2B du VFS et le rend dans la forme `iecode`.
fn lire_t2b(vfs: &Vfs, chemin: &str) -> Option<serde_json::Value> {
    let raw = vfs.read(chemin).ok()?;
    if nie_formats::cfgbin::is_rdbn(&raw) {
        return None;
    }
    let cfg = nie_formats::cfgbin::cfgbin_parse(&raw).ok()?;
    Some(serde_json::json!({ "entries": t2b_vers_iecode(&cfg.entries) }))
}

/// Premier chemin du VFS commençant par `prefixe` et finissant par `suffixe`.
fn chercher_chemin(vfs: &Vfs, prefixe: &str, suffixe: &str) -> Option<String> {
    let mut trouves: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| p.starts_with(prefixe) && p.ends_with(suffixe))
        .map(|(p, _)| p.to_string())
        .collect();
    trouves.sort();
    trouves.pop()
}

/// Construit l'index des identités depuis la table maîtresse et les textes localisés.
///
/// Rend une liste vide — sans erreur — quand l'installation ne porte pas ces tables : le
/// pipeline doit rester utilisable avec les seuls codes internes.
fn identites(vfs: &Vfs, langue_noms: &str) -> Vec<Fiche> {
    let Some(chemin_base) = chercher_chemin(
        vfs,
        "data/common/gamedata/character/chara_base_",
        ".cfg.bin",
    ) else {
        return Vec::new();
    };
    let chemin_texte = format!("data/common/text/{langue_noms}/chara_text.cfg.bin");

    let (Some(base_json), Some(texte_json)) = (
        lire_t2b(vfs, &chemin_base),
        lire_t2b(vfs, &chemin_texte),
    ) else {
        return Vec::new();
    };

    let nouns = nie_data::chara_text::parse_all_nouns(&texte_json);
    let bases = nie_data::chara_base::parse_all_chara_base(&base_json);

    let mut fiches = Vec::new();
    for base in &bases {
        let prenom = nie_data::chara_base::resolve_first_name(base, &nouns).unwrap_or_default();
        let nom_famille = nie_data::chara_base::resolve_last_name(base, &nouns).unwrap_or_default();
        let complet = format!("{nom_famille} {prenom}").trim().to_string();
        if complet.is_empty() || base.internal_code.is_empty() {
            continue;
        }
        fiches.push(Fiche {
            code: base.internal_code.clone(),
            nom: complet,
            genre: if base.gender == 2 { "f" } else { "m" },
        });
    }
    fiches
}

/// Forme comparable d'un nom : minuscules, sans accent, sans ponctuation.
fn pliage(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'û' | 'ü' | 'ú' | 'ù' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            autre => autre,
        })
        .filter(|c| c.is_alphanumeric() || *c == ' ')
        .collect()
}

// ---------------------------------------------------------------------------
// Repérage des banques
// ---------------------------------------------------------------------------

/// Toutes les banques `sound_asset/<langue>/c########.acb`, triées par poids décroissant.
fn banques(vfs: &Vfs, langue: &str) -> Vec<Banque> {
    let prefixe = format!("data/common/sound_asset/{langue}/");
    let mut tailles: BTreeMap<String, u64> = BTreeMap::new();
    let mut acbs: Vec<(String, String)> = Vec::new();

    for (path, entry) in vfs.iter() {
        let Some(reste) = path.strip_prefix(prefixe.as_str()) else {
            continue;
        };
        let Some(radical) = reste.strip_suffix(".acb").or_else(|| reste.strip_suffix(".awb")) else {
            continue;
        };
        // Seules les banques de personnage : `c` suivi de chiffres.
        if !radical.starts_with('c') || !radical[1..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if reste.ends_with(".awb") {
            tailles.insert(radical.to_string(), u64::from(entry.file_size));
        } else {
            acbs.push((radical.to_string(), path.to_string()));
        }
    }

    let mut out: Vec<Banque> = acbs
        .into_iter()
        .map(|(code, acb)| {
            let poids = tailles.get(&code).copied().unwrap_or(0);
            Banque { code, acb, poids }
        })
        .collect();
    out.sort_by(|a, b| b.poids.cmp(&a.poids).then_with(|| a.code.cmp(&b.code)));
    out
}

fn casting(
    vfs: &Vfs,
    langue: &str,
    limit: usize,
    json: bool,
    chercher: Option<&str>,
    langue_noms: &str,
    genre: Option<&str>,
) -> Result<()> {
    let banques = banques(vfs, langue);
    if banques.is_empty() {
        anyhow::bail!("aucune banque de voix sous data/common/sound_asset/{langue}/");
    }

    let index: BTreeMap<String, Fiche> = identites(vfs, langue_noms)
        .into_iter()
        .map(|f| (f.code.clone(), f))
        .collect();

    let motif = chercher.map(pliage);
    let retenues: Vec<&Banque> = banques
        .iter()
        .filter(|b| {
            let fiche = index.get(&b.code);
            if let Some(g) = genre
                && fiche.map(|f| f.genre) != Some(g)
            {
                return false;
            }
            match (&motif, fiche) {
                (Some(m), Some(f)) => pliage(&f.nom).contains(m.as_str()),
                (Some(_), None) => false,
                (None, _) => true,
            }
        })
        .take(limit)
        .collect();

    if json {
        let liste: Vec<_> = retenues
            .iter()
            .map(|b| {
                serde_json::json!({
                    "code": b.code,
                    "nom": index.get(&b.code).map(|f| f.nom.clone()),
                    "genre": index.get(&b.code).map(|f| f.genre),
                    "acb": b.acb,
                    "awb_octets": b.poids,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&liste)?);
        return Ok(());
    }

    println!(
        "{} banque(s) de voix en « {langue} », {} affichée(s)\n",
        banques.len(),
        retenues.len()
    );
    for b in retenues {
        let fiche = index.get(&b.code);
        let nom = fiche.map_or("—", |f| f.nom.as_str());
        let genre = fiche.map_or(" ", |f| f.genre);
        println!("  {:>10}  {genre}  {:>12} o  {nom}", b.code, b.poids);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn export(
    vfs: &Vfs,
    out: &Path,
    codes: &[String],
    noms: &[String],
    langue_noms: &str,
    langue: &str,
    roles: usize,
    voix_max: usize,
    bgm_max: usize,
    textures_max: usize,
) -> Result<()> {
    let toutes = banques(vfs, langue);
    if toutes.is_empty() {
        anyhow::bail!("aucune banque de voix sous data/common/sound_asset/{langue}/");
    }

    let index: BTreeMap<String, Fiche> = identites(vfs, langue_noms)
        .into_iter()
        .map(|f| (f.code.clone(), f))
        .collect();

    // Un nom demandé sans banque de voix est signalé, pas ignoré en silence.
    let mut par_nom: Vec<Banque> = Vec::new();
    for demande in noms {
        let motif = pliage(demande);
        let trouve = toutes.iter().find(|b| {
            index
                .get(&b.code)
                .is_some_and(|f| pliage(&f.nom).contains(motif.as_str()))
        });
        match trouve {
            Some(b) => par_nom.push(b.clone()),
            None => eprintln!("  « {demande} » — aucun personnage doublé de ce nom, ignoré"),
        }
    }

    let mut retenues: Vec<Banque> = par_nom;
    retenues.extend(
        codes
            .iter()
            .filter_map(|c| toutes.iter().find(|b| &b.code == c).cloned()),
    );
    if retenues.is_empty() {
        if !codes.is_empty() || !noms.is_empty() {
            anyhow::bail!("aucun des personnages demandés n'a de banque de voix en « {langue} »");
        }
        retenues = toutes.into_iter().take(roles).collect();
    }

    std::fs::create_dir_all(out).with_context(|| format!("création de {}", out.display()))?;

    let mut personnages = Vec::new();
    for banque in &retenues {
        let voix = exporter_voix(vfs, out, banque, voix_max)?;
        let textures = exporter_textures(vfs, out, &banque.code, textures_max);
        let fiche = index.get(&banque.code);
        eprintln!(
            "  {} {} — {} réplique(s), {} texture(s)",
            banque.code,
            fiche.map_or(String::new(), |f| format!("({})", f.nom)),
            voix.len(),
            textures.len()
        );
        personnages.push(serde_json::json!({
            "code": banque.code,
            "nom": fiche.map(|f| f.nom.clone()),
            "genre": fiche.map(|f| f.genre),
            "voix": voix,
            "textures": textures,
        }));
    }

    let musique = if bgm_max > 0 {
        exporter_bgm(vfs, out, bgm_max)?
    } else {
        Vec::new()
    };

    let catalogue = serde_json::json!({
        "version": 1,
        "langue": langue,
        "personnages": personnages,
        "musique": musique,
    });
    let chemin = out.join("catalogue.json");
    std::fs::write(&chemin, serde_json::to_vec_pretty(&catalogue)?)
        .with_context(|| format!("écriture de {}", chemin.display()))?;

    println!(
        "catalogue  {} personnage(s), {} piste(s) de musique → {}",
        retenues.len(),
        musique.len(),
        chemin.display()
    );
    Ok(())
}

/// Décode jusqu'à `max` répliques d'une banque et rend leurs descripteurs JSON.
fn exporter_voix(
    vfs: &Vfs,
    out: &Path,
    banque: &Banque,
    max: usize,
) -> Result<Vec<serde_json::Value>> {
    let raw = vfs
        .read(&banque.acb)
        .with_context(|| format!("lecture de {}", banque.acb))?;
    let Some((awb, _source)) = audio::resoudre_awb(vfs, &banque.acb, &raw) else {
        eprintln!("  {} — banque d'octets introuvable, ignorée", banque.code);
        return Ok(Vec::new());
    };

    let dossier = out.join("voix").join(&banque.code);
    std::fs::create_dir_all(&dossier)?;

    let mut sortie = Vec::new();
    for cue in audio::cues(&raw, Some(&awb)) {
        if sortie.len() >= max {
            break;
        }
        let Some(id) = cue.awb_id else { continue };
        let Ok(wav) = audio::decoder_cue(&awb, id) else {
            continue;
        };
        let nom = audio::nom_de_fichier(&banque.acb, &cue);
        std::fs::write(dossier.join(&nom), wav)?;
        sortie.push(serde_json::json!({
            "cue": cue.name,
            "fichier": format!("voix/{}/{}", banque.code, nom),
            "ms": cue.length_ms,
        }));
    }
    Ok(sortie)
}

/// Extrait les textures du personnage (atlas d'expressions et planches de modèle) en PNG.
fn exporter_textures(vfs: &Vfs, out: &Path, code: &str, max: usize) -> Vec<serde_json::Value> {
    let mut chemins: Vec<String> = vfs
        .iter()
        .filter(|(path, _)| path.ends_with(".g4tx") && path.contains(code))
        .map(|(path, _)| path.to_string())
        .collect();
    // `_face` d'abord : c'est l'atlas d'expressions, le plus utile à un VN.
    chemins.sort_by_key(|p| (!p.contains("/_face/"), p.clone()));

    let dossier = out.join("images").join(code);
    if std::fs::create_dir_all(&dossier).is_err() {
        return Vec::new();
    }

    let mut sortie = Vec::new();
    for chemin in chemins {
        if sortie.len() >= max {
            break;
        }
        let Ok(raw) = vfs.read(&chemin) else { continue };
        let base = nie_formats::g4tx_decode::basename_of(&chemin);
        let Some(png) = nie_formats::g4tx_decode::decode_best_to_png(&raw, base) else {
            continue;
        };
        let nom = format!("{}.png", assainir(base));
        if std::fs::write(dossier.join(&nom), png).is_err() {
            continue;
        }
        sortie.push(serde_json::json!({
            "source": chemin,
            "fichier": format!("images/{code}/{nom}"),
            "role": if chemin.contains("/_face/") { "expressions" } else { "planche" },
        }));
    }
    sortie
}

/// Décode jusqu'à `max` pistes de `bgm.acb`.
fn exporter_bgm(vfs: &Vfs, out: &Path, max: usize) -> Result<Vec<serde_json::Value>> {
    const BGM: &str = "data/common/sound_asset/bgm.acb";
    let Ok(raw) = vfs.read(BGM) else {
        eprintln!("  bgm.acb absent, musique ignorée");
        return Ok(Vec::new());
    };
    let Some((awb, _)) = audio::resoudre_awb(vfs, BGM, &raw) else {
        return Ok(Vec::new());
    };

    let dossier = out.join("musique");
    std::fs::create_dir_all(&dossier)?;

    let mut sortie = Vec::new();
    for cue in audio::cues(&raw, Some(&awb)) {
        if sortie.len() >= max {
            break;
        }
        let Some(id) = cue.awb_id else { continue };
        let Ok(wav) = audio::decoder_cue(&awb, id) else {
            continue;
        };
        let nom = audio::nom_de_fichier(BGM, &cue);
        std::fs::write(dossier.join(&nom), wav)?;
        sortie.push(serde_json::json!({
            "cue": cue.name,
            "fichier": format!("musique/{nom}"),
            "ms": cue.length_ms,
        }));
    }
    eprintln!("  musique — {} piste(s)", sortie.len());
    Ok(sortie)
}

/// Restreint un nom venu du jeu à ce qu'un système de fichiers accepte partout.
fn assainir(nom: &str) -> String {
    nom.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::assainir;

    #[test]
    fn assainir_remplace_les_separateurs() {
        assert_eq!(assainir("c01/00.0010"), "c01_00_0010");
        assert_eq!(assainir("ev74_00840_me"), "ev74_00840_me");
    }
}
