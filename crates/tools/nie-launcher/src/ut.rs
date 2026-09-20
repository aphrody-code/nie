//! IEVR Ultimate Team core engine, database provider, and pack simulator.
//!
//! Fully ported from `ievr-ultimate-team.fly.dev` and synchronized with `data/ievr-ut.sqlite`:
//! - 497 players with CRC32 parameter IDs, elements, positions, and CloudFront portraits.
//! - 69 teams with Level-5 32-bit `emblem_id` mappings.
//! - 8 packs with mathematical drop rates (`prob_comun` -> `prob_basara`).
//! - 9 canonical pitch formation layouts and dynamic (x, y) coordinate generation.
//! - Coin valuation and quick-sell calculation engine.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rand::Rng;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::error::{LauncherError, Result};
use crate::team::TeamLineup;

/// Player record from IEVR Ultimate Team database.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtPlayer {
    /// Internal CRC32 or numerical parameter ID as string.
    pub id: String,
    /// Player display name.
    pub name: String,
    /// Player elemental affinity: "Aire", "Fuego", "Bosque", "Montaña".
    pub element: String,
    /// Position category: "POR", "DF", "MC", "DL".
    pub position: String,
    /// Team slug (e.g. "raimon", "royal", "wild", "inazuma_japan").
    pub team_id: String,
    /// CDN portrait image URL.
    pub foto_url: Option<String>,
    /// Card rarity: "Común", "Raro", "Legendario", "Ícono", "Basara".
    pub rarity: String,
    /// Game debut / generation (e.g. "IE 1", "IE 2", "GO").
    pub game: Option<String>,
    /// Nickname.
    pub nickname: Option<String>,
    /// Weighted drop weight (default 1.0).
    pub weight: f64,
    /// Legendary tier classification ("Elite", "Supremo", etc.).
    pub legendary_tier: Option<String>,
    /// Optional English name from Azalée mirror.
    #[serde(default)]
    pub name_en: Option<String>,
    /// Optional Japanese name from Azalée mirror.
    #[serde(default)]
    pub name_ja: Option<String>,
    /// Internal character code (e.g. "c01000010").
    #[serde(default)]
    pub internal_code: Option<String>,
    /// Total stat point sum.
    #[serde(default)]
    pub stat_total: Option<u32>,
}

/// Special move from Azalée mirror database (`inagle_skills`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtSkillRecord {
    pub id: String,
    pub name_fr: String,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub category: String,
    pub element: String,
    pub tp_cost: u32,
    pub power_min: u32,
    pub power_max: u32,
    pub tension_cost: Option<u32>,
}

/// Team uniform from Azalée mirror database (`inagle_uniforms`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtUniformRecord {
    pub id: String,
    pub name_fr: String,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub category: Option<String>,
    pub image_url: Option<String>,
}

/// Stadium from Azalée mirror database (`inagle_stadiums`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtStadiumRecord {
    pub id: String,
    pub name_fr: String,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub image_url: Option<String>,
}

/// Formation from Azalée mirror database (`inagle_formations`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtFormationRecord {
    pub id: String,
    pub name_fr: String,
    pub name_en: Option<String>,
    pub name_ja: Option<String>,
    pub slug: Option<String>,
}

impl UtPlayer {
    /// Return the numerical CRC32 parameter ID used by `nie.exe` if parseable.
    pub fn param_id_crc(&self) -> Option<u32> {
        self.id.parse::<u32>().ok().or_else(|| {
            if self.id.starts_with("0x") || self.id.starts_with("0X") {
                u32::from_str_radix(&self.id[2..], 16).ok()
            } else {
                u32::from_str_radix(&self.id, 16).ok()
            }
        })
    }
}

/// Card pack definition with exact drop rates and pricing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtPack {
    pub id: String,
    pub name: String,
    pub price: u32,
    pub prob_common: f64,
    pub prob_rare: f64,
    pub prob_legendary: f64,
    pub prob_icon: f64,
    pub prob_basara: f64,
    pub prob_legendary_elite: f64,
    pub prob_legendary_supremo: f64,
    pub card_count: u32,
    pub pack_url: Option<String>,
    pub name_en: Option<String>,
    pub name_fr: Option<String>,
}

/// Team club / franchise definition with Level-5 emblem mapping.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtTeam {
    pub id: String,
    pub name: String,
    pub emblem_url: Option<String>,
    pub emblem_id: Option<u32>,
    pub game: Option<String>,
    pub name_en: Option<String>,
    pub name_fr: Option<String>,
}

/// Formation pitch slot position coordinates (0.0 to 100.0 percentage).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtFormationSlot {
    pub key: String,
    pub label: String,
    pub x: f32,
    pub y: f32,
}

/// Pitch formation layout with tactical 2D positions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UtFormationLayout {
    pub name: String,
    pub slots: Vec<UtFormationSlot>,
}

impl UtFormationLayout {
    /// Categorize slots into pitch bands (Goalkeeper, Defenders, Midfielders, Forwards).
    pub fn group_by_pitch_third(&self) -> Vec<(&'static str, Vec<&UtFormationSlot>)> {
        let mut gk = Vec::new();
        let mut df = Vec::new();
        let mut mf = Vec::new();
        let mut fw = Vec::new();

        for slot in &self.slots {
            if slot.y >= 80.0 {
                gk.push(slot);
            } else if slot.y >= 45.0 {
                df.push(slot);
            } else if slot.y >= 25.0 {
                mf.push(slot);
            } else {
                fw.push(slot);
            }
        }

        gk.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        df.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        mf.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());
        fw.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());

        vec![
            ("Portero", gk),
            ("Defensas", df),
            ("Centrocampistas", mf),
            ("Delanteros", fw),
        ]
    }
}

/// Outcome of a simulated pack opening.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackOpeningResult {
    pub pack_id: String,
    pub pack_name: String,
    pub cards: Vec<DrawnCard>,
    pub total_quicksell_value: u32,
}

/// A single card drawn during a pack opening.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawnCard {
    pub player: UtPlayer,
    pub rolled_rarity: String,
    pub quicksell_coins: u32,
}

/// Squad valuation breakdown.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SquadValuation {
    pub team_name: String,
    pub total_players: usize,
    pub total_quicksell_value: u32,
    pub rarity_counts: HashMap<String, usize>,
}

// ── Formation Layout Engine ──────────────────────────────────────────────────

fn normalize_name(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            _ => c,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Get the 2D pitch coordinates for any formation (canonical or dynamic).
pub fn formation_layout(name: &str) -> UtFormationLayout {
    let norm = normalize_name(name);

    if norm == "4-3-3" {
        return UtFormationLayout {
            name: "4-3-3".into(),
            slots: vec![
                UtFormationSlot { key: "EXTI".into(), label: "EXTI".into(), x: 15.0, y: 8.0 },
                UtFormationSlot { key: "DL".into(), label: "DL".into(), x: 50.0, y: 3.0 },
                UtFormationSlot { key: "EXTD".into(), label: "EXTD".into(), x: 85.0, y: 8.0 },
                UtFormationSlot { key: "MC1".into(), label: "MC".into(), x: 20.0, y: 35.0 },
                UtFormationSlot { key: "MC2".into(), label: "MC".into(), x: 50.0, y: 35.0 },
                UtFormationSlot { key: "MC3".into(), label: "MC".into(), x: 80.0, y: 35.0 },
                UtFormationSlot { key: "DF1".into(), label: "DF".into(), x: 12.0, y: 70.0 },
                UtFormationSlot { key: "DF2".into(), label: "DF".into(), x: 38.0, y: 70.0 },
                UtFormationSlot { key: "DF3".into(), label: "DF".into(), x: 62.0, y: 70.0 },
                UtFormationSlot { key: "DF4".into(), label: "DF".into(), x: 88.0, y: 70.0 },
                UtFormationSlot { key: "POR".into(), label: "POR".into(), x: 50.0, y: 95.0 },
            ],
        };
    }

    if norm == "3-5-2 libertad" || norm == "3-5-2" {
        return UtFormationLayout {
            name: "3-5-2 Libertad".into(),
            slots: vec![
                UtFormationSlot { key: "9".into(), label: "DC".into(), x: 25.0, y: 10.0 },
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 75.0, y: 10.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 12.0, y: 29.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 50.0, y: 29.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 88.0, y: 29.0 },
                UtFormationSlot { key: "4".into(), label: "MC".into(), x: 30.0, y: 49.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 70.0, y: 49.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 12.0, y: 70.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 50.0, y: 70.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 88.0, y: 70.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    if norm == "3-6-1 hexa" || norm == "3-6-1" {
        return UtFormationLayout {
            name: "3-6-1 Hexa".into(),
            slots: vec![
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 50.0, y: 10.0 },
                UtFormationSlot { key: "4".into(), label: "MC".into(), x: 20.0, y: 15.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 80.0, y: 15.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 10.0, y: 34.0 },
                UtFormationSlot { key: "9".into(), label: "MC".into(), x: 90.0, y: 34.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 36.0, y: 49.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 64.0, y: 49.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 18.0, y: 70.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 50.0, y: 70.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 82.0, y: 70.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    if norm == "4-3-3 delta" {
        return UtFormationLayout {
            name: "4-3-3 Delta".into(),
            slots: vec![
                UtFormationSlot { key: "8".into(), label: "EXTI".into(), x: 12.0, y: 15.0 },
                UtFormationSlot { key: "9".into(), label: "DL".into(), x: 50.0, y: 10.0 },
                UtFormationSlot { key: "10".into(), label: "EXTD".into(), x: 88.0, y: 15.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 35.0, y: 31.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 65.0, y: 31.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 50.0, y: 52.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 10.0, y: 54.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 90.0, y: 54.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 32.0, y: 70.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 68.0, y: 70.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 88.0 },
            ],
        };
    }

    if norm == "4-3-3 triangulo" {
        return UtFormationLayout {
            name: "4-3-3 Triangulo".into(),
            slots: vec![
                UtFormationSlot { key: "9".into(), label: "EXTI".into(), x: 18.0, y: 16.0 },
                UtFormationSlot { key: "8".into(), label: "DL".into(), x: 50.0, y: 10.0 },
                UtFormationSlot { key: "10".into(), label: "EXTD".into(), x: 82.0, y: 16.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 50.0, y: 31.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 26.0, y: 43.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 74.0, y: 43.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 12.0, y: 63.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 88.0, y: 63.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 34.0, y: 70.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 66.0, y: 70.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    if norm == "4-4-2 caja" || norm == "4-4-2" {
        return UtFormationLayout {
            name: "4-4-2 Caja".into(),
            slots: vec![
                UtFormationSlot { key: "9".into(), label: "DC".into(), x: 38.0, y: 10.0 },
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 62.0, y: 10.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 16.0, y: 29.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 83.0, y: 29.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 36.0, y: 47.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 64.0, y: 47.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 12.0, y: 58.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 88.0, y: 58.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 29.0, y: 76.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 71.0, y: 76.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 88.0 },
            ],
        };
    }

    if norm == "4-4-2 diamante" {
        return UtFormationLayout {
            name: "4-4-2 Diamante".into(),
            slots: vec![
                UtFormationSlot { key: "9".into(), label: "DC".into(), x: 24.0, y: 10.0 },
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 76.0, y: 10.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 50.0, y: 20.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 29.0, y: 37.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 71.0, y: 37.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 50.0, y: 55.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 13.0, y: 61.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 87.0, y: 61.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 32.0, y: 73.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 68.0, y: 73.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    if norm == "4-5-1 equilibrio" || norm == "4-5-1" {
        return UtFormationLayout {
            name: "4-5-1 Equilibrio".into(),
            slots: vec![
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 50.0, y: 10.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 19.0, y: 20.0 },
                UtFormationSlot { key: "9".into(), label: "MC".into(), x: 81.0, y: 20.0 },
                UtFormationSlot { key: "5".into(), label: "MC".into(), x: 50.0, y: 35.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 25.0, y: 43.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 75.0, y: 43.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 10.0, y: 61.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 90.0, y: 61.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 34.0, y: 70.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 66.0, y: 70.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    if norm == "5-4-1 doble volante" || norm == "5-4-1" {
        return UtFormationLayout {
            name: "5-4-1 Doble Volante".into(),
            slots: vec![
                UtFormationSlot { key: "10".into(), label: "DC".into(), x: 50.0, y: 10.0 },
                UtFormationSlot { key: "6".into(), label: "MC".into(), x: 20.0, y: 16.0 },
                UtFormationSlot { key: "9".into(), label: "MC".into(), x: 80.0, y: 16.0 },
                UtFormationSlot { key: "7".into(), label: "MC".into(), x: 38.0, y: 35.0 },
                UtFormationSlot { key: "8".into(), label: "MC".into(), x: 62.0, y: 35.0 },
                UtFormationSlot { key: "1".into(), label: "DF".into(), x: 10.0, y: 49.0 },
                UtFormationSlot { key: "5".into(), label: "DF".into(), x: 90.0, y: 49.0 },
                UtFormationSlot { key: "2".into(), label: "DF".into(), x: 30.0, y: 68.0 },
                UtFormationSlot { key: "3".into(), label: "DF".into(), x: 50.0, y: 68.0 },
                UtFormationSlot { key: "4".into(), label: "DF".into(), x: 70.0, y: 68.0 },
                UtFormationSlot { key: "0".into(), label: "POR".into(), x: 50.0, y: 89.0 },
            ],
        };
    }

    // Dynamic layout generator (ported from Level-5 client algorithm `A(numbers)`)
    let numbers: Vec<usize> = norm
        .split(|c: char| !c.is_ascii_digit())
        .filter_map(|s| s.parse::<usize>().ok())
        .filter(|&n| n > 0)
        .collect();

    if numbers.len() >= 2 {
        let mut reversed = numbers.clone();
        reversed.reverse();
        let num_lines = reversed.len() + 1;
        let mut slots = Vec::new();

        let calc_x = |count: usize, idx: usize| -> f32 {
            if count <= 1 {
                50.0
            } else {
                10.0 + (idx as f32 * 80.0) / (count - 1) as f32
            }
        };

        for (line_idx, &count) in reversed.iter().enumerate() {
            let is_fw = line_idx == 0;
            let is_df = line_idx == reversed.len() - 1;
            let label = if is_fw {
                "DC"
            } else if is_df {
                "DF"
            } else {
                "MC"
            };

            let y = 5.0 + (line_idx as f32 * 85.0) / (num_lines - 1) as f32;

            for t in 0..count {
                slots.push(UtFormationSlot {
                    key: format!("{label}{line_idx}-{t}"),
                    label: label.to_string(),
                    x: calc_x(count, t),
                    y,
                });
            }
        }

        // Add goalkeeper
        slots.push(UtFormationSlot {
            key: "POR".into(),
            label: "POR".into(),
            x: 50.0,
            y: 95.0,
        });

        return UtFormationLayout {
            name: name.to_string(),
            slots,
        };
    }

    // Default fallback: 4-3-3
    formation_layout("4-3-3")
}

// ── Pack Opening Simulator ───────────────────────────────────────────────────

/// Simulate opening a pack according to exact mathematical drop probabilities.
pub fn open_pack(
    pack: &UtPack,
    players: &[UtPlayer],
    rng: &mut impl Rng,
) -> PackOpeningResult {
    let mut cards = Vec::new();

    for _ in 0..pack.card_count {
        let roll: f64 = rng.gen_range(0.0..1.0);

        let mut cum = 0.0;
        let rolled_rarity = if pack.prob_basara > 0.0 && { cum += pack.prob_basara; roll < cum } {
            "Basara"
        } else if pack.prob_icon > 0.0 && { cum += pack.prob_icon; roll < cum } {
            "Ícono"
        } else if pack.prob_legendary_supremo > 0.0 && { cum += pack.prob_legendary_supremo; roll < cum } {
            "Legendario Supremo"
        } else if pack.prob_legendary_elite > 0.0 && { cum += pack.prob_legendary_elite; roll < cum } {
            "Legendario Elite"
        } else if pack.prob_legendary > 0.0 && { cum += pack.prob_legendary; roll < cum } {
            "Legendario"
        } else if pack.prob_rare > 0.0 && { cum += pack.prob_rare; roll < cum } {
            "Raro"
        } else {
            "Común"
        };

        // Filter players matching the rolled rarity
        let pool: Vec<&UtPlayer> = players
            .iter()
            .filter(|p| {
                if rolled_rarity == "Legendario Supremo" {
                    p.rarity == "Legendario" && p.legendary_tier.as_deref() == Some("Supremo")
                } else if rolled_rarity == "Legendario Elite" {
                    p.rarity == "Legendario" && p.legendary_tier.as_deref() == Some("Elite")
                } else if rolled_rarity == "Legendario" {
                    p.rarity == "Legendario"
                } else {
                    p.rarity == rolled_rarity
                }
            })
            .collect();

        let chosen_player = if !pool.is_empty() {
            // Weighted random selection by player weight
            let total_weight: f64 = pool.iter().map(|p| p.weight.max(0.1)).sum();
            let mut pick_val: f64 = rng.gen_range(0.0..total_weight);
            let mut picked = pool[0];
            for p in &pool {
                pick_val -= p.weight.max(0.1);
                if pick_val <= 0.0 {
                    picked = p;
                    break;
                }
            }
            picked.clone()
        } else if !players.is_empty() {
            // Fallback random player
            let idx = rng.gen_range(0..players.len());
            players[idx].clone()
        } else {
            // Synthetic fallback
            UtPlayer {
                id: "2073634135".into(),
                name: "Cham Lion".into(),
                element: "Aire".into(),
                position: "MC".into(),
                team_id: "wild".into(),
                foto_url: None,
                rarity: rolled_rarity.into(),
                game: Some("IE 1".into()),
                nickname: Some("Chameleon".into()),
                weight: 1.0,
                legendary_tier: None,
                name_en: None,
                name_ja: None,
                internal_code: None,
                stat_total: None,
            }
        };

        let quicksell = quick_sell_value(rolled_rarity);

        cards.push(DrawnCard {
            player: chosen_player,
            rolled_rarity: rolled_rarity.to_string(),
            quicksell_coins: quicksell,
        });
    }

    let total_quicksell_value = cards.iter().map(|c| c.quicksell_coins).sum();

    PackOpeningResult {
        pack_id: pack.id.clone(),
        pack_name: pack.name.clone(),
        cards,
        total_quicksell_value,
    }
}

/// Simulate opening a pack with an optional random seed for reproducibility.
pub fn open_pack_with_optional_seed(
    pack: &UtPack,
    players: &[UtPlayer],
    seed: Option<u64>,
) -> PackOpeningResult {
    use rand::SeedableRng;
    if let Some(s) = seed {
        let mut rng = rand::rngs::StdRng::seed_from_u64(s);
        open_pack(pack, players, &mut rng)
    } else {
        let mut rng = rand::thread_rng();
        open_pack(pack, players, &mut rng)
    }
}

/// Calculate quick-sell coin price according to official catalog tiers.
pub fn quick_sell_value(rarity: &str) -> u32 {
    match rarity {
        "Basara" => 25_000,
        "Ícono" | "Icono" => 10_000,
        "Legendario Supremo" => 5_000,
        "Legendario Elite" => 3_500,
        "Legendario" => 2_000,
        "Raro" => 500,
        _ => 100, // "Común"
    }
}

/// Calculate total squad valuation and rarity distribution.
pub fn calculate_squad_valuation(
    lineup: &TeamLineup,
    _db: Option<&UtDatabase>,
) -> SquadValuation {
    let mut total_quicksell = 0;
    let mut rarity_counts = HashMap::new();

    for chara in &lineup.characters {
        let rarity_str = match chara.chara_rarity {
            5 => "Basara",
            4 => "Ícono",
            3 => "Legendario",
            2 => "Raro",
            _ => "Común",
        };

        *rarity_counts.entry(rarity_str.to_string()).or_insert(0) += 1;

        let base_val = quick_sell_value(rarity_str);
        total_quicksell += base_val;
    }

    SquadValuation {
        team_name: lineup.team_name.clone(),
        total_players: lineup.characters.len(),
        total_quicksell_value: total_quicksell,
        rarity_counts,
    }
}

// ── SQLite Database Accessor ─────────────────────────────────────────────────

/// Thread-safe local SQLite database reader for IEVR Ultimate Team.
pub struct UtDatabase {
    conn: Connection,
    path: PathBuf,
    has_azalee: bool,
}

impl UtDatabase {
    /// Open the database from default repository locations:
    /// 1. `data/ievr-ut.sqlite`
    /// 2. `var/mirror/ievr-ut/ievr_ut.sqlite`
    pub fn open_default() -> Result<Self> {
        let candidates = [
            PathBuf::from("data/ievr-ut.sqlite"),
            PathBuf::from("var/mirror/ievr-ut/ievr_ut.sqlite"),
            PathBuf::from("../data/ievr-ut.sqlite"),
            PathBuf::from("../../data/ievr-ut.sqlite"),
        ];

        for path in &candidates {
            if path.exists() {
                return Self::open(path);
            }
        }

        Err(LauncherError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "IEVR Ultimate Team SQLite database not found in standard paths",
        )))
    }

    /// Open a connection to an explicit database file path, automatically attaching
    /// Azalée's complete mirror database (`var/mirror.sqlite`) if present.
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let mirror_candidates = [
            "var/mirror.sqlite",
            "var/miroir/inagle-2026-09-19T18-50-15.sqlite",
            "../var/mirror.sqlite",
            "../../var/mirror.sqlite",
        ];
        let mut has_azalee = false;
        for mc in &mirror_candidates {
            if Path::new(mc).exists() {
                let attach_sql = format!("ATTACH DATABASE 'file:{}?mode=ro' AS azalee", mc);
                if conn.execute_batch(&attach_sql).is_ok() {
                    has_azalee = true;
                    break;
                }
            }
        }

        Ok(Self {
            conn,
            path: path.to_path_buf(),
            has_azalee,
        })
    }

    /// Return the path to the database file.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns true if the Azalée mirror database was successfully attached.
    pub fn has_azalee(&self) -> bool {
        self.has_azalee
    }

    /// Load all players fusing FUT (`jugadores`) and Azalée mirror (`inagle_characters`).
    pub fn get_players(&self) -> Result<Vec<UtPlayer>> {
        let mut players = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        // 1. Load from core FUT table `jugadores`
        let mut stmt = self
            .conn
            .prepare("SELECT id, nombre, elemento, posicion, equipo_id, foto_url, rareza, juego, apodo, peso, nivel_legendario FROM jugadores")
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(UtPlayer {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    element: row.get(2)?,
                    position: row.get(3)?,
                    team_id: row.get(4)?,
                    foto_url: row.get(5)?,
                    rarity: row.get(6)?,
                    game: row.get(7)?,
                    nickname: row.get(8)?,
                    weight: row.get::<_, Option<f64>>(9)?.unwrap_or(1.0),
                    legendary_tier: row.get(10)?,
                    name_en: None,
                    name_ja: None,
                    internal_code: None,
                    stat_total: None,
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        for p in rows.flatten() {
            seen_names.insert(p.name.trim().to_lowercase());
            players.push(p);
        }

        // 2. If Azalée mirror is attached, fuse inagle_characters!
        if self.has_azalee
            && let Ok(mut stmt_az) = self.conn.prepare(
                "SELECT id, chara_id, internal_code, name_fr, name_en, name_ja, element, position, rarity_label, image_url, stat_total, hero_type, nickname, series
                 FROM azalee.inagle_characters
                 WHERE name_fr IS NOT NULL AND name_fr != '' AND name_fr != '\\N'",
            )
        {
            let az_rows = stmt_az.query_map([], |row| {
                    let id: String = row.get(0)?;
                    let _chara_id: Option<String> = row.get(1)?;
                    let internal_code: Option<String> = row.get(2)?;
                    let name_fr: String = row.get(3)?;
                    let name_en: Option<String> = row.get(4)?;
                    let name_ja: Option<String> = row.get(5)?;
                    let el_raw: Option<String> = row.get(6)?;
                    let pos_raw: Option<String> = row.get(7)?;
                    let rar_raw: Option<String> = row.get(8)?;
                    let img_url: Option<String> = row.get(9)?;
                    let stat_total_str: Option<String> = row.get(10)?;
                    let _hero_type: Option<String> = row.get(11)?;
                    let nickname: Option<String> = row.get(12)?;
                    let series: Option<String> = row.get(13)?;

                    let element = match el_raw.as_deref() {
                        Some("Feu") => "Fuego".into(),
                        Some("Vent") | Some("Air") => "Aire".into(),
                        Some("Montagne") | Some("Terre") => "Montaña".into(),
                        Some("Bois") | Some("Forêt") => "Bosque".into(),
                        Some(other) => other.to_string(),
                        None => "Fuego".into(),
                    };

                    let position = match pos_raw.as_deref() {
                        Some("Gardien") => "POR".into(),
                        Some("Défenseur") => "DF".into(),
                        Some("Milieu") => "MC".into(),
                        Some("Attaquant") => "DL".into(),
                        Some(other) => other.to_string(),
                        None => "DL".into(),
                    };

                    let rarity = match rar_raw.as_deref() {
                        Some("Basara") => "Basara".into(),
                        Some("Icône") | Some("Icon") => "Ícono".into(),
                        Some("Légendaire") | Some("Legendaire") => "Legendario".into(),
                        Some("Rare") => "Raro".into(),
                        _ => "Común".into(),
                    };

                    let stat_total: Option<u32> = stat_total_str.and_then(|s| s.parse().ok());
                    let legendary_tier = if rarity == "Legendario" {
                        if stat_total.unwrap_or(0) >= 500 {
                            Some("Supremo".into())
                        } else {
                            Some("Elite".into())
                        }
                    } else {
                        None
                    };

                    let foto_url = img_url.filter(|u| u != "\\N" && !u.is_empty())
                        .or_else(|| internal_code.as_ref().map(|code| format!("/api/v1/asset/chara/{code}/portrait.webp")));

                    let nick = nickname.filter(|n| n != "\\N" && !n.is_empty());
                    let game = series.filter(|s| s != "\\N" && !s.is_empty());

                    Ok(UtPlayer {
                        id,
                        name: name_fr,
                        element,
                        position,
                        team_id: "inazuma_all_stars".into(),
                        foto_url,
                        rarity,
                        game,
                        nickname: nick,
                        weight: 1.0,
                        legendary_tier,
                        name_en: name_en.filter(|s| s != "\\N" && !s.is_empty()),
                        name_ja: name_ja.filter(|s| s != "\\N" && !s.is_empty()),
                        internal_code: internal_code.filter(|s| s != "\\N" && !s.is_empty()),
                        stat_total,
                    })
                });

                if let Ok(iter) = az_rows {
                    for p in iter.flatten() {
                        let norm = p.name.trim().to_lowercase();
                        if !seen_names.contains(&norm) {
                            seen_names.insert(norm);
                            players.push(p);
                        }
                    }
                }
            }

        Ok(players)
    }

    /// Query players with optional text search, element, and rarity filters.
    pub fn search_players(
        &self,
        query: Option<&str>,
        element: Option<&str>,
        rarity: Option<&str>,
        limit: usize,
    ) -> Result<Vec<UtPlayer>> {
        let all = self.get_players()?;
        let q = query.map(normalize_name);
        let el = element.map(normalize_name);
        let rar = rarity.map(normalize_name);

        let filtered: Vec<UtPlayer> = all
            .into_iter()
            .filter(|p| {
                if let Some(ref q_str) = q {
                    let name_norm = normalize_name(&p.name);
                    let nick_norm = p.nickname.as_deref().map(normalize_name).unwrap_or_default();
                    let en_norm = p.name_en.as_deref().map(normalize_name).unwrap_or_default();
                    let ja_norm = p.name_ja.as_deref().map(normalize_name).unwrap_or_default();
                    if !name_norm.contains(q_str)
                        && !nick_norm.contains(q_str)
                        && !en_norm.contains(q_str)
                        && !ja_norm.contains(q_str)
                        && !p.id.contains(q_str)
                    {
                        return false;
                    }
                }
                if let Some(ref el_str) = el
                    && !normalize_name(&p.element).contains(el_str) {
                        return false;
                }
                if let Some(ref rar_str) = rar
                    && !normalize_name(&p.rarity).contains(rar_str) {
                        return false;
                }
                true
            })
            .take(limit)
            .collect();

        Ok(filtered)
    }

    /// Load all packs from the `sobres` table.
    pub fn get_packs(&self) -> Result<Vec<UtPack>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, nombre, precio, prob_comun, prob_raro, prob_legendario, prob_icono, prob_basara, prob_legendario_elite, prob_legendario_supremo, cantidad_cartas, sobre_url, en, fr FROM sobres ORDER BY orden ASC")
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(UtPack {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    price: row.get::<_, Option<u32>>(2)?.unwrap_or(0),
                    prob_common: row.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    prob_rare: row.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    prob_legendary: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    prob_icon: row.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    prob_basara: row.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                    prob_legendary_elite: row.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                    prob_legendary_supremo: row.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                    card_count: row.get::<_, Option<u32>>(10)?.unwrap_or(3),
                    pack_url: row.get(11)?,
                    name_en: row.get(12)?,
                    name_fr: row.get(13)?,
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let mut packs = Vec::new();
        for p in rows.flatten() {
            packs.push(p);
        }
        Ok(packs)
    }

    /// Find a single pack by ID.
    pub fn get_pack(&self, id: &str) -> Result<Option<UtPack>> {
        let packs = self.get_packs()?;
        Ok(packs.into_iter().find(|p| p.id == id))
    }

    /// Load all teams fusing FUT (`equipos`) and Azalée mirror (`inagle_teams`).
    pub fn get_teams(&self) -> Result<Vec<UtTeam>> {
        let mut teams = Vec::new();
        let mut seen_team_names = std::collections::HashSet::new();

        let mut stmt = self
            .conn
            .prepare("SELECT id, nombre, escudo_url, emblem_id, juego, en, fr FROM equipos")
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(UtTeam {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    emblem_url: row.get(2)?,
                    emblem_id: row.get(3)?,
                    game: row.get(4)?,
                    name_en: row.get(5)?,
                    name_fr: row.get(6)?,
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        for t in rows.flatten() {
            seen_team_names.insert(t.name.trim().to_lowercase());
            teams.push(t);
        }

        if self.has_azalee
            && let Ok(mut stmt_az) = self.conn.prepare(
                "SELECT id, name_fr, name_en, name_ja, emblem_url, series
                 FROM azalee.inagle_teams
                 WHERE name_fr IS NOT NULL AND name_fr != '' AND name_fr != '\\N'",
            )
        {
            let az_rows = stmt_az.query_map([], |row| {
                let id: String = row.get(0)?;
                let name_fr: String = row.get(1)?;
                let name_en: Option<String> = row.get(2)?;
                let _name_ja: Option<String> = row.get(3)?;
                let emblem_url: Option<String> = row.get(4)?;
                let series: Option<String> = row.get(5)?;

                let emblem_id = if id.starts_with("0x") || id.starts_with("0X") {
                    u32::from_str_radix(&id[2..], 16).ok()
                } else {
                    id.parse().ok()
                };

                Ok(UtTeam {
                    id,
                    name: name_fr.clone(),
                    emblem_url: emblem_url.filter(|u| u != "\\N" && !u.is_empty()),
                    emblem_id,
                    game: series.filter(|s| s != "\\N" && !s.is_empty()),
                    name_en: name_en.filter(|s| s != "\\N" && !s.is_empty()),
                    name_fr: Some(name_fr),
                })
            });

            if let Ok(iter) = az_rows {
                for t in iter.flatten() {
                    let norm = t.name.trim().to_lowercase();
                    if !seen_team_names.contains(&norm) {
                        seen_team_names.insert(norm);
                        teams.push(t);
                    }
                }
            }
        }

        Ok(teams)
    }

    /// Load special moves from Azalée mirror (`inagle_skills`).
    pub fn get_skills(&self, category: Option<&str>, limit: usize) -> Result<Vec<UtSkillRecord>> {
        if !self.has_azalee {
            return Ok(Vec::new());
        }

        let sql = "SELECT id, name_fr, name_en, name_ja, category, element, tp_cost, power_min, power_max, tension_cost
                   FROM azalee.inagle_skills
                   WHERE name_fr IS NOT NULL AND name_fr != '' AND name_fr != '\\N'";

        let mut stmt = self
            .conn
            .prepare(sql)
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let cat_norm = category.map(normalize_name);
        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name_fr: String = row.get(1)?;
                let name_en: Option<String> = row.get(2)?;
                let name_ja: Option<String> = row.get(3)?;
                let category: String = row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "Tir".into());
                let element: String = row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "Feu".into());
                let tp_str: Option<String> = row.get(6)?;
                let p_min_str: Option<String> = row.get(7)?;
                let p_max_str: Option<String> = row.get(8)?;
                let tension_str: Option<String> = row.get(9)?;

                Ok(UtSkillRecord {
                    id,
                    name_fr,
                    name_en: name_en.filter(|s| s != "\\N" && !s.is_empty()),
                    name_ja: name_ja.filter(|s| s != "\\N" && !s.is_empty()),
                    category,
                    element,
                    tp_cost: tp_str.and_then(|s| s.parse().ok()).unwrap_or(40),
                    power_min: p_min_str.and_then(|s| s.parse().ok()).unwrap_or(100),
                    power_max: p_max_str.and_then(|s| s.parse().ok()).unwrap_or(500),
                    tension_cost: tension_str.and_then(|s| s.parse().ok()),
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let mut skills = Vec::new();
        for s in rows.flatten() {
            if let Some(ref cat) = cat_norm
                && !normalize_name(&s.category).contains(cat)
            {
                continue;
            }
            skills.push(s);
            if skills.len() >= limit {
                break;
            }
        }
        Ok(skills)
    }

    /// Load uniforms from Azalée mirror (`inagle_uniforms`).
    pub fn get_uniforms(&self, limit: usize) -> Result<Vec<UtUniformRecord>> {
        if !self.has_azalee {
            return Ok(Vec::new());
        }

        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name_fr, name_en, name_ja, category, image_url
                 FROM azalee.inagle_uniforms
                 WHERE name_fr IS NOT NULL AND name_fr != '' AND name_fr != '\\N'",
            )
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name_fr: String = row.get(1)?;
                let name_en: Option<String> = row.get(2)?;
                let name_ja: Option<String> = row.get(3)?;
                let category: Option<String> = row.get(4)?;
                let image_url: Option<String> = row.get(5)?;

                Ok(UtUniformRecord {
                    id,
                    name_fr,
                    name_en: name_en.filter(|s| s != "\\N" && !s.is_empty()),
                    name_ja: name_ja.filter(|s| s != "\\N" && !s.is_empty()),
                    category: category.filter(|s| s != "\\N" && !s.is_empty()),
                    image_url: image_url.filter(|s| s != "\\N" && !s.is_empty()),
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let mut list = Vec::new();
        for u in rows.flatten() {
            list.push(u);
            if list.len() >= limit {
                break;
            }
        }
        Ok(list)
    }

    /// Load stadiums from Azalée mirror (`inagle_stadiums`).
    pub fn get_stadiums(&self, limit: usize) -> Result<Vec<UtStadiumRecord>> {
        if !self.has_azalee {
            return Ok(Vec::new());
        }

        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, name_fr, name_en, name_ja, image_url
                 FROM azalee.inagle_stadiums
                 WHERE name_fr IS NOT NULL AND name_fr != '' AND name_fr != '\\N'",
            )
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name_fr: String = row.get(1)?;
                let name_en: Option<String> = row.get(2)?;
                let name_ja: Option<String> = row.get(3)?;
                let image_url: Option<String> = row.get(4)?;

                Ok(UtStadiumRecord {
                    id,
                    name_fr,
                    name_en: name_en.filter(|s| s != "\\N" && !s.is_empty()),
                    name_ja: name_ja.filter(|s| s != "\\N" && !s.is_empty()),
                    image_url: image_url.filter(|s| s != "\\N" && !s.is_empty()),
                })
            })
            .map_err(|e| LauncherError::Io(std::io::Error::other(e)))?;

        let mut list = Vec::new();
        for s in rows.flatten() {
            list.push(s);
            if list.len() >= limit {
                break;
            }
        }
        Ok(list)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::mock::StepRng;

    #[test]
    fn test_canonical_formation_433() {
        let f = formation_layout("4-3-3");
        assert_eq!(f.name, "4-3-3");
        assert_eq!(f.slots.len(), 11);
        assert_eq!(f.slots[0].label, "EXTI");
        assert_eq!(f.slots[10].label, "POR");
    }

    #[test]
    fn test_dynamic_formation_343() {
        let f = formation_layout("3-4-3");
        assert_eq!(f.name, "3-4-3");
        // 3 FW + 4 MF + 3 DF + 1 GK = 11
        assert_eq!(f.slots.len(), 11);
        let thirds = f.group_by_pitch_third();
        assert_eq!(thirds[0].0, "Portero");
        assert_eq!(thirds[0].1.len(), 1);
        assert_eq!(thirds[1].0, "Defensas");
        assert_eq!(thirds[1].1.len(), 3);
        assert_eq!(thirds[2].0, "Centrocampistas");
        assert_eq!(thirds[2].1.len(), 4);
        assert_eq!(thirds[3].0, "Delanteros");
        assert_eq!(thirds[3].1.len(), 3);
    }

    #[test]
    fn test_pack_opening_simulation() {
        let pack = UtPack {
            id: "sobre-oro".into(),
            name: "Sobre Oro".into(),
            price: 15000,
            prob_common: 0.35,
            prob_rare: 0.48,
            prob_legendary: 0.12,
            prob_icon: 0.048,
            prob_basara: 0.002,
            prob_legendary_elite: 0.0,
            prob_legendary_supremo: 0.0,
            card_count: 3,
            pack_url: None,
            name_en: Some("Gold Pack".into()),
            name_fr: Some("Pochette Or".into()),
        };

        let players = vec![
            UtPlayer {
                id: "1".into(),
                name: "Mark Evans".into(),
                element: "Montaña".into(),
                position: "POR".into(),
                team_id: "raimon".into(),
                foto_url: None,
                rarity: "Legendario".into(),
                game: Some("IE 1".into()),
                nickname: Some("Endo".into()),
                weight: 1.0,
                legendary_tier: None,
                name_en: None,
                name_ja: None,
                internal_code: None,
                stat_total: None,
            },
            UtPlayer {
                id: "2".into(),
                name: "Nathan Swift".into(),
                element: "Aire".into(),
                position: "DF".into(),
                team_id: "raimon".into(),
                foto_url: None,
                rarity: "Raro".into(),
                game: Some("IE 1".into()),
                nickname: Some("Kazemaru".into()),
                weight: 1.0,
                legendary_tier: None,
                name_en: None,
                name_ja: None,
                internal_code: None,
                stat_total: None,
            },
        ];

        let mut rng = StepRng::new(0, 1000);
        let result = open_pack(&pack, &players, &mut rng);
        assert_eq!(result.cards.len(), 3);
        assert!(result.total_quicksell_value > 0);
    }

    #[test]
    fn test_fused_ut_database_loads_all_players_and_teams() {
        if let Ok(db) = UtDatabase::open_default() {
            let players = db.get_players().expect("failed to load fused players");
            assert!(players.len() >= 497, "Expected at least 497 players from FUT");
            if db.has_azalee() {
                assert!(players.len() > 2000, "Fused database should contain thousands of characters from Azalée");
                let teams = db.get_teams().expect("failed to load fused teams");
                assert!(teams.len() > 100, "Fused teams should contain over 100 teams");
            }
        }
    }
}
