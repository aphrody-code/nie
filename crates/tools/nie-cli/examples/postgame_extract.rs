//! `postgame_extract` — **extraction** du contenu postgame d'IEVR, ligne par ligne.
//!
//! Suite de [`postgame_scan`] : là où le scan **localise** les verrous (quel fichier, quelle
//! ligne, quel flag), celui-ci **sort la donnée** — chaque ligne de table verrouillée derrière le
//! pivot du postgame, tous champs déployés, avec les identifiants de texte résolus contre les
//! fichiers de localisation du jeu (`data/common/text/<langue>/*_text.cfg.bin`).
//!
//! Le pivot est déterminé comme dans le scan : le flag exigé par `extend_story_data_config`, le
//! seul contenu du jeu explicitement étiqueté « histoire étendue ». Aucun nom de flag n'est
//! inventé — un hash non résolu reste un hash.
//!
//! Produit trois artefacts dans le répertoire de sortie (`var/postgame` par défaut) :
//! - `postgame_lignes.json` — toutes les lignes verrouillées, champs déployés, textes résolus ;
//! - `POSTGAME.md` — le rapport lisible, groupé par table ;
//! - le récapitulatif console.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example postgame_extract -- [--out var/postgame] [--lang fr] [--max 40]
//! ```

use std::collections::BTreeMap;

use nie_data::chara_base::parse_all_chara_base;
use nie_data::text::parse_text_file;
use nie_data::unlock_condition::decode_unlock_condition;
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin::{self, RdbnValue};
use nie_formats::vfs::{self, Vfs};

/// Charge tous les fichiers de texte d'une langue → `hash → texte`.
fn charger_textes(vfs: &Vfs, langue: &str) -> BTreeMap<u32, String> {
    let prefixe = format!("data/common/text/{langue}/");
    let mut fichiers: Vec<String> = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .filter(|c| c.starts_with(&prefixe) && c.ends_with(".cfg.bin"))
        .collect();
    fichiers.sort();
    fichiers.dedup();

    let mut map = BTreeMap::new();
    for f in &fichiers {
        let Ok(data) = vfs.read(f) else { continue };
        let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
            continue;
        };
        let json = t2b_to_json(&cfg);
        for (h, t) in parse_text_file(&json) {
            map.insert(h.0, t);
        }
    }
    map
}

/// Construit `charaId → « Prénom NOM (code interne) »` depuis `character/chara_base_*.cfg.bin`.
///
/// Les `character_id` des tables de contenu (`data_file`, `players_universe`) ne sont pas des
/// identifiants de texte : ils passent par la table maîtresse des personnages, qui porte les
/// hash de prénom et de nom à résoudre dans `chara_text`.
fn charger_personnages(vfs: &Vfs, textes: &BTreeMap<u32, String>) -> BTreeMap<u32, String> {
    let Some(chemin) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("/character/chara_base_") && c.ends_with(".cfg.bin"))
    else {
        return BTreeMap::new();
    };
    let Ok(data) = vfs.read(&chemin) else {
        return BTreeMap::new();
    };
    let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
        return BTreeMap::new();
    };
    let json = t2b_to_json(&cfg);

    let mut map = BTreeMap::new();
    for b in parse_all_chara_base(&json) {
        let prenom = textes.get(&b.name_hash.0).cloned().unwrap_or_default();
        let nom = b
            .last_name_hash
            .and_then(|h| textes.get(&h.0))
            .cloned()
            .unwrap_or_default();
        // `name_hash` porte souvent déjà le nom complet (« Hohira Ayumu ») : ne préfixer par le
        // nom de famille que s'il n'y est pas déjà, sinon on obtient « Hohira Hohira Ayumu ».
        let affiche = match (nom.is_empty(), prenom.is_empty()) {
            (true, true) => b.internal_code.clone(),
            (true, false) => format!("{prenom} ({})", b.internal_code),
            (false, true) => format!("{nom} ({})", b.internal_code),
            (false, false) if prenom.contains(nom.as_str()) => {
                format!("{prenom} ({})", b.internal_code)
            }
            (false, false) => format!("{nom} {prenom} ({})", b.internal_code),
        };
        map.insert(b.chara_id.0, affiche);
    }
    map
}

/// Étend la table `hash → libellé` avec les **variantes** de personnage (`chara_param`) : une
/// entrée de contenu référence souvent un `charaParamId` (la variante jouable) et non le
/// `charaId` de base. On rattache la variante à son personnage de base et on annote l'élément
/// et la position, tous deux portés par `chara_param`.
fn etendre_variantes(vfs: &Vfs, personnages: &mut BTreeMap<u32, String>) -> usize {
    let Some(chemin) = vfs.iter().map(|(c, _)| c.to_string()).find(|c| {
        c.contains("/character/chara_param_") && c.ends_with(".cfg.bin") && !c.contains("table")
    }) else {
        return 0;
    };
    let Ok(data) = vfs.read(&chemin) else {
        return 0;
    };
    let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
        return 0;
    };
    let json = t2b_to_json(&cfg);

    let mut n = 0;
    for p in nie_data::chara_param::parse_all_chara_params(&json) {
        if personnages.contains_key(&p.chara_param_id.0) {
            continue;
        }
        let base = personnages
            .get(&p.chara_base_id.0)
            .cloned()
            .unwrap_or_else(|| format!("0x{:08X}", p.chara_base_id.0));
        let pos = nie_data::chara_param::position_id_to_code(p.main_position).unwrap_or("?");
        let elem =
            nie_data::chara_param::element_id_to_names(p.element).map_or("?", |(fr, _, _)| fr);
        personnages.insert(p.chara_param_id.0, format!("{base} — {pos}/{elem}"));
        n += 1;
    }
    n
}

/// Rend une valeur RDBN lisible, en résolvant les hash contre la table de textes puis contre la
/// table des personnages.
fn rendre(
    v: &RdbnValue,
    textes: &BTreeMap<u32, String>,
    personnages: &BTreeMap<u32, String>,
) -> String {
    match v {
        RdbnValue::Bool(b) => format!("{b}"),
        RdbnValue::Byte(b) => format!("{b}"),
        RdbnValue::Short(s) | RdbnValue::ActType(s) => format!("{s}"),
        RdbnValue::Int(i) | RdbnValue::Flag(i) => format!("{i}"),
        RdbnValue::Float(f) => format!("{f}"),
        RdbnValue::Hash(h) => match textes.get(h).or_else(|| personnages.get(h)) {
            Some(t) => format!("0x{h:08X} « {} »", t.replace('\n', " ")),
            None => format!("0x{h:08X}"),
        },
        RdbnValue::Rates(r) => format!("{r:?}"),
        RdbnValue::Position(p) => format!("{p:?}"),
        // Le type RDBN 20 (`Condition`) est en fait « chaîne résolue depuis la table de chaînes » :
        // il porte aussi bien un blob de condition base64 qu'un chemin d'asset (`imgPath`). On ne
        // rend la lecture « condition » que si le décodage produit réellement des feuilles.
        RdbnValue::Condition(c) => {
            let d = decode_unlock_condition(c);
            if d.story_threshold.is_none() && d.required_events.is_empty() {
                return format!("\"{c}\"");
            }
            let evs: Vec<String> = d
                .required_events
                .iter()
                .map(|e| format!("{}≥{}", e.crc_hex(), e.count))
                .collect();
            match d.story_threshold {
                Some(s) if evs.is_empty() => format!("story≥{s}"),
                Some(s) => format!("story≥{s} & [{}]", evs.join(" & ")),
                None => format!("[{}]", evs.join(" & ")),
            }
        }
        RdbnValue::ShortTuple(t) => format!("({}, {})", t[0], t[1]),
        RdbnValue::Blob(b) => format!("<{} octets>", b.len()),
        RdbnValue::Invalid => String::from("<invalide>"),
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut out = String::from("var/postgame");
    let mut langue = String::from("fr");
    let mut max = 40usize;
    for (drapeau, cible) in [("--out", 0), ("--lang", 1), ("--max", 2)] {
        if let Some(i) = args.iter().position(|a| a == drapeau) {
            let v = args.get(i + 1).cloned().unwrap_or_default();
            match cible {
                0 => out = v,
                1 => langue = v,
                _ => max = v.parse().unwrap_or(max),
            }
            args.drain(i..=i + 1);
        }
    }

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };

    let textes = charger_textes(&vfs, &langue);
    println!("textes   {} entrées localisées ({langue})", textes.len());
    let mut personnages = charger_personnages(&vfs, &textes);
    let base = personnages.len();
    let variantes = etendre_variantes(&vfs, &mut personnages);
    println!("persos   {base} personnages (chara_base) + {variantes} variantes (chara_param)");

    // ── Pivot : le flag exigé par extend_story ────────────────────────────────────────────
    let chemin_es = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("/extend_story/") && c.ends_with(".cfg.bin"));
    let Some(chemin_es) = chemin_es else {
        eprintln!("extend_story introuvable dans le VFS");
        std::process::exit(1);
    };
    let data_es = vfs.read(&chemin_es).expect("lecture extend_story");
    let rdbn_es = cfgbin::parse(&data_es).expect("extend_story est un RDBN");
    let pivot = cfgbin::read_values(&rdbn_es, &data_es)
        .iter()
        .flat_map(|l| l.rows.iter())
        .flat_map(|r| r.fields.iter())
        .find_map(|(_, v)| match v {
            RdbnValue::Condition(c) => decode_unlock_condition(c)
                .required_events
                .first()
                .map(|e| e.crc),
            _ => None,
        });
    // Repli : un mod peut avoir neutralisé la condition d'extend_story (c'est exactement ce que
    // fait `mod_postgame`). Dans ce cas le pivot se redéduit du corpus : le flag le plus
    // référencé hors flag nul. On dit laquelle des deux voies a servi.
    let (pivot, origine) = match pivot {
        Some(p) => (p, "exigé par extend_story_data_config"),
        None => {
            let mut compte: BTreeMap<u32, usize> = BTreeMap::new();
            for (c, _) in vfs.iter() {
                if !c.starts_with("data/common/gamedata/") || !c.ends_with(".cfg.bin") {
                    continue;
                }
                let Ok(d) = vfs.read(c) else { continue };
                let Ok(r) = cfgbin::parse(&d) else { continue };
                for l in cfgbin::read_values(&r, &d) {
                    for row in &l.rows {
                        for (_, v) in &row.fields {
                            let RdbnValue::Condition(b) = v else { continue };
                            for e in decode_unlock_condition(b).required_events {
                                if e.crc != 0 {
                                    *compte.entry(e.crc).or_default() += 1;
                                }
                            }
                        }
                    }
                }
            }
            let Some((&p, _)) = compte.iter().max_by_key(|(_, n)| **n) else {
                eprintln!("aucune condition à feuilles dans le corpus : pivot introuvable");
                std::process::exit(1);
            };
            (p, "déduit du corpus (extend_story n'a plus de condition)")
        }
    };
    println!("pivot    0x{pivot:08X} ({origine})");

    // ── Balayage : toute ligne dont une condition exige le pivot ──────────────────────────
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

    /// Une ligne de table verrouillée en fin de jeu, avec sa **voie d'accès**.
    struct Ligne {
        fichier: String,
        liste: String,
        type_liste: String,
        index: usize,
        /// `flag` (le pivot du postgame), `story` (seuil d'histoire ≥ plancher), ou `flag+story`.
        voie: &'static str,
        /// Seuil d'histoire le plus élevé porté par la ligne, s'il y en a un.
        seuil: Option<u32>,
        champs: Vec<(String, String)>,
    }
    let mut lignes: Vec<Ligne> = Vec::new();

    // Plancher « fin d'histoire » : on le mesure d'abord, on ne le postule pas. C'est le
    // chapitre le plus élevé qu'une condition du corpus exige (seuil = ch×10000 + étape×10).
    let mut chapitre_max = 0u32;
    /// Ligne candidate avant classement : on ne connaît le plancher « fin d'histoire » qu'une
    /// fois tout le corpus lu, donc on retient d'abord les deux critères bruts.
    struct Brute {
        fichier: String,
        liste: String,
        type_liste: String,
        index: usize,
        par_flag: bool,
        seuil: Option<u32>,
        champs: Vec<(String, String)>,
    }
    let mut brut: Vec<Brute> = Vec::new();

    for chemin in &fichiers {
        let Ok(data) = vfs.read(chemin) else { continue };
        let Ok(rdbn) = cfgbin::parse(&data) else {
            continue;
        };
        for liste in cfgbin::read_values(&rdbn, &data) {
            for (i, row) in liste.rows.iter().enumerate() {
                let mut par_flag = false;
                let mut seuil: Option<u32> = None;
                for (_, v) in &row.fields {
                    let RdbnValue::Condition(c) = v else { continue };
                    let d = decode_unlock_condition(c);
                    if d.required_events.iter().any(|e| e.crc == pivot) {
                        par_flag = true;
                    }
                    if let Some(s) = d.story_threshold {
                        chapitre_max = chapitre_max.max(s / 10_000);
                        seuil = Some(seuil.map_or(s, |p: u32| p.max(s)));
                    }
                }
                if !par_flag && seuil.is_none() {
                    continue;
                }
                brut.push(Brute {
                    fichier: chemin.clone(),
                    liste: liste.name.clone(),
                    type_liste: liste.type_name.clone(),
                    index: i,
                    par_flag,
                    seuil,
                    champs: row
                        .fields
                        .iter()
                        .map(|(k, v)| (k.clone(), rendre(v, &textes, &personnages)))
                        .collect(),
                });
            }
        }
    }

    for b in brut {
        let tardif = b.seuil.is_some_and(|s| s / 10_000 >= chapitre_max);
        let voie = match (b.par_flag, tardif) {
            (true, true) => "flag+story",
            (true, false) => "flag",
            (false, true) => "story",
            (false, false) => continue,
        };
        lignes.push(Ligne {
            fichier: b.fichier,
            liste: b.liste,
            type_liste: b.type_liste,
            index: b.index,
            voie,
            seuil: b.seuil,
            champs: b.champs,
        });
    }

    let n_flag = lignes.iter().filter(|l| l.voie.starts_with("flag")).count();
    let n_story = lignes.iter().filter(|l| l.voie.ends_with("story")).count();
    println!(
        "lignes   {} verrouillées en fin de jeu — {n_flag} par le flag pivot, \
         {n_story} par le seuil d'histoire (chapitre {chapitre_max}, le plus tardif du corpus)",
        lignes.len()
    );

    // ── Regroupement par (fichier, liste) ─────────────────────────────────────────────────
    let mut groupes: BTreeMap<(String, String), Vec<&Ligne>> = BTreeMap::new();
    for l in &lignes {
        groupes
            .entry((l.fichier.clone(), l.liste.clone()))
            .or_default()
            .push(l);
    }

    let _ = std::fs::create_dir_all(&out);
    let mut md = String::new();
    md.push_str("# Postgame — Inazuma Eleven: Victory Road\n\n");
    md.push_str(&format!(
        "Extrait du VFS réel (`{}`) par `cargo run -p nie-cli --example postgame_extract`.\n\n",
        vfs.game_data_dir().display()
    ));
    md.push_str(&format!(
        "Deux voies d'accès mesurées, pas postulées :\n\n\
         - **flag** — le pivot `0x{pivot:08X}`, exigé par `extend_story_data_config` \
           (le seul contenu du jeu explicitement étiqueté « histoire étendue ») : {n_flag} ligne(s) ;\n\
         - **story** — un seuil de progression au chapitre {chapitre_max}, le plus tardif \
           qu'une condition du corpus exige : {n_story} ligne(s).\n\n\
         Total : {} ligne(s) sur {} liste(s).\n\n",
        lignes.len(),
        groupes.len()
    ));

    println!("\n── Contenu postgame, par table ──");
    for ((fichier, liste), ls) in &groupes {
        let court = fichier.trim_start_matches("data/common/gamedata/");
        println!("  {:>4} × {court} :: {liste}", ls.len());
        md.push_str(&format!(
            "## `{court}` — `{liste}` ({}) — {} entrée(s)\n\n",
            ls[0].type_liste,
            ls.len()
        ));
        for l in ls.iter().take(max) {
            let corps: Vec<String> = l
                .champs
                .iter()
                .map(|(k, v)| format!("`{k}` = {v}"))
                .collect();
            md.push_str(&format!(
                "- **[{}]** _{}_ · {}\n",
                l.index,
                l.voie,
                corps.join(" · ")
            ));
        }
        if ls.len() > max {
            md.push_str(&format!(
                "- … {} entrée(s) de plus (voir le JSON)\n",
                ls.len() - max
            ));
        }
        md.push('\n');
    }

    let doc = serde_json::json!({
        "source": vfs.game_data_dir().display().to_string(),
        "langue": langue,
        "pivot": format!("0x{pivot:08X}"),
        "chapitre_max": chapitre_max,
        "lignes_par_flag": n_flag,
        "lignes_par_story": n_story,
        "lignes": lignes.iter().map(|l| serde_json::json!({
            "fichier": l.fichier,
            "liste": l.liste,
            "type": l.type_liste,
            "index": l.index,
            "voie": l.voie,
            "seuil": l.seuil,
            "champs": l.champs.iter().cloned().collect::<BTreeMap<_, _>>(),
        })).collect::<Vec<_>>(),
    });

    let p_json = format!("{out}/postgame_lignes.json");
    let p_md = format!("{out}/POSTGAME.md");
    if let Err(e) = std::fs::write(
        &p_json,
        serde_json::to_vec_pretty(&doc).expect("sérialisation"),
    ) {
        eprintln!("écriture {p_json} : {e}");
    }
    if let Err(e) = std::fs::write(&p_md, md) {
        eprintln!("écriture {p_md} : {e}");
    }
    println!("\nJSON     {p_json}\nMD       {p_md}");
}
