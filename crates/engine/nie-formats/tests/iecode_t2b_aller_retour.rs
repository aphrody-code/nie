//! Le chemin qui manquait : un document iecode redevient un `cfg.bin` T2B que le dépôt relit.
//!
//! `t2b_to_iecode_json` existait depuis toujours ; son inverse, non. Tout ce que le dépôt produit
//! en forme iecode — un document d'éditeur d'avatar généré, un événement de texte écrit à la main,
//! une table éditée — restait donc du JSON, sans chemin vers un fichier que le jeu pourrait lire.
//!
//! Ce test ferme la moitié de ce verrou qui ne demande pas le jeu : pour chaque document iecode du
//! checkout, `iecode → CfgEntry → encode_t2b → parse → iecode` doit rendre le document de départ,
//! nœud pour nœud. Ce qu'il **n'établit pas**, et qu'aucun test de ce dépôt ne peut établir : que
//! le jeu accepte le fichier. Le parseur du dépôt est plus permissif que lui.

use std::path::{Path, PathBuf};

use nie_formats::cfgbin;
use serde_json::Value;

/// Les documents `CHARA_EDIT_PARAM` livrés : 16 presets, 16 morphologies, 1 gabarit.
fn documents() -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data/common/chr/_test/default");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".cfg.bin.json"))
        })
        .collect();
    out.sort();
    out
}

#[test]
fn tout_document_iecode_redevient_un_t2b_relu_a_l_identique() {
    let paths = documents();
    if paths.is_empty() {
        eprintln!("dump data/common/chr/_test/default absent : test ignoré");
        return;
    }
    assert_eq!(paths.len(), 33, "33 documents attendus");

    let mut total_octets = 0_usize;
    for path in &paths {
        let original: Value = serde_json::from_slice(&std::fs::read(path).expect("lecture"))
            .expect("JSON du document");

        let bytes = cfgbin::encode_iecode_t2b(&original)
            .unwrap_or_else(|error| panic!("{} : {error}", path.display()));
        total_octets += bytes.len();

        assert!(
            !cfgbin::is_rdbn(&bytes),
            "{} : le T2B produit ne doit pas se faire prendre pour du RDBN",
            path.display()
        );
        let relu = cfgbin::t2b_to_iecode_json(&bytes)
            .unwrap_or_else(|| panic!("{} : le T2B produit ne se relit pas", path.display()));
        assert_eq!(relu, original, "aller-retour rompu sur {}", path.display());
    }
    assert!(
        total_octets > 33 * 1024,
        "{total_octets} octets produits au total, trop peu pour 33 documents"
    );
}

#[test]
fn le_suffixe_d_index_iecode_est_retire_et_non_recopie() {
    // Le piège que ce chemin existe pour éviter : appliquer l'inverse de `t2b_to_json` (noms tels
    // quels) à un document iecode écrit `CHARA_EDIT_PARAM_0` dans la table de chaînes du fichier,
    // au lieu de `CHARA_EDIT_PARAM`. Le dépôt relirait `CHARA_EDIT_PARAM_0_0` — et rien ne
    // signalerait la faute avant le jeu.
    let iecode = serde_json::json!({
        "entries": [{
            "name": "RACINE_LIST_BEG_0",
            "variables": [{ "type": "Int", "value": "1" }],
            "children": [
                { "name": "LIGNE_0", "variables": [{ "type": "String", "value": "a" }], "children": [] },
                { "name": "LIGNE_1", "variables": [{ "type": "String", "value": "b" }], "children": [] }
            ]
        }]
    });

    let entries = cfgbin::iecode_json_to_t2b_entries(&iecode).expect("reconstruction");
    assert_eq!(entries.len(), 1);
    assert_eq!(
        entries[0].name, "RACINE_LIST_BEG",
        "le suffixe de la racine est retiré"
    );
    assert_eq!(entries[0].children.len(), 2);
    assert_eq!(entries[0].children[0].name, "LIGNE");
    assert_eq!(
        entries[0].children[1].name, "LIGNE",
        "deux frères de même nom perdent tous deux leur rang"
    );

    let bytes = cfgbin::encode_iecode_t2b(&iecode).expect("encodage");
    let relu = cfgbin::t2b_to_iecode_json(&bytes).expect("relecture");
    assert_eq!(relu, iecode);
}

#[test]
fn un_parent_qui_n_est_pas_un_conteneur_est_refuse_et_non_vide_en_silence() {
    // Le cas qui a fait échouer la première version de ce test, et qui est la vraie contrainte du
    // format : `encode_t2b` n'écrit le sous-arbre que des nœuds nommés `_BEG`/`_BEGIN`/`PTREE`.
    // Un parent nommé autrement produisait un fichier bien formé auquel il manquait deux lignes.
    let iecode = serde_json::json!({
        "entries": [{
            "name": "RACINE_0",
            "variables": [{ "type": "Int", "value": "1" }],
            "children": [
                { "name": "LIGNE_0", "variables": [], "children": [] }
            ]
        }]
    });
    let erreur = cfgbin::encode_iecode_t2b(&iecode).expect_err("doit échouer");
    assert!(
        erreur.contains("RACINE") && erreur.contains("conteneur"),
        "message inattendu : {erreur}"
    );

    // Sans enfants, le même nom passe : la règle porte sur la perte d'information, pas sur le nom.
    let feuille = serde_json::json!({
        "entries": [{ "name": "RACINE_0", "variables": [{ "type": "Int", "value": "1" }], "children": [] }]
    });
    let bytes = cfgbin::encode_iecode_t2b(&feuille).expect("encodage");
    assert_eq!(
        cfgbin::t2b_to_iecode_json(&bytes).expect("relecture"),
        feuille
    );
}

#[test]
fn un_nom_finissant_par_des_chiffres_survit_a_l_aller_retour() {
    // `FOO_2` devient `FOO_2_0` en iecode ; l'inverse doit rendre `FOO_2`, pas `FOO`.
    let iecode = serde_json::json!({
        "entries": [{
            "name": "FOO_2_0",
            "variables": [{ "type": "Int", "value": "7" }],
            "children": []
        }]
    });
    let entries = cfgbin::iecode_json_to_t2b_entries(&iecode).expect("reconstruction");
    assert_eq!(entries[0].name, "FOO_2");

    let bytes = cfgbin::encode_iecode_t2b(&iecode).expect("encodage");
    assert_eq!(
        cfgbin::t2b_to_iecode_json(&bytes).expect("relecture"),
        iecode
    );
}

#[test]
fn une_variable_mal_formee_est_refusee_plutot_que_devinee() {
    // Une faute de frappe dans un JSON édité ne doit jamais produire un fichier valide en
    // apparence : le verrou V1 dit que le parseur du dépôt est plus permissif que le jeu, donc
    // c'est ici qu'il faut être strict.
    let sans_type = serde_json::json!({
        "entries": [{ "name": "A_0", "variables": [{ "value": "1" }], "children": [] }]
    });
    let erreur = cfgbin::encode_iecode_t2b(&sans_type).expect_err("doit échouer");
    assert!(erreur.contains("type"), "message inattendu : {erreur}");

    let type_inconnu = serde_json::json!({
        "entries": [{
            "name": "A_0",
            "variables": [{ "type": "Double", "value": "1" }],
            "children": []
        }]
    });
    let erreur = cfgbin::encode_iecode_t2b(&type_inconnu).expect_err("doit échouer");
    assert!(erreur.contains("Double"), "message inattendu : {erreur}");

    let entier_illisible = serde_json::json!({
        "entries": [{
            "name": "A_0",
            "variables": [{ "type": "Int", "value": "12x" }],
            "children": []
        }]
    });
    let erreur = cfgbin::encode_iecode_t2b(&entier_illisible).expect_err("doit échouer");
    assert!(erreur.contains("Int"), "message inattendu : {erreur}");

    let sans_entrees = serde_json::json!({ "lists": [] });
    let erreur = cfgbin::encode_iecode_t2b(&sans_entrees).expect_err("doit échouer");
    assert!(erreur.contains("entries"), "message inattendu : {erreur}");
}
