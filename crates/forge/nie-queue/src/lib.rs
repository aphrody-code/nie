//! Deduplicated breadth-first frontiers for the niers reverse-engineering loop.
//!
//! [`MemoryFrontier`] provides a deterministic, bounded planner that is portable to WebAssembly.
//! With the default `host` feature, [`Frontier`] preserves the shared Redis frontier used by
//! parallel native workers.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

use std::collections::{HashSet, VecDeque};
use std::fmt;

#[cfg(feature = "host")]
use redis::{Commands, RedisError};
#[cfg(feature = "host")]
use thiserror::Error;

/// Validated resource limits for an in-memory frontier.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrontierLimits {
    max_pending: usize,
    max_seen: usize,
    max_batch: usize,
}

impl FrontierLimits {
    /// Creates non-zero limits for pending work, deduplication history and batch input.
    ///
    /// # Errors
    ///
    /// Returns [`MemoryFrontierError::ZeroLimit`] when any limit is zero.
    pub fn new(
        max_pending: usize,
        max_seen: usize,
        max_batch: usize,
    ) -> std::result::Result<Self, MemoryFrontierError> {
        for (name, value) in [
            ("max_pending", max_pending),
            ("max_seen", max_seen),
            ("max_batch", max_batch),
        ] {
            if value == 0 {
                return Err(MemoryFrontierError::ZeroLimit(name));
            }
        }

        Ok(Self {
            max_pending,
            max_seen,
            max_batch,
        })
    }

    /// Maximum number of addresses waiting in the FIFO queue.
    #[must_use]
    pub const fn max_pending(self) -> usize {
        self.max_pending
    }

    /// Maximum number of addresses retained in the deduplication history.
    #[must_use]
    pub const fn max_seen(self) -> usize {
        self.max_seen
    }

    /// Maximum number of addresses accepted by one [`MemoryFrontier::push_many`] call.
    #[must_use]
    pub const fn max_batch(self) -> usize {
        self.max_batch
    }
}

impl Default for FrontierLimits {
    fn default() -> Self {
        Self {
            max_pending: 4_096,
            max_seen: 65_536,
            max_batch: 1_024,
        }
    }
}

/// A validation failure that leaves the in-memory frontier unchanged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemoryFrontierError {
    /// A configured limit must be at least one.
    ZeroLimit(&'static str),
    /// A batch exceeded its configured input cap.
    BatchTooLarge {
        /// Number of supplied addresses.
        supplied: usize,
        /// Maximum accepted number of addresses.
        maximum: usize,
    },
}

impl fmt::Display for MemoryFrontierError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroLimit(name) => write!(formatter, "{name} must be at least one"),
            Self::BatchTooLarge { supplied, maximum } => {
                write!(
                    formatter,
                    "batch contains {supplied} addresses, exceeding the limit of {maximum}"
                )
            }
        }
    }
}

impl std::error::Error for MemoryFrontierError {}

/// Result of attempting to add one address to a [`MemoryFrontier`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PushOutcome {
    /// The address was new and was appended to the FIFO queue.
    Added,
    /// The address had already been accepted, even if it was previously popped.
    Duplicate,
    /// The pending queue was full. The address was not marked as seen and may be retried.
    PendingLimitReached,
    /// The persistent deduplication history was full. The address was not accepted.
    SeenLimitReached,
}

/// Aggregate results from a bounded batch insertion.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PushReport {
    /// Addresses appended to the pending FIFO queue.
    pub added: usize,
    /// Addresses rejected because they had already been accepted.
    pub duplicates: usize,
    /// New addresses rejected because the pending queue was full.
    pub pending_limit_reached: usize,
    /// New addresses rejected because the seen history was full.
    pub seen_limit_reached: usize,
}

impl PushReport {
    fn record(&mut self, outcome: PushOutcome) {
        match outcome {
            PushOutcome::Added => self.added += 1,
            PushOutcome::Duplicate => self.duplicates += 1,
            PushOutcome::PendingLimitReached => self.pending_limit_reached += 1,
            PushOutcome::SeenLimitReached => self.seen_limit_reached += 1,
        }
    }
}

/// Deterministic, bounded FIFO frontier with persistent address deduplication.
///
/// Popping an address removes it from pending work but deliberately retains it in `seen`, so a
/// later call cannot schedule the same address twice. Capacity-rejected addresses are not marked
/// as seen and can be retried after pending capacity becomes available.
#[derive(Clone, Debug)]
pub struct MemoryFrontier {
    pending: VecDeque<i64>,
    seen: HashSet<i64>,
    limits: FrontierLimits,
}

impl MemoryFrontier {
    /// Creates an empty frontier with validated limits.
    #[must_use]
    pub fn new(limits: FrontierLimits) -> Self {
        Self {
            pending: VecDeque::with_capacity(limits.max_pending.min(256)),
            seen: HashSet::with_capacity(limits.max_seen.min(256)),
            limits,
        }
    }

    /// Returns the active resource limits.
    #[must_use]
    pub const fn limits(&self) -> FrontierLimits {
        self.limits
    }

    /// Appends an address if it is new and both capacity limits permit it.
    pub fn push(&mut self, address: i64) -> PushOutcome {
        if self.seen.contains(&address) {
            return PushOutcome::Duplicate;
        }
        if self.seen.len() == self.limits.max_seen {
            return PushOutcome::SeenLimitReached;
        }
        if self.pending.len() == self.limits.max_pending {
            return PushOutcome::PendingLimitReached;
        }

        let inserted = self.seen.insert(address);
        debug_assert!(inserted, "the duplicate check must precede insertion");
        self.pending.push_back(address);
        PushOutcome::Added
    }

    /// Appends a bounded batch in input order and reports every outcome category.
    ///
    /// The batch-size check is atomic: an oversized input returns an error before any address is
    /// inspected or inserted. A valid batch is processed sequentially, making both FIFO order and
    /// capacity rejection deterministic.
    ///
    /// # Errors
    ///
    /// Returns [`MemoryFrontierError::BatchTooLarge`] if `addresses` exceeds `max_batch`.
    pub fn push_many(
        &mut self,
        addresses: &[i64],
    ) -> std::result::Result<PushReport, MemoryFrontierError> {
        if addresses.len() > self.limits.max_batch {
            return Err(MemoryFrontierError::BatchTooLarge {
                supplied: addresses.len(),
                maximum: self.limits.max_batch,
            });
        }

        let mut report = PushReport::default();
        for &address in addresses {
            report.record(self.push(address));
        }
        Ok(report)
    }

    /// Removes and returns the oldest pending address.
    pub fn pop(&mut self) -> Option<i64> {
        self.pending.pop_front()
    }

    /// Returns pending addresses in exact FIFO order without copying them.
    pub fn pending(&self) -> impl ExactSizeIterator<Item = i64> + '_ {
        self.pending.iter().copied()
    }

    /// Returns the number of pending addresses.
    #[must_use]
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    /// Returns whether there is no pending work.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Returns the number of addresses retained for deduplication.
    #[must_use]
    pub fn seen_count(&self) -> usize {
        self.seen.len()
    }

    /// Returns whether an address was previously accepted.
    #[must_use]
    pub fn has_seen(&self, address: i64) -> bool {
        self.seen.contains(&address)
    }

    /// Clears pending work and deduplication history while retaining the configured limits.
    pub fn reset(&mut self) {
        self.pending.clear();
        self.seen.clear();
    }
}

impl Default for MemoryFrontier {
    fn default() -> Self {
        Self::new(FrontierLimits::default())
    }
}

#[cfg(feature = "host")]
#[derive(Debug, Error)]
pub enum QueueError {
    /// Redis connection or command failure.
    #[error("redis: {0}")]
    Redis(#[from] RedisError),
}

#[cfg(feature = "host")]
pub type Result<T> = std::result::Result<T, QueueError>;

/// Shared Redis BFS frontier for one binary (key prefix: `niers:<binary>`).
#[cfg(feature = "host")]
pub struct Frontier {
    conn: redis::Connection,
    seen_key: String,
    list_key: String,
}

#[cfg(feature = "host")]
impl Frontier {
    /// Connects to Redis and selects the key namespace for `tag`, such as a short binary hash.
    pub fn connect(url: &str, tag: &str) -> Result<Self> {
        let client = redis::Client::open(url)?;
        let conn = client.get_connection()?;
        Ok(Self {
            conn,
            seen_key: format!("niers:{tag}:seen"),
            list_key: format!("niers:{tag}:frontier"),
        })
    }

    /// Appends an address if it has never been seen.
    pub fn push(&mut self, addr: i64) -> Result<bool> {
        let added: i64 = self.conn.sadd(&self.seen_key, addr)?;
        if added == 1 {
            let _: i64 = self.conn.rpush(&self.list_key, addr)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Appends a batch and returns the number of newly accepted addresses.
    pub fn push_many(&mut self, addrs: &[i64]) -> Result<usize> {
        let mut n = 0;
        for &a in addrs {
            if self.push(a)? {
                n += 1;
            }
        }
        Ok(n)
    }

    /// Removes the next address in FIFO order, or returns `None` when empty.
    pub fn pop(&mut self) -> Result<Option<i64>> {
        let v: Option<i64> = self.conn.lpop(&self.list_key, None)?;
        Ok(v)
    }

    /// Returns the number of pending addresses.
    pub fn len(&mut self) -> Result<usize> {
        let n: usize = self.conn.llen(&self.list_key)?;
        Ok(n)
    }

    /// Returns whether no addresses are pending.
    pub fn is_empty(&mut self) -> Result<bool> {
        Ok(self.len()? == 0)
    }

    /// Returns the number of addresses seen across pending and completed work.
    pub fn seen_count(&mut self) -> Result<usize> {
        let n: usize = self.conn.scard(&self.seen_key)?;
        Ok(n)
    }

    /// Clears both the pending queue and deduplication set for this binary.
    pub fn reset(&mut self) -> Result<()> {
        let _: i64 = self
            .conn
            .del(&[self.seen_key.clone(), self.list_key.clone()])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{FrontierLimits, MemoryFrontier, MemoryFrontierError, PushOutcome, PushReport};

    fn limits(max_pending: usize, max_seen: usize, max_batch: usize) -> FrontierLimits {
        FrontierLimits::new(max_pending, max_seen, max_batch).expect("valid test limits")
    }

    #[test]
    fn preserves_fifo_order_and_deduplicates_across_pop() {
        let mut frontier = MemoryFrontier::new(limits(4, 8, 8));

        assert_eq!(
            frontier.push_many(&[0x30, 0x10, 0x30, 0x20]),
            Ok(PushReport {
                added: 3,
                duplicates: 1,
                pending_limit_reached: 0,
                seen_limit_reached: 0,
            })
        );
        assert_eq!(frontier.pending().collect::<Vec<_>>(), [0x30, 0x10, 0x20]);
        assert_eq!(frontier.pop(), Some(0x30));
        assert_eq!(frontier.push(0x30), PushOutcome::Duplicate);
        assert_eq!(frontier.pending().collect::<Vec<_>>(), [0x10, 0x20]);
        assert_eq!(frontier.seen_count(), 3);
    }

    #[test]
    fn pending_rejection_can_be_retried_after_pop() {
        let mut frontier = MemoryFrontier::new(limits(2, 4, 4));

        assert_eq!(frontier.push(1), PushOutcome::Added);
        assert_eq!(frontier.push(2), PushOutcome::Added);
        assert_eq!(frontier.push(3), PushOutcome::PendingLimitReached);
        assert!(!frontier.has_seen(3));
        assert_eq!(frontier.pop(), Some(1));
        assert_eq!(frontier.push(3), PushOutcome::Added);
        assert_eq!(frontier.pending().collect::<Vec<_>>(), [2, 3]);
    }

    #[test]
    fn seen_capacity_is_permanent_until_reset() {
        let mut frontier = MemoryFrontier::new(limits(2, 2, 4));

        assert_eq!(
            frontier.push_many(&[7, 8]),
            Ok(PushReport {
                added: 2,
                duplicates: 0,
                pending_limit_reached: 0,
                seen_limit_reached: 0,
            })
        );
        assert_eq!(frontier.pop(), Some(7));
        assert_eq!(frontier.push(9), PushOutcome::SeenLimitReached);
        assert_eq!(frontier.push(7), PushOutcome::Duplicate);

        frontier.reset();
        assert!(frontier.is_empty());
        assert_eq!(frontier.seen_count(), 0);
        assert_eq!(frontier.push(9), PushOutcome::Added);
    }

    #[test]
    fn oversized_batch_is_rejected_without_mutation() {
        let mut frontier = MemoryFrontier::new(limits(4, 8, 2));
        assert_eq!(frontier.push(5), PushOutcome::Added);

        assert_eq!(
            frontier.push_many(&[6, 7, 8]),
            Err(MemoryFrontierError::BatchTooLarge {
                supplied: 3,
                maximum: 2,
            })
        );
        assert_eq!(frontier.pending().collect::<Vec<_>>(), [5]);
        assert_eq!(frontier.seen_count(), 1);
    }

    #[test]
    fn rejects_zero_limits() {
        assert_eq!(
            FrontierLimits::new(0, 1, 1),
            Err(MemoryFrontierError::ZeroLimit("max_pending"))
        );
        assert_eq!(
            FrontierLimits::new(1, 0, 1),
            Err(MemoryFrontierError::ZeroLimit("max_seen"))
        );
        assert_eq!(
            FrontierLimits::new(1, 1, 0),
            Err(MemoryFrontierError::ZeroLimit("max_batch"))
        );
    }
}
