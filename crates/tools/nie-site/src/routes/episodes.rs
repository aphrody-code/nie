//! `/api/v1/episodes` — le catalogue de la série, pour les Inacord déjà installés.
//!
//! ## Pourquoi cette route existe
//!
//! L'installeur d'Inacord embarque `data/anime/episodes.db` : un catalogue figé au jour du
//! build. La série continue d'être publiée, et le cron du VPS rafraîchit la base chaque nuit.
//! Sans porte de sortie, la seule façon de mettre à jour une installation serait de la
//! réinstaller.
//!
//! Cette porte existait sur le wiki (`apps/azalee/app/api/ietv`). Elle en sort, parce qu'elle
//! lit un fichier local et que le wiki devient serverless — et **elle doit exister ici AVANT
//! que le wiki ne s'arrête**, faute de quoi les clients installés cessent silencieusement de
//! recevoir les nouveaux épisodes : leur repli rend un 503, qu'ils lisent comme « ce serveur ne
//! moissonne pas la série ».
//!
//! ## Ce qu'elle sert, et ce qu'elle ne sert pas
//!
//! Du **JSON**, jamais le fichier SQLite. Remplacer sous les pieds d'une application une base
//! qu'elle tient ouverte est le genre de manœuvre qui ne casse qu'une fois sur dix, et jamais
//! sur la machine où on l'a testée. Le client fusionne ligne à ligne et garde la main.
//!
//! `?since=<epoch ms>` ne rend que ce qui a été moissonné après cette date. Un client à jour
//! reçoit alors un tableau vide et quelques centaines d'octets.

use axum::Json;
use axum::extract::{Query, State};
use serde::{Deserialize, Serialize};

use crate::error::ErreurSite;
use crate::state::EtatSite;

/// Borne haute du nombre d'épisodes rendus en une fois.
///
/// La base en compte 1 141 : le catalogue entier tient donc largement sous cette limite, et
/// elle ne sert qu'à empêcher qu'une base future ne fasse rendre un corps sans fin.
pub const LIMITE_MAX: u32 = 20_000;

/// Nombre d'épisodes rendus quand le client n'en demande pas un nombre précis.
pub const LIMITE_DEFAUT: u32 = 5_000;

/// Paramètres acceptés par la route.
#[derive(Debug, Deserialize)]
pub struct Demande {
    /// Ne rendre que ce qui a été moissonné après cette date (epoch ms).
    #[serde(default)]
    pub since: i64,
    /// Nombre maximal d'épisodes. Borné par [`LIMITE_MAX`].
    pub limit: Option<u32>,
}

/// Un épisode, tel que la base le décrit.
///
/// Les noms de champs sont ceux des colonnes réelles de `episodes` — relevés par
/// `PRAGMA table_info`, jamais devinés. Un nom inventé compile et rend `null` en silence.
pub use nie_wiki::episodes::Episode;

/// Corps de la réponse.
#[derive(Debug, Serialize)]
pub struct PageEpisodes {
    /// Les épisodes retenus.
    pub elements: Vec<Episode>,
    /// Nombre d'épisodes rendus.
    pub total: usize,
    /// Date de moisson la plus récente parmi eux — le `since` du prochain appel.
    pub dernier_moissonne: Option<i64>,
}

/// Compatibility adapter used by the feed route; SQLite policy remains owned by `nie-wiki`.
pub fn ouvrir(path: &std::path::Path) -> Result<rusqlite::Connection, ErreurSite> {
    nie_wiki::episodes::open_read_only(path).map_err(|error| ErreurSite::Interne(error.to_string()))
}

/// `GET /api/v1/episodes`.
///
/// Rend `Indisponible` quand la base des épisodes n'est pas là : ce serveur ne moissonne alors
/// pas la série, et le dire vaut mieux que rendre un catalogue vide qu'un client prendrait pour
/// un catalogue à jour.
pub async fn episodes(
    State(etat): State<EtatSite>,
    Query(demande): Query<Demande>,
) -> Result<Json<PageEpisodes>, ErreurSite> {
    let chemin = etat.config.episodes.clone();
    if !chemin.is_file() {
        return Err(ErreurSite::Indisponible(
            "catalogue des épisodes absent : ce serveur ne moissonne pas la série".to_owned(),
        ));
    }
    let limite = demande.limit.unwrap_or(LIMITE_DEFAUT).min(LIMITE_MAX);
    let depuis = demande.since;

    // La lecture est bloquante : elle sort du réacteur pour ne pas retenir un fil d'exécution
    // pendant que SQLite travaille.
    let page =
        tokio::task::spawn_blocking(move || nie_wiki::episodes::read_page(&chemin, depuis, limite))
            .await
            .map_err(|e| ErreurSite::Interne(format!("lecture des épisodes interrompue: {e}")))?
            .map_err(|e| ErreurSite::Interne(e.to_string()))?;

    Ok(Json(PageEpisodes {
        total: page.total,
        dernier_moissonne: page.latest_harvested,
        elements: page.elements,
    }))
}
