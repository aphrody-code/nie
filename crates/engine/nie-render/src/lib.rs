#![forbid(unsafe_code)]
#![deny(missing_docs)]

//! Contrat commun borné pour tous les chemins de présentation.

use nie_render3d::glb::Model;

/// Limites de sécurité communes aux hôtes natifs, GUI et WASM.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Limits {
    /// Largeur maximale en pixels.
    pub max_width: u32,
    /// Hauteur maximale en pixels.
    pub max_height: u32,
    /// Nombre maximal de pixels allouables.
    pub max_pixels: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_width: 8192,
            max_height: 8192,
            max_pixels: 16_777_216,
        }
    }
}

impl Limits {
    fn checked_size(self, width: u32, height: u32) -> Result<Size, Error> {
        if width == 0 || height == 0 || width > self.max_width || height > self.max_height {
            return Err(Error::Dimensions);
        }
        let pixels = u64::from(width) * u64::from(height);
        if pixels > self.max_pixels {
            return Err(Error::Budget);
        }
        Ok(Size { width, height })
    }
}

/// Dimensions vérifiées d'une cible RGBA8.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Size {
    /// Largeur.
    pub width: u32,
    /// Hauteur.
    pub height: u32,
}

/// Erreurs sans détail dépendant de l'hôte.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    /// Dimensions nulles ou hors limites.
    Dimensions,
    /// Budget mémoire dépassé.
    Budget,
}

/// Image RGBA8 partagée entre CPU, GUI et WASM.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Image {
    /// Dimensions.
    pub size: Size,
    /// Octets RGBA8.
    pub pixels: Vec<u8>,
}

impl Image {
    /// Alloue une image après contrôle des limites.
    pub fn new(size: Size, limits: Limits) -> Result<Self, Error> {
        limits.checked_size(size.width, size.height)?;
        let len = usize::try_from(u64::from(size.width) * u64::from(size.height) * 4)
            .map_err(|_| Error::Budget)?;
        Ok(Self {
            size,
            pixels: vec![0; len],
        })
    }

    /// Construit une image depuis des octets validés.
    pub fn from_rgba(size: Size, pixels: Vec<u8>, limits: Limits) -> Result<Self, Error> {
        limits.checked_size(size.width, size.height)?;
        let expected = usize::try_from(u64::from(size.width) * u64::from(size.height) * 4)
            .map_err(|_| Error::Budget)?;
        if pixels.len() != expected {
            return Err(Error::Budget);
        }
        Ok(Self { size, pixels })
    }
}

/// Couche présentable, indépendante de la fenêtre et du backend.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Layer {
    /// Pixels 2D RGBA8.
    Image(Image),
    /// Image 3D CPU rendue depuis un modèle GLB déjà décodé.
    Model {
        /// Image rendue.
        image: Image,
        /// Angle de caméra en milliradians.
        angle_millirad: i32,
    },
}

/// Composition déterministe des couches 2D/3D.
#[derive(Default)]
pub struct Frame {
    /// Couches dans l'ordre de présentation.
    pub layers: Vec<Layer>,
}

impl Frame {
    /// Ajoute une couche après validation de son empreinte mémoire.
    pub fn push(&mut self, layer: Layer) {
        self.layers.push(layer);
    }

    /// Rend un modèle via le chemin CPU de référence.
    pub fn model(
        model: &Model,
        width: u32,
        height: u32,
        angle_millirad: i32,
        limits: Limits,
    ) -> Result<Layer, Error> {
        let size = limits.checked_size(width, height)?;
        let pixels =
            nie_render3d::render::render(model, angle_millirad as f32 / 1000.0, width, height);
        Ok(Layer::Model {
            image: Image::from_rgba(size, pixels, limits)?,
            angle_millirad,
        })
    }
}

/// Adaptateur du rendu top-down CPU vers le contrat commun.
pub fn world(
    world: &nie_runtime::World,
    width: u32,
    height: u32,
    limits: Limits,
) -> Result<Image, Error> {
    let size = limits.checked_size(width, height)?;
    let frame = nie_runtime::render::render(world, width, height);
    Image::from_rgba(size, frame.px, limits)
}

/// Opérations 2D sans accès système, valables en WASM.
pub fn scale(image: &Image, width: u32, height: u32, limits: Limits) -> Result<Image, Error> {
    let size = limits.checked_size(width, height)?;
    let pixels = nie_formats::raster2d::scale_nearest(
        &image.pixels,
        image.size.width,
        image.size.height,
        width,
        height,
    );
    Image::from_rgba(size, pixels, limits)
}
