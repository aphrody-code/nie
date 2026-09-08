//! PostgreSQL migration history for trusted server-side callers.
//!
//! Migration SQL is deliberately backend-specific.  Callers that keep a local
//! SQLite mirror and a PostgreSQL service must provide one [`Migration`] per
//! backend, even where their DDL happens to be identical.  This prevents a
//! SQLite-only construct from being presented as portable schema SQL.

use sha2::{Digest, Sha384};
use std::time::Instant;
use thiserror::Error;
use tokio_postgres::Client;

const HISTORY_TABLE: &str = "_sqlx_migrations";

/// A PostgreSQL migration owned by a trusted server process.
///
/// This intentionally does not reuse the SQLite [`crate::Migration`] shape:
/// `sql` is a database dialect contract, not generic text.  Versions share the
/// SQLx-compatible history table semantics with the local registry.
#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

/// The preflight result is public so hosts can present a dry migration plan
/// without opening a transaction or applying DDL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedMigration {
    pub version: i64,
    pub description: &'static str,
    pub checksum: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum MigrationError {
    #[error("duplicate migration version")]
    DuplicateVersion,
    #[error("database has an unfinished migration")]
    DirtyHistory,
    #[error("database contains a migration unavailable to this application")]
    UnknownAppliedMigration,
    #[error("migration {version} checksum differs from recorded SQL")]
    ChecksumMismatch { version: i64 },
    #[error("PostgreSQL error")]
    PostgreSql(#[from] tokio_postgres::Error),
}

/// Sort and validate a backend-specific migration manifest.
///
/// This has no database dependency, allowing hosts to reject duplicate input
/// before they acquire a privileged PostgreSQL connection.
pub fn plan(migrations: &[Migration]) -> Result<Vec<PlannedMigration>, MigrationError> {
    let mut migrations = migrations.to_vec();
    migrations.sort_by_key(|migration| migration.version);
    if migrations
        .windows(2)
        .any(|pair| pair[0].version == pair[1].version)
    {
        return Err(MigrationError::DuplicateVersion);
    }
    Ok(migrations
        .into_iter()
        .map(|migration| PlannedMigration {
            version: migration.version,
            description: migration.description,
            checksum: checksum(migration.sql),
        })
        .collect())
}

/// Apply a PostgreSQL migration manifest using SQLx-compatible history.
///
/// The caller supplies a normal writable `tokio-postgres` client.  This API is
/// intentionally separate from `PostgresReadOnly`: an HTTP handler, CLI, or
/// desktop binding must not gain schema-write authority merely by using the
/// query service.  The function never creates databases, starts services,
/// pushes data, or performs backups.
pub async fn migrate(client: &mut Client, migrations: &[Migration]) -> Result<(), MigrationError> {
    let plan = plan(migrations)?;
    if plan.is_empty() {
        return Ok(());
    }

    client
        .batch_execute(&format!(
            "CREATE TABLE IF NOT EXISTS {HISTORY_TABLE} (\
             version BIGINT PRIMARY KEY, \
             description TEXT NOT NULL, \
             installed_on TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, \
             success BOOLEAN NOT NULL, \
             checksum BYTEA NOT NULL, \
             execution_time BIGINT NOT NULL)"
        ))
        .await?;

    let dirty = client
        .query_opt(
            &format!("SELECT version FROM {HISTORY_TABLE} WHERE success = FALSE LIMIT 1"),
            &[],
        )
        .await?;
    if dirty.is_some() {
        return Err(MigrationError::DirtyHistory);
    }

    let applied = client
        .query(
            &format!("SELECT version, checksum FROM {HISTORY_TABLE}"),
            &[],
        )
        .await?;
    for row in &applied {
        let version = row.try_get::<_, i64>(0)?;
        let Some(expected) = plan.iter().find(|migration| migration.version == version) else {
            return Err(MigrationError::UnknownAppliedMigration);
        };
        let recorded = row.try_get::<_, Vec<u8>>(1)?;
        if recorded != expected.checksum {
            return Err(MigrationError::ChecksumMismatch { version });
        }
    }

    for migration in plan {
        if applied
            .iter()
            .any(|row| row.try_get::<_, i64>(0).ok() == Some(migration.version))
        {
            continue;
        }
        let source = migrations
            .iter()
            .find(|candidate| candidate.version == migration.version)
            .expect("validated migration manifest must retain every version");
        let transaction = client.transaction().await?;
        let started = Instant::now();
        transaction.batch_execute(source.sql).await?;
        let execution_time = i64::try_from(started.elapsed().as_nanos()).unwrap_or(i64::MAX);
        transaction
            .execute(
                &format!(
                    "INSERT INTO {HISTORY_TABLE} \
                     (version, description, success, checksum, execution_time) \
                     VALUES ($1, $2, TRUE, $3, $4)"
                ),
                &[
                    &migration.version,
                    &migration.description,
                    &migration.checksum,
                    &execution_time,
                ],
            )
            .await?;
        transaction.commit().await?;
    }
    Ok(())
}

fn checksum(sql: &str) -> Vec<u8> {
    Sha384::digest(sql.as_bytes()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_orders_versions_and_uses_sql_as_the_checksum_source() {
        let migrations = [
            Migration {
                version: 20,
                description: "later",
                sql: "CREATE TABLE later(id BIGINT)",
            },
            Migration {
                version: 10,
                description: "first",
                sql: "CREATE TABLE first(id BIGINT)",
            },
        ];
        let plan = plan(&migrations).unwrap();
        assert_eq!(
            plan.iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>(),
            [10, 20]
        );
        assert_ne!(plan[0].checksum, plan[1].checksum);
    }

    #[test]
    fn plan_rejects_duplicate_versions_before_database_access() {
        let migrations = [
            Migration {
                version: 1,
                description: "a",
                sql: "SELECT 1",
            },
            Migration {
                version: 1,
                description: "b",
                sql: "SELECT 2",
            },
        ];
        assert!(matches!(
            plan(&migrations),
            Err(MigrationError::DuplicateVersion)
        ));
    }
}
