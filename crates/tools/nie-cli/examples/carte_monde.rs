//! `carte_monde` — la **carte complète** d'IEVR : toutes les maps, tous les lieux, ce qui est
//! atteignable et ce qui ne l'est pas.
//!
//! ## La clé : `map_id = CRC32(nom de map)`
//!
//! Les tables de lieux (`map_warp_config`, `fast_travel_config`, `map_land_id_info`,
//! `flag_config`) désignent une map par un hash 32 bits. Ce hash est le **CRC32 (poly
//! `0xEDB88320`) du nom court de la map** — vérifié : `CRC32("w10") = 0x4E7B90D9`, exactement le
//! `map_id` des warps du collège NAGUMOHARA ; `CRC32("w10i000") = 0x417E0613` et
//! `CRC32("w17") = 0xD01F057A`, deux groupes de `TBOX_FLAG_INFO`. On peut donc **nommer** chaque
//! identifiant de lieu en énumérant les maps du VFS et en hachant leur nom — aucun nom inventé.
//!
//! Attention : `map/map_data_0.00.00.cfg.bin` **n'est pas** la table des maps du monde. Ses 104
//! entrées ne couvrent que les arborescences `common/map/z/` et `common/map/t/` (debug et
//! terrains de tournoi), dont les assets sont d'ailleurs absents du VFS. Les vraies maps vivent
//! sous `common/map/{w,k,s,b,e,gi,ar}/` et ont leur dossier de données sous `gamedata/map/`.
//!
//! ## Classement d'une map
//!
//! - **atteignable** — un warp ou un point de voyage rapide y mène ;
//! - **hors carte** — la map existe (dossier d'assets et/ou de données), mais aucune entrée de
//!   navigation n'y conduit. C'est le cas des décors qui n'apparaissent qu'en cinématique — le
//!   jeu les charge par script, jamais par la carte du monde.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example carte_monde -- [--json var/carte/carte.json] [--lang fr]
//! ```

use std::collections::{BTreeMap, BTreeSet};

use nie_data::text::parse_text_file;
use nie_data::unlock_condition::{crc32_str, decode_unlock_condition};
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin::{self, RdbnList, RdbnRow, RdbnValue};
use nie_formats::vfs::{self, Vfs};

/// Une map du jeu : son nom court, ce qu'on en sait, et par où on y va.
#[derive(Default)]
struct Map {
    /// Nom court (`w10`, `k01`, `b10g001`…) — la clé du CRC32.
    nom: String,
    /// Arborescence d'assets `common/map/<famille>/<nom>/`, si elle existe.
    assets: Option<String>,
    /// Dossier de données `gamedata/map/<nom>/`, si il existe.
    gamedata: bool,
    /// Nombre de fichiers d'assets sous l'arborescence de la map.
    fichiers: usize,
    /// Warps menant à cette map.
    warps: usize,
    /// Warps de cette map ouverts sans condition.
    warps_libres: usize,
    /// Points de voyage rapide sur cette map.
    fast_travel: usize,
    /// Zones nommées (`map_land_id_info`) rattachées.
    zones: Vec<String>,
    /// Noms de lieux (warps) portés par cette map.
    lieux: Vec<String>,
}

impl Map {
    /// Comment le joueur peut atteindre cette map — mesuré, pas supposé.
    fn acces(&self) -> &'static str {
        if self.warps > 0 || self.fast_travel > 0 {
            "atteignable"
        } else if self.assets.is_some() || self.gamedata {
            "hors_carte"
        } else {
            "inconnue"
        }
    }
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

fn listes(vfs: &Vfs, motif: &str) -> Vec<RdbnList> {
    let Some(chemin) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains(motif) && c.ends_with(".cfg.bin"))
    else {
        return Vec::new();
    };
    let Ok(data) = vfs.read(&chemin) else { return Vec::new() };
    let Ok(rdbn) = cfgbin::parse(&data) else { return Vec::new() };
    cfgbin::read_values(&rdbn, &data)
}

fn hash(row: &RdbnRow, nom: &str) -> u32 {
    match row.fields.iter().find(|(k, _)| k == nom).map(|(_, v)| v) {
        Some(RdbnValue::Hash(h)) => *h,
        _ => 0,
    }
}

fn chaine(row: &RdbnRow, nom: &str) -> String {
    match row.fields.iter().find(|(k, _)| k == nom).map(|(_, v)| v) {
        Some(RdbnValue::Condition(s)) => s.clone(),
        _ => String::new(),
    }
}

fn octet(row: &RdbnRow, nom: &str) -> i64 {
    match row.fields.iter().find(|(k, _)| k == nom).map(|(_, v)| v) {
        Some(RdbnValue::Byte(b)) => i64::from(*b),
        Some(RdbnValue::Int(i) | RdbnValue::Flag(i)) => i64::from(*i),
        _ => 0,
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let mut sortie = String::from("var/carte/carte.json");
    let mut langue = String::from("fr");
    if let Some(i) = args.iter().position(|a| a == "--json") {
        sortie = args.get(i + 1).cloned().unwrap_or(sortie);
        args.drain(i..=i + 1);
    }
    if let Some(i) = args.iter().position(|a| a == "--lang") {
        langue = args.get(i + 1).cloned().unwrap_or(langue);
        args.drain(i..=i + 1);
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

    // ── Recenser les maps depuis le VFS ───────────────────────────────────────────────────
    // Deux sources indépendantes : l'arborescence d'assets `common/map/<famille>/<nom>/` et
    // les dossiers de données `gamedata/map/<nom>/`. On prend l'union — une map peut n'avoir
    // que l'une des deux.
    let mut maps: BTreeMap<u32, Map> = BTreeMap::new();
    let mut fichiers_par_map: BTreeMap<String, usize> = BTreeMap::new();

    for (chemin, _) in vfs.iter() {
        if let Some(reste) = chemin.strip_prefix("data/common/map/") {
            // `<famille>/<nom>/...` — la famille est une lettre ou deux (`w`, `k`, `gi`, `ar`).
            let mut it = reste.split('/');
            let (Some(famille), Some(nom)) = (it.next(), it.next()) else { continue };
            if it.next().is_none() {
                continue; // pas un fichier dans un dossier de map
            }
            let e = maps.entry(crc32_str(nom)).or_default();
            e.nom = nom.to_string();
            e.assets = Some(format!("common/map/{famille}/{nom}/"));
            *fichiers_par_map.entry(nom.to_string()).or_default() += 1;
        } else if let Some(reste) = chemin.strip_prefix("data/common/gamedata/map/") {
            let mut it = reste.split('/');
            let Some(nom) = it.next() else { continue };
            if it.next().is_none() {
                continue; // fichier à la racine de gamedata/map (tables globales)
            }
            let e = maps.entry(crc32_str(nom)).or_default();
            if e.nom.is_empty() {
                e.nom = nom.to_string();
            }
            e.gamedata = true;
        }
    }
    for (nom, n) in &fichiers_par_map {
        if let Some(m) = maps.values_mut().find(|m| &m.nom == nom) {
            m.fichiers = *n;
        }
    }
    println!("maps     {} recensées dans le VFS (assets + gamedata)", maps.len());

    // ── Les warps ─────────────────────────────────────────────────────────────────────────
    struct Warp {
        map_id: u32,
        nom: String,
        ouverture: String,
        verrouille: bool,
        warp_type: i64,
    }
    let mut warps: Vec<Warp> = Vec::new();
    for l in listes(&vfs, "map/map_warp_config_") {
        if l.name != "m_MapWarpInfoList" {
            continue;
        }
        for row in &l.rows {
            let map_id = hash(row, "map_id");
            let cond = decode_unlock_condition(&chaine(row, "open_cond"));
            let verrouille = cond.story_threshold.is_some() || !cond.required_events.is_empty();
            let evs: Vec<String> = cond.required_events.iter().map(|e| e.crc_hex()).collect();
            let ouverture = if !verrouille {
                String::from("libre")
            } else {
                match cond.story_threshold {
                    Some(s) if evs.is_empty() => format!("story≥{s}"),
                    Some(s) => format!("story≥{s} & [{}]", evs.join(" & ")),
                    None => format!("[{}]", evs.join(" & ")),
                }
            };
            let nom_id = hash(row, "warp_spot_name_id");
            let nom = textes.get(&nom_id).cloned().unwrap_or_else(|| format!("0x{nom_id:08X}"));
            let e = maps.entry(map_id).or_default();
            e.warps += 1;
            if !verrouille {
                e.warps_libres += 1;
            }
            if !e.lieux.contains(&nom) {
                e.lieux.push(nom.clone());
            }
            warps.push(Warp { map_id, nom, ouverture, verrouille, warp_type: octet(row, "warp_type") });
        }
    }

    // ── Voyage rapide ─────────────────────────────────────────────────────────────────────
    let mut fast: Vec<(u32, String)> = Vec::new();
    for l in listes(&vfs, "fast_travel/fast_travel_config") {
        for row in &l.rows {
            let map_id = hash(row, "mapId");
            let t = hash(row, "mapTextId");
            let nom = textes.get(&t).cloned().unwrap_or_else(|| format!("0x{t:08X}"));
            maps.entry(map_id).or_default().fast_travel += 1;
            fast.push((map_id, nom));
        }
    }

    // ── Zones nommées ─────────────────────────────────────────────────────────────────────
    for l in listes(&vfs, "map/map_land_id_info") {
        for row in &l.rows {
            let map_id = hash(row, "map_id");
            let t = hash(row, "area_text_id");
            let nom = textes.get(&t).cloned().unwrap_or_else(|| format!("0x{t:08X}"));
            let e = maps.entry(map_id).or_default();
            if !e.zones.contains(&nom) {
                e.zones.push(nom);
            }
        }
    }

    // ── Bilan ─────────────────────────────────────────────────────────────────────────────
    let mut par_acces: BTreeMap<&str, usize> = BTreeMap::new();
    for m in maps.values() {
        *par_acces.entry(m.acces()).or_default() += 1;
    }
    println!(
        "warps    {} points, {} verrouillés par une condition\n\
         rapide   {} points de voyage rapide",
        warps.len(),
        warps.iter().filter(|w| w.verrouille).count(),
        fast.len()
    );
    println!("\n── Accès ──");
    for (k, n) in &par_acces {
        println!("  {k:<12} {n:>4} map(s)");
    }

    println!("\n── Maps ATTEIGNABLES ──");
    let mut atteignables: Vec<&Map> = maps.values().filter(|m| m.acces() == "atteignable").collect();
    atteignables.sort_by(|a, b| b.warps.cmp(&a.warps).then(a.nom.cmp(&b.nom)));
    for m in &atteignables {
        let nom = if m.nom.is_empty() { "«non recensée»" } else { m.nom.as_str() };
        println!(
            "  {nom:<12} {} warp(s) dont {} libre(s), {} rapide  {}",
            m.warps,
            m.warps_libres,
            m.fast_travel,
            m.lieux.join(" · ")
        );
    }

    println!("\n── Maps HORS CARTE (assets présents, aucun accès) ──");
    let mut hors: Vec<&Map> = maps.values().filter(|m| m.acces() == "hors_carte").collect();
    hors.sort_by(|a, b| b.fichiers.cmp(&a.fichiers).then(a.nom.cmp(&b.nom)));
    for m in hors.iter().take(60) {
        println!(
            "  {:<14} {:>5} fichier(s)  {}{}",
            m.nom,
            m.fichiers,
            m.assets.clone().unwrap_or_else(|| String::from("(données seules)")),
            if m.gamedata { "  +gamedata" } else { "" }
        );
    }
    if hors.len() > 60 {
        println!("  … {} de plus", hors.len() - 60);
    }

    // ── Export ────────────────────────────────────────────────────────────────────────────
    let cles: BTreeSet<u32> = maps.keys().copied().collect();
    let doc = serde_json::json!({
        "source": vfs.game_data_dir().display().to_string(),
        "langue": langue,
        "note_map_id": "map_id = CRC32(nom court de la map), poly 0xEDB88320",
        "maps": cles.iter().map(|id| {
            let m = &maps[id];
            serde_json::json!({
                "map_id": format!("0x{id:08X}"),
                "nom": m.nom,
                "assets": m.assets,
                "gamedata": m.gamedata,
                "fichiers": m.fichiers,
                "warps": m.warps,
                "warps_libres": m.warps_libres,
                "fast_travel": m.fast_travel,
                "zones": m.zones,
                "lieux": m.lieux,
                "acces": m.acces(),
            })
        }).collect::<Vec<_>>(),
        "warps": warps.iter().map(|w| serde_json::json!({
            "map_id": format!("0x{:08X}", w.map_id),
            "map": maps.get(&w.map_id).map(|m| m.nom.clone()),
            "lieu": w.nom,
            "warp_type": w.warp_type,
            "ouverture": w.ouverture,
            "verrouille": w.verrouille,
        })).collect::<Vec<_>>(),
        "fast_travel": fast.iter().map(|(id, nom)| serde_json::json!({
            "map_id": format!("0x{id:08X}"),
            "map": maps.get(id).map(|m| m.nom.clone()),
            "lieu": nom,
        })).collect::<Vec<_>>(),
    });

    if let Some(p) = std::path::Path::new(&sortie).parent() {
        let _ = std::fs::create_dir_all(p);
    }
    match std::fs::write(&sortie, serde_json::to_vec_pretty(&doc).expect("sérialisation")) {
        Ok(()) => println!("\nJSON     {sortie}"),
        Err(e) => eprintln!("\nécriture impossible ({sortie}) : {e}"),
    }
}
