// SPDX-License-Identifier: Apache-2.0
//! Naive bridge from niers to the local `.aphrody` state and Aphrody surfaces.
//!
//! Connects and probes:
//! - `.aphrody` state directory (`~/.aphrody` or `$APHRODY_HOME`)
//! - Web surface (`http://127.0.0.1:8083`, aphrody-site sovereign origin)
//! - MCP surface (`aphrody-mcp` stdio binary and `/mcp` HTTP endpoint)
//! - API surface (`/api/v1/health`, `/api/v1/openapi.json`, `/api/v1/ecosystem`, etc.)
//! - SQL surface (SQLite `yoyo.sqlite`, `knowledge.db`, and PostgreSQL `aphrody`)
//! - Redis surface (`127.0.0.1:6379`, key prefixes)
//! - Git surface (`/home/ubuntu/aphrody`, `aphrody-git` ecosystem)
//! - SSH surface (port 22, VPS and DBFR target profiles)
//! - Memory surface (`~/.aphrody/workspace/memory/`, markdown sheets and memory_items)
//! - Agent-Home surface (`~/.aphrody/workspace`, `profiles.json`, active profile)
//! - RAG surface (`~/.aphrody/models/embeddings`, FastEmbed models, vector search)

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Environment variable that overrides the aphrody state directory.
pub const ENV_APHRODY_HOME: &str = "APHRODY_HOME";

/// Returns the resolved canonical `.aphrody` state directory.
#[must_use]
pub fn resolve_aphrody_dir() -> PathBuf {
    if let Ok(dir) = std::env::var(ENV_APHRODY_HOME)
        && !dir.trim().is_empty()
    {
        return PathBuf::from(dir);
    }
    if let Ok(home) = std::env::var("HOME")
        && !home.trim().is_empty()
    {
        return PathBuf::from(home).join(".aphrody");
    }
    PathBuf::from("/home/ubuntu/.aphrody")
}

/// Helper to test if a local TCP port is currently open and accepting connections.
fn is_tcp_open(port: u16, timeout_ms: u64) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).is_ok()
}

/// Web & HTTP Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSurface {
    /// Public origin.
    pub origin: String,
    /// Loopback bind address.
    pub bind: String,
    /// Whether the port is currently open and listening.
    pub active: bool,
    /// Core exposed routes.
    pub routes: Vec<String>,
}

/// MCP Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpSurface {
    /// Public MCP HTTP endpoint.
    pub http_endpoint: String,
    /// Stdio binary name.
    pub stdio_binary: String,
    /// Whether the MCP origin is responsive.
    pub active: bool,
    /// Default tool count in aphrody-mcp.
    pub default_tools_count: usize,
    /// Toolbox tool count in aphrody-mcp.
    pub toolbox_tools_count: usize,
    /// Implemented protocol.
    pub protocol: String,
}

/// API Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSurface {
    /// Base API URL.
    pub base_url: String,
    /// Exposed REST endpoints.
    pub endpoints: Vec<String>,
    /// OpenAPI 3.1.0 spec URL.
    pub openapi_url: String,
    /// A2A agent card URL.
    pub agent_card_url: String,
}

/// SQL / Database Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlSurface {
    /// Path to the Yoyo X bot SQLite database.
    pub yoyo_sqlite_path: String,
    /// Whether `yoyo.sqlite` exists on disk.
    pub yoyo_sqlite_exists: bool,
    /// Size of `yoyo.sqlite` in bytes.
    pub yoyo_sqlite_size_bytes: u64,
    /// Path to the agent knowledge base SQLite database.
    pub knowledge_db_path: String,
    /// Whether `knowledge.db` exists.
    pub knowledge_db_exists: bool,
    /// Local PostgreSQL connection URL.
    pub postgres_url: String,
    /// Whether PostgreSQL is actively listening on port 5432.
    pub postgres_active: bool,
}

/// Redis Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisSurface {
    /// Redis host.
    pub host: String,
    /// Redis port.
    pub port: u16,
    /// Whether Redis is actively listening.
    pub active: bool,
    /// Core cached key prefixes.
    pub key_prefixes: Vec<String>,
}

/// Git Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSurface {
    /// Path to local aphrody Git clone.
    pub repo_path: String,
    /// Whether the Git clone exists.
    pub repo_exists: bool,
    /// Managed ecosystem CI workflow.
    pub managed_workflow: String,
    /// Current Git HEAD reference if resolvable.
    pub head_commit: Option<String>,
}

/// SSH Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSurface {
    /// Standard SSH port.
    pub port: u16,
    /// Whether local SSH daemon is active on port 22.
    pub local_active: bool,
    /// Configured remote targets.
    pub targets: Vec<BTreeMap<String, String>>,
}

/// Memory Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySurface {
    /// Path to persistent markdown sheets.
    pub memory_dir: String,
    /// Whether the memory directory exists.
    pub exists: bool,
    /// Number of markdown memory documents available.
    pub markdown_count: usize,
    /// Supported memory provider engines.
    pub providers: Vec<String>,
}

/// Agent-Home Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentHomeSurface {
    /// Agent workspace directory.
    pub workspace_dir: String,
    /// Whether the workspace exists.
    pub exists: bool,
    /// Path to profiles config.
    pub profiles_path: String,
    /// Active profile name.
    pub active_profile: Option<String>,
}

/// RAG & Embeddings Surface definition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagSurface {
    /// Path to model weights directory.
    pub models_dir: String,
    /// Default embedding model identifier.
    pub default_model: String,
    /// Vector embedding dimension.
    pub vector_dimension: usize,
    /// Target chunk table name.
    pub chunks_table: String,
}

/// Complete probed inventory of Aphrody surfaces bridged from niers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AphrodySurfaces {
    /// Resolved `.aphrody` root path.
    pub state_dir: String,
    /// Whether the state directory exists.
    pub state_dir_exists: bool,
    /// Web surface.
    pub web: WebSurface,
    /// MCP surface.
    pub mcp: McpSurface,
    /// API surface.
    pub api: ApiSurface,
    /// SQL surface.
    pub sql: SqlSurface,
    /// Redis surface.
    pub redis: RedisSurface,
    /// Git surface.
    pub git: GitSurface,
    /// SSH surface.
    pub ssh: SshSurface,
    /// Memory surface.
    pub memory: MemorySurface,
    /// Agent-home surface.
    pub agent_home: AgentHomeSurface,
    /// RAG surface.
    pub rag: RagSurface,
}

/// Probes all Aphrody surfaces locally.
#[must_use]
pub fn probe_surfaces() -> AphrodySurfaces {
    let state_dir = resolve_aphrody_dir();
    let state_dir_exists = state_dir.is_dir();

    // 1. Web & API (:8083)
    let web_active = is_tcp_open(8083, 50);
    let web = WebSurface {
        origin: "https://aphrody.com".into(),
        bind: "127.0.0.1:8083".into(),
        active: web_active,
        routes: vec![
            "/".into(),
            "/healthz".into(),
            "/api/v1/openapi.json".into(),
            "/api/v1/ecosystem".into(),
            "/mcp".into(),
            "/sitemap.xml".into(),
            "/llms.txt".into(),
        ],
    };

    let api = ApiSurface {
        base_url: "https://api.aphrody.com/api/v1".into(),
        endpoints: vec![
            "/health".into(),
            "/openapi.json".into(),
            "/ecosystem".into(),
            "/models".into(),
            "/rag/query".into(),
            "/rag/stats".into(),
            "/seo/strategy".into(),
            "/bxc/rankings".into(),
        ],
        openapi_url: "https://api.aphrody.com/api/v1/openapi.json".into(),
        agent_card_url: "https://aphrody.com/.well-known/agent-card.json".into(),
    };

    // 2. MCP
    let mcp = McpSurface {
        http_endpoint: "https://aphrody.com/mcp".into(),
        stdio_binary: "aphrody-mcp".into(),
        active: web_active,
        default_tools_count: 38,
        toolbox_tools_count: 43,
        protocol: "rmcp JSON-RPC 2.0".into(),
    };

    // 3. SQL / SQLite / Postgres
    let yoyo_path = state_dir.join("yoyo.sqlite");
    let yoyo_exists = yoyo_path.is_file();
    let yoyo_size = if yoyo_exists {
        std::fs::metadata(&yoyo_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let knowledge_path = state_dir.join("workspace").join("knowledge.db");
    let knowledge_exists = knowledge_path.is_file();
    let pg_active = is_tcp_open(5432, 50);

    let sql = SqlSurface {
        yoyo_sqlite_path: yoyo_path.display().to_string(),
        yoyo_sqlite_exists: yoyo_exists,
        yoyo_sqlite_size_bytes: yoyo_size,
        knowledge_db_path: knowledge_path.display().to_string(),
        knowledge_db_exists: knowledge_exists,
        postgres_url: "postgresql://aphrody:aphrody_sovereign_2026@127.0.0.1:5432/aphrody".into(),
        postgres_active: pg_active,
    };

    // 4. Redis
    let redis_active = is_tcp_open(6379, 50);
    let redis = RedisSurface {
        host: "127.0.0.1".into(),
        port: 6379,
        active: redis_active,
        key_prefixes: vec![
            "aphrody:rag:*".into(),
            "aphrody:bxc:*".into(),
            "aphrody:session:*".into(),
            "aphrody:cache:*".into(),
        ],
    };

    // 5. Git
    let git_repo = Path::new("/home/ubuntu/aphrody");
    let git_exists = git_repo.is_dir() && git_repo.join(".git").exists();
    let head_commit = if git_exists {
        std::fs::read_to_string(git_repo.join(".git/HEAD"))
            .ok()
            .map(|s| s.trim().to_string())
    } else {
        None
    };
    let git = GitSurface {
        repo_path: git_repo.display().to_string(),
        repo_exists: git_exists,
        managed_workflow: ".github/workflows/consumer-audit.yml".into(),
        head_commit,
    };

    // 6. SSH
    let ssh_active = is_tcp_open(22, 50);
    let mut vps_target = BTreeMap::new();
    vps_target.insert("alias".into(), "vps".into());
    vps_target.insert("host".into(), "51.77.147.152".into());
    vps_target.insert("user".into(), "ubuntu".into());

    let mut dbfr_target = BTreeMap::new();
    dbfr_target.insert("alias".into(), "dbfr".into());
    dbfr_target.insert("host".into(), "51.255.162.6".into());
    dbfr_target.insert("user".into(), "ubuntu".into());

    let ssh = SshSurface {
        port: 22,
        local_active: ssh_active,
        targets: vec![vps_target, dbfr_target],
    };

    // 7. Memory
    let memory_dir = state_dir.join("workspace").join("memory");
    let memory_exists = memory_dir.is_dir();
    let markdown_count = if memory_exists {
        std::fs::read_dir(&memory_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().and_then(|ext| ext.to_str()) == Some("md"))
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };
    let memory = MemorySurface {
        memory_dir: memory_dir.display().to_string(),
        exists: memory_exists,
        markdown_count,
        providers: vec![
            "Sqlite".into(),
            "Jsonl".into(),
            "LanceDb".into(),
            "Hnsw".into(),
            "Mem0".into(),
            "Honcho".into(),
        ],
    };

    // 8. Agent-Home & Profiles
    let workspace_dir = state_dir.join("workspace");
    let ws_exists = workspace_dir.is_dir();
    let profiles_file = state_dir.join("profiles.json");
    let active_profile = if profiles_file.is_file() {
        std::fs::read_to_string(&profiles_file)
            .ok()
            .and_then(|content| {
                serde_json::from_str::<serde_json::Value>(&content).ok().and_then(|val| {
                    val.get("active_profile").and_then(|v| v.as_str()).map(String::from)
                })
            })
    } else {
        None
    };

    let agent_home = AgentHomeSurface {
        workspace_dir: workspace_dir.display().to_string(),
        exists: ws_exists,
        profiles_path: profiles_file.display().to_string(),
        active_profile,
    };

    // 9. RAG
    let models_dir = state_dir.join("models");
    let rag = RagSurface {
        models_dir: models_dir.display().to_string(),
        default_model: "all-minilm-l6-v2".into(),
        vector_dimension: 384,
        chunks_table: "aphrody_rag_chunks".into(),
    };

    AphrodySurfaces {
        state_dir: state_dir.display().to_string(),
        state_dir_exists,
        web,
        mcp,
        api,
        sql,
        redis,
        git,
        ssh,
        memory,
        agent_home,
        rag,
    }
}
