//! Le layout d'un écran de menu, construit depuis les octets du jeu.
//!
//! ## Pourquoi ce module existe
//!
//! Cette construction vivait dans `crates/tools/nie-site/src/routes/menu.rs`, où elle lisait un
//! [`crate::vfs::Vfs`] monté et un index de chemins propres au service. Le navigateur ne pouvait
//! donc pas la faire : il DEMANDAIT le layout au serveur, et recevait un verdict — la même
//! situation que le compositeur avant son extraction dans [`crate::menu_layout`], et pour la même
//! raison, un hôte cablé en dur.
//!
//! Ici la lecture passe par [`MenuSource`], que l'appelant implémente : sur `nie-site` c'est le
//! VFS, dans la page c'est une table d'octets déjà téléchargés depuis `/f/{path}`. Le résultat
//! est identique octet pour octet — c'est le MÊME code — donc le site et la page ne peuvent plus
//! diverger sur ce que « l'écran contient ».
//!
//! ## Ce que ce module N'INVENTE pas
//!
//! - Un objet dont aucun `.g4pkm` ne donne la pose sort avec `transform: null` et
//!   `placementSource: "unresolved"`. Il n'est pas centré par défaut : une position inventée se
//!   lirait comme une position mesurée.
//! - Un texte dont le hash n'est pas dans `menu_text` reste absent. Le slot n'est pas rempli
//!   avec son identifiant.
//! - `visible` reste `null` pour tout objet que l'appelant n'a pas résolu. « On ne sait pas »
//!   n'est pas « invisible », et c'est ce qui sépare « cet écran contient ceci » de « le jeu
//!   affiche ceci ».

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::String;

use alloc::vec;
use alloc::vec::Vec;

use serde_json::{Value, json};

use crate::menu as placement;
use crate::{cfgbin, g4pkm, g4tx, objbin};

/// D'où viennent les octets d'un chemin du jeu.
///
/// Deux méthodes, parce que le jeu adresse ses compagnons par un nom LOGIQUE
/// (`chara_bank_menu.g4pkm`) et non par un chemin : la résolution dépend du montage, elle
/// appartient donc à l'hôte, pas à ce module.
pub trait MenuSource {
    /// Les octets d'un chemin, ou `None` quand ce montage ne le porte pas.
    fn read(&self, path: &str) -> Option<Vec<u8>>;
    /// Le chemin réel d'un compagnon désigné par son nom logique.
    fn resolve_companion(&self, logical: &str) -> Option<String>;
}

/// Un calque déclaré par le `_setting.cfg.bin` de l'écran.
#[derive(Debug, Clone)]
pub struct ScreenItem {
    /// Le nom du calque, tel que le `_setting.cfg.bin` le déclare.
    pub layer: String,
    /// Le chemin de son `.objbin`, ou `None` s'il manque à ce montage.
    pub objbin: Option<String>,
}

/// Ce qu'il faut savoir d'un écran avant d'en construire le layout.
#[derive(Debug, Clone)]
pub struct ScreenSpec {
    /// Le nom de l'écran (`chara_bank_menu`).
    pub screen: String,
    /// Le chemin de son conteneur, recopié dans `source.cfg` du résultat.
    pub cfg: String,
    /// Le canvas de référence, tel que le jeu le déclare.
    pub canvas: [u32; 2],
    /// Les calques, dans l'ordre du fichier.
    pub items: Vec<ScreenItem>,
    /// Les calques déclarés dont l'`.objbin` manque à ce montage.
    pub layers_missing: Vec<String>,
}

/// Le nom logique du compagnon texture d'un objet.
fn texture_logical_path(object: &objbin::MenuObject) -> Option<String> {
    object.g4tx_path.clone().or_else(|| {
        object
            .g4pkm_path
            .as_deref()
            .and_then(|path| path.rsplit('/').next())
            .and_then(|name| name.strip_suffix(".g4pkm"))
            .map(|stem| format!("{stem}.g4tx"))
    })
}

/// N'écrit que les composantes d'une transformation qu'une donnée analysée porte réellement.
///
/// Un `CMenuAttachLocator` prouve la POSITION d'une instance ; il ne prouve ni son échelle, ni sa
/// rotation, ni son ancre. Ces composantes restent `null` au lieu de devenir silencieusement une
/// transformation identité au centre du canvas.
fn serialize_transform(
    transform: Option<placement::ScreenTransform>,
    attach_position: Option<(f32, f32)>,
) -> Value {
    match (transform, attach_position) {
        (None, None) => Value::Null,
        (Some(transform), position) => {
            let (x, y) = position.unwrap_or((transform.x_px, transform.y_px));
            json!({
                "x": x,
                "y": y,
                "scaleX": transform.scale_x,
                "scaleY": transform.scale_y,
                "rot": transform.rot,
                "anchorX": 0.5,
                "anchorY": 0.5,
            })
        }
        (None, Some((x, y))) => json!({
            "x": x,
            "y": y,
            "scaleX": Value::Null,
            "scaleY": Value::Null,
            "rot": Value::Null,
            "anchorX": Value::Null,
            "anchorY": Value::Null,
        }),
    }
}

/// Rejette le placement identité que produit un squelette sans géométrie visible.
///
/// Un objet réellement centré reste résolu quand son squelette désigne une taille.
fn resolved_static_transform(
    object: &objbin::MenuObject,
    layout: &g4pkm::G4pkmLayout,
    sprite_size: (u32, u32),
) -> Option<placement::ScreenTransform> {
    let transform =
        placement::assemble_object(object, layout, sprite_size.0, sprite_size.1).transform;
    let identity_centre = transform.x_px == 640.0
        && transform.y_px == 360.0
        && transform.scale_x == 1.0
        && transform.scale_y == 1.0
        && transform.rot == 0.0;
    (!identity_centre || placement::taille_designee(layout, sprite_size.0, sprite_size.1).is_some())
        .then_some(transform)
}

/// Le texte d'un hash, pris de la DERNIÈRE entrée qui le porte.
///
/// Même règle que `nie_data::text::find_text`, réécrite ici pour que ce module ne dépende pas de
/// `nie-data` — la table est une simple liste de couples, et l'ordre inverse est ce qui donne la
/// priorité à la dernière définition, comme le fait le jeu.
fn find_text(entries: &[(u32, String)], hash: u32) -> Option<&str> {
    entries
        .iter()
        .rev()
        .find(|(candidate, _)| *candidate == hash)
        .map(|(_, text)| text.as_str())
}

/// Construit le layout d'un écran.
///
/// `menu_text` associe le hash d'un slot à son texte dans la locale demandée ; une table vide
/// rend un layout sans aucun libellé, ce qui est exact plutôt que muet. `visibility` associe le
/// CRC32 du nom d'un objet à ce que l'exécution Lua en dit — un objet absent garde `visible:
/// null`.
///
/// Le résultat suit le schéma `niers.menu.layout/v1`, celui que `lireLayout`
/// (`packages/inacord-ui/src/shell/game-layout.ts`) lit.
#[must_use]
pub fn build(
    source: &dyn MenuSource,
    spec: &ScreenSpec,
    locale: &str,
    menu_text: &[(u32, String)],
    visibility: &BTreeMap<u32, bool>,
) -> Value {
    let mut parsed: Vec<(String, objbin::MenuObject)> = Vec::new();
    let mut unreadable = Vec::new();

    for item in &spec.items {
        let Some(path) = item.objbin.as_deref() else {
            continue;
        };
        let Some(bytes) = source.read(path) else {
            unreadable.push(item.layer.clone());
            continue;
        };
        match objbin::parse(&bytes) {
            Ok(object) => parsed.push((item.layer.clone(), object)),
            Err(_) => unreadable.push(item.layer.clone()),
        }
    }
    let objects_parsed = parsed.len();

    // Les locators doivent être collectés avant les objets cibles : l'ordre des calques dans le
    // setting n'est pas un ordre de parenté et le porteur peut apparaître après sa cible.
    let mut attaches: BTreeMap<u32, Vec<(f32, f32)>> = BTreeMap::new();
    for (_, object) in &parsed {
        let Some(layout) = object
            .g4pkm_path
            .as_deref()
            .and_then(|logical| source.resolve_companion(logical))
            .and_then(|path| source.read(&path))
            .and_then(|bytes| g4pkm::parse(&bytes).ok())
        else {
            continue;
        };
        for slot in placement::attach_slots(object, &layout) {
            attaches
                .entry(slot.target_hash)
                .or_default()
                .push(slot.to_css());
        }
    }

    let mut objects = Vec::new();
    let mut sprite_count = 0usize;
    let mut attach_instances = 0usize;
    let mut unresolved_transforms = 0usize;

    for (layer, object) in parsed {
        let mut draw_priority = 0i32;
        let mut draw_type = 0i32;
        let mut camera = 0u32;
        let mut anim = Value::Null;
        let mut text_labels = Vec::new();

        for component in &object.components {
            match component {
                objbin::MenuComponent::Render(render) => {
                    draw_priority = render.draw_priority;
                    draw_type = render.draw_type;
                    camera = render.camera_name_hash;
                }
                objbin::MenuComponent::Animation(animation) => {
                    let hash = |value: u32| {
                        if value == 0 {
                            Value::Null
                        } else {
                            json!(format!("0x{value:08X}"))
                        }
                    };
                    anim = json!({
                        "open": hash(animation.mot_open_hash),
                        "loop": hash(animation.mot_loop_hash),
                        "close": hash(animation.mot_close_hash),
                    });
                }
                objbin::MenuComponent::Text(text) => {
                    for entry in &text.entries {
                        if let Some(value) = entry
                            .hashes
                            .iter()
                            .find_map(|hash| find_text(menu_text, *hash))
                        {
                            text_labels.push(json!({
                                "slot": entry.key,
                                "text": value,
                            }));
                        }
                    }
                }
                _ => {}
            }
        }

        let mut sprite = Value::Null;
        let mut sprite_size = (0u32, 0u32);

        let skeleton = object
            .g4pkm_path
            .as_deref()
            .and_then(|logical| source.resolve_companion(logical))
            .and_then(|path| source.read(&path))
            .and_then(|bytes| g4pkm::parse(&bytes).ok());

        let texture = texture_logical_path(&object)
            .as_deref()
            .and_then(|logical| source.resolve_companion(logical));
        if let Some(texture_path) = texture.as_deref()
            && let Some(bytes) = source.read(texture_path)
            && let Ok(parsed_texture) = g4tx::parse(&bytes)
        {
            let base = texture_path
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .strip_suffix(".g4tx")
                .unwrap_or_default();
            if let Some(main) = g4tx::select_main_texture(&parsed_texture, base) {
                let (width, height) = (
                    u32::try_from(main.width.max(0)).unwrap_or(0),
                    u32::try_from(main.height.max(0)).unwrap_or(0),
                );
                sprite_size = (width, height);
                let logical = texture_path.strip_prefix("data/").unwrap_or(texture_path);
                let stem = logical.strip_suffix(".g4tx").unwrap_or(logical);
                sprite = json!({
                    "logicalPath": logical,
                    "pngUrl": format!("/assets/tex/{stem}.png"),
                    "w": width,
                    "h": height,
                });
                sprite_count += 1;
            }
        }

        let static_transform = skeleton
            .as_ref()
            .and_then(|layout| resolved_static_transform(&object, layout, sprite_size));

        let name_hash = cfgbin::crc32(object.name.as_bytes());
        let positions = attaches.get(&name_hash).cloned().map_or_else(
            || vec![None],
            |positions| positions.into_iter().map(Some).collect::<Vec<_>>(),
        );
        if positions.len() > 1 {
            attach_instances += positions.len() - 1;
        }
        for (position_index, attach_position) in positions.into_iter().enumerate() {
            let positioned = serialize_transform(static_transform, attach_position);
            if positioned.is_null() {
                unresolved_transforms += 1;
            }
            // La PREUVE du placement, nommée, et jamais omise : un objet sans position doit dire
            // pourquoi, sinon le lecteur rejette le layout ENTIER. Mesuré le 2026-09-12 sur
            // `chara_bank_menu` : 4 objets sur 78 dans ce cas, et les trois écrans du jeu
            // affichaient « Le layout du jeu est indisponible » alors que 74 objets étaient
            // parfaitement placés.
            let placement_source = if positioned.is_null() {
                placement::PlacementSource::Unresolved
            } else if attach_position.is_some() {
                placement::PlacementSource::AttachLocator
            } else {
                placement::PlacementSource::G4pkmPose
            };
            objects.push(json!({
                "name": object.name.clone(),
                "layer": layer.clone(),
                // Le RANG de cet exemplaire parmi ceux que les locators posent.
                //
                // Un objet de liste est un gabarit : le jeu le réplique une fois par emplacement
                // (`CMenuAttachLocator`), et ces exemplaires sortent ici sous le MÊME nom, donc
                // sous le même `crc32(nom)`. Sans ce rang, rien ne les distingue : masquer le
                // troisième les masquait tous, ce que `docs/AVATAR.md` mesure comme le verrou réel
                // du rendu de ces écrans. Le publier ne résout pas la commande qui les adresserait
                // un par un — il rend la distinction EXPRIMABLE, ce qu'elle n'était pas.
                "instance": position_index,
                "parent": Value::Null,
                "placementSource": placement_source.as_str(),
                "transform": positioned,
                "drawPriority": draw_priority,
                "drawType": draw_type,
                "camera": format!("0x{camera:08X}"),
                "sprite": sprite.clone(),
                "text": if position_index == 0 && !text_labels.is_empty() {
                    json!(text_labels.clone())
                } else {
                    Value::Null
                },
                "anim": anim.clone(),
                "primitive": Value::Null,
                "charModel": Value::Null,
                "visible": visibility
                    .get(&name_hash)
                    .map_or(Value::Null, |visible| json!(visible)),
                "runtime": Value::Null,
            }));
        }
    }
    objects.sort_by_key(|object| object["drawPriority"].as_i64().unwrap_or(0));

    let visibility_resolved = objects
        .iter()
        .filter(|object| !object["visible"].is_null())
        .count();
    json!({
        "schema": "niers.menu.layout/v1",
        "screen": spec.screen.clone(),
        "locale": locale,
        "canvas": { "w": spec.canvas[0], "h": spec.canvas[1] },
        "objects": objects,
        "source": {
            "cfg": spec.cfg.clone(),
            "kind": "static_vfs",
        },
        "runtime": {
            "available": false,
            "reason": "nie-site publie le layout statique; l'execution Lua reste hors de l'API publique",
        },
        "diagnostics": {
            "layersDeclared": spec.items.len(),
            "layersMissing": spec.layers_missing.clone(),
            "objectsParsed": objects_parsed,
            "objectsUnreadable": unreadable,
            "spritesResolved": sprite_count,
            "attachInstancesExtra": attach_instances,
            "transformsUnresolved": unresolved_transforms,
            "visibilityResolved": visibility_resolved,
        },
    })
}

#[cfg(test)]
mod tests {
    use alloc::string::ToString;
    use super::*;

    /// Une source qui ne porte rien — le cas d'un montage incomplet.
    struct Vide;
    impl MenuSource for Vide {
        fn read(&self, _path: &str) -> Option<Vec<u8>> {
            None
        }
        fn resolve_companion(&self, _logical: &str) -> Option<String> {
            None
        }
    }

    fn spec() -> ScreenSpec {
        ScreenSpec {
            screen: "chara_bank_menu".to_string(),
            cfg: "data/common/gamedata/menu/cfg/chara_bank_menu_setting.cfg.bin".to_string(),
            canvas: [1280, 720],
            items: vec![
                ScreenItem {
                    layer: "base".to_string(),
                    objbin: Some("data/absent.objbin".to_string()),
                },
                ScreenItem {
                    layer: "sans_objbin".to_string(),
                    objbin: None,
                },
            ],
            layers_missing: vec!["declare_mais_absent".to_string()],
        }
    }

    /// Un calque dont les octets manquent est COMPTÉ comme illisible, pas silencieusement omis.
    #[test]
    fn un_calque_illisible_est_nomme_dans_les_diagnostics() {
        let layout = build(&Vide, &spec(), "fr", &[], &BTreeMap::new());
        assert_eq!(layout["diagnostics"]["objectsParsed"], 0);
        assert_eq!(layout["diagnostics"]["objectsUnreadable"], json!(["base"]));
        // Le calque sans `.objbin` n'est PAS illisible : il n'y avait rien à lire.
        assert_eq!(layout["diagnostics"]["layersDeclared"], 2);
        assert_eq!(
            layout["diagnostics"]["layersMissing"],
            json!(["declare_mais_absent"])
        );
        assert_eq!(layout["objects"], json!([]));
    }

    /// Sans octets, aucun objet n'est émis — et aucun exemplaire supplémentaire n'est compté.
    ///
    /// Ce test ne couvre PAS l'émission de `instance` sur un gabarit répliqué : les `.objbin` de
    /// menu vivent dans les CPK et ce montage ne les extrait pas, donc rien ici ne peut poser un
    /// locator réel. Cette partie est exercée par le chemin de `nie-site`, qui monte le VFS.
    #[test]
    fn sans_octets_aucun_objet_ni_exemplaire_supplementaire() {
        let layout = build(&Vide, &spec(), "fr", &[], &BTreeMap::new());
        assert_eq!(layout["objects"], json!([]));
        assert_eq!(layout["diagnostics"]["attachInstancesExtra"], 0);
    }

    /// Le contrat que lit le navigateur est nommé dans le document lui-même.
    #[test]
    fn le_schema_et_le_canvas_viennent_de_la_specification() {
        let layout = build(&Vide, &spec(), "ja", &[], &BTreeMap::new());
        assert_eq!(layout["schema"], "niers.menu.layout/v1");
        assert_eq!(layout["screen"], "chara_bank_menu");
        assert_eq!(layout["locale"], "ja");
        assert_eq!(layout["canvas"], json!({ "w": 1280, "h": 720 }));
        assert_eq!(layout["source"]["kind"], "static_vfs");
    }

    /// La table de texte rend la DERNIÈRE définition d'un hash, comme le jeu.
    #[test]
    fn un_hash_redefini_prend_la_derniere_valeur() {
        let table = [
            (0x1234_5678, "premier".to_string()),
            (0x1234_5678, "dernier".to_string()),
        ];
        assert_eq!(find_text(&table, 0x1234_5678), Some("dernier"));
        assert_eq!(find_text(&table, 0x0000_0001), None);
    }

    /// Un locator prouve la position, jamais l'échelle ni la rotation.
    #[test]
    fn une_position_attachee_ne_fabrique_pas_une_echelle() {
        let attache = serialize_transform(None, Some((12.0, 34.0)));
        assert_eq!(attache["x"], 12.0);
        assert_eq!(attache["y"], 34.0);
        for composante in ["scaleX", "scaleY", "rot", "anchorX", "anchorY"] {
            assert!(
                attache[composante].is_null(),
                "{composante} n'est prouvée par aucun locator"
            );
        }
        assert!(serialize_transform(None, None).is_null());
    }

    /// Une transformation analysée sort telle quelle : aucune valeur n'est arrondie ni recalculée.
    #[test]
    fn une_transformation_analysee_est_recopiee() {
        let transform = placement::ScreenTransform {
            x_px: 12.0,
            y_px: 34.0,
            scale_x: 1.5,
            scale_y: 2.0,
            rot: 0.25,
        };
        let serialise = serialize_transform(Some(transform), None);
        assert_eq!(serialise["x"], 12.0);
        assert_eq!(serialise["y"], 34.0);
        assert_eq!(serialise["scaleX"], 1.5);
        assert_eq!(serialise["scaleY"], 2.0);
        assert_eq!(serialise["rot"], 0.25);
        assert_eq!(serialise["anchorX"], 0.5);
    }

    /// Le lecteur du navigateur (`lireLayout`) EXIGE qu'un objet sans transform déclare sa
    /// preuve de placement ; sans elle il rejette le layout ENTIER. La preuve est donc toujours
    /// nommée, et « non résolue » en est une.
    #[test]
    fn chaque_objet_declare_sa_preuve_de_placement() {
        for (positionne, attache, attendu) in [
            (false, false, "unresolved"),
            (false, true, "unresolved"),
            (true, true, "attach-locator"),
            (true, false, "g4pkm-pose"),
        ] {
            let source = if positionne {
                if attache {
                    placement::PlacementSource::AttachLocator
                } else {
                    placement::PlacementSource::G4pkmPose
                }
            } else {
                placement::PlacementSource::Unresolved
            };
            assert_eq!(source.as_str(), attendu);
        }
    }

    /// Une position attachée REMPLACE la position de la pose, sans toucher au reste.
    #[test]
    fn une_position_attachee_remplace_celle_de_la_pose() {
        let transform = placement::ScreenTransform {
            x_px: 12.0,
            y_px: 34.0,
            scale_x: 1.5,
            scale_y: 2.0,
            rot: 0.25,
        };
        let serialise = serialize_transform(Some(transform), Some((100.0, 200.0)));
        assert_eq!(serialise["x"], 100.0);
        assert_eq!(serialise["y"], 200.0);
        assert_eq!(serialise["scaleX"], 1.5, "l'échelle vient toujours de la pose");
        assert_eq!(serialise["rot"], 0.25);
    }
}
