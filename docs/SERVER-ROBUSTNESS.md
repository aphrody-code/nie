# Server robustness and resilience architecture

This document specifies the server landscape, runtime libraries, and resilience hardening
implemented across the repository's three production server crates: `nie-site`, `nie-model-serve`,
and `nie-net`.

## 1. Server landscape and port allocation

Ports and public routes are owned by aphrody-infra (`config/service-catalog.json`,
`config/nginx-routes.json`, `nginx/aphrody/aphrody.com.conf`):

| Server crate | Port | Protocol & Runtime | Primary responsibilities |
|---|---|---|---|
| **`nie-site`** (`crates/tools/nie-site`) | `127.0.0.1:8085` | HTTP/1.1, HTTP/2 (TLS via nginx reverse proxy). **Axum 0.8** on multi-threaded **Tokio 1**. | Backend of `nie.aphrody.com` (`/api/`, gated `/f` `/b`, `/health`); serves the static game bundle on its own origin, GraphQL APIs (`texts`, `assets`), REST catalog, Lua inspector, and SSR templates. |
| **`nie-model-serve`** (`crates/tools/nie-model-serve`) | `127.0.0.1:8790` | HTTP/1.1 TCP daemon. Multi-threaded synchronous worker pool (`std::net::TcpListener`). | Serves `nie.aphrody.com/cdn/` (rate limited by the vhost), on-demand 3D model, character, and avatar GLB assembly, G4TX texture decoding, and disk cache. |
| **`nie-net`** (`crates/engine/nie-net`) | `0.0.0.0:4295` | WebSocket (`tokio-tungstenite`) on **Tokio 1**. | Real-time multiplayer daemon: Kizuna town rooms, lockstep 60 Hz deterministic match simulation, matchmaking, ELO and competitive ladder. |

---

## 2. Library research and evaluation

### `nie-site` (`crates/tools/nie-site`)
- **Web framework (`axum 0.8.8`)**: Lightweight, composable HTTP routing built on `tower` and `hyper 1.0`. Provides zero-cost abstractions, extractors, and modular middleware.
- **Middleware stack (`tower 0.5.2`, `tower-http 0.6.11`)**:
  - `CatchPanicLayer`: Catches panics occurring in async route handlers or extractor pipelines, preventing connection termination and generating structured RFC 7807 / JSON 500 responses.
  - `DefaultBodyLimit`: Explicit request payload bounding to prevent memory exhaustion DoS.
  - `CompressionLayer`: Fast gzip / Brotli streaming response compression.
  - `TraceLayer`: Request lifecycle distributed tracing without leaking sensitive headers.
- **In-memory cache (`moka 0.12.10`)**: High-performance, concurrent, lock-free LRU/TinyLFU cache used for fast lookup of localized string dictionaries and VFS metadata without thread contention.
- **Hashing (`blake3 1.8.4`)**: Cryptographic and high-throughput content-addressed cache key derivation and ETag generation.
- **Storage engine (`rusqlite 0.37.0`)**: Embedded SQLite accessed with pooled, read-only connections (`r2d2_sqlite 0.25`).

### `nie-model-serve` (`crates/tools/nie-model-serve`)
- **Networking (`std::net::TcpListener`)**: Direct socket listener with bounded thread pool (`Pool`). Eliminates async runtime overhead for heavy synchronous CPU-bound operations (format parsing, decompression, mesh reconstruction).
- **Core engine format bindings (`nie-formats`, `nie-explore`)**: Direct native parsing of Level-5 container formats (CPK, G4TX, G4MD, G4SK, G4MT, cfg.bin).
- **Crypto & integrity (`sha2 0.10.9`)**: SHA-256 derivation for disk cache keys (`var/cache/models`, `var/cache/characters`, `var/cache/avatars`).
- **Data interchange (`serde_json 1.0.140`)**: Serialization for JSON error and health metadata payloads.

### `nie-net` (`crates/engine/nie-net`)
- **WebSocket framing (`tokio-tungstenite 0.26.2`)**: RFC 6455 compliant framing over non-blocking Tokio streams.
- **Concurrency primitives (`tokio::sync::RwLock`, `tokio::sync::mpsc`)**: Thread-safe state sharing across rooms, lobbies, and active match instances.

---

## 3. Threat model and resilience hardening

Prior to this hardening pass, several potential failure modes existed across the three servers:

| Failure vector | Root cause | Impact | Applied mitigation |
|---|---|---|---|
| **Worker thread crash on panic** (`nie-model-serve`) | Corrupted model assets, malformed avatar parts, or invalid VFS offsets triggering an unhandled panic in worker threads. | Worker threads terminated; unhandled TCP sockets closed abruptly; pool size degraded until server starvation. | Wrapped worker dispatch in `std::panic::catch_unwind(std::panic::AssertUnwindSafe(...))`. Unwind catches log errors and gracefully emit HTTP 500. Workers survive and handle subsequent requests. |
| **Lock poisoning cascade** (`nie-model-serve`) | A panic occurred while holding a `std::sync::Mutex` lock. | Subsequent requests trying to acquire the mutex failed with `PoisonError`, bricking the server. | Converted mutex acquisition to `.unwrap_or_else(|p| p.into_inner())` across the thread pool, safely recovering inner data and unblocking future jobs. |
| **Atomic disk cache safety** (`nie-model-serve`) | Direct file writes via `std::fs::write` to `var/cache/` paths. | Server crash, power loss, or concurrent writes could leave truncated, partially written GLB/image files in cache, serving broken assets indefinitely. | Implemented `atomic_write`: payload is written to a PID-and-nanosecond-unique temporary file in the target directory (`.tmp_<pid>_<nanos>_<name>`), flushed, and atomically renamed (`std::fs::rename`) into place. |
| **HTTP method compliance** (`nie-model-serve`) | Only `GET` was explicitly parsed. `HEAD` and `OPTIONS` returned 404 or hung. | CDN edge nodes or modern browsers performing CORS preflights or resource existence checks failed. | Added native `OPTIONS` preflight handling (`204 No Content` with CORS headers) and `HEAD` execution (computes headers and `Content-Length`, suppresses body transmission via thread-local state). |
| **Async panic TCP reset** (`nie-site`) | An unexpected panic in an Axum route or extractor resulted in a TCP RST at the Tokio task level. | Connection dropped abruptly with no HTTP status code; browser displays "Connection reset by peer". | Attached `tower_http::catch_panic::CatchPanicLayer::custom` in `src/app.rs`. Intercepts panics, logs stack context, and formats a clean 500 JSON response with security headers (`X-Content-Type-Options: nosniff`). |
| **Memory exhaustion DoS** (`nie-site`) | Missing default request body bounds on incoming HTTP requests. | Malicious client sending gigabytes of body data could exhaust server RAM (OOM). | Configured `axum::extract::DefaultBodyLimit::max(10 * 1024 * 1024)` (10 MiB) across all routes. |
| **SQLite disk contention** (`nie-site`) | Read-only queries accessing database files without optimized pragma configurations. | Lock overhead, temporary files written to disk, and suboptimal cache size under high concurrent load. | Configured `PRAGMA query_only = ON;`, `PRAGMA temp_store = MEMORY;`, `PRAGMA mmap_size = 268435456;` (256 MiB mmap), and `PRAGMA cache_size = -64000;` (64 MiB RAM cache) on connection pool open. |
| **Slowloris & lagger buffer overflow** (`nie-net`) | Unbounded MPSC channels streaming 60 Hz tick snapshots to clients with high packet loss or stalled sockets. | Unbounded memory growth leading to process termination. Missing handshake timeout allowed dangling half-open TCP connections. | Applied `tokio::time::timeout(Duration::from_secs(10), ...)` to the WebSocket handshake. Replaced unbounded channels with bounded `mpsc::channel::<Message>(512)` and non-blocking `try_send` drops for lagged broadcast frames. |

---

## 4. Verification gates

All changes are validated against strict compiler and test gates:

```bash
# nie-model-serve
cargo clippy -p nie-model-serve --bins --tests -- -D warnings
cargo test -p nie-model-serve

# nie-site
cargo clippy -p nie-site --lib --tests -- -D warnings
cargo test -p nie-site

# nie-net
cargo clippy -p nie-net --lib --tests -- -D warnings
cargo test -p nie-net

# whole workspace
cargo check --workspace --tests
bun run docs:check
git diff --check
```
