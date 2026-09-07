# Target architecture — `nie-web` in WebAssembly, Inacord in Rust

Decided by the user on 2026-09-07. This document is the **target**, and the table below states
what already exists so nobody re-implements it. It does not describe what runs today: for that,
read [`ARCHITECTURE.md`](ARCHITECTURE.md), which is measured.

Two goals, and only two:

1. **`nie-web` is the WebAssembly build of `nie.exe`.** Not a host for a catalogue UI — the
   engine itself, compiled to `wasm32-unknown-unknown` and running in a browser.
2. **Inacord is one Rust application suite** — Desktop, Mobile, CLI, library, MCP, Blender
   plugin — that absorbs every legacy tool: the old Azalée tools, the current Inacord inherited
   from `nie-explorer`, and every Rust crate (core, data, VFS, decoders). Every CLI is ported to
   a GUI, to a 100 % Rust MCP server, to a 100 % Rust mobile app, and to a 100 % Rust backend
   API.

## The components, and what already exists

| Component | Target runtime | Role | What exists today |
|---|---|---|---|
| `nie-web` | `wasm32-unknown-unknown` | the `nie.exe` engine, compiled for the web | `crates/engine/nie-wasm` (`WasmGame`, `wasm-bindgen`) mounted at `/` by `apps/nie-web`, which is still a **Vite/React host** |
| `inacord-core` / `inacord-data` | Rust libraries | domain logic, VFS, archive and format parsing | spread across 19 `crates/engine/*` — `nie-core`, `nie-data`, `nie-formats`, `nie-explore`, `nie-save`, `nie-lua`, … |
| `inacord-gui` | native Rust desktop | one GUI replacing the CLI surface | **does not exist** — `apps/inacord` is Tauri + React (`packages/inacord-ui`) |
| `inacord-mobile` | Rust mobile | native mobile runtime and UI | **does not exist** |
| `inacord-api` | Rust `axum` / `tokio` | network services, RPC, endpoints | `crates/tools/nie-site` (axum 0.8) and `crates/tools/nie-model-serve` already are this, under other names |
| `inacord-mcp` | Rust MCP (`rmcp`, stdio / SSE) | every tool exposed to LLMs | **TypeScript today** — `apps/nie-mcp` + `packages/nie-bridge`; the port to Rust is the work |
| `inacord-blender` | C-ABI / FFI / IPC | the Blender bridge | `plugins/niers-blender` (Python add-on) + `crates/engine/nie-ffi` (`cdylib`) — the two are not yet joined |

## The rule that makes it worth doing

**A CLI is a binding, never a home.** Logic lives in a library crate; the CLI binary, the GUI,
the mobile app, the API handler and the MCP tool are five thin callers of the same function.
There are **98 declared Cargo targets** in this workspace today, and each one that keeps its
logic in `main.rs` is a feature the GUI, the API and the MCP server cannot have.

So the order of work is fixed, and it is not negotiable:

1. extract the logic out of the binary into a library crate, with its tests;
2. make the existing CLI call that library — it must keep working, byte for byte;
3. only then add the second surface.

Adding a GUI before step 1 produces a second implementation that drifts. This repository has
paid that price already (see the memory on keeper, menu and match-sim existing three times).

## What this does not authorise

- **No mass rename in one pass.** The names above are the target. An API that is already served
  is renamed in a dedicated batch, never in passing — the rule predates this document.
- **No claim of fidelity.** `crates/engine/nie-wasm` renders a **2D placeholder**: the real menu
  is built at runtime by the C++ menu-manager driving Lua through `funcLuaMenuCommand`, a loop
  that is not ported. Compiling `nie.exe` to WebAssembly is the goal, not the current state.
- **No deletion of a working surface** to make room for its replacement. The old tool and the new
  one coexist until the new one is measured to be at least as good.

## Naming, in one line

Every file, folder, variable, type, URL, slug and JSON key is in **English**. French is only for
prose addressed to the user. Frozen product names are the exception: Azalée, Inacord, nie,
`niers`, `nie-*`, `inagle_*`.
