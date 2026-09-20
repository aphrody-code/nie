//! Match Statistics, Soccer History Records, and Ranked Configurations.
//!
//! Ported from reversed Level-5 symbols in `nie.exe`:
//! - `fn_soccerMatchRecord` (0x1400b6bf0)
//! - `game::MatchRecordAggregate` (0x141a02c98)
//! - `game::MenuListViewMatchRecord` (0x141a02760)
//! - `game::GDSSoccerRankmatchConfig` (0x1419cee48)

use serde::{Deserialize, Serialize};

use crate::protocol::{Inacode, MatchMode};

/// An individual football match record (`fn_soccerMatchRecord`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoccerMatchRecord {
    /// Match unique ID.
    pub match_id: String,
    /// Inacode room used if applicable.
    pub inacode: Option<Inacode>,
    /// Match mode (Casual, Ranked, Tournament, 2v2).
    pub mode: MatchMode,
    /// Player's team name.
    pub my_team_name: String,
    /// Opponent's team name.
    pub opponent_team_name: String,
    /// Opponent peer or player display name.
    pub opponent_name: String,
    /// Final score (Home, Away).
    pub final_score: (u8, u8),
    /// Whether local player was Home team.
    pub is_home: bool,
    /// Match duration in seconds.
    pub duration_seconds: u32,
    /// Possession rate percentage (e.g. 54 for 54%).
    pub possession_pct: u8,
    /// Shots on goal (Local, Opponent).
    pub shots_on_goal: (u8, u8),
    /// Special moves performed (Local, Opponent).
    pub hissatsu_moves_used: (u8, u8),
    /// Super tactics activated.
    pub super_tactics_used: (u8, u8),
    /// Best player / MVP character ID.
    pub mvp_chara_id: u32,
    /// Rating change delta (e.g. +24 or -18).
    pub rating_delta: i32,
    /// Timestamp when match completed (unix seconds).
    pub completed_at: u64,
    /// Replay deterministic seed.
    pub replay_seed: u64,
}

impl SoccerMatchRecord {
    /// Returns true if the local player won this match.
    #[must_use]
    pub fn is_victory(&self) -> bool {
        if self.is_home {
            self.final_score.0 > self.final_score.1
        } else {
            self.final_score.1 > self.final_score.0
        }
    }

    /// Returns true if this match ended in a draw.
    #[must_use]
    pub fn is_draw(&self) -> bool {
        self.final_score.0 == self.final_score.1
    }
}

/// Aggregated career statistics matching `game::MatchRecordAggregate` (0x141a02c98).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MatchRecordAggregate {
    /// Total matches played.
    pub total_matches: u32,
    /// Total victories.
    pub wins: u32,
    /// Total defeats.
    pub losses: u32,
    /// Total draws.
    pub draws: u32,
    /// Total goals scored.
    pub goals_scored: u32,
    /// Total goals conceded.
    pub goals_conceded: u32,
    /// Current competitive rating.
    pub current_rating: u32,
    /// Peak competitive rating.
    pub peak_rating: u32,
    /// Win streak.
    pub current_streak: u32,
    /// Best win streak.
    pub best_streak: u32,
}

impl MatchRecordAggregate {
    /// Computes win rate percentage (0.0 to 100.0).
    #[must_use]
    pub fn win_rate_pct(&self) -> f32 {
        if self.total_matches == 0 {
            0.0
        } else {
            (self.wins as f32 / self.total_matches as f32) * 100.0
        }
    }

    /// Ingests a new match record and updates aggregates.
    pub fn ingest_match(&mut self, record: &SoccerMatchRecord) {
        self.total_matches += 1;
        let (my_goals, opp_goals) = if record.is_home {
            record.final_score
        } else {
            (record.final_score.1, record.final_score.0)
        };
        self.goals_scored += my_goals as u32;
        self.goals_conceded += opp_goals as u32;

        if record.is_victory() {
            self.wins += 1;
            self.current_streak += 1;
            if self.current_streak > self.best_streak {
                self.best_streak = self.current_streak;
            }
        } else if record.is_draw() {
            self.draws += 1;
            self.current_streak = 0;
        } else {
            self.losses += 1;
            self.current_streak = 0;
        }

        self.current_rating = (self.current_rating as i32 + record.rating_delta).max(0) as u32;
        if self.current_rating > self.peak_rating {
            self.peak_rating = self.current_rating;
        }
    }
}

/// Global ranked match ladder settings matching `GDSSoccerRankmatchConfig` (0x1419cee48).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDSSoccerRankmatchConfig {
    /// Default starting rating for new players (default 1000).
    pub initial_rating: u32,
    /// K-factor used for ELO delta computation (default 32).
    pub elo_k_factor: u32,
    /// Bonus points awarded for a clean sheet (0 goals conceded).
    pub clean_sheet_bonus: u32,
    /// Streak multiplier bonus for >= 3 consecutive wins.
    pub streak_bonus: u32,
    /// Minimum rating floor (default 100).
    pub rating_floor: u32,
}

impl Default for GDSSoccerRankmatchConfig {
    fn default() -> Self {
        Self {
            initial_rating: 1000,
            elo_k_factor: 32,
            clean_sheet_bonus: 5,
            streak_bonus: 8,
            rating_floor: 100,
        }
    }
}

impl GDSSoccerRankmatchConfig {
    /// Computes the rating delta for a completed match using Level-5 ELO formula.
    #[must_use]
    pub fn calculate_rating_delta(
        &self,
        player_rating: u32,
        opponent_rating: u32,
        won: bool,
        is_draw: bool,
        clean_sheet: bool,
        streak: u32,
    ) -> i32 {
        let diff = opponent_rating as f64 - player_rating as f64;
        let expected = 1.0 / (1.0 + 10.0_f64.powf(diff / 400.0));
        let actual = if won {
            1.0
        } else if is_draw {
            0.5
        } else {
            0.0
        };

        let mut delta = (self.elo_k_factor as f64 * (actual - expected)).round() as i32;
        if won && clean_sheet {
            delta += self.clean_sheet_bonus as i32;
        }
        if won && streak >= 3 {
            delta += self.streak_bonus as i32;
        }
        delta
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_soccer_match_record_and_aggregate() {
        let mut agg = MatchRecordAggregate {
            current_rating: 1000,
            peak_rating: 1000,
            ..Default::default()
        };

        let rec = SoccerMatchRecord {
            match_id: "m_101".into(),
            inacode: Some(Inacode("INA-2999".into())),
            mode: MatchMode::Ranked,
            my_team_name: "Raimon".into(),
            opponent_team_name: "Royal Academy".into(),
            opponent_name: "Ray Dark".into(),
            final_score: (3, 1),
            is_home: true,
            duration_seconds: 300,
            possession_pct: 58,
            shots_on_goal: (6, 2),
            hissatsu_moves_used: (4, 2),
            super_tactics_used: (1, 0),
            mvp_chara_id: 1,
            rating_delta: 28,
            completed_at: 1700000000,
            replay_seed: 42,
        };

        assert!(rec.is_victory());
        assert!(!rec.is_draw());

        agg.ingest_match(&rec);
        assert_eq!(agg.total_matches, 1);
        assert_eq!(agg.wins, 1);
        assert_eq!(agg.goals_scored, 3);
        assert_eq!(agg.goals_conceded, 1);
        assert_eq!(agg.current_rating, 1028);
        assert_eq!(agg.peak_rating, 1028);
        assert_eq!(agg.current_streak, 1);
        assert!((agg.win_rate_pct() - 100.0).abs() < 1e-5);
    }

    #[test]
    fn test_rank_match_config_elo_calculation() {
        let cfg = GDSSoccerRankmatchConfig::default();
        let delta_win = cfg.calculate_rating_delta(1000, 1000, true, false, true, 3);
        // Base ELO diff = 0 -> expected = 0.5 -> 32 * 0.5 = 16.
        // clean sheet bonus (+5) + streak bonus (+8) = 16 + 13 = 29.
        assert_eq!(delta_win, 29);
    }
}
