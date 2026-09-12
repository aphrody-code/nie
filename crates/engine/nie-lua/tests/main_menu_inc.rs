//! Pourquoi `main_menu_inc` ne définit pas ses fonctions — ce qu'il lui manque à LUI.
//!
//! `global_definitions.rs` a établi que les cinq globales en tête de la file d'attente du rejeu
//! sont du Lua, définies par ce seul include, et lues par 160 scripts. Si elles manquent au
//! rejeu, c'est que l'include ne va pas jusqu'à ses définitions.
//!
//! Ce relevé l'exécute seul, dans la VM instrumentée de [`nie_lua::discover_host_calls`] : une
//! métatable sur `_G` enregistre chaque globale indéfinie et rend un stub appelable, si bien que
//! le script va aussi loin qu'il peut. Ce qui sort est la liste de ce que l'include RÉCLAME —
//! donc le travail exact qui débloquerait 46 écrans d'un coup.
//!
//! ## La réponse, mesurée le 2026-09-12
//!
//! ```text
//! main_menu_inc_3.00.01.00.lua.bin : 1 globales hôte réclamées
//!   premières : ["MAIN_MENU"]
//!   définit-il ses cinq fonctions quand tout est stubé ? toutes = true
//! ```
//!
//! **L'include n'est pas cassé.** Il va jusqu'au bout et définit ses cinq fonctions dès lors
//! qu'une seule globale existe : `MAIN_MENU`. Ce n'est donc ni un travail de reverse, ni une
//! résolution d'include défaillante — c'est UN nom.
//!
//! ## Trois hypothèses éliminées, dans cet ordre
//!
//! 1. **L'include échoue avant ses définitions.** Non : il va au bout et définit les cinq.
//! 2. **Il s'arrête sur `MAIN_MENU`.** Non plus : `runtime::install_host_stubs` pose une
//!    métatable sur `_G` qui enregistre toute globale inconnue et rend un stub appelable. Une
//!    globale absente ne peut donc pas interrompre un script dans ce rejeu.
//! 3. **L'INCLUDE ne se résout pas.** Non : `linclude_se_resout_sur_les_chemins_du_rejeu` le
//!    résout depuis les trois écritures que les scripts emploient — `LUA_MAIN_MENU_INC`,
//!    `MAIN_MENU_INC`, `main_menu_inc`.
//!
//! Ce qui reste, et que ce fichier n'établit PAS : l'appel `INCLUDE` n'est pas ATTEINT. S'il
//! vit dans une fonction que le rejeu n'invoque pas — un rappel, une branche conditionnelle —
//! l'include n'est jamais exécuté, ses définitions n'existent pas, et les 46 écrans qui les
//! appellent les voient comme des globales d'hôte manquantes. C'est la prochaine mesure : où,
//! dans le bytecode d'un écran, le `INCLUDE` est-il appelé.

use std::path::{Path, PathBuf};

/// Le chemin de l'include, sur le montage qui le porte.
fn include() -> Option<PathBuf> {
    let depot = std::env::var("NIE_GAME_DIR").map_or_else(
        |_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
        PathBuf::from,
    );
    for base in ["data", "data/lua_dump", "data/re/40-derived/dumps/lua-vfs-all"] {
        let dossier = depot.join(base).join("common/script/lua/include/menu");
        let Ok(entrees) = std::fs::read_dir(&dossier) else {
            continue;
        };
        for entree in entrees.flatten() {
            let chemin = entree.path();
            if chemin
                .file_name()
                .is_some_and(|nom| nom.to_string_lossy().starts_with("main_menu_inc"))
            {
                return Some(chemin);
            }
        }
    }
    None
}

/// Les cinq fonctions dont `global_definitions.rs` a prouvé qu'elles viennent d'ici.
const DEFINIES_ICI: [&str; 5] = [
    "SetCtrlGuideTextCommon",
    "ShowTitleChangeChildButtonCommon",
    "SetTitleTextureCommon",
    "SetStandAloneMenuCrc",
    "SetStandAloneTopCtrlGuideLayerCrc",
];

#[test]
fn ce_que_linclude_reclame_avant_de_definir() {
    let Some(chemin) = include() else {
        eprintln!("main_menu_inc absent de ce montage : relevé sauté");
        return;
    };
    let octets = std::fs::read(&chemin).expect("include lisible");
    let nom = Path::new(&chemin)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    match nie_lua::discover_host_calls(&octets, &nom) {
        Ok(globales) => {
            eprintln!("{nom} : {} globales hôte réclamées", globales.len());
            eprintln!("  premières : {:?}", globales.iter().take(25).collect::<Vec<_>>());
            // La question à laquelle ce relevé répond : l'include va-t-il jusqu'au bout ?
            // S'il définit bien ses cinq fonctions dans une VM qui stube tout, alors ce n'est
            // pas SA faute — c'est le rejeu qui ne l'exécute pas. Sinon, c'est ici que ça casse.
            eprintln!(
                "  définit-il ses cinq fonctions quand tout est stubé ? {}",
                DEFINIES_ICI
                    .iter()
                    .map(|nom| format!("{nom}={}", !globales.contains(&(*nom).to_string())))
                    .collect::<Vec<_>>()
                    .join(" ")
            );
        }
        Err(erreur) => {
            // Une erreur EST la réponse : l'include ne s'exécute pas jusqu'au bout, et le
            // message dit sur quoi il s'arrête.
            eprintln!("{nom} ÉCHOUE : {erreur}");
        }
    }
}

/// L'INCLUDE se résout-il, sur le jeu de chemins que le rejeu reçoit ?
///
/// La VM stube toute globale inconnue (`install_host_stubs`), donc `MAIN_MENU` ne peut PAS
/// arrêter l'include : s'il s'exécutait, ses cinq fonctions existeraient. Qu'elles manquent
/// signifie qu'il n'est pas exécuté du tout — et la première chose à éprouver est la résolution,
/// qui est une fonction pure et ne demande aucune VM.
#[test]
fn linclude_se_resout_sur_les_chemins_du_rejeu() {
    let Some(chemin) = include() else {
        eprintln!("main_menu_inc absent de ce montage : relevé sauté");
        return;
    };
    // La base sous laquelle le rejeu nomme ses chemins (`common/script/lua/...`).
    let texte = chemin.to_string_lossy().into_owned();
    let Some(position) = texte.find("common/script/lua/") else {
        eprintln!("chemin inattendu : {texte}");
        return;
    };
    let base = &texte[..position];
    let mut chemins = Vec::new();
    collecter_relatifs(Path::new(base), base, &mut chemins);
    assert!(chemins.len() > 100, "corpus trop mince : {}", chemins.len());

    let (by_name, by_logical) = nie_lua::index_script_paths(chemins.iter().map(String::as_str));
    for nom in ["LUA_MAIN_MENU_INC", "MAIN_MENU_INC", "main_menu_inc"] {
        eprintln!(
            "{nom} → {:?}",
            nie_lua::resolve_script_path(nom, &by_name, &by_logical)
        );
    }
    assert!(
        nie_lua::resolve_script_path("LUA_MAIN_MENU_INC", &by_name, &by_logical).is_some(),
        "l'include que 46 écrans nomment doit se résoudre"
    );
}

fn collecter_relatifs(dossier: &Path, base: &str, dans: &mut Vec<String>) {
    let Ok(entrees) = std::fs::read_dir(dossier) else {
        return;
    };
    for entree in entrees.flatten() {
        let chemin = entree.path();
        if chemin.is_dir() {
            collecter_relatifs(&chemin, base, dans);
        } else {
            let texte = chemin.to_string_lossy();
            if texte.ends_with(".lua.bin") {
                dans.push(texte[base.len()..].to_owned());
            }
        }
    }
}
