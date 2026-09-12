//! Ce que coûterait une VM Lua en Rust pur : la surface RÉELLEMENT employée par le jeu.
//!
//! ## Pourquoi cette mesure existe
//!
//! Le navigateur charge DEUX modules WebAssembly. Le second (`nie-lua-web`) n'existe que parce
//! que `mlua` compile les sources C de PUC-Rio Lua 5.2.4, qui réclament `setjmp`/`longjmp` —
//! seul `wasm32-unknown-emscripten` les fournit parmi les cibles wasm. Tant que la VM est du C,
//! « un seul module » est hors d'atteinte, et ce n'est pas un défaut de câblage.
//!
//! La seule sortie est une VM écrite en Rust, qui interprète le bytecode que
//! `nie_lua::bytecode` décode déjà — pas un interpréteur tiers, qui serait un AUTRE Lua que
//! celui du jeu. Avant d'écrire une ligne d'une telle VM, il faut savoir ce qu'elle devrait
//! couvrir. C'est ce que ce relevé mesure, sur les `.lua.bin` du jeu :
//!
//! - combien des 40 opcodes de Lua 5.2 sont réellement atteints ;
//! - lesquels ne le sont jamais, donc n'auraient pas à être écrits ;
//! - quelles globales les scripts lisent, c'est-à-dire la bibliothèque et l'hôte qu'il faudrait
//!   fournir en plus de l'interpréteur.
//!
//! Le relevé ne construit rien. Il rend un NOMBRE, pour que la décision d'écrire cette VM se
//! prenne sur une mesure et non sur une impression.
//!
//! ## Ce que ce nombre N'EST PAS : une estimation de travail
//!
//! Il compte les globales LUES dans le bytecode, branches jamais prises comprises. Restreint aux
//! menus et à leurs includes, il tombe à peine — 6 081 sur 6 686 — ce qui se lirait comme « même
//! les menus demandent tout le jeu ».
//!
//! La mesure DYNAMIQUE dit autre chose. `menu_host_gap.rs` rejoue 51 écrans avec la vraie VM et
//! relève 178 unités réellement manquantes. L'écart est de deux ordres de grandeur, et il est
//! attendu : un script nomme des centaines de fonctions sur des chemins qu'une ouverture d'écran
//! ne prend jamais.
//!
//! Le relevé statique borne donc la surface ; il ne mesure pas le chemin. Prendre 6 686 pour une
//! charge de travail ferait renoncer à un chantier dont la partie utile en compte 178.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use nie_lua::bytecode::{self, Constant, OPCODE_NAMES, Prototype};

/// `OP_GETTABUP` : `R(A) := UpValue[B][RK(C)]`. Avec `B == 0` l'upvalue est `_ENV`, donc `RK(C)`
/// nomme une GLOBALE — c'est ainsi qu'un script atteint l'hôte et la bibliothèque standard.
const OP_GETTABUP: u8 = 6;

/// Les scripts du jeu présents sur ce montage.
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

/// Parcourt un prototype et tous ses enfants.
fn parcourir(proto: &Prototype, opcodes: &mut BTreeMap<u8, usize>, globales: &mut BTreeSet<String>) {
    for raw in &proto.code {
        let instruction = bytecode::decode_instruction(*raw);
        *opcodes.entry(instruction.opcode).or_default() += 1;
        // `C` au-delà de 255 désigne une constante (`RK`), et c'est là que vit le nom.
        if instruction.opcode == OP_GETTABUP
            && instruction.b == 0
            && instruction.c >= 256
            && let Some(Constant::String(nom)) = proto.constants.get((instruction.c - 256) as usize)
        {
            // Les octets sont conservés tels quels par le décodeur (libellés japonais hérités) ;
            // un nom de globale, lui, est de l'ASCII — la conversion lossy ne perd donc rien ici.
            globales.insert(String::from_utf8_lossy(nom).into_owned());
        }
    }
    for enfant in &proto.protos {
        parcourir(enfant, opcodes, globales);
    }
}

#[test]
fn la_surface_lua_reellement_employee_par_le_jeu() {
    let fichiers = scripts();
    if fichiers.is_empty() {
        eprintln!("aucun .lua.bin sur ce montage : relevé sauté");
        return;
    }

    let mut opcodes: BTreeMap<u8, usize> = BTreeMap::new();
    let mut globales: BTreeSet<String> = BTreeSet::new();
    // Le sous-ensemble qui décide vraiment de la faisabilité : ce que le NAVIGATEUR rejoue.
    // Une VM en Rust pour le site n'a pas à couvrir le jeu entier — seulement les écrans de menu
    // et les includes qu'ils tirent.
    let mut opcodes_menu: BTreeMap<u8, usize> = BTreeMap::new();
    let mut globales_menu: BTreeSet<String> = BTreeSet::new();
    let (mut lus, mut illisibles, mut lus_menu) = (0usize, 0usize, 0usize);
    for chemin in &fichiers {
        let Ok(octets) = std::fs::read(chemin) else {
            continue;
        };
        match bytecode::parse(&octets) {
            Ok(chunk) => {
                lus += 1;
                parcourir(&chunk.main, &mut opcodes, &mut globales);
                let texte = chemin.to_string_lossy();
                if texte.contains("/script/lua/menu/") || texte.contains("/script/lua/include/") {
                    lus_menu += 1;
                    parcourir(&chunk.main, &mut opcodes_menu, &mut globales_menu);
                }
            }
            Err(_) => illisibles += 1,
        }
    }

    let atteints: Vec<&str> = (0..40u8)
        .filter(|op| opcodes.contains_key(op))
        .map(|op| OPCODE_NAMES[op as usize])
        .collect();
    let jamais: Vec<&str> = (0..40u8)
        .filter(|op| !opcodes.contains_key(op))
        .map(|op| OPCODE_NAMES[op as usize])
        .collect();

    eprintln!("scripts lus       : {lus} (illisibles : {illisibles})");
    eprintln!("instructions      : {}", opcodes.values().sum::<usize>());
    eprintln!("opcodes atteints  : {} / 40", atteints.len());
    eprintln!("jamais atteints   : {}", jamais.join(", "));
    eprintln!("globales lues     : {}", globales.len());
    let opcodes_menu_atteints = (0..40u8).filter(|op| opcodes_menu.contains_key(op)).count();
    eprintln!(
        "— dont MENUS + includes ({lus_menu} scripts) : {opcodes_menu_atteints} opcodes, {} globales",
        globales_menu.len()
    );
    let mut par_frequence: Vec<(&str, usize)> = opcodes
        .iter()
        .map(|(op, n)| (OPCODE_NAMES[*op as usize], *n))
        .collect();
    par_frequence.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    eprintln!(
        "10 plus fréquents : {}",
        par_frequence
            .iter()
            .take(10)
            .map(|(nom, n)| format!("{nom}×{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    // La part que l'hôte Rust actuel sait déjà fournir : c'est CE nombre, et non le nombre
    // d'opcodes, qui dit ce qu'une VM en Rust pur demanderait encore de travail.
    let installees: BTreeSet<String> = nie_lua::host::HostRegistry::standard(Default::default())
        .installed_names()
        .into_iter()
        .collect();
    let couvertes = globales.intersection(&installees).count();
    eprintln!(
        "dont fournies par l'hôte Rust : {couvertes} / {} ({} %) — l'hôte en installe {} : {}",
        globales.len(),
        couvertes * 100 / globales.len().max(1),
        installees.len(),
        installees.iter().cloned().collect::<Vec<_>>().join(" ")
    );
    eprintln!(
        "globales          : {}",
        globales.iter().take(50).cloned().collect::<Vec<_>>().join(" ")
    );

    // Le relevé doit porter sur le corpus, pas sur un échantillon : un montage qui ne rend que
    // quelques scripts donnerait une surface faussement petite, donc une VM faussement facile.
    assert!(lus >= 100, "corpus trop mince pour conclure : {lus} scripts");
    assert!(
        !atteints.is_empty(),
        "aucun opcode atteint : le décodeur ou le corpus est cassé"
    );
}
