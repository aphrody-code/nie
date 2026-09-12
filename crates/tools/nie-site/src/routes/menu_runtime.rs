//! Thin HTTP adapter over the shared bounded Lua VFS menu replay owner.
use std::sync::{Arc, OnceLock};

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use nie_lua::menu_runtime::{ReplayOutput, ReplayRequest};

use crate::{error::ErreurSite, state::EtatSite};

/// Replay a menu snapshot without input events.
pub async fn snapshot(
    State(state): State<EtatSite>,
    Path(screen): Path<String>,
) -> Result<Response, ErreurSite> {
    run(state, screen, ReplayRequest::default()).await
}

/// Replay a bounded sequence of input events for one menu screen.
pub async fn replay(
    State(state): State<EtatSite>,
    Path(screen): Path<String>,
    Json(request): Json<ReplayRequest>,
) -> Result<Response, ErreurSite> {
    run(state, screen, request).await
}

async fn run(
    state: EtatSite,
    screen: String,
    request: ReplayRequest,
) -> Result<Response, ErreurSite> {
    if screen.is_empty()
        || screen.len() > 96
        || !screen
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_')
    {
        return Err(ErreurSite::Demande("Invalid menu screen".into()));
    }
    request.events().map_err(ErreurSite::Demande)?;
    let vfs = state.vfs()?;
    static LIMIT: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let permit = Arc::clone(LIMIT.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2))))
        .try_acquire_owned()
        .map_err(|_| ErreurSite::TropDeRequetes("Menu runtime busy".into()))?;
    let output = tokio::task::spawn_blocking(move || -> Result<ReplayOutput, ErreurSite> {
        let _permit = permit;
        rejouer(vfs, &screen, request)
    })
    .await
    .map_err(|_| ErreurSite::Indisponible("Menu runtime unavailable".into()))??;
    reponse(output)
}

/// Rejoue un écran de menu, en bloquant — le cœur partagé par la route HTTP et par la jointure
/// de visibilité du layout (`super::menu::layout`).
///
/// C'est l'exécution Lua du jeu : elle seule sait quel objet d'un écran est VISIBLE. Le layout
/// statique, lui, ne l'a jamais su et le disait (`visible: null`).
pub(crate) fn rejouer(
    vfs: std::sync::Arc<nie_formats::vfs::Vfs>,
    screen: &str,
    request: ReplayRequest,
) -> Result<ReplayOutput, ErreurSite> {
    {
        let screen = screen.to_owned();
        let config = format!("data/common/gamedata/menu/cfg/{screen}_setting.cfg.bin");
        if !vfs
            .find(&config)
            .is_some_and(|entry| entry.file_size <= 1024 * 1024)
        {
            return Err(ErreurSite::Demande(
                "Menu definition unavailable within its size budget".into(),
            ));
        }
        let bytes = vfs
            .read(&config)
            .map_err(|_| ErreurSite::Introuvable("Menu unavailable".into()))?;
        if bytes.len() > 1024 * 1024 {
            return Err(ErreurSite::Demande(
                "Menu definition exceeds its size budget".into(),
            ));
        }
        let root = nie_formats::cfgbin::to_iecode_json(&bytes)
            .ok_or_else(|| ErreurSite::Indisponible("Menu definition unavailable".into()))?;
        let setting = nie_data::menu_setting::parse(&root);
        let layers: Vec<u32> = setting
            .layers
            .iter()
            .map(|layer| layer.layer_id.0)
            .collect();
        let localized_text = super::menu::load_menu_text(&vfs, &request.locale)
            .into_iter()
            .map(|(id, text)| (id.0, text))
            .collect();
        let paths: Vec<String> = vfs
            .iter()
            .filter(|(path, entry)| {
                path.ends_with(".lua.bin")
                    && (entry.file_size as usize) <= nie_lua::menu_runtime::MAX_SCRIPT_BYTES
            })
            .map(|(path, _)| path.to_owned())
            .collect();
        let (by_name, by_logical) = nie_lua::index_script_paths(paths.iter().map(String::as_str));
        let script = nie_lua::resolve_script_path(&screen, &by_name, &by_logical)
            .filter(|path| path.starts_with("data/common/script/lua/menu/"))
            .cloned()
            .ok_or_else(|| ErreurSite::Introuvable("Menu script unavailable".into()))?;
        nie_lua::menu_runtime::replay(
            paths,
            move |path| {
                vfs.find(path).filter(|entry| {
                    entry.file_size as usize <= nie_lua::menu_runtime::MAX_SCRIPT_BYTES
                })?;
                vfs.read(path).ok()
            },
            &script,
            &layers,
            localized_text,
            request,
        )
        .map_err(|error| {
            tracing::debug!(%error, "menu replay unavailable");
            ErreurSite::Indisponible("Menu runtime unavailable".into())
        })
    }
}

/// La visibilité RÉSOLUE de chaque objet d'un écran, par identifiant runtime.
///
/// C'est la seule chose que le layout statique ne peut pas savoir : quel objet le jeu affiche.
/// L'identifiant est le CRC32 du nom de l'objet — mesuré le 2026-09-12 sur `chara_bank_menu` :
/// 23 des 25 noms du layout retrouvent leur objet ainsi.
pub(crate) fn visibilite_par_objet(
    vfs: std::sync::Arc<nie_formats::vfs::Vfs>,
    screen: &str,
    locale: &str,
) -> std::collections::BTreeMap<u32, bool> {
    let request = ReplayRequest {
        locale: locale.to_owned(),
        ..ReplayRequest::default()
    };
    let Ok(output) = rejouer(vfs, screen, request) else {
        return std::collections::BTreeMap::new();
    };
    let mut visibilite = std::collections::BTreeMap::new();
    for layer in output.scene.layers.values() {
        for (id, objet) in &layer.objects {
            // Un objet d'un calque caché ne s'affiche pas, quoi qu'il dise de lui-même.
            visibilite.insert(*id, layer.visible && objet.visible);
        }
    }
    visibilite
}

fn reponse(output: ReplayOutput) -> Result<Response, ErreurSite> {
    let mut response = Json(output).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
