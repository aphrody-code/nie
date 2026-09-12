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
