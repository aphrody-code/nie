//! Le viewer 3D du dépôt, seul dans son module, avec le backend WebGL 2.
//!
//! ## Pourquoi un SECOND module
//!
//! `nie-wasm` embarque déjà ce viewer, mais sur `BROWSER_WEBGPU` uniquement. Lui ajouter
//! `wgpu/webgl` ferait tourner le même renderer là où WebGPU manque — et rendrait supprimables
//! les 445 lignes de `apps/nie-web/src/avatar/webgl-viewer.ts`, une seconde implémentation qui
//! dérive par construction puisqu'elle ne partage aucune ligne avec le renderer que ce dépôt
//! vérifie.
//!
//! Mesuré le 2026-09-12 : activer `wgpu/webgl` dans `nie-wasm` porte son module de 4 518 833 à
//! 6 865 774 octets, soit 574 318 de plus que le budget de 6 Mio qu'impose
//! `apps/nie-web/scripts/build-wasm.ts`. Ce budget protège ce que **chaque** visiteur télécharge,
//! pas seulement ceux qui ouvrent un modèle : le relever pour un chemin minoritaire ferait payer
//! la majorité.
//!
//! D'où ce module. Il ne porte QUE le viewer, il n'est téléchargé que par un navigateur sans
//! WebGPU, et il fait disparaître la réimplémentation TypeScript sans rien coûter aux autres.
//!
//! ## Ce qu'il ne fait pas
//!
//! Aucun repli propre : si WebGL 2 manque aussi, `create` échoue et l'hôte retombe sur le
//! rastériseur CPU de `nie-wasm`. Rien ici ne dessine en cas d'échec — un canvas vide se
//! remarque, une image inventée non.

// `nie_render3d::web::WebViewer` n'existe que sur `wasm32` : il tient une surface de canvas. Le
// reste du fichier l'est aussi, mais l'import doit l'être explicitement, sinon la crate ne
// compile pas sur l'hôte — et `cargo clippy --workspace --all-targets`, le gate du dépôt,
// compile TOUT en natif.
#[cfg(target_arch = "wasm32")]
use nie_render3d::web::WebViewer;
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use web_sys::HtmlCanvasElement;

/// Installe le crochet de panique pour que la console nomme la ligne fautive.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

#[cfg(target_arch = "wasm32")]
fn js_error(error: impl core::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Le viewer, présenté au navigateur.
///
/// Même surface que `WebGpuViewer` de `nie-wasm` — mêmes noms, mêmes signatures — pour que
/// l'hôte puisse permuter les deux sans adaptateur.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct ModelViewer {
    inner: WebViewer,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl ModelViewer {
    /// Initialise une surface sur le canvas. Échoue si ni WebGPU ni WebGL 2 ne répondent.
    pub async fn create(canvas: HtmlCanvasElement) -> Result<ModelViewer, JsValue> {
        Ok(Self {
            inner: WebViewer::new(canvas).await.map_err(js_error)?,
        })
    }

    /// La même chose, en laissant voir ce qui est derrière le canvas.
    pub async fn create_transparent(canvas: HtmlCanvasElement) -> Result<ModelViewer, JsValue> {
        Ok(Self {
            inner: WebViewer::with_transparency(canvas, true)
                .await
                .map_err(js_error)?,
        })
    }

    /// Charge ou remplace le modèle GLB affiché.
    pub fn load_glb(&mut self, bytes: &[u8]) -> Result<(), JsValue> {
        self.inner.load_glb(bytes).map_err(js_error)
    }

    /// Caméra absolue : angles en radians, distance en rayons du modèle.
    pub fn orbit(&mut self, yaw: f32, pitch: f32, distance: f32) -> Result<(), JsValue> {
        self.inner.orbit(yaw, pitch, distance).map_err(js_error)
    }

    /// Dimensions en pixels PHYSIQUES ; le calcul du ratio appartient à l'hôte.
    pub fn resize(&mut self, width: f64, height: f64) -> Result<(), JsValue> {
        self.inner.resize(width, height).map_err(js_error)
    }

    /// Présente une image. `false` quand il n'y a rien à présenter.
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

    /// Le backend RÉELLEMENT obtenu, en JSON — WebGPU ou WebGL selon ce que le moteur offrait.
    ///
    /// Publié parce que la différence est observable à l'écran et qu'un diagnostic vaut mieux
    /// qu'une supposition : les deux backends ne rendent pas exactement les mêmes pixels. Le
    /// format suit celui de `WebGpuViewer::backend_info` de `nie-wasm`, pour qu'un hôte lise les
    /// deux avec le même code.
    pub fn backend_info(&self) -> String {
        let info = self.inner.adapter_info();
        serde_json::json!({
            "backend": format!("{:?}", info.backend),
            "name": info.name,
            "deviceType": format!("{:?}", info.device_type),
            "vendor": info.vendor,
            "device": info.device,
            "surfaceFormat": format!("{:?}", self.inner.surface_format()),
            "readback": false,
        })
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
