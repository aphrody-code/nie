//! IEVR team formations and the coordinate projection used by the team builder.
//!
//! The eight legacy formations are kept because their identifiers are persisted
//! in shared URLs and saved teams. The game formations are read by Rust from the
//! generated `formations-full.json` data; no TypeScript module is involved.

use std::string::String;
use std::vec::Vec;

/// Position role in a team formation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum PositionRole {
    /// Forward.
    Fw,
    /// Midfielder.
    Mf,
    /// Defender.
    Df,
    /// Goalkeeper.
    Gk,
}

impl PositionRole {
    /// Returns the TypeScript-compatible role code.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Fw => "FW",
            Self::Mf => "MF",
            Self::Df => "DF",
            Self::Gk => "GK",
        }
    }

    /// Parses a role, falling back to midfielder as the original game-builder
    /// projection does for unknown values.
    #[must_use]
    pub fn from_code(value: &str) -> Self {
        match value {
            "FW" => Self::Fw,
            "MF" => Self::Mf,
            "DF" => Self::Df,
            "GK" => Self::Gk,
            _ => Self::Mf,
        }
    }
}

/// One position projected onto the portrait field.
#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PositionCoord {
    /// Position index (`0..=10`).
    pub index: u8,
    /// Percentage from the top of the field.
    pub top: f64,
    /// Percentage from the left of the field.
    pub left: f64,
    /// Role at this position.
    pub role: PositionRole,
}

/// A formation shown by the team builder.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Formation {
    /// Stable persisted identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Display formation label, such as `4-3-3`.
    pub label: String,
    /// Eleven projected positions.
    pub positions: Vec<PositionCoord>,
}

/// Team builder bench capacities.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BenchSlots {
    /// Manager slots.
    pub manager: usize,
    /// Reserve slots.
    pub reserves: usize,
    /// Support slots.
    pub support: usize,
}

/// Capacities used by the IEVR team builder.
pub const BENCH_SLOTS: BenchSlots = BenchSlots {
    manager: 1,
    reserves: 5,
    support: 3,
};

/// Role/color pairs in the same stable order as the TypeScript record.
pub const ROLE_COLORS: [(&str, &str); 4] = [
    ("DF", "rgb(59, 130, 246)"),
    ("FW", "rgb(220, 38, 38)"),
    ("GK", "rgb(217, 119, 6)"),
    ("MF", "rgb(16, 185, 129)"),
];

/// Role/French-label pairs in the same stable order as the TypeScript record.
pub const ROLE_LABELS: [(&str, &str); 4] =
    [("DF", "DEF"), ("FW", "ATT"), ("GK", "GAR"), ("MF", "MIL")];

/// Stable UI color for each game role.
#[must_use]
pub const fn role_color(role: PositionRole) -> &'static str {
    match role {
        PositionRole::Df => "rgb(59, 130, 246)",
        PositionRole::Fw => "rgb(220, 38, 38)",
        PositionRole::Gk => "rgb(217, 119, 6)",
        PositionRole::Mf => "rgb(16, 185, 129)",
    }
}

/// Stable French role label used by the old Azalee UI.
#[must_use]
pub const fn role_label(role: PositionRole) -> &'static str {
    match role {
        PositionRole::Df => "DEF",
        PositionRole::Fw => "ATT",
        PositionRole::Gk => "GAR",
        PositionRole::Mf => "MIL",
    }
}

/// Looks up a role color by its string code.
#[must_use]
pub fn role_color_code(role: &str) -> Option<&'static str> {
    ROLE_COLORS
        .iter()
        .find_map(|(code, color)| (*code == role).then_some(*color))
}

/// Looks up a French role label by its string code.
#[must_use]
pub fn role_label_code(role: &str) -> Option<&'static str> {
    ROLE_LABELS
        .iter()
        .find_map(|(code, label)| (*code == role).then_some(*label))
}

const GK: PositionCoord = PositionCoord {
    index: 10,
    left: 40.0,
    role: PositionRole::Gk,
    top: 43.0,
};

/// Returns the eight legacy formations in their persisted order.
#[must_use]
pub fn legacy_formations() -> Vec<Formation> {
    vec![
        formation(
            "diamond442",
            "4-4-2 Diamond",
            "4-4-2",
            &[
                (0, 1., 15., PositionRole::Fw),
                (1, 1., 65., PositionRole::Fw),
                (2, 9., 40., PositionRole::Mf),
                (3, 17., 10., PositionRole::Mf),
                (4, 17., 70., PositionRole::Mf),
                (5, 22., 40., PositionRole::Mf),
                (6, 31., 2., PositionRole::Df),
                (7, 35., 22., PositionRole::Df),
                (8, 35., 58., PositionRole::Df),
                (9, 31., 78., PositionRole::Df),
            ],
        ),
        formation(
            "box442",
            "4-4-2 Box",
            "4-4-2",
            &[
                (0, 1., 22., PositionRole::Fw),
                (1, 1., 58., PositionRole::Fw),
                (2, 10., 2., PositionRole::Mf),
                (3, 21., 22., PositionRole::Mf),
                (4, 21., 58., PositionRole::Mf),
                (5, 10., 78., PositionRole::Mf),
                (6, 28., 2., PositionRole::Df),
                (7, 35., 22., PositionRole::Df),
                (8, 35., 58., PositionRole::Df),
                (9, 28., 78., PositionRole::Df),
            ],
        ),
        formation(
            "freedom352",
            "3-5-2 Liberté",
            "3-5-2",
            &[
                (0, 1., 22., PositionRole::Fw),
                (1, 1., 58., PositionRole::Fw),
                (2, 6., 2., PositionRole::Mf),
                (3, 17., 22., PositionRole::Mf),
                (4, 10., 40., PositionRole::Mf),
                (5, 17., 58., PositionRole::Mf),
                (6, 6., 78., PositionRole::Mf),
                (7, 33., 12., PositionRole::Df),
                (8, 29., 40., PositionRole::Df),
                (9, 33., 68., PositionRole::Df),
            ],
        ),
        formation(
            "triangle433",
            "4-3-3 Triangle",
            "4-3-3",
            &[
                (0, 4., 2., PositionRole::Fw),
                (1, 1., 40., PositionRole::Fw),
                (2, 4., 78., PositionRole::Fw),
                (3, 16., 40., PositionRole::Mf),
                (4, 24., 15., PositionRole::Mf),
                (5, 24., 65., PositionRole::Mf),
                (6, 31., 2., PositionRole::Df),
                (7, 38., 22., PositionRole::Df),
                (8, 38., 58., PositionRole::Df),
                (9, 31., 78., PositionRole::Df),
            ],
        ),
        formation(
            "delta433",
            "4-3-3 Delta",
            "4-3-3",
            &[
                (0, 4., 2., PositionRole::Fw),
                (1, 1., 40., PositionRole::Fw),
                (2, 4., 78., PositionRole::Fw),
                (3, 12., 15., PositionRole::Mf),
                (4, 12., 65., PositionRole::Mf),
                (5, 23., 40., PositionRole::Mf),
                (6, 22., 2., PositionRole::Df),
                (7, 32., 22., PositionRole::Df),
                (8, 32., 58., PositionRole::Df),
                (9, 22., 78., PositionRole::Df),
            ],
        ),
        formation(
            "balance451",
            "4-5-1 Équilibré",
            "4-5-1",
            &[
                (0, 1., 40., PositionRole::Fw),
                (1, 10., 2., PositionRole::Mf),
                (2, 15., 40., PositionRole::Mf),
                (3, 10., 78., PositionRole::Mf),
                (4, 25., 22., PositionRole::Mf),
                (5, 25., 58., PositionRole::Mf),
                (6, 29., 2., PositionRole::Df),
                (7, 38., 22., PositionRole::Df),
                (8, 38., 58., PositionRole::Df),
                (9, 29., 78., PositionRole::Df),
            ],
        ),
        formation(
            "hexa361",
            "3-6-1 Hexa",
            "3-6-1",
            &[
                (0, 1., 40., PositionRole::Fw),
                (1, 7., 2., PositionRole::Mf),
                (2, 11., 22., PositionRole::Mf),
                (3, 11., 58., PositionRole::Mf),
                (4, 7., 78., PositionRole::Mf),
                (5, 25., 22., PositionRole::Mf),
                (6, 25., 58., PositionRole::Mf),
                (7, 39., 10., PositionRole::Df),
                (8, 29., 40., PositionRole::Df),
                (9, 39., 70., PositionRole::Df),
            ],
        ),
        formation(
            "double541",
            "5-4-1 Double Volante",
            "5-4-1",
            &[
                (0, 1., 40., PositionRole::Fw),
                (1, 7., 2., PositionRole::Mf),
                (2, 11., 22., PositionRole::Mf),
                (3, 11., 58., PositionRole::Mf),
                (4, 7., 78., PositionRole::Mf),
                (5, 23., 2., PositionRole::Df),
                (6, 27., 22., PositionRole::Df),
                (7, 29., 40., PositionRole::Df),
                (8, 27., 58., PositionRole::Df),
                (9, 23., 78., PositionRole::Df),
            ],
        ),
    ]
}

fn formation(
    id: &str,
    name: &str,
    label: &str,
    positions: &[(u8, f64, f64, PositionRole)],
) -> Formation {
    let mut projected = positions
        .iter()
        .map(|&(index, top, left, role)| PositionCoord {
            index,
            top,
            left,
            role,
        })
        .collect::<Vec<_>>();
    projected.push(GK);
    Formation {
        id: id.to_owned(),
        name: name.to_owned(),
        label: label.to_owned(),
        positions: projected,
    }
}

/// Maps a real game `start.y` coordinate to a portrait-field percentage.
#[must_use]
pub fn game_top(y: f64) -> f64 {
    (43.75 * y + 2.0).clamp(1.0, 46.0)
}

/// Maps a real game `start.x` coordinate to a portrait-field percentage.
#[must_use]
pub fn game_left(x: f64) -> f64 {
    (40.0 + x * 47.0).clamp(1.0, 80.0)
}

#[cfg(feature = "data")]
mod embedded {
    use super::{Formation, PositionCoord, PositionRole, game_left, game_top};
    use std::collections::BTreeMap;
    use std::string::String;
    use std::vec::Vec;

    const FORMATIONS_JSON: &str =
        include_str!("../../../../../packages/nie-game/src/data/formations-full.json");

    #[derive(serde::Deserialize)]
    struct RawFile {
        formations: Vec<RawFormation>,
    }

    #[derive(serde::Deserialize)]
    struct RawFormation {
        form_id: String,
        label: String,
        valid: bool,
        positions: Vec<RawPosition>,
    }

    #[derive(serde::Deserialize)]
    struct RawPosition {
        position_no: u8,
        role: String,
        start: RawPoint,
    }

    #[derive(serde::Deserialize)]
    struct RawPoint {
        x: f64,
        y: f64,
    }

    /// Parses the generated formation catalog with the exact filtering and
    /// naming rules of the TypeScript builder.
    pub fn from_json(input: &str) -> Result<Vec<Formation>, serde_json::Error> {
        let raw: RawFile = serde_json::from_str(input)?;
        let mut counts = BTreeMap::<String, usize>::new();
        Ok(raw
            .formations
            .into_iter()
            .filter(|formation| formation.valid)
            .map(|formation| {
                let count = counts.entry(formation.label.clone()).or_default();
                *count += 1;
                let positions = formation
                    .positions
                    .into_iter()
                    .map(|position| PositionCoord {
                        index: position.position_no,
                        top: game_top(position.start.y),
                        left: game_left(position.start.x),
                        role: PositionRole::from_code(&position.role),
                    })
                    .collect();
                Formation {
                    id: format!("g_{}", formation.form_id),
                    name: format!("{} (jeu) #{}", formation.label, count),
                    label: formation.label,
                    positions,
                }
            })
            .collect())
    }

    /// Loads the generated real-game formations shipped with the repository.
    #[must_use]
    pub fn load() -> Vec<Formation> {
        from_json(FORMATIONS_JSON).expect("formations-full.json embedded and valid")
    }
}

/// Parses real-game formation data using Rust's projection rules.
#[cfg(feature = "data")]
pub use embedded::from_json as game_formations_from_json;

/// Loads the 83 valid real-game formations generated from the IEVR dump.
#[cfg(feature = "data")]
#[must_use]
pub fn game_formations() -> Vec<Formation> {
    embedded::load()
}

/// Loads legacy formations followed by the valid real-game formations.
#[cfg(feature = "data")]
#[must_use]
pub fn formations() -> Vec<Formation> {
    let mut result = legacy_formations();
    result.extend(game_formations());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_catalog_preserves_persisted_order_and_gk_slot() {
        let forms = legacy_formations();
        assert_eq!(forms.len(), 8);
        assert_eq!(forms[0].id, "diamond442");
        assert!(forms.iter().all(|form| form.positions.len() == 11));
        assert!(forms.iter().all(|form| {
            form.positions
                .iter()
                .find(|position| position.role == PositionRole::Gk)
                .unwrap()
                .index
                == 10
        }));
    }

    #[test]
    fn projection_clamps_coordinates_and_unknown_roles_to_midfield() {
        assert_eq!(game_top(-1.0), 1.0);
        assert_eq!(game_top(2.0), 46.0);
        assert_eq!(game_left(-2.0), 1.0);
        assert_eq!(game_left(2.0), 80.0);
        assert_eq!(PositionRole::from_code("unknown"), PositionRole::Mf);
    }

    #[cfg(feature = "data")]
    #[test]
    fn embedded_catalog_matches_the_real_valid_formation_count() {
        let forms = game_formations();
        assert_eq!(forms.len(), 83);
        assert!(forms.iter().all(|form| form.id.starts_with("g_")));
        assert!(forms.iter().all(|form| form.positions.len() == 11));
        assert!(forms.iter().all(|form| {
            form.positions
                .iter()
                .find(|position| position.role == PositionRole::Gk)
                .unwrap()
                .index
                == 0
        }));
        let all = formations();
        assert_eq!(all.len(), 91);
        assert_eq!(
            all.iter()
                .map(|form| form.id.as_str())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            91
        );
    }
}
