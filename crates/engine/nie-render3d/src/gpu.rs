//! Rendu 3D **GPU (wgpu)** du viewport niers — le portage annoncé par la doc de [`crate::render`]
//! (« le portage GPU/wgpu est l'évolution suivante »).
//!
//! Même contrat que le rastériseur CPU de référence ([`crate::render::render`]) : un
//! [`Model`](crate::glb::Model) entre, des pixels RGBA8 sortent. Ce qui change est le *où* : la
//! projection, le z-buffer, l'échantillonnage des atlas et l'éclairage sont exécutés par le GPU via
//! un pipeline `wgpu`, au lieu d'une boucle de triangles sur CPU.
//!
//! Pourquoi ça compte pour l'éditeur : le CPU rastérise une image de 512×512 en dizaines de
//! millisecondes, ce qui suffit pour une vignette mais pas pour une caméra qu'on manipule à la
//! souris. Ici, le modèle est **téléversé une seule fois** en mémoire GPU ([`GpuModel`]) et chaque
//! image ne coûte plus qu'un appel de dessin — la géométrie ne retraverse pas le bus à chaque
//! mouvement de caméra.
//!
//! Infrastructure (adaptateur hors-écran acceptant le rendu logiciel, création du device, lecture
//! du framebuffer avec alignement des lignes) reprise de l'hôte GPU déjà en place dans le
//! workspace, `nie-game` — mais celle-ci vit dans un `main.rs` de binaire, donc non réutilisable :
//! elle est réécrite ici en bibliothèque, pas déplacée, pour ne pas casser cet hôte.
//!
//! **Hors-écran délibérément.** Ce module ne crée ni fenêtre ni surface : il rend dans une texture
//! et renvoie les octets. C'est ce qui lui permet de servir un viewport intégré dans une interface
//! (`nie-explorer`) sans imbrication de fenêtres natives, et de rester testable sans écran.

use anyhow::{Context, Result};
use wgpu::util::DeviceExt;

use crate::glb::Model;
use crate::render::bounds;

/// API graphique demandée. Un choix explicite ne bascule jamais vers une autre API.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    /// Choix multiplateforme de wgpu.
    Auto,
    /// DirectX 12 natif, uniquement sur Windows.
    Dx12,
    /// Vulkan natif.
    Vulkan,
    /// OpenGL natif (alternative Linux).
    OpenGl,
    /// WebGPU du navigateur, pour l'hôte WASM.
    WebGpu,
    /// Metal natif.
    Metal,
}

impl Default for Backend {
    fn default() -> Self {
        if cfg!(target_arch = "wasm32") { Self::WebGpu }
        else if cfg!(target_os = "windows") { Self::Dx12 }
        else if cfg!(target_os = "linux") { Self::Vulkan }
        else if cfg!(target_os = "macos") { Self::Metal }
        else { Self::Auto }
    }
}

impl std::str::FromStr for Backend {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "auto" => Ok(Self::Auto),
            "dx12" => Ok(Self::Dx12),
            "vulkan" => Ok(Self::Vulkan),
            "gl" | "opengl" => Ok(Self::OpenGl),
            "webgpu" => Ok(Self::WebGpu),
            "metal" => Ok(Self::Metal),
            _ => Err(format!("backend inconnu {value:?} : auto, dx12, vulkan, gl, webgpu ou metal attendu")),
        }
    }
}

impl Backend {
    /// Masque strict pour créer l'instance de l'hôte natif ou web.
    #[must_use]
    pub fn backends(self) -> wgpu::Backends {
        match self {
            Self::Auto => wgpu::Backends::all(),
            Self::Dx12 => wgpu::Backends::DX12,
            Self::Vulkan => wgpu::Backends::VULKAN,
            Self::OpenGl => wgpu::Backends::GL,
            Self::WebGpu => wgpu::Backends::BROWSER_WEBGPU,
            Self::Metal => wgpu::Backends::METAL,
        }
    }
}

/// Politique de création du renderer, partagée par l'éditeur et les hôtes du moteur.
#[derive(Clone, Copy, Debug)]
pub struct GpuOptions {
    /// Backend imposé ; DirectX 12 par défaut sur Windows.
    pub backend: Backend,
    /// Autorise un adaptateur logiciel de la même API, jamais un repli vers une autre API.
    pub allow_software: bool,
}

impl Default for GpuOptions {
    fn default() -> Self {
        Self { backend: Backend::default(), allow_software: true }
    }
}

/// Sommet tel qu'attendu par `gpu.wgsl` — disposition figée par [`VERTEX_LAYOUT`].
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Vertex {
    position: [f32; 3],
    normal: [f32; 3],
    uv: [f32; 2],
}

const VERTEX_LAYOUT: wgpu::VertexBufferLayout<'static> = wgpu::VertexBufferLayout {
    array_stride: std::mem::size_of::<Vertex>() as wgpu::BufferAddress,
    step_mode: wgpu::VertexStepMode::Vertex,
    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2],
};

/// Uniformes de la passe — doit rester binairement identique à `struct Camera` de `gpu.wgsl`.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct CameraUniform {
    view_proj: [[f32; 4]; 4],
    /// Rotation à appliquer aux **normales** avant l'éclairage — la même que celle que le
    /// rastériseur CPU applique au modèle.
    ///
    /// Sans elle, la normale reste dans l'espace du modèle tandis que la direction de lumière est
    /// fixe : la lumière tourne alors AVEC l'objet, et un turntable montre un éclairage qui suit
    /// la rotation au lieu d'une source immobile. Une `mat4` plutôt qu'une `mat3` : une `mat3x3`
    /// WGSL s'aligne de toute façon sur trois `vec4`, autant que le côté Rust le dise.
    normal_rot: [[f32; 4]; 4],
    /// `xyz` = direction de lumière normalisée, `w` = 1.0 si la primitive porte une texture.
    light: [f32; 4],
}

/// Paramètres de caméra orbitale — ce que manipule l'utilisateur dans le viewport.
#[derive(Clone, Copy, Debug)]
pub struct Camera {
    /// Rotation horizontale, en radians.
    pub yaw: f32,
    /// Rotation verticale, en radians. Bornée par [`Camera::clamped`] pour éviter le passage au
    /// pôle, où la caméra se retourne brutalement.
    pub pitch: f32,
    /// Distance à la cible, en rayons du modèle (1.0 = la sphère englobante remplit le cadre).
    pub distance: f32,
}

impl Default for Camera {
    fn default() -> Self {
        // Trois-quarts légèrement plongeant : l'angle sous lequel un personnage se lit le mieux,
        // et celui qu'utilise déjà le rendu CPU par défaut (`angle = 0.6`, `tilt = 0.20`).
        Self { yaw: 0.6, pitch: 0.20, distance: 3.1 }
    }
}

impl Camera {
    /// Borne le tangage juste avant la verticale. À exactement ±π/2, la direction de vue devient
    /// colinéaire au vecteur « haut » et la matrice de vue dégénère (modèle qui disparaît).
    #[must_use]
    pub fn clamped(self) -> Self {
        const LIMIT: f32 = std::f32::consts::FRAC_PI_2 - 0.01;
        Self {
            yaw: self.yaw,
            pitch: self.pitch.clamp(-LIMIT, LIMIT),
            distance: self.distance.clamp(0.4, 40.0),
        }
    }
}

/// Une primitive téléversée : ses tampons GPU et son atlas.
struct GpuPrimitive {
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    /// Groupe de liaison de la texture — toujours présent (un atlas 1×1 blanc sert de bouche-trou
    /// quand la primitive n'a pas de texture, pour ne pas multiplier les pipelines).
    texture_bind_group: wgpu::BindGroup,
    has_texture: bool,
}

/// Modèle résident en mémoire GPU. Le construire est coûteux (téléversement) ; le rendre ne l'est
/// pas — c'est toute la raison d'être de cette séparation.
pub struct GpuModel {
    primitives: Vec<GpuPrimitive>,
    /// Centre de la boîte englobante, pour viser la caméra.
    center: [f32; 3],
    /// Rayon englobant, pour normaliser la distance de caméra quelle que soit l'échelle du modèle.
    radius: f32,
    /// Nombre total de triangles — statistique de viewport.
    pub triangle_count: u32,
    /// Nombre total de sommets — statistique de viewport.
    pub vertex_count: u32,
}

impl GpuModel {
    /// Fixe un cadre de caméra indépendant des transformations éditées.
    /// Sans cela, déplacer ou agrandir un objet seul serait annulé visuellement par l'auto-cadrage.
    pub fn set_framing(&mut self, center: [f32; 3], radius: f32) -> Result<()> {
        anyhow::ensure!(center.iter().all(|v| v.is_finite()) && radius.is_finite() && radius > 0., "cadre de caméra invalide");
        self.center = center;
        self.radius = radius;
        Ok(())
    }

    /// Rayon de la sphère englobante (unités du modèle).
    #[must_use]
    pub fn radius(&self) -> f32 {
        self.radius
    }
}

/// Contexte de rendu GPU réutilisable : adaptateur, device, pipeline, cibles.
///
/// À créer **une fois** et à garder vivant. Créer un device wgpu coûte des dizaines de
/// millisecondes et compile le pipeline : le refaire à chaque image annulerait tout l'intérêt du
/// GPU.
pub struct GpuRenderer {
    adapter_info: wgpu::AdapterInfo,
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::RenderPipeline,
    camera_layout: wgpu::BindGroupLayout,
    texture_layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    /// Cibles de rendu, recréées uniquement quand la taille demandée change.
    targets: Option<Targets>,
}

struct Targets {
    width: u32,
    height: u32,
    color: wgpu::Texture,
    depth: wgpu::TextureView,
    /// Tampon de lecture CPU — sa largeur de ligne est alignée sur 256 octets (exigence wgpu).
    #[cfg(not(target_arch = "wasm32"))]
    readback: Option<Readback>,
}

#[cfg(not(target_arch = "wasm32"))]
struct Readback {
    buffer: wgpu::Buffer,
    padded_bytes_per_row: u32,
}

/// Format de la cible couleur. `Rgba8Unorm` **sans** conversion sRGB : les atlas du jeu sont déjà
/// décodés en octets linéaires par `g4tx_decode`, et un `*Srgb` les réencoderait une seconde fois
/// (image délavée). Même choix que la capture de `nie-game`.
const COLOR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

impl GpuRenderer {
    /// Crée le contexte GPU hors-écran.
    ///
    /// L'adaptateur est demandé **sans surface**, en visant le GPU le plus puissant, avec repli
    /// sur un adaptateur logiciel : un poste sans GPU exploitable (machine virtuelle, session
    /// distante, pilote absent) doit dégrader, pas échouer.
    ///
    /// `HighPerformance` est ce qui désigne la carte discrète sur un portable à double GPU ;
    /// sans elle, le rendu part sur l'iGPU sans que rien ne le signale. Sur un serveur sans
    /// matériel, la préférence est sans effet et le repli logiciel s'applique.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new() -> Result<Self> {
        Self::with_options(GpuOptions::default())
    }

    /// Crée un renderer selon une politique explicite, sans substitution silencieuse de backend.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn with_options(options: GpuOptions) -> Result<Self> {
        pollster::block_on(Self::with_options_async(options))
    }

    /// Initialise sans bloquer la boucle d'événements, notamment dans un navigateur WASM.
    pub async fn with_options_async(options: GpuOptions) -> Result<Self> {
        anyhow::ensure!(options.backend != Backend::Dx12 || cfg!(target_os = "windows"),
            "DirectX 12 nécessite Windows ; aucun autre backend ne sera substitué");
        let mut descriptor = wgpu::InstanceDescriptor::new_without_display_handle();
        descriptor.backends = options.backend.backends();
        let instance = wgpu::Instance::new(descriptor);
        let requested = instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }).await;
        let adapter = match requested {
            Ok(adapter) => Ok(adapter),
            Err(_) if options.allow_software => instance.request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::None,
                compatible_surface: None,
                force_fallback_adapter: true,
            }).await,
            Err(error) => Err(error),
        }
        .with_context(|| format!("aucun adaptateur disponible pour {:?}", options.backend))?;
        let adapter_info = adapter.get_info();
        anyhow::ensure!(options.allow_software || adapter_info.device_type != wgpu::DeviceType::Cpu,
            "adaptateur logiciel refusé : {}", adapter_info.name);
        anyhow::ensure!(options.backend != Backend::Dx12 || adapter_info.backend == wgpu::Backend::Dx12,
            "le backend obtenu n'est pas DirectX 12");

        let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("nie-render3d gpu"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_defaults(),
            memory_hints: wgpu::MemoryHints::default(),
            trace: wgpu::Trace::Off,
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
        }).await
        .context("création du device wgpu")?;

        Ok(Self::from_device(adapter_info, device, queue))
    }

    /// Partage le device de l'hôte : UI et scène échangent des textures, pas des captures CPU.
    #[must_use]
    pub fn from_device(adapter_info: wgpu::AdapterInfo, device: wgpu::Device, queue: wgpu::Queue) -> Self {

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nie viewport"),
            source: wgpu::ShaderSource::Wgsl(include_str!("gpu.wgsl").into()),
        });

        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("camera"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("atlas"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nie viewport"),
            bind_group_layouts: &[Some(&camera_layout), Some(&texture_layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("nie viewport"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[VERTEX_LAYOUT],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: COLOR_FORMAT,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                // Pas de `cull_mode` : les maillages du jeu ont des faces à orientation
                // incohérente (vêtements, cheveux modélisés en plans simples), que le culling
                // trouerait visiblement.
                //
                // C'est une divergence ASSUMÉE avec le rastériseur CPU, qui lui écarte les faces
                // arrière (`render.rs`, aire signée écran ≤ 0). Elle ne change pas la silhouette
                // d'un volume fermé — pour chaque face arrière rejetée, une face avant la
                // recouvre — d'où l'IoU de 100 % mesuré sur un personnage. Elle se voit en
                // revanche sur une surface ouverte, où le CPU peut ne rien dessiner du tout.
                cull_mode: None,
                front_face: wgpu::FrontFace::Ccw,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
                strip_index_format: None,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("atlas"),
            // `ClampToEdge`, comme `render::sample` qui borne ses UV : en `Repeat`, un UV hors
            // [0,1] ramène un texel de l'autre bout de l'atlas — donc la texture d'une autre
            // partie du modèle, pas un artefact de bord. C'est une divergence de sémantique, pas
            // de qualité.
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            // Le filtrage, lui, reste linéaire là où le CPU échantillonne au plus proche : c'est
            // un choix de qualité assumé pour un viewport, et la cause principale de l'écart de
            // couleur que rapporte `nie-render3d --verify`.
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        Self { adapter_info, device, queue, pipeline, camera_layout, texture_layout, sampler, targets: None }
    }

    /// Identité mesurée du GPU et de l'API employés par ce renderer.
    #[must_use]
    pub fn adapter_info(&self) -> &wgpu::AdapterInfo {
        &self.adapter_info
    }

    /// Device partagé avec l'hôte de présentation ; les textures ne doivent pas changer de device.
    #[must_use]
    pub fn device(&self) -> &wgpu::Device { &self.device }

    /// File GPU partagée avec la présentation de l'éditeur.
    #[must_use]
    pub fn queue(&self) -> &wgpu::Queue { &self.queue }

    /// Téléverse un [`Model`] en mémoire GPU. À faire une fois par modèle, pas par image.
    #[must_use = "le modèle doit être conservé pour être rendu"]
    pub fn upload(&self, model: &Model) -> GpuModel {
        let (center, radius) = bounds(model);

        // Atlas 1×1 blanc : évite un second pipeline pour les primitives sans texture (le shader
        // les distingue par `light.w`, mais un groupe de liaison reste obligatoire).
        let white = self.create_texture_bind_group(1, 1, &[255, 255, 255, 255]);

        let texture_groups: Vec<wgpu::BindGroup> = model
            .textures
            .iter()
            .map(|t| self.create_texture_bind_group(t.width, t.height, &t.rgba))
            .collect();

        let mut triangle_count = 0u32;
        let mut vertex_count = 0u32;
        let mut primitives = Vec::with_capacity(model.primitives.len());

        for prim in &model.primitives {
            if prim.indices.is_empty() || prim.positions.is_empty() {
                continue;
            }
            let vertices: Vec<Vertex> = (0..prim.positions.len())
                .map(|i| Vertex {
                    position: prim.positions[i],
                    // Normale manquante → vers le haut : un zéro rendrait le Lambert indéfini et
                    // la primitive uniformément noire.
                    normal: prim.normals.get(i).copied().unwrap_or([0.0, 1.0, 0.0]),
                    uv: prim.uv.get(i).copied().unwrap_or([0.0, 0.0]),
                })
                .collect();

            triangle_count += (prim.indices.len() / 3) as u32;
            vertex_count += vertices.len() as u32;

            let vbuf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("vertices"),
                contents: bytemuck::cast_slice(&vertices),
                usage: wgpu::BufferUsages::VERTEX,
            });
            let ibuf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("indices"),
                contents: bytemuck::cast_slice(&prim.indices),
                usage: wgpu::BufferUsages::INDEX,
            });

            // Les atlas sont téléversés UNE fois (`texture_groups`) et le groupe de liaison est
            // cloné — c'est un handle, pas la texture. Deux primitives partageant un atlas ne
            // doivent pas le renvoyer deux fois sur le bus.
            let (bind_group, has_texture) = match prim.texture.and_then(|i| texture_groups.get(i)) {
                Some(group) => (group.clone(), true),
                None => (white.clone(), false),
            };

            primitives.push(GpuPrimitive {
                vertices: vbuf,
                indices: ibuf,
                index_count: prim.indices.len() as u32,
                texture_bind_group: bind_group,
                has_texture,
            });
        }

        GpuModel { primitives, center, radius, triangle_count, vertex_count }
    }

    fn create_texture_bind_group(&self, width: u32, height: u32, rgba: &[u8]) -> wgpu::BindGroup {
        let width = width.max(1);
        let height = height.max(1);
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("atlas"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        // Un atlas tronqué (décodage partiel) ne doit pas faire paniquer `write_texture` : on
        // complète par du blanc opaque plutôt que d'abandonner le modèle entier.
        let expected = (width * height * 4) as usize;
        let mut data = rgba.to_vec();
        data.resize(expected, 255);

        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &data,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("atlas"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&self.sampler) },
            ],
        })
    }

    /// (Re)crée les cibles de rendu si la taille demandée a changé.
    fn ensure_targets(&mut self, width: u32, height: u32) {
        if let Some(t) = &self.targets
            && t.width == width
            && t.height == height
        {
            return;
        }
        let size = wgpu::Extent3d { width, height, depth_or_array_layers: 1 };
        let color = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("color"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: COLOR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let depth = self
            .device
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("depth"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: DEPTH_FORMAT,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&wgpu::TextureViewDescriptor::default());

        self.targets = Some(Targets { width, height, color, depth,
            #[cfg(not(target_arch = "wasm32"))]
            readback: None,
        });
    }

    /// Dessine dans une texture GPU sans lecture CPU ni attente bloquante.
    /// La vue retournée est échantillonnable par l'hôte natif ou WebGPU sur le même device.
    pub fn render_to_texture(&mut self, model: &GpuModel, camera: Camera, width: u32, height: u32) -> Result<wgpu::TextureView> {
        let width = width.max(1);
        let height = height.max(1);
        let limit = self.device.limits().max_texture_dimension_2d;
        anyhow::ensure!(width <= limit && height <= limit, "dimensions du viewport supérieures à la limite GPU ({limit})");
        self.ensure_targets(width, height);
        let targets = self.targets.as_ref().expect("cibles créées juste au-dessus");

        let camera = camera.clamped();
        let view_proj = view_projection(model, camera, width as f32 / height as f32);
        let normal_rot = rotation_normales(camera);
        let light = normalize3([0.35, 0.75, 0.55]);

        let color_view = targets.color.create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("viewport") });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("viewport"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        // Fond transparent : c'est l'interface qui décide de la couleur derrière le
                        // modèle (thème clair/sombre), pas le renderer.
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &targets.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            pass.set_pipeline(&self.pipeline);

            for prim in &model.primitives {
                // Un uniforme par primitive : `light.w` porte la présence de texture, qui varie
                // d'une primitive à l'autre.
                let uniform = CameraUniform {
                    view_proj,
                    normal_rot,
                    light: [light[0], light[1], light[2], if prim.has_texture { 1.0 } else { 0.0 }],
                };
                let buffer = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("camera"),
                    contents: bytemuck::bytes_of(&uniform),
                    usage: wgpu::BufferUsages::UNIFORM,
                });
                let camera_bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("camera"),
                    layout: &self.camera_layout,
                    entries: &[wgpu::BindGroupEntry { binding: 0, resource: buffer.as_entire_binding() }],
                });

                pass.set_bind_group(0, &camera_bind_group, &[]);
                pass.set_bind_group(1, &prim.texture_bind_group, &[]);
                pass.set_vertex_buffer(0, prim.vertices.slice(..));
                pass.set_index_buffer(prim.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..prim.index_count, 0, 0..1);
            }
        }

        self.queue.submit(Some(encoder.finish()));
        Ok(color_view)
    }

    /// Capture RGBA8 bloquante, réservée aux exports et tests natifs.
    /// Les viewports interactifs emploient [`Self::render_to_texture`] sans aller-retour CPU.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn render(&mut self, model: &GpuModel, camera: Camera, width: u32, height: u32) -> Result<Vec<u8>> {
        self.render_to_texture(model, camera, width, height)?;
        let targets = self.targets.as_mut().expect("cibles créées par render_to_texture");
        let (width, height) = (targets.width, targets.height);
        // Aucun tampon de capture n'est alloué pour un viewport interactif ni sur le web.
        let readback = targets.readback.get_or_insert_with(|| {
            let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
            let padded_bytes_per_row = (width * 4).div_ceil(align) * align;
            let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("capture readback"),
                size: u64::from(padded_bytes_per_row) * u64::from(height),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            Readback { buffer, padded_bytes_per_row }
        });
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("capture viewport") });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &targets.color,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback.buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(readback.padded_bytes_per_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        self.queue.submit(Some(encoder.finish()));

        // Lecture du framebuffer : mapper, attendre le GPU, recopier ligne à ligne en retirant le
        // remplissage d'alignement.
        let slice = readback.buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.device.poll(wgpu::PollType::wait_indefinitely()).context("attente du GPU")?;
        rx.recv().context("canal de mappage rompu")?.context("mappage du tampon de lecture")?;

        let padded = slice.get_mapped_range();
        let mut out = Vec::with_capacity((width * height * 4) as usize);
        for row in 0..height {
            let start = (row * readback.padded_bytes_per_row) as usize;
            out.extend_from_slice(&padded[start..start + (width * 4) as usize]);
        }
        drop(padded);
        readback.buffer.unmap();

        Ok(out)
    }
}

/// Matrice vue-projection d'une caméra orbitale visant le centre du modèle.
fn view_projection(model: &GpuModel, camera: Camera, aspect: f32) -> [[f32; 4]; 4] {
    let r = model.radius.max(1e-3);
    let dist = camera.distance * r;
    let (cy, sy) = (camera.yaw.cos(), camera.yaw.sin());
    let (cp, sp) = (camera.pitch.cos(), camera.pitch.sin());

    let eye = [
        model.center[0] + dist * cp * sy,
        model.center[1] + dist * sp,
        model.center[2] + dist * cp * cy,
    ];

    // Plans de coupe relatifs à la taille du modèle : des valeurs fixes feraient disparaître un
    // modèle minuscule (coupé par le plan proche) ou un modèle immense (au-delà du plan lointain).
    let near = (dist - r * 2.0).max(r * 0.01);
    let far = dist + r * 4.0;
    // Même champ de vision que le rastériseur CPU, qui est la vérité terrain des goldens. Un fovy
    // choisi indépendamment (1,0 rad ici avant le 2026-08-28, contre 2·atan(1/1,7) ≈ 1,083) rend
    // le modèle sensiblement plus gros : 16 % de pixels couverts en plus sur un personnage, ce
    // qui se lit comme une divergence de rendu alors que ce n'est qu'un réglage de caméra.
    let proj = perspective(2.0 * (1.0 / crate::render::FOCALE).atan(), aspect, near, far);
    let view = look_at(eye, model.center, [0.0, 1.0, 0.0]);
    mat_mul(proj, view)
}

/// Rotation appliquée aux normales pour l'éclairage — l'équivalent GPU de `render::orient`.
///
/// Le rastériseur CPU fait tourner le MODÈLE (yaw puis tilt) devant une caméra fixe, et éclaire
/// avec une lumière fixe : l'observateur voit une source immobile pendant qu'un turntable tourne.
/// Ici la caméra orbite, donc le modèle ne bouge pas — il faut appliquer la rotation inverse aux
/// normales pour retrouver le même comportement. Le yaw est nié parce qu'orbiter l'observateur de
/// `+θ` équivaut à tourner l'objet de `−θ`.
fn rotation_normales(camera: Camera) -> [[f32; 4]; 4] {
    let (cy, sy) = (-camera.yaw).cos_sin();
    let (cx, sx) = camera.pitch.cos_sin();
    // Colonne-major, comme le reste des matrices envoyées au shader. R = Rx(pitch) · Ry(-yaw),
    // l'ordre exact de `render::orient` (Y d'abord, X ensuite).
    [
        [cy, sy * sx, -sy * cx, 0.0],
        [0.0, cx, sx, 0.0],
        [sy, -cy * sx, cy * cx, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

/// `cos` et `sin` d'un même angle, calculés ensemble — évite d'écrire deux fois l'angle et de se
/// tromper de signe sur l'un des deux.
trait CosSin {
    /// Rend `(cos, sin)`.
    fn cos_sin(self) -> (f32, f32);
}

impl CosSin for f32 {
    fn cos_sin(self) -> (f32, f32) {
        (self.cos(), self.sin())
    }
}

fn perspective(fovy: f32, aspect: f32, near: f32, far: f32) -> [[f32; 4]; 4] {
    let f = 1.0 / (fovy * 0.5).tan();
    // Profondeur en [0,1] (convention wgpu/Direct3D), pas [-1,1] (OpenGL) — l'inverser donnerait
    // un z-test systématiquement faux.
    [
        [f / aspect, 0.0, 0.0, 0.0],
        [0.0, f, 0.0, 0.0],
        [0.0, 0.0, far / (near - far), -1.0],
        [0.0, 0.0, (near * far) / (near - far), 0.0],
    ]
}

fn look_at(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> [[f32; 4]; 4] {
    let f = normalize3(sub3(target, eye));
    let s = normalize3(cross3(f, up));
    let u = cross3(s, f);
    [
        [s[0], u[0], -f[0], 0.0],
        [s[1], u[1], -f[1], 0.0],
        [s[2], u[2], -f[2], 0.0],
        [-dot3(s, eye), -dot3(u, eye), dot3(f, eye), 1.0],
    ]
}

fn mat_mul(a: [[f32; 4]; 4], b: [[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut out = [[0.0f32; 4]; 4];
    for (c, col) in out.iter_mut().enumerate() {
        for (r, cell) in col.iter_mut().enumerate() {
            *cell = (0..4).map(|k| a[k][r] * b[c][k]).sum();
        }
    }
    out
}

fn sub3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let n = dot3(v, v).sqrt();
    if n <= 1e-6 { [0.0, 1.0, 0.0] } else { [v[0] / n, v[1] / n, v[2] / n] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_backend_est_stricte() {
        assert_eq!("dx12".parse::<Backend>().unwrap().backends(), wgpu::Backends::DX12);
        assert!("directx11".parse::<Backend>().is_err());
        assert_eq!("gl".parse::<Backend>().unwrap().backends(), wgpu::Backends::GL);
        assert_eq!("webgpu".parse::<Backend>().unwrap().backends(), wgpu::Backends::BROWSER_WEBGPU);
        if cfg!(target_os = "windows") { assert_eq!(Backend::default(), Backend::Dx12); }
        if cfg!(target_os = "linux") { assert_eq!(Backend::default(), Backend::Vulkan); }
        if cfg!(target_arch = "wasm32") { assert_eq!(Backend::default(), Backend::WebGpu); }
    }

    /// Rend un triangle texturé sur le GPU et vérifie que des pixels sont réellement écrits.
    ///
    /// Volontairement synthétique : ce test doit tourner partout (CI sans GPU comprise, l'adaptateur
    /// logiciel prend le relais), sans dépendre du dépôt d'assets de 57 Go. La couverture sur les
    /// VRAIS modèles du jeu est assurée côté `nie-explorer`
    /// (`viewport_gpu_rend_un_vrai_modele`, feature `real-fixtures`).
    #[test]
    fn rend_un_triangle_sur_gpu() {
        let Ok(mut renderer) = GpuRenderer::new() else {
            eprintln!("aucun adaptateur wgpu sur cette machine — test ignoré");
            return;
        };

        let model = Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![[-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [0.0, 1.0, 0.0]],
                normals: vec![[0.0, 0.0, 1.0]; 3],
                uv: vec![[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]],
                indices: vec![0, 1, 2],
                texture: Some(0),
            }],
            textures: vec![crate::glb::Texture { width: 1, height: 1, rgba: vec![255, 0, 0, 255] }],
        };

        let gpu_model = renderer.upload(&model);
        assert_eq!(gpu_model.triangle_count, 1);
        assert_eq!(gpu_model.vertex_count, 3);

        let camera = Camera { yaw: 0.0, pitch: 0.0, distance: 3.0 };
        let pixels = renderer.render(&gpu_model, camera, 64, 64).expect("rendu GPU");
        assert_eq!(pixels.len(), 64 * 64 * 4);

        // Le fond est effacé en transparent : tout pixel opaque vient du triangle. En exiger un
        // nombre plancher (et pas « au moins un ») distingue un vrai rendu d'un artefact isolé.
        let opaques = pixels.chunks_exact(4).filter(|p| p[3] > 200).count();
        assert!(opaques > 200, "trop peu de pixels rendus ({opaques}) — le triangle n'a pas été dessiné");

        // La texture est rouge pur, modulée par l'éclairage : le canal rouge doit dominer.
        let sample = pixels.chunks_exact(4).find(|p| p[3] > 200).expect("au moins un pixel opaque");
        assert!(sample[0] > sample[1] && sample[0] > sample[2], "couleur inattendue : {sample:?}");
    }

    /// Le pipeline GPU cadre la **même vue** que le rastériseur CPU de référence.
    ///
    /// Les deux ont des conventions opposées — le CPU tourne le modèle, le GPU orbite la caméra —
    /// et elles ont divergé sans que rien ne le signale : un champ de vision choisi
    /// indépendamment (1,0 rad contre 2·atan(1/1,7)) faisait couvrir au GPU 16 % de pixels de
    /// plus, et le sens de rotation non converti montrait la vue en miroir. Rien de tout cela ne
    /// se voit sur un test qui ne regarde qu'un seul des deux chemins.
    ///
    /// Le test compare donc les SILHOUETTES : la couleur diffère légitimement (ombrage lissé
    /// contre plat, filtrage linéaire contre plus proche voisin), la couverture non.
    #[test]
    fn gpu_et_cpu_cadrent_la_meme_vue() {
        let Ok(mut renderer) = GpuRenderer::new() else {
            eprintln!("aucun adaptateur wgpu sur cette machine — test ignoré");
            return;
        };
        // Un quad incliné hors des axes : une géométrie symétrique masquerait une inversion de
        // rotation, et une géométrie plane frontale masquerait une erreur de champ de vision.
        let model = Model {
            primitives: vec![crate::glb::Primitive {
                positions: vec![
                    [-1.0, -0.6, 0.4],
                    [1.2, -0.4, -0.3],
                    [0.3, 1.1, 0.2],
                    [-0.8, 0.9, -0.5],
                ],
                normals: vec![[0.0, 0.0, 1.0]; 4],
                uv: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
                // Winding CCW (aire écran négative, axe Y descendant) : le CPU écarte
                // les faces arrière, pas le pipeline GPU (cf. `cull_mode: None`). Une surface
                // OUVERTE prise à l'envers ne serait donc dessinée que d'un côté, et le test
                // mesurerait ce désaccord de culling au lieu du cadrage qu'il vise.
                indices: vec![0, 1, 2, 0, 2, 3],
                texture: None,
            }],
            textures: vec![],
        };

        const W: u32 = 128;
        const H: u32 = 128;
        let angle = 0.6_f32;
        let gpu_model = renderer.upload(&model);
        // Conversion de convention, la même que celle du binaire : orbiter de +θ montre ce que
        // montre une rotation du modèle de −θ.
        let camera = Camera { yaw: -angle, ..Default::default() }.clamped();
        let limit = renderer.device().limits().max_texture_dimension_2d;
        assert!(renderer.render_to_texture(&gpu_model, camera, limit + 1, H).is_err());
        renderer.render_to_texture(&gpu_model, camera, W, H).expect("rendu sans lecture CPU");
        let gpu_px = renderer.render(&gpu_model, camera, W, H).expect("rendu GPU");
        let cpu_px = crate::render::render(&model, angle, W, H);

        let (mut inter, mut union) = (0usize, 0usize);
        for y in 0..H {
            let fond = crate::render::couleur_fond(y, H);
            for x in 0..W {
                let i = ((y * W + x) * 4) as usize;
                let c = cpu_px[i..i + 4] != fond;
                let g = gpu_px[i + 3] > 0;
                union += usize::from(c || g);
                inter += usize::from(c && g);
            }
        }
        assert!(union > 500, "les deux rendus sont quasi vides ({union} px couverts)");
        let iou = inter as f64 / union as f64;
        assert!(
            iou > 0.95,
            "silhouettes divergentes : IoU {:.1} % — champ de vision, cadrage ou sens de rotation",
            iou * 100.0,
        );
    }
}
