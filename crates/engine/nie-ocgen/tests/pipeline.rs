//! The chain, end to end, on the character the recipe was written for.
//!
//! `data/oc/astro-lor/source/` holds the author's own artwork and is not versioned, so the tests
//! that need pixels skip themselves when it is absent instead of failing a clone that never had
//! it. Everything that does not need pixels — the tables, the morphology catalogue, the slot
//! survey — runs unconditionally.

use std::path::{Path, PathBuf};

use nie_ocgen::{
    morphology::{Build, Gender, MorphologyQuery, Stature},
    palette::{Probe, Rect, Rejection, Sheet, measure_one},
    recipe::{Recipe, survey_slots},
    sources::EditorSources,
};

/// Repository root, from this crate's manifest.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("racine du dépôt")
}

/// The decoded game-data root.
fn dump_root() -> PathBuf {
    repo_root().join("data")
}

#[test]
fn le_catalogue_de_morphologies_couvre_les_seize_documents() {
    let sources = EditorSources::load(&dump_root()).expect("chargement des tables de l'éditeur");
    assert_eq!(
        sources.morphologies.entries.len(),
        16,
        "seize documents mdl_editpreview_avatar_*"
    );
    assert_eq!(sources.catalog_version, "1.03.75.00");
    assert_eq!(
        sources.catalog.parts.len(),
        502,
        "502 parts sélectionnables"
    );

    // Two file names can share one body type; a name-based mapping would hide it.
    let tall = sources
        .morphologies
        .by_stem("mdl_editpreview_avatar_tall01")
        .expect("tall01");
    let tall_female = sources
        .morphologies
        .by_stem("mdl_editpreview_avatar_tallfemale01")
        .expect("tallfemale01");
    assert_eq!(tall.body_type, "body_type_05");
    assert_eq!(tall_female.body_type, "body_type_05");
    assert_eq!(tall.gender, None, "« tall » ne dit rien du genre");
    assert_eq!(tall_female.gender, Some(Gender::Female));
}

#[test]
fn la_selection_par_traits_est_deterministe() {
    let sources = EditorSources::load(&dump_root()).expect("chargement");
    let query = MorphologyQuery {
        gender: Gender::Male,
        stature: Stature::Tall,
        build: Build::Normal,
    };
    let first = sources.morphologies.select(&query).expect("sélection");
    let second = sources.morphologies.select(&query).expect("sélection");
    assert_eq!(first.stem, second.stem);
    assert_eq!(
        first.stem, "mdl_editpreview_avatar_tall01",
        "163 cm et une carrure fine tombent sur tall01"
    );

    let small = MorphologyQuery {
        gender: Gender::Female,
        stature: Stature::Small,
        build: Build::Fat,
    };
    let picked = sources.morphologies.select(&small).expect("sélection");
    assert_eq!(picked.stem, "mdl_editpreview_avatar_smallfatfemale01");
}

#[test]
fn le_releve_des_slots_de_couleur_retrouve_les_trois_slots_mesures() {
    let sources = EditorSources::load(&dump_root()).expect("chargement");
    let survey = survey_slots(&sources);
    assert_eq!(survey.documents, 17, "16 morphologies plus le gabarit");
    assert_eq!(
        survey.slots.len(),
        3,
        "trois slots de couleur, pas un de plus"
    );

    let base = survey
        .slots
        .iter()
        .find(|slot| slot.slot == -94_281_841)
        .expect("le slot de base");
    assert_eq!(
        base.documents, 17,
        "le slot de base est présent dans tous les documents"
    );
    // What identifies this slot as the skin slot is not one value but the shape of the set: each
    // document loads it with its own skin tone, and every one of them is a warm, light, low-chroma
    // colour. A slot holding flat white or a saturated hue would not pass this.
    assert!(
        base.colors.len() >= 4,
        "plusieurs teints attendus : {:?}",
        base.colors
    );
    for hex in &base.colors {
        let lab = nie_ocgen::palette::oklab(parse_hex(hex));
        assert!(
            lab[0] > 0.55 && lab[1] > 0.0 && lab[2] > 0.0,
            "{hex} n'est pas un teint clair et chaud : Oklab {lab:?}"
        );
    }

    // On one document taken alone, every row of that slot holds the same tone: the slot carries a
    // character's skin, not a per-layer colour.
    let tall = sources
        .morphologies
        .by_stem("mdl_editpreview_avatar_tall01")
        .expect("tall01");
    let rows: Vec<[i64; 4]> = tall
        .document
        .tex_parts
        .iter()
        .flat_map(|part| {
            part.colors
                .iter()
                .chain(part.mirror.iter().flat_map(|mirror| mirror.colors.iter()))
        })
        .filter(|row| row.slot == -94_281_841)
        .map(|row| row.rgba)
        .collect();
    assert_eq!(rows.len(), 13, "13 lignes portent le slot de base");
    for row in &rows {
        assert_eq!(
            [row[0], row[1], row[2]],
            [244, 227, 200],
            "toutes les lignes portent le même teint"
        );
    }
}

/// Reads `#rrggbb` back into channels, for the assertions above.
fn parse_hex(hex: &str) -> [u8; 3] {
    let digits = hex.trim_start_matches('#');
    let byte = |index: usize| {
        u8::from_str_radix(&digits[index..index + 2], 16).expect("couple hexadécimal")
    };
    [byte(0), byte(2), byte(4)]
}

/// Every recipe Astro Lor carries, one per internal code.
fn recettes_astro_lor() -> Vec<(String, Recipe)> {
    let dir = repo_root().join("data/oc/astro-lor/game");
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("lecture du dossier game")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("3d-recipe") && name.ends_with(".json"))
        })
        .collect();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let bytes = std::fs::read(&path).expect("lecture de la recette");
            let recipe = serde_json::from_slice(&bytes).expect("décodage de la recette");
            (name, recipe)
        })
        .collect()
}

#[test]
fn les_deux_variantes_dastro_lor_ont_chacune_leur_recette() {
    // Le personnage existe à deux époques, dessinées dix ans d'écart avec des kits différents :
    // une seule recette produirait la moitié d'Astro Lor sans que rien ne le signale.
    let recettes = recettes_astro_lor();
    assert_eq!(recettes.len(), 2, "une recette par code interne");

    let mut codes: Vec<&str> = recettes
        .iter()
        .map(|(_, recipe)| recipe.internal_code.as_str())
        .collect();
    codes.sort_unstable();
    assert_eq!(codes, ["c99019010", "c99019020"]);

    for (name, recipe) in &recettes {
        assert_eq!(recipe.slug, "astro-lor", "{name}");
        assert!(!recipe.probes.is_empty(), "{name} : aucune sonde");
        assert!(!recipe.colors.is_empty(), "{name} : aucune liaison");
        assert_eq!(recipe.icons.len(), 1, "{name} : une icône par variante");
        assert_eq!(
            recipe.icons[0].internal_code, recipe.internal_code,
            "{name} : l'icône doit porter le code de sa recette"
        );

        // Toute liaison doit viser un rôle réellement mesuré, sinon la couleur n'arrive jamais.
        let roles: Vec<&str> = recipe
            .probes
            .iter()
            .map(|probe| probe.role.as_str())
            .collect();
        for binding in &recipe.colors {
            assert!(
                roles.contains(&binding.role.as_str()),
                "{name} : la liaison « {} » ne correspond à aucune sonde",
                binding.role
            );
        }
        for attendu in ["skin", "hair_pale", "jersey_primary"] {
            assert!(roles.contains(&attendu), "{name} : rôle {attendu} attendu");
        }
    }

    // Les deux variantes ne mesurent pas les mêmes planches : les kits diffèrent.
    let planches: Vec<std::collections::BTreeSet<&str>> = recettes
        .iter()
        .map(|(_, recipe)| {
            recipe
                .probes
                .iter()
                .map(|probe| probe.sheet.as_str())
                .collect()
        })
        .collect();
    assert!(
        planches[0].is_disjoint(&planches[1]),
        "chaque variante a ses propres planches : {planches:?}"
    );
}

#[test]
fn une_sonde_sur_du_papier_echoue_au_lieu_de_rendre_du_blanc() {
    // A uniform sheet of the paper the sheets are drawn on: light, neutral, nothing to measure.
    let sheet = Sheet {
        name: "papier".to_string(),
        width: 64,
        height: 64,
        rgb: vec![236; 64 * 64 * 3],
    };
    let probe = Probe {
        role: "peau".to_string(),
        sheet: "papier".to_string(),
        rect: Rect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    };
    let error = measure_one(&probe, &sheet, Rejection::default())
        .expect_err("une sonde sur le fond doit échouer");
    assert!(
        error.to_string().contains("rejet de fond"),
        "message inattendu : {error}"
    );
}

/// Paper colour of the astro-lor sheets, measured on their margin.
const PAPER: [u8; 3] = [236, 232, 230];

/// A sheet of paper carrying one painted rectangle in its middle half.
///
/// The margin matters: the background is measured off the sheet's own corners, so a synthetic
/// sheet with no paper around the paint would have its paint measured as the background and then
/// rejected. Real sheets always have a margin; a fixture without one tests nothing real.
fn painted_sheet(name: &str, size: u32, paint: [u8; 3], stripe: Option<[u8; 3]>) -> Sheet {
    let mut rgb = Vec::with_capacity((size * size * 3) as usize);
    for y in 0..size {
        for x in 0..size {
            let inside = x >= size / 4 && x < size * 3 / 4 && y >= size / 4 && y < size * 3 / 4;
            let colour = match (inside, stripe) {
                (false, _) => PAPER,
                (true, Some(other)) if (x + y) % 3 == 1 => other,
                (true, _) => paint,
            };
            rgb.extend_from_slice(&colour);
        }
    }
    Sheet {
        name: name.to_string(),
        width: size,
        height: size,
        rgb,
    }
}

/// A probe over the painted middle half.
fn middle_probe(role: &str, sheet: &str) -> Probe {
    Probe {
        role: role.to_string(),
        sheet: sheet.to_string(),
        rect: Rect {
            x: 0.3,
            y: 0.3,
            w: 0.4,
            h: 0.4,
        },
    }
}

#[test]
fn une_sonde_sur_un_aplat_rend_exactement_cet_aplat() {
    let sheet = painted_sheet("aplat", 64, [31, 127, 208], None);
    let swatch = measure_one(
        &middle_probe("maillot", "aplat"),
        &sheet,
        Rejection::default(),
    )
    .expect("mesure");
    assert_eq!(swatch.rgb, [31, 127, 208]);
    assert_eq!(swatch.hex, "#1f7fd0");
    assert_eq!(swatch.background, "#ece8e6", "le fond mesuré est le papier");
    assert!(
        (swatch.share - 1.0).abs() < 1e-6,
        "un aplat est un seul groupe : {}",
        swatch.share
    );
    assert!(
        swatch.spread < 1e-6,
        "écart nul attendu : {}",
        swatch.spread
    );
    assert_eq!(swatch.kept, swatch.sampled, "aucun pixel rejeté");
}

#[test]
fn un_creme_aussi_clair_que_le_papier_survit_au_rejet_de_fond() {
    // The regression that a generic "light and unsaturated is paper" threshold caused: Astro Lor's
    // palest hair sits one hundredth of Oklab away from the paper, and the threshold ate it, after
    // which the probe returned the ink outline. The background is now measured, not assumed.
    let cream = [252, 233, 223];
    let sheet = painted_sheet("creme", 64, cream, None);
    let swatch = measure_one(
        &middle_probe("cheveux", "creme"),
        &sheet,
        Rejection::default(),
    )
    .expect("mesure");
    assert_eq!(swatch.rgb, cream, "le crème pâle n'est pas du papier");

    // And the difference the rejection has to see really is that small.
    let ecart = {
        let (a, b) = (
            nie_ocgen::palette::oklab(cream),
            nie_ocgen::palette::oklab(PAPER),
        );
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    assert!(
        ecart < 0.03,
        "crème et papier sont censés être très proches : {ecart}"
    );
}

#[test]
fn deux_passes_sur_la_meme_region_rendent_la_meme_couleur() {
    // Determinism is not a nicety here: a run report is evidence, and evidence that moves between
    // two runs on the same pixels is not evidence.
    let sheet = painted_sheet("mixte", 80, [31, 127, 208], Some([240, 160, 30]));
    let probe = middle_probe("mixte", "mixte");
    let first = measure_one(&probe, &sheet, Rejection::default()).expect("mesure");
    let second = measure_one(&probe, &sheet, Rejection::default()).expect("mesure");
    assert_eq!(first.rgb, second.rgb);
    assert_eq!(first.share, second.share);
    assert_eq!(
        first.rgb,
        [31, 127, 208],
        "le bleu occupe les deux tiers de la région"
    );
}

#[test]
fn le_document_genere_devient_un_cfgbin_que_le_depot_relit() {
    // La moitié du verrou V1 qui ne demande pas le jeu : le dépôt écrit un T2B qu'il relit à
    // l'identique. Ce que ce test n'établit pas, et qu'aucun test d'ici ne peut établir : que le
    // jeu accepte le fichier — son parseur est plus strict que celui du dépôt.
    let sources = EditorSources::load(&dump_root()).expect("chargement");
    let morphologie = sources
        .morphologies
        .by_stem("mdl_editpreview_avatar_tall01")
        .expect("tall01");

    let bytes = morphologie.document.to_cfgbin().expect("encodage T2B");
    assert!(bytes.len() > 2048, "{} octets, trop peu", bytes.len());
    let relu = nie_ocgen::param::CharaEditParam::from_cfgbin(&bytes).expect("relecture");
    assert_eq!(relu, morphologie.document, "aller-retour binaire rompu");
    assert_eq!(
        relu.settings.as_ref().map(Vec::len),
        Some(1),
        "la liste SETTING survit au passage en binaire"
    );
}

#[test]
fn la_chaine_complete_tourne_quand_les_originaux_sont_la() {
    let oc_root = repo_root().join("data/oc/astro-lor");
    if !oc_root.join("source/sheets/03-og-anatomy.jpg").exists() {
        eprintln!("source/ absent (originaux non versionnés) : test ignoré");
        return;
    }
    let recipe: Recipe = serde_json::from_slice(
        &std::fs::read(oc_root.join("game/3d-recipe.json")).expect("lecture de la recette"),
    )
    .expect("décodage de la recette");

    let (report, generated) =
        nie_ocgen::run(&dump_root(), &oc_root, &recipe).expect("exécution de la chaîne");

    assert_eq!(report.slug, "astro-lor");
    assert_eq!(report.swatches.len(), recipe.probes.len());
    assert_eq!(report.morphology_stem, "mdl_editpreview_avatar_tall01");
    assert_eq!(report.body_type, "body_type_05");
    assert!(
        !report.applied.is_empty(),
        "la génération doit avoir changé quelque chose"
    );

    // The generated document must still be a document: it re-emits and re-parses unchanged.
    let value = generated.document.to_value();
    let reparsed = nie_ocgen::param::CharaEditParam::parse(&value).expect("relecture");
    assert_eq!(reparsed, generated.document);

    // And it must differ from its starting point exactly where a measurement said so.
    let sources = EditorSources::load(&dump_root()).expect("chargement");
    let start = &sources
        .morphologies
        .by_stem(&report.morphology_stem)
        .expect("morphologie de départ")
        .document;
    assert_ne!(&generated.document, start, "le document a été modifié");
    assert_eq!(generated.document.bones, start.bones, "aucun os touché");
    assert_eq!(
        generated.document.tex_parts.len(),
        start.tex_parts.len(),
        "aucune couche ajoutée ni retirée"
    );

    // Roles measured with nowhere to go are reported, not dropped.
    assert!(
        generated.unbound_roles.contains(&"jersey_trim".to_string()),
        "le liseré doré n'a pas de slot : {:?}",
        generated.unbound_roles
    );
}
