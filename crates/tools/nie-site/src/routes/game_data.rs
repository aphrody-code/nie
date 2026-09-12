//! `/api/v1/game-data` — the same read-only game-data decoding the Tauri desktop host serves.
//!
//! Inacord has ~26 native `game_data_*` commands (`nie_app::game_data`, moved there from the
//! Tauri crate on 2026-09-12 precisely so this route could exist without a second decoder):
//! skills, items, auras, trophies, quests, shops, stadiums, passives, special tactics, emblems,
//! gallery, tricks, activities, belong teams, formations, uniforms, characters, opponent teams,
//! movies, musics, dictionary, exp table, drops, capsule rates, name index, plus the character
//! picker and the stat calculator. The browser build of Inacord (`nie-web`) talks HTTP instead
//! of Tauri IPC and needs the exact same data — not a reimplementation that could drift.
//!
//! # Naming
//!
//! English-only, per the 2026-09-06 rule (cf. `routes::growth`, `routes::text`): this is a new
//! namespace, unlike `routes::donnees`/`routes::regles` which keep their existing French names.
//!
//! # Routes
//!
//! | Route | What it serves |
//! |---|---|
//! | `GET /api/v1/game-data/{family}` | one of the 26 families, as a JSON array |
//! | `GET /api/v1/game-data/skills/{id}` | one skill, resolved by id or name (`find_skill`) |
//! | `GET /api/v1/game-data/calculate_stats` | the contract the `POST` of the same path expects |
//! | `POST /api/v1/game-data/calculate_stats` | a computed [`nie_app::game_data::StatBlockDto`] |
//! | `GET /api/v1/game-data/decode_cfgbin?path=` | any `.cfg.bin`, RDBN or T2B, generic decode |
//!
//! `{family}`, `skills/{id}`, `calculate_stats` and `decode_cfgbin` are four distinct route
//! segments counts (one, two, one literal, one literal): axum's `matchit` always prefers a
//! literal segment over `{family}`, so none of the three literals is ever swallowed by the
//! dynamic one.
//!
//! # Errors
//!
//! An unknown family is a `404` that names the family it received, never an empty array a
//! client would mistake for "this game has none of that". A VFS that is not mounted is a `503`,
//! like every other route that reads game data (cf. `routes::donnees`, `routes::passives`).

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

use crate::error::ErreurSite;
use crate::state::EtatSite;
use nie_app::game_data;
use nie_formats::vfs::Vfs;

/// The site caches these responses lightly: they are pure functions of the mounted VFS, which
/// does not change while the process runs, but recomputing a 6000-character roster on every
/// request would be wasteful all the same.
const CACHE_CONTROL: &str = "public, max-age=300";

/// The 26 families this route dispatches to `nie_app::game_data::list_*`, in the order Inacord
/// declares its Tauri commands — kept in sync by [`super::super::tests`]-style coverage, not by
/// convention alone.
pub const FAMILIES: &[&str] = &[
    "skills",
    "items",
    "auras",
    "trophies",
    "quests",
    "chara_picker",
    "shops",
    "stadiums",
    "passives",
    "special_tactics",
    "emblems",
    "gallery",
    "tricks",
    "activities",
    "belong_teams",
    "formations",
    "uniforms",
    "charas",
    "opponent_teams",
    "movies",
    "musics",
    "dictionary",
    "exp_table",
    "drops",
    "capsule_rates",
    "noms",
];

/// Decodes one family against the mounted VFS, returning the same DTO Inacord's Tauri command
/// returns — serialized to `Value` here because the 26 `list_*` functions do not share a
/// concrete return type.
fn decode_family(family: &str, vfs: &Vfs) -> Option<Result<serde_json::Value, String>> {
    macro_rules! list {
        ($f:path) => {
            Some($f(vfs).and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())))
        };
    }
    match family {
        "skills" => list!(game_data::list_skills),
        "items" => list!(game_data::list_items),
        "auras" => list!(game_data::list_auras),
        "trophies" => list!(game_data::list_trophies),
        "quests" => list!(game_data::list_quests),
        "chara_picker" => list!(game_data::list_chara_picker),
        "shops" => list!(game_data::list_shops),
        "stadiums" => list!(game_data::list_stadiums),
        "passives" => list!(game_data::list_passives),
        "special_tactics" => list!(game_data::list_special_tactics),
        "emblems" => list!(game_data::list_emblems),
        "gallery" => list!(game_data::list_gallery),
        "tricks" => list!(game_data::list_tricks),
        "activities" => list!(game_data::list_activities),
        "belong_teams" => list!(game_data::list_belong_teams),
        "formations" => list!(game_data::list_formations),
        "uniforms" => list!(game_data::list_uniforms),
        "charas" => list!(game_data::list_charas),
        "opponent_teams" => list!(game_data::list_opponent_teams),
        "movies" => list!(game_data::list_movies),
        "musics" => list!(game_data::list_musics),
        "dictionary" => list!(game_data::list_dictionary),
        "exp_table" => list!(game_data::list_exp_table),
        "drops" => list!(game_data::list_drops),
        "capsule_rates" => list!(game_data::list_capsule_rates),
        "noms" => list!(game_data::list_noms),
        _ => None,
    }
}

/// A JSON body with a `Cache-Control` header, for the pure-function families below.
pub struct Cached(serde_json::Value);

impl IntoResponse for Cached {
    fn into_response(self) -> Response {
        let mut response = Json(self.0).into_response();
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(CACHE_CONTROL),
        );
        response
    }
}

/// `GET /api/v1/game-data/{family}` — one of the 26 families, cf. [`FAMILIES`].
pub async fn family(
    State(etat): State<EtatSite>,
    Path(family): Path<String>,
) -> Result<Cached, ErreurSite> {
    if !FAMILIES.contains(&family.as_str()) {
        return Err(ErreurSite::Introuvable(format!(
            "no game-data family named `{family}`; known families are on \
             /api/v1/game-data/skills (and 25 more, cf. the module documentation)"
        )));
    }
    let vfs = etat.vfs()?;
    let family_owned = family.clone();
    let valeur = tokio::task::spawn_blocking(move || decode_family(&family_owned, &vfs))
        .await?
        .expect("family already validated against FAMILIES")
        .map_err(ErreurSite::Indisponible)?;
    Ok(Cached(valeur))
}

/// `GET /api/v1/game-data/skills/{id}` — one skill, resolved by exact id or name substring
/// (`nie_app::game_data::find_skill`). `404` when nothing matches: an absent skill is not the
/// same failure as an unmounted VFS.
pub async fn skill(
    State(etat): State<EtatSite>,
    Path(id): Path<String>,
) -> Result<Cached, ErreurSite> {
    let vfs = etat.vfs()?;
    let query = id.clone();
    let trouve = tokio::task::spawn_blocking(move || game_data::find_skill(&vfs, &query))
        .await?
        .map_err(ErreurSite::Indisponible)?
        .ok_or_else(|| ErreurSite::Introuvable(format!("no skill matches `{id}`")))?;
    let valeur = serde_json::to_value(trouve).map_err(|e| ErreurSite::Interne(e.to_string()))?;
    Ok(Cached(valeur))
}

/// What the `POST` of the same path expects — published instead of a bare `405`, same
/// convention as every other route in [`crate::app::CHEMINS_HORS_GET`].
#[derive(Debug, Serialize)]
pub struct CalculateStatsContract {
    /// The character variant to compute stats for, cf. `GET /api/v1/game-data/chara_picker`.
    pub chara_param_id: &'static str,
    /// Character level, `1..=99`.
    pub level: &'static str,
    /// `0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA`.
    pub rarity_code: &'static str,
    /// The path and method that answers this contract.
    pub route: &'static str,
}

/// `GET /api/v1/game-data/calculate_stats` — the contract, cf. [`CalculateStatsContract`].
pub async fn calculate_stats_contract() -> Json<CalculateStatsContract> {
    Json(CalculateStatsContract {
        chara_param_id: "string, required",
        level: "integer 1..=99, required",
        rarity_code: "integer, required",
        route: "POST /api/v1/game-data/calculate_stats",
    })
}

/// Body of `POST /api/v1/game-data/calculate_stats` — the same three fields the Tauri command
/// `game_data_calculate_stats` takes.
#[derive(Debug, Deserialize)]
pub struct CalculateStatsRequest {
    /// The character variant to compute stats for, cf. `GET /api/v1/game-data/chara_picker`.
    pub chara_param_id: String,
    /// Character level, `1..=99`.
    pub level: u8,
    /// `0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA`.
    pub rarity_code: u8,
}

/// `POST /api/v1/game-data/calculate_stats` — computed [`nie_app::game_data::StatBlockDto`].
///
/// Not a `GET` with a query string: it is here for parity with the Tauri command's signature,
/// and a query string works just as well for three scalars, but every other computed-from-a-body
/// route in this crate (`routes::regles::comparaison`, `routes::team::synergy`) is a `POST` for
/// the same reason — the request shape is a struct clients already serialize once, not a set of
/// independently-typed query parameters.
pub async fn calculate_stats(
    State(etat): State<EtatSite>,
    Json(demande): Json<CalculateStatsRequest>,
) -> Result<Json<game_data::StatBlockDto>, ErreurSite> {
    let vfs = etat.vfs()?;
    let resultat = tokio::task::spawn_blocking(move || {
        game_data::calculate_character_stats(
            &vfs,
            &demande.chara_param_id,
            demande.level,
            demande.rarity_code,
        )
    })
    .await?
    .map_err(ErreurSite::Introuvable)?;
    Ok(Json(resultat))
}

/// Query of `GET /api/v1/game-data/decode_cfgbin`.
#[derive(Debug, Deserialize)]
pub struct DecodeCfgbinQuery {
    /// VFS path of the `.cfg.bin` to decode.
    pub path: String,
}

/// `GET /api/v1/game-data/decode_cfgbin?path=` — any `.cfg.bin`, RDBN or T2B, generic decode
/// (`nie_app::game_data::decode_cfgbin`, itself `nie_explore::bridge` — the same engine as
/// `niers vfs cat`). Distinct from `/api/v1/formats/decode/{path}` only in URL shape: both rend
/// the generic container structure, not a named family (cf. `routes::donnees` for the named one).
pub async fn decode_cfgbin(
    State(etat): State<EtatSite>,
    Query(demande): Query<DecodeCfgbinQuery>,
) -> Result<Cached, ErreurSite> {
    let vfs = etat.vfs()?;
    let path = demande.path;
    let valeur = tokio::task::spawn_blocking(move || game_data::decode_cfgbin(&vfs, &path))
        .await?
        .map_err(ErreurSite::Introuvable)?;
    Ok(Cached(valeur))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_26_families_dispatch_and_nothing_else_does() {
        assert_eq!(FAMILIES.len(), 26, "the 26 game_data_* families");
        for family in FAMILIES {
            // A dummy in-memory VFS has no game data mounted: every family must at least
            // dispatch (return `Some`), even though the decode itself then fails.
            assert!(
                decode_family(family, &Vfs::new()).is_some(),
                "family `{family}` does not dispatch"
            );
        }
        assert!(
            decode_family("not_a_real_family", &Vfs::new()).is_none(),
            "an unknown family must not dispatch"
        );
    }
}
