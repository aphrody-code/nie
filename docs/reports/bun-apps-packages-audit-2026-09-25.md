# Bun apps and packages audit — 2026-09-25

Scope: `apps/nie-web`, `apps/inacord` and the eight folders under `packages/`, explored read-only
by three parallel sub-agents. LOC = `wc -l` over `.ts`/`.tsx` (no `node_modules`); tests = `it(` /
`test(` calls. Nothing was built or run. Companion of
[`crates-audit-2026-09-25.md`](crates-audit-2026-09-25.md).

Root: `packageManager` `bun@1.4.2`; workspaces = `apps/inacord`, `apps/nie-web`,
`packages/{asset-source,inacord-ui,nie,nie-bridge,nie-game,nie-media}`. `packages/config` and
`packages/nie-plugin` are **not** workspace members.

## Apps

### `apps/nie-web` — the single frontend (browser and desktop)

| Item | Value |
| --- | --- |
| Stack | React, Vite, Tailwind v4, Bun; one `tsconfig.json` for browser + desktop halves |
| Build | `build:wasm` → `build:wasm-viewer` → typecheck → `tsc -b` → vite → `precompress.ts` |
| LOC | ~45 200 (~40 000 hand-written; `src/wasm*` and `desktop/lib/bindings.ts` are generated) |
| Tests | 126 files, 377 cases; preload `packages/nie-plugin` (register + happydom) |
| Pages | 14 in `src/pages` + 3 screens; routing in `src/routing.ts` (language prefixes, `/inacord/<viewId>`) |
| Workspace deps (imports) | `@nie/inacord-ui` 273, `@nie/asset-source` 42, `@nie/game` 18, `@nie/bridge` 6 |
| TODO / `any` | 0 hand-written (2 in generated JS) / 4 |
| Files > 800 lines | `CinemaView.tsx` 1 942, `ExplorerView.tsx` 1 537, `PlayerBank.tsx` 1 151, `EditorView.tsx` 1 049, `VideoPlayer.tsx` 964, `Catalog.tsx` 951, `Models3D.tsx` 826 |

`src/`: `shell/` (UnifiedShell), `pages/`, `screens/`, `game/` (bridge, lua-runtime, menu layout,
`native-viewer.ts`), `desktop/` (Tauri adapter, Workspace, Explorer/Cinema/editor), `avatar/`,
`inacord-web/`, `layouts/`, `wasm/` + `wasm-viewer/` (generated), `shared/` and `styles/` (one
file each).

### `apps/inacord` — Tauri desktop packaging of nie-web

| Item | Value |
| --- | --- |
| Frontend | none; `frontendDist` = `../../nie-web/dist-desktop`; scripts forward to nie-web |
| `src-tauri` | 9 495 Rust LOC in 19 files; `lib.rs` alone 5 733 |
| Commands | 161 `#[tauri::command]` (134 in `lib.rs`); bindings via specta (`export-bindings`) |
| nie-* crates | 19 (formats, explore, save, data, aphrody, core, trace, queue, forge, pe, dump, viola, geom, app, lua, runtime, wiki, steam, tasks) |
| Tests | 31 inline, no `tests/` |
| Config | id `dev.nie.explorer`, frameless transparent 1280×820, `nie://` deep link, updater (minisign, 3 endpoints), 13 `.g4*` file associations |
| Capabilities | one file, ~200 permissions incl. recursive fs **write** on home/desktop/documents/exe |
| TODO | 0 |

## Packages

| Package | Name | LOC | Tests (files/cases) | `any` | Consumers | Role |
| --- | --- | --- | --- | --- | --- | --- |
| asset-source | `@nie/asset-source` | 2 693 | 5 / 35 | 0 | nie-web, inacord-ui | Asset reading contract + web source |
| config | — (no package.json) | 0 | — | — | none found | `tsconfig-base.json` only |
| inacord-ui | `@nie/inacord-ui` | 29 328 | 23 / 128 | 5 | nie-web | Shared UI (~35 subpath exports) |
| nie | `@aphrody/nie` (public, MIT) | 986 | 2 / 25 | 2 | nie-plugin only | Bun FFI over `libiecode` (`nie-ffi`, lib name `iecode`) |
| nie-bridge | `@nie/bridge` | 428 | 1 / 6 | 0 | nie-web desktop | Client for `nie-mcp` control bridge |
| nie-game | `@nie/game` | 1 045 | 0 / 0 | 0 | nie-web, inacord-ui | Pure game logic (formations, team codes, text) |
| nie-media | `nie-media` | 38 | 0 / 0 | 0 | nie-web | Episode navigation + embed player URL |
| nie-plugin | — (no package.json) | 289 | 1 / 2 | 0 | `bunfig.toml` preload, inacord-ui tests | Bun loaders for game formats + happy-dom |

Totals: ~34 800 package LOC (inacord-ui ≈ 85 %), 196 test cases, 0 TODO, 7 `any`.

## Findings (prioritised)

1. **Desktop security surface** — `csp: null` plus recursive fs write on home and exe
   directories, in an app with an auto-updater. Narrow the capabilities to the directories the
   commands actually touch and set a CSP.
2. **`nie-plugin` is load-bearing but unowned** — no `package.json`, not a workspace member, yet
   preloaded for every `bun` run via `bunfig.toml:10`; it pulls `@aphrody/nie`, so a stale or
   missing `libiecode` breaks every Bun command. Its README still describes an npm-installable
   package. Make it a workspace package or document the dependency where the preload is declared.
3. **Gates that pass silently** — `apps/inacord` `"typecheck": "true"`; `nie-game` and
   `nie-media` have no `test` script, so the root fan-out skips them. `nie-game` is pure logic with
   fixtures already present and zero tests.
4. **Duplication with the crates** — `nie-game` team codes/rules duplicate
   `nie-wasm::team_{code,generator,rules}` (see crate audit, finding 3): one of the two should be
   the source, the other a binding.
5. **Oversized files** — `inacord/src-tauri/src/lib.rs` (5 733 lines, 134 commands), plus the
   seven nie-web components above 800 lines.
6. **Probable dead dependency** — `three` / `@types/three` in `apps/nie-web/package.json`: no
   direct import in `src/`; three.js is reached only via `@nie/inacord-ui/three/Viewport3D`
   (the WebGL 1 fallback, which CLAUDE.md says must stay). The dependency belongs to inacord-ui.
7. **Stale docs** — `apps/README.md` says `src-tauri` is outside the Cargo workspace on edition
   2021 (it is a member, on the workspace edition) and still titles the section `nie-explorer`;
   `packages/README.md` announces 6 libraries and omits `nie-plugin`/`config`; `nie-media` README
   promises a catalogue with sources and URLs that does not exist; `routing.ts` still references
   the old `/medias?vue=` page.
8. **Misplaced Cargo deps** — in `inacord/src-tauri/Cargo.toml` all nie-* crates, tokio, zip,
   trash, uuid and async-trait sit in the `cfg(any(windows, macos, linux))` target block rather
   than `[dependencies]`.
9. **Catalog rule breaches** — `@rosegriffon/ui ^1.0.1` (inacord-ui) and `nie-media ^1.0.0`
   (nie-web) are pinned directly instead of `catalog:` / `workspace:*`.
10. **Small leftovers** — `packages/config` has no consumer found; `nie-media` (38 LOC) is not
    `@nie/`-scoped and could merge into another package; `inacord/public/` duplicates 7 files of
    `nie-web/public` and ships a service worker + web manifest a Tauri shell does not need;
    `asset-source` test script carries a useless `--pass-with-no-tests`; `inacord-ui` `exports`
    has `./shell/*` overlapping ~12 explicit entries.
