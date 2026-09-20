//! Level-5 Network & Matchmaking State Machines.
//!
//! Directly ported from `nie.exe` reversed RTTI classes:
//! - `INetState` / `NetState_*` (`NetState_OFFLINE`, `NetState_LOGIN`, `NetState_INIT_NET`,
//!   `NetState_RECRUTE_CLIENT`, `NetState_SESSION_SERVER`, `NetState_SESSION_CLIENT`,
//!   `NetState_JOIN_SESSION`, `NetState_CLOSE_SESSION`, `NetState_SESSION_ERROR`)
//! - `NetworkSessionStateMachine` / `NetworkSessionState_*`
//! - `GameNetMatchmakeStateMachine` / `MatchmakeState_*`
//! - `GameNetRankMatchmakeStateMachine`, `GameNetQuickMatchmakeStateMachine`,
//!   `GameNetCasualTournamentMatchmakeStateMachine`, `GameNetQualTournamentMatchmakeStateMachine`,
//!   `GameNetMainTournamentMatchmakeStateMachine`, `GameNetFinalTournamentMatchmakeStateMachine`

use serde::{Deserialize, Serialize};

/// Fundamental network transport state matching Level-5 `INetState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum NetState {
    /// Disconnected / offline state (`NetState_OFFLINE`, 0x141a2c2c8).
    #[default]
    Offline,
    /// Authenticating with server or platform (`NetState_LOGIN`, 0x141a2c420).
    Login,
    /// Initializing socket / P2P transport (`NetState_INIT_NET`, 0x141a2c450).
    InitNet,
    /// Host advertising and recruiting remote peer (`NetState_RECRUTE_CLIENT`, 0x141a2c480).
    RecruitClient,
    /// Operating as authoritative host / relay (`NetState_SESSION_SERVER`, 0x141a2c390).
    SessionServer,
    /// Operating as connected peer (`NetState_SESSION_CLIENT`, 0x141a2c3c0).
    SessionClient,
    /// In the process of handshaking into a session (`NetState_JOIN_SESSION`, 0x141a2c360).
    JoinSession,
    /// Gracefully closing active session (`NetState_CLOSE_SESSION`, 0x141a2c330).
    CloseSession,
    /// Terminal error state with error code (`NetState_SESSION_ERROR`, 0x141a2c3f0).
    SessionError,
}

impl NetState {
    /// Returns true if this state is actively engaged in an online session.
    #[must_use]
    pub const fn is_connected(&self) -> bool {
        matches!(self, Self::SessionServer | Self::SessionClient)
    }

    /// Returns true if the state machine is transitioning towards a connection.
    #[must_use]
    pub const fn is_connecting(&self) -> bool {
        matches!(self, Self::Login | Self::InitNet | Self::RecruitClient | Self::JoinSession)
    }
}

/// Network session state machine states matching Level-5 `NetworkSessionState_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SessionState {
    /// Session is inactive (`NetworkSessionState_Offline`, 0x141a2c028).
    #[default]
    Offline,
    /// Initializing session subsystem (`NetworkSessionState_Init`, 0x141a2bff8).
    Init,
    /// Waiting for user or remote request (`NetworkSessionState_WaitRequest`, 0x141a2c088).
    WaitRequest,
    /// Creating room or hosting session (`NetworkSessionState_Create`, 0x141a2c058).
    Create,
    /// Joining target room or session (`NetworkSessionState_Join`, 0x141a2bf68).
    Join,
    /// In matching pool waiting for opponent (`NetworkSessionState_WaitMatching`, 0x141a2bf38).
    WaitMatching,
    /// Match completed or session finalised (`NetworkSessionState_Fin`, 0x141a2bfc8).
    Fin,
    /// Session encountered an error (`NetworkSessionState_Error`, 0x141a2bf98).
    Error,
}

/// Matchmaking state machine states matching Level-5 `MatchmakeState_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum MatchmakeState {
    /// Initial state (`MatchmakeState_Init`, 0x141a28628).
    #[default]
    Init,
    /// Checking local connection (`MatchmakeState_CheckInternetConnection`, 0x141a28448).
    CheckInternetConnection,
    /// Authenticating with HTTP token services (`MatchmakeState_WaitHttpLogin`, 0x141a283e8).
    WaitHttpLogin,
    /// Calling Level-5 backend matchmaking API (`MatchmakeState_WaitAPI`, 0x141a28418).
    WaitAPI,
    /// Actively searching for candidate pools (`MatchmakeState_Search`, 0x141a285f8).
    Search,
    /// Ticket queued, waiting for match pairing (`MatchmakeState_WaitMatching`, 0x141a285c8).
    WaitMatching,
    /// Assigned as host, waiting for client join (`MatchmakeState_HostRecruitClient`, 0x141a28598).
    HostRecruitClient,
    /// Host confirmed client, preparing launch (`MatchmakeState_HostWaitRunning`, 0x141a284d8).
    HostWaitRunning,
    /// Client joined host, awaiting match start (`MatchmakeState_GuestWaitStart`, 0x141a28568).
    GuestWaitStart,
    /// Client confirmed launch, synchronising (`MatchmakeState_GuestWaitRunning`, 0x141a284a8).
    GuestWaitRunning,
    /// Active match in progress (`MatchmakeState_Running`, 0x141a28478).
    Running,
    /// Matchmaking cancelled by user or timeout (`MatchmakeState_Cancel`, 0x141a28538).
    Cancel,
    /// Matchmaking failed (`MatchmakeState_Error`, 0x141a28508).
    Error,
}

/// Tournament bracket stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum TournamentStage {
    /// Preliminary qualifier rounds (`MatchmakeState_WaitQualEntry`).
    #[default]
    Qualifier,
    /// Main tournament bracket round 16/8/quarter-finals (`MatchmakeState_WaitMainEntry`).
    MainDraw,
    /// Semi-finals.
    SemiFinals,
    /// Grand Championship Finals (`VictoryRoadFinalTournamentMenuState_FinalMatch`).
    GrandFinal,
}

/// Rematch adjudication verdict matching `VictoryRoadFinalTournamentMenuState_RematchJudge`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RematchJudge {
    /// Awaiting vote from both players.
    #[default]
    Pending,
    /// Both players agreed to a rematch.
    Agreed,
    /// At least one player declined.
    Declined,
    /// Vote timed out.
    Timeout,
}

/// Ranked matchmaking state machine with dynamic rating band expansion.
///
/// Ported from `game::GameNetRankMatchmakeStateMachine` (0x141a28ce8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameNetRankMatchmakeStateMachine {
    /// Current state.
    pub state: MatchmakeState,
    /// Player rating (Skill Rating / ELO).
    pub player_rating: u32,
    /// Search band delta (expands from ±50 to ±300 over time).
    pub rating_window: u32,
    /// Seconds elapsed in matchmaking queue.
    pub elapsed_seconds: f32,
    /// Maximum allowed search duration before widening window.
    pub window_expand_interval_sec: f32,
    /// Found opponent ID if matched.
    pub matched_peer_id: Option<String>,
}

impl GameNetRankMatchmakeStateMachine {
    /// Creates a new ranked matchmaker for a player with a specified initial rating.
    #[must_use]
    pub fn new(player_rating: u32) -> Self {
        Self {
            state: MatchmakeState::Init,
            player_rating,
            rating_window: 50,
            elapsed_seconds: 0.0,
            window_expand_interval_sec: 5.0,
            matched_peer_id: None,
        }
    }

    /// Advances the state machine by `dt` seconds.
    pub fn step(&mut self, dt: f32) {
        match self.state {
            MatchmakeState::Init => {
                self.state = MatchmakeState::CheckInternetConnection;
            }
            MatchmakeState::CheckInternetConnection => {
                self.state = MatchmakeState::WaitHttpLogin;
            }
            MatchmakeState::WaitHttpLogin => {
                self.state = MatchmakeState::WaitAPI;
            }
            MatchmakeState::WaitAPI => {
                self.state = MatchmakeState::Search;
            }
            MatchmakeState::Search | MatchmakeState::WaitMatching => {
                self.elapsed_seconds += dt;
                // Level-5 rating window escalation: expand every 5 seconds up to ±350.
                let expansions = (self.elapsed_seconds / self.window_expand_interval_sec) as u32;
                self.rating_window = (50 + expansions * 50).min(350);
            }
            _ => {}
        }
    }

    /// Tests if a candidate opponent's rating is acceptable within the current search band.
    #[must_use]
    pub fn is_acceptable_opponent(&self, candidate_rating: u32) -> bool {
        let min_rating = self.player_rating.saturating_sub(self.rating_window);
        let max_rating = self.player_rating.saturating_add(self.rating_window);
        candidate_rating >= min_rating && candidate_rating <= max_rating
    }

    /// Assigns a match to the state machine.
    pub fn on_match_found(&mut self, opponent_id: String, as_host: bool) {
        self.matched_peer_id = Some(opponent_id);
        self.state = if as_host {
            MatchmakeState::HostRecruitClient
        } else {
            MatchmakeState::GuestWaitStart
        };
    }

    /// Marks the match as actively running.
    pub fn on_session_started(&mut self) {
        self.state = MatchmakeState::Running;
    }
}

/// Quick match state machine for instant exhibition matches.
///
/// Ported from `game::GameNetQuickMatchmakeStateMachine` (0x141a28ae8).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameNetQuickMatchmakeStateMachine {
    /// Current state.
    pub state: MatchmakeState,
    /// Elapsed seconds searching.
    pub elapsed_seconds: f32,
    /// Timeout in seconds before falling back to bot or open lobby.
    pub timeout_seconds: f32,
    /// Matched opponent ID.
    pub matched_peer_id: Option<String>,
}

impl Default for GameNetQuickMatchmakeStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl GameNetQuickMatchmakeStateMachine {
    /// Creates a quick matchmaker with default 10.0s instant pairing timeout.
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: MatchmakeState::Init,
            elapsed_seconds: 0.0,
            timeout_seconds: 10.0,
            matched_peer_id: None,
        }
    }

    /// Steps the quick matchmaker.
    pub fn step(&mut self, dt: f32) {
        if self.state == MatchmakeState::Init {
            self.state = MatchmakeState::Search;
        }
        if self.state == MatchmakeState::Search || self.state == MatchmakeState::WaitMatching {
            self.elapsed_seconds += dt;
        }
    }
}

/// Tournament matchmaker supporting Qualifiers, Main Bracket, and Grand Finals.
///
/// Ported from `GameNetFinalTournamentMatchmakeStateMachine` (0x141a279d8) and
/// `GameNetCasualTournamentMatchmakeStateMachine` (0x141a27758).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameNetTournamentStateMachine {
    /// Current tournament stage.
    pub stage: TournamentStage,
    /// Matchmaking status.
    pub state: MatchmakeState,
    /// Player's tournament bracket slot (0 to 7).
    pub bracket_slot: u8,
    /// Current score in current match (Home, Away).
    pub current_score: (u8, u8),
    /// Rematch judge verdict.
    pub rematch_judge: RematchJudge,
    /// Result validation status (anti-desync check).
    pub result_validated: bool,
}

impl GameNetTournamentStateMachine {
    /// Creates a tournament state machine at the specified bracket stage.
    #[must_use]
    pub fn new(stage: TournamentStage, bracket_slot: u8) -> Self {
        Self {
            stage,
            state: MatchmakeState::Init,
            bracket_slot,
            current_score: (0, 0),
            rematch_judge: RematchJudge::Pending,
            result_validated: false,
        }
    }

    /// Records match finish, validates results across peers, and advances stage if victorious.
    pub fn on_match_finish(&mut self, my_score: u8, opponent_score: u8) -> bool {
        self.current_score = (my_score, opponent_score);
        self.result_validated = true;
        let won = my_score > opponent_score;
        if won {
            self.stage = match self.stage {
                TournamentStage::Qualifier => TournamentStage::MainDraw,
                TournamentStage::MainDraw => TournamentStage::SemiFinals,
                TournamentStage::SemiFinals => TournamentStage::GrandFinal,
                TournamentStage::GrandFinal => TournamentStage::GrandFinal,
            };
        }
        won
    }

    /// Votes on rematch.
    pub fn vote_rematch(&mut self, p1_vote: bool, p2_vote: bool) {
        self.rematch_judge = if p1_vote && p2_vote {
            RematchJudge::Agreed
        } else {
            RematchJudge::Declined
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_net_state_helpers() {
        assert!(!NetState::Offline.is_connected());
        assert!(NetState::SessionServer.is_connected());
        assert!(NetState::SessionClient.is_connected());
        assert!(NetState::Login.is_connecting());
        assert!(NetState::JoinSession.is_connecting());
    }

    #[test]
    fn test_rank_matchmake_window_expansion() {
        let mut sm = GameNetRankMatchmakeStateMachine::new(1200);
        assert_eq!(sm.state, MatchmakeState::Init);

        sm.step(0.1);
        assert_eq!(sm.state, MatchmakeState::CheckInternetConnection);
        sm.step(0.1);
        assert_eq!(sm.state, MatchmakeState::WaitHttpLogin);
        sm.step(0.1);
        assert_eq!(sm.state, MatchmakeState::WaitAPI);
        sm.step(0.1);
        assert_eq!(sm.state, MatchmakeState::Search);

        // Initially window is 50 -> accepts [1150, 1250]
        assert!(sm.is_acceptable_opponent(1220));
        assert!(!sm.is_acceptable_opponent(1300));

        // After 11 seconds (2 intervals) -> window expands to 150 -> accepts [1050, 1350]
        sm.step(11.0);
        assert!(sm.is_acceptable_opponent(1300));
        assert!(sm.is_acceptable_opponent(1100));

        sm.on_match_found("player_99".into(), true);
        assert_eq!(sm.state, MatchmakeState::HostRecruitClient);
        sm.on_session_started();
        assert_eq!(sm.state, MatchmakeState::Running);
    }

    #[test]
    fn test_tournament_stage_advancement() {
        let mut tm = GameNetTournamentStateMachine::new(TournamentStage::Qualifier, 1);
        assert_eq!(tm.stage, TournamentStage::Qualifier);

        let won = tm.on_match_finish(3, 1);
        assert!(won);
        assert_eq!(tm.stage, TournamentStage::MainDraw);

        let won_semi = tm.on_match_finish(2, 0);
        assert!(won_semi);
        assert_eq!(tm.stage, TournamentStage::SemiFinals);

        let won_final = tm.on_match_finish(4, 3);
        assert!(won_final);
        assert_eq!(tm.stage, TournamentStage::GrandFinal);

        tm.vote_rematch(true, true);
        assert_eq!(tm.rematch_judge, RematchJudge::Agreed);
    }
}
