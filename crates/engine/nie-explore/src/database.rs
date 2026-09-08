//! Compatibility facade for the former `nie-explore` SQLite registry.
//!
//! Shared database ownership lives in `nie-sql`; this module keeps Inacord's
//! existing import paths stable while downstream callers migrate deliberately.

pub use nie_sql::{DatabaseRegistry, ExecuteResult, Migration};
