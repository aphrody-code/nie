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
//! GLB limité à 64 Mio, parseur NIE existant : positions déjà en espace monde, PNG embarqués.
//! Transforms de nœuds, skins, animations, codecs compressés et matériaux glTF complets ne
//! sont pas gérés. L'hôte doit normaliser ses GLB, pas présenter ce pont comme universel.
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
