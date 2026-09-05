//! `postgame_scan` — cartographie du **contenu post-histoire** d'IEVR depuis le VFS réel.
//!
//! Le jeu verrouille son contenu derrière des **blobs de condition** (`RdbnValue::Condition`,
//! base64) présents dans toutes les tables `data/common/gamedata/**/*.cfg.bin`. Ces blobs sont
//! décodés par [`nie_data::unlock_condition`] : soit un **seuil de progression de l'histoire**
//! (namespace `0xB91936DA`), soit des **event-flags** (hash 32 bits), soit les deux.
//!
//! ## Ce que l'outil établit, sans rien deviner
//!
//! 1. **Registre des flags** — `system/flag_config_*.cfg.bin` (T2B, catégories `FLAG_INFO` /
//!    `FLAG_TBOX_INFO` / `FLAG_TBOX_REPOP_INFO` / `FLAG_MAP_DOOR_INFO`, chaque entrée = `[index,
//!    …, hash]`) et `system/extend_story_setting.cfg.bin` (`STORY_FLAG_INFO`, `NONE_ID_FLAG_INFO`,
//!    `TBOX_FLAG_INFO`). Un flag référencé par une condition est ainsi **situé** dans le registre
//!    (catégorie, type, index) — et non nommé : le jeu ne stocke pas les noms, on ne les invente pas.
//! 2. **Grille des seuils d'histoire** — le seuil observé se décompose en `chapitre =
//!    seuil / 10000` et `étape = (seuil % 10000) / 10` (validé : 100 % des seuils du corpus sont
//!    multiples de 10). `nie_data::unlock_condition::story_threshold_to_episode` ne reconnaît que
//!    la sous-grille `*0010` ; on garde les deux lectures côte à côte plutôt que d'en écraser une.
//! 3. **Pivot du postgame** — le flag le plus référencé du corpus après le flag nul, celui
//!    qu'exige `extend_story_data_config` (le contenu explicitement post-histoire). Tout ce qui
//!    dépend de ce flag est listé, par fichier.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example postgame_scan -- [--json var/postgame/postgame.json] [--top N]
//! ```

use std::collections::BTreeMap;

use nie_data::unlock_condition::{UnlockCondition, UnlockType, decode_unlock_condition};
use nie_formats::cfgbin::{self, CfgEntry, RdbnValue, Value};
use nie_formats::vfs::{self, Vfs};

/// Emplacement d'un flag dans un registre du jeu.
#[derive(Clone)]
struct Emplacement {
    /// Fichier registre (court).
    registre: &'static str,
    /// Nom de la catégorie (`FLAG_INFO`, `STORY_FLAG_INFO`, …).
    categorie: String,
    /// Type / groupe déclaré par le noeud `*_INFO` parent.
    groupe: i64,
    /// Index déclaré par l'entrée.
    index: i64,
}

/// Usage d'un flag : nombre de références, et les namespaces sous lesquels il apparaît.
type Usage = (usize, BTreeMap<u32, usize>);

/// Une condition trouvée dans le corpus, avec sa provenance exacte.
struct Trouvee {
    fichier: String,
    liste: String,
    ligne: usize,
    champ: String,
    cond: UnlockCondition,
}

/// Décompose un seuil d'histoire en `(chapitre, étape)` : la grille réelle est
/// `chapitre * 10000 + étape * 10` (les seuils du corpus sont tous multiples de 10).
fn chapitre_etape(seuil: u32) -> (u32, u32) {
    (seuil / 10_000, (seuil % 10_000) / 10)
}

/// Parcourt un T2B `*_LIST_BEG` dont les enfants alternent `X_INFO` (déclare le groupe) et
/// `X_..._LIST_BEG` (porte les entrées). Renvoie `(catégorie, groupe, index, hash)`.
fn lire_registre(entries: &[CfgEntry], registre: &'static str) -> Vec<(Emplacement, u32)> {
    let mut out = Vec::new();
    for racine in entries {
        let categorie = racine.name.trim_end_matches("_LIST_BEG").to_string();
        let mut groupe = 0i64;
        for enfant in &racine.children {
            let ints: Vec<i64> = enfant
                .variables
                .iter()
                .map(|v| match v {
                    Value::Int(i) => i64::from(*i),
                    _ => 0,
                })
                .collect();
            if enfant.name.ends_with("_INFO") && enfant.children.is_empty() {
                // Noeud d'en-tête : déclare le groupe/type de la liste qui suit.
                groupe = ints.first().copied().unwrap_or(0);
                continue;
            }
            if !enfant.children.is_empty() {
                for e in &enfant.children {
                    let vals: Vec<i64> = e
                        .variables
                        .iter()
                        .map(|v| match v {
                            Value::Int(i) => i64::from(*i),
                            _ => 0,
                        })
                        .collect();
                    // Forme constante du registre : la dernière variable est le hash du flag,
                    // la première son index dans le bitfield de sauvegarde.
                    let (Some(&index), Some(&hash)) = (vals.first(), vals.last()) else {
                        continue;
                    };
                    if vals.len() < 2 {
                        continue;
                    }
                    out.push((
                        Emplacement {
                            registre,
                            categorie: categorie.clone(),
                            groupe,
                            index,
                        },
                        hash as u32,
                    ));
                }
            }
        }
    }
    out
}

/// Charge un registre T2B depuis le VFS ; silencieux si le fichier est absent.
fn charger_registre(vfs: &Vfs, chemin: &str, etiquette: &'static str) -> Vec<(Emplacement, u32)> {
    let Ok(data) = vfs.read(chemin) else {
        return Vec::new();
    };
    let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
        return Vec::new();
    };
    lire_registre(&cfg.entries, etiquette)
}

/// Résout le chemin exact d'un fichier versionné (`flag_config_7.00.14.00.cfg.bin`).
fn resoudre_versionne(vfs: &Vfs, prefixe: &str) -> Option<String> {
    vfs.iter()
        .map(|(c, _)| c)
        .find(|c| c.starts_with(prefixe) && c.ends_with(".cfg.bin"))
        .map(str::to_string)
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut sortie_json = String::from("var/postgame/postgame.json");
    let mut top = 20usize;
    if let Some(i) = args.iter().position(|a| a == "--json") {
        sortie_json = args.get(i + 1).cloned().unwrap_or(sortie_json);
        args.drain(i..=i + 1);
    }
    if let Some(i) = args.iter().position(|a| a == "--top") {
        top = args.get(i + 1).and_then(|v| v.parse().ok()).unwrap_or(top);
        args.drain(i..=i + 1);
    }

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };
    println!(
        "VFS      {} — {} entrées",
        if vfs.is_dump() { "dump" } else { "packs" },
        vfs.asset_count()
    );

    // ── Registres de flags ────────────────────────────────────────────────────────────────
    let mut registre: BTreeMap<u32, Vec<Emplacement>> = BTreeMap::new();
    let mut sources = Vec::new();
    if let Some(chemin) = resoudre_versionne(&vfs, "data/common/gamedata/system/flag_config_") {
        let n = charger_registre(&vfs, &chemin, "system/flag_config");
        sources.push((chemin, n.len()));
        for (e, h) in n {
            registre.entry(h).or_default().push(e);
        }
    }
    for (chemin, etiquette) in [(
        "data/common/gamedata/system/extend_story_setting.cfg.bin",
        "system/extend_story_setting",
    )] {
        let n = charger_registre(&vfs, chemin, etiquette);
        sources.push((chemin.to_string(), n.len()));
        for (e, h) in n {
            registre.entry(h).or_default().push(e);
        }
    }
    for (c, n) in &sources {
        println!(
            "registre {}  {n} entrée(s)",
            c.trim_start_matches("data/common/gamedata/")
        );
    }
    println!("flags    {} hash distincts au registre", registre.len());

    // ── Balayage des tables ───────────────────────────────────────────────────────────────
    let mut fichiers: Vec<String> = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .filter(|c| {
            c.starts_with("data/common/gamedata/")
                && c.ends_with(".cfg.bin")
                && !c.ends_with(".lua.bin")
        })
        .collect();
    fichiers.sort();
    fichiers.dedup();

    let mut trouvees: Vec<Trouvee> = Vec::new();
    let mut rdbn_ok = 0usize;
    let mut non_rdbn = 0usize;
    let mut chaines = 0usize;

    for chemin in &fichiers {
        let Ok(data) = vfs.read(chemin) else { continue };
        let Ok(rdbn) = cfgbin::parse(&data) else {
            non_rdbn += 1;
            continue;
        };
        rdbn_ok += 1;
        for liste in cfgbin::read_values(&rdbn, &data) {
            for (i, row) in liste.rows.iter().enumerate() {
                for (nom, val) in &row.fields {
                    if let RdbnValue::Condition(b64) = val {
                        if b64.is_empty() {
                            continue;
                        }
                        // Le type RDBN 20 est « chaîne de la table de chaînes » : il porte les
                        // blobs de condition base64 **et** des chaînes ordinaires (`imgPath`…).
                        // Seules celles qui décodent en feuilles sont des conditions.
                        let cond = decode_unlock_condition(b64);
                        if cond.story_threshold.is_none() && cond.required_events.is_empty() {
                            chaines += 1;
                            continue;
                        }
                        trouvees.push(Trouvee {
                            fichier: chemin.clone(),
                            liste: liste.name.clone(),
                            ligne: i,
                            champ: nom.clone(),
                            cond,
                        });
                    }
                }
            }
        }
    }

    println!(
        "tables   {} .cfg.bin scannés — {rdbn_ok} RDBN, {non_rdbn} T2B\n\
         blobs    {} conditions à feuilles ({chaines} chaînes du même type RDBN écartées)",
        fichiers.len(),
        trouvees.len()
    );

    // ── Agrégats ──────────────────────────────────────────────────────────────────────────
    let mut par_kind: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut par_chapitre: BTreeMap<u32, usize> = BTreeMap::new();
    let mut seuils: BTreeMap<u32, usize> = BTreeMap::new();
    // hash de flag → (occurrences, namespaces observés)
    let mut flags: BTreeMap<u32, Usage> = BTreeMap::new();

    for t in &trouvees {
        let k = match t.cond.kind {
            UnlockType::Always => "always",
            UnlockType::Story => "story",
            UnlockType::EventFlag => "event_flag",
            UnlockType::Composite => "composite",
        };
        *par_kind.entry(k).or_default() += 1;
        if let Some(s) = t.cond.story_threshold {
            *seuils.entry(s).or_default() += 1;
            *par_chapitre.entry(chapitre_etape(s).0).or_default() += 1;
        }
        for e in &t.cond.required_events {
            let slot = flags.entry(e.crc).or_insert((0, BTreeMap::new()));
            slot.0 += 1;
            *slot.1.entry(e.namespace.0).or_default() += 1;
        }
    }

    println!("\n── Catégories de condition ──");
    for (k, n) in &par_kind {
        println!("  {k:<12} {n:>7}");
    }

    println!("\n── Progression d'histoire exigée, par chapitre (seuil = ch×10000 + étape×10) ──");
    for (ch, n) in &par_chapitre {
        let etapes: Vec<u32> = seuils
            .keys()
            .filter(|s| chapitre_etape(**s).0 == *ch)
            .map(|s| chapitre_etape(*s).1)
            .collect();
        let (mini, maxi) = (
            etapes.iter().min().copied().unwrap_or(0),
            etapes.iter().max().copied().unwrap_or(0),
        );
        println!(
            "  chapitre {ch:>2}  {n:>5} condition(s)  {:>2} seuil(s) distinct(s), étapes {mini}→{maxi}",
            etapes.len()
        );
    }

    // ── Pivot du postgame ─────────────────────────────────────────────────────────────────
    // Le flag exigé par `extend_story_data_config` : le contenu explicitement post-histoire.
    let pivot = trouvees
        .iter()
        .find(|t| t.fichier.contains("/extend_story/"))
        .and_then(|t| t.cond.required_events.first())
        .map(|e| e.crc);

    let Some(pivot) = pivot else {
        println!("\nAucune condition sur extend_story : pas de pivot postgame identifiable.");
        return;
    };

    let (occ, ns) = flags.get(&pivot).cloned().unwrap_or((0, BTreeMap::new()));
    println!("\n══ PIVOT DU POSTGAME ══");
    println!("  flag      0x{pivot:08X}  — exigé par extend_story_data_config");
    println!("  usages    {occ} conditions dans tout le corpus");
    println!(
        "  namespace {}",
        ns.keys()
            .map(|n| format!("0x{n:08X}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    match registre.get(&pivot) {
        Some(v) => {
            for e in v.iter().take(4) {
                println!(
                    "  registre  {} / {} groupe {} index {}",
                    e.registre, e.categorie, e.groupe, e.index
                );
            }
        }
        None => println!("  registre  non trouvé (flag hors des registres chargés)"),
    }

    let post: Vec<&Trouvee> = trouvees
        .iter()
        .filter(|t| t.cond.required_events.iter().any(|e| e.crc == pivot))
        .collect();

    let mut par_fichier: BTreeMap<&str, usize> = BTreeMap::new();
    for t in &post {
        *par_fichier.entry(t.fichier.as_str()).or_default() += 1;
    }
    println!(
        "\n── Contenu verrouillé derrière ce flag : {} verrous, {} fichiers ──",
        post.len(),
        par_fichier.len()
    );
    let mut classe: Vec<(&&str, &usize)> = par_fichier.iter().collect();
    classe.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    for (f, n) in classe.iter().take(top) {
        println!(
            "  {n:>4}×  {}",
            f.trim_start_matches("data/common/gamedata/")
        );
    }
    if classe.len() > top {
        println!("  … {} fichier(s) de plus", classe.len() - top);
    }

    // ── Flags les plus structurants ───────────────────────────────────────────────────────
    let mut top_flags: Vec<(&u32, &Usage)> = flags.iter().filter(|(h, _)| **h != 0).collect();
    top_flags.sort_by_key(|e| std::cmp::Reverse(e.1.0));
    let situes = flags.keys().filter(|h| registre.contains_key(h)).count();
    println!(
        "\n── Flags référencés : {} distincts, {situes} situés au registre ──",
        flags.len()
    );
    for (h, (n, _)) in top_flags.iter().take(top) {
        let ou = registre
            .get(h)
            .and_then(|v| v.first())
            .map(|e| format!("{}[{}] index {}", e.categorie, e.groupe, e.index))
            .unwrap_or_else(|| String::from("—"));
        println!("  {n:>5}×  0x{h:08X}  {ou}");
    }

    // ── Export JSON ───────────────────────────────────────────────────────────────────────
    let entrees: Vec<serde_json::Value> = trouvees
        .iter()
        .map(|t| {
            let (ch, et) = t.cond.story_threshold.map(chapitre_etape).unzip();
            serde_json::json!({
                "fichier": t.fichier,
                "liste": t.liste,
                "ligne": t.ligne,
                "champ": t.champ,
                "kind": match t.cond.kind {
                    UnlockType::Always => "always",
                    UnlockType::Story => "story",
                    UnlockType::EventFlag => "event_flag",
                    UnlockType::Composite => "composite",
                },
                "story_threshold": t.cond.story_threshold,
                "story_chapitre": ch,
                "story_etape": et,
                "story_episode": t.cond.story_episode,
                "postgame": t.cond.required_events.iter().any(|e| e.crc == pivot),
                "events": t.cond.required_events.iter().map(|e| {
                    let situe = registre.get(&e.crc).and_then(|v| v.first()).map(|x| serde_json::json!({
                        "registre": x.registre, "categorie": x.categorie,
                        "groupe": x.groupe, "index": x.index,
                    }));
                    serde_json::json!({
                        "flag": e.crc_hex(),
                        "namespace": format!("0x{:08X}", e.namespace.0),
                        "count": e.count,
                        "registre": situe,
                    })
                }).collect::<Vec<_>>(),
                "raw": t.cond.raw,
            })
        })
        .collect();

    let doc = serde_json::json!({
        "source": vfs.game_data_dir().display().to_string(),
        "montage": if vfs.is_dump() { "dump" } else { "packs" },
        "tables_scannees": fichiers.len(),
        "rdbn_lus": rdbn_ok,
        "conditions": trouvees.len(),
        "pivot_postgame": format!("0x{pivot:08X}"),
        "postgame_verrous": post.len(),
        "postgame_fichiers": classe.iter().map(|(f, n)| serde_json::json!({ "fichier": f, "verrous": n })).collect::<Vec<_>>(),
        "par_categorie": par_kind,
        "par_chapitre": par_chapitre.iter().map(|(k, v)| (k.to_string(), v)).collect::<BTreeMap<_, _>>(),
        "seuils": seuils.iter().map(|(k, v)| (k.to_string(), v)).collect::<BTreeMap<_, _>>(),
        "flags": top_flags.iter().map(|(h, (n, ns))| serde_json::json!({
            "flag": format!("0x{h:08X}"),
            "usages": n,
            "namespaces": ns.keys().map(|x| format!("0x{x:08X}")).collect::<Vec<_>>(),
            "registre": registre.get(h).map(|v| v.iter().map(|e| serde_json::json!({
                "registre": e.registre, "categorie": e.categorie, "groupe": e.groupe, "index": e.index,
            })).collect::<Vec<_>>()),
        })).collect::<Vec<_>>(),
        "entrees": entrees,
    });

    if let Some(parent) = std::path::Path::new(&sortie_json).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(
        &sortie_json,
        serde_json::to_vec_pretty(&doc).expect("sérialisation"),
    ) {
        Ok(()) => println!("\nJSON     {sortie_json}"),
        Err(e) => eprintln!("\nécriture JSON impossible ({sortie_json}) : {e}"),
    }
}
