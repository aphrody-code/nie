//! `/api/v1/ut` — IEVR Ultimate Team backend endpoints.
//!
//! Provides the REST API for:
//! - Player catalogue search (497 players with CRC32 parameters)
//! - Club / team list (69 teams with Level-5 emblem IDs)
//! - Pack definitions & pack opening simulator
//! - Pitch formations with 2D slot coordinates
//! - Squad valuation & chemistry
//! - Spirit cards & special moves lookup
//! - Cryptographic team export/import (AES-256-GCM + PBKDF2)

use axum::Json;
use axum::extract::Query;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};

use nie_launcher::spirit::{
    all_special_moves, all_spirit_cards, search_special_moves, search_spirit_cards,
};
use nie_launcher::team::{
    DEFAULT_PASSPHRASE, TeamExportEnvelope, TeamLineup, decrypt_team_envelope,
    encrypt_team_envelope,
};
use nie_launcher::ut::{UtDatabase, calculate_squad_valuation, formation_layout, open_pack};

/// Query parameters for searching players.
#[derive(Debug, Deserialize)]
pub struct PlayerSearchQuery {
    /// Free-text search query for player name, nickname or ID. Legacy name of `query`.
    pub q: Option<String>,
    /// Canonical name of `q` (`aphrody-contracts` §6.3). Wins when both are supplied.
    pub query: Option<String>,
    /// Elemental affinity filter (e.g. Fire, Wind, Earth, Wood).
    pub element: Option<String>,
    /// Card rarity filter (e.g. Común, Raro, Legendario, Ícono, Basara).
    pub rarity: Option<String>,
    /// Result limit.
    pub limit: Option<usize>,
}

impl PlayerSearchQuery {
    /// The search text actually used: `query` wins over its legacy alias `q`.
    fn effective_q(&self) -> Option<&str> {
        self.query.as_deref().or(self.q.as_deref())
    }
}

/// Request body for pack opening.
#[derive(Debug, Deserialize)]
pub struct OpenPackRequest {
    /// Pack ID to open (e.g. pack_comun, pack_legendario, pack_basara).
    pub pack_id: String,
    /// Optional deterministic seed for testing.
    pub seed: Option<u64>,
}

/// Request body for squad valuation.
#[derive(Debug, Deserialize)]
pub struct SquadValuationRequest {
    /// Team lineup to evaluate.
    pub lineup: TeamLineup,
}

/// Query parameters for searching spirits or moves.
#[derive(Debug, Deserialize)]
pub struct SpiritSearchQuery {
    /// Text search query. Legacy name of `query`.
    pub q: Option<String>,
    /// Canonical name of `q` (`aphrody-contracts` §6.3). Wins when both are supplied.
    pub query: Option<String>,
    /// Category filter (e.g. Shot, Catch, Dribble, Block).
    pub category: Option<String>,
    /// Result limit.
    pub limit: Option<usize>,
}

impl SpiritSearchQuery {
    /// The search text actually used: `query` wins over its legacy alias `q`.
    fn effective_q(&self) -> Option<&str> {
        self.query.as_deref().or(self.q.as_deref())
    }
}

/// Request body for encrypting a team lineup.
#[derive(Debug, Deserialize)]
pub struct EncryptTeamRequest {
    /// Team lineup to encrypt.
    pub lineup: TeamLineup,
    /// Optional encryption passphrase.
    pub passphrase: Option<String>,
}

/// Request body for decrypting a team envelope.
#[derive(Debug, Deserialize)]
pub struct DecryptTeamRequest {
    /// Envelope to decrypt.
    pub envelope: TeamExportEnvelope,
    /// Optional decryption passphrase.
    pub passphrase: Option<String>,
}

/// Standard JSON error response.
#[derive(Debug, Serialize)]
pub struct UtErrorResponse {
    /// Human-readable error message.
    pub error: String,
}

fn err_json(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<UtErrorResponse>) {
    (status, Json(UtErrorResponse { error: msg.into() }))
}

/// `GET /api/v1/ut/players` — Search or list players.
pub async fn get_players(Query(query): Query<PlayerSearchQuery>) -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    let limit = query.limit.unwrap_or(100).min(500);
    match db.search_players(
        query.effective_q(),
        query.element.as_deref(),
        query.rarity.as_deref(),
        limit,
    ) {
        Ok(players) => (StatusCode::OK, Json(players)).into_response(),
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Search failed: {e}"),
        )
        .into_response(),
    }
}

/// `GET /api/v1/ut/teams` — List clubs and teams.
pub async fn get_teams() -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    match db.get_teams() {
        Ok(teams) => (StatusCode::OK, Json(teams)).into_response(),
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get teams: {e}"),
        )
        .into_response(),
    }
}

/// `GET /api/v1/ut/packs` — List available card packs and drop rates.
pub async fn get_packs() -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    match db.get_packs() {
        Ok(packs) => (StatusCode::OK, Json(packs)).into_response(),
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get packs: {e}"),
        )
        .into_response(),
    }
}

/// `POST /api/v1/ut/packs/open` — Open a card pack with RNG and drop rate simulation.
pub async fn post_open_pack(Json(req): Json<OpenPackRequest>) -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    let pack = match db.get_pack(&req.pack_id) {
        Ok(Some(p)) => p,
        Ok(None) => {
            return err_json(
                StatusCode::NOT_FOUND,
                format!("Pack '{}' not found", req.pack_id),
            )
            .into_response();
        }
        Err(e) => {
            return err_json(StatusCode::INTERNAL_SERVER_ERROR, format!("DB error: {e}"))
                .into_response();
        }
    };

    let players = match db.get_players() {
        Ok(p) => p,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to load players: {e}"),
            )
            .into_response();
        }
    };

    let mut rng = rand::thread_rng();
    let result = open_pack(&pack, &players, &mut rng);

    (StatusCode::OK, Json(result)).into_response()
}

/// `GET /api/v1/ut/formations` — List pitch formations and slot positions.
pub async fn get_formations() -> impl IntoResponse {
    let names = [
        "4-3-3",
        "4-4-2",
        "3-5-2",
        "3-4-3",
        "4-5-1",
        "5-4-1",
        "5-3-2",
        "4-2-4",
        "Death Zone 3-4-3",
    ];

    let mut layouts = Vec::new();
    for name in names {
        layouts.push(formation_layout(name));
    }

    (StatusCode::OK, Json(layouts)).into_response()
}

/// `POST /api/v1/ut/valuation` — Calculate coin valuation and chemistry for a squad.
pub async fn post_valuation(Json(req): Json<SquadValuationRequest>) -> impl IntoResponse {
    let db = UtDatabase::open_default().ok();
    let valuation = calculate_squad_valuation(&req.lineup, db.as_ref());
    (StatusCode::OK, Json(valuation)).into_response()
}

/// `GET /api/v1/ut/spirits` — Search spirit cards.
pub async fn get_spirits(Query(query): Query<SpiritSearchQuery>) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50).min(200);
    let cards: Vec<&'static nie_launcher::spirit::SpiritCard> = if let Some(q) = query.effective_q() {
        search_spirit_cards(q)
    } else {
        all_spirit_cards().iter().collect()
    };

    let sliced = cards.into_iter().take(limit).collect::<Vec<_>>();
    (StatusCode::OK, Json(sliced)).into_response()
}

/// `GET /api/v1/ut/moves` — Search special moves (hissatsu).
pub async fn get_moves(Query(query): Query<SpiritSearchQuery>) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50).min(200);

    if let Ok(db) = UtDatabase::open_default()
        && db.has_azalee()
        && let Ok(mirror_skills) = db.get_skills(query.category.as_deref(), limit)
        && !mirror_skills.is_empty()
    {
        return (StatusCode::OK, Json(mirror_skills)).into_response();
    }

    let moves: Vec<&'static nie_launcher::spirit::SpecialMove> = if let Some(q) = query.effective_q() {
        search_special_moves(q)
    } else {
        all_special_moves().iter().collect()
    };

    let filtered = if let Some(ref cat) = query.category {
        moves
            .into_iter()
            .filter(|m| m.category.eq_ignore_ascii_case(cat))
            .collect()
    } else {
        moves
    };

    let sliced = filtered.into_iter().take(limit).collect::<Vec<_>>();
    (StatusCode::OK, Json(sliced)).into_response()
}

/// `GET /api/v1/ut/uniforms` — List team uniforms from fused catalogue.
pub async fn get_uniforms() -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    match db.get_uniforms(100) {
        Ok(uniforms) => (StatusCode::OK, Json(uniforms)).into_response(),
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get uniforms: {e}"),
        )
        .into_response(),
    }
}

/// `GET /api/v1/ut/stadiums` — List stadiums from fused catalogue.
pub async fn get_stadiums() -> impl IntoResponse {
    let db = match UtDatabase::open_default() {
        Ok(db) => db,
        Err(e) => {
            return err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to open UT database: {e}"),
            )
            .into_response();
        }
    };

    match db.get_stadiums(100) {
        Ok(stadiums) => (StatusCode::OK, Json(stadiums)).into_response(),
        Err(e) => err_json(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to get stadiums: {e}"),
        )
        .into_response(),
    }
}

/// `POST /api/v1/ut/team/encrypt` — Encrypt team lineup to AES-256-GCM envelope.
pub async fn post_encrypt_team(Json(req): Json<EncryptTeamRequest>) -> impl IntoResponse {
    let pass = req.passphrase.as_deref().unwrap_or(DEFAULT_PASSPHRASE);
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    rand::Rng::fill(&mut rand::thread_rng(), &mut salt[..]);
    rand::Rng::fill(&mut rand::thread_rng(), &mut iv[..]);

    match encrypt_team_envelope(&req.lineup, pass, &salt, &iv) {
        Ok(envelope) => (StatusCode::OK, Json(envelope)).into_response(),
        Err(e) => {
            err_json(StatusCode::BAD_REQUEST, format!("Encryption failed: {e}")).into_response()
        }
    }
}

/// `POST /api/v1/ut/team/decrypt` — Decrypt team envelope to TeamLineup.
pub async fn post_decrypt_team(Json(req): Json<DecryptTeamRequest>) -> impl IntoResponse {
    let pass = req.passphrase.as_deref().unwrap_or(DEFAULT_PASSPHRASE);
    match decrypt_team_envelope(&req.envelope, pass) {
        Ok(lineup) => (StatusCode::OK, Json(lineup)).into_response(),
        Err(e) => {
            err_json(StatusCode::BAD_REQUEST, format!("Decryption failed: {e}")).into_response()
        }
    }
}

/// `GET /api/v1/ut/open-pack` — Contract for opening a card pack.
pub async fn contract_open_pack() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "route": "POST /api/v1/ut/open-pack",
        "description": "Simulates drawing cards from an official IEVR Ultimate Team pack",
        "body": {
            "pack_id": "string, required (e.g. 'pack_comun', 'pack_legendario', 'pack_basara')",
            "seed": "u64, optional RNG seed"
        }
    }))
}

/// `GET /api/v1/ut/valuation` — Contract for squad valuation.
pub async fn contract_valuation() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "route": "POST /api/v1/ut/valuation",
        "description": "Computes coin market valuation and quicksell price for squad cards",
        "body": {
            "player_ids": ["string, array of player parameter IDs"]
        }
    }))
}

/// `GET /api/v1/ut/team/encrypt` — Contract for team encryption.
pub async fn contract_encrypt_team() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "route": "POST /api/v1/ut/team/encrypt",
        "description": "Encrypts a TeamLineup into an AES-256-GCM + PBKDF2 envelope",
        "body": {
            "lineup": "TeamLineup object",
            "passphrase": "string, optional"
        }
    }))
}

/// `GET /api/v1/ut/team/decrypt` — Contract for team decryption.
pub async fn contract_decrypt_team() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "route": "POST /api/v1/ut/team/decrypt",
        "description": "Decrypts an AES-256-GCM + PBKDF2 envelope into a TeamLineup object",
        "body": {
            "envelope": "TeamExportEnvelope object",
            "passphrase": "string, optional"
        }
    }))
}

#[cfg(test)]
mod search_alias_tests {
    use super::*;

    #[test]
    fn query_is_an_alias_of_q_on_both_search_structs() {
        let player = PlayerSearchQuery {
            q: Some("legacy".into()),
            query: Some("canonical".into()),
            element: None,
            rarity: None,
            limit: None,
        };
        assert_eq!(player.effective_q(), Some("canonical"));
        let spirit = SpiritSearchQuery {
            q: Some("legacy".into()),
            query: None,
            category: None,
            limit: None,
        };
        assert_eq!(spirit.effective_q(), Some("legacy"));
    }
}
