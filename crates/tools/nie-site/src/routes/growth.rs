//! Explicit stat-anchor interpolation shared with the existing Azalée Wasm binding.
//! The HTTP adapter delegates arithmetic to `nie-core`; it supplies no missing anchors.

use axum::Json;
use axum::extract::Query;
use serde::{Deserialize, Serialize};

use crate::error::ErreurSite;

const fn first_level() -> u8 {
    1
}
const fn last_level() -> u8 {
    99
}

/// Four original stat anchors and a bounded, inclusive level interval.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InterpolationQuery {
    /// Stat value at level 1.
    pub lv1: u16,
    /// Stat value at level 30.
    pub lv30: u16,
    /// Stat value at level 50.
    pub lv50: u16,
    /// Stat value at level 99.
    pub lv99: u16,
    /// First level to include.
    #[serde(default = "first_level")]
    pub from: u8,
    /// Last level to include.
    #[serde(default = "last_level")]
    pub to: u8,
}

/// One interpolated stat value.
#[derive(Debug, Serialize)]
pub struct InterpolatedStat {
    /// Character level.
    pub level: u8,
    /// Calculated stat value.
    pub value: u16,
}

/// Bounded interpolation result returned by the route.
#[derive(Debug, Serialize)]
pub struct InterpolationResponse {
    /// Validated interpolation input.
    pub input: InterpolationQuery,
    /// One calculated point for each requested level.
    pub points: Vec<InterpolatedStat>,
}

/// `GET /api/v1/growth/interpolate?lv1=10&lv30=30&lv50=50&lv99=80&from=1&to=99`.
/// Reject levels outside the supported interval instead of silently clamping them.
pub async fn interpolate(
    Query(input): Query<InterpolationQuery>,
) -> Result<Json<InterpolationResponse>, ErreurSite> {
    if input.from < 1 || input.to > 99 || input.from > input.to {
        return Err(ErreurSite::Demande("Require 1 <= from <= to <= 99".into()));
    }
    let points = (input.from..=input.to)
        .map(|level| InterpolatedStat {
            level,
            value: nie_core::stats::calculate_single_stat(
                level, input.lv1, input.lv30, input.lv50, input.lv99,
            ),
        })
        .collect();
    Ok(Json(InterpolationResponse { input, points }))
}
