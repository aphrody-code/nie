//! Native Model Context Protocol binding for every `niers` CLI command.

use std::borrow::Cow;

use rmcp::{
    ErrorData, ServerHandler, ServiceExt,
    handler::server::router::tool::{AsyncTool, ToolBase, ToolRouter},
    handler::server::wrapper::Parameters,
    schemars, tool, tool_handler, tool_router,
    transport::stdio,
};
use serde_json::{Value, json};

use crate::CapturedCommand;

mod bridge;

use bridge::BridgeControl;

/// Arguments appended after the command represented by an MCP tool.
///
/// This deliberately preserves Clap as the single schema for every nested
/// command and flag. A model can pass exactly the same tail it would pass to
/// the terminal while execution stays in process through [`crate::dispatch`].
#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
pub struct CliToolRequest {
    /// Arguments after the top-level command, excluding `niers` and the
    /// command itself. Example for `cli_vfs`: `["find", "--ext", "g4tx", "."]`.
    #[serde(default)]
    pub args: Vec<String>,
}

/// Native, stateless MCP service. Domain state is opened by the same library
/// functions as the CLI so clients never observe a second implementation.
#[derive(Debug, Clone, Default)]
pub struct NiersMcpServer {
    bridge: BridgeControl,
}

impl NiersMcpServer {
    async fn execute(command: &'static str, request: CliToolRequest) -> CapturedCommand {
        match tokio::task::spawn_blocking(move || {
            crate::execute_captured(command.to_owned(), request.args)
        })
        .await
        {
            Ok(result) => result,
            Err(error) => CapturedCommand::failed(format!("CLI worker failed: {error}")),
        }
    }
}

macro_rules! define_cli_tools {
    ($(($type_name:ident, $tool_name:literal, $command:literal, $description:literal)),+ $(,)?) => {
        $(
            struct $type_name;

            impl ToolBase for $type_name {
                type Parameter = CliToolRequest;
                type Output = CapturedCommand;
                type Error = ErrorData;

                fn name() -> Cow<'static, str> {
                    $tool_name.into()
                }

                fn description() -> Option<Cow<'static, str>> {
                    Some($description.into())
                }
            }

            impl AsyncTool<NiersMcpServer> for $type_name {
                async fn invoke(
                    _service: &NiersMcpServer,
                    request: CliToolRequest,
                ) -> Result<CapturedCommand, ErrorData> {
                    Ok(NiersMcpServer::execute($command, request).await)
                }
            }
        )+

        impl NiersMcpServer {
            fn tool_router() -> ToolRouter<Self> {
                ToolRouter::new()$(.with_async_tool::<$type_name>())+
            }
        }
    };
}

define_cli_tools!(
    (
        CliComputerUse,
        "cli_computer_use",
        "computer-use",
        "Run `niers computer-use` in process. Pass the exact CLI argument tail in `args`; this surface is read-only."
    ),
    (
        CliMod,
        "cli_mod",
        "mod",
        "Run any `niers mod` workflow in process. This tool may write or install mod files; inspect the selected subcommand before calling."
    ),
    (
        CliViola,
        "cli_viola",
        "viola",
        "Run any native Viola archive operation in process, including dump, verify, pack, merge, and crypto."
    ),
    (
        CliFormat,
        "cli_format",
        "format",
        "Detect Level-5 formats for a file or directory through the canonical CLI library."
    ),
    (
        CliDecode,
        "cli_decode",
        "decode",
        "Decode Level-5 files through the same dispatch shared by the CLI, FFI, and explorer."
    ),
    (
        CliRefreshTypedJson,
        "cli_refresh_typed_json",
        "refresh-typed-json",
        "Regenerate typed iecode JSON sidecars for cfg.bin files. This tool writes files."
    ),
    (
        CliSteam,
        "cli_steam",
        "steam",
        "Run Steam list, download, or sync operations. Download and sync mutate the selected installation."
    ),
    (
        CliInfo,
        "cli_info",
        "info",
        "Inspect the game installation, executable fingerprint, VFS mount, and launch chain."
    ),
    (
        CliConvert,
        "cli_convert",
        "convert",
        "Convert a disk or VFS asset to an exchange format through nie-formats."
    ),
    (
        CliRender,
        "cli_render",
        "render",
        "Render GLB assets to PNG or GIF through nie-render3d."
    ),
    (
        CliLua,
        "cli_lua",
        "lua",
        "Statically inspect Lua source files without executing them."
    ),
    (
        CliLuaRun,
        "cli_lua_run",
        "lua-run",
        "Execute a Lua 5.2 game chunk in the bounded native sandbox."
    ),
    (
        CliLuaAudit,
        "cli_lua_audit",
        "lua-audit",
        "Audit the game Lua corpus against the bounded native runtime."
    ),
    (
        CliSeed,
        "cli_seed",
        "seed",
        "Seed the reverse-engineering database from structured inputs. This tool writes the selected database."
    ),
    (
        CliSeedUi,
        "cli_seed_ui",
        "seed-ui",
        "Index UI assets into the reverse-engineering database. This tool writes the selected database."
    ),
    (
        CliStrings,
        "cli_strings",
        "strings",
        "Extract and optionally index ASCII and UTF-16 strings from nie.exe."
    ),
    (
        CliFind,
        "cli_find",
        "find",
        "Find repository or data files with the canonical ignore and glob semantics."
    ),
    (
        CliGrep,
        "cli_grep",
        "grep",
        "Search file contents with the canonical regex and ignore semantics."
    ),
    (
        CliImg,
        "cli_img",
        "img",
        "Run native image inspection, resize, crop, conversion, composition, contact-sheet, or diff operations."
    ),
    (
        CliMode,
        "cli_mode",
        "mode",
        "Index, measure, export, or inspect game mode and menu coverage."
    ),
    (
        CliIcons,
        "cli_icons",
        "icons",
        "Index, inspect, or extract icon atlas regions."
    ),
    (
        CliAvatar,
        "cli_avatar",
        "avatar",
        "Inspect and export avatar recipes, parts, presets, regions, sheets, UVs, or icons."
    ),
    (
        CliCoverage,
        "cli_coverage",
        "coverage",
        "Report reverse-engineering classification coverage."
    ),
    (
        CliQueue,
        "cli_queue",
        "queue",
        "Operate the reverse-engineering Redis frontier. Push and reset mutate queue state."
    ),
    (
        CliPropagate,
        "cli_propagate",
        "propagate",
        "Propagate reverse-engineering classifications in the selected database."
    ),
    (
        CliRtti,
        "cli_rtti",
        "rtti",
        "Extract and index MSVC RTTI from nie.exe."
    ),
    (
        CliIndex,
        "cli_index",
        "index",
        "Index executable metadata into the reverse-engineering database."
    ),
    (
        CliDisasm,
        "cli_disasm",
        "disasm",
        "Disassemble indexed executable functions through iced-x86."
    ),
    (
        CliPdata,
        "cli_pdata",
        "pdata",
        "Parse and index the PE exception-function table."
    ),
    (
        CliRebuild,
        "cli_rebuild",
        "rebuild",
        "Rebuild the reverse-engineering database through the canonical pipeline. This tool mutates the database."
    ),
    (
        CliRecover,
        "cli_recover",
        "recover",
        "Recover reverse-engineering metadata, optionally applying changes to the selected database."
    ),
    (
        CliSave,
        "cli_save",
        "save",
        "Read, decrypt, encrypt, or edit IEVR save files. Non-read subcommands write data."
    ),
    (
        CliWiki,
        "cli_wiki",
        "wiki",
        "Query characters, skills, items, teams, comparisons, search, SQL, and deterministic team generation."
    ),
    (
        CliUniformMap,
        "cli_uniform_map",
        "uniform-map",
        "Build the VFS uniform-to-model mapping."
    ),
    (
        CliTextures,
        "cli_textures",
        "textures",
        "Decode or index the game texture corpus."
    ),
    (
        CliMenuPredecode,
        "cli_menu_predecode",
        "menu-predecode",
        "Predecode menu sprites for UI consumption."
    ),
    (
        CliMem,
        "cli_mem",
        "mem",
        "Inspect live nie.exe memory maps, reads, dumps, scans, Lua fields, palettes, or explicit EAC patches."
    ),
    (
        CliVfs,
        "cli_vfs",
        "vfs",
        "Run every VFS operation: list, find, stat, read, extract, stats, format parsing, character, and move lookup."
    ),
    (
        CliVn,
        "cli_vn",
        "vn",
        "Inspect or export visual-novel casting and assets."
    ),
    (
        CliVideo,
        "cli_video",
        "video",
        "Inspect, list, export, or catalogue game videos."
    ),
);

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct VfsListRequest {
    prefix: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct VfsSearchRequest {
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct PathRequest {
    path: String,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct VfsCatRequest {
    path: String,
    max_bytes: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct AssetRequest {
    path: String,
    decode: Option<String>,
    max_bytes: Option<usize>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct QueryRequest {
    sql: String,
    limit: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct WikiCardRequest {
    id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields)]
struct WikiSearchRequest {
    query: String,
    limit: Option<usize>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ZukanRankRequest {
    entry: Value,
    candidates: Value,
    max_results: u32,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct FunctionRequest {
    name: Option<String>,
    vaddr: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RepoReadRequest {
    path: String,
    max_bytes: Option<u64>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct ExplorerNavigateRequest {
    prefix: String,
    select: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct ExplorerTabRequest {
    tab: String,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct ExplorerToastRequest {
    message: String,
    kind: Option<String>,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
struct GameLaunchRequest {
    #[serde(default)]
    args: Vec<String>,
}

fn json_text(value: Value) -> String {
    serde_json::to_string_pretty(&value).unwrap_or_else(|error| {
        json!({ "error": format!("JSON serialization failed: {error}") }).to_string()
    })
}

fn error_text(error: impl std::fmt::Display) -> String {
    json_text(json!({ "error": error.to_string() }))
}

type CompatibilityResult = Result<String, String>;

async fn blocking_json<F>(operation: F) -> CompatibilityResult
where
    F: FnOnce() -> anyhow::Result<Value> + Send + 'static,
{
    match tokio::task::spawn_blocking(operation).await {
        Ok(Ok(value)) => Ok(json_text(value)),
        Ok(Err(error)) => Err(error_text(error)),
        Err(error) => Err(error_text(format!("blocking MCP worker failed: {error}"))),
    }
}

fn re_database_path() -> std::path::PathBuf {
    nie_index::resolve_re_database_path(std::env::var_os("NIERS_SQLITE").map(Into::into))
}

fn open_re_database() -> anyhow::Result<nie_index::rusqlite::Connection> {
    use nie_index::rusqlite::OpenFlags;

    let path = re_database_path();
    anyhow::ensure!(path.is_file(), "RE database not found: {}", path.display());
    nie_index::rusqlite::Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| anyhow::anyhow!("open {} read-only: {error}", path.display()))
}

fn query_re_rows(
    connection: &nie_index::rusqlite::Connection,
    sql: &str,
    limit: usize,
) -> anyhow::Result<(Vec<Value>, bool, Vec<String>)> {
    use nie_index::rusqlite::types::ValueRef;

    nie_wiki::query::check_readonly_sql(sql)?;
    let mut statement = connection.prepare(sql)?;
    anyhow::ensure!(
        statement.readonly(),
        "SQLite rejected the query as non-read-only"
    );
    let columns = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut cursor = statement.query([])?;
    let mut rows = Vec::new();
    let mut truncated = false;
    while let Some(row) = cursor.next()? {
        if rows.len() >= limit {
            truncated = true;
            break;
        }
        let mut object = serde_json::Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(value) if is_address_column(column) => {
                    Value::String(format!("0x{value:x}"))
                }
                ValueRef::Integer(value)
                    if (-(1_i64 << 53) + 1..=(1_i64 << 53) - 1).contains(&value) =>
                {
                    Value::Number(value.into())
                }
                ValueRef::Integer(value) => Value::String(value.to_string()),
                ValueRef::Real(value) => serde_json::Number::from_f64(value)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
                ValueRef::Blob(value) => Value::String(format!("<blob {} bytes>", value.len())),
            };
            object.insert(column.clone(), value);
        }
        rows.push(Value::Object(object));
    }
    Ok((rows, truncated, columns))
}

fn is_address_column(column: &str) -> bool {
    matches!(
        column,
        "vaddr" | "from_addr" | "to_addr" | "addr" | "base_addr" | "va" | "target_addr"
    )
}

fn safe_vfs_path(path: &str) -> Result<&str, String> {
    let path = path.trim();
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.chars().any(|character| character.is_control())
        || path.split('/').any(|part| part == "..")
    {
        return Err("invalid VFS path".to_owned());
    }
    Ok(path)
}

fn decode_kind(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".g4tx") {
        "tex"
    } else if lower.ends_with(".hca")
        || lower.ends_with(".adx")
        || lower.ends_with(".acb")
        || lower.ends_with(".awb")
    {
        "audio"
    } else if lower.ends_with(".cfg.bin")
        || lower.ends_with(".objbin")
        || lower.ends_with(".mevbin")
    {
        "cfg"
    } else {
        "raw"
    }
}

fn vfs_extension(path: &str) -> &str {
    let basename = path.rsplit('/').next().unwrap_or(path);
    for extension in [".cfg.bin", ".objbin", ".fxbin", ".mevbin"] {
        if basename.to_ascii_lowercase().ends_with(extension) {
            return extension;
        }
    }
    basename.rfind('.').map_or("", |index| &basename[index..])
}

async fn fetch_model_asset(request: AssetRequest) -> CompatibilityResult {
    let base =
        std::env::var("MODEL_SERVE_URL").unwrap_or_else(|_| "http://127.0.0.1:8790".to_owned());
    fetch_model_asset_from(request, &base).await
}

async fn fetch_model_asset_from(request: AssetRequest, base: &str) -> CompatibilityResult {
    use base64::Engine as _;
    use futures_util::StreamExt as _;

    let result = async {
        let cap = request
            .max_bytes
            .unwrap_or(256 * 1024)
            .clamp(1, 8 * 1024 * 1024);
        let raw = request.path.trim();
        anyhow::ensure!(
            !raw.is_empty() && raw.len() <= 1_024 && !raw.contains("..") && !raw.contains('\0'),
            "invalid model code"
        );
        let without_extension = raw
            .strip_suffix(".glb")
            .or_else(|| raw.strip_suffix(".GLB"))
            .unwrap_or(raw);
        let code = without_extension.rsplit('/').next().unwrap_or_default();
        anyhow::ensure!(!code.is_empty(), "invalid model code");
        let mut url = reqwest::Url::parse(base.trim_end_matches('/'))?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|()| anyhow::anyhow!("MODEL_SERVE_URL cannot be a base URL"))?;
            segments.push("model-full").push(&format!("{code}.glb"));
        }
        let url_text = url.to_string();
        let response = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?
            .get(url.clone())
            .send()
            .await?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        let announced_length = response.content_length();
        if status.is_success() && announced_length.is_some_and(|length| length > cap as u64) {
            return Ok(json!({
                "path": raw,
                "decode": "model",
                "url": url_text,
                "http_status": status.as_u16(),
                "content_type": content_type,
                "content_length": announced_length,
                "truncated": true,
                "source": "model-serve",
                "note": format!("content exceeds maxBytes {cap}; use the model-serve URL")
            }));
        }

        let read_cap = if status.is_success() { cap } else { 4_096 };
        let mut bytes =
            Vec::with_capacity(announced_length.unwrap_or(0).min(read_cap as u64) as usize);
        let mut stream = response.bytes_stream();
        let mut truncated = false;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            let remaining = read_cap.saturating_sub(bytes.len());
            if chunk.len() > remaining {
                bytes.extend_from_slice(&chunk[..remaining]);
                truncated = true;
                break;
            }
            bytes.extend_from_slice(&chunk);
        }
        let content_length = announced_length.unwrap_or(bytes.len() as u64);
        let mut value = json!({
            "path": raw,
            "decode": "model",
            "url": url_text,
            "http_status": status.as_u16(),
            "content_type": content_type,
            "content_length": content_length,
            "truncated": truncated,
            "source": "model-serve"
        });
        if !status.is_success() {
            value["note"] = Value::String(format!(
                "model-serve returned {status}: {}",
                String::from_utf8_lossy(&bytes)
                    .trim()
                    .chars()
                    .take(300)
                    .collect::<String>()
            ));
        } else if truncated {
            value["note"] = Value::String(format!(
                "content exceeds maxBytes {cap}; use the model-serve URL"
            ));
        } else {
            value["base64"] =
                Value::String(base64::engine::general_purpose::STANDARD.encode(&bytes));
        }
        Ok::<_, anyhow::Error>(value)
    }
    .await;
    result.map(json_text).map_err(error_text)
}

#[tool_router(router = compatibility_router)]
impl NiersMcpServer {
    #[tool(
        name = "wiki_character_card",
        description = "Read an exact character card with native stat anchors, learned skills and auras from the configured wiki mirror. No network access or writes."
    )]
    async fn wiki_character_card(
        &self,
        Parameters(request): Parameters<WikiCardRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            anyhow::ensure!(
                !request.id.is_empty() && request.id.len() <= 256,
                "Invalid character ID"
            );
            let conn = nie_wiki::mirror::open(None)
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let card = nie_wiki::cards::character(&conn, &request.id)
                .map_err(|_| anyhow::anyhow!("Character card could not be read"))?
                .ok_or_else(|| anyhow::anyhow!("Character was not found"))?;
            Ok(serde_json::to_value(card)?)
        })
        .await
    }

    #[tool(
        name = "wiki_search",
        description = "Search characters, techniques and items using the shared read-only wiki query owner."
    )]
    async fn wiki_search(
        &self,
        Parameters(request): Parameters<WikiSearchRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            let limit = request.limit.unwrap_or(20);
            anyhow::ensure!(
                (1..=100).contains(&limit),
                "Require limit between 1 and 100"
            );
            anyhow::ensure!(
                !request.query.trim().is_empty() && request.query.len() <= 256,
                "Invalid search query"
            );
            let conn = nie_wiki::mirror::open(None)
                .map_err(|_| anyhow::anyhow!("Wiki data is unavailable"))?;
            let result = nie_wiki::query::search_all(&conn, &request.query, limit)
                .map_err(|_| anyhow::anyhow!("Wiki search could not be completed"))?;
            Ok(serde_json::to_value(result)?)
        })
        .await
    }

    #[tool(
        name = "zukan_rank",
        description = "Rank supplied official-encyclopedia entries against supplied candidates with the shared bounded native matcher. Suggestions only; no identity assignment, network request or write."
    )]
    async fn zukan_rank(
        &self,
        Parameters(request): Parameters<ZukanRankRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            let output = nie_zukan::api::rank_json(
                &request.entry.to_string(),
                &request.candidates.to_string(),
                request.max_results,
            )
            .map_err(anyhow::Error::msg)?;
            Ok(serde_json::from_str(&output)?)
        })
        .await
    }

    #[tool(
        name = "aphrody_api_health",
        description = "Report the health of the native niers MCP process and its in-process CLI binding."
    )]
    async fn compatibility_health(&self) -> CompatibilityResult {
        let base = std::env::var("NIE_APHRODY_API_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8085".to_owned());
        let url = format!("{}/api/v1/health", base.trim_end_matches('/'));
        let result = async {
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()?
                .get(&url)
                .send()
                .await?;
            let status = response.status();
            let body = response.text().await?;
            anyhow::ensure!(
                status.is_success(),
                "nie-site returned {status}: {}",
                body.chars().take(500).collect::<String>()
            );
            let health: Value = serde_json::from_str(&body)
                .map_err(|error| anyhow::anyhow!("nie-site returned invalid JSON: {error}"))?;
            Ok::<_, anyhow::Error>(json!({
                "url": url,
                "status": status.as_u16(),
                "health": health,
                "mcp_runtime": "rust-native"
            }))
        }
        .await;
        result.map(json_text).map_err(error_text)
    }

    #[tool(
        name = "vfs_list",
        description = "List immediate directories and files under a VFS prefix. Compatibility name retained from the Bun server."
    )]
    async fn compatibility_vfs_list(
        &self,
        Parameters(request): Parameters<VfsListRequest>,
    ) -> CompatibilityResult {
        let limit = request.limit.unwrap_or(200).clamp(1, 5_000);
        let prefix = request.prefix.unwrap_or_default();
        let prefix = prefix.trim_matches('/').to_owned();
        blocking_json(move || {
            let vfs = super::open_vfs(None)?;
            let mut directories = std::collections::BTreeSet::new();
            let mut files = Vec::new();
            let mut file_count = 0usize;
            for (path, entry) in vfs.iter() {
                let rest = if prefix.is_empty() {
                    path
                } else if let Some(rest) = path
                    .strip_prefix(&prefix)
                    .and_then(|rest| rest.strip_prefix('/'))
                {
                    rest
                } else {
                    continue;
                };
                if let Some((directory, _)) = rest.split_once('/') {
                    directories.insert(directory.to_owned());
                } else {
                    file_count += 1;
                    if files.len() < limit {
                        files.push(json!({
                            "name": rest,
                            "path": path,
                            "cpk": entry.cpk_filename,
                            "size": entry.file_size
                        }));
                    }
                }
            }
            let directories = directories.into_iter().collect::<Vec<_>>();
            let directory_count = directories.len();
            let visible_directories = directories
                .into_iter()
                .take(limit)
                .collect::<Vec<_>>();
            let remaining = limit.saturating_sub(visible_directories.len());
            files.truncate(remaining);
            let truncated = directory_count > visible_directories.len() || file_count > files.len();
            Ok(json!({
                "prefix": if prefix.is_empty() { "(root)".to_owned() } else { format!("{prefix}/") },
                "directories": visible_directories,
                "files": files,
                "total_directories": directory_count,
                "total_files": file_count,
                "truncated": truncated
            }))
        })
        .await
    }

    #[tool(
        name = "vfs_search",
        description = "Search VFS paths by case-insensitive substring or glob. Compatibility name retained from the Bun server."
    )]
    async fn compatibility_vfs_search(
        &self,
        Parameters(request): Parameters<VfsSearchRequest>,
    ) -> CompatibilityResult {
        let limit = request.limit.unwrap_or(100).clamp(1, 2_000);
        let query = request.query.trim().to_owned();
        blocking_json(move || {
            anyhow::ensure!(
                !query.is_empty() && query.len() <= 16 * 1024,
                "invalid query"
            );
            let vfs = super::open_vfs(None)?;
            let glob = query
                .chars()
                .any(|c| matches!(c, '*' | '?' | '[' | ']' | '{' | '}'));
            let matcher = glob
                .then(|| globset::Glob::new(&query).map(|glob| glob.compile_matcher()))
                .transpose()?;
            let folded = query.to_ascii_lowercase();
            let mut total = 0usize;
            let mut matches = Vec::new();
            for (path, entry) in vfs.iter() {
                let matched = matcher.as_ref().map_or_else(
                    || path.to_ascii_lowercase().contains(&folded),
                    |matcher| matcher.is_match(path),
                );
                if !matched {
                    continue;
                }
                total += 1;
                if matches.len() < limit {
                    matches.push(json!({ "name": path.rsplit('/').next(), "path": path, "cpk": entry.cpk_filename, "size": entry.file_size }));
                }
            }
            Ok(
                json!({ "query": query, "mode": if glob { "glob" } else { "substring" }, "total_matches": total, "matches": matches, "truncated": total > matches.len() }),
            )
        })
        .await
    }

    #[tool(
        name = "vfs_stat",
        description = "Return VFS metadata for an exact file or folder prefix."
    )]
    async fn compatibility_vfs_stat(
        &self,
        Parameters(request): Parameters<PathRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            let path = safe_vfs_path(&request.path).map_err(anyhow::Error::msg)?;
            let vfs = super::open_vfs(None)?;
            if let Some(entry) = vfs.find(path) {
                let decode = decode_kind(path);
                return Ok(
                    json!({ "kind": "file", "path": path, "cpk": entry.cpk_filename, "ext": vfs_extension(path), "decode": decode, "decodable": decode != "raw", "size": entry.file_size, "readable": vfs.is_readable(path) }),
                );
            }
            let prefix = format!("{}/", path.trim_end_matches('/'));
            let children = vfs
                .iter()
                .filter(|(candidate, _)| candidate.starts_with(&prefix))
                .count();
            if children > 0 {
                Ok(json!({ "kind": "directory", "path": path, "child_count": children }))
            } else {
                Ok(json!({ "kind": "missing", "path": path }))
            }
        })
        .await
    }

    #[tool(
        name = "vfs_cat",
        description = "Read bounded bytes from one VFS file and return UTF-8 text or base64."
    )]
    async fn compatibility_vfs_cat(
        &self,
        Parameters(request): Parameters<VfsCatRequest>,
    ) -> CompatibilityResult {
        use base64::Engine as _;
        blocking_json(move || {
            let path = safe_vfs_path(&request.path).map_err(anyhow::Error::msg)?;
            let cap = request
                .max_bytes
                .unwrap_or(256 * 1024)
                .clamp(1, 8 * 1024 * 1024);
            let vfs = super::open_vfs(None)?;
            let entry = vfs
                .find(path)
                .ok_or_else(|| anyhow::anyhow!("path not found in VFS"))?;
            let data = vfs
                .read(path)
                .map_err(|error| anyhow::anyhow!("VFS read failed: {error}"))?;
            let truncated = data.len() > cap;
            let slice = &data[..data.len().min(cap)];
            let mut value = json!({ "path": path, "cpk": entry.cpk_filename, "size": data.len(), "truncated": truncated });
            let extension = vfs_extension(path);
            let textual = ["txt", "json", "lua", "xml"]
                .iter()
                .any(|candidate| extension.contains(candidate));
            if textual
                && let Ok(text) = std::str::from_utf8(slice)
            {
                value["text"] = Value::String(text.to_owned());
            } else {
                value["base64"] =
                    Value::String(base64::engine::general_purpose::STANDARD.encode(slice));
            }
            Ok(value)
        })
        .await
    }

    #[tool(
        name = "asset_get",
        description = "Read and decode a VFS asset in process as raw bytes, JSON, PNG, or WAV; model codes use the bounded native HTTP client for nie-model-serve."
    )]
    async fn compatibility_asset_get(
        &self,
        Parameters(request): Parameters<AssetRequest>,
    ) -> CompatibilityResult {
        use base64::Engine as _;
        if request.decode.as_deref() == Some("model") {
            return fetch_model_asset(request).await;
        }
        blocking_json(move || {
            let path = safe_vfs_path(&request.path).map_err(anyhow::Error::msg)?;
            let decode = request.decode.as_deref().unwrap_or("raw");
            let cap = request
                .max_bytes
                .unwrap_or(256 * 1024)
                .clamp(1, 8 * 1024 * 1024);
            let vfs = super::open_vfs(None)?;
            let source = vfs
                .read(path)
                .map_err(|error| anyhow::anyhow!("VFS read failed: {error}"))?;
            let (bytes, content_type) = match decode {
                "raw" => (source, "application/octet-stream"),
                "cfg" => {
                    let decoded = nie_formats::decode::decode(&source)
                        .ok_or_else(|| anyhow::anyhow!("format is not decodable as JSON"))?;
                    (decoded.json, "application/json")
                }
                "tex" => {
                    let png = nie_formats::g4tx_decode::decode_best_to_png(
                        &source,
                        nie_formats::g4tx_decode::basename_of(path),
                    )
                    .ok_or_else(|| anyhow::anyhow!("texture could not be decoded"))?;
                    (png, "image/png")
                }
                "audio" => (
                    nie_formats::cri_audio::decode_to_wav(&source).map_err(anyhow::Error::msg)?,
                    "audio/wav",
                ),
                other => anyhow::bail!("unknown decode mode: {other}"),
            };
            let truncated = bytes.len() > cap;
            let slice = &bytes[..bytes.len().min(cap)];
            let mut value = json!({ "path": path, "decode": decode, "source": "rust-native", "url": format!("nie://{path}"), "http_status": 200, "content_type": content_type, "content_length": bytes.len(), "truncated": truncated });
            if content_type == "application/json" {
                value["text"] = Value::String(String::from_utf8_lossy(slice).into_owned());
            } else if !truncated {
                value["base64"] =
                    Value::String(base64::engine::general_purpose::STANDARD.encode(slice));
            }
            Ok(value)
        })
        .await
    }

    #[tool(
        name = "re_query",
        description = "Run a read-only SQL query through the canonical `niers wiki db` library path."
    )]
    async fn compatibility_re_query(
        &self,
        Parameters(request): Parameters<QueryRequest>,
    ) -> CompatibilityResult {
        let limit = request.limit.unwrap_or(50).clamp(1, 1_000);
        blocking_json(move || {
            let connection = open_re_database()?;
            let (rows, truncated, columns) = query_re_rows(&connection, &request.sql, limit)?;
            Ok(json!({ "rows": rows, "truncated": truncated, "columns": columns }))
        })
        .await
    }

    #[tool(
        name = "re_function",
        description = "Find reverse-engineered functions by name fragment or virtual address."
    )]
    async fn compatibility_re_function(
        &self,
        Parameters(request): Parameters<FunctionRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            let predicate = match (request.name.as_deref(), request.vaddr.as_deref()) {
                (Some(name), _) if !name.trim().is_empty() => {
                    format!("name LIKE '%{}%'", name.replace('\'', "''"))
                }
                (_, Some(vaddr)) if !vaddr.trim().is_empty() => {
                    format!("vaddr = {}", super::parse_addr(vaddr).map_err(anyhow::Error::msg)?)
                }
                _ => anyhow::bail!("re_function requires name or vaddr"),
            };
            let connection = open_re_database()?;
            let columns = "id, binary_id, vaddr, size, name, name_source, confidence, cc, n_args, subsystem, role, pagerank, ret_type, params, n_calls_in, n_calls_out, complexity";
            let sql = format!(
                "SELECT {columns} FROM function WHERE {predicate} ORDER BY pagerank DESC, binary_id LIMIT 25"
            );
            let (matches, _, _) = query_re_rows(&connection, &sql, 25)?;
            let mut result = json!({
                "query": { "name": request.name, "vaddr": request.vaddr },
                "total_matches": matches.len(),
                "matches": matches
            });
            if let Some(best) = result["matches"].as_array().and_then(|rows| rows.first()) {
                let binary_id = best["binary_id"]
                    .as_i64()
                    .ok_or_else(|| anyhow::anyhow!("function row has no binary_id"))?;
                let address = best["vaddr"]
                    .as_str()
                    .and_then(|value| value.strip_prefix("0x"))
                    .and_then(|value| i64::from_str_radix(value, 16).ok())
                    .ok_or_else(|| anyhow::anyhow!("function row has no vaddr"))?;
                let incoming_sql = format!(
                    "SELECT x.from_addr, x.kind, f.name AS from_name FROM xref x LEFT JOIN function f ON f.vaddr = x.from_addr AND f.binary_id = x.binary_id WHERE x.to_addr = {address} AND x.binary_id = {binary_id} LIMIT 12"
                );
                let outgoing_sql = format!(
                    "SELECT x.to_addr, x.kind, f.name AS to_name FROM xref x LEFT JOIN function f ON f.vaddr = x.to_addr AND f.binary_id = x.binary_id WHERE x.from_addr = {address} AND x.binary_id = {binary_id} LIMIT 12"
                );
                let (incoming, _, _) = query_re_rows(&connection, &incoming_sql, 12)?;
                let (outgoing, _, _) = query_re_rows(&connection, &outgoing_sql, 12)?;
                result["xrefs"] = json!({
                    "of": best["name"].as_str().map_or_else(|| format!("0x{address:x}"), str::to_owned),
                    "incoming": incoming,
                    "outgoing": outgoing
                });
            }
            Ok(result)
        })
        .await
    }

    #[tool(
        name = "re_coverage",
        description = "Return the current reverse-engineering coverage report from the canonical CLI library."
    )]
    async fn compatibility_re_coverage(&self) -> CompatibilityResult {
        blocking_json(move || {
            let connection = open_re_database()?;
            let (latest, _, _) = query_re_rows(
                &connection,
                "SELECT ts, binary_id, total_funcs, named, classified, pct FROM coverage ORDER BY id DESC LIMIT 1",
                1,
            )?;
            let (total, _, _) = query_re_rows(
                &connection,
                "SELECT COUNT(*) AS n FROM function",
                1,
            )?;
            let (per_binary, _, _) = query_re_rows(
                &connection,
                "SELECT binary_id, COUNT(*) AS rows_total, SUM(name IS NOT NULL) AS named FROM function GROUP BY binary_id ORDER BY binary_id",
                1_000,
            )?;
            Ok(json!({
                "latest": latest.into_iter().next(),
                "function_rows_total": total.first().and_then(|row| row["n"].as_i64()).unwrap_or(0),
                "per_binary": per_binary,
                "primary_binary_id": 2
            }))
        })
        .await
    }

    #[tool(
        name = "repo_read",
        description = "Read one bounded source or documentation file through nie-explore's confined repository API."
    )]
    async fn compatibility_repo_read(
        &self,
        Parameters(request): Parameters<RepoReadRequest>,
    ) -> CompatibilityResult {
        blocking_json(move || {
            let root = std::env::var_os("NIERS_REPO")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
                });
            let file = nie_explore::depot::Depot::ouvrir(root)
                .and_then(|depot| depot.lire(&request.path, request.max_bytes))
                .map_err(anyhow::Error::msg)?;
            Ok(json!({
                "path": file.chemin,
                "abs_path": file.chemin_absolu,
                "size": file.taille,
                "truncated": file.tronque,
                "binary": file.binaire,
                "content": file.contenu,
                "note": file.note
            }))
        })
        .await
    }

    #[tool(
        name = "explorer_status",
        description = "Report whether the native loopback bridge is listening and whether an Inacord explorer client is connected."
    )]
    async fn compatibility_explorer_status(&self) -> CompatibilityResult {
        Ok(json_text(self.bridge.status().await))
    }

    #[tool(
        name = "explorer_navigate",
        description = "Navigate the connected explorer to a VFS prefix and optionally select one entry."
    )]
    async fn compatibility_explorer_navigate(
        &self,
        Parameters(request): Parameters<ExplorerNavigateRequest>,
    ) -> CompatibilityResult {
        if request.prefix.contains('\0')
            || request
                .select
                .as_deref()
                .is_some_and(|value| value.contains('\0'))
        {
            return Err(error_text("invalid explorer path"));
        }
        self.bridge
            .send(json!({ "cmd": "navigate", "prefix": request.prefix, "select": request.select }))
            .await
            .map(json_text)
            .map_err(error_text)
    }

    #[tool(
        name = "explorer_open",
        description = "Open one VFS file in the connected explorer detail panel."
    )]
    async fn compatibility_explorer_open(
        &self,
        Parameters(request): Parameters<PathRequest>,
    ) -> CompatibilityResult {
        let path = match safe_vfs_path(&request.path) {
            Ok(path) => path,
            Err(error) => return Err(error_text(error)),
        };
        self.bridge
            .send(json!({ "cmd": "open", "path": path }))
            .await
            .map(json_text)
            .map_err(error_text)
    }

    #[tool(
        name = "explorer_tab",
        description = "Switch the connected explorer to one known tab: editor, explorer, search, data, cpk, save, mods, re, lua, or settings."
    )]
    async fn compatibility_explorer_tab(
        &self,
        Parameters(request): Parameters<ExplorerTabRequest>,
    ) -> CompatibilityResult {
        const TABS: [&str; 10] = [
            "editor", "explorer", "search", "data", "cpk", "save", "mods", "re", "lua", "settings",
        ];
        if !TABS.contains(&request.tab.as_str()) {
            return Err(error_text("unknown explorer tab"));
        }
        self.bridge
            .send(json!({ "cmd": "tab", "tab": request.tab }))
            .await
            .map(json_text)
            .map_err(error_text)
    }

    #[tool(
        name = "explorer_toast",
        description = "Display an info, success, or error notification in the connected explorer."
    )]
    async fn compatibility_explorer_toast(
        &self,
        Parameters(request): Parameters<ExplorerToastRequest>,
    ) -> CompatibilityResult {
        let kind = request.kind.as_deref().unwrap_or("info");
        if request.message.is_empty() || request.message.contains('\0') {
            return Err(error_text("invalid toast message"));
        }
        if !["info", "success", "error"].contains(&kind) {
            return Err(error_text("unknown toast kind"));
        }
        self.bridge
            .send(json!({ "cmd": "toast", "message": request.message, "kind": kind }))
            .await
            .map(json_text)
            .map_err(error_text)
    }

    #[tool(
        name = "game_launch",
        description = "Launch nie.exe from the repository root without waiting and return its process ID."
    )]
    async fn compatibility_game_launch(
        &self,
        Parameters(request): Parameters<GameLaunchRequest>,
    ) -> CompatibilityResult {
        let result = tokio::task::spawn_blocking(move || launch_game(request.args)).await;
        match result {
            Ok(Ok(value)) => Ok(json_text(value)),
            Ok(Err(error)) => Err(error_text(error)),
            Err(error) => Err(error_text(format!("game launch worker failed: {error}"))),
        }
    }
}

fn launch_game(args: Vec<String>) -> anyhow::Result<Value> {
    anyhow::ensure!(args.len() <= 128, "too many game arguments");
    anyhow::ensure!(
        args.iter()
            .all(|arg| arg.len() <= 16 * 1024 && !arg.contains('\0')),
        "invalid game argument"
    );
    let root = std::env::var_os("NIERS_REPO")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."));
    let configured = std::env::var_os("NIERS_GAME_EXE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("nie.exe"));
    let executable = if configured.is_absolute() {
        configured
    } else {
        root.join(configured)
    };
    anyhow::ensure!(
        executable.is_file(),
        "executable not found: {}",
        executable.display()
    );
    let mut child = std::process::Command::new(&executable)
        .args(&args)
        .current_dir(&root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    let pid = child.id();
    let _ = std::thread::Builder::new()
        .name(format!("niers-game-reaper-{pid}"))
        .spawn(move || {
            let _ = child.wait();
        });
    Ok(json!({
        "ok": true,
        "exe": executable,
        "pid": pid,
        "args": args
    }))
}

impl NiersMcpServer {
    fn all_tools() -> ToolRouter<Self> {
        Self::tool_router() + Self::compatibility_router()
    }
}

#[tool_handler(router = Self::all_tools())]
impl ServerHandler for NiersMcpServer {
    fn get_info(&self) -> rmcp::model::ServerInfo {
        let mut implementation = rmcp::model::Implementation::default();
        "niers-game".clone_into(&mut implementation.name);
        env!("CARGO_PKG_VERSION").clone_into(&mut implementation.version);

        let mut info = rmcp::model::ServerInfo::default();
        info.protocol_version = rmcp::model::ProtocolVersion::V_2024_11_05;
        info.capabilities = rmcp::model::ServerCapabilities::builder()
            .enable_tools()
            .build();
        info.server_info = implementation;
        info.instructions = Some(
            "Native Rust MCP binding for the complete niers CLI. Each cli_* tool executes the corresponding top-level command in process and accepts the exact argument tail in `args`. Responses contain success, stdout, stderr, and error fields. Call tools/list for the authoritative surface."
                .to_owned(),
        );
        info
    }
}

/// Serve the complete native tool catalogue over stdio.
pub async fn serve_stdio() -> anyhow::Result<()> {
    let server = NiersMcpServer::default();
    server.bridge.start().await;
    let service = server.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn router_covers_every_non_mcp_top_level_command() {
        use clap::CommandFactory as _;

        let tools = NiersMcpServer::all_tools().list_all();
        assert_eq!(tools.len(), 56);
        let commands = crate::Cli::command()
            .get_subcommands()
            .map(clap::Command::get_name)
            .filter(|name| *name != "mcp")
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(commands.len(), 40);
        for command in commands {
            let tool_name = format!("cli_{}", command.replace('-', "_"));
            assert!(
                tools.iter().any(|tool| tool.name == tool_name),
                "missing MCP tool for `niers {command}`"
            );
        }
        assert!(
            tools
                .iter()
                .all(|tool| tool.input_schema.contains_key("properties"))
        );
    }

    #[test]
    fn captured_command_never_leaks_to_process_stdout() {
        let result = crate::execute_captured("info".to_owned(), vec!["--json".to_owned()]);
        assert!(result.success, "{:?}", result.error);
        assert!(result.stdout.contains("\"binaire\""));
    }

    #[test]
    fn compatibility_paths_keep_the_legacy_vfs_contract() {
        assert_eq!(
            safe_vfs_path("data/dx11/file.g4tx"),
            Ok("data/dx11/file.g4tx")
        );
        assert!(safe_vfs_path("/data/file.g4tx").is_err());
        assert!(safe_vfs_path("data\\file.g4tx").is_err());
        assert!(safe_vfs_path("data/../file.g4tx").is_err());
        assert_eq!(vfs_extension("data/example.cfg.bin"), ".cfg.bin");
        assert_eq!(vfs_extension("data/example.lua"), ".lua");
    }

    #[test]
    fn re_queries_are_read_only_bounded_and_address_safe() {
        let connection = nie_index::rusqlite::Connection::open_in_memory().expect("memory DB");
        connection
            .execute_batch(
                "CREATE TABLE sample (vaddr INTEGER, name TEXT, big INTEGER);\
                 INSERT INTO sample VALUES\
                   (5368709120, 'first', 9007199254740992),\
                   (5368709121, 'second', 2);",
            )
            .expect("fixture schema");
        let (rows, truncated, columns) = query_re_rows(
            &connection,
            "SELECT vaddr, name, big FROM sample ORDER BY vaddr",
            1,
        )
        .expect("read-only query");
        assert_eq!(columns, ["vaddr", "name", "big"]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["vaddr"], "0x140000000");
        assert_eq!(rows[0]["big"], "9007199254740992");
        assert!(truncated);
        assert!(query_re_rows(&connection, "DELETE FROM sample", 1).is_err());
    }

    #[tokio::test]
    async fn model_asset_compatibility_uses_the_bounded_native_http_client() {
        use std::io::{Read as _, Write as _};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("loopback listener");
        let address = listener.local_addr().expect("listener address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("model request");
            let mut request = [0_u8; 1_024];
            let length = stream.read(&mut request).expect("read request");
            let request = String::from_utf8_lossy(&request[..length]);
            assert!(request.starts_with("GET /model-full/c01000010.glb HTTP/1.1"));
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: model/gltf-binary\r\nContent-Length: 3\r\nConnection: close\r\n\r\nglb",
                )
                .expect("write response");
        });

        let response = fetch_model_asset_from(
            AssetRequest {
                path: "characters/c01000010.glb".to_owned(),
                decode: Some("model".to_owned()),
                max_bytes: Some(32),
            },
            &format!("http://{address}"),
        )
        .await
        .expect("model asset response");
        server.join().expect("model server");
        let value: Value = serde_json::from_str(&response).expect("JSON response");
        assert_eq!(value["source"], "model-serve");
        assert_eq!(value["http_status"], 200);
        assert_eq!(value["content_length"], 3);
        assert_eq!(value["base64"], "Z2xi");
        assert_eq!(value["truncated"], false);
    }

    #[test]
    fn native_server_is_reachable_from_the_niers_cli() {
        use clap::Parser as _;

        let cli = crate::Cli::try_parse_from(["niers", "mcp"]).expect("parse MCP command");
        assert!(matches!(cli.cmd, crate::Cmd::Mcp));
    }
}
