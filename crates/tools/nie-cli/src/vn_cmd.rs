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

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use nie_explore::audio;
use nie_explore::vn::{
    CastingOptions, CharacterIdentity, VoiceBank, casting_entries, discover_voice_banks,
};
use nie_explore::vn::{
    ExportOptions, capitalize_name as capitaliser, catalogue as construire_catalogue,
    collect_texts as collecter_textes, dialogue_references, identities_from_iecode, plan_export,
    sanitize_filename as assainir, t2b_to_iecode as t2b_vers_iecode,
    usable_dialogue as replique_utilisable,
};
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
        /// Nombre maximal de répliques extraites par personnage.
        #[arg(long, default_value_t = 24)]
        voix_max: usize,
        /// Nombre maximal de pistes extraites de `bgm.acb` (0 = aucune).
        #[arg(long, default_value_t = 6)]
        bgm_max: usize,
        /// Nombre maximal de textures extraites par personnage.
        #[arg(long, default_value_t = 4)]
        textures_max: usize,
        /// Nombre maximal de repliques d'evenement relevees par personnage (0 = aucune).
        #[arg(long, default_value_t = 60)]
        dialogues_max: usize,
        /// Langue des repliques d'evenement (`fr`, `en`, `ja`, ...).
        #[arg(long, default_value = "fr")]
        langue_dialogues: String,
    },
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
            voix_max,
            bgm_max,
            textures_max,
            dialogues_max,
            langue_dialogues,
        } => export(
            vfs,
            out,
            codes,
            noms,
            langue_noms,
            langue,
            *voix_max,
            *bgm_max,
            *textures_max,
            *dialogues_max,
            langue_dialogues,
        ),
    }
}

// ---------------------------------------------------------------------------
// Identités : code interne <-> nom, lus dans l'installation locale
// ---------------------------------------------------------------------------

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
fn identites(vfs: &Vfs, langue_noms: &str) -> Vec<CharacterIdentity> {
    let Some(chemin_base) = chercher_chemin(
        vfs,
        "data/common/gamedata/character/chara_base_",
        ".cfg.bin",
    ) else {
        return Vec::new();
    };
    let chemin_texte = format!("data/common/text/{langue_noms}/chara_text.cfg.bin");

    let (Some(base_json), Some(texte_json)) =
        (lire_t2b(vfs, &chemin_base), lire_t2b(vfs, &chemin_texte))
    else {
        return Vec::new();
    };

    identities_from_iecode(&base_json, &texte_json)
}

// ---------------------------------------------------------------------------
// Repérage des banques
// ---------------------------------------------------------------------------

/// Toutes les banques `sound_asset/<langue>/c########.acb`, triées par poids décroissant.
fn banques(vfs: &Vfs, langue: &str) -> Vec<VoiceBank> {
    discover_voice_banks(
        vfs.iter()
            .map(|(path, entry)| (path.to_owned(), u64::from(entry.file_size))),
        langue,
    )
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

    let index: BTreeMap<String, CharacterIdentity> = identites(vfs, langue_noms)
        .into_iter()
        .map(|f| (f.code.clone(), f))
        .collect();

    let retenues = casting_entries(
        banques.iter().cloned(),
        index.values().cloned(),
        &CastingOptions {
            limit,
            search: chercher.map(str::to_owned),
            gender: genre.map(str::to_owned),
        },
    );

    if json {
        let liste: Vec<_> = retenues
            .iter()
            .map(|b| {
                serde_json::json!({
                    "code": b.code,
                    "nom": b.name,
                    "genre": b.gender,
                    "acb": b.acb,
                    "awb_octets": b.awb_bytes,
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
        let nom = b.name.as_deref().unwrap_or("—");
        let genre = b.gender.as_deref().unwrap_or(" ");
        println!("  {:>10}  {genre}  {:>12} o  {nom}", b.code, b.awb_bytes);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Repliques d'evenement
// ---------------------------------------------------------------------------

/// Releve, pour chaque code vise, les repliques que le jeu lui fait prononcer.
///
/// Le lien entre un personnage et son texte tient en deux regles, verifiees sur
/// l'installation :
///
/// * dans `event_cfg/evt/<ev>.cfg.bin`, la commande d'opcode [`OP_REPLIQUE`] porte
///   l'identifiant de la ligne (`ev01_01200_010_010`) et, en derniere chaine, le
///   code interne de celui qui la dit ;
/// * dans `text/<langue>/event/<ev>.cfg.bin`, la replique est indexee par le
///   `crc32` de cet identifiant.
///
/// Les scripts sont parcourus une seule fois pour tout le casting. Un evenement
/// sans table de texte dans la langue demandee est saute sans bruit : toutes les
/// langues ne couvrent pas tous les evenements.
fn relever_dialogues(
    vfs: &Vfs,
    codes: &BTreeSet<String>,
    langue: &str,
    max: usize,
) -> BTreeMap<String, Vec<serde_json::Value>> {
    use nie_formats::cfgbin;

    let mut scripts: Vec<String> = vfs
        .iter()
        .filter(|(p, _)| p.starts_with("data/common/event_cfg/evt/") && p.ends_with(".cfg.bin"))
        .map(|(p, _)| p.to_string())
        .collect();
    scripts.sort();

    let balises = table_des_balises(vfs, langue);
    let mut out: BTreeMap<String, Vec<serde_json::Value>> = BTreeMap::new();

    for chemin in &scripts {
        if !out.is_empty()
            && codes
                .iter()
                .all(|c| out.get(c).is_some_and(|v| v.len() >= max))
        {
            break;
        }
        let Some(evenement) = chemin
            .rsplit('/')
            .next()
            .and_then(|f| f.strip_suffix(".cfg.bin"))
        else {
            continue;
        };
        let Ok(raw) = vfs.read(chemin) else { continue };
        let Ok(cfg) = cfgbin::cfgbin_parse(&raw) else {
            continue;
        };

        let attendues = dialogue_references(&cfg.entries, codes);
        if attendues.is_empty() {
            continue;
        }

        let chemin_texte = format!("data/common/text/{langue}/event/{evenement}.cfg.bin");
        let Ok(brut_texte) = vfs.read(&chemin_texte) else {
            continue;
        };
        let Ok(table) = cfgbin::cfgbin_parse(&brut_texte) else {
            continue;
        };
        let mut textes: BTreeMap<u32, String> = BTreeMap::new();
        collecter_textes(&table.entries, &mut textes);

        for (code, ligne) in attendues {
            let seau = out.entry(code).or_default();
            if seau.len() >= max {
                continue;
            }
            let cle = cfgbin::crc32(ligne.as_bytes());
            let Some(texte) = textes.get(&cle) else {
                continue;
            };
            let Some(propre) = replique_utilisable(texte, &balises) else {
                continue;
            };
            seau.push(serde_json::json!({
                "evenement": evenement,
                "ligne": ligne,
                "texte": propre,
            }));
        }
    }

    out
}

/// Table des balises de nom employees dans le texte des evenements.
///
/// Le jeu n'ecrit pas les noms en clair : il pose `<FLC:YASHIMA>`, `<FUL:RAIKA>`,
/// ou seul le segment apres le `:` identifie le personnage. Ce segment est la
/// forme romanisee majuscule de `chara_text_roma` ; le nom affichable se lit sous
/// le meme hash dans `chara_text` de la langue demandee.
///
/// Une balise non resolue est laissee telle quelle plutot que supprimee : mieux
/// vaut un `<FLC:XXX>` visible qu'une phrase amputee de son sujet.
fn table_des_balises(vfs: &Vfs, langue: &str) -> BTreeMap<String, String> {
    use nie_formats::cfgbin;

    let lire = |nom: &str| -> BTreeMap<u32, String> {
        let mut out = BTreeMap::new();
        if let Ok(brut) = vfs.read(&format!("data/common/text/{langue}/{nom}.cfg.bin"))
            && let Ok(table) = cfgbin::cfgbin_parse(&brut)
        {
            collecter_textes(&table.entries, &mut out);
        }
        out
    };

    let roma = lire("chara_text_roma");
    let affichables = lire("chara_text");

    let mut out = BTreeMap::new();
    for (hash, forme) in &roma {
        // Seules les formes tout en majuscules servent de balise.
        if forme.is_empty()
            || !forme
                .chars()
                .all(|c| c.is_ascii_uppercase() || c == '_' || c.is_ascii_digit())
        {
            continue;
        }
        if let Some(nom) = affichables.get(hash) {
            out.entry(forme.clone()).or_insert_with(|| capitaliser(nom));
        }
    }
    out
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
    voix_max: usize,
    bgm_max: usize,
    textures_max: usize,
    dialogues_max: usize,
    langue_dialogues: &str,
) -> Result<()> {
    let toutes = banques(vfs, langue);
    if toutes.is_empty() {
        anyhow::bail!("aucune banque de voix sous data/common/sound_asset/{langue}/");
    }

    let index: BTreeMap<String, CharacterIdentity> = identites(vfs, langue_noms)
        .into_iter()
        .map(|f| (f.code.clone(), f))
        .collect();

    let plan = plan_export(
        &toutes,
        &index.values().cloned().collect::<Vec<_>>(),
        &ExportOptions {
            codes: codes.to_vec(),
            names: noms.to_vec(),
            language: langue.to_owned(),
        },
    )
    .map_err(anyhow::Error::msg)?;
    for warning in plan.warnings {
        eprintln!("  {warning}");
    }
    let retenues = plan.banks;

    std::fs::create_dir_all(out).with_context(|| format!("création de {}", out.display()))?;

    // Les repliques se relevent en une seule passe sur les scripts d'evenement :
    // les ~2 000 fichiers sont parcourus une fois pour tout le casting, pas une
    // fois par personnage.
    let vises: BTreeSet<String> = retenues.iter().map(|b| b.code.clone()).collect();
    let mut dialogues = if dialogues_max > 0 {
        relever_dialogues(vfs, &vises, langue_dialogues, dialogues_max)
    } else {
        BTreeMap::new()
    };

    let mut personnages = Vec::new();
    for banque in &retenues {
        let voix = exporter_voix(vfs, out, banque, voix_max)?;
        let textures = exporter_textures(vfs, out, &banque.code, textures_max);
        let repliques = dialogues.remove(&banque.code).unwrap_or_default();
        let fiche = index.get(&banque.code);
        eprintln!(
            "  {} {} — {} voix, {} texture(s), {} replique(s) ecrite(s)",
            banque.code,
            fiche.map_or(String::new(), |f| format!("({})", f.name)),
            voix.len(),
            textures.len(),
            repliques.len()
        );
        personnages.push(serde_json::json!({
            "code": banque.code,
            "nom": fiche.map(|f| f.name.clone()),
            "genre": fiche.map(|f| f.gender.clone()),
            "voix": voix,
            "textures": textures,
            "dialogues": repliques,
        }));
    }

    let musique = if bgm_max > 0 {
        exporter_bgm(vfs, out, bgm_max)?
    } else {
        Vec::new()
    };

    let catalogue = construire_catalogue(langue, personnages, musique.clone());
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
    banque: &VoiceBank,
    max: usize,
) -> Result<Vec<serde_json::Value>> {
    if banque.acb.is_empty() {
        return Ok(Vec::new());
    }
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

#[cfg(test)]
mod tests {
    use super::assainir;
    use nie_explore::vn::{CastingOptions, CharacterIdentity, VoiceBank, casting_entries};

    #[test]
    fn assainir_remplace_les_separateurs() {
        assert_eq!(assainir("c01/00.0010"), "c01_00_0010");
        assert_eq!(assainir("ev74_00840_me"), "ev74_00840_me");
    }

    #[test]
    fn casting_adapter_preserves_cli_json_field_names() {
        let entries = casting_entries(
            [VoiceBank {
                code: "c1".into(),
                acb: "c1.acb".into(),
                awb_bytes: 7,
            }],
            [CharacterIdentity {
                code: "c1".into(),
                name: "Mark".into(),
                gender: "m".into(),
            }],
            &CastingOptions {
                limit: 1,
                search: None,
                gender: None,
            },
        );
        let value = serde_json::json!({
            "code": entries[0].code,
            "nom": entries[0].name,
            "genre": entries[0].gender,
            "acb": entries[0].acb,
            "awb_octets": entries[0].awb_bytes,
        });
        assert_eq!(value["nom"], "Mark");
        assert_eq!(value["awb_octets"], 7);
    }
}
