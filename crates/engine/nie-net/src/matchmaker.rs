//! Automated matchmaking queue for Casual and Ranked online play.
//!
//! Pairs players based on skill rating (rank points / MMR) with expanding delta windows over time.

use crate::protocol::MatchMode;

/// An active player waiting in the matchmaking queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueueTicket {
    pub player_id: String,
    pub player_name: String,
    pub mode: MatchMode,
    pub rank_points: u32,
    pub wait_ticks: u32,
}

/// Match pair found by the matchmaker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatchFound {
    pub player_home: QueueTicket,
    pub player_away: QueueTicket,
    pub seed: u64,
}

/// In-memory matchmaking queue.
#[derive(Debug, Default)]
pub struct MatchmakingQueue {
    pub tickets: Vec<QueueTicket>,
    seed_generator: u64,
}

impl MatchmakingQueue {
    /// Creates an empty queue.
    #[must_use]
    pub fn new() -> Self {
        Self {
            tickets: Vec::new(),
            seed_generator: 777_000,
        }
    }

    /// Enqueues a player ticket into matchmaking.
    pub fn enqueue(&mut self, ticket: QueueTicket) {
        // Prevent duplicate entries
        if !self.tickets.iter().any(|t| t.player_id == ticket.player_id) {
            self.tickets.push(ticket);
        }
    }

    /// Removes a player ticket from queue (canceled by user).
    pub fn cancel(&mut self, player_id: &str) -> bool {
        let initial_len = self.tickets.len();
        self.tickets.retain(|t| t.player_id != player_id);
        self.tickets.len() < initial_len
    }

    /// Ticks the matchmaking queue, expanding search windows and extracting paired matches.
    pub fn poll_matches(&mut self) -> Vec<MatchFound> {
        // Increment wait ticks
        for ticket in &mut self.tickets {
            ticket.wait_ticks += 1;
        }

        let mut matches = Vec::new();
        let mut matched_indices = std::collections::HashSet::new();

        let count = self.tickets.len();
        for i in 0..count {
            if matched_indices.contains(&i) {
                continue;
            }
            for j in (i + 1)..count {
                if matched_indices.contains(&j) {
                    continue;
                }

                let t1 = &self.tickets[i];
                let t2 = &self.tickets[j];

                if t1.mode != t2.mode {
                    continue;
                }

                // Base acceptable rating delta is 150 points, expanding by 25 points per 10 wait ticks
                let max_wait = t1.wait_ticks.max(t2.wait_ticks);
                let allowed_delta = 150 + (max_wait / 10) * 25;
                let rating_delta = t1.rank_points.abs_diff(t2.rank_points);

                if rating_delta <= allowed_delta {
                    self.seed_generator = self.seed_generator.wrapping_add(1);
                    matches.push(MatchFound {
                        player_home: t1.clone(),
                        player_away: t2.clone(),
                        seed: self.seed_generator,
                    });
                    matched_indices.insert(i);
                    matched_indices.insert(j);
                    break;
                }
            }
        }

        if !matched_indices.is_empty() {
            let mut i = 0;
            self.tickets.retain(|_| {
                let keep = !matched_indices.contains(&i);
                i += 1;
                keep
            });
        }

        matches
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matchmaking_pairs_closest_rank() {
        let mut q = MatchmakingQueue::new();

        q.enqueue(QueueTicket {
            player_id: "p1".to_string(),
            player_name: "Jude Sharp".to_string(),
            mode: MatchMode::Ranked,
            rank_points: 1200,
            wait_ticks: 0,
        });

        q.enqueue(QueueTicket {
            player_id: "p2".to_string(),
            player_name: "Shawn Froste".to_string(),
            mode: MatchMode::Ranked,
            rank_points: 1250,
            wait_ticks: 0,
        });

        let found = q.poll_matches();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].player_home.player_id, "p1");
        assert_eq!(found[0].player_away.player_id, "p2");
        assert!(q.tickets.is_empty());
    }
}
