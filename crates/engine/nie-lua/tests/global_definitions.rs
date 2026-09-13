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
//! SetCtrlGuideTextCommon            : défini par 0 script(s), lu par 80
//! ShowTitleChangeChildButtonCommon  : défini par 0 script(s), lu par 58
//! SetTitleTextureCommon             : défini par 0 script(s), lu par 54
//! SetStandAloneMenuCrc              : défini par 0 script(s), lu par 38
//! SetStandAloneTopCtrlGuideLayerCrc : défini par 0 script(s), lu par 36
//! ```
//!
//! **Aucune n'est définie en Lua sur les montages balayés.** La conclusion évidente — « ce sont
//! donc des fonctions de `nie.exe` » — ne tient pas non plus : cherchées dans le binaire
//! (`pefile`, 2026-09-12), ni les noms ni leurs CRC-32 n'y figurent.
//!
//! ```text
//! SetCtrlGuideTextCommon            chaîne absente de nie.exe, 0xB1245F8B absent
//! ShowTitleChangeChildButtonCommon  chaîne absente de nie.exe, 0x7A47702C absent
//! SetTitleTextureCommon             chaîne absente de nie.exe, 0x85CC3989 absent
//! SetStandAloneMenuCrc              chaîne absente de nie.exe, 0xE3B17AEC absent
//! SetStandAloneTopCtrlGuideLayerCrc chaîne absente de nie.exe, 0xEC8A95DB absent
//! ```
//!
//! (Les CRC-32 sont les bons : `menu-crc32-dictionary.json` donne exactement les mêmes valeurs
//! que `zlib.crc32`, donc le hachage du jeu est bien celui-là.)
//!
//! Ni Lua, ni binaire. Ce qui reste est que les montages EXTRAITS sont incomplets : le fichier
//! qui les définit existe dans le VFS du jeu mais pas dans `data/lua_dump/` ni dans
//! `data/re/40-derived/dumps/lua-vfs-all/`. Un indice va dans ce sens sans le prouver :
//! `data/lua_scripts/`, le dump plat, porte une copie de `main_menu_inc_3.00.01.00.lua.bin` de
//! 270 octets de PLUS que celle du VFS, et c'est elle qui définit les cinq.
//!
//! Trancher demande d'extraire le VFS entier et de rejouer ce relevé dessus — une opération,
//! pas une mesure de plus. Tant que ce n'est pas fait, ces cinq noms ne doivent être attribués
//! ni au moteur ni au Lua.
//!
//! ## Par où les reverser : pas par `funcLuaMenuCommand`
//!
//! Le réflexe serait de les chercher dans `data/re/funclua-cmdid-handlers.json` (3 659 entrées),
//! la table qui associe un `cmdId` à l'adresse de son handler. Mesuré le 2026-09-12 : les cinq
//! CRC-32 en sont ABSENTS.
//!
//! ```text
//! SetCtrlGuideTextCommon            0xB1245F8B   absent
//! ShowTitleChangeChildButtonCommon  0x7A47702C   absent
//! SetTitleTextureCommon             0x85CC3989   absent
//! SetStandAloneMenuCrc              0xE3B17AEC   absent
//! SetStandAloneTopCtrlGuideLayerCrc 0xEC8A95DB   absent
//! ```
//!
//! Elles ne passent donc pas par le répartiteur de commandes de menu : ce sont des fonctions C
//! enregistrées directement dans `_ENV` (`lua_register`/`luaL_Reg`). C'est là qu'il faut les
//! chercher dans le binaire, et leurs CRC-32 sont ci-dessus pour ancrer la recherche — leurs
//! noms sont d'ailleurs déjà dans `data/re/menu-crc32-dictionary.json`.
//!
//! ## Le détour qui a failli conclure l'inverse
//!
//! Ce relevé a d'abord balayé tout `data/`, et rendu « défini par
//! `main_menu_inc_3.00.01.00.lua.bin` » pour les cinq. Deux fichiers portent ce nom sur ce
//! montage, et ils DIFFÈRENT :
//!
//! ```text
//! 13 362 o  data/lua_scripts/main_menu_inc_3.00.01.00.lua.bin          ← définit les cinq
//! 13 092 o  data/lua_dump/common/script/lua/include/menu/…             ← ne les définit pas
//! 13 092 o  le VFS du jeu (`niers vfs find main_menu_inc`)             ← l'arbitre
//! ```
//!
//! `data/lua_scripts/` est un dump PLAT qui diverge du jeu. Le balayage ne lit donc plus que les
//! montages en forme de VFS, et le nom d'un définisseur est rendu avec son chemin complet : un
//! basename seul avait fait prendre une copie non conforme pour la source.

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
    // SEULEMENT les montages en forme de VFS. `data/lua_scripts/` est un dump PLAT qui diverge
    // du jeu : sa copie de `main_menu_inc_3.00.01.00.lua.bin` fait 13 362 octets là où le VFS
    // en porte 13 092 (`niers vfs find`, 2026-09-12), et elle définit cinq globales que la
    // vraie ne définit pas. L'y inclure faisait conclure que ces fonctions étaient du Lua.
    for base in ["data/lua_dump", "data/re/40-derived/dumps/lua-vfs-all"] {
        collecter(&racine.join(base).join("common"), &mut trouves);
    }
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
        // Le chemin COMPLET, pas le basename : ce montage porte plusieurs copies du même nom
        // (`data/lua_dump`, `data/re/40-derived/dumps/…`) et elles ne sont pas identiques.
        // Nommer par le basename faisait croire à un définisseur unique.
        let nom_court = chemin.to_string_lossy().into_owned();
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
