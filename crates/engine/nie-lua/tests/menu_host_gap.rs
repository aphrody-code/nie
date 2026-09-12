//! Ce qui manque pour qu'un écran de menu se rejoue COMPLÈTEMENT, écran par écran.
//!
//! ## Pourquoi ce relevé
//!
//! `opcode_survey.rs` mesure le mur global : 6 686 globales lues par les scripts du jeu, dont
//! l'hôte Rust n'en fournit aucune. Ce nombre dit qu'une VM Lua en Rust est loin ; il ne dit pas
//! par où commencer.
//!
//! Celui-ci le dit. Il rejoue les écrans de menu avec la VRAIE VM, relève ce que
//! [`nie_lua::menu_runtime::ReplayOutput::missing`] nomme, et classe les manques par NOMBRE
//! D'ÉCRANS bloqués. Implémenter une globale qui bloque douze écrans n'a pas le même effet
//! qu'une qui en bloque un, et jusqu'ici rien ne permettait de faire la différence.
//!
//! Le relevé ne corrige rien et n'invente aucun comportement : il rend la file d'attente.
//!
//! ## Ce que cette file NE débloque PAS — déjà mesuré, ne pas le refaire
//!
//! Elle ferme des COMPTEURS, pas des pixels. `docs/AVATAR.md` (§ « Ce que le port du cmdId
//! dominant a appris — le verrou n'est pas là ») rapporte la mesure : porter `0x5245F000` a fait
//! tomber les appels non gérés de `chara_edit_parts_menu` de 364 à 7 (−98 %) et le rendu n'a pas
//! bougé d'un pixel — objets visibles 10 → 10, sprites mutés 46 → 46. Le verrou nommé là-bas est
//! ailleurs : les items de liste ne sont pas instanciés.
//!
//! Le premier de cette file, `0x52BD4EDC`, y est d'ailleurs déjà analysé : handler
//! `0x140CDF730`, `cmp edx, 6` donc six arguments, `comisd`/`cvttsd2si` donc des flottants
//! convertis — un setter de couleur, dont « quel argument porte quelle composante n'est pas
//! établi ».
//!
//! Cette file sert donc à la COMPLÉTUDE du rejeu — le chemin vers un module WebAssembly unique,
//! où chaque commande portée rapproche d'une VM en Rust pur. Elle ne sert pas à faire apparaître
//! des pixels manquants, et la prendre pour ça ferait refaire un travail dont le résultat est
//! déjà écrit.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// La racine des données du jeu sur ce montage.
fn depot() -> PathBuf {
    std::env::var("NIE_GAME_DIR").map_or_else(
        |_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
        PathBuf::from,
    )
}

/// La base sous laquelle les scripts suivent l'arborescence du VFS.
///
/// Le montage extrait n'est pas à un seul endroit : selon la manière dont il a été produit, les
/// scripts vivent sous `data/lua_dump/` ou sous `data/re/40-derived/dumps/lua-vfs-all/`. Les
/// candidats sont donc essayés dans l'ordre, et le chemin retenu est celui qui porte réellement
/// des fichiers — jamais supposé.
fn base(depot: &Path, sous_dossier: &str) -> Option<PathBuf> {
    [
        "data",
        "data/lua_dump",
        "data/re/40-derived/dumps/lua-vfs-all",
    ]
    .into_iter()
    .map(|candidat| depot.join(candidat))
    .find(|base| base.join(sous_dossier).is_dir())
}

/// TOUS les scripts du montage, par leur chemin relatif à la base.
///
/// Pas seulement `menu/` : un écran inclut `LUA_PROG_BASE`, `LUA_LISTVIEW_INC`,
/// `LUA_SOCCER_COMMON`, qui vivent ailleurs dans l'arbre. Ne donner que le dossier des menus
/// fait échouer la résolution de ces includes et attribue au manque d'un HÔTE ce qui n'est qu'un
/// fichier non fourni — mesuré : 350 manques distincts avec `menu/` seul.
fn tous_les_scripts(racine: &Path) -> Vec<String> {
    let mut fichiers = Vec::new();
    collecter(&racine.join("common"), &mut fichiers);
    let mut chemins: Vec<String> = fichiers
        .into_iter()
        .filter_map(|chemin| {
            chemin
                .strip_prefix(racine)
                .ok()
                .map(|relatif| relatif.to_string_lossy().into_owned())
        })
        .collect();
    chemins.sort();
    chemins
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

/// Les identifiants de calque d'un écran, lus dans son `_setting.cfg.bin`.
fn calques(racine: &Path, ecran: &str) -> Option<Vec<u32>> {
    let chemin = racine.join(format!("common/gamedata/menu/cfg/{ecran}_setting.cfg.bin"));
    let octets = std::fs::read(chemin).ok()?;
    let root = nie_formats::cfgbin::to_iecode_json(&octets)?;
    let setting = nie_data::menu_setting::parse(&root);
    Some(setting.layers.iter().map(|layer| layer.layer_id.0).collect())
}

#[test]
fn la_file_dattente_des_globales_hote() {
    let depot = depot();
    // Les scripts et les configurations ne vivent pas forcément sous la même base : sur ce
    // montage les `.lua.bin` sont dans un dump et les `_setting.cfg.bin` dans l'arbre extrait.
    let (Some(racine), Some(racine_cfg)) = (
        base(&depot, "common/script/lua/menu"),
        base(&depot, "common/gamedata/menu/cfg"),
    ) else {
        eprintln!("aucun montage complet (scripts + configurations) : relevé sauté");
        return;
    };
    let chemins = tous_les_scripts(&racine);
    let ecrans: Vec<String> = chemins
        .iter()
        // Les écrans de menu, et eux seuls : `common/gamedata/.../menu/` porte d'autres
        // scripts, dont aucun n'a de `_setting.cfg.bin` et qui fausseraient le relevé.
        .filter(|chemin| chemin.starts_with("common/script/lua/menu/"))
        .cloned()
        .collect();
    if ecrans.len() < 5 {
        eprintln!("moins de 5 scripts de menu sur ce montage : relevé sauté");
        return;
    }

    // Combien d'écrans chaque manque bloque, et un exemple d'écran pour chacun.
    let mut par_manque: BTreeMap<String, (usize, String)> = BTreeMap::new();
    let (mut rejoues, mut complets, mut refuses, mut sans_setting) = (0usize, 0usize, 0usize, 0usize);

    // Borné : chaque rejeu démarre une VM Lua et lit ses inclusions ; la file d'attente se lit
    // sur un échantillon large, pas sur les 552 scripts de menu du jeu.
    for chemin in ecrans.iter().take(60) {
        let racine_lecture = racine.clone();
        let lire = move |demande: &str| std::fs::read(racine_lecture.join(demande)).ok();
        // Le nom d'écran est le nom logique du script : `chara_bank_menu_6.00.09.00.lua.bin`
        // devient `chara_bank_menu`. Couper au premier point rendrait `chara_bank_menu_6`.
        let ecran = Path::new(chemin)
            .file_name()
            .map(|nom| nie_lua::script_logical_base(&nom.to_string_lossy()))
            .unwrap_or_default();
        // Les calques viennent du `_setting.cfg.bin` de l'écran, décodé par la MÊME façade que
        // le site et le navigateur. `replay` refuse une liste vide — à juste titre : un écran
        // sans calque n'est pas un écran, c'est un fichier qu'on n'a pas trouvé.
        let Some(layers) = calques(&racine_cfg, &ecran) else {
            sans_setting += 1;
            continue;
        };
        let sortie = nie_lua::menu_runtime::replay(
            chemins.clone(),
            lire,
            chemin,
            &layers,
            BTreeMap::new(),
            nie_lua::menu_runtime::ReplayRequest::default(),
        );
        match sortie {
            Ok(sortie) => {
                rejoues += 1;
                if sortie.complete {
                    complets += 1;
                }
                for manque in BTreeSet::from_iter(sortie.missing) {
                    let entree = par_manque.entry(manque).or_insert((0, ecran.clone()));
                    entree.0 += 1;
                }
            }
            Err(erreur) => {
                if refuses == 0 {
                    eprintln!("premier refus ({chemin}) : {erreur}");
                }
                refuses += 1;
            }
        }
    }

    // Les commandes inconnues arrivent avec leurs ARGUMENTS : `3860611758, 159760206, 0, 1, 1
    // (cmd 0xe61c42ae/0x1ac99083)`. Compter ces chaînes compterait des appels, pas du travail —
    // une même commande revient sous vingt tuples. La file d'attente se classe donc par
    // identifiant de commande, qui est l'unité qu'on reverse.
    let mut par_commande: BTreeMap<String, usize> = BTreeMap::new();
    for (manque, (ecrans, _)) in &par_manque {
        let cle = manque
            .rsplit_once("(cmd ")
            .and_then(|(_, reste)| reste.split_once('/'))
            .map_or_else(|| manque.clone(), |(cmd, _)| format!("cmd {cmd}"));
        let entree = par_commande.entry(cle).or_default();
        *entree = (*entree).max(*ecrans);
    }
    let mut queue: Vec<(&String, &usize)> = par_commande.iter().collect();
    queue.sort_by_key(|(nom, n)| (std::cmp::Reverse(**n), (*nom).clone()));

    let mut classement: Vec<(&String, &(usize, String))> = par_manque.iter().collect();
    classement.sort_by_key(|(nom, (n, _))| (std::cmp::Reverse(*n), (*nom).clone()));

    eprintln!(
        "écrans rejoués    : {rejoues} (complets : {complets}, refusés : {refuses}, \
         sans _setting : {sans_setting})"
    );
    eprintln!(
        "scripts fournis   : {} (dont {} écrans de menu)",
        chemins.len(),
        ecrans.len()
    );
    eprintln!("sites d'appel     : {}", par_manque.len());
    eprintln!("UNITÉS à reverser : {}", par_commande.len());
    eprintln!("les 20 qui bloquent le plus d'écrans :");
    for (nom, ecrans) in queue.iter().take(20) {
        eprintln!("  {ecrans:3} écrans  {nom}");
    }
    let _ = &classement;

    // Le relevé doit porter sur des rejeux réels : zéro écran rejoué rendrait une file vide qui
    // se lirait comme « rien ne manque ».
    assert!(rejoues > 0, "aucun écran rejoué : la VM ou le montage est cassé");
}
