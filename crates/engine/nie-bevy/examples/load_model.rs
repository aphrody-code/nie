//! Charge un vrai modèle du jeu dans une `App` Bevy **headless**, depuis les CPK, et dit ce
//! qu'il a reçu.
//!
//! C'est la preuve de bout en bout de l'intégration : pas de fenêtre, pas de rendu, pas de
//! fichier intermédiaire — le serveur d'assets de Bevy lit `nie://data/...` dans le VFS, le
//! chargeur `.g4md` va chercher son `.g4mg` sur la même source, et les sous-mailles sortent en
//! `Mesh` Bevy.
//!
//! ```text
//! NIE_GAME_DIR=<installation du jeu> cargo run -p nie-bevy --features bevy --example load_model
//! ```
//!
//! Sort 0 quand un modèle a chargé, 1 sur échec ; `SKIP` (code 0) sans installation du jeu.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bevy_app::{App, TaskPoolPlugin};
use bevy_asset::{AssetMetaCheck, AssetPlugin, AssetServer, Assets, Handle, LoadState};
use bevy_mesh::Mesh;
use nie_bevy::{NieAssetPlugin, NieModel, VFS_SOURCE, register_vfs_source};
use nie_formats::vfs::{Vfs, resolve_game_dir};

/// Deux candidats : le premier indexe ses sous-mailles localement, le second (`k000010`) dans
/// l'espace global du G4MG et doit donc échouer par une erreur **nommée** — ce que l'exemple
/// affiche aussi, parce qu'un refus explicite est un résultat.
const CANDIDATES: [&str; 2] = [
    "data/common/chr/_face/11_VICTORY/c11010010/c11010010.g4md",
    "data/common/chr/_keshin/k000010/k000010.g4md",
];

/// Bornes du pilotage : le chargement est asynchrone, `app.update()` le fait avancer.
const MAX_UPDATES: usize = 20_000;
const MAX_WALL: Duration = Duration::from_secs(60);

fn main() -> ExitCode {
    let root = resolve_game_dir();
    let mut vfs = Vfs::new();
    if vfs.init(root.join("data")).is_err() {
        eprintln!(
            "SKIP: no game VFS under {} (set NIE_GAME_DIR)",
            root.display()
        );
        return ExitCode::SUCCESS;
    }
    let vfs = Arc::new(vfs);

    let mut app = App::new();
    // La source se déclare AVANT `AssetPlugin` : après, le serveur existe et ne la prendra plus.
    register_vfs_source(&mut app, Arc::clone(&vfs));
    app.add_plugins((
        TaskPoolPlugin::default(),
        AssetPlugin {
            meta_check: AssetMetaCheck::Never,
            ..Default::default()
        },
        NieAssetPlugin,
    ));

    let mut loaded_any = false;
    for candidate in CANDIDATES {
        let path = format!("{VFS_SOURCE}://{candidate}");
        let handle: Handle<NieModel> = app.world().resource::<AssetServer>().load(path.clone());

        let started = Instant::now();
        let mut updates = 0usize;
        let outcome = loop {
            app.update();
            updates += 1;
            let state = app.world().resource::<AssetServer>().load_state(&handle);
            match state {
                LoadState::Loaded => break Ok(()),
                LoadState::Failed(error) => break Err(error.to_string()),
                LoadState::NotLoaded | LoadState::Loading => {}
            }
            if updates >= MAX_UPDATES || started.elapsed() > MAX_WALL {
                break Err(format!("still loading after {updates} updates"));
            }
            std::thread::sleep(Duration::from_millis(1));
        };

        match outcome {
            Ok(()) => {
                let models = app.world().resource::<Assets<NieModel>>();
                let meshes = app.world().resource::<Assets<Mesh>>();
                let Some(model) = models.get(&handle) else {
                    eprintln!("{candidate}: Loaded but absent from Assets<NieModel>");
                    return ExitCode::FAILURE;
                };
                let resolved = model
                    .meshes
                    .iter()
                    .filter(|h| meshes.get(*h).is_some())
                    .count();
                println!(
                    "{candidate}: {} submeshes, {resolved} meshes resolved, vertices {:?}, {updates} updates in {:.0?}",
                    model.submesh_count,
                    model.vertex_counts,
                    started.elapsed()
                );
                if resolved != model.submesh_count {
                    return ExitCode::FAILURE;
                }
                loaded_any = true;
            }
            Err(reason) => {
                println!("{candidate}: refused — {reason}");
            }
        }
    }

    if loaded_any {
        ExitCode::SUCCESS
    } else {
        eprintln!("no candidate loaded");
        ExitCode::FAILURE
    }
}
