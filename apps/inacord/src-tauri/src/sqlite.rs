//! Tauri bindings over the shared rusqlite owner; frontend retains Database compatibility.
use nie_explore::database::DatabaseRegistry;
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;

#[derive(Default)]
pub struct SqlState(pub Arc<DatabaseRegistry>);

#[tauri::command]
#[specta::specta]
pub async fn sqlite_load(
    app: tauri::AppHandle,
    state: tauri::State<'_, SqlState>,
    db: String,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|_| "Application database directory unavailable")?;
    let registry = state.0.clone();
    let migrations = if db == "sqlite:mods.db" {
        super::mods_migrations()
    } else {
        Vec::new()
    };
    tauri::async_runtime::spawn_blocking(move || registry.load(&directory, &db, &migrations))
        .await
        .map_err(|_| "Database worker failed".to_owned())?
}

#[tauri::command]
#[specta::specta]
pub async fn sqlite_select(
    state: tauri::State<'_, SqlState>,
    db: String,
    query: String,
    values: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        registry
            .select(&db, &query, values)
            .map(|rows| rows.into_iter().map(Value::Object).collect())
    })
    .await
    .map_err(|_| "Database worker failed".to_owned())?
}

#[tauri::command]
#[specta::specta]
pub async fn sqlite_execute(
    state: tauri::State<'_, SqlState>,
    db: String,
    query: String,
    values: Vec<Value>,
) -> Result<Value, String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = registry.execute(&db, &query, values)?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "Database worker failed".to_owned())?
}

#[tauri::command]
#[specta::specta]
pub async fn sqlite_close(
    state: tauri::State<'_, SqlState>,
    db: Option<String>,
) -> Result<bool, String> {
    let registry = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || registry.close(db.as_deref()))
        .await
        .map_err(|_| "Database worker failed".to_owned())?
}
