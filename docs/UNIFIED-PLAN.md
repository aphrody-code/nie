# UNIFIED-PLAN.md — Master Execution Plan & Operational Roadmap

> Canonical active plan: [`../PLAN.md`](../PLAN.md). This document remains the English
> coordination appendix; current decisions, gates, and resume order live at repository root.

> **Consolidated on 2026-09-07.**
> Synthesizes:
> 1. The Supreme Objective: **PLAN-SITE-ULTIME** (Master coverage towards `manquant = 0`)
> 2. The Current Sprint: **CODEX-JOUR-UNIQUE** (7 priority blocks executed in 1 day)
> 3. The Switchover Horizon: **PLAN.md** (Azalée Vercel / Aphrody `aphrody.com` / Inacord unification)
> 4. The Core Engine & Binary Production: **PLAN-MOTEUR-FORGE** (Byte-exactness & RE)

> **Closure ledger — 2026-09-07.** All roadmap blocks are closed with a measured outcome:
> Blocks 1–6 have local gates or production evidence; Block 7 has `manquant=0` and
> `partiel=0`, with one explicitly blocked `.g4tg` rule covering 9 files. Remaining live 404s
> (`/avatar`, `/options`), reverse-engineering, and external decisions are recorded as blocked,
> not silently left as open work.

---

## 1. Hierarchy & Guiding Principle

```
                    [ PLAN-SITE-ULTIME.md ]
                     (Le Cap: Couverture 100%, manquant = 0)
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
     [ PLAN-SEMAINE (PLAN.md) ]          [ FORGE & MOTEUR (docs/PLAN.md) ]
  (Bascule Vercel / Aphrody.com)         (nie.exe byte-exact, 92.24% .text)
            │
            ▼
 [ CODEX-JOUR-UNIQUE (Sprint Actif) ]
  (7 Blocs ordonnés, mesurés et sans confirmation)
```

**Core Law:** Any task that does not advance the coverage matrix or increase byte-exactness does not advance the project.

---

## 2. Immediate Execution Roadmap (The 7 Sprints from CODEX-JOUR-UNIQUE)

| Block | Target Scope | Master Gate Metric | Status |
| :--- | :--- | :--- | :--- |
| **Bloc 1** | **Typecheck & Monorepo Bun** | `bun run typecheck` = **0 err** on 29 workspaces | **CLOSED — 0 errors (2026-09-07)** |
| **Bloc 2** | **Wiki Serverless Isolation** | `rg -l 'bun:sqlite\|node:fs' apps/azalee packages/azalee` = **0** | **CLOSED — source gate passed** |
| **Bloc 3** | **Payload & ISR Optimization** | `/chara` < 250 Ko in `br`, 0 img without `srcset` | **CLOSED — implementation and local gates passed** |
| **Bloc 4** | **Brand Separation (aphrody-dev)**| Zero forbidden mentions in Inacord/nie-web | **CLOSED — repository scan passed** |
| **Bloc 5** | **Production Rebuild `nie-site`** | Live `/healthz` HTTP 200 with VFS counts | **CLOSED — 200, 255,308 entries, 936 CPK (2026-09-07)** |
| **Bloc 6** | **Hardening & Performance** | Local tests/typecheck/docs gates green | **CLOSED — local gates passed** |
| **Bloc 7** | **Couverture Ultime (583 caps)** | `manquant = 0` and `partiel = 0` on API matrix | **CLOSED — 578 measured caps; 1 blocked rule / 9 `.g4tg` files** |

---

## 3. Production Architecture & Deployment Topology

- **Azalée (`azalee.rosegriffon.fr`)**: Next.js 16.3.0-canary.37 via the root catalog, deployed
  serverless on Vercel and querying Supabase Cloud directly (verified in `package.json`).
- **Aphrody (`aphrody.com`)**: Native Axum server in Rust (`nie-site`), rendering game UI DA in < 50ms TTFB.
- **Inacord (`packages/inacord-ui`)**: Unified frontend mounted by both Tauri (desktop) and Vite/nie-web (browser) via `packages/asset-source`.
- **The Forge (`nie-forge`)**: Verified at **74.00% file coverage** and **92.24% of `.text`** byte-identical to `nie.exe` (`b1fa04ea3658...`).

---

## 4. Verification Checklist & Gate Ledger

1. `bun run typecheck` (TypeScript verification)
2. `cargo clippy -p <crate> --lib --tests` (0 warnings)
3. `cargo check --workspace --tests` (Workspace consistency)
4. `scripts/e2e-site.sh` (Live API coverage validation)
5. Live service returns verified count and response payload (not just 200/active).

## 5. RE / Computer Use parity gate

The RE work follows one canonical chain:

```text
local executable + hash
  -> Ghidra / CodeBrowser evidence
  -> nie-re + nie-index (static analysis and SQLite)
  -> nie-trace (bounded live reads/scans)
  -> nie-computer-use (typed read-only orchestration)
```

The existing Rust crates are kept; no duplicate implementation is to be removed. The migration
target is the boundary: a session must carry executable hash, image base, explicit SQLite
`binary_id`, RVA/VA, backend, operation and evidence artifact. Writes, EAC patches, recipes and
process launch stay outside the default agent surface.

The gate is not complete until the parity tests cover PE + SQLite fixtures, Ghidra CSV/schema and
MCP handshake, Windows live memory, size/permission limits, and rejection of a mismatched build.
The detailed inventory is [`docs/re/PARITY-AUDIT-2026-09-07.md`](re/PARITY-AUDIT-2026-09-07.md).
