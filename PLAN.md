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

### Inacord distribution lane — 2026-09-09

`inacord.aphrody.com` is the dedicated download and browser-workspace origin. Its root is a
generated static, zero-JavaScript hub for the signed Windows desktop installer, Linux CLI and MCP archives, Blender
and agent plugins, the installable mobile web application, and the complete browser-adapted
Inacord shell. Native Android/iOS packages remain explicitly unavailable until signed artifacts
and platform runners exist; the mobile web entry must never be relabelled as an APK or IPA.

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
`inacord.aphrody.com` with expiry 2026-12-08. The immutable manifest and live HTTP interaction
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
