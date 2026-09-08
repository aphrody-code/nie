//! One read-only SQL contract for local SQLite mirrors and PostgreSQL services.
//!
//! The crate owns reusable migration runners but never a product schema. A host
//! supplies its explicit schema migrations and database URL; read callers supply
//! a query that has already been accepted as read-only. SQLite uses a read-only
//! file handle and PostgreSQL uses a parameterized, asynchronous `tokio-postgres`
//! client whose session is marked read-only by the server.

#![forbid(unsafe_code)]

pub mod sqlite_registry;
pub use sqlite_registry::{DatabaseRegistry, ExecuteResult, Migration};

/// PostgreSQL-only writable migration service.  Its migration SQL is explicit
/// about the backend, while [`Migration`] remains the established SQLite
/// registry contract used by native hosts.
pub mod postgres_migrations;

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
use tokio_postgres::{
    Client, NoTls,
    types::{IsNull, ToSql, Type},
};

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
    Boolean(bool),
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

/// A PostgreSQL connection whose server session rejects write transactions.
///
/// The caller must run this on a Tokio runtime. Its default connector uses the
/// platform certificate store and verifies the server certificate. A separate
/// explicit constructor exists for trusted local development databases without
/// TLS.
pub struct PostgresReadOnly {
    client: Client,
}

impl PostgresReadOnly {
    /// Connects with platform-trusted TLS and marks this session as read-only
    /// at the server. PostgreSQL therefore supplies a second write barrier in
    /// addition to [`ReadQuery`].
    pub async fn connect(url: &str) -> Result<Self, SqlError> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (tls, _warnings) = tokio_postgres_rustls::MakeRustlsConnect::with_native_certs()
            .map_err(|_| SqlError::NativeCertificateStore)?;
        let (client, connection) = tokio_postgres::connect(url, tls).await?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
            .batch_execute("SET default_transaction_read_only = on")
            .await?;
        Ok(Self { client })
    }

    /// Connects without TLS for a loopback or otherwise trusted development
    /// database. Remote PostgreSQL services should use [`Self::connect`].
    pub async fn connect_insecure(url: &str) -> Result<Self, SqlError> {
        let (client, connection) = tokio_postgres::connect(url, NoTls).await?;
        tokio::spawn(async move {
            let _ = connection.await;
        });
        client
            .batch_execute("SET default_transaction_read_only = on")
            .await?;
        Ok(Self { client })
    }

    pub fn backend(&self) -> Backend {
        Backend::PostgreSql
    }

    /// Executes a conservative read-only query with native PostgreSQL bindings.
    pub async fn query(
        &self,
        query: &ReadQuery,
        parameters: &[Value],
    ) -> Result<QueryResult, SqlError> {
        let bindings = parameters
            .iter()
            .map(postgres_parameter)
            .collect::<Vec<_>>();
        let parameters = bindings
            .iter()
            .map(|value| value.as_ref() as &(dyn ToSql + Sync))
            .collect::<Vec<_>>();
        let rows = self.client.query(query.as_str(), &parameters).await?;
        rows.iter()
            .map(postgres_row)
            .collect::<Result<Vec<_>, _>>()
            .map(|rows| QueryResult { rows })
    }
}

/// The portable asynchronous connection. SQLite remains readable through the
/// existing synchronous trait; PostgreSQL requires an async client to process
/// its network connection.
pub enum AsyncReadOnlyDatabase {
    Sqlite(SqliteReadOnly),
    PostgreSql(PostgresReadOnly),
}

impl AsyncReadOnlyDatabase {
    pub fn backend(&self) -> Backend {
        match self {
            Self::Sqlite(database) => database.backend(),
            Self::PostgreSql(database) => database.backend(),
        }
    }

    pub async fn query(
        &self,
        query: &ReadQuery,
        parameters: &[Value],
    ) -> Result<QueryResult, SqlError> {
        match self {
            Self::Sqlite(database) => database.query(query, parameters),
            Self::PostgreSql(database) => database.query(query, parameters).await,
        }
    }
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

/// Opens a local SQLite backend from the shared URL contract.
///
/// PostgreSQL is asynchronous; use [`open_read_only_async`] for that backend.
pub fn open_read_only(url: &DatabaseUrl) -> Result<Box<dyn ReadOnlyDatabase>, SqlError> {
    match url {
        DatabaseUrl::Sqlite { path } => Ok(Box::new(SqliteReadOnly::open(path)?)),
        DatabaseUrl::PostgreSql { .. } => Err(SqlError::AsyncBackendRequired {
            backend: Backend::PostgreSql,
        }),
    }
}

/// Opens either supported backend. PostgreSQL keeps its driver connection alive
/// on the current Tokio runtime and SQLite preserves its operating-system
/// read-only handle.
pub async fn open_read_only_async(url: &DatabaseUrl) -> Result<AsyncReadOnlyDatabase, SqlError> {
    match url {
        DatabaseUrl::Sqlite { path } => {
            Ok(AsyncReadOnlyDatabase::Sqlite(SqliteReadOnly::open(path)?))
        }
        DatabaseUrl::PostgreSql { url } => Ok(AsyncReadOnlyDatabase::PostgreSql(
            PostgresReadOnly::connect(url).await?,
        )),
    }
}

#[derive(Debug, Error)]
pub enum SqlError {
    #[error("invalid database URL: {0}")]
    InvalidUrl(&'static str),
    #[error("query is not read-only")]
    NotReadOnly,
    #[error("{backend:?} requires the asynchronous read-only API")]
    AsyncBackendRequired { backend: Backend },
    #[error("SQLite error")]
    Sqlite(#[from] rusqlite::Error),
    #[error("PostgreSQL error")]
    PostgreSql(#[from] tokio_postgres::Error),
    #[error("could not load a trusted native certificate store")]
    NativeCertificateStore,
    #[error("binary query parameters are unsupported by SQLite bindings")]
    BlobParameterUnsupported,
    #[error("PostgreSQL column type is not supported by the portable value contract")]
    UnsupportedPostgreSqlType,
}

fn sqlite_parameter(value: &Value) -> Result<SqliteValue, SqlError> {
    Ok(match value {
        Value::Null => SqliteValue::Null,
        Value::Boolean(value) => SqliteValue::Integer(i64::from(*value)),
        Value::Integer(value) => SqliteValue::Integer(*value),
        Value::Real(value) => SqliteValue::Real(*value),
        Value::Text(value) => SqliteValue::Text(value.clone()),
        Value::Blob(_) => return Err(SqlError::BlobParameterUnsupported),
    })
}

fn postgres_parameter(value: &Value) -> Box<dyn ToSql + Sync> {
    match value {
        Value::Null => Box::new(PostgresNull),
        Value::Boolean(value) => Box::new(*value),
        Value::Integer(value) => Box::new(*value),
        Value::Real(value) => Box::new(*value),
        Value::Text(value) => Box::new(value.clone()),
        Value::Blob(value) => Box::new(value.clone()),
    }
}

#[derive(Debug)]
struct PostgresNull;

impl ToSql for PostgresNull {
    fn to_sql(
        &self,
        _: &Type,
        _: &mut bytes::BytesMut,
    ) -> Result<IsNull, Box<dyn std::error::Error + Send + Sync>> {
        Ok(IsNull::Yes)
    }

    fn accepts(_: &Type) -> bool {
        true
    }

    tokio_postgres::types::to_sql_checked!();
}

fn sqlite_value(value: ValueRef<'_>) -> Result<Value, SqlError> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        // SQLite stores booleans as integers.
        ValueRef::Integer(value) => Value::Integer(value),
        ValueRef::Real(value) => Value::Real(value),
        ValueRef::Text(value) => Value::Text(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Blob(value.to_vec()),
    })
}

fn postgres_row(row: &tokio_postgres::Row) -> Result<Row, SqlError> {
    let columns = row
        .columns()
        .iter()
        .map(|column| column.name().to_owned())
        .collect::<Vec<_>>();
    let values = row
        .columns()
        .iter()
        .enumerate()
        .map(|(index, column)| postgres_value(row, index, column.type_()))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Row { columns, values })
}

fn postgres_value(row: &tokio_postgres::Row, index: usize, ty: &Type) -> Result<Value, SqlError> {
    macro_rules! nullable {
        ($value:expr, $map:expr) => {{
            match $value? {
                Some(value) => Ok($map(value)),
                None => Ok(Value::Null),
            }
        }};
    }

    if *ty == Type::BOOL {
        nullable!(row.try_get::<_, Option<bool>>(index), Value::Boolean)
    } else if *ty == Type::INT2 {
        nullable!(
            row.try_get::<_, Option<i16>>(index),
            |value| Value::Integer(i64::from(value))
        )
    } else if *ty == Type::INT4 {
        nullable!(
            row.try_get::<_, Option<i32>>(index),
            |value| Value::Integer(i64::from(value))
        )
    } else if *ty == Type::INT8 {
        nullable!(row.try_get::<_, Option<i64>>(index), Value::Integer)
    } else if *ty == Type::FLOAT4 {
        nullable!(row.try_get::<_, Option<f32>>(index), |value| Value::Real(
            f64::from(value)
        ))
    } else if *ty == Type::FLOAT8 {
        nullable!(row.try_get::<_, Option<f64>>(index), Value::Real)
    } else if matches!(*ty, Type::TEXT | Type::VARCHAR | Type::BPCHAR | Type::NAME) {
        nullable!(row.try_get::<_, Option<String>>(index), Value::Text)
    } else if *ty == Type::BYTEA {
        nullable!(row.try_get::<_, Option<Vec<u8>>>(index), Value::Blob)
    } else if matches!(*ty, Type::JSON | Type::JSONB) {
        nullable!(
            row.try_get::<_, Option<serde_json::Value>>(index),
            |value: serde_json::Value| Value::Text(value.to_string())
        )
    } else {
        Err(SqlError::UnsupportedPostgreSqlType)
    }
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
    fn synchronous_postgres_selection_requires_the_async_driver() {
        let url = DatabaseUrl::parse("postgres://localhost/inagle").unwrap();
        assert!(matches!(
            open_read_only(&url),
            Err(SqlError::AsyncBackendRequired {
                backend: Backend::PostgreSql
            })
        ));
    }

    #[test]
    fn postgres_null_binding_accepts_the_server_parameter_type() {
        assert!(PostgresNull::accepts(&Type::INT8));
        assert!(PostgresNull::accepts(&Type::TEXT));
    }
}
