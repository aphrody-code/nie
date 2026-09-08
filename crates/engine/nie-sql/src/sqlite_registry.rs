//! Editable SQLite sessions and SQLx-compatible migration history for native hosts.

use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::{
    Connection, OptionalExtension, Statement, params,
    types::{Value as SqlValue, ValueRef},
};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha384};
use std::{collections::HashMap, path::Path, sync::Mutex, time::Duration};

pub struct Migration {
    pub version: i64,
    pub description: &'static str,
    pub sql: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: i64,
}

#[derive(Default)]
pub struct DatabaseRegistry {
    connections: Mutex<HashMap<String, Connection>>,
}

fn error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn migrate(connection: &mut Connection, migrations: &[Migration]) -> Result<(), String> {
    if migrations.is_empty() {
        return Ok(());
    }
    connection.execute_batch("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);").map_err(error)?;
    let dirty: Option<i64> = connection
        .query_row(
            "SELECT version FROM _sqlx_migrations WHERE success = 0 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    if dirty.is_some() {
        return Err("Database has an unfinished migration".into());
    }
    let mut ordered: Vec<_> = migrations.iter().collect();
    ordered.sort_by_key(|migration| migration.version);
    if ordered
        .windows(2)
        .any(|pair| pair[0].version == pair[1].version)
    {
        return Err("Duplicate migration version".into());
    }
    let known: Vec<i64> = connection
        .prepare("SELECT version FROM _sqlx_migrations")
        .map_err(error)?
        .query_map([], |row| row.get(0))
        .map_err(error)?
        .collect::<Result<_, _>>()
        .map_err(error)?;
    if known.iter().any(|version| {
        !ordered
            .iter()
            .any(|migration| migration.version == *version)
    }) {
        return Err("Database contains a migration unavailable to this application".into());
    }
    for migration in ordered {
        let checksum = Sha384::digest(migration.sql.as_bytes()).to_vec();
        let applied: Option<Vec<u8>> = connection
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version = ?1",
                [migration.version],
                |row| row.get(0),
            )
            .optional()
            .map_err(error)?;
        if let Some(applied) = applied {
            if applied != checksum {
                return Err(format!(
                    "Migration {} checksum differs from recorded SQL",
                    migration.version
                ));
            }
            continue;
        }
        let transaction = connection.transaction().map_err(error)?;
        let started = std::time::Instant::now();
        transaction.execute_batch(migration.sql).map_err(error)?;
        let execution_time = i64::try_from(started.elapsed().as_nanos()).unwrap_or(i64::MAX);
        transaction.execute("INSERT INTO _sqlx_migrations(version, description, success, checksum, execution_time) VALUES (?1, ?2, 1, ?3, ?4)", params![migration.version, migration.description, checksum, execution_time]).map_err(error)?;
        transaction.commit().map_err(error)?;
    }
    Ok(())
}

fn parameters(values: Vec<Value>) -> Result<Vec<SqlValue>, String> {
    values
        .into_iter()
        .map(|value| {
            Ok(match value {
                Value::Null => SqlValue::Null,
                Value::Bool(value) => SqlValue::Text(value.to_string()),
                Value::Number(value) => {
                    if let Some(integer) = value.as_i64() {
                        SqlValue::Integer(integer)
                    } else {
                        SqlValue::Real(value.as_f64().ok_or("Invalid SQL numeric parameter")?)
                    }
                }
                Value::String(value) => SqlValue::Text(value),
                other => SqlValue::Text(other.to_string()),
            })
        })
        .collect()
}

fn bind(
    statement: &mut Statement<'_>,
    values: &[SqlValue],
    offset: &mut usize,
) -> Result<(), String> {
    for index in 1..=statement.parameter_count() {
        let position = if let Some(name) = statement.parameter_name(index) {
            name.strip_prefix('$')
                .or_else(|| name.strip_prefix('?'))
                .and_then(|number| number.parse::<usize>().ok())
                .filter(|position| *position > 0)
                .ok_or("Unsupported SQL parameter name")?
        } else {
            *offset += 1;
            *offset
        };
        let Some(value) = values.get(position - 1) else {
            break;
        };
        statement.raw_bind_parameter(index, value).map_err(error)?;
    }
    Ok(())
}

impl DatabaseRegistry {
    /// Preserves the established app-config-relative URI session behavior.
    pub fn load(
        &self,
        app_config_dir: &Path,
        uri: &str,
        migrations: &[Migration],
    ) -> Result<String, String> {
        let path = uri
            .strip_prefix("sqlite:")
            .ok_or("Only sqlite: databases are supported")?;
        if path.is_empty() || path.contains('\0') {
            return Err("Invalid SQLite database path".into());
        }
        let mut sessions = self
            .connections
            .lock()
            .map_err(|_| "Database registry lock failed")?;
        if sessions.contains_key(uri) {
            return Ok(uri.to_owned());
        }
        std::fs::create_dir_all(app_config_dir)
            .map_err(|_| "Application database directory unavailable")?;
        let mut connection = Connection::open(app_config_dir.join(path))
            .map_err(|_| "Database could not be opened")?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(error)?;
        migrate(&mut connection, migrations)?;
        sessions.insert(uri.to_owned(), connection);
        Ok(uri.to_owned())
    }

    pub fn execute(
        &self,
        uri: &str,
        query: &str,
        values: Vec<Value>,
    ) -> Result<ExecuteResult, String> {
        let sessions = self
            .connections
            .lock()
            .map_err(|_| "Database registry lock failed")?;
        let connection = sessions.get(uri).ok_or("Database is not loaded")?;
        let parameters = parameters(values)?;
        let mut affected = 0_u64;
        let mut batch = rusqlite::Batch::new(connection, query);
        let mut count = 0_usize;
        let mut offset = 0_usize;
        while let Some(mut statement) = batch.next().map_err(error)? {
            count += 1;
            if count > 256 {
                return Err("SQL batch exceeds statement limit".into());
            }
            bind(&mut statement, &parameters, &mut offset)?;
            let changed = if statement.column_count() == 0 {
                statement.raw_execute().map_err(error)? as u64
            } else {
                let mut rows = statement.raw_query();
                while rows.next().map_err(error)?.is_some() {}
                connection.changes()
            };
            affected = affected
                .checked_add(changed)
                .ok_or("SQL affected-row count overflow")?;
        }
        Ok(ExecuteResult {
            rows_affected: affected,
            last_insert_id: connection.last_insert_rowid(),
        })
    }

    pub fn select(
        &self,
        uri: &str,
        query: &str,
        values: Vec<Value>,
    ) -> Result<Vec<Map<String, Value>>, String> {
        let sessions = self
            .connections
            .lock()
            .map_err(|_| "Database registry lock failed")?;
        let connection = sessions.get(uri).ok_or("Database is not loaded")?;
        let mut statement = connection.prepare(query).map_err(error)?;
        let columns: Vec<_> = statement
            .columns()
            .iter()
            .map(|column| {
                (
                    column.name().to_owned(),
                    column.decl_type().unwrap_or("").to_ascii_uppercase(),
                )
            })
            .collect();
        bind(&mut statement, &parameters(values)?, &mut 0)?;
        let mut rows = statement.raw_query();
        let mut result = Vec::new();
        while let Some(row) = rows.next().map_err(error)? {
            let mut object = Map::new();
            for (index, (name, declared_type)) in columns.iter().enumerate() {
                let value = match row.get_ref(index).map_err(error)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(value)
                        if declared_type == "BOOLEAN" || declared_type == "BOOL" =>
                    {
                        Value::Bool(value != 0)
                    }
                    ValueRef::Integer(value) => Value::from(value),
                    ValueRef::Real(value) => Value::from(value),
                    ValueRef::Text(value) => {
                        Value::String(std::str::from_utf8(value).map_err(error)?.to_owned())
                    }
                    ValueRef::Blob(value) => {
                        Value::Array(value.iter().map(|byte| Value::from(*byte)).collect())
                    }
                };
                object.insert(name.clone(), value);
            }
            result.push(object);
        }
        Ok(result)
    }

    pub fn close(&self, uri: Option<&str>) -> Result<bool, String> {
        let mut sessions = self
            .connections
            .lock()
            .map_err(|_| "Database registry lock failed")?;
        if let Some(uri) = uri {
            sessions.remove(uri).ok_or("Database is not loaded")?;
        } else {
            sessions.clear();
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    const SCHEMA: &str = "CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT);";
    fn memory_registry() -> DatabaseRegistry {
        let registry = DatabaseRegistry::default();
        registry
            .connections
            .lock()
            .unwrap()
            .insert("memory".into(), Connection::open_in_memory().unwrap());
        registry
    }

    #[test]
    fn migration_preserves_sqlx_history_and_rejects_changed_sql() {
        let mut connection = Connection::open_in_memory().unwrap();
        let migrations = [Migration {
            version: 1,
            description: "entries",
            sql: SCHEMA,
        }];
        migrate(&mut connection, &migrations).unwrap();
        connection
            .execute("INSERT INTO entries VALUES (1, 'user content')", [])
            .unwrap();
        migrate(&mut connection, &migrations).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT name FROM entries", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "user content"
        );
        assert!(
            migrate(
                &mut connection,
                &[Migration {
                    version: 1,
                    description: "entries",
                    sql: "DROP TABLE entries"
                }]
            )
            .unwrap_err()
            .contains("checksum")
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM _sqlx_migrations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn failed_or_dirty_migration_is_not_replayed() {
        let mut connection = Connection::open_in_memory().unwrap();
        assert!(migrate(&mut connection, &[Migration { version: 1, description: "invalid", sql: "CREATE TABLE temporary_change(id INTEGER); INSERT INTO missing_table VALUES (1);" }]).is_err());
        assert!(
            connection
                .prepare("SELECT * FROM temporary_change")
                .is_err()
        );
        let migrations = [Migration {
            version: 2,
            description: "entries",
            sql: SCHEMA,
        }];
        migrate(&mut connection, &migrations).unwrap();
        connection
            .execute("UPDATE _sqlx_migrations SET success=0", [])
            .unwrap();
        assert!(
            migrate(&mut connection, &migrations)
                .unwrap_err()
                .contains("unfinished")
        );
    }

    #[test]
    fn registry_preserves_bound_batches_transactions_and_json_values() {
        let registry = memory_registry();
        registry.execute("memory", "CREATE TABLE entries(id INTEGER PRIMARY KEY, enabled BOOL); CREATE TABLE audit(id INTEGER); CREATE TRIGGER entry_audit AFTER INSERT ON entries BEGIN INSERT INTO audit VALUES (new.id); END;", vec![]).unwrap();
        registry.execute("memory", "BEGIN", vec![]).unwrap();
        assert_eq!(
            registry
                .execute(
                    "memory",
                    "INSERT INTO entries VALUES ($2,$1); INSERT INTO entries VALUES ($3,$1)",
                    vec![json!(1), json!(1), json!(2)]
                )
                .unwrap()
                .rows_affected,
            2
        );
        assert_eq!(
            registry
                .select(
                    "memory",
                    "SELECT enabled FROM entries WHERE id=$1",
                    vec![json!(1)]
                )
                .unwrap()[0]["enabled"],
            json!(true)
        );
        registry.execute("memory", "ROLLBACK", vec![]).unwrap();
        assert!(
            registry
                .select("memory", "SELECT * FROM entries", vec![])
                .unwrap()
                .is_empty()
        );
        let rows = registry
            .select(
                "memory",
                "SELECT $2 AS second, $1 AS first, $3 AS absent, X'00FF' AS bytes, $4 AS exact",
                vec![
                    json!("first"),
                    json!("second"),
                    Value::Null,
                    json!(9_007_199_254_740_993_i64),
                ],
            )
            .unwrap();
        assert_eq!(rows[0]["first"], json!("first"));
        assert_eq!(rows[0]["second"], json!("second"));
        assert_eq!(rows[0]["absent"], Value::Null);
        assert_eq!(rows[0]["bytes"], json!([0, 255]));
        assert_eq!(rows[0]["exact"], json!(9_007_199_254_740_993_i64));
    }
}
