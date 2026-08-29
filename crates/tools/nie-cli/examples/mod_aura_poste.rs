//! `mod_aura_poste` — donne une **aura** à tous les personnages d'un poste donné.
//!
//! Le cas d'usage qui l'a motivé : mettre « Mode Aphrody » (`mode_change_c11150120`,
//! `0x03D98821`) aux attaquants et aux milieux. L'aura est déclarée dans
//! `skill/aura_skill_config` et **attribuée** par `character/chara_param` : chaque
//! `CHARA_PARAM_INFO` porte, à partir de sa variable 10, des paires `(niveau, identifiant)` —
//! sept techniques et deux auras pour un personnage complet.
//!
//! Le patch écrit l'identifiant de l'aura dans un emplacement de la fiche, **en place** : une
//! variable T2B fait exactement 4 octets (cf. [`nie_formats::t2b_patch`]), donc rien ne se
//! déplace. Le réencodage, lui, n'est pas fidèle et le jeu refuserait le fichier.
//!
//! ## Ce qu'il écrase, et pourquoi il le dit
//!
//! Un emplacement occupé porte déjà quelque chose. L'outil choisit **le dernier emplacement de
//! la fiche** et rapporte, pour chaque personnage, ce qui s'y trouvait. Aucun emplacement n'est
//! ajouté : la fiche garde sa taille, donc son nombre de variables.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example mod_aura_poste -- [--dir var/mods/auras] [--postes FW,MF]
//!     [--aura 0x03D98821] [--equipe Solaria-Zeus] [--a-blanc]
//! ```

use std::collections::BTreeMap;

use nie_data::chara_param::{parse_all_chara_params, position_id_to_code};
use nie_data::text::parse_text_file;
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin::{self, Value};
use nie_formats::t2b_patch::{localiser_tout, patch_verifie, ModifT2b, ValT2b, VarType};
use nie_formats::vfs::{self, Vfs};
use sha2::{Digest, Sha256};

/// Index de la première variable du bloc de compétences (`SKILL_BLOCK_START` d'inagle).
const BLOC_COMPETENCES: usize = 10;

fn sha256(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

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
        let Ok(cfg) = cfgbin::cfgbin_parse(&data) else { continue };
        for (h, t) in parse_text_file(&t2b_to_json(&cfg)) {
            map.insert(h.0, t);
        }
    }
    map
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut dir = String::from("var/mods/auras");
    let mut postes = String::from("FW,MF");
    let mut aura: u32 = 0x03D9_8821;
    let mut equipe = String::from("Solaria-Zeus");
    let a_blanc = args.iter().any(|a| a == "--a-blanc");
    args.retain(|a| a != "--a-blanc");
    for (drapeau, cible) in [("--dir", 0), ("--postes", 1), ("--aura", 2), ("--equipe", 3)] {
        if let Some(i) = args.iter().position(|a| a == drapeau) {
            let v = args.get(i + 1).cloned().unwrap_or_default();
            match cible {
                0 => dir = v,
                1 => postes = v,
                2 => {
                    let t = v.trim().to_string();
                    aura = t
                        .strip_prefix("0x")
                        .or_else(|| t.strip_prefix("0X"))
                        .and_then(|h| u32::from_str_radix(h, 16).ok())
                        .or_else(|| t.parse().ok())
                        .unwrap_or(aura);
                }
                _ => equipe = v,
            }
            args.drain(i..=i + 1);
        }
    }
    let vises: Vec<String> = postes.split(',').map(|s| s.trim().to_uppercase()).collect();

    let vfs = match vfs::open_game() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("VFS indisponible : {e}");
            std::process::exit(1);
        }
    };
    let textes = charger_textes(&vfs, "fr");

    // ── Qui est visé ──────────────────────────────────────────────────────────────────────
    // L'équipe vient de `chara_base` (belongTeamId), le poste de `chara_param` (mainPosition).
    let Some(f_base) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("/character/chara_base_") && c.ends_with(".cfg.bin"))
    else {
        eprintln!("chara_base introuvable");
        std::process::exit(1);
    };
    let data_base = vfs.read(&f_base).expect("lecture chara_base");
    let cfg_base = cfgbin::cfgbin_parse(&data_base).expect("chara_base est un T2B");
    let json_base = t2b_to_json(&cfg_base);
    let bases = nie_data::chara_base::parse_all_chara_base(&json_base);

    // Équipe → `belongTeamId`. Ce n'est PAS un identifiant de texte : le nom affichable passe par
    // `belong_team_config`, qui associe à chaque `belongTeamId` un `teamNameTextId`. On accepte
    // donc soit un hash direct (`--equipe 0x33662B61`), soit un nom qu'on résout par cette table.
    let team_id: u32 = if let Some(h) = equipe
        .trim()
        .strip_prefix("0x")
        .or_else(|| equipe.trim().strip_prefix("0X"))
        .and_then(|h| u32::from_str_radix(h, 16).ok())
    {
        h
    } else {
        let trouve = vfs
            .iter()
            .map(|(c, _)| c.to_string())
            .find(|c| c.contains("/character/belong_team_config") && c.ends_with(".cfg.bin"))
            .and_then(|f| vfs.read(&f).ok())
            .and_then(|d| {
                let rdbn = cfgbin::parse(&d).ok()?;
                let listes = cfgbin::read_values(&rdbn, &d);
                listes.iter().flat_map(|l| l.rows.iter()).find_map(|row| {
                    let champ = |n: &str| {
                        row.fields.iter().find(|(k, _)| k == n).map(|(_, v)| v).cloned()
                    };
                    let (Some(cfgbin::RdbnValue::Hash(id)), Some(cfgbin::RdbnValue::Hash(t))) =
                        (champ("belongTeamId"), champ("teamNameTextId"))
                    else {
                        return None;
                    };
                    textes.get(&t).filter(|n| n.eq_ignore_ascii_case(&equipe)).map(|_| id)
                })
            });
        match trouve {
            Some(id) => id,
            None => {
                eprintln!(
                    "équipe « {equipe} » introuvable dans belong_team_config ; \
                     donne son nom exact, ou son belongTeamId (--equipe 0x33662B61)"
                );
                std::process::exit(1);
            }
        }
    };
    let membres: Vec<&nie_data::chara_base::CharaBase> =
        bases.iter().filter(|b| b.belong_team_id.is_some_and(|t| t.0 == team_id)).collect();
    println!("équipe   « {equipe} » (0x{team_id:08X}) — {} membre(s)", membres.len());
    if membres.is_empty() {
        eprintln!("aucun membre pour cet identifiant d'équipe");
        std::process::exit(1);
    }

    let Some(f_param) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("/character/chara_param_") && c.ends_with(".cfg.bin") && !c.contains("table"))
    else {
        eprintln!("chara_param introuvable");
        std::process::exit(1);
    };
    let data_param = vfs.read(&f_param).expect("lecture chara_param");
    let cfg_param = cfgbin::cfgbin_parse(&data_param).expect("chara_param est un T2B");
    let params = parse_all_chara_params(&t2b_to_json(&cfg_param));

    // charaParamId des membres au poste visé.
    let ids_membres: Vec<u32> = membres.iter().map(|b| b.chara_id.0).collect();
    let cibles: Vec<(u32, String, String)> = params
        .iter()
        .filter(|p| ids_membres.contains(&p.chara_base_id.0))
        .filter_map(|p| {
            let poste = position_id_to_code(p.main_position)?;
            if !vises.iter().any(|v| v == poste) {
                return None;
            }
            let nom = membres
                .iter()
                .find(|b| b.chara_id == p.chara_base_id)
                .map(|b| b.internal_code.clone())
                .unwrap_or_default();
            Some((p.chara_param_id.0, nom, poste.to_string()))
        })
        .collect();

    println!(
        "postes   {} — {} personnage(s) visé(s)\naura     0x{aura:08X}",
        vises.join(", "),
        cibles.len()
    );
    for (id, code, poste) in &cibles {
        println!("  {code:11} {poste:2}  charaParamId 0x{id:08X}");
    }
    if cibles.is_empty() {
        eprintln!("\naucune cible — rien à faire");
        std::process::exit(1);
    }

    // ── Localiser leur dernier emplacement de compétence ──────────────────────────────────
    let entrees = localiser_tout(&data_param).expect("parcours T2B");
    // L'ordre des entrées à plat est celui de `cfgbin_parse` : on retrouve chaque fiche par son
    // charaParamId, qui est sa variable 0.
    let mut modifs = Vec::new();
    let mut journal = Vec::new();
    for (id, code, poste) in &cibles {
        let Some(e) = entrees.iter().find(|e| {
            matches!(e.variables.first().map(|v| &v.valeur), Some(Value::Int(i)) if (*i as u32) == *id)
        }) else {
            println!("  ⚠ {code} : fiche introuvable dans chara_param");
            continue;
        };
        // Le bloc de compétences est fait de paires `(niveau, identifiant)` à partir de la
        // variable 10. On cherche la **première paire libre** — identifiant à 0 — plutôt que
        // d'écraser une compétence existante.
        //
        // Viser « la dernière variable entière » serait une erreur : sur les fiches réelles elle
        // porte une valeur PARTAGÉE entre plusieurs personnages (0x0BF5508A sur trois d'entre
        // eux), donc un identifiant de groupe, pas un emplacement individuel.
        let entier = |i: usize| -> Option<u32> {
            match e.variables.get(i).map(|v| (&v.ty, &v.valeur)) {
                Some((VarType::Entier, Value::Int(x))) => Some(*x as u32),
                _ => None,
            }
        };
        let mut pose = None;
        let mut i = BLOC_COMPETENCES;
        while i + 1 < e.variables.len() {
            match (entier(i), entier(i + 1)) {
                // Paire libre : niveau et identifiant tous deux nuls.
                (Some(0), Some(0)) => {
                    pose = Some(i);
                    break;
                }
                (Some(_), Some(_)) => i += 2,
                // Sortie du bloc d'entiers (chaîne ou flottant) : plus de paires à examiner.
                _ => break,
            }
        }
        let Some(idx) = pose else {
            println!("  ⚠ {code} : aucun emplacement de compétence libre (fiche pleine)");
            continue;
        };
        let Some(var) = e.variables.get(idx + 1) else { continue };
        journal.push(format!(
            "  {code:11} {poste:2}  entrée {} paire {idx}/{} @0x{:06X}  libre → niveau 1, 0x{aura:08X}",
            e.index,
            idx + 1,
            var.offset
        ));
        // Niveau d'apprentissage 1 : l'aura est acquise d'emblée.
        modifs.push(ModifT2b { entree: e.index, variable: idx, valeur: ValT2b::Entier(1) });
        modifs.push(ModifT2b {
            entree: e.index,
            variable: idx + 1,
            valeur: ValT2b::Entier(aura as i32),
        });
    }

    // ── Appliquer sur la copie du mod ─────────────────────────────────────────────────────
    let chemin_mod = format!("{dir}/{f_param}");
    let mut data = match std::fs::read(&chemin_mod) {
        Ok(d) => d,
        Err(e) => {
            eprintln!(
                "\n{chemin_mod} : {e}\n\
                 Crée le mod d'abord :\n  \
                 niers mod init --nom auras --auteur <toi> -d {dir}\n  \
                 niers mod add -d {dir} {f_param}"
            );
            std::process::exit(1);
        }
    };

    println!("\n╔═ {}", f_param.trim_start_matches("data/common/gamedata/"));
    println!("║ vanilla  {} o  sha256 {}", data_param.len(), &sha256(&data_param)[..16]);
    for l in &journal {
        println!("║{l}");
    }

    let verif = patch_verifie(&mut data, &modifs).unwrap_or_else(|e| {
        eprintln!("║ ÉCHEC : {e}");
        std::process::exit(1);
    });
    let diffs = data_param
        .iter()
        .zip(data.iter())
        .filter(|(a, b)| a != b)
        .count();
    println!(
        "║ patché   {} o  sha256 {}\n║ taille   {}\n║ octets   {diffs} différents du vanilla pour {} champ(s)",
        data.len(),
        &sha256(&data)[..16],
        if verif.taille_preservee() { "PRÉSERVÉE" } else { "MODIFIÉE — anormal" },
        modifs.len()
    );
    if diffs > modifs.len() * 4 {
        eprintln!("║ ÉCHEC : plus d'octets modifiés que les champs visés n'en occupent");
        std::process::exit(1);
    }

    if a_blanc {
        println!("╚═ à blanc : rien écrit");
        return;
    }
    match std::fs::write(&chemin_mod, &data) {
        Ok(()) => println!("╚═ écrit   {chemin_mod}"),
        Err(e) => {
            eprintln!("╚═ écriture impossible : {e}");
            std::process::exit(1);
        }
    }
}
