//! IEVR character-stat curve interpolation.
//!
//! Source of truth: the native IEVR stats contract and its `CharaStats` shape.
//!
//! The game exposes four milestones (`lv1`, `lv30`, `lv50`, `lv99`). Complete
//! curves use three independent linear segments and truncate with floor. When
//! any intermediate milestone is absent, the reference implementation falls
//! back to one `lv1`/`lv99` segment; this module preserves that behavior.

/// The seven displayed IEVR character statistics, in Azalee's field order.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CharaStats {
    /// Kick.
    pub kick: i32,
    /// Control.
    pub control: i32,
    /// Technique.
    pub technique: i32,
    /// Pressure.
    pub pressure: i32,
    /// Physical.
    pub physical: i32,
    /// Agility.
    pub agility: i32,
    /// Intelligence.
    pub intelligence: i32,
}

/// Optional milestone values for one character variant.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct VariantStatLevels {
    /// Level-one stats.
    pub lv1: Option<CharaStats>,
    /// Level-thirty stats.
    pub lv30: Option<CharaStats>,
    /// Level-fifty stats.
    pub lv50: Option<CharaStats>,
    /// Level-ninety-nine stats.
    pub lv99: Option<CharaStats>,
}

/// Minimal variant input required by the interpolation algorithm.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StatCurveVariant {
    /// Milestones, when available.
    pub stats: Option<VariantStatLevels>,
}

/// Interpolates all seven stats at `level`, matching the TypeScript rules.
///
/// `level` is a floating-point value because the source API accepts a
/// JavaScript `number`. Normal game levels are integers from 1 through 99;
/// values outside that range intentionally follow the source's extrapolation
/// behavior except for the exact level-99 fast path.
#[must_use]
pub fn interpolate_variant_stats(variant: &StatCurveVariant, level: f64) -> CharaStats {
    let levels = variant.stats.unwrap_or_default();
    let lv99 = levels.lv99.unwrap_or_default();

    if level == 99.0 {
        return lv99;
    }
    if level == 1.0
        && let Some(lv1) = levels.lv1
    {
        return lv1;
    }

    let Some((lv1, lv30, lv50)) = levels
        .lv1
        .zip(levels.lv30)
        .zip(levels.lv50)
        .map(|((a, b), c)| (a, b, c))
    else {
        let start = levels.lv1.unwrap_or(lv99);
        let t = (level - 1.0) / 98.0;
        return map_stats(|index| floor_lerp(start.at(index), lv99.at(index), t));
    };

    map_stats(|index| {
        if level <= 30.0 {
            floor_lerp(lv1.at(index), lv30.at(index), (level - 1.0) / 29.0)
        } else if level <= 50.0 {
            floor_lerp(lv30.at(index), lv50.at(index), (level - 30.0) / 20.0)
        } else {
            floor_lerp(lv50.at(index), lv99.at(index), (level - 50.0) / 49.0)
        }
    })
}

fn floor_lerp(start: i32, end: i32, t: f64) -> i32 {
    (f64::from(start) + f64::from(end - start) * t).floor() as i32
}

fn map_stats(mut value: impl FnMut(usize) -> i32) -> CharaStats {
    CharaStats {
        kick: value(0),
        control: value(1),
        technique: value(2),
        pressure: value(3),
        physical: value(4),
        agility: value(5),
        intelligence: value(6),
    }
}

impl CharaStats {
    fn at(self, index: usize) -> i32 {
        match index {
            0 => self.kick,
            1 => self.control,
            2 => self.technique,
            3 => self.pressure,
            4 => self.physical,
            5 => self.agility,
            6 => self.intelligence,
            _ => unreachable!("stat index is fixed to seven fields"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(seed: i32) -> CharaStats {
        CharaStats {
            kick: seed,
            control: seed + 1,
            technique: seed + 2,
            pressure: seed + 3,
            physical: seed + 4,
            agility: seed + 5,
            intelligence: seed + 6,
        }
    }

    fn complete() -> StatCurveVariant {
        StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv1: Some(stats(10)),
                lv30: Some(stats(40)),
                lv50: Some(stats(60)),
                lv99: Some(stats(100)),
            }),
        }
    }

    #[test]
    fn returns_zero_for_missing_stats_and_exact_milestones_unchanged() {
        assert_eq!(
            interpolate_variant_stats(&StatCurveVariant::default(), 50.0),
            CharaStats::default()
        );
        let variant = complete();
        assert_eq!(interpolate_variant_stats(&variant, 1.0), stats(10));
        assert_eq!(interpolate_variant_stats(&variant, 30.0), stats(40));
        assert_eq!(interpolate_variant_stats(&variant, 50.0), stats(60));
        assert_eq!(interpolate_variant_stats(&variant, 99.0), stats(100));
    }

    #[test]
    fn uses_the_three_segments_and_maps_all_fields_in_order() {
        let variant = complete();
        assert_eq!(interpolate_variant_stats(&variant, 15.0), stats(24));
        assert_eq!(interpolate_variant_stats(&variant, 40.0), stats(50));
        assert_eq!(interpolate_variant_stats(&variant, 75.0), stats(80));
    }

    #[test]
    fn truncates_each_segment_with_floor() {
        let variant = StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv1: Some(CharaStats {
                    kick: 0,
                    ..stats(0)
                }),
                lv30: Some(CharaStats {
                    kick: 10,
                    ..stats(0)
                }),
                lv50: Some(CharaStats {
                    kick: 11,
                    ..stats(0)
                }),
                lv99: Some(CharaStats {
                    kick: 13,
                    ..stats(0)
                }),
            }),
        };
        assert_eq!(interpolate_variant_stats(&variant, 2.0).kick, 0);
        assert_eq!(interpolate_variant_stats(&variant, 40.0).kick, 10);
        assert_eq!(interpolate_variant_stats(&variant, 75.0).kick, 12);
    }

    #[test]
    fn missing_intermediate_milestone_uses_one_lv1_to_lv99_segment() {
        let variant = StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv1: Some(stats(10)),
                lv99: Some(stats(100)),
                ..VariantStatLevels::default()
            }),
        };
        assert_eq!(interpolate_variant_stats(&variant, 50.0).kick, 55);
        assert_eq!(interpolate_variant_stats(&variant, 1.0), stats(10));
    }

    #[test]
    fn partial_curves_follow_the_reference_fallbacks() {
        let no_lv1 = StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv99: Some(stats(100)),
                ..VariantStatLevels::default()
            }),
        };
        assert_eq!(interpolate_variant_stats(&no_lv1, 50.0).kick, 100);

        let no_lv99 = StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv1: Some(stats(10)),
                ..VariantStatLevels::default()
            }),
        };
        assert_eq!(interpolate_variant_stats(&no_lv99, 50.0).kick, 5);

        // Complete lv1/lv30/lv50 without lv99 is still the complete-data path;
        // the source uses its zero default for the missing lv99 object.
        let no_lv99_complete = StatCurveVariant {
            stats: Some(VariantStatLevels {
                lv1: Some(stats(10)),
                lv30: Some(stats(40)),
                lv50: Some(stats(60)),
                ..VariantStatLevels::default()
            }),
        };
        assert_eq!(
            interpolate_variant_stats(&no_lv99_complete, 99.0),
            CharaStats::default()
        );
        assert_eq!(interpolate_variant_stats(&no_lv99_complete, 75.0).kick, 29);
    }

    #[test]
    fn preserves_reference_extrapolation_for_zero_and_above_cap_levels() {
        let variant = complete();
        assert_eq!(interpolate_variant_stats(&variant, 0.0).kick, 8);
        assert_eq!(interpolate_variant_stats(&variant, 100.0).kick, 100);
    }
}
