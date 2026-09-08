//! Resolver behavior plus opt-in checks against the real, untracked resolved catalogue.

use nie_data::avatar::{
    AvatarCatalog, AvatarPreset, AvatarRecipeEntry, AvatarResolveError, AvatarState,
    AvatarWarningCode, resolve_avatar,
};
use serde_json::json;

fn catalog() -> AvatarCatalog {
    serde_json::from_value(json!({
        "source": "test fixture",
        "categories": [
            {"faceSettingType": 17, "parts": [
                {"id":"body-small", "resource":"edit_body_small", "modeles2":["data/common/chr/_face/20_EDIT/_bodySK/sk_small/sk_small.g4sk"]},
                {"id":"body-male", "resource":"edit_body_male", "modeles2":["data/common/chr/_face/20_EDIT/_bodySK/sk_male/sk_male.g4sk"]},
                {"id":"body-female", "resource":"edit_body_female", "modeles2":["data/common/chr/_face/20_EDIT/_bodySK/sk_female/sk_female.g4sk"]}
            ]},
            {"faceSettingType": 9, "parts": [
                {"id":"D64E1016", "itemNo":1}, {"id":"4F4741AC", "itemNo":2}
            ]},
            {"faceSettingType": 4, "parts": [
                {"id":"hair-pair", "modeles":["data/common/chr/_face/20_EDIT/_hairF/front.g4md"], "modeles2":["data/common/chr/_face/20_EDIT/_hairB/back.g4md"]},
                {"id":"hair-back-only", "modeles2":["data/common/chr/_face/20_EDIT/_hairB/back_only.g4md"]}
            ], "couleurs":["hair-color"]},
            {"faceSettingType": 3, "parts": [{"id":"skin", "modeles":["data/dx11/chr/_face/20_EDIT/_facetex/00_face/skin.g4tx"]}], "couleurs":["skin-color"]},
            {"faceSettingType": 6, "parts": [{"id":"eye", "modeles":["data/dx11/chr/_face/20_EDIT/_facetex/01_eye/eye.g4tx"]}], "couleurs":["eye-color"]},
            {"faceSettingType": 13, "parts": [{"id":"skin-duplicate", "modeles":["data/dx11/chr/_face/20_EDIT/_facetex/00_face/skin.g4tx"]}], "couleurs":[]},
            {"faceSettingType": 1, "parts": [{"id":"preset"}]},
            {"faceSettingType": 2, "parts": [{"id":"shape"}]},
            {"faceSettingType": 19, "parts": [{"id":"collar"}]}
        ],
        "modelesDeBase": {"morphologies":["male","female","small"], "visages":[
            {"noseType":"nose_type_02", "resources":["male_nose2","female_nose2","small_nose2"]},
            {"noseType":"nose_type_01", "resources":["male_nose1","female_nose1","small_nose1"]}
        ]},
        "couleursRgb": {
            "skin-color":{"rgb":"aabbcc","alpha":255}, "eye-color":{"rgb":"123456","alpha":255},
            "hair-color":{"rgb":"556677","alpha":255}
        }
    })).unwrap()
}

#[test]
fn gender_and_explicit_morphology_use_the_same_body_and_head_index() {
    let catalog = catalog();
    let mut state = AvatarState {
        gender: 1,
        ..AvatarState::default()
    };
    let female = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(
        (
            female.morphology.as_str(),
            female.morphology_index,
            female.skeleton.as_str()
        ),
        ("female", 1, "sk_female")
    );
    assert_eq!(female.pieces[1].name, "female_nose1");
    state.gender = 0;
    state.selections.insert(17, "body-small".into());
    let small = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(
        (
            small.morphology.as_str(),
            small.morphology_index,
            small.skeleton.as_str()
        ),
        ("small", 2, "sk_small")
    );
    assert_eq!(small.pieces[1].name, "small_nose1");
}

#[test]
fn selection_ids_survive_category_part_and_face_list_reordering() {
    let mut catalog = catalog();
    let mut state = AvatarState::default();
    state.selections.insert(9, "4F4741AC".into());
    state.selections.insert(4, "hair-back-only".into());
    let expected = resolve_avatar(&catalog, &state).unwrap();
    catalog.categories.reverse();
    for category in &mut catalog.categories {
        category.parts.reverse();
    }
    catalog.base_models.faces.reverse();
    let actual = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(actual.pieces[1].name, "male_nose2");
    assert_eq!(actual.pieces[1], expected.pieces[1]);
    assert!(actual.pieces.iter().any(|p| p.name == "back_only"));
    assert!(!actual.pieces.iter().any(|p| p.name == "front"));
}

#[test]
fn composition_preserves_secondary_hair_and_deduplicates_sorted_face_layers() {
    let result = resolve_avatar(&catalog(), &AvatarState::default()).unwrap();
    assert_eq!(
        result
            .pieces
            .iter()
            .map(|p| p.name.as_str())
            .collect::<Vec<_>>(),
        ["sk_male", "male_nose1", "front", "back"]
    );
    assert_eq!(result.face_layers, ["00_face/skin", "01_eye/eye"]);
    assert!(
        result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnverifiedDefaultPart && w.category == Some(4))
    );
    assert!(!result.warnings.iter().any(|w| w.category == Some(17)));
}

#[test]
fn custom_colors_override_palettes_and_missing_measured_rgb_is_explicit() {
    let mut catalog = catalog();
    let mut state = AvatarState {
        height: Some(14),
        ..AvatarState::default()
    };
    state.palette_selections.extend([(3, 0), (4, 0), (6, 0)]);
    state.custom_colors.insert(4, "bc1234".into());
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(
        (
            result.skin_color.as_deref(),
            result.iris_color.as_deref(),
            result.hair_color.as_deref()
        ),
        (Some("AABBCC"), Some("123456"), Some("BC1234"))
    );
    assert_eq!(result.height, Some(14));
    catalog.palette_colors.remove("skin-color");
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(result.skin_color, None);
    assert!(
        result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnresolvedPaletteColor && w.category == Some(3))
    );
}

#[test]
fn invalid_explicit_settings_do_not_fall_back_to_a_different_avatar() {
    let catalog = catalog();
    let cases = [
        AvatarState {
            gender: 2,
            ..AvatarState::default()
        },
        AvatarState {
            morphology: 99,
            ..AvatarState::default()
        },
        AvatarState {
            height: Some(15),
            ..AvatarState::default()
        },
        AvatarState {
            selections: [(4, "missing".into())].into(),
            ..AvatarState::default()
        },
        AvatarState {
            selections: [(999, "missing".into())].into(),
            ..AvatarState::default()
        },
        AvatarState {
            palette_selections: [(3, 10)].into(),
            ..AvatarState::default()
        },
        AvatarState {
            custom_colors: [(4, "FF0000&evil=1".into())].into(),
            ..AvatarState::default()
        },
    ];
    for state in cases {
        assert!(
            resolve_avatar(&catalog, &state).is_err(),
            "invalid state accepted: {state:?}"
        );
    }
}

#[test]
fn unsafe_catalogue_paths_and_ambiguous_ids_are_rejected() {
    for path in [
        "data/common/chr/_face/20_EDIT/_hairF/../front.g4md",
        "data/common/chr/_face/20_EDIT/_hairF/front.g4md?x=1",
        "https://example.invalid/front.g4md",
        "data/common/chr/_face/20_EDIT/_hairF/nested/front.g4md",
    ] {
        let mut catalog = catalog();
        catalog
            .categories
            .iter_mut()
            .find(|c| c.setting_type == 4)
            .unwrap()
            .parts[0]
            .models = vec![path.into()];
        assert!(matches!(
            resolve_avatar(&catalog, &AvatarState::default()),
            Err(AvatarResolveError::InvalidResource { .. })
        ));
    }
    let mut catalog = catalog();
    catalog.categories.push(catalog.categories[0].clone());
    assert!(matches!(
        resolve_avatar(&catalog, &AvatarState::default()),
        Err(AvatarResolveError::InvalidCatalog { .. })
    ));
}

#[test]
fn unknown_face_mapping_is_not_silently_replaced_by_the_first_head() {
    let mut catalog = catalog();
    catalog
        .base_models
        .faces
        .retain(|f| f.nose_type != "nose_type_01");
    assert!(matches!(
        resolve_avatar(&catalog, &AvatarState::default()),
        Err(AvatarResolveError::MissingResource { .. })
    ));
}

#[test]
fn ambiguous_native_face_groups_keep_the_legacy_default_with_an_explicit_warning() {
    let mut catalog = catalog();
    let mut alternative = catalog.base_models.faces[1].clone();
    alternative.resources[0] = "unresolved_face_variant".into();
    catalog.base_models.faces.push(alternative);
    let result = resolve_avatar(&catalog, &AvatarState::default()).unwrap();
    assert_eq!(result.pieces[1].name, "male_nose1");
    assert!(
        result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnresolvedFaceVariant && w.category == Some(2))
    );
}

#[test]
fn unsupported_presets_and_approximate_deformations_do_not_change_geometry() {
    let catalog = catalog();
    let baseline = resolve_avatar(&catalog, &AvatarState::default()).unwrap();
    let state = AvatarState {
        selections: [
            (1, "preset".into()),
            (2, "shape".into()),
            (19, "collar".into()),
        ]
        .into(),
        ..AvatarState::default()
    };
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert_eq!(result.pieces, baseline.pieces);
    for setting in [2, 19] {
        assert!(result.warnings.iter().any(
            |w| w.code == AvatarWarningCode::UnsupportedSetting && w.category == Some(setting)
        ));
    }
    assert!(
        result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnresolvedPresetRecipe)
    );
    let json = serde_json::to_value(&result).unwrap();
    assert!(json.get("faceShape").is_none());
    assert!(json.get("clothingCuts").is_none());
}

#[test]
fn native_preset_ids_select_exact_parts_and_manual_choices_override_the_recipe() {
    let mut catalog = catalog();
    let preset_part = &mut catalog
        .categories
        .iter_mut()
        .find(|c| c.setting_type == 1)
        .unwrap()
        .parts[0];
    preset_part.resource = "preset_fixture".into();
    let preset_id = format!(
        "{:08X}",
        nie_data::unlock_condition::crc32_str(&preset_part.resource)
    );
    let hair = catalog
        .categories
        .iter_mut()
        .find(|c| c.setting_type == 4)
        .unwrap();
    hair.parts[0].id = "AAAABBBB".into();
    hair.parts[1].id = "CCCCDDDD".into();
    catalog.presets.push(AvatarPreset {
        id: preset_id,
        recipe: vec![AvatarRecipeEntry {
            slot: 11,
            value: 0,
            color: -1,
            part: Some("ambiguous_name".into()),
            part_id: Some("CCCCDDDD".into()),
        }],
    });
    let mut state = AvatarState {
        selections: [(1, "preset".into())].into(),
        ..AvatarState::default()
    };
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert!(result.pieces.iter().any(|p| p.name == "back_only"));
    assert!(!result.pieces.iter().any(|p| p.name == "front"));
    assert!(
        !result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnresolvedPresetRecipe)
    );
    state.selections.insert(4, "AAAABBBB".into());
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert!(result.pieces.iter().any(|p| p.name == "front"));
    assert!(!result.pieces.iter().any(|p| p.name == "back_only"));
}

#[test]
fn state_json_and_composition_use_the_same_contract_for_every_binding() {
    let state: AvatarState = serde_json::from_value(json!({"gender":1,"morphology":0,"height":7,"selections":{"4":"hair-pair"},"customColors":{"4":"aabbcc"}})).unwrap();
    let result = serde_json::to_value(resolve_avatar(&catalog(), &state).unwrap()).unwrap();
    assert_eq!(result["morphologyIndex"], 1);
    assert_eq!(result["hairColor"], "AABBCC");
    assert_eq!(result["faceLayers"][0], "00_face/skin");
    assert!(
        result["warnings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|w| w["code"] == "unverified_default_part")
    );
}

#[test]
#[ignore = "Requires NIE_AVATAR_CATALOG pointing at the real, untracked resolved catalogue"]
fn real_catalogue_resolves_all_eight_morphologies_and_seven_noses() {
    let path = std::env::var("NIE_AVATAR_CATALOG")
        .expect("Set NIE_AVATAR_CATALOG to the existing resolved catalogue");
    let bytes = std::fs::read(path).unwrap();
    let catalog: AvatarCatalog = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(catalog.categories.len(), 20);
    assert_eq!(
        catalog
            .categories
            .iter()
            .map(|c| c.parts.len())
            .sum::<usize>(),
        502
    );
    assert_eq!(catalog.base_models.morphologies.len(), 8);
    let noses = catalog
        .categories
        .iter()
        .find(|c| c.setting_type == 9)
        .unwrap();
    assert_eq!(noses.parts.len(), 7);
    let mut measured = 0;
    let mut unresolved_face_variants = 0;
    for (morphology, name) in catalog.base_models.morphologies.iter().enumerate() {
        for nose in &noses.parts {
            let state = AvatarState {
                morphology,
                gender: u8::from(name == "female"),
                selections: [(9, nose.id.clone())].into(),
                ..AvatarState::default()
            };
            let result = resolve_avatar(&catalog, &state).unwrap();
            assert_eq!(result.morphology, *name);
            assert_eq!(result.morphology_index, morphology);
            assert_eq!(result.pieces[0].directory, "_bodySK");
            assert_eq!(result.pieces[1].directory, "_facebase");
            assert!(
                result.pieces[1]
                    .name
                    .ends_with(&format!("nose{:02}", nose.item_no))
            );
            assert!(result.pieces.iter().any(|p| p.directory == "_hairF"));
            assert!(result.pieces.iter().any(|p| p.directory == "_hairB"));
            assert_eq!(result.face_layers.len(), 6);
            unresolved_face_variants += usize::from(
                result
                    .warnings
                    .iter()
                    .any(|w| w.code == AvatarWarningCode::UnresolvedFaceVariant),
            );
            measured += 1;
        }
    }
    assert_eq!(measured, 56);
    assert_eq!(unresolved_face_variants, 28);
    eprintln!("Measured {measured} compositions from 502 parts, 8 morphologies and 7 noses");
}

#[test]
#[ignore = "Requires NIE_AVATAR_CATALOG with exact partId fields and the local native chara_edit fixture"]
fn real_presets_keep_all_native_part_ids_and_preset_01_changes_the_composition() {
    use nie_data::{chara_edit::parse_chara_edit, hash::HashId};
    let catalog: AvatarCatalog = serde_json::from_slice(
        &std::fs::read(std::env::var("NIE_AVATAR_CATALOG").unwrap()).unwrap(),
    )
    .unwrap();
    let raw_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../data/common/gamedata/character/chara_edit_1.03.75.00.cfg.bin.json");
    let raw = parse_chara_edit(&serde_json::from_slice(&std::fs::read(raw_path).unwrap()).unwrap());
    let mut links = 0;
    let mut rows = 0;
    for preset in &catalog.presets {
        let native = raw.recipe_of(HashId::parse_hex(&preset.id).unwrap());
        assert_eq!(preset.recipe.len(), native.len());
        for (entry, source) in preset.recipe.iter().zip(native) {
            assert_eq!(entry.slot as i64, source.recipe_type);
            assert_eq!(entry.value, source.recipe_no);
            assert_eq!(entry.color, source.color_value);
            assert_eq!(
                entry.part_id.as_deref().and_then(HashId::parse_hex),
                (!source.parts_id.is_zero()).then_some(source.parts_id)
            );
            links += usize::from(entry.part_id.is_some());
            rows += 1;
        }
    }
    assert_eq!((catalog.presets.len(), rows, links), (38, 2704, 304));
    let preset_part = catalog
        .categories
        .iter()
        .find(|c| c.setting_type == 1)
        .unwrap()
        .parts
        .iter()
        .find(|p| p.resource == "preset_01_normal")
        .unwrap();
    let state = AvatarState {
        selections: [(1, preset_part.id.clone())].into(),
        ..AvatarState::default()
    };
    let result = resolve_avatar(&catalog, &state).unwrap();
    assert!(
        result
            .pieces
            .iter()
            .any(|p| p.directory == "_hairB" && p.name == "hairB003")
    );
    assert!(
        result
            .face_layers
            .contains(&"02_pupil/pupil_05".to_string())
    );
    assert!(
        result
            .face_layers
            .contains(&"04_eyebrow/eyebrow_01".to_string())
    );
    assert!(
        !result
            .warnings
            .iter()
            .any(|w| w.code == AvatarWarningCode::UnresolvedPresetRecipe)
    );
    eprintln!(
        "Verified {links} exact native part links in {rows} rows / 38 presets; preset_01 applies hair, pupil and eyebrow resources"
    );
}
