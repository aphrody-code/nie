//! One read-only SQL contract for local SQLite mirrors and PostgreSQL services.
//!
//! The crate intentionally owns neither schemas nor migrations.  A host passes an
//! explicit database URL and a query that has been accepted as read-only.  SQLite
//! is implemented with a read-only file handle.  PostgreSQL URLs are parsed by the
//! same contract, but connecting them is rejected until the workspace adopts one
//! reviewed PostgreSQL driver; silently emulating PostgreSQL through SQLite would
//! make source and dialect errors invisible.

#![forbid(unsafe_code)]

use rusqlite::{
    Connection, OpenFlags, params_from_iter,
    types::{Value as SqliteValue, ValueRef},
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use thiserror::Error;

/// The database families accepted by the shared configuration contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Backend {
    Sqlite,
    PostgreSql,
}

/// A parsed database location. The original URL is retained only in-process; error
/// messages refer to its backend and never echo credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DatabaseUrl {
    Sqlite { path: PathBuf },
    PostgreSql { url: String },
}

impl DatabaseUrl {
    pub fn parse(value: &str) -> Result<Self, SqlError> {
        if let Some(path) = value.strip_prefix("sqlite:") {
            let path = path.strip_prefix("//").unwrap_or(path);
            if path.is_empty() || path == ":memory:" || path.contains('\0') {
                return Err(SqlError::InvalidUrl("SQLite URL must name a database file"));
            }
            return Ok(Self::Sqlite {
                path: PathBuf::from(path),
            });
        }
        if value.starts_with("postgres://") || value.starts_with("postgresql://") {
            let authority = value
                .split_once("://")
                .map(|(_, rest)| rest)
                .unwrap_or_default();
            if authority.is_empty() || !authority.contains('/') {
                return Err(SqlError::InvalidUrl(
                    "PostgreSQL URL must include host and database",
                ));
            }
            return Ok(Self::PostgreSql {
                url: value.to_owned(),
            });
        }
        Err(SqlError::InvalidUrl(
            "expected sqlite:, postgres://, or postgresql:// URL",
        ))
    }

    pub fn backend(&self) -> Backend {
        match self {
            Self::Sqlite { .. } => Backend::Sqlite,
            Self::PostgreSql { .. } => Backend::PostgreSql,
        }
    }
}

/// Values exchanged through the portable query contract.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Value {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Row {
    pub columns: Vec<String>,
    pub values: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QueryResult {
    pub rows: Vec<Row>,
}

/// A query whose text has passed the conservative shared read-only policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadQuery(String);

impl ReadQuery {
    pub fn parse(sql: impl Into<String>) -> Result<Self, SqlError> {
        let sql = sql.into();
        let normalized = normalize_sql(&sql);
        let first = normalized.split_whitespace().next().unwrap_or_default();
        if !matches!(first, "select" | "with" | "explain") {
            return Err(SqlError::NotReadOnly);
        }
        if normalized.contains(';') || contains_write_keyword(&normalized) {
            return Err(SqlError::NotReadOnly);
        }
        Ok(Self(sql))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Common synchronous, bounded-by-caller read path. Hosts own connection pooling.
pub trait ReadOnlyDatabase {
    fn backend(&self) -> Backend;
    fn query(&self, query: &ReadQuery, parameters: &[Value]) -> Result<QueryResult, SqlError>;
}

/// Opens an existing SQLite database with the operating system's read-only mode.
pub struct SqliteReadOnly {
    connection: Connection,
}

impl SqliteReadOnly {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SqlError> {
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_secs(5))?;
        Ok(Self { connection })
    }
}

impl ReadOnlyDatabase for SqliteReadOnly {
    fn backend(&self) -> Backend {
        Backend::Sqlite
    }

    fn query(&self, query: &ReadQuery, parameters: &[Value]) -> Result<QueryResult, SqlError> {
        let values = parameters
            .iter()
            .map(sqlite_parameter)
            .collect::<Result<Vec<_>, _>>()?;
        let mut statement = self.connection.prepare(query.as_str())?;
        let columns = statement
            .column_names()
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let mut rows = statement.query(params_from_iter(values.iter()))?;
        let mut output = Vec::new();
        while let Some(row) = rows.next()? {
            let values = (0..columns.len())
                .map(|index| sqlite_value(row.get_ref(index)?))
                .collect::<Result<Vec<_>, SqlError>>()?;
            output.push(Row {
                columns: columns.clone(),
                values,
            });
        }
        Ok(QueryResult { rows: output })
    }
}

/// Opens the selected backend. PostgreSQL selection is deliberate and visible even
/// before its driver is added to the workspace.
pub fn open_read_only(url: &DatabaseUrl) -> Result<Box<dyn ReadOnlyDatabase>, SqlError> {
    match url {
        DatabaseUrl::Sqlite { path } => Ok(Box::new(SqliteReadOnly::open(path)?)),
        DatabaseUrl::PostgreSql { .. } => Err(SqlError::DriverUnavailable {
            backend: Backend::PostgreSql,
        }),
    }
}

#[derive(Debug, Error)]
pub enum SqlError {
    #[error("invalid database URL: {0}")]
    InvalidUrl(&'static str),
    #[error("query is not read-only")]
    NotReadOnly,
    #[error("{backend:?} driver is not enabled in this workspace")]
    DriverUnavailable { backend: Backend },
    #[error("SQLite error")]
    Sqlite(#[from] rusqlite::Error),
    #[error("binary query parameters are unsupported by SQLite bindings")]
    BlobParameterUnsupported,
}

fn sqlite_parameter(value: &Value) -> Result<SqliteValue, SqlError> {
    Ok(match value {
        Value::Null => SqliteValue::Null,
        Value::Integer(value) => SqliteValue::Integer(*value),
        Value::Real(value) => SqliteValue::Real(*value),
        Value::Text(value) => SqliteValue::Text(value.clone()),
        Value::Blob(_) => return Err(SqlError::BlobParameterUnsupported),
    })
}

fn sqlite_value(value: ValueRef<'_>) -> Result<Value, SqlError> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::Integer(value),
        ValueRef::Real(value) => Value::Real(value),
        ValueRef::Text(value) => Value::Text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Blob(value.to_vec()),
    })
}

fn normalize_sql(sql: &str) -> String {
    let mut output = String::with_capacity(sql.len());
    for line in sql.lines() {
        let line = line.split_once("--").map_or(line, |(prefix, _)| prefix);
        output.push_str(line);
        output.push(' ');
    }
    output.to_ascii_lowercase()
}

fn contains_write_keyword(sql: &str) -> bool {
    const FORBIDDEN: &[&str] = &[
        "insert", "update", "delete", "replace", "create", "alter", "drop", "attach", "detach",
        "vacuum", "pragma", "reindex", "analyze", "grant", "revoke", "copy", "truncate",
    ];
    sql.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| FORBIDDEN.contains(&token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn parses_backend_urls_without_accepting_memory_sqlite() {
        assert_eq!(
            DatabaseUrl::parse("sqlite:var/inagle.sqlite")
                .unwrap()
                .backend(),
            Backend::Sqlite
        );
        assert_eq!(
            DatabaseUrl::parse("postgresql://host/game")
                .unwrap()
                .backend(),
            Backend::PostgreSql
        );
        assert!(DatabaseUrl::parse("sqlite::memory:").is_err());
        assert!(DatabaseUrl::parse("mysql://host/game").is_err());
    }

    #[test]
    fn policy_rejects_mutations_and_multiple_statements() {
        assert!(ReadQuery::parse("SELECT id FROM characters").is_ok());
        assert!(ReadQuery::parse("WITH c AS (SELECT 1) SELECT * FROM c").is_ok());
        for sql in [
            "DELETE FROM characters",
            "SELECT 1; SELECT 2",
            "WITH c AS (DELETE FROM c) SELECT * FROM c",
        ] {
            assert!(
                matches!(ReadQuery::parse(sql), Err(SqlError::NotReadOnly)),
                "{sql}"
            );
        }
    }

    #[test]
    fn sqlite_query_is_parameterized_and_connection_cannot_write() {
        let file = NamedTempFile::new().unwrap();
        let write = Connection::open(file.path()).unwrap();
        write.execute_batch("CREATE TABLE character (id INTEGER, name TEXT); INSERT INTO character VALUES (7, 'Endou');").unwrap();
        drop(write);

        let database = SqliteReadOnly::open(file.path()).unwrap();
        let result = database
            .query(
                &ReadQuery::parse("SELECT id, name FROM character WHERE id = ?1").unwrap(),
                &[Value::Integer(7)],
            )
            .unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].columns, ["id", "name"]);
        assert_eq!(
            result.rows[0].values,
            [Value::Integer(7), Value::Text("Endou".into())]
        );
        assert!(
            database
                .connection
                .execute("INSERT INTO character VALUES (8, 'Gouenji')", [])
                .is_err()
        );
    }

    #[test]
    fn postgres_selection_is_visible_until_a_driver_is_adopted() {
        let url = DatabaseUrl::parse("postgres://localhost/inagle").unwrap();
        assert!(matches!(
            open_read_only(&url),
            Err(SqlError::DriverUnavailable {
                backend: Backend::PostgreSql
            })
        ));
    }
}
