//! Pure Ranked 1v1 and 2v2 match logic, challenge store, double validation, and telemetry.
//!
//! Direct Rust port of `rg/apps/achillea-bot/src/ranked/*`:
//! - `challenge-store.ts`: In-memory shareable 8-char challenge codes with 30-min TTL
//! - `match-logic.ts`: Dynamic ELO window expansion, queue pair selection, double-validation scorelines
//! - `schema/MatchState.ts` & `rooms/MatchRoom.ts`: Room state flow (waiting -> playing -> scoring -> finished | disputed)
//! - `telemetry.ts`: Match lifecycle event journal and audit trail

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};

// ─── Challenge Store (challenge-store.ts) ────────────────────────────────────

/// Time-to-live for a generated challenge link (30 minutes in seconds).
pub const CHALLENGE_TTL_SECS: u64 = 30 * 60;

/// Base-32 alphanumeric character alphabet without ambiguous characters (no I, O, 0, 1).
pub const CHALLENGE_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
pub const CHALLENGE_CODE_LEN: usize = 8;

/// A shareable ranked or casual challenge invitation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Challenge {
    pub code: String,
    pub from_user_id: String,
    pub from_display_name: String,
    pub from_avatar: String,
    pub from_elo: u32,
    pub mode: u8,
    pub ranked: bool,
    /// Targeted opponent user ID (e.g. rematch challenge). None if open to anyone.
    pub to_user_id: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
}

impl Challenge {
    /// Returns true if this challenge has expired.
    #[must_use]
    pub fn is_expired(&self, now: u64) -> bool {
        self.expires_at <= now
    }
}

/// In-memory store of shareable challenges with automated expiration.
#[derive(Debug, Default)]
pub struct ChallengeStore {
    challenges: HashMap<String, Challenge>,
    seed: u64,
}

impl ChallengeStore {
    /// Creates a new challenge store.
    #[must_use]
    pub fn new() -> Self {
        Self {
            challenges: HashMap::new(),
            seed: 0xCAFE_BABE,
        }
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn gen_code(&mut self) -> String {
        let mut out = String::with_capacity(CHALLENGE_CODE_LEN);
        for _ in 0..CHALLENGE_CODE_LEN {
            self.seed = self.seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let idx = ((self.seed >> 32) as usize) % CHALLENGE_CODE_ALPHABET.len();
            out.push(CHALLENGE_CODE_ALPHABET[idx] as char);
        }
        out
    }

    /// Purges all expired challenges.
    pub fn purge_expired(&mut self, now: u64) {
        self.challenges.retain(|_, c| !c.is_expired(now));
    }

    /// Creates and stores a new challenge.
    #[allow(clippy::too_many_arguments)]
    pub fn create_challenge(
        &mut self,
        from_user_id: String,
        from_display_name: String,
        from_avatar: String,
        from_elo: u32,
        mode: u8,
        ranked: bool,
        to_user_id: Option<String>,
    ) -> Challenge {
        let now = Self::now_secs();
        self.purge_expired(now);

        let mut code = self.gen_code();
        while self.challenges.contains_key(&code) {
            code = self.gen_code();
        }

        let challenge = Challenge {
            code: code.clone(),
            from_user_id,
            from_display_name,
            from_avatar,
            from_elo,
            mode,
            ranked,
            to_user_id,
            created_at: now,
            expires_at: now + CHALLENGE_TTL_SECS,
        };

        self.challenges.insert(code, challenge.clone());
        challenge
    }

    /// Reads a challenge without consuming it.
    #[must_use]
    pub fn get_challenge(&self, code: &str) -> Option<&Challenge> {
        let c = self.challenges.get(code)?;
        if c.is_expired(Self::now_secs()) {
            None
        } else {
            Some(c)
        }
    }

    /// Consumes (removes) a single-use challenge.
    pub fn consume_challenge(&mut self, code: &str) -> Option<Challenge> {
        let now = Self::now_secs();
        self.challenges.remove(code).filter(|c| !c.is_expired(now))
    }

    /// Cancels a pending challenge.
    pub fn cancel_challenge(&mut self, code: &str) {
        self.challenges.remove(code);
    }
}

// ─── Match Logic (match-logic.ts) ───────────────────────────────────────────

/// Team side for a player based on index (0 = Home / Team 1, 1 = Away / Team 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TeamSide {
    Home = 1,
    Away = 2,
}

impl TeamSide {
    #[must_use]
    pub fn from_index(index: usize) -> Self {
        if index == 0 { Self::Home } else { Self::Away }
    }

    #[must_use]
    pub fn is_home(&self) -> bool {
        matches!(self, Self::Home)
    }
}

/// Clamps a match score input to valid [0, 99] range.
#[must_use]
pub fn clamp_score(score: i32) -> u8 {
    score.clamp(0, 99) as u8
}

/// Calculates expanding ELO search window: `base` expanded by 50 AP per 5 seconds of wait time.
#[must_use]
pub fn elo_window(base: u32, waited_ms: u64) -> u32 {
    base + ((waited_ms / 5000) as u32) * 50
}

/// A candidate waiting in queue for matchmaking pairing.
#[derive(Debug, Clone)]
pub struct QueueCandidate {
    pub user_id: String,
    pub elo: u32,
    pub enqueued_at_ms: u64,
}

/// Selects the first pairable match from a list of candidates sorted by ELO ascending.
///
/// Guaranteed never to pair a player against themselves (`user_id != user_id`).
#[must_use]
pub fn select_queue_pair(
    sorted: &[QueueCandidate],
    now_ms: u64,
    base_window: u32,
) -> Option<(usize, usize)> {
    if sorted.len() < 2 {
        return None;
    }

    for (i, a) in sorted.iter().enumerate().take(sorted.len() - 1) {
        for (offset, b) in sorted.iter().enumerate().skip(i + 1) {
            if a.user_id == b.user_id {
                continue;
            }

            let waited = (now_ms.saturating_sub(a.enqueued_at_ms))
                .max(now_ms.saturating_sub(b.enqueued_at_ms));
            let window = elo_window(base_window, waited);
            let diff = a.elo.abs_diff(b.elo);

            if diff <= window {
                return Some((i, offset));
            }
            if b.elo > a.elo && (b.elo - a.elo) > window {
                break; // List is sorted ascending, later items will be further away
            }
        }
    }

    None
}

/// A player's score submission from their own perspective.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreInput {
    pub user_id: String,
    /// Goals scored by me.
    pub my_score: u8,
    /// Goals scored by opponent according to me.
    pub opp_score: u8,
    pub submitted: bool,
}

/// Evaluates whether two scorelines agree (Home 3-1 == Away 1-3).
#[must_use]
pub fn scores_agree(home: &ScoreInput, away: &ScoreInput) -> bool {
    home.submitted
        && away.submitted
        && home.my_score == away.opp_score
        && home.opp_score == away.my_score
}

/// Result string from the player's perspective.
#[must_use]
pub fn result_label(my_score: u8, opp_score: u8) -> &'static str {
    if my_score > opp_score {
        "win"
    } else if my_score < opp_score {
        "loss"
    } else {
        "draw"
    }
}

/// Resolution outcome of a double-validated match score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScoreOutcome {
    /// Still waiting for both players to submit their scorelines.
    Wait,
    /// Both players agree on the scoreline (Home goals `s1`, Away goals `s2`).
    Agree { s1: u8, s2: u8 },
    /// Forfeit by timeout: one player submitted, the other failed to respond.
    Forfeit {
        s1: u8,
        s2: u8,
        forfeit_user_id: String,
    },
    /// Scorelines disagree or invalid: flagged for dispute and screenshot review.
    Dispute,
}

/// Resolves the match decision from both players' score inputs.
#[must_use]
pub fn resolve_scores(home: &ScoreInput, away: &ScoreInput, forced_timeout: bool) -> ScoreOutcome {
    if !forced_timeout && (!home.submitted || !away.submitted) {
        return ScoreOutcome::Wait;
    }

    if scores_agree(home, away) {
        return ScoreOutcome::Agree {
            s1: home.my_score,
            s2: away.my_score,
        };
    }

    if forced_timeout {
        if home.submitted && !away.submitted {
            return ScoreOutcome::Forfeit {
                s1: home.my_score,
                s2: home.opp_score,
                forfeit_user_id: away.user_id.clone(),
            };
        }
        if away.submitted && !home.submitted {
            return ScoreOutcome::Forfeit {
                s1: away.opp_score,
                s2: away.my_score,
                forfeit_user_id: home.user_id.clone(),
            };
        }
    }

    ScoreOutcome::Dispute
}

// ─── Match Room State Machine (schema/MatchState.ts) ────────────────────────

/// Flow status of an active ranked match room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum MatchRoomStatus {
    /// Waiting for both players to connect and click "Start Match".
    #[default]
    Waiting,
    /// Match in progress.
    Playing,
    /// At least one player clicked "Finish Match": scoring window open.
    Scoring,
    /// Score disagreement: dispute opened for admin or proof upload.
    Disputed,
    /// Match validated and finished (ELO applied).
    Finished,
    /// Match cancelled or voided.
    Void,
    /// A player surrendered early.
    Surrendered,
}

/// Player state within an active match room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerMatchState {
    pub user_id: String,
    pub display_name: String,
    pub avatar: String,
    pub elo: u32,
    pub team: TeamSide,
    pub my_score: i16,
    pub opp_score: i16,
    pub started_match: bool,
    pub submitted: bool,
    pub proof_uploaded: bool,
    pub confirmed_finish: bool,
}

impl PlayerMatchState {
    #[must_use]
    pub fn new(
        user_id: String,
        display_name: String,
        avatar: String,
        elo: u32,
        team: TeamSide,
    ) -> Self {
        Self {
            user_id,
            display_name,
            avatar,
            elo,
            team,
            my_score: -1,
            opp_score: -1,
            started_match: false,
            submitted: false,
            proof_uploaded: false,
            confirmed_finish: false,
        }
    }

    #[must_use]
    pub fn to_score_input(&self) -> ScoreInput {
        ScoreInput {
            user_id: self.user_id.clone(),
            my_score: if self.my_score >= 0 {
                self.my_score as u8
            } else {
                0
            },
            opp_score: if self.opp_score >= 0 {
                self.opp_score as u8
            } else {
                0
            },
            submitted: self.submitted,
        }
    }
}

/// A text chat message in a match room.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedChatMessage {
    pub user_id: String,
    pub text: String,
    pub at_secs: u64,
}

/// Active match room instance tracking both competitors, chat, and validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedMatchRoom {
    pub room_code: String,
    pub status: MatchRoomStatus,
    pub mode: u8,
    pub ranked: bool,
    pub players: HashMap<String, PlayerMatchState>,
    pub chat: Vec<RankedChatMessage>,
    pub dispute_reason: String,
    pub started_at: u64,
    pub finished_score: Option<(u8, u8)>,
}

impl RankedMatchRoom {
    /// Creates a new match room for home and away players.
    #[must_use]
    pub fn new(
        room_code: String,
        mode: u8,
        ranked: bool,
        home_player: PlayerMatchState,
        away_player: PlayerMatchState,
    ) -> Self {
        let mut players = HashMap::new();
        players.insert(home_player.user_id.clone(), home_player);
        players.insert(away_player.user_id.clone(), away_player);

        Self {
            room_code,
            status: MatchRoomStatus::Waiting,
            mode,
            ranked,
            players,
            chat: Vec::new(),
            dispute_reason: String::new(),
            started_at: 0,
            finished_score: None,
        }
    }

    /// Player clicks "Start Match". When both click, state transitions to Playing.
    pub fn player_ready(&mut self, user_id: &str) -> bool {
        if let Some(p) = self.players.get_mut(user_id) {
            p.started_match = true;
        }
        if self.players.values().all(|p| p.started_match) {
            self.status = MatchRoomStatus::Playing;
            self.started_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            true
        } else {
            false
        }
    }

    /// Player confirms match finish. Transitions room to Scoring.
    pub fn confirm_finish(&mut self, user_id: &str) {
        if let Some(p) = self.players.get_mut(user_id) {
            p.confirmed_finish = true;
        }
        if self.status == MatchRoomStatus::Playing {
            self.status = MatchRoomStatus::Scoring;
        }
    }

    /// Submits a player's scoreline and attempts double-validation resolution.
    pub fn submit_score(&mut self, user_id: &str, my_score: u8, opp_score: u8) -> ScoreOutcome {
        if let Some(p) = self.players.get_mut(user_id) {
            p.my_score = my_score as i16;
            p.opp_score = opp_score as i16;
            p.submitted = true;
        }

        let home_input = self
            .players
            .values()
            .find(|p| p.team == TeamSide::Home)
            .map(|p| p.to_score_input());
        let away_input = self
            .players
            .values()
            .find(|p| p.team == TeamSide::Away)
            .map(|p| p.to_score_input());

        let (Some(home), Some(away)) = (home_input, away_input) else {
            return ScoreOutcome::Wait;
        };

        let outcome = resolve_scores(&home, &away, false);
        match outcome {
            ScoreOutcome::Agree { s1, s2 } => {
                self.status = MatchRoomStatus::Finished;
                self.finished_score = Some((s1, s2));
            }
            ScoreOutcome::Dispute => {
                self.status = MatchRoomStatus::Disputed;
                self.dispute_reason = "Score disagreement between players".into();
            }
            _ => {}
        }

        outcome
    }

    /// Appends a chat message.
    pub fn add_chat_message(&mut self, user_id: String, text: String) {
        self.chat.push(RankedChatMessage {
            user_id,
            text,
            at_secs: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        });
    }
}

// ─── Telemetry (telemetry.ts) ───────────────────────────────────────────────

/// Ranked lifecycle event type matching Achillea database event table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RankedEventType {
    QueueJoin,
    QueueLeave,
    QueuePair,
    ChallengeCreated,
    ChallengeAccepted,
    MatchCreated,
    PlayerJoined,
    MatchStarted,
    Playing,
    FinishConfirmed,
    ScoreSubmitted,
    ScoresAgreed,
    ScoresDisagreed,
    Finished,
    Disputed,
    Surrendered,
}

/// A recorded telemetry event entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchEvent {
    pub event_type: RankedEventType,
    pub room_code: Option<String>,
    pub user_id: Option<String>,
    pub timestamp: u64,
    pub detail: String,
}

/// Circular in-memory telemetry buffer keeping the last 1000 events.
#[derive(Debug)]
pub struct RankedTelemetry {
    events: VecDeque<MatchEvent>,
    max_capacity: usize,
}

impl Default for RankedTelemetry {
    fn default() -> Self {
        Self {
            events: VecDeque::with_capacity(1000),
            max_capacity: 1000,
        }
    }
}

impl RankedTelemetry {
    #[must_use]
    pub fn new(max_capacity: usize) -> Self {
        Self {
            events: VecDeque::with_capacity(max_capacity),
            max_capacity,
        }
    }

    /// Logs an event into the telemetry journal.
    pub fn log(
        &mut self,
        event_type: RankedEventType,
        room_code: Option<String>,
        user_id: Option<String>,
        detail: impl Into<String>,
    ) {
        if self.events.len() >= self.max_capacity {
            self.events.pop_front();
        }
        self.events.push_back(MatchEvent {
            event_type,
            room_code,
            user_id,
            timestamp: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            detail: detail.into(),
        });
    }

    /// Queries the last N events.
    #[must_use]
    pub fn recent_events(&self, limit: usize) -> Vec<&MatchEvent> {
        self.events.iter().rev().take(limit).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_challenge_store_flow() {
        let mut store = ChallengeStore::new();

        let c = store.create_challenge(
            "mark".into(),
            "Mark Evans".into(),
            "avatar_mark".into(),
            1200,
            2,
            true,
            None,
        );

        assert_eq!(c.code.len(), 8);
        assert!(store.get_challenge(&c.code).is_some());

        let consumed = store.consume_challenge(&c.code).unwrap();
        assert_eq!(consumed.from_user_id, "mark");
        assert!(store.get_challenge(&c.code).is_none());
    }

    #[test]
    fn test_dynamic_elo_window() {
        assert_eq!(elo_window(100, 0), 100);
        assert_eq!(elo_window(100, 4999), 100);
        assert_eq!(elo_window(100, 5000), 150);
        assert_eq!(elo_window(100, 10000), 200);
    }

    #[test]
    fn test_queue_pair_selection() {
        let candidates = vec![
            QueueCandidate {
                user_id: "p1".into(),
                elo: 500,
                enqueued_at_ms: 1000,
            },
            QueueCandidate {
                user_id: "p2".into(),
                elo: 520,
                enqueued_at_ms: 1000,
            },
            QueueCandidate {
                user_id: "p3".into(),
                elo: 900,
                enqueued_at_ms: 1000,
            },
        ];

        let pair = select_queue_pair(&candidates, 2000, 50).unwrap();
        assert_eq!(pair, (0, 1)); // p1 and p2 pair immediately
    }

    #[test]
    fn test_score_double_validation_agree() {
        let home = ScoreInput {
            user_id: "home_user".into(),
            my_score: 3,
            opp_score: 1,
            submitted: true,
        };
        let away = ScoreInput {
            user_id: "away_user".into(),
            my_score: 1,
            opp_score: 3,
            submitted: true,
        };

        assert!(scores_agree(&home, &away));
        assert_eq!(
            resolve_scores(&home, &away, false),
            ScoreOutcome::Agree { s1: 3, s2: 1 }
        );
    }

    #[test]
    fn test_score_double_validation_dispute() {
        let home = ScoreInput {
            user_id: "home_user".into(),
            my_score: 3,
            opp_score: 1,
            submitted: true,
        };
        let away = ScoreInput {
            user_id: "away_user".into(),
            my_score: 2,
            opp_score: 2, // away claims 2-2
            submitted: true,
        };

        assert!(!scores_agree(&home, &away));
        assert_eq!(resolve_scores(&home, &away, false), ScoreOutcome::Dispute);
    }

    #[test]
    fn test_match_room_lifecycle() {
        let home =
            PlayerMatchState::new("p1".into(), "Mark".into(), "".into(), 1000, TeamSide::Home);
        let away =
            PlayerMatchState::new("p2".into(), "Axel".into(), "".into(), 1000, TeamSide::Away);

        let mut room = RankedMatchRoom::new("ROOM_123".into(), 2, true, home, away);
        assert_eq!(room.status, MatchRoomStatus::Waiting);

        assert!(!room.player_ready("p1"));
        assert!(room.player_ready("p2")); // both ready -> Playing
        assert_eq!(room.status, MatchRoomStatus::Playing);

        room.confirm_finish("p1");
        assert_eq!(room.status, MatchRoomStatus::Scoring);

        // Player 1 submits 4-2
        assert_eq!(room.submit_score("p1", 4, 2), ScoreOutcome::Wait);
        // Player 2 submits 2-4 (agrees)
        assert_eq!(
            room.submit_score("p2", 2, 4),
            ScoreOutcome::Agree { s1: 4, s2: 2 }
        );
        assert_eq!(room.status, MatchRoomStatus::Finished);
        assert_eq!(room.finished_score, Some((4, 2)));
    }

    #[test]
    fn test_telemetry_recording() {
        let mut tel = RankedTelemetry::new(5);
        tel.log(
            RankedEventType::QueueJoin,
            None,
            Some("p1".into()),
            "Joined 1v1",
        );
        tel.log(
            RankedEventType::QueuePair,
            Some("R1".into()),
            Some("p1".into()),
            "Paired",
        );

        assert_eq!(tel.recent_events(10).len(), 2);
        assert_eq!(
            tel.recent_events(1)[0].event_type,
            RankedEventType::QueuePair
        );
    }
}
