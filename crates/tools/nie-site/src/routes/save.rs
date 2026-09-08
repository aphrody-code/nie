//! `/api/v1/save` resolves save roster character identifiers in batches.
//!
//! # What the route does and does not receive
//!
//! Save data is read on the player's device. The server therefore receives neither a save file,
//! progression data nor a player name. It only receives character identifiers matching the
//! game's `chara_base` data.
//!
//! Reading personal save data and resolving a list of game identifiers are separate
//! capabilities. This route only implements the latter.
//!
//! # Why this is a batch route
//!
//! A roster can contain thousands of entries. Resolving them through
//! `/api/v1/entites/inagle_characters/{id}` would require one round trip per character and make
//! each client implement its own unknown-ID behavior. This route performs that work once.
//!
//! # Unknown identifiers
//!
//! An identifier missing from the mirror is returned with `name: null`; it is never guessed or
//! omitted. `matched` and `total` make the difference explicit.
//!
//! # Routes
//!
//! | Route | Response |
//! |---|---|
//! | `GET /api/v1/save/roster` | accepted ID forms, limits and response fields |
//! | `POST /api/v1/save/roster` | resolved IDs in request order, with duplicates removed |

use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};

use crate::error::ErreurSite;
use crate::state::EtatSite;

/// Maximum number of identifiers accepted in one request.
///
/// Valid rosters are smaller; the limit rejects unreasonable input before it reaches SQLite.
pub const IDS_MAX: usize = 8000;

/// Number of identifiers sent to SQLite in one query.
///
/// This stays below SQLite's default `SQLITE_MAX_VARIABLE_NUMBER` of 999.
const CHUNK: usize = 900;

/// Mirror table queried by the service; it is never supplied by the client.
const TABLE: &str = "inagle_characters";

/// Body of `POST /api/v1/save/roster`.
#[derive(Debug, Clone, Deserialize)]
pub struct RosterRequest {
    /// Identifiers in any of the three accepted forms.
    pub ids: Vec<String>,
}

/// One resolved or unknown character.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedCharacter {
    /// Canonical mirror identifier: `0x` followed by eight uppercase hexadecimal digits.
    pub id: String,
    /// Exact input form, allowing the client to identify the original row.
    pub requested: String,
    /// French name, or `null` when the mirror does not contain the identifier.
    pub name: Option<String>,
    /// Base slug without the variant suffix.
    pub base_slug: Option<String>,
    /// Element.
    pub element: Option<String>,
    /// Position.
    pub position: Option<String>,
    /// Rarity label.
    pub rarity: Option<String>,
}

/// Response from `POST /api/v1/save/roster`.
#[derive(Debug, Clone, Serialize)]
pub struct RosterResponse {
    /// Resolved identifiers in first-occurrence request order.
    pub resolved: Vec<ResolvedCharacter>,
    /// Number of identifiers with a name.
    pub matched: usize,
    /// Number of distinct valid identifiers processed.
    pub total: usize,
    /// Number of duplicate request entries removed.
    pub duplicates: usize,
    /// Number of entries rejected before the database query.
    pub rejected: usize,
}

/// Contract published by `GET /api/v1/save/roster`.
#[derive(Debug, Clone, Serialize)]
pub struct RosterContract {
    /// HTTP method.
    pub method: &'static str,
    /// Route path.
    pub path: &'static str,
    /// Request body keys.
    pub body: &'static [&'static str],
    /// The three accepted identifier forms, with one example each.
    pub id_forms: &'static [&'static str],
    /// Fields returned for each character.
    pub fields: &'static [&'static str],
    /// Maximum number of identifiers in one request.
    pub ids_max: usize,
    /// Personal data explicitly excluded from this route.
    pub never_received: &'static [&'static str],
}

/// Normalizes an identifier to the mirror representation (`0xXXXXXXXX`).
///
/// Accepted forms are `0xF5E1E7CD`, `F5E1E7CD` and its unsigned decimal representation
/// `4125222861`.
///
/// Returns `None` for every other form so invalid values can be rejected and counted.
#[must_use]
pub fn normalize(raw: &str) -> Option<String> {
    nie_save::body::autosave_roster::CharaId::parse_external(raw).map(|id| id.to_string())
}

/// Returns the `GET /api/v1/save/roster` contract.
pub async fn contract() -> Json<RosterContract> {
    Json(RosterContract {
        method: "POST",
        path: "/api/v1/save/roster",
        body: &["ids"],
        id_forms: &["0xF5E1E7CD", "F5E1E7CD", "4125222861"],
        fields: &[
            "id",
            "requested",
            "name",
            "base_slug",
            "element",
            "position",
            "rarity",
        ],
        ids_max: IDS_MAX,
        never_received: &[
            "aucun fichier de sauvegarde : seuls des identifiants de personnages sont acceptes",
            "aucune progression, aucun pseudonyme, aucune donnee de compte",
        ],
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedIds {
    ordered: Vec<(String, String)>,
    duplicates: usize,
    rejected: usize,
}

fn validate_id_count(count: usize) -> Result<(), ErreurSite> {
    if count == 0 {
        return Err(ErreurSite::Demande(
            "`ids` est vide : le contrat est sur GET /api/v1/save/roster".to_owned(),
        ));
    }
    if count > IDS_MAX {
        return Err(ErreurSite::Demande(format!(
            "trop d'identifiants : {count} (borne {IDS_MAX})"
        )));
    }
    Ok(())
}

fn normalize_ids(inputs: &[String]) -> NormalizedIds {
    let mut ordered = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut rejected = 0;
    let mut duplicates = 0;

    for raw in inputs {
        match normalize(raw) {
            Some(id) if seen.insert(id.clone()) => ordered.push((id, raw.clone())),
            Some(_) => duplicates += 1,
            None => rejected += 1,
        }
    }

    NormalizedIds {
        ordered,
        duplicates,
        rejected,
    }
}

/// Resolves one roster through `POST /api/v1/save/roster`.
///
/// # Errors
///
/// Returns `400` when `ids` is empty or exceeds [`IDS_MAX`], and `503` without a mirror.
pub async fn roster(
    State(state): State<EtatSite>,
    Json(request): Json<RosterRequest>,
) -> Result<Json<RosterResponse>, ErreurSite> {
    validate_id_count(request.ids.len())?;
    let normalized = normalize_ids(&request.ids);

    let ids: Vec<String> = normalized
        .ordered
        .iter()
        .map(|(id, _)| id.clone())
        .collect();
    let dataset = state.gisement.clone();
    let rows = tokio::task::spawn_blocking(move || query(&dataset, &ids)).await??;

    let mut resolved = Vec::with_capacity(normalized.ordered.len());
    let mut matched = 0usize;
    for (id, requested) in normalized.ordered {
        let row = rows.get(&id);
        if row.is_some() {
            matched += 1;
        }
        resolved.push(ResolvedCharacter {
            id,
            requested,
            name: row.and_then(|value| value.name.clone()),
            base_slug: row.and_then(|value| value.base_slug.clone()),
            element: row.and_then(|value| value.element.clone()),
            position: row.and_then(|value| value.position.clone()),
            rarity: row.and_then(|value| value.rarity.clone()),
        });
    }

    Ok(Json(RosterResponse {
        total: resolved.len(),
        matched,
        duplicates: normalized.duplicates,
        rejected: normalized.rejected,
        resolved,
    }))
}

/// One mirror row reduced to the published columns.
#[derive(Debug, Clone, Default)]
struct Row {
    /// `name_fr`.
    name: Option<String>,
    /// `base_slug`.
    base_slug: Option<String>,
    /// `element`.
    element: Option<String>,
    /// `position`.
    position: Option<String>,
    /// `rarity_label`.
    rarity: Option<String>,
}

/// Queries the mirror in chunks of [`CHUNK`] identifiers.
///
/// This blocking function is called through `spawn_blocking`.
fn query(
    dataset: &crate::dataset::Gisement,
    ids: &[String],
) -> Result<std::collections::HashMap<String, Row>, ErreurSite> {
    dataset.lire(|connection| {
        let mut out = std::collections::HashMap::with_capacity(ids.len());
        for chunk in ids.chunks(CHUNK) {
            // Only the number of bound parameters changes; client input never becomes SQL.
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT id, name_fr, base_slug, element, position, rarity_label \
                 FROM {TABLE} WHERE id IN ({placeholders})"
            );
            let mut statement = connection.prepare(&sql).map_err(map_sql_error)?;
            let rows = statement
                .query_map(rusqlite::params_from_iter(chunk.iter()), |record| {
                    Ok((
                        record.get::<_, String>(0)?,
                        Row {
                            name: record.get(1)?,
                            base_slug: record.get(2)?,
                            element: record.get(3)?,
                            position: record.get(4)?,
                            rarity: record.get(5)?,
                        },
                    ))
                })
                .map_err(map_sql_error)?;
            for row in rows {
                let (id, row) = row.map_err(map_sql_error)?;
                out.insert(id, row);
            }
        }
        Ok(out)
    })
}

/// Maps a SQLite error without exposing the query or database path.
fn map_sql_error(error: rusqlite::Error) -> ErreurSite {
    tracing::error!(erreur = %error, "lecture du miroir impossible");
    ErreurSite::Interne("lecture du gisement impossible".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_three_forms_produce_the_same_identifier() {
        let expected = "0xF5E1E7CD";
        assert_eq!(normalize("0xF5E1E7CD").as_deref(), Some(expected));
        assert_eq!(normalize("0xf5e1e7cd").as_deref(), Some(expected));
        assert_eq!(normalize("F5E1E7CD").as_deref(), Some(expected));
        assert_eq!(normalize("4125222861").as_deref(), Some(expected));
        assert_eq!(normalize("  0xF5E1E7CD  ").as_deref(), Some(expected));
    }

    #[test]
    fn invalid_identifiers_are_rejected_not_guessed() {
        assert_eq!(normalize(""), None);
        assert_eq!(normalize("   "), None);
        assert_eq!(normalize("mark-evans"), None);
        assert_eq!(normalize("0xZZZZ"), None);
        assert_eq!(normalize("-1"), None);
        // 2^32 is outside the identifier's u32 representation.
        assert_eq!(normalize("4294967296"), None);
    }

    #[test]
    fn mirror_representation_is_exact() {
        assert_eq!(normalize("1").as_deref(), Some("0x00000001"));
        assert_eq!(normalize("0xff").as_deref(), Some("0x000000FF"));
        assert_eq!(normalize("4294967295").as_deref(), Some("0xFFFFFFFF"));
    }

    #[test]
    fn eight_unprefixed_digits_are_hexadecimal() {
        assert_eq!(normalize("12345678").as_deref(), Some("0x12345678"));
        // Seven digits do not match the hexadecimal form and are read as decimal.
        assert_eq!(normalize("1234567").as_deref(), Some("0x0012D687"));
    }

    #[test]
    fn normalization_counts_duplicates_rejections_and_preserves_first_input() {
        let values = ["1", "0x00000001", "invalid", "2", "2"]
            .map(str::to_owned)
            .to_vec();
        let normalized = normalize_ids(&values);

        assert_eq!(
            normalized.ordered,
            vec![
                ("0x00000001".to_owned(), "1".to_owned()),
                ("0x00000002".to_owned(), "2".to_owned()),
            ]
        );
        assert_eq!(normalized.duplicates, 2);
        assert_eq!(normalized.rejected, 1);
    }

    #[test]
    fn request_bounds_are_enforced_before_database_access() {
        assert!(validate_id_count(1).is_ok());
        assert!(validate_id_count(IDS_MAX).is_ok());
        assert!(matches!(validate_id_count(0), Err(ErreurSite::Demande(_))));
        assert!(matches!(
            validate_id_count(IDS_MAX + 1),
            Err(ErreurSite::Demande(_))
        ));
    }

    #[tokio::test]
    async fn contract_excludes_personal_data_without_fingerprinting_the_service() {
        let value = contract().await.0;
        assert_eq!(value.id_forms.len(), 3);
        assert_eq!(value.ids_max, IDS_MAX);
        assert!(
            value
                .never_received
                .iter()
                .any(|text| text.contains("sauvegarde")),
            "la route doit dire qu'aucun fichier de sauvegarde ne la traverse"
        );
        let public_text = value.never_received.join(" ").to_ascii_lowercase();
        for fingerprint in ["nie-save", "wasm", "rust", "crate"] {
            assert!(!public_text.contains(fingerprint), "{fingerprint}");
        }
    }
}
