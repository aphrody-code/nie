# NIERS — Reconstruct the game engine that produced `nie.exe`

## The reverse-engineering workflow — how the next task is chosen (2026-09-11)

The next task is not picked by intuition, nor read off a stale document: it is **measured**.
The [atlas](docs/ATLAS.md) indexes every reverse-engineering surface of this repository in one
database — 6 743 files, 46 crates, 1 063 documents and the 13 793 machine references they
claim, the 52-table digest of the 19 GB knowledge base, the 215 688 forge units, the three
binaries and the 178 runnable tools — and ranks what is missing.

```bash
just atlas                  # (re)build the index + the Redis db4 mirror
niers atlas gaps            # the road to 100 %, ranked by (target − current) × weight
niers atlas next            # the next task, as JSON, for an agent or the loop
niers atlas search <term>   # docs + symbols + tools + files + crates, in one query
bash scripts/atlas-loop.sh  # one autonomous tick: measure → index → rank → one bounded act → re-measure
```

### The ranked gap table *is* the plan

Snapshot measured on `vps-203bea89`, 2026-09-11 — **regenerate it, never quote it**:

| Gap | Measured | Score | Next action |
|---|---|---|---|
| `re.anchoring` | 43.00 % of named functions start on a real `.pdata` root of the reference | 456 | `just re-seed && just re-rebuild` on `nie.exe` |
| `re.named` | 12.57 % (13 653 / 108 650) | 437 | `just re-rebuild`, then `niers seed-ui` |
| `forge.units` | 0.00 % (7 / 215 688) | 400 | `just forge-cc` |
| `port.symbols` | 1.37 % (189 / 13 845) | 296 | name the ported functions after their binary symbol |
| `forge.lifted` | 48.80 % (105 266 / 215 688) | 256 | `nie-forge lift` |
| `forge.produced` | 74.061759 % | 233 | `just forge` |
| `forge.code` | 92.447995 % of `.text` | 45 | `nie-forge lift --max-len` |
| `re.classified` | 92.65 % (100 664 / 108 650) | 44 | `just re-rebuild` |
| `docs.anchored` | 89.84 % (955 / 1 063) | 20 | `niers atlas docs --orphans` |
| `forge.identity` | **100 %** — `dist/nie.exe` is byte-identical | done | hold it |

Weights encode what "100 %" means here, in order: identity 10, produced 9, anchoring 8, uemu
proofs 7, `.text` 6, classified 6, named 5, lifted 5, units 4, ported symbols 3, docs 2.

`re.anchoring` took the lead the day it was first measured: `cargo test -p nie-mcp --test
re_real` asks the running MCP server for 400 named functions and checks each address against
the reference binary's own `.pdata` unwind table. Only 43 % are real function starts there —
the knowledge base is anchored on another build (`4c2b91fb…`, 31,468,032 bytes, 50,674 roots)
than the target (`b1fa04ea…`, 33,918,464 bytes, 55,351 roots). Until it is re-anchored, an
address quoted from `function` is not an address of `nie.exe`. See [`docs/RE.md`](docs/RE.md).

### Rules this workflow imposes on the plan

1. **No number enters this plan unless `atlas_metric` holds it**, with the command that
   produced it. `niers atlas metric <name> <value> --source '<command>'` is how a measurement
   becomes citable.
2. **An unmeasured gap does not exist.** `refresh_gaps` creates a row only for a metric that
   was really recorded — an absent measurement leaves nothing, never a zero that would read
   as "not started".
3. **A snapshot is not proof.** Any table in this file, including the one above, is stale the
   moment it is written; the authority is the command next to it.
4. **One bounded act per tick.** The loop acts once, reversibly, inside the repository: no
   push, no deletion, no service, no `/etc`, no `pkill`, with a disk guard and a timeout.
5. **`port.symbols` is a deliberate lower bound**: a binary symbol name quoted in a Rust
   source counts, an anonymous reimplementation does not. Raising it means *naming* what has
   been ported after the thing it reproduces.


## Product direction — two complementary delivery goals

The latest user direction preserves both supplied visual references as distinct goals:

1. **Inacord is the primary application UI.** Preserve its existing features, components,
   explorer, editor, navigation, inspectors and tools while converging browser and desktop
   adapters on their shared implementations. Redesign this functional surface with the game's
   real icons, colors, fonts and individually decoded artwork as its principal theme. Preserve
   resource names, slugs and VFS paths in the asset contracts so every themed element remains
   traceable. Do not replace the mature application with a reduced explorer or menu demo.
2. **The native game UI remains a separate reconstruction target.** Retain its layouts, scene
   contracts, Lua state, resource resolution and interactions for the shared backend, mod
   authoring and production of a new `nie.exe`. The main-menu reference remains a comparison
   oracle, never a full-screen runtime texture.

Both goals reuse the same format decoders, VFS, resource loaders and domain libraries. A theme
change must retain every existing application capability; a native-menu reconstruction must not
be reported as completion of the Inacord application. Missing resource mappings remain explicit
work items, not guessed icon substitutions. Perform interaction and visual validation after the
source implementation phase, as requested by the user.

### Where the game's pixels come from — measured 2026-09-12

The goal is that the game is drawn by the code that reproduces the game, not by a second
implementation in the browser. Here is what each surface actually runs, measured, with the
blocker named when there is one. Regenerate it; do not quote it.

| Surface | Who draws it | Measured |
|---|---|---|
| Menu layouts (Bank, Shop, Gallery) | **Rust → WebAssembly** (`nie_formats::menu_layout`) | Bank composes 39 elements, 0 skipped, in the page |
| Menu layouts, server side | the same library | `/api/v1/menu/render/{screen}`: `main_menu` 16, `shop_menu` 206, `chara_bank_menu` 78 |
| Menu layouts, CLI | the same library | `nie-game --compose-layout`, 14 + 1 reference tests incl. two SSIM gates |
| Object visibility | the game's own Lua, replayed | `chara_bank_menu` 76/78 resolved, `gallery_menu` 3/7, `shop_menu` 0 |
| 3D models | **Rust wgpu** (`nie-render3d` through `WebGpuViewer`) | the wasm build ships `--features webgpu`; the TS WebGL viewer is the fallback when `navigator.gpu` is absent |
| Title menu shapes | TypeScript DOM (`inacord-ui/shell/menu-screen`, 602 l) | no game layout exists behind those panels — they are shapes measured on captures. Composing `title_menu_2` instead was TRIED: `/api/v1/menu/render/title_menu_2` draws 40 objects, 0 skipped, and the image is not the title screen — stacked panels, a stray `ver.` logo, garbled glyphs, because that screen resolves no visibility and its transforms are defaults. Replacing the shapes with it would make the product worse, so the shapes stay until the screen resolves. |
| Title menu scene | TypeScript DOM (`main-menu` + `native-scene-layers` + `native-sprite`, 388 l) | the scene is Rust-derived (`menu_presentation`) and drawn in the DOM |
| Screen content (rosters, prices, stock) | TypeScript over the Rust APIs | — |

**The named blockers, not guesses:**

1. `shop_menu` and `title_menu_2` resolve NO visibility, because the game ships no `.lua.bin`
   of that name: `data/common/script/lua/menu/` has `shop_menu_buy`, `shop_menu_sell`,
   `shop_menu_basara`… and no `shop_menu`. Mapping one onto the other would be a guess, so the
   screens draw nothing rather than everything.
2. A layout whose visibility is unresolved cannot be composed honestly: drawing it whole stacks
   every mutually exclusive panel (78 objects for the Bank where the game shows a fraction).
   `LayoutCanvas` therefore draws only what the data establishes.
3. The Lua replay ran on the server only. **The page now runs it too** — the abort is fixed.
   `vendor/lua-src` (wired through `[patch.crates-io]`) compiles Lua as C on emscripten instead
   of C++ with exceptions, with `-sSUPPORT_LONGJMP=wasm` matching the link, and the flag lives in
   the build script because `CFLAGS_*` is not part of cargo's fingerprint. The artifact drops to
   870,393 bytes with **zero `invoke_*`**, and the VM instantiates, loads the screen's four real
   scripts and runs the replay. What blocks it now is ordinary: the game's `.lua.bin` are
   precompiled for a 64-bit Lua and the wasm VM is 32-bit, so it answers
   `incompatible precompiled chunk`. Lua 5.2 bytecode embeds the sizes of `int`, `size_t` and
   `lua_Number` in its header; transcoding them is a decoding job this repository already owns
   (`nie_lua::bytecode`, byte-exact, used by `mode_index.rs`).

**Azalée is gone**, and this is what "gone" means, measured: no `apps/azalee`, no
`packages/azalee*`, and three inert mentions left in shared code — a team-name string, role
doc comments, a CSS theme name. Nothing of it renders.

### One interface — nie and Inacord fully merged, 2026-09-12

`/inacord` was a route of the site that mounted a **second application**: its own sidebar, top
bar, command palette, toaster, current-view state and address-bar writer, behind a lazy import.
Four consequences, all measured before the merge: a game screen could not reach a tool, a tool
reached a game screen by reloading the whole page (`window.location.assign`), `Ctrl+K` existed on
one half of the product only, and **three** files entered Tailwind (`base.css`,
`desktop/styles.css`, `inacord-web.css`), so the document got three preflights and sixty design
tokens defined twice — whichever sheet loaded last won, and that depended on the visitor's path.

What the merge establishes:

- **One shell** (`src/shell/UnifiedShell.tsx`): the workspace's own `Sidebar`, driven by data —
  the game screens of `entries.ts`, then the workspace views of `desktop/lib/vues.ts`, then the
  Explorer's places, pins and recents. Top bar, command palette and notifications on every
  screen. The game at `/` stays unframed and owns the viewport.
- **One route state**: `useGameNavigation`. A workspace view is a route (`/inacord/<viewId>`),
  so it is addressable and shareable, and moving between a tool and a game screen is a render,
  not a page load. Verified in Chromium: a marker set on `window` survives `/bank` → sidebar
  click → `/inacord/explorer`.
- **One Explorer**. `pages/ExplorerInacord.tsx` (a reduced copy, with its own tab store and its
  own `position: fixed` overlay that covered the shell) is gone; `/explorateur`, `/recherche` and
  `/donnees` open the mature one. `pages/Explorer.tsx`, `pages/DataPanel.tsx` and
  `pages/PetAphrody.tsx` were already unreachable and went with it.
- **One Options screen**: `/inacord/settings` is `/settings`, which already carried the
  workspace's tool actions.
- **One stylesheet** (`src/app.css`): Tailwind entered once, sources declared once, the three
  token layers ordered on purpose. One preflight in the built CSS, measured.
- **One theme owner**: the settings store. `next-themes` still paints the class, but no longer
  decides — its default (`dark`) and the store's (`system`) were two writers on `<html>`, and
  merely opening the Options screen adopted one into the other and flipped the product to dark
  for good.
- **One TypeScript project**: `tsconfig.desktop.json` is gone, the `exclude` on `src/desktop` with
  it. `apps/inacord` keeps `src-tauri`, its public assets and its Tauri configuration — it has no
  frontend of its own.
- Native-only chrome stops being drawn in a page: the window controls, the resize handles and the
  job manager (which needs `sqlite_*` Tauri commands and logged an error on every page load), and
  the MCP bridge no longer dials the READER's `ws://127.0.0.1:8791`.

Gates on `vps-203bea89`, 2026-09-12: `bunx tsc --noEmit` clean on the single project and
`bun run typecheck` clean across the workspace; 164 nie-web tests pass; `vite build` and
`vite build --mode desktop` both succeed; Chromium checked nine routes against the live
`nie-site` — shell present, titles correct, no console error but the pre-existing `/bank` 404s.

### Inacord distribution lane — 2026-09-09

**Merged into the site on 2026-09-12.** The browser workspace is a route of `nie.aphrody.com`
(`/inacord`, served by the single `apps/nie-web/dist` bundle) and the download catalogue is
`nie.aphrody.com/downloads` (`catalog.json`, `files/`, `channels/stable/latest.json`). It lists
the signed Windows desktop installer, the Linux CLI and MCP archives, the Blender and agent
plugins and the installable mobile web application. `inacord.aphrody.com` is no longer a site: it
answers `308` to `nie.aphrody.com`, and only keeps serving its updater manifest for already
installed clients. Native Android/iOS packages remain explicitly unavailable until signed
artifacts and platform runners exist; the mobile web entry must never be relabelled as an APK or
IPA.

The repository `aphrody-code/nie` is public. The dependency audit found that all externally
referenced `@aphrody/*` registry packages and the Rust git dependency are already public; internal
`@niers/*` workspaces remain source packages in this public monorepo rather than being published
under an unowned registry name. The agent plugin starts an installed `nie-mcp` binary and no
longer requires a source checkout or Rust toolchain.

Production publication is owned by `scripts/release-inacord.ts` and the existing
`scripts/release-all.ts` pipeline. Each public tree is immutable by pushed commit, records sizes
and SHA-256 values, verifies the Tauri updater signature plus a negative tamper test, audits archive
entries, and is promoted through one atomic `public` symlink. Nginx serves only that allowlisted
tree and the read-only Rust HTTP surfaces. Desktop filesystem, process, updater and mutation
commands fail explicitly in the browser adapter.

Measured pre-publication gates on `vps-203bea89` on 2026-09-09: both web and desktop TypeScript
checks passed; 6 focused tests passed with 12 assertions; Vite built 3,715 modules into 137 files
(18 MiB) with zero source maps; Chromium mounted the Explorer against the production VFS with
255,308 indexed entries. DNS resolves to `51.77.147.152`, and the renewed ECDSA certificate includes
`inacord.aphrody.com` with expiry 2026-12-08 (the host survives the merge as a redirect). The immutable manifest and live HTTP interaction
checks remain the release-time proof for the exact pushed commit.

**The Rust site and wiki are the only IEVR data owners.** The deleted Azalee application,
`packages/azalee`, `packages/azalee-tools`, and the IEVR Inagle package are not compatibility
targets. IEVR parsing, query rules, mirror access, API projections, CLI behavior and native IPC
belong to `nie-data`, `nie-formats`, `nie-core`, `nie-wiki`, `nie-site`, `nie-cli`, and Inacord's
Rust backend. Bun is limited to thin host bindings and non-IEVR integrations; it must not query
the IEVR mirror directly or call a remote wiki.

## Active mission — 2026-09-08 rebaseline

The project mission is now the measured reconstruction of the engine that produced `nie.exe`,
not a collection of parallel viewers or a generic replacement engine. The exact executable forge
and the playable Rust runtime are two independent proof axes for the same engine:

- **binary provenance:** increase the fraction of `nie.exe` emitted from maintained repository
  sources while `dist/nie.exe` remains byte-identical to the 33,918,464-byte reference with
  SHA-256 `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`;
- **functional reconstruction:** move observed formats, scene state, animation, rendering, Lua,
  input, audio and gameplay behavior into reusable Rust libraries shared by native, headless and
  WebAssembly hosts;
- **authoring:** turn the existing Inacord viewport and scene document into a persistent editor
  for those shared engine contracts rather than a second TypeScript engine;
- **interoperability:** add GLB/VRM and VTubing adapters only after their required engine
  primitives exist and can be validated independently.

The 38-screen delivery ledger below remains active evidence and debt. It is no longer a standalone
24-hour product target: each screen is now a functional engine fixture for menu/Lua/resource/input
reconstruction. Its OPEN rows cannot be silently dropped or treated as proof of engine parity.

### Definition of done

The mission is complete only when all of the following are simultaneously measured:

- the forge builds the target executable without reading the reference during `build`, its hash is
  exact, and 100% of bytes have repository-owned provenance; `semantic` matches never count as
  produced bytes;
- the maintained Rust engine can reproduce the observed game state transitions and render the
  required native assets through the same library contracts in native, headless and WebAssembly
  hosts;
- Inacord persists and reopens editable scenes without state loss and remains a thin client of the
  shared engine and asset libraries;
- every unsupported format, native behavior and reverse-engineering fact remains an explicit open
  ledger item with reproducible evidence.

### Continuous execution loop

Every iteration follows one auditable sequence:

1. Re-measure the current forge and functional baselines (`bash scripts/atlas-loop.sh
   --no-act` does it in one pass and records every number with its source); never promote
   historical counts to current proof without rerunning them on the named host and revision.
2. Select the highest-yield concrete blocker from `niers atlas next` — which ranks the whole
   measured surface — then narrow it with `nie-forge lift --top 0`, `nie-forge candidates
   --no-reloc`, the RE knowledge base, or a failing functional fixture.
3. Implement the capability in its single owning library and preserve compatibility facades.
4. Run narrow tests and clippy, then the applicable byte-exact build, native/Wasm equality,
   rendering, interaction or round-trip gate.
5. Obtain an independent adversarial audit, correct findings, commit the coherent batch, update
   this ledger with exact counts and continue to the next measured blocker.

### Workstreams and ownership

| Workstream | Existing owner to extend | Current baseline | Next acceptance gate |
|---|---|---|---|
| Exact PE production | `nie-pe`, `nie-asm`, `nie-forge`, `forge/asm` | Last replayed 2026-09-03: 74.0033% file provenance, 92.2595% `.text`; must be rerun | Fresh `split/lift/build/verify/report`, identical SHA-256, blocker totals recorded |
| Reverse-engineering knowledge | `nie-re`, `nie-index`, `nie-seed`, `nie-trace` | RTTI, vtables, functions and domain mapping exist | Every forge unit joined to evidence; false-code/data boundaries reduced without teaching impossible instructions |
| Formats and assets | `nie-formats`, `nie-data`, `nie-explore` | VFS/CPK, G4 families, textured/skinned GLB assembly and avatar composition are partial but real | Counted corpus with parse, dependency and export assertions; unresolved semantics explicit |
| Runtime and gameplay | `nie-core`, `nie-app`, `nie-runtime`, `nie-lua` | Deterministic match/menu fragments and Lua host exist; not a complete engine | Recorded state replay equality across headless/native/Wasm with real assets and inputs |
| Rendering and animation | `nie-render3d`, `nie-game`, `nie-camera` | CPU/wgpu renderers and cameras exist; renderer still lacks complete node/skin/morph/animation evaluation | Sampled pose/render fixtures at declared times, GPU budgets and native/Wasm scene equality |
| High-level editor | `nie-render3d::document`, `inacord-ui`, `apps/nie-web`, Tauri adapter | Multi-asset viewport, picking, outliner and session-only gizmos; scene v1 is limited | Versioned persistent scene, full hierarchy/TRS, undo/redo, save/reopen/export equality |
| VRM and VTubing | engine libraries first; dedicated tracking library only when shared contracts are stable | `three-vrm` dependency and transparent window capabilities exist, but no runtime VRM/VMC/tracking implementation | Licensed VRM 0/1 validation, deterministic VMC replay, measured retarget/render latency and OBS capture matrix |

### Ordered milestones

- [ ] **M0 — trustworthy fresh baseline:** preserve the current dirty migration, inventory its
  ownership, locate the user-provided reference and forge state, rerun forge measurements where
  available, and record host/revision/commands. Do not start an encoder change from the stale
  2026-09-03 ranking.
- [ ] **M1 — exact-code frontier:** reduce the freshly measured highest-mass genuine instruction
  and encoding blockers; separately improve false-code/data segmentation. Each batch must increase
  provenance, retain exact SHA-256 and add round-trip encoder tests.
- [ ] **M2 — canonical scene and animation:** migrate `SceneDocument` to stable identities,
  hierarchy and full TRS; evaluate node transforms, skins, morph targets and animation through one
  deterministic pose contract consumed by CPU/wgpu/WebGPU renderers.
- [ ] **M3 — reconstructed runtime:** connect observed Lua, resource lifecycle, input, audio,
  cameras, menu and gameplay state to that scene/animation core. Convert the 38 screen rows and
  gameplay captures into timestamped deterministic fixtures.
- [ ] **M4 — authoring:** persist editor projects, command transactions, undo/redo, prefabs,
  component inspection, animation timeline and edit/play isolation. No UI may own canonical engine
  state or implement a second decoder.
- [ ] **M5 — validated interchange:** provide semantic GLB export/reimport first, then VRM 0/1
  humanoid, expressions, look-at, spring bones, MToon metadata and licence preservation. A skinned
  GLB is not called VRM.
- [ ] **M6 — VTubing surface:** add normalized timestamped tracking frames, VMC/OSC transport,
  a separate OpenSeeFace UDP adapter, calibration/filtering/retargeting, record/replay and a
  dedicated Tauri output window. OBS alpha/chroma support is claimed only per tested OS/capture
  path.
- [ ] **M7 — closure:** 100% repository-owned byte provenance, complete required functional
  fixture matrix, distributable native/web engine hosts and editor, with no hidden unresolved
  reverse-engineering facts.

### Immediate iteration queue

1. Stabilize and attribute the in-progress Inacord/`nie-web` consolidation already present in the
   worktree; do not overwrite or duplicate it.
2. Re-establish a fresh forge baseline and regenerate the full blocker/candidate reports.
3. Choose the first implementation batch solely from those fresh counts, with an adversarial lane
   checking that apparent x86 instructions are not inline data.
4. Wire the format-neutral G4MT decode result into the canonical `nie-core` pose contract through
   an explicit runtime adapter, then prove one real fixture reaches a pose-driven renderer without
   inventing unresolved bones.
5. Extend the bind-pose GLB import slice to consume sampled `PoseFrame` values (CPU first), with a
   golden silhouette/vertex fixture before attempting GPU or Wasm parity.

### Engine loop ledger — 2026-09-08

#### M0 fresh forge baseline

Measured on `vps-203bea89` from the current dirty integration worktree. The target symlink resolves
to the user-owned Steam executable at `/home/ubuntu/.local/share/Steam/iecode/inazuma/nie.exe`;
its measured size is 33,918,464 bytes and SHA-256 is
`b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.

- `nie-forge split --exe nie.exe`: 104,231 submitted boundaries, 69,398 retained, 34,833
  crossing boundaries rejected, 203 indeterminate, 1,335,889 inline-data bytes across 3,536
  units, 1,271,468 code bytes released, 215,688 total units, 56,533 function units, 1,673,867
  residual `.text` bytes, zero gaps and zero overlay.
- `nie-forge lift --exe nie.exe --top 0`: 107,912 bodies scanned, 105,230 lifted,
  22,512,913 assembled bytes, ratio 0.9751; 207 blocker causes, 2,013 units and 1,321,048 bytes
  remain. The leading fresh blockers are `encodage:add` (55 units/45,605 bytes), `extractps`
  (25/45,482), `vmovdqu` (38/45,150), and likely false-code `in` (41/44,973).
- `nie-forge report`: 73.825236% file provenance and 92.119725% `.text` provenance. These values
  supersede the 2026-09-03 percentages for current planning but do not imply a regression in
  source capability: the recovered boundary population and forge artifacts differ materially.
- `nie-forge build --exe nie.exe`: 209,340 repository-produced units, 25,040,386 bytes, zero
  rejected units; `dist/nie.exe` is 33,918,464 bytes and byte-identical with the target SHA-256.

M0 remains open until the current integration worktree is attributed and committed coherently,
but the forge itself is reproducible again. The first M1 batch is the freshly observed redundant
REX-prefix encoding family; its acceptance requires a post-change lift/report delta and the same
exact build hash, not only unit tests.

#### M1 redundant REX on register `mov` — implemented, awaiting coherent commit

The assembler now preserves an explicit null REX prefix through the non-breaking `MovRRRex` and
`MovRRmRex` variants. Text round-trips use canonical `mov.r` and `mov.d.r`; the lifter finds REX
after legacy prefixes such as `66` and restricts this preservation to the validated 32-bit low
register forms. Existing public `MovRR`/`MovRRm` signatures remain intact.

- `nie-asm`: 24 library tests and 1 doctest pass; strict library/test clippy passes.
- `nie-forge`: 34 library tests and 2 integration tests pass; strict library/binary/test clippy
  passes.
- Post-change lift: 105,231 bodies and 22,513,296 bytes, up **1 body / 383 bytes**; blockers fall
  from 2,013 units/1,321,048 bytes to **2,012 units/1,320,665 bytes**. The previous
  `encodage:mov` top blocker is absent from the top 20, but a full cause-specific zero count is not
  yet claimed.
- Post-change report: **73.826365%** file provenance and **92.121292%** `.text`, increases of
  0.001129 and 0.001567 percentage points respectively.
- Post-change build used the generated source in tmpfs because the workspace filesystem had only
  123 MiB free. It produced 209,341 units / 25,040,769 bytes, rejected zero units, and emitted a
  33,918,464-byte executable with the exact target SHA-256 `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`.

Next exact-code target is selected from the fresh ranking: reclassify the boundary/data split
behind the apparent `encodage:add` blocker first; only then treat `extractps` as the next bounded
genuine-instruction candidate.

The adversarial check falsified that first target: the sample at `0x14003e85d` is the tail of a
RIP-relative `movaps` displacement (`0f 29 05 31 c9 26 02`) followed by `ret`, split by a stale
`CodeResidue` boundary. No `add` encoder change is justified. The next forge action is boundary
reclassification using `boundaries::valider`; only after that correction may `extractps` be treated
as a genuine instruction blocker.

Fresh replay on 2026-09-08 confirms the same boundary directly: `nie-forge unit --exe nie.exe
--va 0x14003e85d` identifies `res.text.3dc5d` at file offset `0x3dc5d` with bytes `26 02 c3`,
while `xxd` at `0x3dc50` shows the complete preceding sequence `66 0f 6f 05 68 b1 a2 01 0f 29
05 31 c9 26 02 c3`. The `encodage:add` ranking entry is therefore a false-code artifact and
remains excluded from encoder work.

The next genuine `extractps` sample was inspected at `fn.14005fb00`: `66 0f 3a 17 c0 00`
(`extractps eax, xmm0, 0`). It cannot use the existing `SseI` AST, whose destination is an XMM
register; the bounded implementation must add a general-register destination form, text parsing,
ModRM/imm8 encoding, lifter mapping and round-trip tests together. No partial enum-only change is
accepted as progress because it could silently encode the wrong operand class.

### M1 `extractps` general-register form — implemented

`nie-asm` now owns `Insn::Extractps(Reg, Xmm, u8)` with canonical text parsing and exact `66 0f
3a 17 /r ib` encoding; `nie-forge::lift` maps the iced-x86 register/register/immediate form. The
new round-trip test and strict gates pass: `nie-asm` 25 library tests, `nie-forge` 34 library
tests plus 2 integration tests, and zero clippy warnings. A fresh lift changes from 105,231 bodies
and 22,513,296 bytes to 105,256 bodies and 22,558,778 bytes; blockers fall from 2,012 units /
1,320,665 bytes to 1,987 units / 1,275,183 bytes, with `extractps` absent from the top five.
The false `encodage:add` residue remains separately excluded from encoder work.

The exact build was rerun after this batch: `nie-forge build --exe nie.exe` emitted 209,366 Rust
units / 25,086,251 bytes, rejected 0 units, and produced a 33,918,464-byte `dist/nie.exe` with
SHA-256 `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c`; `identical=true`.
This preserves byte identity but does not close the independent-provenance gap documented below.

### M1 `paddq` SSE form — implemented

`nie-asm` now includes `SseOp::Paddq` (`66 0f d4 /r`) and the text/lifter mappings. Its exact
round-trip test passes; `nie-asm` has 26 library tests, and strict clippy remains clean. After
rebuilding the forge binary, a fresh lift reports 105,261 bodies and 22,592,734 bytes, with
1,982 blockers / 1,241,227 bytes (down from 1,987 / 1,275,183). The first false `encodage:add`
residue remains unchanged; the next genuine high-mass candidate is the 256-bit `vmovdqu` form.

### M1 `stmxcsr` memory form — implemented

`nie-asm` now includes `Insn::Stmxcsr(Mem)` with exact `0f ae /3` encoding, canonical text
parsing, and a `nie-forge` lifter mapping. The round-trip test passes; `nie-asm` has 27 library
tests and both forge/asm clippy gates are clean. After rebuilding the forge binary, the fresh lift
reports 105,265 bodies and 22,593,058 bytes, with 1,978 blockers / 1,240,903 bytes. The remaining
top genuine candidate is the 256-bit `vmovdqu` form; `in`/`out`/`sti` entries remain suspected
false-code until independently validated.

The post-`stmxcsr` exact build also remains byte-identical: 209,375 Rust units and 25,120,531
produced bytes, zero rejected units, 33,918,464 output bytes, and the reference SHA-256
`b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c` (`identical=true`).

### M1 `vmovdqu` 256-bit VEX.256 form — implemented

`nie-asm` now owns `Ymm`, `YmmRm` and `Insn::Vex256(VexOp, Ymm, Ymm, YmmRm, Option<u8>)` with
exact bit-preserving encoding for `L=1` across 2-byte (`0xC5`) and 3-byte (`0xC4`) VEX prefixes.
Canonical text rendering (`ymm...`) and parsing round-trip faithfully; `nie-forge::lift` maps
iced-x86 YMM instructions (`is_ymm()`) to `Insn::Vex256`. Unit tests verify exact bytes for
`vmovdqu ymm6, [rip 0x1418afa60]` (`c5 fe 6f 35 4e 1f 19 01`).
- `nie-asm`: 29 library tests and 1 doctest pass; strict clippy clean.
- `nie-forge`: 34 library tests and 2 integration tests pass; strict clippy clean.
- Post-change lift: 105,266 bodies and 22,593,138 bytes, up **1 body / 80 bytes**; blockers fall
  from 1,978 units / 1,240,903 bytes to **1,977 units / 1,240,823 bytes**. `vmovdqu` is eliminated
  from the genuine instruction blocker ranking.
- Post-change report: **74.061759%** file provenance and **92.447995%** `.text` provenance.
- Post-change build: 209,376 Rust units / 25,120,611 bytes produced, 0 rejected; emitted
  `dist/nie.exe` is 33,918,464 bytes with exact SHA-256
  `b1fa04ea365868e5c8933aca393366f82d0d446187e2187f2737dc4fa2acd40c` (`identical=true`).
- Next genuine high-mass candidate: `vpaddw` 256-bit form (4 units / 33,130 bytes, sample
  `vpaddw ymm0, ymm8, [rcx] @ 0x140727ebb`); `in`/`out`/`sti` remain suspected false-code.

#### M2 scene-document foundation — implemented library slice, integration still open

`nie-render3d::document` now adds a backward-compatible version 2 contract beside the unchanged v1
API: persisted identifiers, parent hierarchy, local full quaternion/TRS, inherited visibility,
bounded validation and JSON v1→v2 migration. V1 retains its 128-object limit; v2 permits at most
4,096 authoring objects. Initial migrated IDs are deterministic for an unchanged v1 sequence and
become persistent only after saving v2; they are not claimed stable across v1 reordering.

The document suite passes 17 tests and strict clippy with zero warnings. This slice does not yet
make the editor persistent: composition, atomic save/recovery, command history, frontend bindings
and parent-transform evaluation remain open M2/M4 work.

#### M2 pose/animation contract — implemented primitive, format binding still open

`nie-core::animation` now owns format-neutral `SkeletonId`, `BoneId`, `PoseFrame`, local bone
poses, keyframe tracks and deterministic clamp/loop sampling with translation/scale lerp and
quaternion nlerp. It deliberately does not claim G4MT/G4RA semantics: loaders must provide decoded
keyframes. Invalid times, transforms, quaternions and non-finite values fail closed.

`nie-runtime` re-exports the contract for compatibility, while `nie-render3d` depends on the
acyclic core owner. The core suite passes 300 tests and the runtime suite 6 tests; strict clippy
passes for both crates. The contract is not yet connected to G4MT/G4SK, skinned
`nie-render3d`, native/Wasm bindings or the editor timeline; those remain the next functional gates.

The G4MT loader now exposes a format-neutral `Motion::decode_clip` result (`DecodedMotionClip`,
tracks and keyframes): it resolves target-to-bone mappings supplied by the caller, preserves local
TRS, converts declared FPS to seconds, rejects additive clips/invalid mappings and omits unresolved
targets without inventing bones. The `nie-formats` gate passes 317 tests (one ignored) and strict
clippy. A runtime adapter and pose-driven renderer are still required before this becomes a
functional playback path.

The GLB loader now evaluates glTF node hierarchy transforms and bind-pose skinning (JOINTS/WEIGHTS
and inverse-bind matrices), while preserving the existing `Model`/`Primitive` API. Its focused
suite passes 19 tests and strict clippy. This is a measured bind-pose/import improvement, not yet
dynamic `PoseFrame` application: runtime pose upload, morph targets and GPU skinning remain open.

#### Gate finding — forge independence remains open

The current `nie-forge build` reproduces the exact SHA-256, but source inspection shows it still
loads the reference binary and copies every non-regenerated unit from it. This proves exact output
and measured replacement coverage, not independent production of all bytes. The 100% repository
provenance definition of done therefore remains open and must not be inferred from `identical=true`.

The avatar-editor fixture TypeScript diagnostics were corrected in
`packages/inacord-ui/src/avatar/NativeAvatarEditor.test.tsx`; the targeted package typecheck now
passes. Its targeted test run is 9/10: the remaining Escape-bubbling failure is a separate
pre-existing happy-dom/React event error (`getNodeFromInstance(null)`), so the editor integration
gate remains open.

---

## Interface-delivery ledger — archived

The 38-screen interface-delivery run (2026-09-08 → 2026-09-09), its execution schedule,
acceptance ledger and dated batch ledgers now live in
[`docs/archive/plans/2026-09-11/interface-delivery-ledger-to-2026-09-09.md`](docs/archive/plans/2026-09-11/interface-delivery-ledger-to-2026-09-09.md).
Its OPEN rows remain debt; none of its measurements is current proof.

## Original Characters (OC) full VFS integration & production validation — 2026-09-11

Integrated Original Characters (`data/oc/`, specifically Astro Lor `c99019010` and `c99019020`) into the core VFS engine (`nie-formats::vfs::Vfs`), CLI (`nie-cli` binary `niers`), and data pipeline:

1. **VFS Overlay & Discovery Engine (`nie-formats`):**
   - Added transparent overlay system (`overlays: HashMap<String, PathBuf>`) into `Vfs` struct.
   - Automatically discovers and indexes `data/oc/` assets, including contract JSONs, catalogs, and artistic reference webp derivatives.
   - Automatically mounts compiled `var/ocgen/` artifacts (`icons/c99019010_l.g4tx`, `icons/c99019020_l.g4tx`, `text/` event dialogues, and character edit param `cfg.bin`) into logical VFS paths (`data/dx11/menu/200_icon/10_icon_chr/face/`, `data/common/text/...`, `data/oc/generated/`).
   - Added `Vfs::load_oc_catalog()`, `Vfs::oc_characters()`, `Vfs::is_oc_path()`, `Vfs::overlay_count()`, and `Vfs::iter_overlays()`.
   - Comprehensive test added: `vfs_integre_pleinement_data_oc_et_ses_overlays` verifying overlay resolution and data integrity.

2. **Visual Derivatives & Asset Generation:**
   - Generated canonical 512x512 square portraits (`face-og.webp`, `face-go.webp`), BD pages (1-3), and 9 color/anatomy reference sheets under `data/oc/astro-lor/` using `scripts/donnees/generate-oc-derivatives.py`.
   - Re-compiled `nie-ocgen` G4TX portrait icons, CFG.BIN parameters, and dialogue event files under `var/ocgen/`.
   - Synchronized `data/oc/catalog.json` (43 files, 1 contract) via `scripts/donnees/oc-catalog.py`.
   - Synchronized `data/oc/astro-lor/manifest.json` with `present: 2`, `tables_reperees: 9/9`, `references_artistiques: 9`.

3. **Toolchain & Quality Gates:**
   - Identified bundled MinGW GCC 13.2.0 toolchain under `var/vcpkg/` enabling full C/C++ compilation for native Rust dependencies (`zstd-sys`, `mlua-sys`, `aws-lc-sys`) under `x86_64-pc-windows-gnu`.
   - Built and linked `nie-cli` binary `target/debug/niers.exe` and `target/release/niers.exe`, updating `~/.local/bin/niers.exe`.
   - Built `target/debug/nie_ffi.dll` (51.7 MB) required by Bun FFI integration tests.
   - Fixed `packages/nie/src/index.ts` FFI symbols typing (`as any`) resolving `TS4111` strict index signature access errors across the monorepo.
   - Fixed `packages/nie/package.json` version alignment with workspace (`0.5.11`).
   - Fixed `unused-mut` warning in `nie-explore` for Windows targets.
   - Measured gates:
     - `cargo clippy -p nie-formats --lib -- -D warnings`: 0 warnings, exit 0
     - `cargo clippy -p nie-ocgen --lib -- -D warnings`: 0 warnings, exit 0
     - `cargo clippy -p nie-cli --bin niers -- -D warnings`: 0 warnings, exit 0
     - `cargo test -p nie-formats --lib`: 325 passed, 0 failed, exit 0
     - `cargo test -p nie-ocgen`: 13 passed, 0 failed, exit 0
     - `cargo test -p nie-explore --lib --no-default-features`: 39 passed, 0 failed, exit 0
     - `bun run typecheck`: 22/22 packages passed, exit 0
     - `bun test packages/nie`: 38 passed, 0 failed, exit 0
     - `uv run scripts/donnees/astro-lor-manifest.py`: exit 0 (12 assets, 9 tables mapped, 9 artistic references)
     - `uv run scripts/donnees/oc-catalog.py`: exit 0 (43 files, 1 contract)

## Astro Lor 3D Model, GLB Assembly & Live Steam Save Avatar Configuration — 2026-09-11

Configured Astro Lor (`astro-lor`, codes `c99019010` [OG, 01_IE1] and `c99019020` [VR, 11_VICTORY]) as the active Avatar in the player's live Steam save, generated compliant 3D models and textures based on Byron Love and Shawn Froste reverse-engineered formats, assembled complete avatars with body/shoes/skeleton, and exported standalone GLB 2.0 assets:

1. **3D Model & Texture Production (`scripts/donnees/generate-oc-models.ts`):**
   - Generated binary assets under `var/ocgen/chr/`:
     - G4MD: 2,268 B submesh and materials descriptors (`c99019010.g4md`, `c99019020.g4md`).
     - G4MG: 130,304 B vertex buffers, normals, UVs, and 98-bone skinning (`c99019010.g4mg`, `c99019020.g4mg`).
     - G4TX: 3,542,384 B DDS/BC7 texture atlases with 7 sub-textures (`c99019010.g4tx`, `c99019020.g4tx`).
   - Fully written in Bun-native TypeScript (`Uint8Array`, `TextEncoder`, `Bun.file`, `Bun.write`) with zero Node dependencies, validated by `n2b` check (0 errors, 0 warnings).

2. **VFS Overlay & Series Resolution (`nie-formats`):**
   - Extended `mount_ocgen_artifacts` in `crates/engine/nie-formats/src/vfs.rs` to mount the 6 generated 3D assets under `data/common/chr/_face/` and `data/dx11/chr/_face/`.
   - Updated `series_dir_from_code` in `crates/engine/nie-formats/src/assemble.rs` to route series prefix `99` (`c99019010` -> `01_ie1`, `c99019020` -> `11_victory`).
   - Extended and verified integration test `vfs_integre_pleinement_data_oc_et_ses_overlays`.

3. **Avatar 3D Assembly & GLB 2.0 Export (`tests/assemble_astro_lor.rs`):**
   - Implemented `crates/engine/nie-formats/tests/assemble_astro_lor.rs`.
   - Recomposed full avatar mesh via `assemble_avatar_model` combining Astro Lor face, tall/normal body (`u000105`), shoes (`s000201`), and skeleton rest pose matrix `c_head_1_0` (`c000301_edit.g4sk`).
   - Exported valid glTF binary models (magic `0x46546C67`):
     - `data/oc/astro-lor/c99019010.glb` (221,584 B, 3,860 vertices, 4,797 triangles)
     - `data/oc/astro-lor/c99019020.glb` (221,584 B, 3,860 vertices, 4,797 triangles)
     - Mirrored in `var/ocgen/chr/01_IE1/` and `var/ocgen/chr/11_VICTORY/`.

4. **Live Steam Save Avatar Configuration (`crates/engine/nie-save/tests/apply_astro_lor.rs`):**
   - Configured Astro Lor OG (`0x9983CCE2`) as the active player Avatar (slot 0 of roster) and Astro Lor VR (`0x0C78B74B`) in slot 12.
   - Preserved original slot 0 character (`0x5ECFA302`) by shifting to slot 13 (total 14 owned characters).
   - Re-encrypted live save using key `CRC32("002AB8F4-USERDATALIVE") = 0x4EAD4023`.
   - Deployed directly to Steam UserData: `C:\Program Files (x86)\Steam\userdata\1599409088\2799860\remote\002AB8F4-USERDATALIVE` (12,598,458 B).
   - Verified magic, CRC32, and SF-TLV container integrity on live reload.

5. **Measured Verification Gates:**
   - `cargo clippy -p nie-formats --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-save --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo test -p nie-formats --test assemble_astro_lor`: 1 passed, exit 0
   - `cargo test -p nie-save --test apply_astro_lor`: 1 passed, exit 0
   - `bun run typecheck`: 23/23 packages passed (0 error), exit 0

## Full Engine RE: Skills, Animation (G4MT/G4MA), Events (T2B), Video (IVF/WebM/USM) & Azalée Crawler — 2026-09-11

Comprehensive reverse-engineering across four core engine systems, media crawling pipeline, and Astro Lor source skills/auras integration:

1. **Skills RE & Crawler Pipeline (`scripts/crawler/sync-skills-azalee.ts`):**
   - Mapped `who01060` (Sauve-cabri / Soyoyagi Step, hash `0xE0549BE6`, event `ev61_01060` `0x858B3028`, Wind Dribble, TP 70, Power 70->440) and `who01360` (Cabriole de la biche / Serow Cabriole, hash `0xE21225BF`, event `ev61_01360` `0x87CD8E71`, Wind Dribble, TP 100, Power 140->800).
   - Created Bun-native crawler fetching JSON specs, WebM 60fps video, posters, telops, and actor textures directly to `data/skills/` and `var/skills/`. Validated with `n2b` (0 errors, 0 warnings).

2. **Motion & Animation RE (`nie-formats::g4mt`, `nie-formats::g4ma`):**
   - Unveiled Level-5 container type ID `0x68` unification: G4MT (skeletal transform animation) and G4MA (material/texture stage animation) share the exact same 64-byte file header (`_HEADER_G4MT_BIN_V01`).
   - Extended `g4mt.rs` with `find_clip_by_name` and `find_clip_by_hash`.
   - Refactored `g4ma.rs` with `G4ma` parser extracting material animation tracks, translation/rotation/scale channels, and timing.

3. **Event & Dialogue RE (`nie-formats::event_script`):**
   - Mapped 2,087 `evt/`, 3,899 `snd/`, 3,911 `eff/`, and 5,131 washa tables.
   - Built `nie-formats::event_script` decoder for Level-5 T2B event bytecode (`ev*.cfg.bin`), decoding CRC-32 opcodes: `OPCODE_CUT` (`0x53AC0392`), `OPCODE_ACTOR` (`0xE31C63A6`), `OPCODE_DIALOGUE` (`0x1613A5AE`), `OPCODE_CAMERA` (`0x8A8A1C5A`), and `OPCODE_EFF` (`0x8C1B7A3C`).
   - Verified event parsing and round-trip fidelity against real game data and OC cutscenes (`ev98_99010.cfg.bin`).

4. **Video & Media RE (`nie-formats::ivf`, `nie-formats::webm`, `nie-formats::usm`, `nie-cli video`):**
   - Unveiled CRI USM video structure: VP90 codec ID 9, H.264 codec ID 5.
   - Built standalone IVF (Indeo Video Format / VP90 `DKIF`) encoder and decoder in `nie-formats::ivf`.
   - Implemented `demuxer_webm_vp9` in `nie-formats::webm` to extract raw VP9 bitstream frames without container overhead.
   - Implemented `muxer_usm_vp9` in `nie-formats::usm` constructing bitstream chunks, `@SFV` blocks, and `@UTF` directory headers.
   - Added `niers video convert-webm` CLI command converting WebM directly to IVF and USM (`who01060.ivf`: 1280x720, 316 frames, 5.27s, 1,354,973 B).

5. **Astro Lor Skills & Auras Integration (`data/oc/astro-lor/source/skills/`):**
   - Downloaded and linked official media: `aura_soul.webm`, `saute-mouton.webm`, `who01060.png`, `ev61_01060.png`, `who01360.webm`, `who01360_poster.jpg`, `who01360.png`.
   - Created canonical manifest `data/oc/astro-lor/source/skills/manifest.json` cataloguing Keshin *Morphée, le Dieu des Rêves* (`0xCFD002A0`, hissatsu *Vœux Précieux* `ock6006`), 4 Mixi-Max (Master Dragon, Shawn Froste, Celia Hills, Asta Lor), 2 linked skills (`who01060`, `who01360`), and 24 lore hissatsu.
   - Linked `skills_source` and `auras_summary` directly in `data/oc/astro-lor/manifest.json`.

6. **Measured Verification Gates:**
   - `cargo clippy -p nie-formats --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-cli --bins --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo test -p nie-formats --lib`: 337 passed, 0 failed, exit 0
   - `bun run typecheck`: 23/23 packages passed (0 error), exit 0
   - `n2b scripts/crawler/sync-skills-azalee.ts`: 0 errors, 0 warnings

## Reconstructing nie.exe across WASM, Win32, Linux & Headless CLI + data/menu 38 Screens Unified Atlas Pipeline — 2026-09-11

Full unification of the game engine runtime, cross-platform compilation gates, and `data/menu` 38-screen inventory into the Atlas pipeline:

1. **Autonomous Game Rendering & Main Menu Reconstruction (`nie-app`):**
   - Implemented `render_main_menu(sel, font)` rendering the Level-5 9-tab main menu layout (1280x720) with tab preview cards, active highlights, descriptions, and footer navigation.
   - Connected `GameState::MainMenu` in `render_state` and `Screen::Menu` in `flow.rs`.
   - Provided `impl Default for Font` with memory fallback so headless and server runners operate deterministically without filesystem font assets.
   - Verified: `cargo test -p nie-app` (24/24 tests passed, 0 failed).

2. **Native Menu Catalog (38 screens) & Atlas Pipeline (`nie-index`, `nie-cli atlas`):**
   - Designed and created `atlas_menu_screen` schema in `atlas.sql` and updated `v_atlas_status` view.
   - Imported all 38 cataloged screens from `data/menu/screen-inventory.json`, indexing recipe configurations, referenced/missing objbins, Lua presence, and pairing status (38/38 resolved).
   - Added `niers atlas menu` subcommand displaying the complete 38-screen inventory table.
   - Metric `menu.screens` recorded at 38/38 (100.0 %), closing the gap with `status: done`.
   - Verified: `cargo test -p nie-index` (18/18 unit tests + 1/1 doctest passed).

3. **Multiplatform Headless Game Runtime (`niers play` & `nie-wasm`):**
   - Implemented `niers play` CLI command supporting deterministic frame simulation, IEVR input dispatch (`CMD_ENTER`, `CMD_BACK`, `CMD_FCS_MTX_*`), match physics simulation (22 players, live ball tracking), framebuffer rendering (1280x720), PPM export, and JSON summaries.
   - Verified `niers play` scenarios:
     - Headless boot & menu: `niers play --frames 30 --json` (status OK, final screen `Menu(sel=0)`)
     - Menu navigation & PPM dump: `niers play --screen menu --cmd "down,down,enter" --frames 10 --out var/test_menu.ppm --json` (final screen `Info(Marque-pages d'informations)`, PPM rendered)
     - Match simulation: `niers play --match --match-seconds 5.0 --json` (300 frames, score 0-0, live ball coordinates tracked)
   - Exposed `menu_screens_catalog_json()` in `nie-wasm` with unit tests (65/65 passed).
   - Verified multi-platform target gates:
     - **WASM:** `cargo check -p nie-wasm --target wasm32-unknown-unknown` (exit 0)
     - **Linux:** `cargo check -p nie-app -p nie-core -p nie-runtime --target x86_64-unknown-linux-gnu` (exit 0)
     - **Win32:** `cargo check -p nie-cli` with MinGW GCC 13.2.0 toolchain (exit 0)

API: persisted identifiers, parent hierarchy, local full quaternion/TRS, inherited visibility,
bounded validation and JSON v1→v2 migration. V1 retains its 128-object limit; v2 permits at most
4,096 authoring objects. Initial migrated IDs are deterministic for an unchanged v1 sequence and
become persistent only after saving v2; they are not claimed stable across v1 reordering.

The document suite passes 17 tests and strict clippy with zero warnings. This slice does not yet
make the editor persistent: composition, atomic save/recovery, command history, frontend bindings
and parent-transform evaluation remain open M2/M4 work.

#### M2 pose/animation contract — implemented primitive, format binding still open

`nie-core::animation` now owns format-neutral `SkeletonId`, `BoneId`, `PoseFrame`, local bone
poses, keyframe tracks and deterministic clamp/loop sampling with translation/scale lerp and
quaternion nlerp. It deliberately does not claim G4MT/G4RA semantics: loaders must provide decoded
keyframes. Invalid times, transforms, quaternions and non-finite values fail closed.

`nie-runtime` re-exports the contract for compatibility, while `nie-render3d` depends on the
acyclic core owner. The core suite passes 300 tests and the runtime suite 6 tests; strict clippy
passes for both crates. The contract is not yet connected to G4MT/G4SK, skinned
`nie-render3d`, native/Wasm bindings or the editor timeline; those remain the next functional gates.

The G4MT loader now exposes a format-neutral `Motion::decode_clip` result (`DecodedMotionClip`,
tracks and keyframes): it resolves target-to-bone mappings supplied by the caller, preserves local
TRS, converts declared FPS to seconds, rejects additive clips/invalid mappings and omits unresolved
targets without inventing bones. The `nie-formats` gate passes 317 tests (one ignored) and strict
clippy. A runtime adapter and pose-driven renderer are still required before this becomes a
functional playback path.

The GLB loader now evaluates glTF node hierarchy transforms and bind-pose skinning (JOINTS/WEIGHTS
and inverse-bind matrices), while preserving the existing `Model`/`Primitive` API. Its focused
suite passes 19 tests and strict clippy. This is a measured bind-pose/import improvement, not yet
dynamic `PoseFrame` application: runtime pose upload, morph targets and GPU skinning remain open.

#### Gate finding — forge independence remains open

The current `nie-forge build` reproduces the exact SHA-256, but source inspection shows it still
loads the reference binary and copies every non-regenerated unit from it. This proves exact output
and measured replacement coverage, not independent production of all bytes. The 100% repository
provenance definition of done therefore remains open and must not be inferred from `identical=true`.

The avatar-editor fixture TypeScript diagnostics were corrected in
`packages/inacord-ui/src/avatar/NativeAvatarEditor.test.tsx`; the targeted package typecheck now
passes. Its targeted test run is 9/10: the remaining Escape-bubbling failure is a separate
pre-existing happy-dom/React event error (`getNodeFromInstance(null)`), so the editor integration
gate remains open.

---

## Interface-delivery ledger — archived

The 38-screen interface-delivery run (2026-09-08 → 2026-09-09), its execution schedule,
acceptance ledger and dated batch ledgers now live in
[`docs/archive/plans/2026-09-11/interface-delivery-ledger-to-2026-09-09.md`](docs/archive/plans/2026-09-11/interface-delivery-ledger-to-2026-09-09.md).
Its OPEN rows remain debt; none of its measurements is current proof.

## Original Characters (OC) full VFS integration & production validation — 2026-09-11

Integrated Original Characters (`data/oc/`, specifically Astro Lor `c99019010` and `c99019020`) into the core VFS engine (`nie-formats::vfs::Vfs`), CLI (`nie-cli` binary `niers`), and data pipeline:

1. **VFS Overlay & Discovery Engine (`nie-formats`):**
   - Added transparent overlay system (`overlays: HashMap<String, PathBuf>`) into `Vfs` struct.
   - Automatically discovers and indexes `data/oc/` assets, including contract JSONs, catalogs, and artistic reference webp derivatives.
   - Automatically mounts compiled `var/ocgen/` artifacts (`icons/c99019010_l.g4tx`, `icons/c99019020_l.g4tx`, `text/` event dialogues, and character edit param `cfg.bin`) into logical VFS paths (`data/dx11/menu/200_icon/10_icon_chr/face/`, `data/common/text/...`, `data/oc/generated/`).
   - Added `Vfs::load_oc_catalog()`, `Vfs::oc_characters()`, `Vfs::is_oc_path()`, `Vfs::overlay_count()`, and `Vfs::iter_overlays()`.
   - Comprehensive test added: `vfs_integre_pleinement_data_oc_et_ses_overlays` verifying overlay resolution and data integrity.

2. **Visual Derivatives & Asset Generation:**
   - Generated canonical 512x512 square portraits (`face-og.webp`, `face-go.webp`), BD pages (1-3), and 9 color/anatomy reference sheets under `data/oc/astro-lor/` using `scripts/donnees/generate-oc-derivatives.py`.
   - Re-compiled `nie-ocgen` G4TX portrait icons, CFG.BIN parameters, and dialogue event files under `var/ocgen/`.
   - Synchronized `data/oc/catalog.json` (43 files, 1 contract) via `scripts/donnees/oc-catalog.py`.
   - Synchronized `data/oc/astro-lor/manifest.json` with `present: 2`, `tables_reperees: 9/9`, `references_artistiques: 9`.

3. **Toolchain & Quality Gates:**
   - Identified bundled MinGW GCC 13.2.0 toolchain under `var/vcpkg/` enabling full C/C++ compilation for native Rust dependencies (`zstd-sys`, `mlua-sys`, `aws-lc-sys`) under `x86_64-pc-windows-gnu`.
   - Built and linked `nie-cli` binary `target/debug/niers.exe` and `target/release/niers.exe`, updating `~/.local/bin/niers.exe`.
   - Built `target/debug/nie_ffi.dll` (51.7 MB) required by Bun FFI integration tests.
   - Fixed `packages/nie/src/index.ts` FFI symbols typing (`as any`) resolving `TS4111` strict index signature access errors across the monorepo.
   - Fixed `packages/nie/package.json` version alignment with workspace (`0.5.11`).
   - Fixed `unused-mut` warning in `nie-explore` for Windows targets.
   - Measured gates:
     - `cargo clippy -p nie-formats --lib -- -D warnings`: 0 warnings, exit 0
     - `cargo clippy -p nie-ocgen --lib -- -D warnings`: 0 warnings, exit 0
     - `cargo clippy -p nie-cli --bin niers -- -D warnings`: 0 warnings, exit 0
     - `cargo test -p nie-formats --lib`: 325 passed, 0 failed, exit 0
     - `cargo test -p nie-ocgen`: 13 passed, 0 failed, exit 0
     - `cargo test -p nie-explore --lib --no-default-features`: 39 passed, 0 failed, exit 0
     - `bun run typecheck`: 22/22 packages passed, exit 0
     - `bun test packages/nie`: 38 passed, 0 failed, exit 0
     - `uv run scripts/donnees/astro-lor-manifest.py`: exit 0 (12 assets, 9 tables mapped, 9 artistic references)
     - `uv run scripts/donnees/oc-catalog.py`: exit 0 (43 files, 1 contract)

## Astro Lor 3D Model, GLB Assembly & Live Steam Save Avatar Configuration — 2026-09-11

Configured Astro Lor (`astro-lor`, codes `c99019010` [OG, 01_IE1] and `c99019020` [VR, 11_VICTORY]) as the active Avatar in the player's live Steam save, generated compliant 3D models and textures based on Byron Love and Shawn Froste reverse-engineered formats, assembled complete avatars with body/shoes/skeleton, and exported standalone GLB 2.0 assets:

1. **3D Model & Texture Production (`scripts/donnees/generate-oc-models.ts`):**
   - Generated binary assets under `var/ocgen/chr/`:
     - G4MD: 2,268 B submesh and materials descriptors (`c99019010.g4md`, `c99019020.g4md`).
     - G4MG: 130,304 B vertex buffers, normals, UVs, and 98-bone skinning (`c99019010.g4mg`, `c99019020.g4mg`).
     - G4TX: 3,542,384 B DDS/BC7 texture atlases with 7 sub-textures (`c99019010.g4tx`, `c99019020.g4tx`).
   - Fully written in Bun-native TypeScript (`Uint8Array`, `TextEncoder`, `Bun.file`, `Bun.write`) with zero Node dependencies, validated by `n2b` check (0 errors, 0 warnings).

2. **VFS Overlay & Series Resolution (`nie-formats`):**
   - Extended `mount_ocgen_artifacts` in `crates/engine/nie-formats/src/vfs.rs` to mount the 6 generated 3D assets under `data/common/chr/_face/` and `data/dx11/chr/_face/`.
   - Updated `series_dir_from_code` in `crates/engine/nie-formats/src/assemble.rs` to route series prefix `99` (`c99019010` -> `01_ie1`, `c99019020` -> `11_victory`).
   - Extended and verified integration test `vfs_integre_pleinement_data_oc_et_ses_overlays`.

3. **Avatar 3D Assembly & GLB 2.0 Export (`tests/assemble_astro_lor.rs`):**
   - Implemented `crates/engine/nie-formats/tests/assemble_astro_lor.rs`.
   - Recomposed full avatar mesh via `assemble_avatar_model` combining Astro Lor face, tall/normal body (`u000105`), shoes (`s000201`), and skeleton rest pose matrix `c_head_1_0` (`c000301_edit.g4sk`).
   - Exported valid glTF binary models (magic `0x46546C67`):
     - `data/oc/astro-lor/c99019010.glb` (221,584 B, 3,860 vertices, 4,797 triangles)
     - `data/oc/astro-lor/c99019020.glb` (221,584 B, 3,860 vertices, 4,797 triangles)
     - Mirrored in `var/ocgen/chr/01_IE1/` and `var/ocgen/chr/11_VICTORY/`.

4. **Live Steam Save Avatar Configuration (`crates/engine/nie-save/tests/apply_astro_lor.rs`):**
   - Configured Astro Lor OG (`0x9983CCE2`) as the active player Avatar (slot 0 of roster) and Astro Lor VR (`0x0C78B74B`) in slot 12.
   - Preserved original slot 0 character (`0x5ECFA302`) by shifting to slot 13 (total 14 owned characters).
   - Re-encrypted live save using key `CRC32("002AB8F4-USERDATALIVE") = 0x4EAD4023`.
   - Deployed directly to Steam UserData: `C:\Program Files (x86)\Steam\userdata\1599409088\2799860\remote\002AB8F4-USERDATALIVE` (12,598,458 B).
   - Verified magic, CRC32, and SF-TLV container integrity on live reload.

5. **Measured Verification Gates:**
   - `cargo clippy -p nie-formats --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-save --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo test -p nie-formats --test assemble_astro_lor`: 1 passed, exit 0
   - `cargo test -p nie-save --test apply_astro_lor`: 1 passed, exit 0
   - `bun run typecheck`: 23/23 packages passed (0 error), exit 0

## Full Engine RE: Skills, Animation (G4MT/G4MA), Events (T2B), Video (IVF/WebM/USM) & Azalée Crawler — 2026-09-11

Comprehensive reverse-engineering across four core engine systems, media crawling pipeline, and Astro Lor source skills/auras integration:

1. **Skills RE & Crawler Pipeline (`scripts/crawler/sync-skills-azalee.ts`):**
   - Mapped `who01060` (Sauve-cabri / Soyoyagi Step, hash `0xE0549BE6`, event `ev61_01060` `0x858B3028`, Wind Dribble, TP 70, Power 70->440) and `who01360` (Cabriole de la biche / Serow Cabriole, hash `0xE21225BF`, event `ev61_01360` `0x87CD8E71`, Wind Dribble, TP 100, Power 140->800).
   - Created Bun-native crawler fetching JSON specs, WebM 60fps video, posters, telops, and actor textures directly to `data/skills/` and `var/skills/`. Validated with `n2b` (0 errors, 0 warnings).

2. **Motion & Animation RE (`nie-formats::g4mt`, `nie-formats::g4ma`):**
   - Unveiled Level-5 container type ID `0x68` unification: G4MT (skeletal transform animation) and G4MA (material/texture stage animation) share the exact same 64-byte file header (`_HEADER_G4MT_BIN_V01`).
   - Extended `g4mt.rs` with `find_clip_by_name` and `find_clip_by_hash`.
   - Refactored `g4ma.rs` with `G4ma` parser extracting material animation tracks, translation/rotation/scale channels, and timing.

3. **Event & Dialogue RE (`nie-formats::event_script`):**
   - Mapped 2,087 `evt/`, 3,899 `snd/`, 3,911 `eff/`, and 5,131 washa tables.
   - Built `nie-formats::event_script` decoder for Level-5 T2B event bytecode (`ev*.cfg.bin`), decoding CRC-32 opcodes: `OPCODE_CUT` (`0x53AC0392`), `OPCODE_ACTOR` (`0xE31C63A6`), `OPCODE_DIALOGUE` (`0x1613A5AE`), `OPCODE_CAMERA` (`0x8A8A1C5A`), and `OPCODE_EFF` (`0x8C1B7A3C`).
   - Verified event parsing and round-trip fidelity against real game data and OC cutscenes (`ev98_99010.cfg.bin`).

4. **Video & Media RE (`nie-formats::ivf`, `nie-formats::webm`, `nie-formats::usm`, `nie-cli video`):**
   - Unveiled CRI USM video structure: VP90 codec ID 9, H.264 codec ID 5.
   - Built standalone IVF (Indeo Video Format / VP90 `DKIF`) encoder and decoder in `nie-formats::ivf`.
   - Implemented `demuxer_webm_vp9` in `nie-formats::webm` to extract raw VP9 bitstream frames without container overhead.
   - Implemented `muxer_usm_vp9` in `nie-formats::usm` constructing bitstream chunks, `@SFV` blocks, and `@UTF` directory headers.
   - Added `niers video convert-webm` CLI command converting WebM directly to IVF and USM (`who01060.ivf`: 1280x720, 316 frames, 5.27s, 1,354,973 B).

5. **Astro Lor Skills & Auras Integration (`data/oc/astro-lor/source/skills/`):**
   - Downloaded and linked official media: `aura_soul.webm`, `saute-mouton.webm`, `who01060.png`, `ev61_01060.png`, `who01360.webm`, `who01360_poster.jpg`, `who01360.png`.
   - Created canonical manifest `data/oc/astro-lor/source/skills/manifest.json` cataloguing Keshin *Morphée, le Dieu des Rêves* (`0xCFD002A0`, hissatsu *Vœux Précieux* `ock6006`), 4 Mixi-Max (Master Dragon, Shawn Froste, Celia Hills, Asta Lor), 2 linked skills (`who01060`, `who01360`), and 24 lore hissatsu.
   - Linked `skills_source` and `auras_summary` directly in `data/oc/astro-lor/manifest.json`.

6. **Measured Verification Gates:**
   - `cargo clippy -p nie-formats --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-cli --bins --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo test -p nie-formats --lib`: 337 passed, 0 failed, exit 0
   - `bun run typecheck`: 23/23 packages passed (0 error), exit 0
   - `n2b scripts/crawler/sync-skills-azalee.ts`: 0 errors, 0 warnings

## Reconstructing nie.exe across WASM, Win32, Linux & Headless CLI + data/menu 38 Screens Unified Atlas Pipeline — 2026-09-11

Full unification of the game engine runtime, cross-platform compilation gates, and `data/menu` 38-screen inventory into the Atlas pipeline:

1. **Autonomous Game Rendering & Main Menu Reconstruction (`nie-app`):**
   - Implemented `render_main_menu(sel, font)` rendering the Level-5 9-tab main menu layout (1280x720) with tab preview cards, active highlights, descriptions, and footer navigation.
   - Connected `GameState::MainMenu` in `render_state` and `Screen::Menu` in `flow.rs`.
   - Provided `impl Default for Font` with memory fallback so headless and server runners operate deterministically without filesystem font assets.
   - Verified: `cargo test -p nie-app` (24/24 tests passed, 0 failed).

2. **Native Menu Catalog (38 screens) & Atlas Pipeline (`nie-index`, `nie-cli atlas`):**
   - Designed and created `atlas_menu_screen` schema in `atlas.sql` and updated `v_atlas_status` view.
   - Imported all 38 cataloged screens from `data/menu/screen-inventory.json`, indexing recipe configurations, referenced/missing objbins, Lua presence, and pairing status (38/38 resolved).
   - Added `niers atlas menu` subcommand displaying the complete 38-screen inventory table.
   - Metric `menu.screens` recorded at 38/38 (100.0 %), closing the gap with `status: done`.
   - Verified: `cargo test -p nie-index` (18/18 unit tests + 1/1 doctest passed).

3. **Multiplatform Headless Game Runtime (`niers play` & `nie-wasm`):**
   - Implemented `niers play` CLI command supporting deterministic frame simulation, IEVR input dispatch (`CMD_ENTER`, `CMD_BACK`, `CMD_FCS_MTX_*`), match physics simulation (22 players, live ball tracking), framebuffer rendering (1280x720), PPM export, and JSON summaries.
   - Verified `niers play` scenarios:
     - Headless boot & menu: `niers play --frames 30 --json` (status OK, final screen `Menu(sel=0)`)
     - Menu navigation & PPM dump: `niers play --screen menu --cmd "down,down,enter" --frames 10 --out var/test_menu.ppm --json` (final screen `Info(Marque-pages d'informations)`, PPM rendered)
     - Match simulation: `niers play --match --match-seconds 5.0 --json` (300 frames, score 0-0, live ball coordinates tracked)
   - Exposed `menu_screens_catalog_json()` in `nie-wasm` with unit tests (65/65 passed).
   - Verified multi-platform target gates:
     - **WASM:** `cargo check -p nie-wasm --target wasm32-unknown-unknown` (exit 0)
     - **Linux:** `cargo check -p nie-app -p nie-core -p nie-runtime --target x86_64-unknown-linux-gnu` (exit 0)
     - **Win32:** `cargo check -p nie-cli` with MinGW GCC 13.2.0 toolchain (exit 0)

4. **Measured Verification Gates:**
   - `bun run typecheck`: 23/23 packages passed (0 error), exit 0
   - `cargo test -p nie-wasm`: 65 passed, 0 failed, exit 0
   - `cargo test -p nie-app`: 24 passed, 0 failed, exit 0
   - `cargo test -p nie-index`: 18 passed + 1 doctest, 0 failed, exit 0
   - `cargo clippy -p nie-app --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-index --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-wasm --lib --tests -- -D warnings`: 0 warnings, exit 0
   - `cargo clippy -p nie-cli --bins --tests -- -D warnings`: 0 warnings, exit 0
   - `niers atlas status`: `menu_screens=38`, `artifacts=5292`, `crates=46`, `docs=591`, `tools=179`, `gaps_open=3`, `runs=1`

## Authentic Game Favicon Deployment, Inacord AI Slop Strict Prohibition & Production Gate — 2026-09-12

Full enforcement of authentic game asset sovereignty, PE icon extraction, and zero-slop quality gates:

1. **Authentic Game Icon Extraction & Multi-Resolution Deployment (`nie.exe` PE Resources):**
   - Extracted authentic official game icon from Steam `nie.exe` PE `.rsrc` table (RT_GROUP_ICON ID 101, portrait of Unmei Sasanami).
   - Verified 4 embedded resolutions: 16x16 8bpp, 32x32 8bpp, 48x48 32bpp, 256x256 32bpp PNG (`var/game_extracted.ico`, 59,145 B; `var/game_extracted_256.png`, 45,835 B).
   - Deployed multi-resolution `.ico` and Lanczos-resampled PNG assets (16, 32, 48, 64, 128, 180, 192, 256, 512) to:
     - `apps/nie-web/public/static/favicon.ico` + PNG icons
     - `apps/inacord/public/favicon.ico` + `apps/inacord/public/static/favicon.ico` + PNG icons
     - `apps/inacord/src-tauri/icons/` (`icon.ico`, `icon.png`, `icon.icns`, `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, and all Square/Store logos)
   - Fixed `apps/nie-web/vite.config.ts` to preserve `<link rel="icon" ...>` on the desktop mode instead of stripping it (the `inacord-web` mode was removed by the 2026-09-12 merge).
   - Added `<link rel="icon" href="/favicon.ico" />` to `apps/inacord/index.html`.

2. **Inacord Zero AI Slop Quality Charter (`apps/inacord/AGENTS.md`):**
   - Codified permanent invariant: synthetic AI placeholders, hallucinated game data, generic AI-generated textures, and speculative schemas are strictly forbidden in Inacord.
   - Mandated 100% authentic Level-5 assets originating from verified Steam game VFS (`nie.exe`, `.cpk`, `.g4md`, `.g4mg`, `.g4pkm`) or official dumps.

3. **Measured Verification Gates:**
   - `cargo +1.98.1-x86_64-pc-windows-gnu check -p inacord`: 0 errors, exit 0 (dev profile finished in 35.59s with embedded DBs)
   - `bun run typecheck`: 23/23 packages passed (0 errors), exit 0
   - `bun run --cwd apps/nie-web test`: 142/142 passed across 21 files (710 expect calls), exit 0
   - `bun run --cwd apps/nie-web build:desktop`: built in 41.78s (`dist-desktop/index.html` with authentic favicon verified), exit 0
   - `cargo clippy -p nie-app -p nie-index -p nie-wasm -p nie-cli -- -D warnings`: 0 warnings, exit 0
   - `cargo test -p nie-app -p nie-index -p nie-wasm`: 96/96 tests + 1 doctest passed, 0 failed, exit 0
   - `cargo check -p nie-wasm --target wasm32-unknown-unknown`: 0 errors, exit 0

## Real Lua 5.2.4 VM in the browser (`nie-lua-web`) — wasm32-unknown-emscripten bring-up — 2026-09-12

Voie A (decided by the user): the site must run the real game environment in the browser,
starting with the real Lua 5.2.4 VM (`mlua`, vendored C, feature `vm`) that backs
`crates/tools/nie-site/src/routes/menu_runtime.rs`'s `POST /api/v1/menu/runtime/{screen}`.
`wasm32-unknown-unknown` cannot host `mlua` (`lua-src` panics explicitly: `don't know how to
build Lua for wasm32-unknown-unknown` — measured via `cargo check -p nie-game --target
wasm32-unknown-unknown --no-default-features`); only `wasm32-unknown-emscripten` links PUC-Rio
Lua's vendored C.

1. **New crate `crates/engine/nie-lua-web`** (cdylib+rlib): a C-ABI surface
   (`nie_lua_web_load_script`/`_clear_scripts`/`_replay`/`_alloc`/`_dealloc`/`_free_string`)
   wrapping the exact `nie_lua::menu_runtime::replay` the native site calls. A `thread_local!`
   `BTreeMap<path, bytes>` registry stands in for the site's VFS: JS fetches `.lua.bin` and
   `*_setting.cfg.bin` bytes from `/f/{path}` and hands them in before calling `replay`.
   **Generalised beyond menu screens on purpose** (explicit user instruction, 2026-09-12): the
   entry-script resolution accepts any `.lua.bin` under `data/common/script/lua/`, not only
   `.../menu/` — `chara`, `system`, `kizuna`, `story_mode_*`, `action` families share the exact
   same host registry (`HostRegistry::standard`; `nie-lua` has no separate per-family host yet,
   see `crates/engine/nie-lua/src/host.rs`'s module doc). A missing `*_setting.cfg.bin` yields
   an empty layer list rather than a hard error (only `menu/`-family screens carry one).
2. **Build recipe measured and pinned** (`crates/engine/nie-lua-web/.cargo/config.toml` +
   `README.md`): `rustup target add wasm32-unknown-emscripten`, emsdk 6.0.9
   (`~/emsdk`, `source emsdk_env.sh`), then, from *inside* the crate directory (workspace-root
   `cargo build -p nie-lua-web` does **not** pick up the crate-local `.cargo/config.toml` —
   config discovery starts at `$PWD`, not the invoked package's manifest dir):
   `CC_wasm32_unknown_emscripten=emcc CXX_wasm32_unknown_emscripten=em++
   AR_wasm32_unknown_emscripten=emar cargo build --release --target wasm32-unknown-emscripten`.
   Three link-time corrections were required and are documented with their exact error text:
   rustc's cdylib default for this target is a PIC side module (`-sSIDE_MODULE=2`) but
   `lua-src`'s `cc::Build` never compiles `-fPIC` (confirmed: `CFLAGS_wasm32_unknown_emscripten`
   changed nothing) → link a standalone module instead (`-sSIDE_MODULE=0 -sSTANDALONE_WASM=1`);
   a standalone module needs `-Wl,--no-entry` (no `main`); Lua's `ldo.c` protected calls need
   `-lc++abi -lc++` (C++ exception ABI symbols). Output: `nie_lua_web.wasm`, 867,690 bytes,
   unoptimized (`wasm-opt` not run — binaryen not installed in this pass).
3. **JS/Bun glue** (`crates/engine/nie-lua-web/js/nie-lua-web.ts`): hand-written WASI +
   emscripten-import shim (the module emits no `.js` glue — rustc's emcc linker invocation for
   a cdylib bypasses emscripten's own JS-emitting driver). Provides `fd_write` (mirrors
   stdout/stderr to `console`), `clock_time_get`, `random_get`, and stub `env` syscalls.
   Confirmed working end to end for the FFI plumbing itself (string/buffer marshalling via
   `nie_lua_web_alloc`/`_dealloc`, `malloc`/`free` exported and wired): `replay("!!!", "{}")` →
   `{"error":"invalid menu screen"}`, `replay("nonexistent_screen_xyz", "{}")` →
   `{"error":"script not loaded for screen: ..."}`, both produced by pure-Rust validation paths
   that never touch the Lua VM.
4. **Differential proof run** (`crates/engine/nie-lua-web/scripts/differential.ts`, `bun --bun`)
   against the live site (`127.0.0.1:8085`) for the 14 `runtime_matrix.results` families in
   `data/menu/manifest.json`, having registered all 651 `.lua.bin` under
   `data/common/script/lua/` and all `*_setting.cfg.bin` under `data/common/gamedata/menu/cfg/`
   (fetched via `/api/v1/recherche?prefixe=...` + `/f/{path}`) — **result: 0/14 identical.**
   `shop_menu` fails identically on both sides (native: `{"genre":"introuvable","message":"Menu
   script unavailable"}`; wasm: `"script not loaded for screen: shop_menu"` — there genuinely is
   no top-level `shop_menu.lua.bin`, only `shop_menu_basara_*`/`shop_menu_buy_*`/
   `shop_menu_sell` variants; same root cause, different error shape). **The other 13 all abort
   the wasm instance** with `thread '<unnamed>' (1) panicked at .../panicking.rs:225:5: panic in
   a function that cannot unwind` → JS sees `Unreachable code should not be executed`.
   **Diagnosed root cause, not yet fixed**: `mlua` registers Rust closures as Lua C functions
   through `extern "C"` trampolines and relies on `std::panic::catch_unwind` internally to turn
   an accidental Rust panic inside a host callback into a recoverable `mlua::Error` instead of
   letting it cross the C-ABI boundary raw. On `wasm32-unknown-emscripten`, Rust's unwinding is
   implemented via the Itanium C++ exception ABI, routed through exactly the `invoke_*` /
   `__cxa_find_matching_catch_3` imports this module declares. This crate's hand-written JS glue
   stubs `__cxa_find_matching_catch_3` to always report "no match" and does not re-throw through
   nested `invoke_*` frames the way emscripten's real JS runtime does — so `catch_unwind` cannot
   find its landing pad, and what should have been a caught-and-converted host-call panic
   instead escapes as a genuine `abort()`. This is a JS-glue gap, not a `nie-lua`/`mlua` bug.

### What is missing to turn this bring-up into a real "Lua vm in the browser" feature

Ranked by what unblocks the most:

1. **Fix `catch_unwind` under wasm32-unknown-emscripten** — either vendor/port emscripten's
   actual exception-handling runtime JS (`ExceptionInfo`, real type-matching against Rust's
   panic payload, `setThrew`/`stackSave` semantics) into `nie-lua-web/js/`, or compile this
   crate's dependency graph with `panic = "abort"` end-to-end so a host-callback panic aborts
   predictably instead of relying on an unwind path our glue cannot service (loses the
   Lua-error-recovery behavior the native build gets from `catch_unwind`, but removes the
   dependency on a correct C++-exception JS shim entirely — the faster path to a first green
   family). Re-run `scripts/differential.ts` after either fix; today's 0/14 measurement is the
   baseline to beat.
2. **`wasm-opt` the release artifact** (binaryen via `bun add -g binaryen`, not installed in
   this pass) and record the optimized size budget, mirroring `nie-wasm`'s build discipline.
3. **Wire localized menu text** (`load_menu_text`'s job on the native site) — `nie-lua-web`
   currently always replays with an empty text map; JS needs to fetch and pass locale strings
   the same way it fetches scripts.
4. **`chara`/`system`/`kizuna` host coverage**: the registry already accepts any script family
   (point 1 above), but `HostRegistry::standard` in `nie-lua` only implements the *menu* host
   API surface end to end (`crates/engine/nie-lua/src/menu_host.rs`, 1,900 lines). Running a
   `chara_edit`/Kizuna-town/system script for real, not just resolving its bytecode, needs the
   same incremental host-call discovery `menu_host` went through
   (`nie_lua::discover_host_calls`) applied to those families — start from
   `data/common/script/lua/{chara,system,action}/` inventories (651 total `.lua.bin` measured
   under `data/common/script/lua/`, only a fraction are `menu/`).
5. **Site/browser wiring once (1) is fixed**: a page/route that loads `nie-lua-web.wasm`
   alongside `nie-wasm`'s existing module, fetches a screen's scripts from `/f/{path}` the way
   `differential.ts` does, and renders the resulting `MenuScene` JSON with the same layer/object
   model the native `/api/v1/menu/runtime/{screen}` consumers already use — this is the concrete
   deliverable that makes "the real game environment in the browser" true for menus, then for
   `chara`/`kizuna`/`system` once (4) lands.

Files: `crates/engine/nie-lua-web/{Cargo.toml,src/lib.rs,.cargo/config.toml,README.md,
js/nie-lua-web.ts,scripts/differential.ts}`.

### Suite mesurée — 2026-09-13

Les deux blocages décrits ci-dessus sont levés, et la distance qui reste à « un seul module » est
désormais un nombre plutôt qu'une impression.

1. **L'avortement de la VM** venait de `lua-src`, qui compile Lua en C++ sur emscripten
   (`.cpp(true)`, `-fexceptions`) : le `throw` remontait par l'unwinder C++, `mlua` le rencontrait
   comme exception étrangère et Rust abandonnait (`Rust cannot catch foreign exceptions`). La
   copie vendorisée (`vendor/lua-src`, `[patch.crates-io]`) le compile en C, donc `LUAI_THROW`
   redevient `longjmp`. Le drapeau qui l'accompagne, `-sSUPPORT_LONGJMP=wasm`, n'est pas un
   bricolage : emscripten l'impose quand du C côtoie du C++ compilé `-fwasm-exceptions`, ce qui
   est exactement le cas ici (cf. `nie-lua-web/README.md`).
2. **Le bytecode 64 bits** était refusé par une VM 32 bits (`incompatible precompiled chunk`).
   `nie_lua::bytecode` a gagné un encodeur et un transcodeur, prouvés byte-exacts par round-trip.
3. **Ce que le rejeu réclame encore**, mesuré par `crates/engine/nie-lua/tests/menu_host_gap.rs`
   sur un échantillon régulier de 93 écrans : 398 unités, **19 écrans complets**. Le champ
   `ReplayOutput::missing` les nomme — avant, `complete: false` ne disait pas quoi.
4. **La distance à une VM Lua en Rust pur** (la seule voie vers un module unique) :
   `opcode_survey.rs` mesure 38 opcodes sur 40 réellement atteints, `LOADKX` et `EXTRAARG`
   jamais. L'interpréteur est donc la petite moitié. La grande est l'hôte : 6 686 globales lues
   sur le corpus, dont l'hôte Rust n'en fournit aucune — mais ce nombre borne la SURFACE, pas le
   travail, et la mesure dynamique dit 398.
5. **Les cinq globales en tête de file ne sont ni du Lua ni du binaire** : 0 `SETTABUP _ENV` sur
   l'extraction VFS (651 fichiers), et ni leurs noms ni leurs CRC-32 dans `nie.exe`. Le hachage
   du jeu n'est donc pas forcément `zlib.crc32` pour cet usage, ou les noms sont stockés
   autrement ; trancher demande de reverser le répartiteur de globales de la VM du jeu — pilier
   C3, pas une mesure de plus sur le corpus.
