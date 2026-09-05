//! Éditeur NIE natif : document partagé, inspection et viewport sur le même device GPU que l'UI.
use anyhow::{Context, Result};
use clap::Parser;
use eframe::{egui, egui_wgpu, wgpu};
use nie_render3d::{
    document::{SceneDocument, SceneObject},
    glb,
    gpu::{Backend, Camera, GpuModel, GpuRenderer},
};
use std::{collections::HashMap, path::PathBuf};

#[derive(Parser)]
#[command(about = "Éditeur 3D NIE natif — DirectX 12 / Vulkan / OpenGL")]
struct Cli {
    /// Modèle GLB à importer au démarrage.
    #[arg(long)]
    glb: Option<PathBuf>,
    /// Projet JSON à ouvrir ou à créer.
    #[arg(long)]
    project: Option<PathBuf>,
    /// Backend strict : dx12 sur Windows, vulkan sur Linux par défaut ; gl disponible.
    #[arg(long)]
    backend: Option<Backend>,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let backend = cli.backend.unwrap_or_default();
    let mut setup = egui_wgpu::WgpuSetupCreateNew::without_display_handle();
    setup.instance_descriptor.backends = backend.backends();
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default().with_inner_size([1280., 800.]),
        renderer: eframe::Renderer::Wgpu,
        wgpu_options: egui_wgpu::WgpuConfiguration {
            wgpu_setup: setup.into(),
            ..Default::default()
        },
        ..Default::default()
    };
    eframe::run_native(
        "NIE Studio",
        options,
        Box::new(move |cc| Ok(Box::new(Studio::new(cc, cli)?))),
    )
    .map_err(|e| anyhow::anyhow!("éditeur natif : {e}"))
}

struct Studio {
    renderer: GpuRenderer,
    render_state: egui_wgpu::RenderState,
    gpu_model: Option<GpuModel>,
    texture: Option<egui::TextureId>,
    document: SceneDocument,
    undo: Vec<SceneDocument>,
    redo: Vec<SceneDocument>,
    pending_edit: Option<SceneDocument>,
    assets: HashMap<String, glb::Model>,
    selected: Option<usize>,
    camera: Camera,
    framing: Option<([f32; 3], f32)>,
    asset_path: String,
    project_path: String,
    status: String,
    dirty: bool,
}

impl Studio {
    fn new(cc: &eframe::CreationContext<'_>, cli: Cli) -> Result<Self> {
        cc.egui_ctx.set_visuals(egui::Visuals::dark());
        let state = cc.wgpu_render_state.clone().context("device GPU absent")?;
        let info = state.adapter.get_info();
        println!(
            "NIE Studio backend={:?} adapter={:?} type={:?}",
            info.backend, info.name, info.device_type
        );
        let mut studio = Self {
            renderer: GpuRenderer::from_device(info, state.device.clone(), state.queue.clone()),
            render_state: state,
            gpu_model: None,
            texture: None,
            document: SceneDocument::default(),
            undo: vec![],
            redo: vec![],
            pending_edit: None,
            assets: HashMap::new(),
            selected: None,
            camera: Camera::default(),
            framing: None,
            asset_path: String::new(),
            project_path: cli
                .project
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default(),
            status: "Importez un GLB ou ouvrez un projet NIE.".into(),
            dirty: true,
        };
        if let Some(path) = cli.project.filter(|p| p.exists()) {
            studio.open_project(&path)?;
        }
        if let Some(path) = cli.glb {
            studio.import(&path)?;
        }
        Ok(studio)
    }

    fn checkpoint(&mut self, before: SceneDocument) {
        if before == self.document {
            return;
        }
        self.undo.push(before);
        if self.undo.len() > 100 {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.dirty = true;
    }

    fn import(&mut self, path: &std::path::Path) -> Result<()> {
        let path = path
            .canonicalize()
            .with_context(|| format!("asset {}", path.display()))?;
        let key = path.to_string_lossy().into_owned();
        let model = glb::parse(&std::fs::read(&path)?)?;
        anyhow::ensure!(self.document.objects.len() < 128, "maximum 128 objets");
        let before = self.document.clone();
        self.assets.insert(key.clone(), model);
        self.document.objects.push(SceneObject {
            name: path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            asset: key,
            position: [0.; 3],
            yaw: 0.,
            scale: [1.; 3],
            visible: true,
        });
        self.selected = Some(self.document.objects.len() - 1);
        self.framing = None;
        self.checkpoint(before);
        self.status = "Modèle importé dans la scène.".into();
        Ok(())
    }

    fn open_project(&mut self, path: &std::path::Path) -> Result<()> {
        let bytes = std::fs::read(path)?;
        anyhow::ensure!(bytes.len() < 1_000_000, "projet trop volumineux");
        let document: SceneDocument = serde_json::from_slice(&bytes)?;
        document.validate()?;
        let mut assets = HashMap::new();
        for object in &document.objects {
            let asset = path
                .parent()
                .unwrap_or(std::path::Path::new("."))
                .join(&object.asset);
            assets.insert(object.asset.clone(), glb::parse(&std::fs::read(asset)?)?);
        }
        self.document = document;
        self.assets = assets;
        self.undo.clear();
        self.redo.clear();
        self.pending_edit = None;
        self.selected = None;
        self.framing = None;
        self.dirty = true;
        self.status = "Projet ouvert.".into();
        Ok(())
    }

    fn rebuild(&mut self) -> Result<()> {
        let model = self.document.compose(|path| {
            self.assets
                .get(path)
                .cloned()
                .with_context(|| format!("asset manquant : {path}"))
        })?;
        let mut gpu_model = self.renderer.upload(&model);
        let (center, radius) = *self
            .framing
            .get_or_insert_with(|| nie_render3d::render::bounds(&model));
        gpu_model.set_framing(center, radius.max(0.001))?;
        self.gpu_model = Some(gpu_model);
        self.dirty = false;
        Ok(())
    }
}

impl Studio {
    fn studio_ui(&mut self, ui: &mut egui::Ui) {
        let mut result: Result<()> = Ok(());
        ui.horizontal(|ui| {
            ui.heading("NIE Studio");
            ui.label(format!(
                "{:?} · {}",
                self.renderer.adapter_info().backend,
                self.renderer.adapter_info().name
            ));
        });
        ui.horizontal(|ui| {
            ui.label("GLB");
            ui.text_edit_singleline(&mut self.asset_path);
            if ui.button("Importer").clicked() {
                result = self.import(&PathBuf::from(&self.asset_path));
            }
            if ui
                .add_enabled(!self.undo.is_empty(), egui::Button::new("Annuler"))
                .clicked()
                && let Some(previous) = self.undo.pop()
            {
                self.redo
                    .push(std::mem::replace(&mut self.document, previous));
                self.dirty = true;
            }
            if ui
                .add_enabled(!self.redo.is_empty(), egui::Button::new("Rétablir"))
                .clicked()
                && let Some(next) = self.redo.pop()
            {
                self.undo.push(std::mem::replace(&mut self.document, next));
                self.dirty = true;
            }
        });
        ui.horizontal(|ui| {
            ui.label("Projet");
            ui.text_edit_singleline(&mut self.project_path);
            if ui.button("Ouvrir").clicked() {
                result = self.open_project(&PathBuf::from(&self.project_path));
            }
            if ui.button("Enregistrer").clicked() {
                result = (|| {
                    self.document.validate()?;
                    std::fs::write(
                        &self.project_path,
                        serde_json::to_vec_pretty(&self.document)?,
                    )?;
                    self.status = "Projet enregistré.".into();
                    Ok(())
                })();
            }
            if ui.button("Recadrer").clicked() {
                self.camera = Camera::default();
                self.framing = None;
                self.dirty = true;
            }
        });
        ui.separator();
        let before = self.document.clone();
        egui::Panel::left("hierarchie")
            .default_size(280.)
            .show_inside(ui, |pane| {
                pane.heading("Scène");
                for (index, object) in self.document.objects.iter().enumerate() {
                    if pane
                        .selectable_label(self.selected == Some(index), &object.name)
                        .clicked()
                    {
                        self.selected = Some(index);
                    }
                }
                if let Some(index) = self.selected.filter(|i| *i < self.document.objects.len()) {
                    let object = &mut self.document.objects[index];
                    pane.separator();
                    pane.heading("Inspecteur");
                    pane.text_edit_singleline(&mut object.name);
                    pane.checkbox(&mut object.visible, "Visible");
                    for axis in 0..3 {
                        pane.horizontal(|ui| {
                            ui.label(["X", "Y", "Z"][axis]);
                            ui.add(
                                egui::DragValue::new(&mut object.position[axis])
                                    .speed(0.01)
                                    .range(-1e6..=1e6),
                            );
                        });
                    }
                    pane.add(egui::Slider::new(&mut object.yaw, -180.0..=180.0).text("Rotation Y"));
                    for axis in 0..3 {
                        pane.add(
                            egui::Slider::new(&mut object.scale[axis], 0.01..=10.)
                                .text(format!("Échelle {}", ["X", "Y", "Z"][axis])),
                        );
                    }
                    if pane.button("Dupliquer").clicked() && self.document.objects.len() < 128 {
                        let mut copy = self.document.objects[index].clone();
                        copy.position[0] += 1.;
                        self.document.objects.push(copy);
                    }
                    if pane.button("Supprimer").clicked() {
                        self.document.objects.remove(index);
                        self.selected = None;
                    }
                }
            });
        if before != self.document && ui.input(|input| input.pointer.primary_down()) {
            self.pending_edit.get_or_insert(before);
            self.dirty = true;
        } else if !ui.input(|input| input.pointer.primary_down()) {
            if let Some(start) = self.pending_edit.take() {
                self.checkpoint(start);
            } else {
                self.checkpoint(before);
            }
        }
        if self.dirty
            && let Err(error) = self.rebuild()
        {
            self.status = error.to_string();
        }
        egui::CentralPanel::default().show_inside(ui, |pane| {
            let size = pane.available_size().max(egui::vec2(1., 1.));
            if let Some(model) = &self.gpu_model {
                let pixels = pane.ctx().pixels_per_point();
                match self.renderer.render_to_texture(
                    model,
                    self.camera,
                    (size.x * pixels) as u32,
                    (size.y * pixels) as u32,
                ) {
                    Ok(view) => {
                        let mut painter = self.render_state.renderer.write();
                        let id = if let Some(id) = self.texture {
                            painter.update_egui_texture_from_wgpu_texture(
                                &self.render_state.device,
                                &view,
                                wgpu::FilterMode::Linear,
                                id,
                            );
                            id
                        } else {
                            let id = painter.register_native_texture(
                                &self.render_state.device,
                                &view,
                                wgpu::FilterMode::Linear,
                            );
                            self.texture = Some(id);
                            id
                        };
                        drop(painter);
                        let response =
                            pane.add(egui::Image::new((id, size)).sense(egui::Sense::drag()));
                        if response.dragged() {
                            let delta = pane.input(|i| i.pointer.delta());
                            self.camera.yaw -= delta.x * 0.008;
                            self.camera.pitch += delta.y * 0.008;
                            self.camera = self.camera.clamped();
                            pane.ctx().request_repaint();
                        }
                        if response.hovered() {
                            let scroll = pane.input(|i| i.smooth_scroll_delta.y);
                            if scroll != 0. {
                                self.camera.distance *= (-scroll * 0.002).exp();
                                self.camera = self.camera.clamped();
                                pane.ctx().request_repaint();
                            }
                        }
                    }
                    Err(error) => self.status = error.to_string(),
                }
            }
        });
        if let Err(error) = result {
            self.status = error.to_string();
        }
        ui.label(&self.status);
        for dropped in ui.ctx().input(|i| i.raw.dropped_files.clone()) {
            if let Some(path) = dropped.path
                && let Err(error) = self.import(&path)
            {
                self.status = error.to_string();
            }
        }
    }
}

impl eframe::App for Studio {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default().show_inside(ui, |ui| self.studio_ui(ui));
    }
}
