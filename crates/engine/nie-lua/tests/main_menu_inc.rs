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
//! Ce que ce relevé ne tranche pas : si le rejeu réel s'arrête à la lecture de `MAIN_MENU` (là
//! où cette VM-ci rend un stub), les cinq fonctions ne sont jamais définies, et 46 écrans les
//! réclament ensuite en vain. C'est cohérent avec la file d'attente, et c'est la prochaine
//! chose à vérifier — en mesurant le rejeu, pas en supposant.

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
