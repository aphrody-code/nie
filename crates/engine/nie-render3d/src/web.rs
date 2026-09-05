//! Présentation WebGPU du renderer partagé, sans readback ni boucle d'animation propre.
//!
//! L'hôte fournit un canvas (contexte sécurisé HTTPS/localhost), les dimensions physiques,
//! les octets GLB et les appels `render` depuis sa boucle requestAnimationFrame.
//! Pas de repli WebGL/CPU. Le parseur GLB existant attend des positions déjà normalisées en
//! espace monde : transforms de nœuds, skins, animations et matériaux glTF complets ne sont
//! pas interprétés ici. Cette surface n'est pas un importateur glTF universel.

use crate::gpu::Camera;
use anyhow::{Result, ensure};

// Quad de présentation testé avec Naga en natif, utilisé tel quel dans le navigateur.
#[cfg(any(target_arch = "wasm32", test))]
const PRESENT: &str = r"
@group(0) @binding(0) var image: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = array<vec2<f32>, 6>(vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.),
        vec2(-1., 1.), vec2(1., -1.), vec2(1., 1.));
    return vec4(p[i], 0., 1.);
}
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(image, vec2<i32>(p.xy), 0);
    return vec4(c.rgb * c.a, 1.);
}";

/// Caméra absolue : angles en radians, distance en rayons du modèle. Rejette NaN/infini.
/// Le tangage et la distance suivent les mêmes bornes que le viewport natif.
pub fn checked_camera(yaw: f32, pitch: f32, distance: f32) -> Result<Camera> {
    ensure!(
        yaw.is_finite() && pitch.is_finite() && distance.is_finite(),
        "caméra non finie"
    );
    ensure!(distance > 0.0, "distance de caméra non positive");
    Ok(Camera {
        yaw: yaw.rem_euclid(std::f32::consts::TAU),
        pitch,
        distance,
    }
    .clamped())
}

/// Dimensions de backing store en pixels, pas en unités CSS. Aucun arrondi implicite JS.
pub fn checked_size(width: f64, height: f64, limit: u32) -> Result<(u32, u32)> {
    for value in [width, height] {
        ensure!(
            value.is_finite() && value >= 1.0 && value <= f64::from(limit) && value.fract() == 0.0,
            "dimensions entières requises entre 1 et {limit}"
        );
    }
    // Bornes et intégralité vérifiées avant conversion.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    Ok((width as u32, height as u32))
}

#[cfg(target_arch = "wasm32")]
pub use browser::WebViewer;

#[cfg(target_arch = "wasm32")]
mod browser {
    use super::{PRESENT, checked_camera, checked_size};
    use crate::{
        glb,
        gpu::{Camera, GpuModel, GpuRenderer},
    };
    use anyhow::{Context, Result, bail, ensure};
    use std::sync::{Arc, Mutex};
    use web_sys::HtmlCanvasElement;

    /// Hôte WebGPU d'un modèle NIE. Aucun événement DOM ni requestAnimationFrame installé.
    /// La destruction libère le device dédié ; après perte GPU il faut recréer l'hôte.
    pub struct WebViewer {
        canvas: HtmlCanvasElement,
        surface: wgpu::Surface<'static>,
        config: wgpu::SurfaceConfiguration,
        renderer: GpuRenderer,
        model: Option<GpuModel>,
        camera: Camera,
        layout: wgpu::BindGroupLayout,
        pipeline: wgpu::RenderPipeline,
        /// Le rendu partagé conserve sa texture cible tant que le canvas garde ses dimensions.
        /// Le bind group de présentation peut donc être conservé lui aussi au lieu d'être créé
        /// à chaque `requestAnimationFrame`.
        presentation_bind: Option<wgpu::BindGroup>,
        lost: Arc<Mutex<Option<String>>>,
    }

    impl WebViewer {
        /// Initialise un device dédié compatible avec le canvas, exclusivement BrowserWebGpu.
        /// Les dimensions initiales viennent des attributs width/height du canvas.
        pub async fn new(canvas: HtmlCanvasElement) -> Result<Self> {
            let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
            descriptor.backends = wgpu::Backends::BROWSER_WEBGPU;
            let instance = wgpu::Instance::new(descriptor);
            let surface = instance
                .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
                .context("création de la surface canvas WebGPU")?;
            let adapter = instance
                .request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    force_fallback_adapter: false,
                    compatible_surface: Some(&surface),
                })
                .await
                .context(
                    "WebGPU indisponible : navigateur compatible et contexte sécurisé requis",
                )?;
            let info = adapter.get_info();
            ensure!(
                info.backend == wgpu::Backend::BrowserWebGpu,
                "backend obtenu différent de WebGPU"
            );
            let (device, queue) = adapter
                .request_device(&wgpu::DeviceDescriptor {
                    label: Some("NIE canvas WebGPU"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::default(),
                    trace: wgpu::Trace::Off,
                    experimental_features: wgpu::ExperimentalFeatures::disabled(),
                })
                .await
                .context("création du device WebGPU")?;
            let (width, height) = checked_size(
                f64::from(canvas.width()),
                f64::from(canvas.height()),
                device.limits().max_texture_dimension_2d,
            )?;
            let caps = surface.get_capabilities(&adapter);
            let mut config = surface
                .get_default_config(&adapter, width, height)
                .context("canvas incompatible avec l'adaptateur")?;
            // Le renderer partagé écrit déjà ses couleurs dans Rgba8Unorm, pas en sRGB linéaire.
            config.format = caps
                .formats
                .iter()
                .copied()
                .find(|f| {
                    matches!(
                        f,
                        wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
                    )
                })
                .context("surface WebGPU sans format RGBA/BGRA unorm compatible")?;
            config.alpha_mode = wgpu::CompositeAlphaMode::Opaque;
            ensure!(
                caps.alpha_modes.contains(&config.alpha_mode),
                "surface opaque non supportée"
            );
            let validation = device.push_error_scope(wgpu::ErrorFilter::Validation);
            surface.configure(&device, &config);
            let lost = Arc::new(Mutex::new(None));
            let signal = Arc::clone(&lost);
            device.set_device_lost_callback(move |reason, message| {
                if let Ok(mut state) = signal.lock() {
                    *state = Some(format!("{reason:?}: {message}"));
                }
            });
            let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("NIE présentation"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                }],
            });
            let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("NIE présentation"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            });
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("NIE quad canvas"),
                source: wgpu::ShaderSource::Wgsl(PRESENT.into()),
            });
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("NIE quad canvas"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs"),
                    buffers: &[],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: config.format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });
            let renderer = GpuRenderer::from_device(info, device, queue);
            if let Some(error) = validation.pop().await {
                renderer.device().destroy();
                bail!("initialisation du pipeline WebGPU : {error}");
            }
            Ok(Self {
                canvas,
                surface,
                config,
                renderer,
                model: None,
                camera: Camera::default(),
                layout,
                pipeline,
                presentation_bind: None,
                lost,
            })
        }

        fn ready(&self) -> Result<()> {
            let state = self
                .lost
                .lock()
                .map_err(|_| anyhow::anyhow!("état GPU indisponible"))?;
            if let Some(message) = state.as_ref() {
                bail!("device WebGPU perdu ; recréer le viewer : {message}");
            }
            Ok(())
        }

        /// Identité réellement retournée par wgpu ; le navigateur peut masquer le nom du GPU.
        #[must_use]
        pub fn adapter_info(&self) -> &wgpu::AdapterInfo {
            self.renderer.adapter_info()
        }

        /// Format réellement choisi pour la surface canvas.
        #[must_use]
        pub fn surface_format(&self) -> wgpu::TextureFormat {
            self.config.format
        }

        /// Charge un GLB via le parseur partagé, puis remplace le modèle après validation.
        /// Limite d'entrée : 64 Mio ; géométrie déjà en espace monde, textures PNG embarquées.
        /// Les transforms/skins/animations du glTF ne sont pas appliqués par ce parseur.
        pub fn load_glb(&mut self, bytes: &[u8]) -> Result<()> {
            self.ready()?;
            ensure!(bytes.len() <= 64 * 1024 * 1024, "GLB supérieur à 64 Mio");
            let model = glb::parse(bytes)?;
            ensure!(!model.primitives.is_empty(), "GLB sans primitive");
            let limits = self.renderer.device().limits();
            for texture in &model.textures {
                checked_size(
                    f64::from(texture.width),
                    f64::from(texture.height),
                    limits.max_texture_dimension_2d,
                )?;
            }
            for primitive in &model.primitives {
                ensure!(
                    primitive
                        .positions
                        .iter()
                        .flatten()
                        .chain(primitive.normals.iter().flatten())
                        .chain(primitive.uv.iter().flatten())
                        .all(|v| v.is_finite()),
                    "géométrie non finie"
                );
                ensure!(
                    primitive
                        .indices
                        .iter()
                        .all(|&i| (i as usize) < primitive.positions.len()),
                    "indice hors géométrie"
                );
                ensure!(
                    primitive.indices.len().is_multiple_of(3),
                    "indices non triangulaires"
                );
                // Vertex partagé = position + normale + UV + drapeau matériau = 36 octets.
                ensure!(
                    (primitive.positions.len() as u64) * 36 <= limits.max_buffer_size
                        && (primitive.indices.len() as u64) * 4 <= limits.max_buffer_size,
                    "maillage supérieur aux limites GPU"
                );
            }
            let uploaded = self.renderer.upload(&model);
            ensure!(uploaded.triangle_count > 0, "GLB sans triangle exploitable");
            self.model = Some(uploaded);
            Ok(())
        }

        /// Règle la caméra absolue (radians, distance en rayons), sans dessiner.
        pub fn orbit(&mut self, yaw: f32, pitch: f32, distance: f32) -> Result<()> {
            self.camera = checked_camera(yaw, pitch, distance)?;
            Ok(())
        }

        /// Règle le backing store physique, jamais le CSS ni le devicePixelRatio de l'hôte.
        /// Un canvas caché (0×0) doit simplement ne pas être rendu par l'hôte.
        pub fn resize(&mut self, width: f64, height: f64) -> Result<()> {
            self.ready()?;
            let (width, height) = checked_size(
                width,
                height,
                self.renderer.device().limits().max_texture_dimension_2d,
            )?;
            if (self.config.width, self.config.height) == (width, height) {
                return Ok(());
            }
            self.canvas.set_width(width);
            self.canvas.set_height(height);
            self.config.width = width;
            self.config.height = height;
            self.surface.configure(self.renderer.device(), &self.config);
            // `GpuRenderer` recréera sa texture cible au prochain rendu ; le groupe précédent
            // référence alors l'ancienne vue et ne doit surtout pas être réemployé.
            self.presentation_bind = None;
            Ok(())
        }

        /// Dessine et présente sans readback. `false` = frame sautée (surface indisponible).
        /// Surface perdue/validation/device perdu : erreur, l'hôte doit recréer le viewer.
        /// Appeler après load_glb, depuis requestAnimationFrame ; pas de boucle interne.
        pub fn render(&mut self) -> Result<bool> {
            self.ready()?;
            let model = self.model.as_ref().context("aucun GLB chargé")?;
            let (frame, reconfigure) = match self.surface.get_current_texture() {
                wgpu::CurrentSurfaceTexture::Success(frame) => (frame, false),
                wgpu::CurrentSurfaceTexture::Suboptimal(frame) => (frame, true),
                wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                    return Ok(false);
                }
                wgpu::CurrentSurfaceTexture::Outdated => {
                    self.surface.configure(self.renderer.device(), &self.config);
                    return Ok(false);
                }
                wgpu::CurrentSurfaceTexture::Lost => {
                    bail!("surface WebGPU perdue ; recréer le viewer")
                }
                wgpu::CurrentSurfaceTexture::Validation => {
                    bail!("validation de surface WebGPU échouée")
                }
            };
            // Le handle Device est Arc-backed. Le cloner avant l'emprunt mutable du renderer
            // permet de bâtir le bind group à partir de la vue renvoyée sans créer un second
            // device ni contourner les règles d'emprunt.
            let device = self.renderer.device().clone();
            let image = self.renderer.render_to_texture(
                model,
                self.camera,
                self.config.width,
                self.config.height,
            )?;
            if self.presentation_bind.is_none() {
                self.presentation_bind =
                    Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("NIE image canvas"),
                        layout: &self.layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(image),
                        }],
                    }));
            }
            let bind = self
                .presentation_bind
                .as_ref()
                .expect("bind group créé ci-dessus");
            let target = frame
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("NIE présentation"),
            });
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("NIE présentation"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: None,
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, bind, &[]);
                pass.draw(0..6, 0..1);
            }
            self.renderer.queue().submit(Some(encoder.finish()));
            frame.present();
            if reconfigure {
                self.surface.configure(&device, &self.config);
            }
            Ok(true)
        }
    }

    impl Drop for WebViewer {
        fn drop(&mut self) {
            self.renderer.device().destroy();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn quad_wgsl_valide() {
        let module = wgpu::naga::front::wgsl::parse_str(PRESENT).expect("WGSL valide");
        wgpu::naga::valid::Validator::new(
            wgpu::naga::valid::ValidationFlags::all(),
            wgpu::naga::valid::Capabilities::empty(),
        )
        .validate(&module)
        .expect("quad valide");
        assert_eq!(module.entry_points.len(), 2);
    }

    #[test]
    fn camera_refuse_non_finis_et_distances_invalides() {
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert!(checked_camera(value, 0.0, 3.0).is_err());
            assert!(checked_camera(0.0, value, 3.0).is_err());
            assert!(checked_camera(0.0, 0.0, value).is_err());
        }
        assert!(checked_camera(0.0, 0.0, 0.0).is_err());
        assert!(checked_camera(0.0, 0.0, -1.0).is_err());
    }

    #[test]
    fn camera_bornee_selon_le_renderer_partage() {
        let c = checked_camera(-1.0, 100.0, 100.0).expect("caméra finie");
        assert!((0.0..std::f32::consts::TAU).contains(&c.yaw));
        assert!(c.pitch < std::f32::consts::FRAC_PI_2);
        assert_eq!(c.distance, 40.0);
    }

    #[test]
    fn dimensions_strictes_sans_coercition_js() {
        assert_eq!(
            checked_size(1920.0, 1080.0, 2048).expect("taille valide"),
            (1920, 1080)
        );
        for value in [0.0, -1.0, 1.5, 2049.0, f64::NAN, f64::INFINITY] {
            assert!(checked_size(value, 1.0, 2048).is_err());
            assert!(checked_size(1.0, value, 2048).is_err());
        }
    }
}
