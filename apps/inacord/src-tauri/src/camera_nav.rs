//! Desktop compatibility DTOs over shared native spatial previews.

use nie_formats::vfs::Vfs;
use serde::Serialize;

/// Une piste d'animation : un canal d'un objet, échantillonné dans le temps.
#[derive(Serialize, specta::Type)]
pub struct PisteCameraDto {
    /// Nom de l'objet animé, tel qu'il figure dans la table de noms du fichier.
    pub objet: String,
    /// Canal : `PosX`, `PosY`, `PosZ`, `RefX`, `RefY`, `RefZ`, `Fov`, ou `Inconnu(0x..)`.
    pub canal: String,
    /// `true` si le flux est un `f32` décodé — donc si `valeurs` a un sens.
    pub resolu: bool,
    /// Numéros de frame des échantillons.
    pub temps: Vec<f32>,
    /// Valeurs, vides quand `resolu` est faux.
    pub valeurs: Vec<f32>,
}

/// Un clip : un intervalle de frames déclaré en tête de fichier.
#[derive(Serialize, specta::Type)]
pub struct ClipCameraDto {
    /// Première frame.
    pub debut: u32,
    /// Dernière frame.
    pub fin: u32,
    /// Index déclaré.
    pub index: u32,
}

/// Tout ce qu'une vue a besoin de savoir d'un `.g4cm`.
#[derive(Serialize, specta::Type)]
pub struct ApercuCameraDto {
    /// Noms des objets animés.
    pub objets: Vec<String>,
    /// Clips déclarés.
    pub clips: Vec<ClipCameraDto>,
    /// Pistes, une par canal.
    pub pistes: Vec<PisteCameraDto>,
    /// Première frame observée, toutes pistes confondues.
    pub frame_min: f32,
    /// Dernière frame observée.
    pub frame_max: f32,
    /// Nombre total de canaux.
    pub canaux: u32,
    /// Nombre de canaux dont le flux est décodé en `f32`.
    pub canaux_resolus: u32,
}

/// Compatibility adapter preserving the desktop IPC schema.
pub fn apercu_camera(vfs: &Vfs, path: &str) -> Result<ApercuCameraDto, String> {
    let bytes = vfs.read(path).map_err(|error| error.to_string())?;
    let report = nie_explore::spatial_preview::camera(&bytes)?;
    Ok(ApercuCameraDto {
        objets: report.objects,
        clips: report.clips.into_iter().map(|clip| ClipCameraDto {
            debut: clip.start, fin: clip.end, index: clip.index,
        }).collect(),
        pistes: report.tracks.into_iter().map(|track| PisteCameraDto {
            objet: track.object, canal: track.channel, resolu: track.resolved,
            temps: track.times, valeurs: track.values,
        }).collect(),
        frame_min: report.frame_min, frame_max: report.frame_max,
        canaux: report.channels, canaux_resolus: report.resolved_channels,
    })
}

/// Une arête du graphe de navigation, en indices de sommets.
#[derive(Serialize, specta::Type)]
pub struct AreteNavmDto {
    /// Sommet de départ.
    pub a: u32,
    /// Sommet d'arrivée.
    pub b: u32,
    /// Coût de franchissement.
    pub cout: f32,
    /// `true` si l'arête est au bord du maillage (elle ne relie qu'un seul polygone).
    pub bord: bool,
}

/// Tout ce qu'une vue a besoin de savoir d'un `.g4nv`.
#[derive(Serialize, specta::Type)]
pub struct ApercuNavmDto {
    /// Sommets, en coordonnées monde `[x, y, z]`.
    pub sommets: Vec<[f32; 3]>,
    /// Triangles, en index de sommets (trois par polygone).
    pub triangles: Vec<[u32; 3]>,
    /// Arêtes du graphe.
    pub aretes: Vec<AreteNavmDto>,
    /// Coin inférieur de la boîte englobante.
    pub bbox_min: [f32; 3],
    /// Coin supérieur de la boîte englobante.
    pub bbox_max: [f32; 3],
    /// Nombre de polygones du fichier (avant tout plafonnement).
    pub polygones: u32,
    /// `true` si l'aperçu a été plafonné — l'affichage doit le signaler.
    pub tronque: bool,
}

/// Compatibility adapter preserving the desktop IPC schema.
pub fn apercu_navm(vfs: &Vfs, path: &str) -> Result<ApercuNavmDto, String> {
    let bytes = vfs.read(path).map_err(|error| error.to_string())?;
    let report = nie_explore::spatial_preview::navmesh(&bytes)?;
    Ok(ApercuNavmDto {
        sommets: report.vertices, triangles: report.triangles,
        aretes: report.edges.into_iter().map(|edge| AreteNavmDto {
            a: edge.a, b: edge.b, cout: edge.cost, bord: edge.boundary,
        }).collect(),
        bbox_min: report.bbox_min, bbox_max: report.bbox_max,
        polygones: report.polygons, tronque: report.truncated,
    })
}
