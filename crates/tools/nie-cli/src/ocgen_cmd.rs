//! `niers ocgen` — thin binding onto [`nie_ocgen::cli`].
//!
//! The command lives in the library so the standalone `nie-ocgen` binary and this sub-command run
//! the same code. Anything added here rather than there is a second implementation waiting to
//! drift.

pub use nie_ocgen::cli::OcgenCmd;

/// Runs one `ocgen` sub-command.
///
/// # Errors
///
/// Propagates the pipeline stage that failed.
pub fn run(op: &OcgenCmd) -> anyhow::Result<()> {
    nie_ocgen::cli::run(op).map_err(Into::into)
}
