//! Shared local SQLite sessions and SQLx-compatible migration history.
//! Hosts provide their data directory and migration SQL; no UI or Tauri dependency lives here.

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
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS _sqlx_migrations (
        version BIGINT PRIMARY KEY, description TEXT NOT NULL,
        installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL
    );",
        )
        .map_err(error)?;
    // SQLx marks unsuccessful migrations dirty; never replay or repair them implicitly.
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
    for pair in ordered.windows(2) {
        if pair[0].version == pair[1].version {
            return Err("Duplicate migration version".into());
        }
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
        transaction.execute(
            "INSERT INTO _sqlx_migrations(version, description, success, checksum, execution_time) VALUES (?1, ?2, 1, ?3, ?4)",
            params![migration.version, migration.description, checksum, execution_time],
        ).map_err(error)?;
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
                // Match the previous plugin's JsonValue binding for booleans/objects/arrays.
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
        // SQLx treats $N as the Nth supplied value even if SQLite encounters $2 before $1.
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
        // SQLx leaves missing positional arguments NULL, including the remaining binds.
        let Some(value) = values.get(position - 1) else {
            break;
        };
        statement.raw_bind_parameter(index, value).map_err(error)?;
    }
    Ok(())
}

impl DatabaseRegistry {
    /// Preserve the previous plugin's app-config-relative path mapping and URI session key.
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
        // PathBuf::join retains an absolute caller path, matching the replaced plugin.
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
        let mut rows_affected = 0_u64;
        let mut batch = rusqlite::Batch::new(connection, query);
        let mut statement_count = 0_usize;
        let mut argument_offset = 0_usize;
        while let Some(mut statement) = batch.next().map_err(error)? {
            statement_count += 1;
            if statement_count > 256 {
                return Err("SQL batch exceeds statement limit".into());
            }
            bind(&mut statement, &parameters, &mut argument_offset)?;
            let changed = if statement.column_count() == 0 {
                statement.raw_execute().map_err(error)? as u64
            } else {
                let mut rows = statement.raw_query();
                while rows.next().map_err(error)?.is_some() {}
                connection.changes()
            };
            // SQLx accumulates direct sqlite3_changes per statement, excluding trigger writes.
            rows_affected = rows_affected
                .checked_add(changed)
                .ok_or("SQL affected-row count overflow")?;
        }
        Ok(ExecuteResult {
            rows_affected,
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
        let parameters = parameters(values)?;
        bind(&mut statement, &parameters, &mut 0)?;
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

    #[test]
    fn applied_sqlx_migration_preserves_rows_and_checksum() {
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
                .query_row("SELECT name FROM entries WHERE id=1", [], |row| row
                    .get::<_, String>(0))
                .unwrap(),
            "user content"
        );
        let checksum: Vec<u8> = connection
            .query_row(
                "SELECT checksum FROM _sqlx_migrations WHERE version=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(checksum, Sha384::digest(SCHEMA.as_bytes()).to_vec());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM _sqlx_migrations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn modified_applied_sql_is_rejected_without_replay() {
        let mut connection = Connection::open_in_memory().unwrap();
        migrate(
            &mut connection,
            &[Migration {
                version: 1,
                description: "entries",
                sql: SCHEMA,
            }],
        )
        .unwrap();
        let result = migrate(
            &mut connection,
            &[Migration {
                version: 1,
                description: "entries",
                sql: "DROP TABLE entries;",
            }],
        );
        assert!(result.unwrap_err().contains("checksum"));
        assert!(connection.prepare("SELECT * FROM entries").is_ok());
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_history() {
        let mut connection = Connection::open_in_memory().unwrap();
        let result = migrate(
            &mut connection,
            &[Migration {
                version: 1,
                description: "invalid",
                sql: "CREATE TABLE temporary_change(id INTEGER); INSERT INTO missing_table VALUES (1);",
            }],
        );
        assert!(result.is_err());
        assert!(
            connection
                .prepare("SELECT * FROM temporary_change")
                .is_err()
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM _sqlx_migrations", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn dirty_sqlx_history_is_rejected_before_new_sql() {
        let mut connection = Connection::open_in_memory().unwrap();
        let migrations = [Migration {
            version: 1,
            description: "entries",
            sql: SCHEMA,
        }];
        migrate(&mut connection, &migrations).unwrap();
        connection
            .execute("UPDATE _sqlx_migrations SET success=0 WHERE version=1", [])
            .unwrap();
        assert!(
            migrate(&mut connection, &migrations)
                .unwrap_err()
                .contains("unfinished")
        );
        assert!(connection.prepare("SELECT * FROM entries").is_ok());
    }

    #[test]
    fn explicit_session_transaction_and_boolean_columns_are_preserved() {
        let registry = DatabaseRegistry::default();
        registry
            .connections
            .lock()
            .unwrap()
            .insert("memory".into(), Connection::open_in_memory().unwrap());
        registry
            .execute(
                "memory",
                "CREATE TABLE entries(id INTEGER PRIMARY KEY, enabled BOOL)",
                vec![],
            )
            .unwrap();
        registry.execute("memory", "BEGIN", vec![]).unwrap();
        let inserted = registry
            .execute(
                "memory",
                "INSERT INTO entries(id,enabled) VALUES ($1,$2)",
                vec![json!(1), json!(1)],
            )
            .unwrap();
        assert_eq!(inserted.rows_affected, 1);
        assert_eq!(inserted.last_insert_id, 1);
        assert_eq!(
            registry
                .select("memory", "SELECT enabled FROM entries", vec![])
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
    }

    #[test]
    fn json_parameters_preserve_numbering_null_blob_and_integer_precision() {
        let registry = DatabaseRegistry::default();
        registry
            .connections
            .lock()
            .unwrap()
            .insert("memory".into(), Connection::open_in_memory().unwrap());
        let rows = registry.select("memory", "SELECT $2 AS second, $1 AS first, $3 AS absent, X'00FF' AS bytes, $4 AS flag, $5 AS exact", vec![json!("first"), json!("second"), Value::Null, json!(true), json!(9_007_199_254_740_993_i64)]).unwrap();
        assert_eq!(rows[0]["first"], json!("first"));
        assert_eq!(rows[0]["second"], json!("second"));
        assert_eq!(rows[0]["absent"], Value::Null);
        assert_eq!(rows[0]["bytes"], json!([0, 255]));
        assert_eq!(rows[0]["flag"], json!("true"));
        assert_eq!(rows[0]["exact"], json!(9_007_199_254_740_993_i64));
        assert!(registry.close(Some("memory")).unwrap());
        assert!(registry.select("memory", "SELECT 1", vec![]).is_err());
    }

    #[test]
    fn bound_batches_report_direct_rows_without_trigger_side_effects() {
        let registry = DatabaseRegistry::default();
        registry
            .connections
            .lock()
            .unwrap()
            .insert("memory".into(), Connection::open_in_memory().unwrap());
        registry.execute("memory", "CREATE TABLE entries(id INTEGER); CREATE TABLE audit(id INTEGER); CREATE TRIGGER entry_audit AFTER INSERT ON entries BEGIN INSERT INTO audit VALUES (new.id); END;", vec![]).unwrap();
        let result = registry
            .execute(
                "memory",
                "INSERT INTO entries VALUES ($2); INSERT INTO entries VALUES ($1)",
                vec![json!(1), json!(2)],
            )
            .unwrap();
        assert_eq!(result.rows_affected, 2);
        assert_eq!(
            registry
                .select("memory", "SELECT count(*) AS count FROM audit", vec![])
                .unwrap()[0]["count"],
            json!(2)
        );
        let result = registry
            .execute("memory", "INSERT INTO entries VALUES (3)", vec![])
            .unwrap();
        assert_eq!(result.rows_affected, 1);
        registry
            .execute(
                "memory",
                "INSERT INTO entries VALUES (?); INSERT INTO entries VALUES (?)",
                vec![json!(4), json!(5)],
            )
            .unwrap();
        assert_eq!(
            registry
                .select(
                    "memory",
                    "SELECT id FROM entries ORDER BY id DESC LIMIT 1",
                    vec![]
                )
                .unwrap()[0]["id"],
            json!(5)
        );
    }
}
