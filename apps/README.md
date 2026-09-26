# `apps/` — the applications

An application has an entry point you launch (`bin`, `server.ts`, a window); a library goes in
[`packages/`](../packages). All of them share the root lockfile.

Measured 2026-09-25 (`ls -d apps/*/`): **1 application** (Inacord's Tauri lane `apps/inacord` was removed on 2026-09-26).

| Application | What it is | How it runs |
|---|---|---|
| `nie-web` | **the** frontend — one application, one shell, one stylesheet | Rust `nie-site` |

The MCP server is not an application of this tree: it is the Rust crate
[`crates/tools/nie-mcp`](../crates/tools/nie-mcp), declared as `nie-game` in `.mcp.json`.

What runs in production, on which port and under which unit is owned by `../aphrody-infra`
(`config/service-catalog.json`, `systemd/`), not by this table; the live service manager is
the authority on what is active.

## No desktop application here

The Inacord Tauri app was removed on 2026-09-26: the desktop is aphrody-ui `crates/aphrody-app`, IEVR stays in nie web (`nie-site` + `apps/nie-web`), and the app reaches the game only through the `nie.*` tools of aphrody-ai `aphrody-mcp`.

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
