# Contributing

Read this before opening a pull request. It is short on etiquette and long on the two things that
actually get a change merged here: **a measurement**, and **a scope**.

- [Before anything: the licence is not open source](#before-anything-the-licence-is-not-open-source)
- [What this repository ships](#what-this-repository-ships)
- [Setting up](#setting-up)
- [The gate](#the-gate)
- [Writing the change](#writing-the-change)
- [Commits](#commits)
- [Pull requests](#pull-requests)
- [Shipping](#shipping)
- [Type gate ratchet](#type-gate-ratchet)
- [Reporting a bug, asking for a feature](#reporting-a-bug-asking-for-a-feature)

## Before anything: the licence is not open source

The public visibility of this repository is not a grant. [`LICENSE`](LICENSE) is a commercial
exploitation agreement (RG-L5-VR-2026-001) between Rose Griffon and LEVEL-5 Inc.; it is not an
OSI-approved licence and it does not give you the right to redistribute, fork for publication, or
ship a derivative. You may read the code, run it against a copy of the game you own, and propose
changes here.

By opening a pull request you agree that your contribution is licensed under the same agreement
and that you have the right to submit it.

**No game content, ever.** `data/` and `nie.exe` are gitignored on purpose. A patch that adds an
asset, a texture, a decrypted table, or a dump of copyrighted text is refused regardless of its
technical quality. Formats, measurements and code derived from reverse engineering are welcome;
the bytes they describe are not. See [`NOTICE`](NOTICE).

## What this repository ships

Five surfaces, each releasable on its own. `bun run surfaces list` prints this table with the
crate counts derived live from `cargo metadata`:

| Surface | Artefact | Root crate | Release tag |
| --- | --- | --- | --- |
| `cli` | `nie` — VFS, formats, the reverse-engineering atlas | `nie-cli` | `cli-v*` |
| `mcp` | `nie-mcp` — the native Model Context Protocol server | `nie-mcp` | `mcp-v*` |
| `site` | `nie-site` and the WebAssembly module it serves | `nie-site`, `nie-wasm` | `site-v*` |
| `desktop` | Inacord, the Tauri application | `inacord` | `desktop-v*` |
| `model` | `nie-model-serve`, the asset server | `nie-model-serve` | `model-v*` |

They are separate for **building, releasing and deploying** — shipping the CLI must not rebuild
the site. They are deliberately **not** separate in CI; the next section says why.

## Setting up

```sh
bun install
cargo build --release -p nie-cli     # the CLI, ~5 min cold
```

Three things this repository assumes and does not install for you:

- the toolchain pinned by `rust-toolchain.toml`, and `mold` as linker;
- the sibling private repository `../iecode` (the `iecode-*` crates), a `path` dependency —
  without it `cargo metadata` fails before the first compilation;
- your own copy of the game, pointed at by `NIE_GAME_DIR`, for anything that reads the VFS.

Tests that need the game are feature-gated (`--features real-fixtures`, `real-saves`) or skipped.
CI has none of that data, so **a test that reads the VFS cannot be a gate** — see
[The gate](#the-gate).

## The gate

One command, and it scopes itself to what you actually changed:

```sh
bun run gate                  # clippy over the surfaces your diff can have broken
bun run gate --base origin/main
bun run surfaces plan         # just tell me which surfaces those are
```

### Why it is one job and not one per surface

It is tempting to give each surface its own CI lane. Measured over the last 400 commits, that is
**worse**:

| Shape | Crate-compilations over 400 commits |
| --- | --- |
| One lane per surface (5) | 19 638 |
| One lane per surface, `nie-wasm` split out (6) | 21 475 |
| Today's `clippy --workspace` | 18 800 |
| **One job, scoped to the union of affected surfaces** | **10 026** |

The surfaces share almost all their crates — the union of the five closures is 36 of 47 workspace
members, and `cli` has *zero* crates of its own — so a per-surface split recompiles the shared
ones once per lane. It would also run five concurrent `cargo` processes on a single memory-bound
VPS, which this repository already knows gets OOM-killed.

The win is not parallelism, it is **refusing to run a gate the diff cannot have broken**: 34.5 %
of commits reach no surface at all (docs, scripts, data) and only 6.8 % touch a shared manifest
and genuinely need all 47 crates.

`scripts/surfaces.ts` holds that logic. It declares only each surface's **root crate**; the
dependency closure is read from `cargo metadata` at call time, so adding a dependency widens the
right lane by itself and no hand-written list can drift.

### What the gate does not check

- **`cargo fmt --check`.** The repository never adopted rustfmt's defaults (454 files of drift,
  no `rustfmt.toml` describing the real style). Adopting a style is a deliberate commit, not a
  side effect of a gate.
- **`cargo test --workspace`.** Linking ~100 test binaries fills the VPS disk. `clippy
  --all-targets` type-checks the same targets without producing an executable. The tests that do
  run are the four copyright-free crates: `nie-core`, `nie-pe`, `nie-asm`, `nie-forge`.
- **Anything a compiler cannot see.** A resource that is never read, a table that comes back
  empty, a page that renders blank — clippy and `tsc` are both happy. Run the thing.

## Writing the change

- **Measure, do not assert.** Every number in a doc, a comment or a PR body is the output of a
  command someone can re-run. "Improves performance" is not a claim this repository accepts;
  "3.4 s → 1.1 s, `just bench`" is.
- **Extract before you bind.** Logic moves into a library crate with its tests, the existing
  caller keeps working through that library, and only then does a second surface appear. This
  repository has already paid for the alternative on keeper, menu and match-sim.
- **One owner per capability.** Before creating a crate or a package, find who already owns the
  capability — `nie atlas search <term>` covers docs, symbols, tools, files and crates at once.
- **English for everything the machine reads**: files, directories, identifiers, URLs, JSON keys,
  database columns, commit messages, code comments, documentation. French is for prose addressed
  to a human. Frozen product names are the exception: Azalée, Inacord, nie, `nie`, `nie-*`.

## Commits

Conventional Commits, scoped to a crate or package:

```
feat(nie-site): serve the composed screen behind /api/v1/menu/render
fix(nie-formats): stop truncating a function split across .pdata chunks
docs(re): re-anchor the knowledge base on nie.exe
```

Two rules with scars behind them:

- **Never put a gate and a `git commit` in the same shell invocation.** `cargo test … ; git commit
  …` runs the gate, prints its failure, and commits anyway — the output arrives after the commit
  has already happened. Run the gate, *read* it, then commit separately. There is no commit hook
  to catch this for you.
- **No AI watermarks.** No `Co-authored-by: Claude`, no `Generated-by`. A change made on a peer
  agent's behalf is attributed to that peer by name.

## Pull requests

Fill in [the template](.github/PULL_REQUEST_TEMPLATE.md). It asks for the **output**, not the
intention. A suite that prints `0 passed` did not run; a data-gated test that skipped is a false
green and must be declared as one.

`CODEOWNERS` marks the trees where a review is not optional: the forge (`crates/forge/`, judged
byte for byte), the legal files, the agent instructions, and the publication chain — a mistake
there breaks the updater of every installed client.

## Shipping

Four steps, in this order, per surface:

```sh
bun run surfaces gate  site     # scoped clippy
bun run surfaces build site     # the artefact
bun run surfaces smoke site     # run what you just built
bun run surfaces deploy site    # hands its targets to scripts/deploy-target.ts
```

`smoke` reads `target/release/`, so it only means anything after `build`.

**Releasing** is a prefixed tag, and it builds that surface alone:

```sh
git tag cli-v0.6.1 && git push origin cli-v0.6.1
```

A single `v0.6.1` tag would force all five surfaces to be rebuilt and republished together, which
in practice means never publishing at all: the site moves on 17.2 % of commits, the CLI on 0.5 %.

A synchronized repository milestone is the deliberate exception: after the full
`bun run release:all --deploy` gate has published and validated one exact commit, a root
`vX.Y.Z` tag may freeze that commit and one GitHub release may attach all five surface artifacts.
Routine releases remain prefixed and independent.

**A stable cut** (first one: `1.0.0`, 2026-09-20) means that **one exact commit is gated,
packaged, pushed, deployed, live-validated, tagged and recoverable** — all seven, for the same
commit. It does not declare the open reverse-engineering, native-rendering or parity gaps
complete; those stay in [`PLAN.md`](PLAN.md). The distributable npm surface is limited to the two
public nie bindings; internal applications and packages stay private or keep their own versions.
Rust packages stay `publish = false`: the commercial `LICENSE` is not an OSI crate licence and
does not authorise a crates.io source release, so the stable Rust distribution is the verified
native/WASM binary set and source snapshot attached to the GitHub release. Changing that boundary
is a licensing decision, not a release-script bypass. (The portable `iecode-*` crates this
workspace consumes from `../iecode` are a separate repository with its own publication gate —
see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).)

**Deploying is not releasing.** A tag touches no running service. Production goes through
`scripts/deploy-target.ts`, by hand, on an explicit request, with its own lock, per-target
deadlines and live health checks. The units and the vhost are owned by aphrody-infra
(`../aphrody-infra/systemd/nie-*.service`, `nginx/aphrody/aphrody.com.conf`): installing them into
`/etc`, `daemon-reload`, `nginx -t` and `reload` follow its runbook — and the installed files
drift, so `diff` against `/etc` and run `ss -ltnp` before changing one.

## Type gate ratchet

`scripts/` held 55 TypeScript files — the release and deploy pipeline among them — that **no
`tsconfig.json` covered**. Switching the whole directory on yields 299 errors, almost all
`noUncheckedIndexedAccess`, and this repository refuses a permanently red gate: one that is always
red is one nobody reads.

So `scripts/tsconfig.gate.json` lists the files that are green, `bun run typecheck:scripts` gates
them, and the list only grows. **A new script belongs in that list from its first commit.** To
clean an existing one, fix it, add it, and the gate holds it forever after.

**What the ratchet is worth, measured 2026-09-20.** `deploy-target.ts` — the script that swaps
production — was one of the uncovered files. Cleaning it cost sixteen errors, fifteen of them
mechanical `TS4111`/`TS2532`. The sixteenth was a defect on the **rollback** path:
`symlink(previous, …)` ran unconditionally, so when `dist` was not already a symlink the rollback
threw *inside the catch block*, masking the health-check failure that triggered it and leaving the
broken bundle live. No test covered it, because a rollback only runs when a deploy is already
failing.

## Reporting a bug, asking for a feature

Use the [issue templates](.github/ISSUE_TEMPLATE/). For a bug, the two fields that decide whether
it is actionable are the **exact command** and its **exact output** — including the parts that
look irrelevant.

Security issues do **not** go in a public issue. Follow [`SECURITY.md`](SECURITY.md): a private
GitHub advisory, or `security@rosegriffon.fr`.
