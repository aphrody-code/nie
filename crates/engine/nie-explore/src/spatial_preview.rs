//! Portable camera-track and navigation-mesh projections from the native format decoders.

use serde::Serialize;

const MAX_VERTICES: usize = 60_000;

const MAX_SAMPLES: usize = 20_000;

#[derive(Debug, Serialize)]
pub struct CameraTrack {
    pub object: String,
    pub channel: String,
    pub resolved: bool,
    pub times: Vec<f32>,
    pub values: Vec<f32>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct CameraClip {
    pub start: u32,
    pub end: u32,
    pub index: u32,
}

#[derive(Debug, Serialize)]
pub struct CameraPreview {
    pub objects: Vec<String>,
    pub clips: Vec<CameraClip>,
    pub tracks: Vec<CameraTrack>,
    pub frame_min: f32,
    pub frame_max: f32,
    pub channels: u32,
    pub resolved_channels: u32,
}

fn channel_name(kind: nie_formats::g4cm::ChannelKind) -> String {
    use nie_formats::g4cm::ChannelKind as K;
    match kind {
        K::PosX => "PosX".into(),
        K::PosY => "PosY".into(),
        K::PosZ => "PosZ".into(),
        K::RefX => "RefX".into(),
        K::RefY => "RefY".into(),
        K::RefZ => "RefZ".into(),
        K::Fov => "Fov".into(),
        other => format!("{other:?}"),
    }
}

pub fn camera(bytes: &[u8]) -> Result<CameraPreview, String> {
    let anim = nie_formats::g4cm::parse(bytes).map_err(|e| format!("G4CM: {e}"))?;

    let mut owner: Vec<Option<usize>> = vec![None; anim.channels.len()];
    for (i, object) in anim.objects.iter().enumerate() {
        let start = object.first_channel as usize;
        let end = start
            .saturating_add(object.channel_count as usize)
            .min(anim.channels.len());
        for slot in owner.iter_mut().take(end).skip(start) {
            *slot = Some(i);
        }
    }

    let mut tracks = Vec::with_capacity(anim.channels.len());
    let (mut frame_min, mut frame_max) = (f32::MAX, f32::MIN);
    let mut resolved_count = 0_u32;

    for (i, channel) in anim.channels.iter().enumerate() {
        let object = owner
            .get(i)
            .copied()
            .flatten()
            .and_then(|k| anim.names.get(k))
            .cloned()
            .unwrap_or_else(|| format!("object{i}"));

        let times: Vec<f32> = channel
            .times(&anim)
            .iter()
            .take(MAX_SAMPLES)
            .map(|t| f32::from(*t))
            .collect();
        for t in &times {
            frame_min = frame_min.min(*t);
            frame_max = frame_max.max(*t);
        }

        let values: Vec<f32> = channel
            .track
            .values()
            .map(|v| v.iter().take(MAX_SAMPLES).copied().collect())
            .unwrap_or_default();
        let resolved = channel.track.values().is_some();
        if resolved {
            resolved_count += 1;
        }

        tracks.push(CameraTrack {
            object,
            channel: channel_name(channel.kind),
            resolved,
            times,
            truncated: channel.times(&anim).len() > MAX_SAMPLES
                || channel
                    .track
                    .values()
                    .is_some_and(|values| values.len() > MAX_SAMPLES),
            values,
        });
    }

    if frame_min > frame_max {
        frame_min = 0.0;
        frame_max = 0.0;
    }

    Ok(CameraPreview {
        objects: anim.names.clone(),
        clips: anim
            .clips
            .iter()
            .map(|c| CameraClip {
                start: u32::from(c.start),
                end: u32::from(c.end),
                index: u32::from(c.index),
            })
            .collect(),
        channels: u32::try_from(anim.channels.len())
            .map_err(|_| "Camera channel count exceeds supported range")?,
        resolved_channels: resolved_count,
        tracks,
        frame_min,
        frame_max,
    })
}

#[derive(Debug, Serialize)]
pub struct NavigationEdge {
    pub a: u32,
    pub b: u32,
    pub cost: f32,
    pub boundary: bool,
}

#[derive(Debug, Serialize)]
pub struct NavigationPreview {
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
    pub edges: Vec<NavigationEdge>,
    pub bbox_min: [f32; 3],
    pub bbox_max: [f32; 3],
    pub polygons: u32,
    pub truncated: bool,
    pub omitted_triangles: usize,
    pub omitted_edges: usize,
}

pub fn navmesh(bytes: &[u8]) -> Result<NavigationPreview, String> {
    let navm = nie_formats::navm::parse(bytes).map_err(|e| format!("G4NV: {e}"))?;

    let truncated = navm.vertices.len() > MAX_VERTICES;
    let vertices: Vec<[f32; 3]> = navm
        .vertices
        .iter()
        .take(MAX_VERTICES)
        .map(|v| v.pos)
        .collect();

    let mut bbox_min = [f32::MAX; 3];
    let mut bbox_max = [f32::MIN; 3];
    for p in &vertices {
        for axis in 0..3 {
            bbox_min[axis] = bbox_min[axis].min(p[axis]);
            bbox_max[axis] = bbox_max[axis].max(p[axis]);
        }
    }
    if vertices.is_empty() {
        bbox_min = [0.0; 3];
        bbox_max = [0.0; 3];
    }

    let vertex_limit = u32::try_from(vertices.len())
        .map_err(|_| "Navigation vertex count exceeds supported range")?;
    let mut triangles = Vec::with_capacity(navm.polygons.len());
    for poly in &navm.polygons {
        let d = poly.first_corner as usize;
        let Some(corners) = navm.corners.get(d..d.saturating_add(3)) else {
            continue;
        };
        if corners.iter().all(|c| *c < vertex_limit) {
            triangles.push([corners[0], corners[1], corners[2]]);
        }
    }

    let edges: Vec<NavigationEdge> = navm
        .edges
        .iter()
        .filter(|e| e.vert_a < vertex_limit && e.vert_b < vertex_limit)
        .map(|e| NavigationEdge {
            a: e.vert_a,
            b: e.vert_b,
            cost: e.cost,
            boundary: e.poly_a == u32::MAX || e.poly_b == u32::MAX,
        })
        .collect();

    let omitted_triangles = navm.polygons.len() - triangles.len();
    let omitted_edges = navm.edges.len() - edges.len();
    Ok(NavigationPreview {
        polygons: u32::try_from(navm.polygons.len())
            .map_err(|_| "Navigation polygon count exceeds supported range")?,
        vertices,
        triangles,
        edges,
        bbox_min,
        bbox_max,
        truncated: truncated || omitted_triangles > 0 || omitted_edges > 0,
        omitted_triangles,
        omitted_edges,
    })
}
