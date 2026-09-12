//! Une globale manquante est-elle une fonction du MOTEUR, ou du Lua non exécuté ?
//!
//! ## Pourquoi la question est décisive
//!
//! `menu_host_gap.rs` classe ce qui manque au rejeu d'un écran. Sa tête de file — au
//! 2026-09-12 : `SetCtrlGuideTextCommon` (11 écrans), `ShowTitleChangeChildButtonCommon` (9),
//! `SetTitleTextureCommon` (8) — ne dit pas de quelle nature est le manque, et les deux natures
//! demandent des travaux opposés :
//!
//! - **fonction de `nie.exe`** : il faut la reverser, puis l'écrire dans `nie_lua::host` ;
//! - **fonction Lua** : elle existe déjà dans le corpus, et il manque seulement que l'include
//!   qui la définit soit exécuté — c'est du câblage.
//!
//! Compter les occurrences ne tranche pas : un script qui APPELLE la fonction la nomme autant
//! qu'un script qui la définit. Ce qui tranche est l'opcode. En Lua 5.2 une affectation à une
//! globale est `SETTABUP UpValue[A][RK(B)] := RK(C)` avec `A == 0` (`_ENV`) ; une lecture est
//! `GETTABUP`. Ce relevé lit donc les deux et rend, pour chaque nom, qui l'écrit et qui le lit.
//!
//! ## La réponse, mesurée le 2026-09-12
//!
//! ```text
//! SetCtrlGuideTextCommon            : défini par main_menu_inc_3.00.01.00, lu par 160
//! ShowTitleChangeChildButtonCommon  : défini par main_menu_inc_3.00.01.00, lu par 116
//! SetTitleTextureCommon             : défini par main_menu_inc_3.00.01.00, lu par 108
//! SetStandAloneMenuCrc              : défini par main_menu_inc_3.00.01.00, lu par  76
//! SetStandAloneTopCtrlGuideLayerCrc : défini par main_menu_inc_3.00.01.00, lu par  72
//! ```
//!
//! **Aucune n'est une fonction du moteur.** Les cinq têtes de file sont du Lua, définies par UN
//! seul include, et les 46 écrans de menu qui lisent la première nomment tous `MAIN_MENU_INC`
//! (46 sur 46). `include_logical_base` sait déjà retirer le préfixe `LUA_`, donc la résolution
//! n'est pas en cause non plus.
//!
//! Ce qui reste comme explication — et qui n'est PAS établi ici — est que `main_menu_inc`
//! s'exécute mais échoue avant ses définitions, probablement sur une globale qui lui manque à
//! lui. Un seul include en défaut retirerait alors ces cinq fonctions à 46 écrans d'un coup, ce
//! qui correspond à ce que la file d'attente montre. C'est la piste à suivre, et elle est de
//! l'ordre du câblage, pas du reverse.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use nie_lua::bytecode::{self, Constant, Prototype};

/// `R(A) := UpValue[B][RK(C)]` — lecture d'une globale quand `B == 0`.
const OP_GETTABUP: u8 = 6;
/// `UpValue[A][RK(B)] := RK(C)` — écriture d'une globale quand `A == 0`.
const OP_SETTABUP: u8 = 8;

/// Les noms dont la nature décide du prochain chantier.
const NOMS: [&str; 5] = [
    "SetCtrlGuideTextCommon",
    "ShowTitleChangeChildButtonCommon",
    "SetTitleTextureCommon",
    "SetStandAloneMenuCrc",
    "SetStandAloneTopCtrlGuideLayerCrc",
];

fn scripts() -> Vec<PathBuf> {
    let racine = std::env::var("NIE_GAME_DIR").map_or_else(
        |_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
        PathBuf::from,
    );
    let mut trouves = Vec::new();
    collecter(&racine.join("data"), &mut trouves);
    trouves.sort();
    trouves
}

fn collecter(dossier: &Path, dans: &mut Vec<PathBuf>) {
    let Ok(entrees) = std::fs::read_dir(dossier) else {
        return;
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.is_dir() {
            collecter(&chemin, dans);
        } else if chemin.to_string_lossy().ends_with(".lua.bin") {
            dans.push(chemin);
        }
    }
}

/// La constante chaîne désignée par un `RK`, ou `None` si l'opérande est un registre.
fn constante_rk(proto: &Prototype, rk: u32) -> Option<&str> {
    if rk < 256 {
        return None;
    }
    match proto.constants.get((rk - 256) as usize) {
        // Les octets sont conservés bruts par le décodeur (libellés japonais) ; un nom de
        // globale est de l'ASCII, donc la comparaison directe suffit.
        Some(Constant::String(octets)) => std::str::from_utf8(octets).ok(),
        _ => None,
    }
}

fn parcourir(proto: &Prototype, ecrit: &mut BTreeSet<String>, lit: &mut BTreeSet<String>) {
    for raw in &proto.code {
        let i = bytecode::decode_instruction(*raw);
        match i.opcode {
            OP_SETTABUP if i.a == 0 => {
                if let Some(nom) = constante_rk(proto, i.b) {
                    ecrit.insert(nom.to_owned());
                }
            }
            OP_GETTABUP if i.b == 0 => {
                if let Some(nom) = constante_rk(proto, i.c) {
                    lit.insert(nom.to_owned());
                }
            }
            _ => {}
        }
    }
    for enfant in &proto.protos {
        parcourir(enfant, ecrit, lit);
    }
}

#[test]
fn qui_definit_les_globales_en_tete_de_file() {
    let fichiers = scripts();
    if fichiers.len() < 100 {
        eprintln!("corpus trop mince sur ce montage : relevé sauté");
        return;
    }

    // nom → (scripts qui l'écrivent, scripts qui la lisent)
    let mut definit: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut appelle: BTreeMap<String, usize> = BTreeMap::new();
    for chemin in &fichiers {
        let Ok(octets) = std::fs::read(chemin) else {
            continue;
        };
        let Ok(chunk) = bytecode::parse(&octets) else {
            continue;
        };
        let (mut ecrit, mut lit) = (BTreeSet::new(), BTreeSet::new());
        parcourir(&chunk.main, &mut ecrit, &mut lit);
        let nom_court = chemin
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        for cible in NOMS {
            if ecrit.contains(cible) {
                definit.entry(cible.to_owned()).or_default().push(nom_court.clone());
            }
            if lit.contains(cible) {
                *appelle.entry(cible.to_owned()).or_default() += 1;
            }
        }
    }

    for cible in NOMS {
        let definisseurs = definit.get(cible).cloned().unwrap_or_default();
        eprintln!(
            "{cible} : défini par {} script(s) {:?}, lu par {}",
            definisseurs.len(),
            definisseurs.iter().take(3).collect::<Vec<_>>(),
            appelle.get(cible).copied().unwrap_or(0)
        );
    }

    // Le relevé doit voir au moins une lecture, sinon il ne mesure rien : ces noms viennent de
    // la file d'attente d'un rejeu réel, donc quelque chose les lit forcément.
    assert!(
        NOMS.iter().any(|nom| appelle.contains_key(*nom)),
        "aucun de ces noms n'est lu : le décodeur ou le corpus est cassé"
    );
}
