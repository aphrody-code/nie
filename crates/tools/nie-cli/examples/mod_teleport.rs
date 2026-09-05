//! `mod_teleport` — ouvre **toute la carte** et transforme le voyage rapide en **téléporteur
//! libre**, y compris vers les lieux qui n'apparaissent que pendant l'histoire.
//!
//! ## Ce que le mod fait
//!
//! 1. **Tous les lieux disponibles** — `map/map_warp_config`, liste `m_MapWarpInfoList` : les 35
//!    points de warp voient leur `open_cond` neutralisée. Sur les 35, 28 exigeaient un seuil de
//!    progression ou un event-flag ; après patch, aucun.
//! 2. **Téléportation hors carte** — `fast_travel/fast_travel_config`, liste
//!    `m_fastTravelMapInfoList` : ses 6 entrées sont **repointées** vers des maps que le jeu
//!    charge normalement par script seul et qu'aucun warp ne dessert. Le Collège Raimon (`w40`)
//!    en fait partie : ses 141 fichiers d'assets sont bien dans le VFS, mais la carte du monde
//!    n'y mène pas.
//!
//! ## Pourquoi c'est sûr
//!
//! Tout tient à **taille constante** : neutraliser une condition, c'est écrire `0xFFFFFFFF` sur
//! les 4 octets d'un offset de chaîne (le jeu lit une valeur hors bornes comme « aucune
//! condition », cf. `read_condition_value`) ; repointer une destination, c'est réécrire un
//! `Hash` et un `Rates`. Aucun réencodage — l'aller-retour `cfg.bin` n'est pas fidèle et le jeu
//! refuserait le fichier. Voir [`nie_formats::rdbn_patch`].
//!
//! `map_id` vaut **`CRC32(nom court de la map)`** : les destinations sont donc calculées depuis
//! les noms réels des dossiers du VFS, jamais écrites en dur au hasard.
//!
//! Usage :
//! ```text
//! cargo run -p nie-cli --example mod_teleport -- [--dir var/mods/teleport] [--a-blanc]
//! ```

use std::collections::BTreeMap;

use nie_data::text::parse_text_file;
use nie_data::unlock_condition::{crc32_str, decode_unlock_condition};
use nie_explore::bridge::t2b_to_json;
use nie_formats::cfgbin::{self, RdbnValue};
use nie_formats::rdbn_patch::{Modif, Val, localiser, patch_verifie};
use nie_formats::vfs::{self, Vfs};
use sha2::{Digest, Sha256};

/// Sentinelle « aucune condition » : offset de chaîne hors bornes.
const AUCUNE_CONDITION: i32 = -1;

/// Les destinations du téléporteur, dans l'ordre des 6 emplacements de voyage rapide.
///
/// Chaque entrée est le **nom court d'une map réelle du VFS** ; le `map_id` s'en déduit par
/// CRC32. Toutes ont leurs assets présents et sont classées « hors carte » par `carte_monde`,
/// sauf `w40` que seul un warp d'histoire dessert.
/// Le second membre est le **libellé exact** à chercher dans la localisation, ou `None` quand la
/// map n'a pas de nom affichable connu : dans ce cas le `mapTextId` d'origine est conservé
/// plutôt que repointé vers un texte trouvé par ressemblance — un nom approximatif afficherait
/// n'importe quoi.
const DESTINATIONS: [(&str, Option<&str>); 6] = [
    ("w40", Some("Collège Raimon")),
    ("w40i002", Some("Local du club de foot")),
    ("k01", None),
    ("w35", None),
    ("w90i001", None),
    ("w24i001", None),
];

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
        let Ok(cfg) = cfgbin::cfgbin_parse(&data) else {
            continue;
        };
        for (h, t) in parse_text_file(&t2b_to_json(&cfg)) {
            map.insert(h.0, t);
        }
    }
    map
}

/// Premier hash dont le texte vaut exactement `libelle`, sinon le premier qui le contient.
fn hash_du_texte(textes: &BTreeMap<u32, String>, libelle: &str) -> Option<u32> {
    textes
        .iter()
        .find(|(_, t)| t.as_str() == libelle)
        .or_else(|| textes.iter().find(|(_, t)| t.contains(libelle)))
        .map(|(h, _)| *h)
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

    let rdbn = cfgbin::parse(&data).map_err(|e| format!("RDBN illisible : {e}"))?;
    let mut attendus: Vec<usize> = Vec::new();
    for m in modifs {
        let loc = localiser(&rdbn, &m.liste, m.ligne, &m.champ).map_err(|e| e.to_string())?;
        attendus.extend(loc.offset..loc.offset + loc.size);
    }

    let verif = patch_verifie(&mut data, modifs).map_err(|e| e.to_string())?;

    let diffs: Vec<usize> = vanilla
        .iter()
        .zip(data.iter())
        .enumerate()
        .filter(|(_, (a, b))| a != b)
        .map(|(i, _)| i)
        .collect();
    let hors_cible = diffs.iter().filter(|o| !attendus.contains(o)).count();

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
        "║ octets   {} différents du vanilla sur {} champs patchés, {hors_cible} hors cible",
        diffs.len(),
        modifs.len()
    );
    if hors_cible > 0 {
        return Err(format!(
            "{hors_cible} octet(s) modifiés hors des champs visés"
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
    let mut dir = String::from("var/mods/teleport");
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
    let textes = charger_textes(&vfs, "fr");
    println!("textes   {} entrées localisées (fr)", textes.len());

    // ── 1. Déverrouiller tous les warps ───────────────────────────────────────────────────
    let Some(f_warp) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("map/map_warp_config_") && c.ends_with(".cfg.bin"))
    else {
        eprintln!("map_warp_config introuvable");
        std::process::exit(1);
    };
    let data_warp = vfs.read(&f_warp).expect("lecture map_warp_config");
    let rdbn_warp = cfgbin::parse(&data_warp).expect("RDBN");
    let listes_warp = cfgbin::read_values(&rdbn_warp, &data_warp);
    let liste_warp = listes_warp
        .iter()
        .find(|l| l.name == "m_MapWarpInfoList")
        .expect("m_MapWarpInfoList");

    let mut modifs_warp = Vec::new();
    let mut deja_libres = 0usize;
    for (i, row) in liste_warp.rows.iter().enumerate() {
        let brut = match row
            .fields
            .iter()
            .find(|(k, _)| k == "open_cond")
            .map(|(_, v)| v)
        {
            Some(RdbnValue::Condition(s)) => s.clone(),
            _ => {
                deja_libres += 1;
                continue;
            }
        };
        let c = decode_unlock_condition(&brut);
        if c.story_threshold.is_none() && c.required_events.is_empty() {
            deja_libres += 1;
            continue;
        }
        modifs_warp.push(Modif {
            liste: String::from("m_MapWarpInfoList"),
            ligne: i,
            champ: String::from("open_cond"),
            valeur: Val::StrOffset(AUCUNE_CONDITION),
        });
    }
    println!(
        "warps    {} points, {} déjà libres, {} à déverrouiller",
        liste_warp.rows.len(),
        deja_libres,
        modifs_warp.len()
    );

    // ── 2. Repointer le voyage rapide ─────────────────────────────────────────────────────
    let Some(f_fast) = vfs
        .iter()
        .map(|(c, _)| c.to_string())
        .find(|c| c.contains("fast_travel/fast_travel_config") && c.ends_with(".cfg.bin"))
    else {
        eprintln!("fast_travel_config introuvable");
        std::process::exit(1);
    };

    // Les maps visées doivent exister dans le VFS : on le vérifie avant de repointer quoi que
    // ce soit, sinon le jeu chargerait un identifiant qui ne désigne rien.
    let mut modifs_fast = Vec::new();
    println!("\n── Destinations du téléporteur ──");
    for (slot, (nom_map, libelle)) in DESTINATIONS.iter().enumerate() {
        let prefixe_assets = "data/common/map/";
        let present = vfs
            .iter()
            .any(|(c, _)| c.starts_with(prefixe_assets) && c.contains(&format!("/{nom_map}/")));
        let map_id = crc32_str(nom_map);
        let texte = libelle.and_then(|l| hash_du_texte(&textes, l));
        println!(
            "  [{slot}] {nom_map:<10} map_id 0x{map_id:08X}  assets {}  texte {}  — {}",
            if present { "✓" } else { "ABSENTS" },
            texte.map_or_else(|| String::from("inchangé"), |h| format!("0x{h:08X}")),
            libelle.unwrap_or("(nom d'origine conservé)")
        );
        if !present {
            println!("       ignoré : pas d'assets dans le VFS");
            continue;
        }
        modifs_fast.push(Modif {
            liste: String::from("m_fastTravelMapInfoList"),
            ligne: slot,
            champ: String::from("mapId"),
            valeur: Val::Hash(map_id),
        });
        // Point d'arrivée neutre : le centre de la map. Les positions d'origine visent des
        // repères de la ville de départ, qui n'existent pas sur les nouvelles destinations.
        modifs_fast.push(Modif {
            liste: String::from("m_fastTravelMapInfoList"),
            ligne: slot,
            champ: String::from("pos"),
            valeur: Val::Rates([0.0, 0.0, 0.0, 0.0]),
        });
        if let Some(h) = texte {
            modifs_fast.push(Modif {
                liste: String::from("m_fastTravelMapInfoList"),
                ligne: slot,
                champ: String::from("mapTextId"),
                valeur: Val::Hash(h),
            });
        }
    }

    let mut echecs = 0;
    for (chemin, modifs) in [
        (f_warp.as_str(), &modifs_warp),
        (f_fast.as_str(), &modifs_fast),
    ] {
        if let Err(e) = traiter(&vfs, &dir, chemin, modifs, a_blanc) {
            eprintln!("║ ÉCHEC {chemin} : {e}");
            echecs += 1;
        }
    }

    println!("\n{} fichier(s) patché(s), {echecs} échec(s)", 2 - echecs);
    if echecs > 0 {
        std::process::exit(1);
    }
}
