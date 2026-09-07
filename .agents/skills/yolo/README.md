<!-- SPDX-License-Identifier: Apache-2.0 -->
# YOLO+ — Sovereign Universal Autonomous Agent Engine (2026 Edition)

[![CI Gate](https://img.shields.io/badge/Bun%20Test-47%20Passed-brightgreen)](https://github.com/aphrody-code/YOLO)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0%20Strict-blue)](https://github.com/aphrody-code/YOLO)
[![Python](https://img.shields.io/badge/Python-3.10%2B%20(uv)-teal)](https://github.com/aphrody-code/YOLO)
[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-orange)](https://github.com/aphrody-code/YOLO)
[![A2A Protocol](https://img.shields.io/badge/A2A%20Protocol-v3.2.0-purple)](https://github.com/aphrody-code/YOLO)
[![Autonomy](https://img.shields.io/badge/Mode-Full%20YOLO%20(Zero--Pause)-red)](https://github.com/aphrody-code/YOLO)

**YOLO+** is the sovereign, multi-agent, cross-platform autonomous execution engine and subagent ecosystem built for AI coding agents (**Antigravity CLI / Gemini 3.8**, **Claude Code**, and **OpenAI Codex**).

It unifies multi-agent coordination, native polyglot code detection, AST symbol parsing, dual-lane autonomous daemons, and sovereign agent identity across **any repository in any programming language**.

---

## ⚡ Unified Architecture & Core Components

```
yolo/
├── src/
│   └── index.ts                 # Programmatic TypeScript/Bun library export
├── scripts/
│   ├── polyglot-detector.ts     # Native Polyglot Detector & AST Code Parser (Bun/TS)
│   ├── polyglot-detector.py     # Native Polyglot Detector (Python 3.10+)
│   ├── yolo-grind.ts            # Fast Autonomous Parallel Grind Runner (Bun)
│   ├── yolo-autopilot.py        # Autonomous Polyglot Autopilot Runner (Python / uv)
│   ├── autopilot.ps1            # Background duel daemon with PID tracking (PowerShell 7+)
│   └── autopilot.sh             # Background duel daemon with signal traps (Bash / Linux / macOS)
├── home/                        # Sovereign Agent Persona & Execution Rules
│   ├── SOUL.md                  # Decisive tone, honesty, boundaries, and zero-pause mandate
│   ├── IDENTITY.md              # Autonomous agent identity and vibe definition
│   ├── AGENTS.md                # Multi-agent collaboration protocol
│   ├── TOOLS.md                 # Permitted tool execution & auto-allow permissions
│   ├── HEARTBEAT.md             # Coordination pulse & ISO-8601 liveness contract
│   ├── BOOT.md & BOOTSTRAP.md   # Cold-start onboarding sequences
│   └── USER.md                  # Passive spectator user contract
├── agents/                      # 21 Specialized Autonomous Subagents
│   ├── yolo-prod-ready.md       # Universal production-ready delivery engine (exit code 0)
│   ├── csharp-engineer.md       # Modern .NET 8/9, ASP.NET Core, Native AOT, Span<T>
│   ├── cpp-c-engineer.md        # ISO C99/C11/C23 & C++20/C++23, zero-cost abstractions
│   ├── asm-lowlevel-engineer.md # SIMD vectorization (AVX-512, NEON), inline assembly
│   ├── rust-engineer.md         # Rust 2024 edition, ownership, zero-cost concurrency
│   ├── web-frontend-engineer.md # HTML5 semantic markup, responsive CSS3/Tailwind
│   ├── spec-doc-architect.md    # Algorithmic pseudocode, JSON Schema modeling
│   ├── cargo-auditor.md         # Supply-chain security (cargo deny, CVE scanning)
│   ├── cross-platform-validator # Multi-OS compilation verification (Linux, Windows, WASM)
│   ├── devops-engineer.md       # CI/CD pipelines, containerization, deployment
│   ├── performance-engineer.md  # Latency profiling, memory optimization, benchmarks
│   ├── security-engineer.md     # Invariant auditing, vulnerability elimination
│   └── test-runner.md           # Automated test generation and gate validation
├── skills/                      # Sovereign Autonomous Skills
│   ├── yolo-grind/              # Parallel tick execution (up to 4 agents per tick)
│   ├── yolo-perfect-grind/      # Oracle perfection loop (runs until all gates PASS)
│   ├── autopilot/               # Dual-lane autonomous background loop (Lead + Auditor)
│   ├── a2a-duel-loop/           # File-based peer mailbox coordination (.coord/)
│   ├── start/                   # Continuous autonomous roadmap execution
│   └── best-stack-2026/         # 2026 Architectural best practices and anti-patterns
├── schemas/
│   └── yolo.schema.json         # Draft 2020-12 schema validating the YOLO engine manifest
└── tests/
    ├── polyglot.test.ts         # 25+ language detection & AST symbol extraction tests
    └── yolo.test.ts             # Manifest, schema, script, and agent integrity tests
```

---

## 🌐 Universal Polyglot Support (Native Detector & AST Parser)

YOLO+ features an integrated, high-speed polyglot engine inspired by **GitHub Linguist**, **Google Magika**, and **Tree-sitter**:

| Category | Languages & Stacks | Validation & Test Gates |
| :--- | :--- | :--- |
| **Systems & Native** | C# (.NET 8/9), C++20/23, ISO C, Assembly (NASM/GAS), Rust (2024) | `dotnet test`, `ctest`, `make test`, `cargo test`, `cargo check` |
| **Modern Runtimes** | TypeScript, JavaScript, Bun, Node.js, Python (uv), Go | `bun test`, `npm test`, `pytest`, `go test ./...` |
| **Web & Interface** | Semantic HTML5, CSS3, Tailwind CSS | Markup validation, responsive conformance |
| **Data & Schemas** | JSON, JSON Schema (draft 2020-12), YAML, TOML, Protocol Buffers | Schema validation, type generation |
| **Specifications** | Algorithmic Pseudocode, Markdown specifications | Invariant proofs, cross-reference verification |

### Multi-Stage Detection Pipeline
1. **Filename Match**: Instant resolution for canonical files (`Cargo.toml`, `CMakeLists.txt`, `Dockerfile`, `go.mod`, `tsconfig.json`).
2. **Shebang Match**: Inspects execution preambles (`#!/usr/bin/env bun`, `#!/usr/bin/env python3`, etc.).
3. **Extension Mapping**: Identifies 60+ primary and secondary extensions (`.cs`, `.rs`, `.cpp`, `.asm`, `.ts`, `.py`, `.go`, `.html`, `.json`, etc.).
4. **Content Heuristics**: Distinguishes ambiguous extensions via Bayesian-style structural syntax patterns.
5. **AST Symbol Extraction**: Discovers functions, classes, interfaces, imports, line metrics, and comment ratios without external binaries.

---

## 🚀 Execution & Command-Line Daemons

### 1. Bun / TypeScript Workspace Grind
Inspects active workspace stacks and dispatches autonomous multi-agent ticks:
```bash
bun run grind
```

### 2. Python Autopilot Polyglot Runner
Autonomously detects stacks, reads actionable tasks from `PLAN.md` or `TODO.md`, and loops with zero confirmation:
```bash
# Single dry-run pass (inspect workspace and verify prompt)
python scripts/yolo-autopilot.py --once --dry-run

# Run continuous autonomous execution loop
python scripts/yolo-autopilot.py --interval 60
```

### 3. Background Duel Daemons (Lead + Auditor)
Runs Lead Developer and Independent Auditor in continuous duel:
```powershell
# Windows PowerShell 7+
pwsh scripts/autopilot.ps1 -Continuous -IntervalSeconds 60
```
```bash
# Linux / macOS Bash
bash scripts/autopilot.sh --continuous --interval 60
```

---

## 🛠️ Programmatic TypeScript API

YOLO+ is packaged and exportable as a standard module (`@aphrody/yolo`):

```typescript
import { PolyglotDetector, LANGUAGE_REGISTRY } from "@aphrody/yolo";

// Detect file type & language
const lang = PolyglotDetector.detect("Program.cs");
console.log(lang.name); // "C#"
console.log(lang.buildGate); // "dotnet build"

// Parse structural AST symbols
const source = `
import { Worker } from "cluster";
export class Engine {
  execute() {}
}
`;
const parsed = PolyglotDetector.parseCode("engine.ts", source);
console.log(parsed.declarations.classes); // ["Engine"]
console.log(parsed.imports); // ["cluster"]
```

---

## 🤖 Sovereign Persona & Operating Rules (`/home`)

YOLO operates under the sovereign agent contract defined in `/home`:
- **Full YOLO Autonomy (`SOUL.md`):** Zero human confirmation pauses for safe, reversible actions. Decide and act immediately.
- **Honest Delivery Tri-State:** Every deliverable must be classified:
  - **`FAIT`**: Delivered with concrete, verifiable passing artifacts (exit code 0).
  - **`INCOMPLET`**: Specific remaining requirements identified.
  - **`NON_FAIT`**: Concrete external blocker identified.
- **A2A Coordination (`HEARTBEAT.md` & `.coord/`):** ISO-8601 liveness pulse and JSONL fact envelopes preventing peer agent collisions.

---

## 🧪 Verification & Test Suite

The YOLO test suite enforces zero-broken-links, complete schema compliance, and polyglot detection accuracy:

```bash
# Run complete test suite (47 tests across manifest, agents, and polyglot parser)
bun run verify
```

---

## 📄 License & Standards

- **License:** Apache-2.0 / MIT Dual License.
- **A2A Protocol Version:** 3.2.0.
- **Author:** `aphrody-code` (<noreply@aphrody-code.dev>).
