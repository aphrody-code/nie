//! Pont facultatif WebGPU du renderer NIE, feature `webgpu` (désactivée par défaut).
//!
//! ```text
//! cargo build -p nie-wasm --target wasm32-unknown-unknown --release --features webgpu
//! wasm-bindgen target/wasm32-unknown-unknown/release/nie_wasm.wasm --target web --out-dir pkg-webgpu
//!
//! import init, { WebGpuViewer } from './pkg-webgpu/nie_wasm.js';
//! await init();
//! const viewer = await WebGpuViewer.create(canvas);
//! console.log(JSON.parse(viewer.backend_info())); // backend réellement obtenu
//! viewer.load_glb(new Uint8Array(await file.arrayBuffer()));
//! viewer.resize(1280, 720); // pixels physiques, calcul DPR à la charge de l'hôte
//! viewer.orbit(0.6, 0.2, 3.1); // angles absolus en radians, distance en rayons
//! viewer.render(); // true = présenté, false = frame sautée ; appeler dans le RAF de l'hôte
//! viewer.free(); // arrêter le RAF avant ; libère le device dédié
//! ```
//!
//! `create` renvoie une Promise ; les autres méthodes sont synchrones et lèvent sur erreur.
//! Exige HTTPS/localhost et Browser WebGPU ; pas de fallback WebGL/CPU, pas de readback.
//! GLB limité à 64 Mio et textures RGBA décodées limitées à 128 Mio. Le parseur NIE cuit les
//! transforms de nœuds et le skinning de la pose de liaison dans les sommets. Animations, morph
//! targets, codecs compressés et matériaux glTF complets ne sont pas gérés.
//! La version du CLI wasm-bindgen doit correspondre au pin exact du workspace.

use nie_render3d::web::WebViewer;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Viewer canvas WebGPU partagé avec NIE natif. `free()` est généré par wasm-bindgen.
#[wasm_bindgen]
pub struct WebGpuViewer {
    inner: WebViewer,
}

#[wasm_bindgen]
impl WebGpuViewer {
    /// Initialise une surface WebGPU compatible avec le canvas ; échec sans fallback.
    pub async fn create(canvas: HtmlCanvasElement) -> Result<WebGpuViewer, JsValue> {
        Ok(Self {
            inner: WebViewer::new(canvas).await.map_err(js_error)?,
        })
    }

    /// Avatar canvas composited over the native menu's independent VFS layers.
    pub async fn create_transparent(canvas: HtmlCanvasElement) -> Result<WebGpuViewer, JsValue> {
        Ok(Self {
            inner: WebViewer::with_transparency(canvas, true)
                .await
                .map_err(js_error)?,
        })
    }

    /// Charge/remplace un modèle GLB normalisé (positions monde, textures PNG embarquées).
    pub fn load_glb(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        self.inner.load_glb(bytes).map_err(js_error)
    }

    /// Angles absolus en radians ; distance positive en rayons. NaN/infini rejetés.
    pub fn orbit(&mut self, yaw: f32, pitch: f32, distance: f32) -> Result<(), JsValue> {
        self.inner.orbit(yaw, pitch, distance).map_err(js_error)
    }

    /// Backing store en pixels entiers strictement positifs, sans changer le CSS.
    pub fn resize(&mut self, width: f64, height: f64) -> Result<(), JsValue> {
        self.inner.resize(width, height).map_err(js_error)
    }

    /// Présente via la texture GPU partagée ; false demande de réessayer à la prochaine frame.
    pub fn render(&mut self) -> Result<bool, JsValue> {
        self.inner.render().map_err(js_error)
    }


    /// Affiche ou masque la grille de sol.
    ///
    /// C'est l'une des quatre capacités pour lesquelles le viewport three.js de l'éditeur
    /// survivait ; les trois autres sont le fil de fer, le contour de sélection et le gizmo.
    pub fn set_grid(&mut self, visible: bool) {
        self.inner.set_grid(visible);
    }

    /// Choisit ce que le gizmo manipule : `"translate"`, `"rotate"`, `"scale"`.
    ///
    /// Un nom inconnu retombe sur la translation plutôt que de désactiver le gizmo : un outil qui
    /// disparaît sur une faute de frappe se lit comme un bug d'affichage.
    pub fn set_gizmo_mode(&mut self, mode: &str) {
        self.inner.set_gizmo_mode(match mode {
            "rotate" => nie_render3d::web::GizmoMode::Rotate,
            "scale" => nie_render3d::web::GizmoMode::Scale,
            _ => nie_render3d::web::GizmoMode::Translate,
        });
    }

    /// L'angle de rotation autour de l'axe nommé, en radians. `NaN` si indéterminé.
    ///
    /// `NaN` plutôt qu'un `Option` : il traverse `wasm_bindgen` comme un nombre, et l'appelant
    /// le teste par `Number.isNaN` — là où un `Option<f32>` deviendrait un `JsValue` à
    /// inspecter. Zéro serait un mauvais choix : c'est une rotation valide.
    #[must_use]
    pub fn gizmo_rotate(&self, axis: &str, from_x: f32, from_y: f32, to_x: f32, to_y: f32) -> f32 {
        axe_depuis(axis)
            .and_then(|a| self.inner.gizmo_rotate(a, from_x, from_y, to_x, to_y))
            .unwrap_or(f32::NAN)
    }

    /// Le facteur d'échelle le long de l'axe nommé. `NaN` si indéterminé.
    #[must_use]
    pub fn gizmo_scale(&self, axis: &str, from_x: f32, from_y: f32, to_x: f32, to_y: f32) -> f32 {
        axe_depuis(axis)
            .and_then(|a| self.inner.gizmo_scale(a, from_x, from_y, to_x, to_y))
            .unwrap_or(f32::NAN)
    }

    /// L'axe du gizmo sous le pixel : `"x"`, `"y"`, `"z"`, ou chaîne vide si aucune poignée.
    ///
    /// Une chaîne plutôt qu'un entier : `wasm_bindgen` traverse les deux aussi bien, et un `"x"`
    /// se lit dans un journal de navigateur là où un `0` demande de retrouver la convention.
    #[must_use]
    pub fn gizmo_axis_at(&self, x: f32, y: f32) -> String {
        match self.inner.gizmo_axis_at(x, y) {
            Some(nie_render3d::gizmo::Axis::X) => "x".to_owned(),
            Some(nie_render3d::gizmo::Axis::Y) => "y".to_owned(),
            Some(nie_render3d::gizmo::Axis::Z) => "z".to_owned(),
            None => String::new(),
        }
    }

    /// Le déplacement monde entre deux pixels, contraint à l'axe nommé.
    ///
    /// Rend `[dx, dy, dz]`, ou un tableau vide quand l'axe est inconnu ou qu'un des deux rayons
    /// ne rencontre pas le plan de contrainte — l'hôte laisse alors l'objet où il est.
    #[must_use]
    pub fn gizmo_drag(&self, axis: &str, from_x: f32, from_y: f32, to_x: f32, to_y: f32) -> Vec<f32> {
        let Some(axe) = axe_depuis(axis) else {
            return Vec::new();
        };
        self.inner
            .gizmo_drag(axe, from_x, from_y, to_x, to_y)
            .map_or_else(Vec::new, |d| d.to_vec())
    }

    /// Affiche ou masque le fil de fer du modèle.
    pub fn set_wireframe(&mut self, visible: bool) {
        self.inner.set_wireframe(visible);
    }

    /// Sélectionne un objet du document — l'identifiant est celui que `pick_json` rend.
    ///
    /// Passer une chaîne vide efface la sélection : `Option<&str>` traverse `wasm_bindgen` en
    /// `JsValue`, ce qui coûterait à l'appelant une vérification de type pour une valeur qu'il
    /// teste déjà.
    pub fn select(&mut self, id: &str) {
        self.inner.select(if id.is_empty() { None } else { Some(id) });
    }

    /// L'objet sélectionné, chaîne vide s'il n'y en a pas.
    #[must_use]
    pub fn selected(&self) -> String {
        self.inner.selected().unwrap_or_default().to_owned()
    }
    /// Décode un asset GLB et le garde sous le chemin que le document de scène lui donne.
    pub fn stage_asset(&mut self, asset: &str, bytes: &[u8]) -> Result<(), JsValue> {
        self.inner.stage_asset(asset, bytes).map_err(js_error)
    }

    /// Oublie les assets déposés ; le modèle déjà affiché n'est pas touché.
    pub fn clear_assets(&mut self) {
        self.inner.clear_assets();
    }

    /// Compose et affiche un document de scène v2 depuis les assets déposés.
    ///
    /// Plusieurs objets, leur hiérarchie et leur TRS complet : ce qu'un éditeur montre, là où
    /// `load_glb` n'affiche qu'un modèle. `pick_json` nomme alors l'objet touché.
    pub fn load_scene(&mut self, document_json: &str) -> Result<(), JsValue> {
        self.inner.load_scene(document_json).map_err(js_error)
    }

    /// La surface sous le pixel `(x, y)` du backing store, en JSON, ou `undefined` sur le fond.
    ///
    /// `{"primitive":n,"triangle":n,"distance":f,"point":[x,y,z]}`. La caméra inversée est celle
    /// de l'image courante, par la même base orbitale que la matrice de vue.
    pub fn pick_json(&self, x: f32, y: f32) -> Option<String> {
        self.inner.pick_json(x, y)
    }

    /// JSON d'identité mesurée. Le navigateur peut anonymiser nom/vendor/device.
    pub fn backend_info(&self) -> String {
        let info = self.inner.adapter_info();
        serde_json::json!({ "backend": format!("{:?}", info.backend), "name": info.name,
            "deviceType": format!("{:?}", info.device_type), "vendor": info.vendor,
            "device": info.device, "surfaceFormat": format!("{:?}", self.inner.surface_format()),
            "readback": false })
        .to_string()
    }
}

/// Traduit un nom d'axe vers le type du moteur ; `None` sur un nom inconnu.
fn axe_depuis(axis: &str) -> Option<nie_render3d::gizmo::Axis> {
    match axis {
        "x" => Some(nie_render3d::gizmo::Axis::X),
        "y" => Some(nie_render3d::gizmo::Axis::Y),
        "z" => Some(nie_render3d::gizmo::Axis::Z),
        _ => None,
    }
}
