//! Deterministic match simulation session with rollback and lockstep support.
//!
//! Tracks world simulation frames, buffers local and remote player inputs,
//! predicts unconfirmed frames, and executes instant rollbacks when late packets arrive.

use std::collections::{BTreeMap, VecDeque};
use nie_geom::Vec3;
use nie_runtime::World;
use crate::protocol::{PlayerSlot, PlayerTickInput, ROLLBACK_MAX_FRAMES, TICK_DT};

/// Ring buffer frame storing snapshot state and applied inputs.
#[derive(Debug, Clone)]
pub struct HistoryFrame {
    pub tick: u64,
    pub world: World,
    pub inputs: [PlayerTickInput; 2],
    pub hash: u32,
}

/// Errors occurring during session simulation.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("Rollback depth exceeded maximum buffer limit ({0} > {ROLLBACK_MAX_FRAMES})")]
    RollbackDepthExceeded(u64),
    #[error("Desync detected at tick {tick}: local hash {local_hash:#010x} != remote hash {remote_hash:#010x}")]
    DesyncDetected {
        tick: u64,
        local_hash: u32,
        remote_hash: u32,
    },
}

/// Active networked match session managing simulation, prediction, and rollback.
pub struct NetMatchSession {
    pub match_id: String,
    pub seed: u64,
    pub local_slot: PlayerSlot,
    pub world: World,
    pub current_tick: u64,
    pub confirmed_tick: u64,
    pub history: VecDeque<HistoryFrame>,
    pub local_inputs: BTreeMap<u64, PlayerTickInput>,
    pub remote_inputs: BTreeMap<u64, PlayerTickInput>,
    pub last_remote_input: Option<PlayerTickInput>,
}

impl NetMatchSession {
    /// Initializes a new networked match session with kickoff world state.
    #[must_use]
    pub fn new(match_id: String, seed: u64, local_slot: PlayerSlot) -> Self {
        let world = World::kickoff();
        let initial_hash = world.state_hash();
        let mut session = Self {
            match_id,
            seed,
            local_slot,
            world,
            current_tick: 0,
            confirmed_tick: 0,
            history: VecDeque::with_capacity(ROLLBACK_MAX_FRAMES + 1),
            local_inputs: BTreeMap::new(),
            remote_inputs: BTreeMap::new(),
            last_remote_input: None,
        };

        session.history.push_back(HistoryFrame {
            tick: 0,
            world: session.world.clone(),
            inputs: [PlayerTickInput::default(), PlayerTickInput::default()],
            hash: initial_hash,
        });

        session
    }

    /// Feeds local player input for a given tick.
    pub fn queue_local_input(&mut self, input: PlayerTickInput) {
        self.local_inputs.insert(input.tick, input);
    }

    /// Receives remote opponent input from network wire.
    pub fn receive_remote_input(&mut self, input: PlayerTickInput) {
        self.last_remote_input = Some(input);
        self.remote_inputs.insert(input.tick, input);
    }

    /// Returns the active state hash for current simulation tick.
    #[must_use]
    pub fn current_state_hash(&self) -> u32 {
        self.world.state_hash()
    }

    /// Verifies if a remote hash matches the local history frame at `tick`.
    #[must_use]
    pub fn verify_hash_at_tick(&self, tick: u64, remote_hash: u32) -> bool {
        for frame in &self.history {
            if frame.tick == tick {
                return frame.hash == remote_hash;
            }
        }
        true
    }

    /// Advances the simulation by one tick, executing rollback if a past input arrived.
    pub fn advance_tick(&mut self) -> Result<u64, SessionError> {
        let next_tick = self.current_tick + 1;

        // Check if any remote input in queue is older than current_tick and needs rollback
        let earliest_pending_remote = self
            .remote_inputs
            .keys()
            .copied()
            .find(|&t| t <= self.current_tick && t > self.confirmed_tick);

        if let Some(rollback_tick) = earliest_pending_remote {
            self.execute_rollback(rollback_tick)?;
        }

        // Gather inputs for next_tick
        let local_input = self
            .local_inputs
            .get(&next_tick)
            .copied()
            .unwrap_or_else(|| PlayerTickInput {
                tick: next_tick,
                ..Default::default()
            });

        // If remote input for next_tick is not yet received, predict using last known remote input
        let remote_input = self.remote_inputs.get(&next_tick).copied().unwrap_or_else(|| {
            self.last_remote_input.map_or(
                PlayerTickInput {
                    tick: next_tick,
                    ..Default::default()
                },
                |last| PlayerTickInput {
                    tick: next_tick,
                    dx: last.dx,
                    dy: last.dy,
                    shoot: false, // do not predict action triggers
                    pass: false,
                    skill_id: None,
                },
            )
        });

        let (home_input, away_input) = match self.local_slot {
            PlayerSlot::Home | PlayerSlot::Home2 => (local_input, remote_input),
            PlayerSlot::Away | PlayerSlot::Away2 => (remote_input, local_input),
            PlayerSlot::Spectator => (local_input, remote_input),
        };

        // Feed inputs into world
        self.world.input = home_input.to_runtime_input();
        self.world.away_input = away_input.to_runtime_input();

        // Step simulation deterministically
        self.world.step(TICK_DT);
        self.current_tick = next_tick;

        let hash = self.world.state_hash();

        // Push to history buffer
        if self.history.len() >= ROLLBACK_MAX_FRAMES {
            self.history.pop_front();
        }
        self.history.push_back(HistoryFrame {
            tick: next_tick,
            world: self.world.clone(),
            inputs: [home_input, away_input],
            hash,
        });

        // Advance confirmed tick if both inputs are present
        if self.local_inputs.contains_key(&next_tick) && self.remote_inputs.contains_key(&next_tick) {
            self.confirmed_tick = next_tick;
        }

        Ok(self.current_tick)
    }

    /// Rewinds world state to `target_tick` and replays all inputs up to `current_tick`.
    fn execute_rollback(&mut self, target_tick: u64) -> Result<(), SessionError> {
        let frame_pos = self
            .history
            .iter()
            .position(|f| f.tick == target_tick.saturating_sub(1));

        let Some(pos) = frame_pos else {
            return Err(SessionError::RollbackDepthExceeded(
                self.current_tick.saturating_sub(target_tick),
            ));
        };

        // Restore snapshot from history
        let restored_world = self.history[pos].world.clone();
        self.world = restored_world;

        let replay_start = self.history[pos].tick + 1;
        let replay_end = self.current_tick;

        // Truncate history after restored position
        self.history.truncate(pos + 1);

        // Resimulate forward
        for t in replay_start..=replay_end {
            let local_in = self
                .local_inputs
                .get(&t)
                .copied()
                .unwrap_or(PlayerTickInput {
                    tick: t,
                    ..Default::default()
                });

            let remote_in = self
                .remote_inputs
                .get(&t)
                .copied()
                .unwrap_or(PlayerTickInput {
                    tick: t,
                    ..Default::default()
                });

            let (home_in, away_in) = match self.local_slot {
                PlayerSlot::Home | PlayerSlot::Home2 => (local_in, remote_in),
                PlayerSlot::Away | PlayerSlot::Away2 => (remote_in, local_in),
                PlayerSlot::Spectator => (local_in, remote_in),
            };

            self.world.input = home_in.to_runtime_input();
            self.world.away_input = away_in.to_runtime_input();
            self.world.step(TICK_DT);

            let hash = self.world.state_hash();
            self.history.push_back(HistoryFrame {
                tick: t,
                world: self.world.clone(),
                inputs: [home_in, away_in],
                hash,
            });
        }

        // A tick replayed with BOTH real inputs is confirmed, and saying so here is not an
        // optimisation — it is what stops the rollback from repeating. `advance_tick` looks for a
        // pending remote input with `t > confirmed_tick`; leaving `confirmed_tick` behind keeps the
        // oldest late packet eligible forever, so every following tick rolls back to it and replays
        // a window that only grows. Measured 2026-09-19 on the 11..=15 catch-up: `confirmed_tick`
        // stayed at 10 while `current_tick` reached 16, and the five-frame replay ran once per frame.
        while self.confirmed_tick < self.current_tick
            && self.local_inputs.contains_key(&(self.confirmed_tick + 1))
            && self.remote_inputs.contains_key(&(self.confirmed_tick + 1))
        {
            self.confirmed_tick += 1;
        }

        Ok(())
    }

    /// Applies authoritative server state correction.
    pub fn apply_state_correction(
        &mut self,
        _tick: u64,
        ball_pos: [f32; 3],
        ball_vel: [f32; 3],
        score: [u32; 2],
    ) {
        self.world.ball.pos = Vec3::new(ball_pos[0], ball_pos[1], ball_pos[2]);
        self.world.ball.vel = Vec3::new(ball_vel[0], ball_vel[1], ball_vel[2]);
        self.world.score = score;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_lockstep_deterministic_simulation() {
        let mut s1 = NetMatchSession::new("test_match".to_string(), 12345, PlayerSlot::Home);
        let mut s2 = NetMatchSession::new("test_match".to_string(), 12345, PlayerSlot::Away);

        assert_eq!(s1.current_state_hash(), s2.current_state_hash());

        for tick in 1..=60 {
            let in_p1 = PlayerTickInput {
                tick,
                dx: 1.0,
                dy: 0.0,
                shoot: false,
                pass: false,
                skill_id: None,
            };
            let in_p2 = PlayerTickInput {
                tick,
                dx: -1.0,
                dy: 0.0,
                shoot: false,
                pass: false,
                skill_id: None,
            };

            // Feed inputs across network
            s1.queue_local_input(in_p1);
            s1.receive_remote_input(in_p2);

            s2.queue_local_input(in_p2);
            s2.receive_remote_input(in_p1);

            s1.advance_tick().expect("s1 advance ok");
            s2.advance_tick().expect("s2 advance ok");

            assert_eq!(
                s1.current_state_hash(),
                s2.current_state_hash(),
                "hashes must match exactly at tick {tick}"
            );
        }
    }

    #[test]
    fn session_rollback_recovers_identical_state() {
        let mut s1 = NetMatchSession::new("test_rollback".to_string(), 999, PlayerSlot::Home);
        let mut s2 = NetMatchSession::new("test_rollback".to_string(), 999, PlayerSlot::Away);

        // Advance 10 ticks in sync
        for tick in 1..=10 {
            let in1 = PlayerTickInput { tick, dx: 0.5, dy: 0.5, ..Default::default() };
            let in2 = PlayerTickInput { tick, dx: -0.5, dy: -0.5, ..Default::default() };
            s1.queue_local_input(in1);
            s1.receive_remote_input(in2);
            s2.queue_local_input(in2);
            s2.receive_remote_input(in1);
            s1.advance_tick().unwrap();
            s2.advance_tick().unwrap();
        }

        // Now simulate latency: s1 advances 5 ticks without receiving s2's inputs yet (prediction mode)
        for tick in 11..=15 {
            let in1 = PlayerTickInput { tick, dx: 0.2, dy: 0.8, ..Default::default() };
            s1.queue_local_input(in1);
            s1.advance_tick().unwrap();
        }

        // Later, s2's delayed inputs for ticks 11..=15 arrive at s1
        for tick in 11..=15 {
            let in2 = PlayerTickInput { tick, dx: -0.8, dy: -0.2, ..Default::default() };
            s1.receive_remote_input(in2);
            s2.queue_local_input(in2);
            let in1 = PlayerTickInput { tick, dx: 0.2, dy: 0.8, ..Default::default() };
            s2.receive_remote_input(in1);
            s2.advance_tick().unwrap();
        }

        // s1 triggers rollback and catches up
        s1.advance_tick().unwrap();

        // What rollback owes is the RECONCILED PAST, and that is what is asserted here.
        //
        // The obvious assertion — comparing `current_state_hash()` on both sessions — is wrong, and
        // wrong in a way that looks like a netcode bug. After this point s1 sits on tick 16, for
        // which NEITHER session has any input: each one predicts its opponent by repeating that
        // opponent's last known input, so s1 steps tick 16 with away = (-0.8, -0.2) and s2 with
        // home = (0.2, 0.8). Two different worlds, both correct. Predicted frames are allowed to
        // diverge; that is the whole reason rollback exists. Only a frame whose two inputs are both
        // real is required to agree.
        for tick in [10_u64, 14, 15] {
            let expected = s2
                .history
                .iter()
                .find(|frame| frame.tick == tick)
                .expect("s2 keeps the frame it simulated")
                .hash;
            assert!(
                s1.verify_hash_at_tick(tick, expected),
                "state hash must be identical after rollback, at tick {tick}"
            );
        }

        // And the rollback must not be doomed to repeat: once 11..=15 are replayed with both real
        // inputs, they are confirmed. Left at 10, the oldest late packet stays eligible and every
        // subsequent tick rolls back to it again.
        assert_eq!(s1.confirmed_tick, 15, "replayed ticks must become confirmed");
    }
}
