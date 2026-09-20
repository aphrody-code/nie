//! Le chargement de bout en bout dans une `App` Bevy headless, depuis les CPK du jeu.
//!
//! Conditionnel à l'installation du jeu, et **bruyant** quand il saute : un golden qui ne
//! s'exécute pas doit se voir. Aucun octet du jeu n'est écrit.

#![cfg(feature = "bevy")]

use std::sync::Arc;
use std::time::{Duration, Instant};

use bevy_app::{App, TaskPoolPlugin};
use bevy_asset::{Asset, AssetMetaCheck, AssetPlugin, AssetServer, Assets, Handle, LoadState};
use bevy_image::Image;
use bevy_mesh::Mesh;
use nie_bevy::{NiersAssetPlugin, NiersModel, VFS_SOURCE, register_vfs_source};
use nie_formats::vfs::{Vfs, resolve_game_dir};

fn headless_app() -> Option<App> {
    let root = resolve_game_dir();
    let mut vfs = Vfs::new();
    if vfs.init(root.join("data")).is_err() {
        eprintln!("SKIP: no game VFS under {}", root.display());
        return None;
    }
    let mut app = App::new();
    register_vfs_source(&mut app, Arc::new(vfs));
    app.add_plugins((
        TaskPoolPlugin::default(),
        AssetPlugin {
            meta_check: AssetMetaCheck::Never,
            ..Default::default()
        },
        NiersAssetPlugin,
    ));
    Some(app)
}

/// Pilote l'application jusqu'au verdict du chargement, borné en itérations et en temps.
fn drive<A: Asset>(app: &mut App, handle: &Handle<A>) -> Result<(), String> {
    let started = Instant::now();
    for _ in 0..20_000 {
        app.update();
        match app.world().resource::<AssetServer>().load_state(handle) {
            LoadState::Loaded => return Ok(()),
            LoadState::Failed(error) => return Err(error.to_string()),
            LoadState::NotLoaded | LoadState::Loading => {}
        }
        if started.elapsed() > Duration::from_secs(60) {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    Err("still loading at the bound".to_owned())
}

/// Un `.g4md` du jeu charge depuis `nie://`, et chacune de ses sous-mailles résout en `Mesh`.
#[test]
fn un_modele_du_jeu_charge_depuis_le_vfs_en_meshes_bevy() {
    let Some(mut app) = headless_app() else {
        return;
    };
    let path = format!("{VFS_SOURCE}://data/common/chr/_face/11_VICTORY/c11010010/c11010010.g4md");
    let handle: Handle<NiersModel> = app.world().resource::<AssetServer>().load(path);
    drive(&mut app, &handle).expect("c11010010 loads");

    let models = app.world().resource::<Assets<NiersModel>>();
    let meshes = app.world().resource::<Assets<Mesh>>();
    let model = models.get(&handle).expect("model present");
    assert!(model.submesh_count > 0);
    assert_eq!(model.meshes.len(), model.submesh_count);
    assert_eq!(model.vertex_counts.len(), model.submesh_count);
    for (i, h) in model.meshes.iter().enumerate() {
        let mesh = meshes.get(h).unwrap_or_else(|| panic!("Mesh{i} unresolved"));
        assert!(mesh.count_vertices() > 0, "Mesh{i} empty");
        assert!(mesh.indices().is_some(), "Mesh{i} without indices");
        assert_eq!(mesh.count_vertices(), model.vertex_counts[i]);
    }
    eprintln!(
        "c11010010 -> {} meshes, vertices {:?}",
        model.submesh_count, model.vertex_counts
    );
}

/// Un `.g4tx` du jeu charge en `Image` dont le tampon couvre exactement ses pixels.
#[test]
fn un_atlas_du_jeu_charge_depuis_le_vfs_en_image_bevy() {
    let Some(mut app) = headless_app() else {
        return;
    };
    // Le premier atlas du dossier du même personnage : le chemin exact varie, le dossier non.
    let root = resolve_game_dir();
    let mut vfs = Vfs::new();
    vfs.init(root.join("data")).expect("already mounted once");
    let Some(atlas) = vfs
        .iter()
        .map(|(p, _)| p.to_string())
        .find(|p| p.starts_with("data/common/chr/_face/11_VICTORY/c11010010/") && p.ends_with(".g4tx"))
    else {
        eprintln!("SKIP: no .g4tx beside c11010010");
        return;
    };
    let handle: Handle<Image> = app
        .world()
        .resource::<AssetServer>()
        .load(format!("{VFS_SOURCE}://{atlas}"));
    match drive(&mut app, &handle) {
        Ok(()) => {
            let images = app.world().resource::<Assets<Image>>();
            let image = images.get(&handle).expect("image present");
            let size = image.texture_descriptor.size;
            assert_eq!(
                image.data.as_ref().map(Vec::len),
                Some((size.width * size.height * 4) as usize)
            );
            eprintln!("{atlas} -> Image {}x{}", size.width, size.height);
        }
        // Un atlas sans payload DDS est un refus nommé, pas un défaut du chargeur.
        Err(reason) if reason.contains("unsupported payload") => eprintln!("SKIP: {atlas}: {reason}"),
        Err(reason) => panic!("{atlas}: {reason}"),
    }
}
