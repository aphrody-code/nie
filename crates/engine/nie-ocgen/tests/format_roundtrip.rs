//! The claim this crate rests on: a generated document is in the game's own format.
//!
//! The proof is a round trip. Every `CHARA_EDIT_PARAM` document in the checkout is parsed into the
//! crate's model and emitted again; the emitted JSON must equal the file, node for node, name for
//! name, variable for variable. A parser that silently dropped the trailing `SETTING` list, or an
//! emitter that numbered `_N` per group instead of per type, fails here rather than three stages
//! later inside a document nobody can load.

use std::path::{Path, PathBuf};

use nie_ocgen::param::CharaEditParam;
use serde_json::Value;

/// Directory holding the editor's shipped `CHARA_EDIT_PARAM` documents.
fn documents_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../data/common/chr/_test/default")
        .canonicalize()
        .expect("le dump data/common/chr/_test/default doit être présent")
}

/// Every `*.cfg.bin.json` of that directory, sorted.
fn documents() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(documents_dir())
        .expect("lecture du répertoire des documents")
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
fn tout_document_edit_param_fait_un_aller_retour_identique() {
    let paths = documents();
    // 16 presets `mdl_edit_avatar*`, 16 morphologies `mdl_editpreview_avatar*`, 1 gabarit.
    assert_eq!(paths.len(), 33, "33 documents attendus");
    let mut with_settings = 0;
    for path in paths {
        let bytes = std::fs::read(&path).expect("lecture du document");
        let original: Value = serde_json::from_slice(&bytes).expect("JSON du document");
        let parsed = CharaEditParam::parse(&original).expect("décodage CHARA_EDIT_PARAM");
        if parsed.settings.is_some() {
            with_settings += 1;
        }
        let emitted = parsed.to_value();
        assert_eq!(
            emitted,
            original,
            "aller-retour non identique pour {}",
            path.display()
        );
    }
    // The optional trailing list is what a naive model drops without noticing; 21 documents of
    // 33 carry one, so the count is worth asserting rather than the mere fact that it parses.
    assert_eq!(with_settings, 21, "21 documents portent une liste SETTING");
}

#[test]
fn le_gabarit_de_sauvegarde_porte_ce_que_la_mesure_annonce() {
    let path = documents_dir().join("edit_parameter.cfg.bin.json");
    let value: Value =
        serde_json::from_slice(&std::fs::read(path).expect("lecture")).expect("JSON");
    let document = CharaEditParam::parse(&value).expect("décodage");

    assert_eq!(document.list_flag, 1);
    assert_eq!(document.tex_parts.len(), 9, "9 couches de texture");
    assert_eq!(document.mdl_parts.len(), 9, "9 parts de modèle");
    assert_eq!(document.bones.len(), 6, "6 éditions d'os");
    assert!(
        document.settings.is_none(),
        "le gabarit de sauvegarde ne porte pas de liste SETTING"
    );

    let colors: usize = document
        .tex_parts
        .iter()
        .map(|part| {
            part.colors.len() + part.mirror.as_ref().map_or(0, |mirror| mirror.colors.len())
        })
        .sum();
    assert_eq!(colors, 31, "31 lignes de couleur au total");

    let mirrored = document
        .tex_parts
        .iter()
        .filter(|part| part.mirror.is_some())
        .count();
    assert_eq!(mirrored, 4, "4 couches ont une moitié miroir");
}

#[test]
fn une_morphologie_porte_une_liste_setting_et_le_gabarit_non() {
    let path = documents_dir().join("mdl_editpreview_avatar_tall01.cfg.bin.json");
    let value: Value =
        serde_json::from_slice(&std::fs::read(path).expect("lecture")).expect("JSON");
    let document = CharaEditParam::parse(&value).expect("décodage");

    let settings = document
        .settings
        .as_ref()
        .expect("une morphologie porte la liste SETTING");
    assert_eq!(settings.len(), 1);
    assert_eq!(settings[0].key, -1_694_245_095);
    assert_eq!(settings[0].value, 0);
    assert_eq!(document.bones.len(), 8, "8 éditions d'os");
    assert_eq!(
        document
            .mdl_parts
            .iter()
            .find(|part| part.resource.starts_with("body_type_"))
            .map(|part| part.resource.as_str()),
        Some("body_type_05")
    );
}
