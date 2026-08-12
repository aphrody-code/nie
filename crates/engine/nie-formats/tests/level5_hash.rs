//! Hash Level-5 — les paires (nom, hash) **réelles** extraites du jeu.
//!
//! Le hash Level-5 est un CRC32 IEEE (polynôme réfléchi `0xEDB88320`, init/xorout `0xFFFFFFFF`,
//! chaîne encodée en UTF-8) : c'est exactement [`nie_formats::cfgbin::crc32`]. Les vecteurs
//! génériques du type `CRC32("123456789") == 0xCBF43926` vivent déjà dans `cfgbin.rs` ; ce
//! fichier-ci porte autre chose — les **vingt noms de champs réels** relevés dans trois fichiers
//! du jeu, avec leur hash tel qu'il y figure.
//!
//! Origine des noms (chemins VFS) :
//! - `data/common/gamedata/menu/cmd_tag_config_2.00.17.00.cfg.bin` → les neuf `CMD_TAG_*` ;
//! - `data/common/gamedata/menu/obj/soccer20_12_tactics_information.objbin` → `OBJ_BGN` … `OBJ_END` ;
//! - `data/common/gamedata/menu/menu_group_capture_config.cfg.bin` → les trois `GROUP_CAPTURE_*`.
//!
//! Un fichier de tests dédié, et non un `#[cfg(test)]` de plus dans `cfgbin.rs` : l'absence de ces
//! valeurs côté Rust avait été établie par `grep CB189152` — leur présence doit être aussi
//! greppable.

use std::collections::BTreeSet;

use nie_formats::cfgbin::crc32;

/// Les vingt paires (nom de champ, hash) relevées dans le jeu.
///
/// L'ordre est celui des fichiers d'origine (ouverture, contenu, fermeture pour chacun) : il rend
/// la structure des tables lisible et facilite le recoupement avec un dump.
const PAIRES: [(&str, u32); 20] = [
    // ── cmd_tag_config_2.00.17.00.cfg.bin ────────────────────────────────────
    ("CMD_TAG_PAD_LIST_BEG", 0xCB18_9152),
    ("CMD_TAG_PAD", 0xDE5D_ABCE),
    ("CMD_TAG_KEYBOARD_MOUSE_LIST_BEG", 0xCB61_8B68),
    ("CMD_TAG_KEYBOARD_MOUSE", 0xCE4E_7342),
    ("CMD_TAG_INFO_LIST_BEG", 0x600C_5121),
    ("CMD_TAG_INFO", 0x5C18_3C3A),
    ("CMD_TAG_INFO_REF_PAD", 0xDBE1_188D),
    ("CMD_TAG_INFO_REF_KEYBOARD_MOUSE", 0x0295_017B),
    ("CMD_TAG_INFO_LIST_END", 0x1FBE_CFD5),
    // ── soccer20_12_tactics_information.objbin ───────────────────────────────
    ("OBJ_BGN", 0xB1D0_C26E),
    ("SETUP_BGN", 0xB14D_CDB0),
    ("SETUP_PARAM", 0x8BB1_3144),
    ("SETUP_END", 0x8515_8962),
    ("PROP_INFO_BGN", 0x6899_52A2),
    ("PROP_PARAM", 0xBD06_4D3E),
    ("PROP_INFO_END", 0x5CC1_1670),
    ("OBJ_END", 0x8588_86BC),
    // ── menu_group_capture_config.cfg.bin ────────────────────────────────────
    ("GROUP_CAPTURE_INFO_LIST_BEG", 0x57BB_B0C1),
    ("GROUP_CAPTURE_INFO", 0xE07B_CBBC),
    ("GROUP_CAPTURE_INFO_LIST_END", 0x2809_2E35),
];

#[test]
fn les_vingt_hash_reels_de_cmd_tag_obj_et_group_capture() {
    for (nom, attendu) in PAIRES {
        assert_eq!(
            crc32(nom.as_bytes()),
            attendu,
            "hash de {nom} : attendu 0x{attendu:08X}, obtenu 0x{:08X}",
            crc32(nom.as_bytes())
        );
    }
}

#[test]
fn le_hash_de_la_chaine_vide_est_nul() {
    // `Level5Hash.Hash("")` renvoie 0 : `!0xFFFFFFFF == 0`. Sentinelle « pas de nom ».
    assert_eq!(crc32(b""), 0);
}

#[test]
fn les_vingt_hash_sont_distincts() {
    // Filet contre un copier-coller silencieux dans la table ci-dessus : vingt noms distincts
    // doivent donner vingt hash distincts.
    let noms: BTreeSet<&str> = PAIRES.iter().map(|(n, _)| *n).collect();
    let hashes: BTreeSet<u32> = PAIRES.iter().map(|(_, h)| *h).collect();
    assert_eq!(noms.len(), 20, "noms dupliqués dans PAIRES");
    assert_eq!(hashes.len(), 20, "hashes dupliqués dans PAIRES");
}

#[test]
fn le_hash_est_sensible_a_la_casse_et_aux_separateurs() {
    // Le C# hashe l'UTF-8 brut, sans normalisation : ces variantes ne doivent pas collisionner
    // avec la vraie valeur, sinon un nom mal orthographié passerait inaperçu.
    assert_ne!(crc32(b"cmd_tag_pad"), crc32(b"CMD_TAG_PAD"));
    assert_ne!(crc32(b"CMD-TAG-PAD"), crc32(b"CMD_TAG_PAD"));
    assert_ne!(crc32(b"CMD_TAG_PAD "), crc32(b"CMD_TAG_PAD"));
}

/// Golden VFS : les vingt noms doivent réellement figurer dans les fichiers du jeu.
///
/// On cherche la chaîne ASCII dans l'octet brut plutôt que de passer par un parseur : ce test
/// prouve la **provenance** des noms, pas la structure des conteneurs — celle-ci est couverte
/// ailleurs (`cfgbin`, `objbin`). Saut annoncé si le jeu est absent.
#[test]
fn les_noms_proviennent_bien_des_fichiers_du_jeu() {
    use nie_formats::vfs::Vfs;
    use std::path::Path;

    let dir = nie_formats::vfs::resolve_game_dir()
        .to_string_lossy()
        .into_owned();
    let data_dir = Path::new(&dir).join("data");

    let mut vfs = Vfs::new();
    if vfs.init(&data_dir).is_err() {
        eprintln!(
            "skip level5_hash golden : jeu absent à {}",
            data_dir.display()
        );
        return;
    }

    // (fragment de basename, tranche de PAIRES relevée dans ce fichier) — les bornes suivent
    // l'ordre de la table : 9 `CMD_TAG_*`, 8 `OBJ_*`/`SETUP_*`/`PROP_*`, 3 `GROUP_CAPTURE_*`.
    let sources: [(&str, &[(&str, u32)]); 3] = [
        ("cmd_tag_config", &PAIRES[..9]),
        ("soccer20_12_tactics_information.objbin", &PAIRES[9..17]),
        ("menu_group_capture_config", &PAIRES[17..]),
    ];

    for (fragment, paires) in sources {
        let Some(chemin) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.contains(fragment))
        else {
            eprintln!("skip {fragment} : non trouvé dans le VFS");
            continue;
        };
        let data = vfs.read(&chemin).expect("lecture du fichier source");
        for (nom, hash) in paires {
            assert!(
                data.windows(nom.len()).any(|f| f == nom.as_bytes()),
                "{nom} absent de {chemin}"
            );
            assert_eq!(
                crc32(nom.as_bytes()),
                *hash,
                "hash de {nom} (relu depuis {chemin})"
            );
        }
        eprintln!("{chemin} : {} noms retrouvés", paires.len());
    }
}
