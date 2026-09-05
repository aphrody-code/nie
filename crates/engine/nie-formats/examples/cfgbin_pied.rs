//! Le pied de page des `.cfg.bin` T2B : ce que `parse_t2b` ignore et que `encode_t2b` n'écrit pas.
//!
//! Mesure d'origine (`cfgbin_reencodage`) : 0 fichier sur 152 se réencode à l'octet près, et le
//! réencodage **rogne** — 65 398 octets perdus sur 142 fichiers. Le plus petit cas divergent,
//! `chara_cloth_change_1.00.29.cfg.bin`, fait 48 octets, en perd 16, et diverge exactement à
//! l'offset 32 : ses 32 premiers octets sont déjà rendus à l'identique, seuls les 16 derniers
//! manquent. Ces 16 octets portent la chaîne `t2b`.
//!
//! Les tests d'aller-retour passent quand même (498/498 T2B) parce qu'ils comparent l'arbre
//! relu par notre propre décodeur, lequel n'ouvre jamais ce pied. C'est un vert qui ne prouve
//! rien sur ce que le jeu accepte.
//!
//! Cet exemple ne devine pas la sémantique du pied à partir d'un seul échantillon : il relève
//! les seize derniers octets de tous les T2B du jeu et ventile par motif, en marquant quels
//! octets sont **constants** sur tout le corpus et lesquels **varient**. Ce qui varie est un
//! champ ; ce qui ne varie pas est une signature.
//!
//! ```text
//! cargo run -p nie-formats --example cfgbin_pied --release
//! ```

use std::collections::BTreeMap;
use std::path::Path;

/// Taille du pied observé sur le plus petit cas.
const PIED: usize = 16;

fn main() {
    let dir = nie_formats::vfs::resolve_game_dir().to_string_lossy().into_owned();
    let data_dir = Path::new(&dir).join("data");

    let mut vfs = nie_formats::vfs::Vfs::new();
    if vfs.init(&data_dir).is_err() {
        eprintln!("skip : jeu absent à {}", data_dir.display());
        return;
    }

    let chemins: Vec<String> = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .filter(|p| p.ends_with(".cfg.bin"))
        .collect();

    // Un octet est « constant » tant qu'on ne lui a vu qu'une seule valeur.
    let mut valeurs_vues: Vec<BTreeMap<u8, usize>> = vec![BTreeMap::new(); PIED];
    let mut motifs: BTreeMap<Vec<u8>, usize> = BTreeMap::new();
    let mut n_t2b = 0usize;
    let mut n_avec_signature = 0usize;
    let mut n_trop_court = 0usize;
    let mut exemple_sans_signature: Option<String> = None;

    for chemin in &chemins {
        let Ok(octets) = vfs.read(chemin) else { continue };
        if nie_formats::cfgbin::is_rdbn(&octets) {
            continue;
        }
        if nie_formats::cfgbin::parse_t2b(&octets).is_err() {
            continue;
        }
        n_t2b += 1;
        if octets.len() < PIED {
            n_trop_court += 1;
            continue;
        }
        let pied = &octets[octets.len() - PIED..];
        for (i, o) in pied.iter().enumerate() {
            *valeurs_vues[i].entry(*o).or_insert(0) += 1;
        }
        *motifs.entry(pied.to_vec()).or_insert(0) += 1;
        if pied.windows(3).any(|f| f == b"t2b") {
            n_avec_signature += 1;
        } else if exemple_sans_signature.is_none() {
            exemple_sans_signature = Some(chemin.clone());
        }
    }

    println!("{n_t2b} fichiers T2B lus ({n_trop_court} trop courts pour porter un pied)");
    println!("{n_avec_signature} portent la chaîne « t2b » dans leurs {PIED} derniers octets\n");

    println!("Position par position, sur les {PIED} derniers octets :");
    println!("{:>4}  {:<9} {:>8}  {}", "off", "état", "valeurs", "détail");
    for (i, vues) in valeurs_vues.iter().enumerate() {
        let etat = if vues.len() == 1 { "CONSTANT" } else { "variable" };
        let mut detail: Vec<String> = vues
            .iter()
            .map(|(v, n)| format!("0x{v:02X}×{n}"))
            .collect();
        detail.truncate(6);
        let suite = if vues.len() > 6 { format!(" … +{}", vues.len() - 6) } else { String::new() };
        println!("{:>4}  {:<9} {:>8}  {}{}", i, etat, vues.len(), detail.join(" "), suite);
    }

    println!("\n{} motif(s) de pied distinct(s). Les plus fréquents :", motifs.len());
    let mut classes: Vec<(&Vec<u8>, &usize)> = motifs.iter().collect();
    classes.sort_by(|a, b| b.1.cmp(a.1));
    for (motif, n) in classes.iter().take(8) {
        let hexa: Vec<String> = motif.iter().map(|o| format!("{o:02X}")).collect();
        println!("  ×{n:<6} {}", hexa.join(" "));
    }

    if let Some(chemin) = &exemple_sans_signature {
        println!("\nPremier T2B SANS « t2b » dans son pied — à examiner avant de conclure :");
        println!("  {chemin}");
    } else if n_t2b > 0 {
        println!("\nTous les T2B lus portent la signature : le pied est bien une partie du format.");
    }
}
