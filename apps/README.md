# `apps/` — the applications

An application has an entry point you launch (`bin`, `server.ts`, a window); a library goes in
[`packages/`](../packages). All of them share the root lockfile.

Measured 2026-09-25 (`ls -d apps/*/`): **2 applications**.

| Application | What it is | How it runs |
|---|---|---|
| `nie-web` | **the** frontend — one application, one shell, one stylesheet, for the page and the native window alike | Rust `nie-site` / Tauri host |
| `inacord` | the desktop packaging lane: `src-tauri`, the public assets, the Tauri configuration. No frontend of its own since 2026-09-12 | `bun run --cwd apps/inacord tauri build` |

The MCP server is not an application of this tree: it is the Rust crate
[`crates/tools/nie-mcp`](../crates/tools/nie-mcp), declared as `nie-game` in `.mcp.json`.

What runs in production, on which port and under which unit is owned by `../aphrody-infra`
(`config/service-catalog.json`, `systemd/`), not by this table; the live service manager is
the authority on what is active.

## Inacord (`apps/inacord/src-tauri`) — the traps that bring the application down

`src-tauri` **is** a member of the root Cargo workspace (`members` in the root `Cargo.toml`, not
in `default-members`) and inherits the workspace edition (2024), lints and package metadata
(`edition.workspace = true`). Check it explicitly with `cargo check -p inacord`.

- A **synchronous** `#[tauri::command]` runs on the main thread: any `tokio::spawn` inside it
  panics ("there is no reactor running") and, in a non-unwinding context, **brings the
  application down** with no useful trace. Every command that touches the VFS, a task or the disk
  must be `async`.
- A new command needs **three** steps: `#[tauri::command] #[specta::specta]`, the entry in
  `invoke_handler`, then `cargo run --bin export-bindings --features dev-bindings`. Without the
  second or the third, the frontend does not see it.
- `bundle.resources` **keeps the declared relative path**: `"resources/db/*.gz"` lands in
  `<resource_dir>/resources/db/`. Targeting the wrong path breaks nothing visible — the package has
  its weight, the signature is valid, and the resource is never read.
- **Only launching finds these bugs.** Neither `tsc`, nor clippy, nor the bundle-size check sees a
  resource that is never read or an empty table. After a build, launch the executable and look at
  what it wrote into its data directory.

## Distribution rules

- **The mobile web entry is never labelled an APK or an IPA.** Native Android/iOS packages stay
  explicitly unavailable until signed artifacts and platform runners exist; the installable
  mobile web application is listed as what it is (rule since 2026-09-09).
- **The browser adapter fails explicitly.** In a page, `apps/nie-web/src/inacord-web/shims/`
  routes read-only Tauri commands to the Rust HTTP surfaces and rebuilds what a Web API can
  express (`browser-fs.ts`: File System Access, OPFS, clipboard, downloads). Native filesystem,
  process, updater and mutation commands that no Web API can express reject through
  `unavailable()` (`native-error.ts`), naming the capability — never a silent no-op or a fake
  success.

## Publishing the desktop application

`scripts/release-desktop.sh <X.Y.Z>` does everything and is idempotent. **Never replay its steps
by hand**: `bun run tauri build` alone produces *unsigned* installers next to stale `.sig` files,
which nothing distinguishes and which the updater will refuse.
