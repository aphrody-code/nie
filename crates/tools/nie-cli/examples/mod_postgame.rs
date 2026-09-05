//! `mod_postgame` — applique le mod « postgame99 » **par patch d'octets**, et le prouve.
//!
//! Trois changements, tous sur des valeurs à taille constante, donc tous applicables sans
//! réencoder (cf. [`nie_formats::rdbn_patch`] — le réencodage `cfg.bin` n'est pas fidèle et le
//! jeu refuse le fichier qui en sort) :
//!
//! 1. **Cap de niveau 99** — `system/level_limit_config` : les deux paliers `level` (50 de base,
//!    49 débloqué par le flag postgame) passent à 99, et les deux paliers de rareté à 7.
//! 2. **`extend_story` remaniée** — titre et explication repointés vers d'autres textes réels du
//!    jeu (le champ est un hash de texte : on ne fabrique aucune chaîne), type d'histoire changé,
//!    et `validCond` neutralisée : l'histoire étendue n'exige plus d'avoir fini le jeu.
//! 3. **Archon Aphrodite Teita Tanji jouable et dropable** — `players_universe`, l'entrée du
//!    `charaParamId` `0xD5ACAA9D` : condition d'activation neutralisée, rareté portée à 7, taux
//!    de tirage relevés, marqué « remarquable ».
//!
//! La neutralisation d'une condition s'écrit `0xFFFFFFFF` : le jeu lit ce champ comme un offset
//! dans la table de chaînes, et une valeur hors bornes y signifie « aucune condition »
//! (`read_condition_value`, `cfgbin.rs`). Rien n'est inventé, aucune chaîne n'est déplacée.
//!
//! ## Preuve produite
//!
//! Pour chaque fichier : sha256 avant/après, taille avant/après, nombre et **liste des offsets**
//! d'octets qui diffèrent du vanilla du VFS, et relecture de chaque champ patché par le parseur.
//! Un patch n'est réputé bon que si la taille est identique, que les seuls octets changés sont
//! ceux des champs visés, et que la relecture rend les valeurs demandées.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example mod_postgame -- [--dir var/mods/postgame99] [--a-blanc]
//! ```

use std::collections::BTreeMap;

use nie_data::text::parse_text_file;
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin::{self, RdbnValue};
use nie_formats::rdbn_patch::{Modif, Val, localiser, patch_verifie};
use nie_formats::vfs::{self, Vfs};
use sha2::{Digest, Sha256};

/// `charaParamId` d'Archon Aphrodite Teita Tanji (`c11150120`, Solaria-Zeus) dans
/// `players_universe` — relevé sur le VFS réel, pas supposé.
const APHRODITE_PARAM_ID: u32 = 0xD5AC_AA9D;

/// Sentinelle « aucune condition » : le champ vaut un offset de chaîne, et une valeur hors des
/// bornes de la table est lue comme absence de condition.
const AUCUNE_CONDITION: i32 = -1;

fn sha256(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Charge tous les textes d'une langue → `hash → texte`.
fn charger_textes(vfs: &Vfs, langue: &str) -> BTreeMap<u32, String> {
    let prefixe = format!("data/common/text/{langue}/");
    let mut map = BTreeMap::new();
    let mut fichiers: Vec<String> = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .filter(|c| c.starts_with(&prefixe) && c.ends_with(".cfg.bin"))
        .collect();
    fichiers.sort();
    fichiers.dedup();
    for f in &fichiers {
        let Ok(data) = vfs.read(f) else { continue };
        let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
            continue;
        };
        for (h, t) in parse_text_file(&t2b_to_json(&cfg)) {
            map.insert(h.0, t);
        }
    }
    map
}

/// Premier hash dont le texte contient `motif` (insensible à la casse), avec son texte.
fn texte_contenant<'a>(
    textes: &'a BTreeMap<u32, String>,
    motif: &str,
) -> Option<(u32, &'a String)> {
    let m = motif.to_lowercase();
    textes
        .iter()
        .find(|(_, t)| t.to_lowercase().contains(&m))
        .map(|(h, t)| (*h, t))
}

/// Trouve l'index de ligne dont un champ `Hash` vaut `cible`.
fn ligne_par_hash(data: &[u8], liste: &str, champ: &str, cible: u32) -> Option<usize> {
    let rdbn = cfgbin::parse(data).ok()?;
    let listes = cfgbin::read_values(&rdbn, data);
    let l = listes.iter().find(|l| l.name == liste)?;
    l.rows.iter().position(|r| {
        r.fields
            .iter()
            .any(|(k, v)| k == champ && matches!(v, RdbnValue::Hash(h) if *h == cible))
    })
}

/// Lit la valeur courante d'un champ, pour l'affichage « avant → après ».
fn valeur_actuelle(data: &[u8], liste: &str, ligne: usize, champ: &str) -> String {
    let Ok(rdbn) = cfgbin::parse(data) else {
        return String::from("?");
    };
    cfgbin::read_values(&rdbn, data)
        .iter()
        .find(|l| l.name == liste)
        .and_then(|l| l.rows.get(ligne))
        .and_then(|r| r.fields.iter().find(|(k, _)| k == champ))
        .map_or_else(|| String::from("?"), |(_, v)| format!("{v:?}"))
}

/// Applique un lot de modifications à un fichier du mod et prouve le résultat contre le vanilla.
fn traiter(
    vfs: &Vfs,
    dir: &str,
    chemin_vfs: &str,
    modifs: &[Modif],
    a_blanc: bool,
) -> Result<(), String> {
    let chemin_mod = format!("{dir}/{chemin_vfs}");
    let vanilla = vfs
        .read(chemin_vfs)
        .map_err(|e| format!("vanilla illisible : {e}"))?;
    let mut data = std::fs::read(&chemin_mod).map_err(|e| format!("{chemin_mod} : {e}"))?;

    println!(
        "\n╔═ {}",
        chemin_vfs.trim_start_matches("data/common/gamedata/")
    );
    println!(
        "║ vanilla  {} o  sha256 {}",
        vanilla.len(),
        &sha256(&vanilla)[..16]
    );

    // Localiser d'abord : un offset invalide doit échouer avant d'écrire quoi que ce soit.
    let rdbn = cfgbin::parse(&data).map_err(|e| format!("RDBN illisible : {e}"))?;
    let mut cibles = Vec::new();
    for m in modifs {
        let loc = localiser(&rdbn, &m.liste, m.ligne, &m.champ).map_err(|e| e.to_string())?;
        let avant = valeur_actuelle(&data, &m.liste, m.ligne, &m.champ);
        cibles.push((m.clone(), loc, avant));
    }

    let verif = patch_verifie(&mut data, modifs).map_err(|e| e.to_string())?;

    // Diff octet à octet contre le vanilla : la preuve que rien d'autre n'a bougé.
    let diffs: Vec<usize> = vanilla
        .iter()
        .zip(data.iter())
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(i, _)| i)
        .collect();
    let attendus: Vec<usize> = cibles
        .iter()
        .flat_map(|(_, loc, _)| loc.offset..loc.offset + loc.size)
        .collect();
    let hors_cible: Vec<usize> = diffs
        .iter()
        .copied()
        .filter(|o| !attendus.contains(o))
        .collect();

    println!(
        "║ patché   {} o  sha256 {}",
        data.len(),
        &sha256(&data)[..16]
    );
    println!(
        "║ taille   {}  ({} → {})",
        if verif.taille_preservee() {
            "PRÉSERVÉE"
        } else {
            "MODIFIÉE — anormal"
        },
        verif.taille_avant,
        verif.taille_apres
    );
    println!(
        "║ octets   {} différents du vanilla, {} hors des champs visés",
        diffs.len(),
        hors_cible.len()
    );

    for ((m, loc, avant), apres) in cibles.iter().zip(verif.relues.iter()) {
        println!(
            "║   {}[{}].{:<18} @0x{:06X} {:>2}o  {avant}  →  {apres}",
            m.liste, m.ligne, m.champ, loc.offset, loc.size
        );
    }

    if !hors_cible.is_empty() {
        return Err(format!(
            "{} octet(s) modifiés hors des champs visés",
            hors_cible.len()
        ));
    }

    if a_blanc {
        println!("╚═ à blanc : rien écrit");
        return Ok(());
    }
    std::fs::write(&chemin_mod, &data).map_err(|e| format!("écriture : {e}"))?;
    println!("╚═ écrit   {chemin_mod}");
    Ok(())
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir = String::from("var/mods/postgame99");
    let a_blanc = args.iter().any(|a| a == "--a-blanc");
    args.retain(|a| a != "--a-blanc");
    if let Some(i) = args.iter().position(|a| a == "--dir") {
        dir = args.get(i + 1).cloned().unwrap_or(dir);
    }

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };

    // ── 1. Cap de niveau ──────────────────────────────────────────────────────────────────
    let f_level = "data/common/gamedata/system/level_limit_config_0.00.00.00.cfg.bin";
    let modifs_level = vec![
        Modif {
            liste: "m_LevelLimitInfoList".into(),
            ligne: 0,
            champ: "level".into(),
            valeur: Val::I32(99),
        },
        Modif {
            liste: "m_LevelLimitInfoList".into(),
            ligne: 1,
            champ: "level".into(),
            valeur: Val::I32(99),
        },
        Modif {
            liste: "m_RareLimitInfoList".into(),
            ligne: 0,
            champ: "rarity".into(),
            valeur: Val::I32(7),
        },
        Modif {
            liste: "m_RareLimitInfoList".into(),
            ligne: 1,
            champ: "rarity".into(),
            valeur: Val::I32(7),
        },
    ];

    // ── 2. extend_story ───────────────────────────────────────────────────────────────────
    // Les identifiants de texte sont des hash : on repointe vers des textes **qui existent
    // déjà** dans la localisation du jeu, choisis par leur contenu — aucune chaîne fabriquée.
    let textes = charger_textes(&vfs, "fr");
    println!("textes   {} entrées localisées (fr)", textes.len());
    let titre = texte_contenant(&textes, "Archon Aphrodite");
    let expl = texte_contenant(&textes, "Solaria-Zeus");
    if let Some((h, t)) = &titre {
        println!("titre    0x{h:08X} « {t} »");
    }
    if let Some((h, t)) = &expl {
        println!("explic.  0x{h:08X} « {t} »");
    }

    let f_story = "data/common/gamedata/extend_story/extend_story_data_config_0.00.02.00.cfg.bin";
    let mut modifs_story = vec![
        // Le type d'histoire étendue : 1 → 2 (l'autre valeur portée par le champ dans le jeu).
        Modif {
            liste: "m_exStoryDataConfigList".into(),
            ligne: 0,
            champ: "extendStoryType".into(),
            valeur: Val::U8(2),
        },
        // Condition de validité neutralisée : plus besoin d'avoir fini l'histoire.
        Modif {
            liste: "m_exStoryDataConfigList".into(),
            ligne: 0,
            champ: "validCond".into(),
            valeur: Val::StrOffset(AUCUNE_CONDITION),
        },
    ];
    if let Some((h, _)) = titre {
        modifs_story.push(Modif {
            liste: "m_exStoryDataConfigList".into(),
            ligne: 0,
            champ: "titleTextId".into(),
            valeur: Val::Hash(h),
        });
    }
    if let Some((h, _)) = expl {
        modifs_story.push(Modif {
            liste: "m_exStoryDataConfigList".into(),
            ligne: 0,
            champ: "explanationTextId".into(),
            valeur: Val::Hash(h),
        });
    }

    // ── 3. Archon Aphrodite Teita Tanji ───────────────────────────────────────────────────
    let f_pu = "data/common/gamedata/players_universe/players_universe_config_1.03.59.00.cfg.bin";
    let vanilla_pu = vfs.read(f_pu).expect("players_universe lisible");
    let Some(ligne) = ligne_par_hash(
        &vanilla_pu,
        "m_starSignCharaInfoList",
        "charaParamId",
        APHRODITE_PARAM_ID,
    ) else {
        eprintln!("charaParamId 0x{APHRODITE_PARAM_ID:08X} introuvable dans players_universe");
        std::process::exit(1);
    };
    println!("aphrodite ligne {ligne} de m_starSignCharaInfoList");

    let mut modifs_pu = vec![
        Modif {
            liste: "m_starSignCharaInfoList".into(),
            ligne,
            champ: "enableCond".into(),
            valeur: Val::StrOffset(AUCUNE_CONDITION),
        },
        Modif {
            liste: "m_starSignCharaInfoList".into(),
            ligne,
            champ: "charaRarity".into(),
            valeur: Val::U8(7),
        },
        Modif {
            liste: "m_starSignCharaInfoList".into(),
            ligne,
            champ: "charaRateDefault".into(),
            valeur: Val::I32(1000),
        },
        Modif {
            liste: "m_starSignCharaInfoList".into(),
            ligne,
            champ: "isRemarkable".into(),
            valeur: Val::Bool(true),
        },
    ];
    for boost in [
        "charaRateBoostA",
        "charaRateBoostB",
        "charaRateBoostC",
        "charaRateBoostD",
    ] {
        modifs_pu.push(Modif {
            liste: "m_starSignCharaInfoList".into(),
            ligne,
            champ: boost.into(),
            valeur: Val::I32(1000),
        });
    }

    let mut echecs = 0;
    for (chemin, modifs) in [
        (f_level, &modifs_level),
        (f_story, &modifs_story),
        (f_pu, &modifs_pu),
    ] {
        if let Err(e) = traiter(&vfs, &dir, chemin, modifs, a_blanc) {
            eprintln!("║ ÉCHEC {chemin} : {e}");
            echecs += 1;
        }
    }

    println!("\n{} fichier(s) patché(s), {echecs} échec(s)", 3 - echecs);
    if echecs > 0 {
        std::process::exit(1);
    }
}
