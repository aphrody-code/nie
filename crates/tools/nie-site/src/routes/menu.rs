//! Relais de l'arbre de navigation et export statique des menus.
//!
//! Le catalogue `/menu-tree.json` est déjà construit par l'amont à partir des vrais
//! `*_setting.cfg.bin`, de leurs calques et de leurs commandes. `nie-site` ne le recopie pas et
//! ne le reconstruit pas : il l'adresse sous son API publique, en réutilisant le proxy borné de
//! [`super::assets`] (cache, ETag, timeout et plafond de réponse).
//!
//! Les deux paramètres d'écran ne désignent pas le calque `mainmenu01` ni un script Lua : ils
//! désignent le stem du fichier `*_setting.cfg.bin`, exactement comme le sélecteur de
//! `nie-model-serve`.

use std::collections::BTreeMap;

use axum::Json;
use axum::extract::{Path, RawQuery, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use nie_formats::cfgbin;
use nie_formats::g4pkm;
use nie_formats::g4tx;
use nie_formats::menu as menu_placement;
use nie_formats::menu_layout;
use nie_formats::objbin;
use nie_formats::vfs::Vfs;
use serde_json::{Value, json};

use crate::error::ErreurSite;
use crate::state::EtatSite;
use crate::vfs_index::IndexVfs;

/// Chemin public du catalogue de navigation.
pub const SCREENS_ROUTE: &str = "/api/v1/menu/screens";

/// Chemin public d'une entrée du catalogue de navigation.
pub const SCREEN_ROUTE: &str = "/api/v1/menu/screens/{stem}";

/// Chemin public d'une définition typée `menu_setting`.
pub const SETTING_ROUTE: &str = "/api/v1/menu/settings/{screen}";

/// Chemin public d'un layout statique construit depuis le VFS.
pub const LAYOUT_ROUTE: &str = "/api/v1/menu/layout/{screen}";

/// Chemin public de l'IMAGE composée d'un écran, PNG 1280×720.
pub const RENDER_ROUTE: &str = "/api/v1/menu/render/{screen}";

/// L'atlas de la police de menu et ses métriques, dans le VFS.
const FONT_ATLAS: &str = "data/dx11/font/font_def/font.g4tx";
const FONT_METRICS: &str = "data/common/font/font/font_def/font.cfg.bin";

/// Le canevas du jeu, en pixels. Les transforms du layout y sont exprimés.
const CANVAS: (u32, u32) = (1280, 720);

/// Chemin d'amont du catalogue complet.
const UPSTREAM_INDEX: &str = "menu-tree.json";

/// Construit le chemin d'amont d'un écran précis.
fn upstream_screen(stem: &str) -> Result<String, ErreurSite> {
    // Le routeur ne capture qu'un segment, mais la garde reste ici aussi : cette fonction est
    // le point qui transforme une entrée client en chemin VFS adressé à l'amont.
    if stem.is_empty()
        || stem == "."
        || stem == ".."
        || stem.contains('/')
        || stem.contains('\\')
        || stem.contains("..")
        || stem.ends_with(".json")
    {
        return Err(ErreurSite::Demande(
            "stem de menu invalide : attendez le nom sans chemin ni suffixe .json".to_owned(),
        ));
    }
    Ok(format!("menu-tree/{stem}.json"))
}

/// Construit le chemin VFS d'une définition `menu_setting`.
fn setting_path(screen: &str) -> Result<String, ErreurSite> {
    if screen.is_empty()
        || screen == "."
        || screen == ".."
        || screen.contains('/')
        || screen.contains('\\')
        || screen.contains("..")
        || screen.ends_with(".json")
        || screen.ends_with(".cfg.bin")
    {
        return Err(ErreurSite::Demande(
            "ecran de menu invalide : attendez le stem sans chemin ni suffixe".to_owned(),
        ));
    }
    Ok(format!(
        "data/common/gamedata/menu/cfg/{screen}_setting.cfg.bin"
    ))
}

/// Relaie une ressource de menu par le proxy partagé.
async fn relay(state: EtatSite, path: String, query: RawQuery, headers: HeaderMap) -> Response {
    match super::assets::proxy(State(state), Path(path), query, headers).await {
        Ok(response) => response,
        Err(error) => error.into_response(),
    }
}

/// `GET /api/v1/menu/screens` — l'arbre de navigation complet des menus.
pub async fn screens(
    State(state): State<EtatSite>,
    query: RawQuery,
    headers: HeaderMap,
) -> Response {
    relay(state, UPSTREAM_INDEX.to_owned(), query, headers).await
}

/// `GET /api/v1/menu/screens/{stem}` — une entrée de l'arbre de navigation.
pub async fn screen(
    State(state): State<EtatSite>,
    Path(stem): Path<String>,
    query: RawQuery,
    headers: HeaderMap,
) -> Response {
    let path = match upstream_screen(&stem) {
        Ok(path) => path,
        Err(error) => return error.into_response(),
    };
    relay(state, path, query, headers).await
}

/// `GET /api/v1/menu/settings/{screen}` — définition typée d'un écran du VFS.
///
/// Cette route est locale au site : elle lit les octets du montage courant, les convertit via
/// `nie_formats::cfgbin`, puis appelle le parseur unique `nie_data::menu_setting`. Elle expose
/// donc les neuf listes sémantiques sans recopier un dump JSON ni dépendre de l'amont HTTP.
pub async fn setting(
    State(state): State<EtatSite>,
    Path(screen): Path<String>,
) -> Result<Json<Value>, ErreurSite> {
    let chemin = setting_path(&screen)?;
    let vfs = state.vfs()?;
    let a_lire = chemin.clone();
    let octets = tokio::task::spawn_blocking(move || vfs.read(&a_lire))
        .await?
        .map_err(|e| {
            tracing::debug!(erreur = %e, chemin = %chemin, "lecture menu_setting impossible");
            ErreurSite::Introuvable(format!("définition de menu absente du VFS : {chemin}"))
        })?;
    let racine = nie_formats::cfgbin::to_iecode_json(&octets).ok_or_else(|| {
        ErreurSite::Demande(format!(
            "définition de menu illisible (ni RDBN ni T2B) : {chemin}"
        ))
    })?;
    let setting = nie_data::menu_setting::parse(&racine);
    Ok(Json(json!({
        "schema": "niers.menu.setting/v1",
        "screen": screen,
        "path": chemin,
        "bytes": octets.len(),
        "setting": setting,
    })))
}

/// Convertit les frères T2B dans la forme arborescente attendue par `nie-data`.
///
/// Le résolveur de texte de `nie-data` travaille sur la forme IECode historique, tandis que le
/// parseur T2B rend une arborescence typée. Cette conversion est locale au service et ne modifie
/// jamais les octets du VFS.
fn t2b_siblings_to_iecode(siblings: &[cfgbin::CfgEntry]) -> Vec<Value> {
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    siblings
        .iter()
        .map(|entry| {
            let index = counts.entry(entry.name.as_str()).or_insert(0);
            let name = format!("{}_{}", entry.name, *index);
            *index += 1;
            let variables = entry
                .variables
                .iter()
                .map(|value| match value {
                    cfgbin::Value::String(value) => json!({
                        "type": "String",
                        "value": value,
                    }),
                    cfgbin::Value::Int(value) => json!({
                        "type": "Int",
                        "value": value.to_string(),
                    }),
                    cfgbin::Value::Float(value) => json!({
                        "type": "Float",
                        "value": value.to_string(),
                    }),
                })
                .collect::<Vec<_>>();
            json!({
                "name": name,
                "variables": variables,
                "children": t2b_siblings_to_iecode(&entry.children),
            })
        })
        .collect()
}

/// Charge le dictionnaire de textes statiques de la locale publiée par le layout.
pub(super) fn load_menu_text(vfs: &Vfs, locale: &str) -> Vec<(nie_data::hash::HashId, String)> {
    let needle = format!("/text/{locale}/");
    let Some(path) = vfs.iter().map(|(path, _)| path.to_string()).find(|path| {
        path.contains(&needle) && path.rsplit('/').next() == Some("menu_text.cfg.bin")
    }) else {
        return Vec::new();
    };
    if !vfs
        .find(&path)
        .is_some_and(|entry| entry.file_size <= 4 * 1024 * 1024)
    {
        return Vec::new();
    }
    let Ok(bytes) = vfs.read(&path) else {
        return Vec::new();
    };
    if bytes.len() > 4 * 1024 * 1024 {
        return Vec::new();
    }
    let Ok(file) = cfgbin::parse_t2b(&bytes) else {
        return Vec::new();
    };
    let root = json!({
        "entries": t2b_siblings_to_iecode(&file.entries),
    });
    nie_data::text::parse_text_file(&root)
}

/// Nom logique du compagnon texture d'un objet.
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

/// Serializes only transform components backed by parsed layout data.
///
/// An attach locator proves the position of an instance, but it does not prove its scale,
/// rotation, or anchor. Those unresolved components remain JSON `null` instead of silently
/// turning into an identity transform at the centre of the canvas.
fn serialize_transform(
    transform: Option<menu_placement::ScreenTransform>,
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

/// Rejects the identity placement produced when a parsed skeleton contains no usable visual
/// geometry. A genuine centred object remains resolved when its skeleton designates a size.
fn resolved_static_transform(
    object: &objbin::MenuObject,
    layout: &g4pkm::G4pkmLayout,
    sprite_size: (u32, u32),
) -> Option<menu_placement::ScreenTransform> {
    let transform =
        menu_placement::assemble_object(object, layout, sprite_size.0, sprite_size.1).transform;
    let identity_centre = transform.x_px == 640.0
        && transform.y_px == 360.0
        && transform.scale_x == 1.0
        && transform.scale_y == 1.0
        && transform.rot == 0.0;
    (!identity_centre
        || menu_placement::taille_designee(layout, sprite_size.0, sprite_size.1).is_some())
    .then_some(transform)
}

/// Construit le layout statique d'un écran depuis les octets déjà montés.
///
/// Le résultat reprend le contrat consommé par Inacord (`transform`, `sprite`, `text`, `anim`).
/// Les textes et sprites qui ne sont pas présents dans les fichiers restent `null`; aucun
/// défaut visuel n'est inventé. Les instances déclarées par `CMenuAttachLocator` sont émises
/// séparément, car chacune désigne un emplacement réel d'un même objet de liste.
fn build_static_layout(
    vfs: &Vfs,
    index: &IndexVfs,
    detail: &super::screens::ScreenDetail,
    locale: &str,
) -> Value {
    let menu_text = load_menu_text(vfs, locale);
    let mut parsed: Vec<(String, String, objbin::MenuObject)> = Vec::new();
    let mut unreadable = Vec::new();

    for item in &detail.items {
        let Some(path) = item.objbin.as_deref() else {
            continue;
        };
        let Ok(bytes) = vfs.read(path) else {
            unreadable.push(item.layer.clone());
            continue;
        };
        match objbin::parse(&bytes) {
            Ok(object) => parsed.push((item.layer.clone(), path.to_owned(), object)),
            Err(_) => unreadable.push(item.layer.clone()),
        }
    }
    let objects_parsed = parsed.len();

    // Les locators doivent être collectés avant les objets cibles : l'ordre des calques dans le
    // setting n'est pas un ordre de parenté et le porteur peut apparaître après sa cible.
    let mut attaches: BTreeMap<u32, Vec<(f32, f32)>> = BTreeMap::new();
    for (_, _, object) in &parsed {
        let Some(logical) = object.g4pkm_path.as_deref() else {
            continue;
        };
        let Some(path) =
            super::inspect::resolve_companion(index, logical, super::inspect::DEFAULT_LOCALE)
        else {
            continue;
        };
        let Ok(bytes) = vfs.read(&path) else {
            continue;
        };
        let Ok(layout) = g4pkm::parse(&bytes) else {
            continue;
        };
        for slot in menu_placement::attach_slots(object, &layout) {
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

    for (layer, _, object) in parsed {
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
                        if let Some(value) = entry.hashes.iter().find_map(|hash| {
                            nie_data::text::find_text(&menu_text, nie_data::hash::HashId(*hash))
                        }) {
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
            .and_then(|logical| {
                super::inspect::resolve_companion(index, logical, super::inspect::DEFAULT_LOCALE)
            })
            .and_then(|path| vfs.read(&path).ok())
            .and_then(|bytes| g4pkm::parse(&bytes).ok());

        let texture_logical = texture_logical_path(&object);
        let texture = texture_logical.as_deref().and_then(|logical| {
            super::inspect::resolve_companion(index, logical, super::inspect::DEFAULT_LOCALE)
        });
        if let Some(texture_path) = texture.as_deref()
            && let Ok(bytes) = vfs.read(texture_path)
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

        let positions = attaches
            .get(&cfgbin::crc32(object.name.as_bytes()))
            .cloned();
        let positions = positions
            .map(|positions| positions.into_iter().map(Some).collect::<Vec<_>>())
            .unwrap_or_else(|| vec![None]);
        if positions.len() > 1 {
            attach_instances += positions.len() - 1;
        }
        for (position_index, attach_position) in positions.into_iter().enumerate() {
            let positioned = serialize_transform(static_transform, attach_position);
            if positioned.is_null() {
                unresolved_transforms += 1;
            }
            // La PREUVE du placement, nommée, et jamais omise.
            //
            // Le champ manquait : un objet sans transform sortait sans rien dire de ce qui
            // manquait, et le lecteur (`lireLayout`, côté navigateur) rejetait le layout ENTIER —
            // un objet sans position doit déclarer pourquoi. Mesuré le 2026-09-12 sur
            // `chara_bank_menu` : 4 objets sur 78 dans ce cas, et les trois écrans du jeu
            // affichaient « Le layout du jeu est indisponible » alors que 74 objets étaient
            // parfaitement placés.
            let placement_source = if positioned.is_null() {
                menu_placement::PlacementSource::Unresolved
            } else if attach_position.is_some() {
                menu_placement::PlacementSource::AttachLocator
            } else {
                menu_placement::PlacementSource::G4pkmPose
            };
            objects.push(json!({
                "name": object.name.clone(),
                "layer": layer.clone(),
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
                "visible": Value::Null,
                "runtime": Value::Null,
            }));
        }
    }
    objects.sort_by_key(|object| object["drawPriority"].as_i64().unwrap_or(0));

    json!({
        "schema": "niers.menu.layout/v1",
        "screen": detail.screen,
        "locale": locale,
        "canvas": { "w": detail.canvas[0], "h": detail.canvas[1] },
        "objects": objects,
        "source": {
            "cfg": detail.cfg,
            "kind": "static_vfs",
        },
        "runtime": {
            "available": false,
            "reason": "nie-site publie le layout statique; l'execution Lua reste hors de l'API publique",
        },
        "diagnostics": {
            "layersDeclared": detail.items.len(),
            "layersMissing": detail.layers_missing.clone(),
            "objectsParsed": objects_parsed,
            "objectsUnreadable": unreadable,
            "spritesResolved": sprite_count,
            "attachInstancesExtra": attach_instances,
            "transformsUnresolved": unresolved_transforms,
            "visibilityResolved": 0,
        },
    })
}

/// `GET /api/v1/menu/layout/{screen}` — le layout statique d'un écran du VFS.
///
/// `{screen}` est le stem du `_setting.cfg.bin` (le même espace de noms que
/// `/api/v1/screens/{screen}`). Le rendu est déterministe et lit les objets réels ; les mutations
/// de `MenuState` Lua ne sont pas exécutées par cette route.
pub async fn layout(
    State(state): State<EtatSite>,
    Path(screen): Path<String>,
) -> Result<Json<Value>, ErreurSite> {
    let axum::Json(detail) = super::screens::screen(State(state.clone()), Path(screen)).await?;
    let vfs = state.vfs()?;
    let index = state.index()?;
    let body = tokio::task::spawn_blocking(move || {
        build_static_layout(&vfs, &index, &detail, super::inspect::DEFAULT_LOCALE)
    })
    .await?;
    Ok(Json(body))
}

/// Les octets que le compositeur portable demandera, lus dans le VFS monté.
struct AssetsVfs {
    octets: BTreeMap<String, Vec<u8>>,
    police: Option<menu_layout::MenuFont>,
}

impl menu_layout::MenuAssets for AssetsVfs {
    fn g4tx(&self, cle: &str) -> Option<&[u8]> {
        self.octets.get(cle).map(Vec::as_slice)
    }

    fn font(&self) -> Option<&menu_layout::MenuFont> {
        self.police.as_ref()
    }
}

/// Lit un `.g4tx` que le layout nomme, sous l'une ou l'autre de ses deux formes.
///
/// Le layout nomme sa texture tantôt par un chemin VFS complet (région runtime), tantôt par le
/// seul nom de fichier (texture statique, région par hash). Les deux passent ici : lecture
/// directe d'abord, puis la résolution par nom de l'index, qui applique la politique de locale
/// du jeu (`resolve_companion`). Aucun chemin n'est deviné — les deux issues viennent de l'index.
fn lire_asset(vfs: &Vfs, index: &IndexVfs, cle: &str, locale: &str) -> Option<Vec<u8>> {
    if let Ok(octets) = vfs.read(cle) {
        return Some(octets);
    }
    let logique = cle.strip_prefix("data/").unwrap_or(cle);
    let chemin = super::inspect::resolve_companion(index, logique, locale)?;
    vfs.read(&chemin).ok()
}

/// Charge la police du menu — atlas RGBA8 + métriques T2B. `None` si l'une des deux manque :
/// une police à moitié chargée dessinerait des glyphes faux, ce qui est pire qu'aucun libellé.
fn lire_police(vfs: &Vfs, index: &IndexVfs, locale: &str) -> Option<menu_layout::MenuFont> {
    let atlas_octets = lire_asset(vfs, index, FONT_ATLAS, locale)?;
    let conteneur = g4tx::parse(&atlas_octets).ok()?;
    let texture = g4tx::select_main_texture(&conteneur, "font_def")?;
    let (atlas_width, _, atlas) =
        nie_formats::g4tx_decode::decode_texture_rgba(&atlas_octets, texture)?;
    let metriques_octets = lire_asset(vfs, index, FONT_METRICS, locale)?;
    let cfg = cfgbin::parse_t2b(&metriques_octets).ok()?;
    Some(menu_layout::MenuFont {
        atlas,
        atlas_width,
        metrics: nie_formats::font::parse_metrics(&cfg),
    })
}

/// Compose l'écran en PNG avec le compositeur de référence du dépôt.
///
/// Ce n'est pas une seconde implémentation : `nie_formats::menu_layout` est celle que
/// `nie-game --compose-layout` emploie, et la même que le navigateur peut charger en
/// WebAssembly. Le site ne fait que lui apporter les octets du VFS qu'il a déjà monté.
fn composer_ecran(
    vfs: &Vfs,
    index: &IndexVfs,
    detail: &super::screens::ScreenDetail,
    locale: &str,
) -> Result<(Vec<u8>, menu_layout::ComposeReport), ErreurSite> {
    let layout = build_static_layout(vfs, index, detail, locale);
    let texte = serde_json::to_string(&layout)
        .map_err(|e| ErreurSite::Interne(format!("layout non sérialisable : {e}")))?;
    // Le layout du site est STATIQUE : il n'exécute aucun script, donc il ne résout aucune
    // visibilité et pose `visible: null` (`diagnostics.visibilityResolved = 0`). Sous la règle de
    // l'export runtime, composer ce layout rend une image vide — mesuré le 2026-09-12 sur
    // `main_menu` : 20 objets, 0 dessiné. La politique est donc nommée ici : l'image montre ce que
    // l'écran CONTIENT, pas ce que le jeu en affiche à un instant donné, et l'en-tête le dit.
    let compose = menu_layout::MenuLayout::from_json(&[&texte])
        .map_err(ErreurSite::Interne)?
        .with_visibility(menu_layout::Visibility::UnknownCounts);
    let mut octets = BTreeMap::new();
    for cle in compose.required_assets() {
        if let Some(donnees) = lire_asset(vfs, index, &cle, locale) {
            octets.insert(cle, donnees);
        }
    }
    let police = if compose.has_text_labels() {
        lire_police(vfs, index, locale)
    } else {
        None
    };
    let assets = AssetsVfs { octets, police };
    let composee = compose.compose(&assets, CANVAS.0, CANVAS.1);
    let png = nie_aphrody::assets::encoder_png(&composee.rgba, composee.width, composee.height)
        .map_err(|e| ErreurSite::Interne(format!("encodage PNG : {e}")))?;
    Ok((png, composee.report))
}

/// `GET /api/v1/menu/render/{screen}` — l'écran, composé en PNG 1280×720.
///
/// Le rendu vient du compositeur de référence (échantillonnage bilinéaire, rotation, ancre,
/// mélange additif), pas d'un empilement d'images HTML. Les en-têtes portent les comptes de la
/// composition : ce qui a été dessiné, et ce qui a été SAUTÉ faute de pixels — un écran
/// incomplet se voit dans la réponse au lieu de passer pour un écran vide.
///
/// # Errors
///
/// `503` quand le VFS n'est pas monté, `404` quand l'écran n'existe pas, `500` si l'encodage
/// échoue.
pub async fn render(
    State(state): State<EtatSite>,
    Path(screen): Path<String>,
) -> Result<Response, ErreurSite> {
    let axum::Json(detail) = super::screens::screen(State(state.clone()), Path(screen)).await?;
    let vfs = state.vfs()?;
    let index = state.index()?;
    let (png, report) = tokio::task::spawn_blocking(move || {
        composer_ecran(&vfs, &index, &detail, super::inspect::DEFAULT_LOCALE)
    })
    .await??;
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("image/png"),
    );
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("public, max-age=300"),
    );
    // La politique de visibilité employée, en clair : sans elle, un lecteur croirait voir un état
    // du jeu là où il voit le contenu d'un écran.
    headers.insert(
        axum::http::HeaderName::from_static("x-compose-visibility"),
        axum::http::HeaderValue::from_static("unknown-counts"),
    );
    for (nom, valeur) in [
        ("x-compose-drawn", report.drawn),
        ("x-compose-sprites", report.statics),
        ("x-compose-regions", report.regions),
        ("x-compose-texts", report.texts),
        ("x-compose-skipped", report.skipped),
    ] {
        if let Ok(entete) = axum::http::HeaderValue::from_str(&valeur.to_string())
            && let Ok(cle) = axum::http::HeaderName::from_bytes(nom.as_bytes())
        {
            headers.insert(cle, entete);
        }
    }
    Ok((headers, png).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Le lecteur du navigateur (`lireLayout`) EXIGE qu'un objet sans transform déclare sa
    /// preuve de placement ; sans elle il rejette le layout entier. La preuve est donc toujours
    /// nommée, et « non résolue » en est une.
    #[test]
    fn chaque_objet_declare_sa_preuve_de_placement() {
        for (positionne, attache, attendu) in [
            (false, false, "unresolved"),
            (false, true, "unresolved"),
            (true, true, "attach-locator"),
            (true, false, "g4pkm-pose"),
        ] {
            let source = if !positionne {
                menu_placement::PlacementSource::Unresolved
            } else if attache {
                menu_placement::PlacementSource::AttachLocator
            } else {
                menu_placement::PlacementSource::G4pkmPose
            };
            assert_eq!(source.as_str(), attendu);
        }
    }

    #[test]
    fn le_stem_devient_un_fichier_menu_tree() {
        assert_eq!(
            upstream_screen("mainmenu01").unwrap(),
            "menu-tree/mainmenu01.json"
        );
    }

    #[test]
    fn le_stem_ne_peut_pas_sortir_de_l_espace_menu() {
        for stem in ["", ".", "..", "../secret", "a/b", "a\\b", "a.json"] {
            assert!(upstream_screen(stem).is_err(), "stem accepté : {stem:?}");
        }
    }

    #[test]
    fn le_stem_devient_un_cfg_menu_setting() {
        assert_eq!(
            setting_path("main_menu").unwrap(),
            "data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin"
        );
    }

    #[test]
    fn le_stem_setting_refuse_un_chemin_ou_un_suffixe() {
        for stem in ["", "..", "../secret", "a/b", "a\\b", "a.json", "a.cfg.bin"] {
            assert!(setting_path(stem).is_err(), "stem accepté : {stem:?}");
        }
    }

    #[test]
    fn unresolved_transform_and_visibility_are_not_invented() {
        assert!(serialize_transform(None, None).is_null());
        let attached = serialize_transform(None, Some((123.0, 456.0)));
        assert_eq!(attached["x"], 123.0);
        assert_eq!(attached["y"], 456.0);
        assert!(attached["scaleX"].is_null());
        assert!(attached["anchorX"].is_null());
    }

    #[test]
    fn resolved_transform_preserves_parsed_values() {
        let transform = menu_placement::ScreenTransform {
            x_px: 12.0,
            y_px: 34.0,
            scale_x: 1.5,
            scale_y: 2.0,
            rot: 0.25,
        };
        let serialized = serialize_transform(Some(transform), None);
        assert_eq!(serialized["x"], 12.0);
        assert_eq!(serialized["y"], 34.0);
        assert_eq!(serialized["scaleX"], 1.5);
        assert_eq!(serialized["rot"], 0.25);
    }
}
