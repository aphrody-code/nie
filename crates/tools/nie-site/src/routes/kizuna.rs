//! `/api/v1/kizuna` — la Ville de lien de la Station Kizuna : son catalogue d'objets, leurs
//! catégories de placement et leurs thèmes.
//!
//! # Ce que la route sert, et d'où ça vient
//!
//! La Station Kizuna tient en trois piliers annoncés par l'éditeur : la personnalisation
//! d'avatar, la **Ville de lien** — y placer des objets et des personnages gagnés ailleurs — et
//! les amis qui la visitent. Ce module sert le deuxième, et rien d'autre : l'avatar a déjà son
//! chemin (`chara_edit_menu`, `/avatar/*` de `nie-model-serve`), et les amis relèvent du réseau.
//!
//! Tout vient de deux `.cfg.bin` du jeu, résolus **par clé de famille** et jamais par un chemin
//! écrit à la main — les fichiers portent un numéro de version que personne ne devine :
//!
//! | Clé | Ce qu'elle porte |
//! |---|---|
//! | `craft_obj_config` | 160 objets plaçables, leurs 5 catégories, sockets, points d'accroche PNJ, visuels |
//! | `craft_theme_config` | les thèmes de ville et leurs types |
//!
//! # La catégorie n'est pas une taille, et son ordre trompe
//!
//! `CRAFT_OBJ_CATEGORY_INFO` associe à chaque catégorie le **nombre maximal d'objets de cette
//! catégorie plaçables dans une ville**. Le HUD d'édition du jeu affiche ces plafonds tels
//! quels — `L 5/20`, `M 10/50`, `S 55/80`, `35/100` — et son ordre L, M, S est **l'inverse** de
//! celui des identifiants : la catégorie 3 plafonne à 20 (`L`), la 1 à 80 (`S`). Lire
//! l'identifiant comme un rang de taille inverserait les trois.
//!
//! La réponse republie donc `max_placeable` à côté de chaque objet plutôt que de laisser un
//! client refaire la jointure à l'envers.
//!
//! # Ce que la réponse ne promet pas
//!
//! Les 27 variables d'un objet autres que sa catégorie n'ont **pas** de sémantique établie.
//! Elles ne sont pas publiées sous des noms inventés : le catalogue rend ce qui est prouvé
//! (identifiant, catégorie, plafond, tailles des sous-listes référencées) et se tait sur le
//! reste. Un champ nommé au jugé serait lu comme une mesure.
//!
//! # Nommage
//!
//! Identifiants, URLs et clés JSON en anglais, commentaires en français — la règle du dépôt.

use std::sync::OnceLock;

use axum::Json;
use axum::extract::{Query, State};
use serde::Serialize;

use crate::error::ErreurSite;
use crate::routes::{DemandePage, Page};
use crate::state::EtatSite;
use crate::vfs_index::IndexVfs;

/// Les clés de famille des deux sources.
mod keys {
    /// Les 160 objets plaçables et leurs catégories.
    pub const OBJ: &str = "craft_obj_config";
    /// Les thèmes de ville.
    pub const THEME: &str = "craft_theme_config";
}

/// Le préfixe VFS des deux fichiers — il lève l'ambiguïté si une autre famille prenait la
/// même clé dans une mise à jour du jeu.
const PREFIX: &str = "data/common/gamedata/craft/";

/// Une source résolue : la clé demandée et le chemin VFS réellement lu.
#[derive(Debug, Clone, Serialize)]
pub struct Source {
    /// Le rôle de la source (`objects`, `themes`).
    pub role: &'static str,
    /// La clé de famille qui l'a désignée.
    pub key: &'static str,
    /// Le chemin VFS retenu, numéro de version compris.
    pub path: String,
    /// Sa taille en octets, telle que l'index la donne.
    pub bytes: u32,
}

/// Une catégorie de placement, avec son plafond et sa population réelle.
#[derive(Debug, Clone, Serialize)]
pub struct Category {
    /// Identifiant de catégorie tel que le jeu le porte (1..=5 sur la version mesurée).
    pub id: i64,
    /// Nombre maximal d'objets de cette catégorie plaçables dans une ville.
    pub max_placeable: i64,
    /// Nombre de **types** d'objets déclarés dans cette catégorie — à distinguer du plafond,
    /// qui compte les exemplaires posés.
    pub object_types: usize,
}

/// Un objet plaçable, réduit à ce qui est prouvé.
#[derive(Debug, Clone, Serialize)]
pub struct Object {
    /// `craft_id`, en hexadécimal — c'est un CRC-32, un décimal signé s'y lirait mal.
    pub craft_id: String,
    /// Sa catégorie de placement.
    pub category: i64,
    /// Le plafond de cette catégorie, republié pour éviter une jointure à l'envers.
    /// `null` si la catégorie n'est pas déclarée — une donnée incohérente, pas un objet
    /// sans limite.
    pub max_placeable: Option<i64>,
    /// Nombre de personnages que cet objet peut attirer (sous-liste loterie).
    pub lottery_count: i64,
    /// Nombre de sockets d'intérêt.
    pub socket_count: i64,
    /// Nombre de points d'accroche de personnage — c'est ce qui permet de **poser un
    /// personnage** sur un objet, le second verbe de la Ville de lien.
    pub npc_stick_point_count: i64,
    /// Nombre de groupes de visuels.
    pub visual_group_count: i64,
}

/// Un thème de ville.
#[derive(Debug, Clone, Serialize)]
pub struct Theme {
    /// Identifiant du thème, en hexadécimal.
    pub theme_id: String,
    /// Nombre de types que ce thème référence.
    pub type_count: i64,
}

/// Le catalogue publié par `GET /api/v1/kizuna`.
#[derive(Debug, Clone, Serialize)]
pub struct Catalog {
    /// Les deux fichiers réellement lus, avec leur chemin résolu.
    pub sources: Vec<Source>,
    /// Nombre d'objets plaçables.
    pub object_count: usize,
    /// Les catégories, avec plafond et population.
    pub categories: Vec<Category>,
    /// Somme des plafonds — le nombre total d'objets qu'une ville peut porter.
    pub total_placeable: i64,
    /// Nombre de points d'accroche de personnage, toutes catégories confondues.
    pub npc_stick_point_count: usize,
    /// Nombre de sockets d'intérêt.
    pub socket_count: usize,
    /// Nombre d'entrées de loterie de personnages uniques.
    pub lottery_entry_count: usize,
    /// Nombre de thèmes et de types de thème.
    pub theme_count: usize,
    /// Nombre de types de thème.
    pub theme_type_count: usize,
    /// Millisecondes de la construction, mesurées au premier appel.
    pub build_ms: u64,
}

/// Ce qui est construit une fois puis gardé.
struct Built {
    sources: Vec<Source>,
    objects: Vec<Object>,
    categories: Vec<Category>,
    themes: Vec<Theme>,
    catalog: Catalog,
}

/// La construction est faite **au plus une fois** par processus.
static BUILT: OnceLock<Result<Built, String>> = OnceLock::new();

/// Lit un fichier du VFS et le rend sous la forme iecode que `nie-data` consomme.
fn read_iecode(vfs: &nie_formats::vfs::Vfs, path: &str) -> Result<serde_json::Value, String> {
    let bytes = vfs
        .read(path)
        .map_err(|e| format!("lecture impossible de `{path}` : {e}"))?;
    nie_formats::cfgbin::to_iecode_json(&bytes)
        .ok_or_else(|| format!("`{path}` n'est ni RDBN ni T2B"))
}

/// Construit le catalogue en joignant les deux sources.
///
/// Une source absente fait échouer la construction **avec son nom** : un catalogue bâti sur un
/// fichier sur deux rendrait des objets sans thème en annonçant un succès.
fn build(index: &IndexVfs, vfs: &nie_formats::vfs::Vfs) -> Result<Built, String> {
    let start = std::time::Instant::now();
    let mut sources = Vec::new();

    let mut take = |role: &'static str, key: &'static str| -> Result<String, String> {
        let (path, bytes) =
            super::donnees::resoudre(index, key, Some(PREFIX)).ok_or_else(|| {
                format!("source `{role}` absente : aucun `{key}` sous `{PREFIX}` dans ce VFS")
            })?;
        sources.push(Source {
            role,
            key,
            path: path.clone(),
            bytes,
        });
        Ok(path)
    };

    let obj_path = take("objects", keys::OBJ)?;
    let theme_path = take("themes", keys::THEME)?;

    let obj_cfg = nie_data::craft::parse_craft_obj_config(&read_iecode(vfs, &obj_path)?);
    let theme_cfg = nie_data::craft::parse_craft_theme_config(&read_iecode(vfs, &theme_path)?);

    let categories: Vec<Category> = obj_cfg
        .categories
        .iter()
        .map(|info| Category {
            id: info.category,
            max_placeable: info.value,
            object_types: obj_cfg.objs_in_category(info.category).len(),
        })
        .collect();

    let objects: Vec<Object> = obj_cfg
        .objs
        .iter()
        .map(|obj| Object {
            craft_id: format!("{:#010X}", obj.craft_id.0),
            category: obj.category(),
            max_placeable: obj_cfg.max_placeable(obj.category()),
            lottery_count: obj.ref_lottery.count,
            socket_count: obj.ref_socket.count,
            npc_stick_point_count: obj.ref_npc_stick.count,
            visual_group_count: obj.ref_visual_group.count,
        })
        .collect();

    let themes: Vec<Theme> = theme_cfg
        .themes
        .iter()
        .map(|theme| Theme {
            theme_id: format!("{:#010X}", theme.theme_id.0),
            type_count: theme.ref_types.count,
        })
        .collect();

    let catalog = Catalog {
        sources: sources.clone(),
        object_count: objects.len(),
        total_placeable: categories.iter().map(|c| c.max_placeable).sum(),
        categories: categories.clone(),
        npc_stick_point_count: obj_cfg.npc_stick_points.len(),
        socket_count: obj_cfg.sockets.len(),
        lottery_entry_count: obj_cfg.lottery_unique_charas.len(),
        theme_count: themes.len(),
        theme_type_count: theme_cfg.theme_types.len(),
        build_ms: u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX),
    };

    Ok(Built {
        sources,
        objects,
        categories,
        themes,
        catalog,
    })
}

/// Rend la construction partagée, ou l'erreur qui l'a empêchée.
fn built(state: &EtatSite) -> Result<&'static Built, ErreurSite> {
    let index = state.index()?;
    let vfs = state.vfs()?;
    match BUILT.get_or_init(|| build(&index, &vfs)) {
        Ok(b) => Ok(b),
        Err(raison) => Err(ErreurSite::Indisponible(raison.clone())),
    }
}

/// `GET /api/v1/kizuna` — le catalogue mesuré de la Ville de lien.
pub async fn catalogue(State(state): State<EtatSite>) -> Result<Json<Catalog>, ErreurSite> {
    let b = tokio::task::spawn_blocking(move || built(&state)).await??;
    Ok(Json(b.catalog.clone()))
}

/// `GET /api/v1/kizuna/categories` — les catégories de placement et leurs plafonds.
pub async fn categories(State(state): State<EtatSite>) -> Result<Json<Vec<Category>>, ErreurSite> {
    let b = tokio::task::spawn_blocking(move || built(&state)).await??;
    Ok(Json(b.categories.clone()))
}

/// `GET /api/v1/kizuna/objects` — les objets plaçables, paginés.
///
/// `q` filtre sur l'identifiant hexadécimal, sans casse.
pub async fn objects(
    State(state): State<EtatSite>,
    Query(demande): Query<DemandePage>,
) -> Result<Json<Page<Object>>, ErreurSite> {
    let built = tokio::task::spawn_blocking(move || built(&state)).await??;
    let bornes = demande.bornee()?;
    let motif = demande
        .effective_q()
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(str::to_lowercase);

    let retenus: Vec<&Object> = built
        .objects
        .iter()
        .filter(|obj| {
            motif
                .as_ref()
                .is_none_or(|q| obj.craft_id.to_lowercase().contains(q))
        })
        .collect();

    let total = retenus.len();
    let debut = ((bornes.page.max(1) - 1) as usize).saturating_mul(bornes.per_page as usize);
    let elements: Vec<Object> = retenus
        .into_iter()
        .skip(debut)
        .take(bornes.per_page as usize)
        .cloned()
        .collect();

    Ok(Json(Page::nouvelle(elements, bornes, total).filtree(motif)))
}

/// `GET /api/v1/kizuna/themes` — les thèmes de ville.
pub async fn themes(State(state): State<EtatSite>) -> Result<Json<Vec<Theme>>, ErreurSite> {
    let b = tokio::task::spawn_blocking(move || built(&state)).await??;
    Ok(Json(b.themes.clone()))
}

/// `GET /api/v1/kizuna/sources` — les fichiers du jeu réellement lus.
///
/// Elle existe pour que le catalogue soit **vérifiable** : un client peut confronter le chemin
/// et la taille à ce que `nie vfs stat` répond, plutôt que de croire les comptes sur parole.
pub async fn sources(State(state): State<EtatSite>) -> Result<Json<Vec<Source>>, ErreurSite> {
    let b = tokio::task::spawn_blocking(move || built(&state)).await??;
    Ok(Json(b.sources.clone()))
}
