---
name: tauri
description: >-
  Official Tauri v2 reference — src-tauri project layout, tauri.conf.json,
  the Rust `#[tauri::command]` / `invoke_handler` bridge to the frontend,
  and the v2 permissions system (permissions/scopes/capabilities replacing
  the v1 allowlist). Use this skill whenever the user mentions Tauri, asks
  to add a Tauri command, edit `tauri.conf.json` or a `capabilities/*.json`
  file, debug an `invoke()` call from the frontend, or work on this repo's
  own Tauri app at `apps/inacord/src-tauri`. Verified against the official
  `tauri-apps/tauri-docs` (v2) via context7 — do not answer Tauri questions
  from memory, this repo's toolchain drifts (v1 allowlist vs v2 ACL).
metadata:
  version: "1.0.0"
  keywords: [tauri, tauri-v2, src-tauri, invoke, tauri.conf.json, capabilities, permissions, rust, desktop]
---

# Tauri v2 — desktop apps, Rust backend + web frontend

Tauri bundles a Rust backend around any web frontend into a small native
binary. This repo's own instance is `apps/inacord/src-tauri` (product
"Inacord", identifier `dev.niers.explorer`) — read it alongside this skill
for a real, current example rather than a toy one.

Always confirm exact API/config shape against the official docs before
writing code — use `aphrody:docs` / context7 library `/tauri-apps/tauri-docs`
(or `/tauri-apps/plugins-workspace` for official plugins). Tauri v1 → v2 was
a breaking rewrite (allowlist → permissions/ACL); training data and old
blog posts often show the dead v1 shape.

## Project structure

```text
.
├── package.json
├── index.html
├── src/                     # frontend (any framework that compiles to HTML/JS/CSS)
├── src-tauri/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs             # tauri_build::build()
│   ├── tauri.conf.json      # marks the Rust project for the Tauri CLI
│   ├── src/
│   │   ├── main.rs          # thin entry point, calls lib::run()
│   │   └── lib.rs           # tauri::Builder::default()...run(...)
│   ├── icons/                # output of `tauri icon`, referenced by bundle.icon
│   └── capabilities/
│       └── default.json      # permissions/scopes attached to windows/webviews
```

`tauri.conf.json` is the load-bearing file: it is both the app config and
the marker the Tauri CLI uses to find the Rust project. Its `$schema` should
point at `https://schema.tauri.app/config/2` (v2) — this repo's own
`apps/inacord/src-tauri/tauri.conf.json` does.

## Rust ↔ frontend bridge: commands

```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn my_custom_command(name: &str) -> String {
    format!("Hello, {name}!")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![my_custom_command])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```ts
// frontend
import { invoke } from "@tauri-apps/api/core";
// or window.__TAURI__.core.invoke if using the injected global script
const greeting = await invoke<string>("my_custom_command", { name: "world" });
```

Every command listed in `generate_handler![...]` must also be allowed by a
capability's `permissions` (see below) or the invoke is rejected at runtime,
not compile time — a command that "does nothing" from the frontend is very
often a missing permission, not a missing handler.

## v2 permissions system (NOT the v1 allowlist)

Tauri v2 replaced the v1 `allowlist` (a single flat list of enabled APIs)
with a three-part **access control list**:

- **permissions** — on/off toggles for individual commands (yours or a
  plugin's).
- **scopes** — parameter validation attached to a permission (e.g. which
  filesystem paths a `fs` permission may touch).
- **capabilities** — files under `src-tauri/capabilities/*.json` that attach
  a set of permissions+scopes to specific windows/webviews.

```json
// src-tauri/capabilities/default.json (shape)
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:path:default",
    "core:event:default",
    "core:window:default",
    "core:app:default",
    "core:image:default",
    "core:resources:default",
    "core:menu:default",
    "core:tray:default"
  ]
}
```

Core (built-in) permission identifiers are namespaced `core:<module>:<perm>`
— e.g. `core:window:default`. Plugin permissions are namespaced by plugin
name. A plugin can expose a `default` permission bundling its own safe
baseline; extend or narrow it per app rather than re-deriving it.

**Migrating a v1 project**: `cargo install tauri-cli --version "^2.0.0"
--locked && cargo tauri migrate` (or the npm/yarn/pnpm `tauri migrate`
equivalent) auto-generates `capabilities/*.json` by parsing the old
allowlist. If migrating from a v2 *beta*, prepend `core:` to bare core
identifiers (`window:default` → `core:window:default`).

## Config file responsibilities

- `tauri.conf.json` — app identity (`productName`, `identifier`, `version`),
  window definitions, `build.beforeDevCommand`/`beforeBuildCommand`/
  `devUrl`/`frontendDist`, `bundle.icon`, `plugins.*` config blocks (e.g.
  `updater.pubkey`/`endpoints`, `deep-link.desktop.schemes`).
- `Cargo.toml` — declares the `tauri`/`tauri-build` Rust dependencies; pin
  their versions to the same minor as the Tauri CLI in use (exact-pin with
  a leading `=` only if you need to freeze it).
- `capabilities/*.json` — see permissions system above.

## This repo's instance

`apps/inacord/src-tauri` is the one real Tauri app in `niers` — do not
create a second Tauri crate elsewhere (the orphaned, `Cargo.toml`-less
`crates/tools/inacord/` seen in earlier git status snapshots is stray build
output, not a crate; the real one is under `apps/`). It already wires:
`deep-link` (custom `niers://` scheme) and `updater` (minisign pubkey +
release-channel JSON endpoint) plugins in `tauri.conf.json`, transparent/
undecorated window chrome, and a single `capabilities/default.json`.
Extend that file's `permissions` array rather than inventing a new
capabilities file, unless a second window genuinely needs a different
permission set.

## Where to go deeper

Query context7 (`/tauri-apps/tauri-docs` for core docs, `/tauri-apps/
plugins-workspace` for an official plugin's exact permission/API surface)
for anything not covered here — bundler/updater config, mobile
(`tauri::mobile_entry_point`), IPC event system (`emit`/`listen`), or a
specific plugin (`fs`, `shell`, `http`, `store`, `sql`, `notification`, …).
