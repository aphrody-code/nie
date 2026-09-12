//! Un layout de menu exporté par le runtime → une image composée.
//!
//! ## Pourquoi ce module existe
//!
//! Cette composition vivait dans `nie-game/src/main.rs` — un **binaire de 5 128 lignes**. Elle
//! n'était donc atteignable que par une ligne de commande, sur une machine qui a le jeu monté.
//! Trois conséquences mesurées :
//!
//! 1. le navigateur ne pouvait pas s'en servir, alors que c'est le seul compositeur de ce dépôt
//!    qui fasse ce que le jeu fait (échantillonnage bilinéaire, rotation, ancre, teinte, mélange
//!    additif) — le site redessinait donc les mêmes layouts en DOM
//!    (`packages/inacord-ui/src/shell/layout-render.tsx`), avec des `<img>` et des `transform`
//!    CSS, c'est-à-dire sans aucune de ces quatre opérations ;
//! 2. `nie-site` construit déjà le layout depuis le VFS et le sert
//!    (`/api/v1/menu/layout/{screen}`) : le seul chaînon manquant entre la donnée et les pixels
//!    était ce code, et il était enfermé ;
//! 3. rien ne pouvait le tester autrement qu'en lançant un processus.
//!
//! Ici, c'est une bibliothèque : elle ne lit aucun fichier et ne connaît ni dossier de jeu, ni
//! VFS, ni CPK. L'hôte fournit les octets (`MenuAssets`), ce qui la rend utilisable telle quelle
//! en `wasm32-unknown-unknown`.
//!
//! ## Ce qu'elle ne fait PAS
//!
//! Elle ne corrige aucune position et n'invente aucun pixel. Un objet sans source de pixels est
//! sauté, pas remplacé ; un libellé non résolu (`"0x…"`) n'est pas rendu ; une police absente
//! annule la passe texte au lieu d'en dessiner une autre. Le rendu obtenu n'est pas déclaré
//! conforme à `nie.exe` : c'est la composition des données que le runtime a exportées.
//!
//! ## L'ordre de dessin
//!
//! `drawPriority` croissant d'abord (le fond en premier), puis l'ordre de déclaration. Les
//! libellés passent au-dessus de tous les sprites (`+1000`), ce qui est la règle du driver.

extern crate alloc;

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use alloc::{format, vec};

use serde_json::Value;

use crate::menu::{BlendMode, CompositeSprite, PlacementSource, ScreenTransform, compose_over};
use crate::raster2d::crop_rgba;
use crate::{cfgbin, font, g4tx, g4tx_decode};

/// La police du menu, déjà décodée par l'hôte.
///
/// L'atlas est un RGBA8 de `atlas_width` pixels de large ; les métriques viennent du `T2B`
/// `font_def/font.cfg.bin`. L'hôte la fournit parce qu'elle pèse des dizaines de mégaoctets et
/// qu'un écran sans libellé résolu n'a aucune raison de la charger.
pub struct MenuFont {
    /// Pixels RGBA8 de l'atlas.
    pub atlas: Vec<u8>,
    /// Largeur de l'atlas, en pixels.
    pub atlas_width: u32,
    /// Métriques lues dans le `cfg.bin` de la police.
    pub metrics: font::FontMetrics,
}

/// Les octets que l'hôte met à disposition du compositeur.
///
/// Les clés sont exactement celles que rend [`MenuLayout::required_assets`] : un chemin `.g4tx`
/// tel que le layout le nomme. L'hôte décide comment il les obtient — VFS monté, CPK, requête
/// HTTP, cache navigateur — et le compositeur n'en sait rien.
pub trait MenuAssets {
    /// Les octets d'un `.g4tx`, ou `None` si l'hôte ne l'a pas.
    fn g4tx(&self, key: &str) -> Option<&[u8]>;

    /// La police, quand l'hôte l'a chargée. Sans elle, la passe texte est simplement absente.
    fn font(&self) -> Option<&MenuFont> {
        None
    }
}

/// Ce qui a été réellement dessiné — des comptes, pas une appréciation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ComposeReport {
    /// Total des éléments posés sur le canevas.
    pub drawn: usize,
    /// Sprites tirés d'une texture entière.
    pub statics: usize,
    /// Sprites tirés d'une région d'atlas nommée par le runtime.
    pub regions: usize,
    /// Sprites tirés d'une région résolue par CRC32 de son nom.
    pub region_hashes: usize,
    /// Libellés texte rendus par la police.
    pub texts: usize,
    /// Objets visibles sans aucune source de pixels — sautés, jamais remplacés.
    pub skipped: usize,
}

/// Le résultat : un canevas RGBA8 et ce qu'il a fallu pour l'obtenir.
pub struct ComposedLayout {
    /// Pixels RGBA8, `width * height * 4` octets.
    pub rgba: Vec<u8>,
    /// Largeur du canevas, en pixels.
    pub width: u32,
    /// Hauteur du canevas, en pixels.
    pub height: u32,
    /// Comptes de la passe de composition.
    pub report: ComposeReport,
}

/// Ce qu'un hôte sait de la visibilité des objets qu'il compose.
///
/// Le champ `visible` d'un layout n'a pas la même valeur selon qui l'a produit, et cette
/// différence est réelle, pas cosmétique :
///
/// - l'export RUNTIME (`nie-game --runtime --export-layout`) exécute le driver Lua du jeu :
///   `visible` y est **résolu**, objet par objet ;
/// - le layout STATIQUE de `nie-site` (`/api/v1/menu/layout/{screen}`) se construit depuis les
///   `_setting.cfg.bin`, les `objbin` et les `g4pkm`, sans exécuter le moindre script. Il pose
///   donc `visible: null` et l'annonce (`diagnostics.visibilityResolved = 0`) plutôt que
///   d'affirmer une visibilité qu'il n'a pas mesurée.
///
/// Composer le second avec la règle du premier rend une image vide — mesuré le 2026-09-12 sur
/// `main_menu` : 20 objets, 0 dessiné. Le choix appartient donc à l'hôte, et il est nommé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Visibility {
    /// Ne dessine que ce que la donnée déclare visible. Règle de l'export runtime.
    #[default]
    Declared,
    /// Dessine aussi ce dont la visibilité est INCONNUE (`null`, absent) ; `false` cache toujours.
    ///
    /// C'est la seule façon de composer un layout statique, et c'est une hypothèse : l'image
    /// obtenue montre ce que l'écran CONTIENT, pas ce que le jeu en affiche à un instant donné.
    UnknownCounts,
}

impl Visibility {
    /// Cet objet doit-il être dessiné sous cette politique ?
    #[must_use]
    fn draws(self, object: &Value) -> bool {
        match (self, object["visible"].as_bool()) {
            (_, Some(declared)) => declared,
            (Self::Declared, None) => false,
            (Self::UnknownCounts, None) => true,
        }
    }
}

/// Un layout de menu prêt à composer.
pub struct MenuLayout {
    objects: Vec<Value>,
    visibility: Visibility,
}

impl MenuLayout {
    /// Concatène un ou plusieurs layouts JSON et applique la porte de placement.
    ///
    /// Les calques arrivent dans l'ordre donné : à priorité de dessin égale, un calque déclaré
    /// plus tard passe au-dessus — c'est l'empilement du jeu.
    ///
    /// La porte est [`PlacementSource::allows_rendering`] : un objet dont la position n'a pas de
    /// source établie n'est pas dessiné à une position inventée.
    ///
    /// # Errors
    ///
    /// Rend l'erreur `serde_json` du premier document illisible, avec son rang dans la liste.
    pub fn from_json(layouts: &[&str]) -> Result<Self, String> {
        let mut objects: Vec<Value> = Vec::new();
        for (rank, text) in layouts.iter().enumerate() {
            let document: Value = serde_json::from_str(text)
                .map_err(|error| format!("layout JSON #{rank} invalide : {error}"))?;
            objects.extend(
                document["objects"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default(),
            );
        }
        objects.retain(|object| {
            PlacementSource::allows_rendering(
                object
                    .get("placementSource")
                    .map(|source| source.as_str().unwrap_or("")),
                object["transform"].is_object(),
            )
        });
        Ok(Self {
            objects,
            visibility: Visibility::default(),
        })
    }

    /// Choisit la politique de visibilité — cf. [`Visibility`].
    #[must_use]
    pub fn with_visibility(mut self, visibility: Visibility) -> Self {
        self.visibility = visibility;
        self
    }

    /// Combien d'objets ont passé la porte de placement.
    #[must_use]
    pub fn object_count(&self) -> usize {
        self.objects.len()
    }

    /// Un objet visible porte-t-il un libellé RÉSOLU ?
    ///
    /// L'atlas de police pèse des dizaines de mégaoctets : un hôte le charge quand il sert, pas
    /// « au cas où ». Sans libellé résolu, la passe texte ne dessinerait rien de toute façon.
    #[must_use]
    pub fn has_text_labels(&self) -> bool {
        self.objects.iter().any(|object| {
            self.visibility.draws(object) && resolved_text_label(&object["text"]).is_some()
        })
    }

    /// Les `.g4tx` dont la composition peut avoir besoin, dédupliqués, dans l'ordre de rencontre.
    ///
    /// C'est ce qui rend ce module utilisable derrière un réseau : un hôte asynchrone demande la
    /// liste, va chercher les octets comme il veut, puis compose en un appel synchrone. Les clés
    /// sont celles que [`MenuAssets::g4tx`] recevra.
    ///
    /// Un objet nomme sa texture de trois façons, et les trois sont retournées parce qu'aucun
    /// hôte ne sait résoudre les trois :
    ///
    /// - le chemin propre de la région runtime (`runtime.spriteRegionG4tx`) ;
    /// - le chemin logique complet de `sprite.logicalPath` — le seul que sache demander un hôte
    ///   qui n'a que HTTP, puisqu'il s'adresse à un serveur de fichiers ;
    /// - son nom de fichier seul — ce que sait résoudre un hôte qui a l'index du VFS, et ce que
    ///   le chemin logique ne permet pas toujours : `btl01_02.g4tx` est déclaré sous
    ///   `dx11/menu/02_btl/btl01/btl01_02/<LG>/btl01_02.g4tx`, un chemin qui n'existe sous aucune
    ///   forme littérale.
    ///
    /// La composition essaie dans cet ordre et retient la première clé que l'hôte a remplie.
    #[must_use]
    pub fn required_assets(&self) -> Vec<String> {
        let mut seen = BTreeSet::new();
        let mut keys = Vec::new();
        for object in &self.objects {
            if !self.visibility.draws(object) {
                continue;
            }
            for key in [
                object["runtime"]["spriteRegionG4tx"].as_str(),
                object["sprite"]["logicalPath"].as_str(),
                object["sprite"]["logicalPath"].as_str().map(basename),
            ]
            .into_iter()
            .flatten()
            {
                if seen.insert(key.to_string()) {
                    keys.push(key.to_string());
                }
            }
        }
        keys
    }

    /// Compose le layout sur un canevas transparent de `width × height`.
    #[must_use]
    pub fn compose(&self, assets: &dyn MenuAssets, width: u32, height: u32) -> ComposedLayout {
        self.compose_over(vec![0u8; (width as usize) * (height as usize) * 4], width, height, assets)
    }

    /// Compose par-dessus un canevas déjà peint (fond opaque du menu, capture de référence).
    ///
    /// # Panics
    ///
    /// Ne panique pas : un canevas de taille incohérente est remplacé par un canevas transparent
    /// aux dimensions demandées, parce qu'un appelant qui se trompe de taille doit obtenir une
    /// image lisible, pas un arrêt.
    #[must_use]
    pub fn compose_over(
        &self,
        canvas: Vec<u8>,
        width: u32,
        height: u32,
        assets: &dyn MenuAssets,
    ) -> ComposedLayout {
        let expected = (width as usize) * (height as usize) * 4;
        let canvas = if canvas.len() == expected {
            canvas
        } else {
            vec![0u8; expected]
        };

        let mut cache: BTreeMap<String, Option<g4tx::G4tx>> = BTreeMap::new();
        let mut items: Vec<DrawItem> = Vec::new();
        let mut report = ComposeReport::default();

        for (order, object) in self.objects.iter().enumerate() {
            if !self.visibility.draws(object) {
                continue;
            }
            let Some((source, pixels)) = sprite_pixels(object, assets, &mut cache) else {
                report.skipped += 1;
                continue;
            };
            let (sprite_w, sprite_h, rgba) = pixels;
            if rgba.is_empty() || sprite_w == 0 || sprite_h == 0 {
                report.skipped += 1;
                continue;
            }
            match source {
                PixelSource::Region => report.regions += 1,
                PixelSource::RegionHash => {
                    report.regions += 1;
                    report.region_hashes += 1;
                }
                PixelSource::Static => report.statics += 1,
            }
            let transform = &object["transform"];
            let number = |key: &str, default: f64| transform[key].as_f64().unwrap_or(default);
            items.push(DrawItem {
                priority: object["drawPriority"].as_i64().unwrap_or(0),
                order,
                rgba,
                width: sprite_w,
                height: sprite_h,
                transform: ScreenTransform {
                    x_px: number("x", 0.0) as f32,
                    y_px: number("y", 0.0) as f32,
                    scale_x: number("scaleX", 1.0).max(0.0) as f32,
                    scale_y: number("scaleY", 1.0).max(0.0) as f32,
                    rot: number("rot", 0.0) as f32,
                },
                anchor_x: number("anchorX", 0.5) as f32,
                anchor_y: number("anchorY", 0.5) as f32,
                // `drawType` vient du composant de rendu de l'objbin. 1 = additif (halos, néons) :
                // les mélanger en « over » les éteint. Les autres valeurs — dont 4, dont la
                // sémantique n'est pas établie — restent en mélange normal plutôt qu'inventées.
                mode: if object["drawType"].as_i64().unwrap_or(0) == 1 {
                    BlendMode::Additif
                } else {
                    BlendMode::Normal
                },
            });
        }

        if let Some(menu_font) = assets.font() {
            for (order, object) in self.objects.iter().enumerate() {
                if !self.visibility.draws(object) {
                    continue;
                }
                let Some(label) = resolved_text_label(&object["text"]) else {
                    continue;
                };
                let Some((label_w, label_h, pixels)) = render_label(menu_font, &label) else {
                    continue;
                };
                let transform = &object["transform"];
                let number = |key: &str, default: f64| transform[key].as_f64().unwrap_or(default);
                items.push(DrawItem {
                    // Le texte passe au-dessus de tous les sprites.
                    priority: object["drawPriority"].as_i64().unwrap_or(0) + 1000,
                    order: order + 1_000_000,
                    rgba: pixels,
                    width: label_w,
                    height: label_h,
                    // Le libellé est déjà rendu à sa taille : échelle neutre, seule l'ancre le place.
                    transform: ScreenTransform {
                        x_px: number("x", 0.0) as f32,
                        y_px: number("y", 0.0) as f32,
                        scale_x: 1.0,
                        scale_y: 1.0,
                        rot: 0.0,
                    },
                    anchor_x: number("anchorX", 0.5) as f32,
                    anchor_y: number("anchorY", 0.5) as f32,
                    mode: BlendMode::Normal,
                });
                report.texts += 1;
            }
        }

        items.sort_by(|a, b| a.priority.cmp(&b.priority).then(a.order.cmp(&b.order)));
        report.drawn = items.len();
        let sprites: Vec<CompositeSprite> = items
            .iter()
            .map(|item| CompositeSprite {
                rgba: &item.rgba,
                width: item.width,
                height: item.height,
                transform: item.transform,
                anchor_x: item.anchor_x,
                anchor_y: item.anchor_y,
                couleur: [1.0; 4],
                mode: item.mode,
            })
            .collect();
        ComposedLayout {
            rgba: compose_over(canvas, width, height, &sprites),
            width,
            height,
            report,
        }
    }
}

/// Un élément à dessiner : pixels RGBA **natifs** + transform écran + priorité (z-order).
///
/// Les pixels ne sont pas pré-agrandis : l'échelle est portée par le transform et appliquée par
/// le compositeur de référence ([`crate::menu`]), qui échantillonne en bilinéaire et sait tourner
/// un sprite. Pré-agrandir au plus proche voisin jetterait de l'information avant la composition
/// et ignorerait la rotation.
struct DrawItem {
    priority: i64,
    order: usize,
    rgba: Vec<u8>,
    width: u32,
    height: u32,
    transform: ScreenTransform,
    anchor_x: f32,
    anchor_y: f32,
    mode: BlendMode,
}

/// Des pixels décodés : `(largeur, hauteur, RGBA8)`.
type Pixels = (u32, u32, Vec<u8>);

/// D'où viennent les pixels d'un objet — pour les comptes du rapport, pas pour le rendu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PixelSource {
    /// Région d'atlas nommée par le runtime (`runtime.spriteRegion`).
    Region,
    /// Région d'atlas résolue par CRC32 de son nom (`runtime.spriteRegionHash`).
    RegionHash,
    /// Texture entière du conteneur.
    Static,
}

/// Les pixels d'un objet, dans l'ordre de résolution du jeu : région nommée, région par hash,
/// texture entière. `None` quand aucune des trois n'aboutit — l'objet est alors sauté.
fn sprite_pixels(
    object: &Value,
    assets: &dyn MenuAssets,
    cache: &mut BTreeMap<String, Option<g4tx::G4tx>>,
) -> Option<(PixelSource, Pixels)> {
    if let Some(pixels) = region_pixels(object, assets, cache) {
        return Some((PixelSource::Region, pixels));
    }
    if let Some(pixels) = region_hash_pixels(object, assets, cache) {
        return Some((PixelSource::RegionHash, pixels));
    }
    static_pixels(object, assets, cache).map(|pixels| (PixelSource::Static, pixels))
}

/// Parse un `.g4tx` une seule fois par clé. Un conteneur illisible est mémorisé comme absent,
/// pour ne pas le reparser à chaque objet qui le nomme.
fn parsed<'a>(
    cache: &'a mut BTreeMap<String, Option<g4tx::G4tx>>,
    assets: &dyn MenuAssets,
    key: &str,
) -> Option<&'a g4tx::G4tx> {
    cache
        .entry(key.to_string())
        .or_insert_with(|| assets.g4tx(key).and_then(|bytes| g4tx::parse(bytes).ok()))
        .as_ref()
}

/// Région d'atlas désignée par son NOM (`runtime.spriteRegion` + `runtime.spriteRegionG4tx`).
///
/// Un nom d'icône désigne soit une TEXTURE entière du conteneur, soit une région dans une
/// porteuse (`avatar01_13.g4tx` a les deux) : ne chercher que les sous-textures rendait l'atlas
/// complet à la place de la moitié des icônes.
fn region_pixels(
    object: &Value,
    assets: &dyn MenuAssets,
    cache: &mut BTreeMap<String, Option<g4tx::G4tx>>,
) -> Option<Pixels> {
    let runtime = &object["runtime"];
    let key = runtime["spriteRegionG4tx"].as_str()?;
    let region = runtime["spriteRegion"].as_str()?;
    let container = parsed(cache, assets, key)?;
    let bytes = assets.g4tx(key)?;
    match container.named(region)? {
        g4tx::NamedTarget::Texture(texture) => g4tx_decode::decode_texture_rgba(bytes, texture),
        g4tx::NamedTarget::Region { texture, sub } => {
            let (full_w, full_h, full) = g4tx_decode::decode_texture_rgba(bytes, texture)?;
            crop_rgba(&full, full_w, full_h, (sub.x, sub.y, sub.width, sub.height))
        }
    }
}

/// Région d'atlas désignée par le CRC32 de son nom (`runtime.spriteRegionHash`).
///
/// Sans cette résolution, un objet qui ne porte que le hash rendait l'atlas ENTIER — toutes ses
/// sous-textures empilées. Le hash peut être celui d'une TEXTURE du conteneur, pas seulement
/// d'une sous-texture : les textures sont donc essayées d'abord, comme `g4tx::find_named`.
fn region_hash_pixels(
    object: &Value,
    assets: &dyn MenuAssets,
    cache: &mut BTreeMap<String, Option<g4tx::G4tx>>,
) -> Option<Pixels> {
    let runtime = &object["runtime"];
    let hash = runtime["spriteRegionHash"]
        .as_u64()
        .or_else(|| {
            runtime["spriteRegionHash"]
                .as_str()
                .and_then(|text| text.strip_prefix("0x"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .map(u64::from)
        })
        .map(|value| value as u32)?;
    if hash == 0 {
        return None;
    }
    let logical = object["sprite"]["logicalPath"].as_str()?;
    let key = fourni(assets, logical)?;
    let container = parsed(cache, assets, key)?;
    let bytes = assets.g4tx(key)?;
    for texture in &container.textures {
        if cfgbin::crc32(texture.name.as_bytes()) == hash {
            return g4tx_decode::decode_texture_rgba(bytes, texture);
        }
    }
    for texture in &container.textures {
        for sub in &texture.sub_textures {
            if cfgbin::crc32(sub.name.as_bytes()) == hash {
                let (full_w, full_h, full) = g4tx_decode::decode_texture_rgba(bytes, texture)?;
                return crop_rgba(&full, full_w, full_h, (sub.x, sub.y, sub.width, sub.height));
            }
        }
    }
    None
}

/// Texture entière du conteneur nommé par `sprite.logicalPath`.
fn static_pixels(
    object: &Value,
    assets: &dyn MenuAssets,
    cache: &mut BTreeMap<String, Option<g4tx::G4tx>>,
) -> Option<Pixels> {
    let logical = object["sprite"]["logicalPath"].as_str()?;
    let key = fourni(assets, logical)?;
    let stem = basename(key).strip_suffix(".g4tx").unwrap_or_else(|| basename(key));
    let container = parsed(cache, assets, key)?;
    let texture = g4tx::select_main_texture(container, stem)?;
    let bytes = assets.g4tx(key)?;
    g4tx_decode::decode_texture_rgba(bytes, texture)
}

/// Le nom de fichier d'un chemin logique VFS.
fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// La clé que l'hôte a effectivement remplie pour ce chemin logique : le chemin entier d'abord,
/// son nom de fichier ensuite. Un hôte qui n'a que HTTP fournit le premier ; un hôte qui a
/// l'index du VFS peut n'avoir que le second.
fn fourni<'a>(assets: &dyn MenuAssets, logical: &'a str) -> Option<&'a str> {
    if assets.g4tx(logical).is_some() {
        return Some(logical);
    }
    let name = basename(logical);
    assets.g4tx(name).map(|_| name)
}

/// Le libellé RÉSOLU d'un objet de layout.
///
/// Le champ `text` est hétérogène : un hash `"0x…"` non résolu ou un nombre ne donnent rien à
/// rendre ; un tableau `[{slot, text}]` — la forme que produit le résolveur de texte universel —
/// donne la concaténation de ses `text` non vides. Un hash rendu tel quel afficherait une adresse
/// à la place d'un mot.
#[must_use]
pub fn resolved_text_label(text: &Value) -> Option<String> {
    let entries = text.as_array()?;
    let parts: Vec<&str> = entries
        .iter()
        .filter_map(|entry| entry.get("text").and_then(Value::as_str))
        .filter(|part| !part.is_empty() && !part.starts_with("0x"))
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some(parts.join(" "))
}

/// Rend un libellé dans sa propre boîte RGBA, recadrée sur l'avance RÉELLE.
///
/// La boîte de départ est une borne haute (une cellule carrée par caractère) ; la recadrer sur
/// l'avance rendue est nécessaire pour pouvoir l'ancrer, faute de quoi le texte serait décalé de
/// la moitié de son excédent.
fn render_label(menu_font: &MenuFont, label: &str) -> Option<Pixels> {
    let cell = u32::from(menu_font.metrics.dims.cell_height).max(1);
    let box_w = ((label.chars().count() as u32).max(1) * cell).max(cell);
    let mut buffer = vec![0u8; (box_w as usize) * (cell as usize) * 4];
    let advance = font::draw_text(
        &menu_font.atlas,
        menu_font.atlas_width,
        &menu_font.metrics,
        label,
        &mut buffer,
        box_w * 4,
        0,
        i32::from(menu_font.metrics.dims.ascent),
        [255, 255, 255, 255],
    );
    if advance <= 0 {
        return None; // aucun glyphe résolu
    }
    let width = u32::try_from(advance).unwrap_or(box_w).clamp(1, box_w);
    crop_rgba(&buffer, box_w, cell, (0, 0, width as i16, cell as i16))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un hôte de test sans le moindre octet : prouve que l'absence d'asset saute l'objet au lieu
    /// d'en inventer un.
    struct NoAssets;
    impl MenuAssets for NoAssets {
        fn g4tx(&self, _key: &str) -> Option<&[u8]> {
            None
        }
    }

    fn layout(objects: &str) -> String {
        format!("{{\"objects\":{objects}}}")
    }

    #[test]
    fn concatenates_layers_in_order_and_gates_placement() {
        let first = layout(
            r#"[{"visible":true,"transform":{"x":1.0},"placementSource":"attach-locator","sprite":{"logicalPath":"a/one.g4tx"}}]"#,
        );
        // Sans `transform`, la porte de placement refuse l'objet : il n'a pas de position établie.
        let second = layout(r#"[{"visible":true,"sprite":{"logicalPath":"a/two.g4tx"}}]"#);
        let parsed = MenuLayout::from_json(&[&first, &second]).expect("layouts lisibles");
        assert_eq!(parsed.object_count(), 1);
    }

    #[test]
    fn required_assets_names_both_texture_paths_once() {
        let json = layout(
            r#"[
              {"visible":true,"transform":{},"placementSource":"attach-locator",
               "runtime":{"spriteRegionG4tx":"menu/icon_rarity.g4tx","spriteRegion":"gtxt_rarity01_05"},
               "sprite":{"logicalPath":"menu/atlas/common.g4tx"}},
              {"visible":true,"transform":{},"placementSource":"attach-locator",
               "sprite":{"logicalPath":"other/common.g4tx"}},
              {"visible":false,"transform":{},"placementSource":"attach-locator",
               "sprite":{"logicalPath":"never/hidden.g4tx"}}
            ]"#,
        );
        let parsed = MenuLayout::from_json(&[&json]).expect("layout lisible");
        // Chaque objet demande son chemin logique ET son nom de fichier : le premier sert à un
        // hôte qui n'a que HTTP, le second à un hôte qui a l'index du VFS. `common.g4tx`, nommé
        // par deux objets sous deux chemins différents, n'apparaît qu'une fois sous ce nom ;
        // l'objet invisible ne demande rien.
        assert_eq!(
            parsed.required_assets(),
            [
                "menu/icon_rarity.g4tx",
                "menu/atlas/common.g4tx",
                "common.g4tx",
                "other/common.g4tx"
            ]
        );
    }

    #[test]
    fn missing_assets_skip_objects_instead_of_inventing_pixels() {
        let json = layout(
            r#"[{"visible":true,"transform":{"x":10.0,"y":10.0},"placementSource":"attach-locator",
                 "sprite":{"logicalPath":"absent/nothing.g4tx"}}]"#,
        );
        let parsed = MenuLayout::from_json(&[&json]).expect("layout lisible");
        let composed = parsed.compose(&NoAssets, 8, 4);
        assert_eq!(composed.rgba.len(), 8 * 4 * 4);
        assert!(composed.rgba.iter().all(|byte| *byte == 0), "canevas intact");
        assert_eq!(composed.report.drawn, 0);
        assert_eq!(composed.report.skipped, 1);
    }

    #[test]
    fn text_labels_ignore_unresolved_hashes_and_numbers() {
        assert_eq!(resolved_text_label(&serde_json::json!(12)), None);
        assert_eq!(
            resolved_text_label(&serde_json::json!([{"text":"0x1a2b3c4d"}])),
            None
        );
        assert_eq!(
            resolved_text_label(&serde_json::json!([{"text":"MODE"},{"text":""},{"text":"HISTOIRE"}]))
                .as_deref(),
            Some("MODE HISTOIRE")
        );
    }

    /// Le garde de placement, côté compositeur : un objet qui DÉCLARE ne pas savoir où il est
    /// n'est pas dessiné, même s'il porte un transform et qu'il est visible. Ce garde vivait
    /// aussi dans un rendu DOM parallèle (`layout-render.tsx`) ; il n'a plus qu'une maison.
    #[test]
    fn an_unresolved_placement_is_never_painted() {
        let json = layout(
            r#"[
              {"visible":true,"transform":{"x":640.0,"y":360.0},"placementSource":"unresolved",
               "sprite":{"logicalPath":"menu/unknown.g4tx"}},
              {"visible":true,"transform":{"x":640.0,"y":360.0},"placementSource":"g4pkm-pose",
               "sprite":{"logicalPath":"menu/measured.g4tx"}}
            ]"#,
        );
        let parsed = MenuLayout::from_json(&[&json]).expect("layout lisible");
        assert_eq!(parsed.object_count(), 1, "seul l'objet placé passe la porte");
        assert_eq!(parsed.required_assets(), ["menu/measured.g4tx", "measured.g4tx"]);
    }

    #[test]
    fn an_unknown_visibility_is_drawn_only_under_the_static_policy() {
        // C'est exactement le layout que `nie-site` publie : `visible` non résolu, et il le dit.
        let json = layout(
            r#"[{"visible":null,"transform":{},"placementSource":"attach-locator",
                 "sprite":{"logicalPath":"menu/one.g4tx"}}]"#,
        );
        let declared = MenuLayout::from_json(&[&json]).expect("layout lisible");
        assert!(declared.required_assets().is_empty(), "rien n'est déclaré visible");
        let statique = MenuLayout::from_json(&[&json])
            .expect("layout lisible")
            .with_visibility(Visibility::UnknownCounts);
        assert_eq!(statique.required_assets(), ["menu/one.g4tx", "one.g4tx"]);
    }

    #[test]
    fn an_explicit_false_hides_under_both_policies() {
        let json = layout(
            r#"[{"visible":false,"transform":{},"placementSource":"attach-locator",
                 "sprite":{"logicalPath":"menu/hidden.g4tx"}}]"#,
        );
        for politique in [Visibility::Declared, Visibility::UnknownCounts] {
            let parsed = MenuLayout::from_json(&[&json])
                .expect("layout lisible")
                .with_visibility(politique);
            assert!(parsed.required_assets().is_empty(), "caché sous {politique:?}");
        }
    }

    #[test]
    fn a_mismatched_canvas_is_replaced_rather_than_panicking() {
        let parsed = MenuLayout::from_json(&[&layout("[]")]).expect("layout vide lisible");
        let composed = parsed.compose_over(vec![9u8; 3], 4, 2, &NoAssets);
        assert_eq!(composed.rgba.len(), 4 * 2 * 4);
        assert!(composed.rgba.iter().all(|byte| *byte == 0));
    }
}
