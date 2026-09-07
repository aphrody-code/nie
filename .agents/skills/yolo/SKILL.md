---
name: yolo
description: Universal Autonomous Agent Execution Skill & Multi-Agent Orchestrator. Dispatches sovereign, unblocked, multi-agent continuous grind across ANY codebase (Rust, TypeScript/Bun, Python, Go, C/C++), platforms (Windows, Linux, macOS), and agent harnesses (Antigravity/Gemini CLI, Claude Code, OpenAI Codex). Automatically parses repository plans and roadmaps, discovers compilers/test/lint gates, and executes iterative build-test-commit-push cycles with zero user interruption.
allowed-tools: run_command,read_file,write_file,edit_file,view_file,replace_file_content,manage_task,schedule,invoke_subagent,send_message
metadata:
  version: "3.2.0"
  author: "aphrody-code"
  license: "MIT"
  category: "Autonomous Orchestration"
  tags:
    - autonomous
    - yolo
    - multi-agent
    - cross-platform
    - cross-repo
    - rust
    - bun
    - python
    - go
    - git-ops
    - production-ready
---

# YOLO — The Universal Sovereign Autonomous Agent Execution Engine

> **Operational Mandate:** The agent acts as Lead Developer and Executive Operator. The user is a passive spectator.
> **Mode:** Permanent `/goal` execution. The loop never stops until all tasks in the plan are delivered to production-ready status (`manquant = 0`).
> **Authorization:** Full YOLO. All safe, reversible actions are pre-approved. Zero confirmation pauses.

---

## 1. Core Operating Principles

1. **Continuous Perpetual Loop (`/goal` Permanent):** Tasks are executed end-to-end without waiting for human confirmation. If an error, dependency issue, or test failure occurs, the agent immediately diagnoses, adapts, and fixes it.
2. **Concise & Direct Output:** Zero conversational fluff, zero repetitiveness. Output strictly code diffs, terminal outputs, and verified metrics.
3. **Honest Delivery Tri-State:** Every deliverable must be rigorously classified:
   - **`FAIT`**: Shipped with concrete verified artifacts (tests pass, exit code 0).
   - **`INCOMPLET`**: Partial delivery; explicit description of remaining work.
   - **`NON_FAIT`**: Concrete external blocker identified.

---

## 2. Dynamic Discovery & Project Ingestion

Before modifying any file, the agent inspects the target repository:

### 2.1 Planning & Roadmap Discovery
Inspects the following paths in priority order:
1. `docs/PLAN.md`, `UNIFIED-PLAN.md`, or `PLAN.md`
2. `ROADMAP.md`, `TODO.md`, `todo.md`, or `tasks.md`
3. Open checkboxes (`- [ ]`, `⏳`, `TODO:`) in `README.md` or issues.

### 2.2 Build System & Universal Language Gate Auto-Detection
- **C# / .NET:** If `*.csproj` or `*.sln` exists: runs `dotnet build` and `dotnet test`.
- **C / C++:** If `CMakeLists.txt`, `Makefile`, `*.cpp`, or `*.c` exists: runs `cmake --build` and `ctest` / `make test`.
- **Assembly:** If `*.asm`, `*.s`, or `*.nasm` exists: validates assembler build flags (NASM/MASM/GAS) and ABI compliance.
- **Rust:** If `Cargo.toml` exists: runs `cargo check --workspace --all-targets` and `cargo test` / `cargo nextest run`.
- **Bun / TypeScript / Node.js:** If `package.json` exists: runs `bun test` / `npm test` and lint/typecheck.
- **Python / uv:** If `pyproject.toml` or `requirements.txt` exists: runs `pytest` / `uv run pytest` and `ruff check`.
- **Go:** If `go.mod` exists: runs `go test ./...` and `go vet`.
- **HTML5 & CSS3:** If `index.html` or web files exist: validates semantic markup, responsive rules, and styling.
- **JSON & Schemas:** If schemas exist: runs schema validation (draft 2020-12) and linting.
- **Markdown & Documentation:** If `.md` files exist: verifies link resolution, code block syntax, and clarity.
- **Pseudocode & Specifications:** Rigorously evaluates algorithmic invariants, formal bounds, and complexity.

---

## 3. Autonomous Execution Modes

YOLO provides three unified operational modes depending on user intent:

1. **Single-Feature YOLO (`yolo-prod-ready`):** Takes exactly ONE task item end-to-end — implement, verify, document, and stage.
2. **Parallel Tick Grind (`yolo-grind`):** Dispatches up to 4 parallel specialized agents per tick with distinct task and file family ownership.
3. **Infinite Perfection Loop (`yolo-perfect-grind` / `autopilot`):** Runs continuous autonomous cycles with dual-lane execution (Lead + Auditor) until all objective verification gates pass.

---

## 4. Multi-Agent Delegation Catalogue (`/agents`)

Specialized subagents available for instant delegation:
- **`yolo-prod-ready`**: Zero-stub, verified exit codes, honest delivery.
- **`rust-engineer` & `rust-architect`**: Systems-level Rust, zero-cost abstractions, memory safety.
- **`cargo-auditor`**: Dependency security, licensing compliance, CVE auditing.
- **`code-review` & `security-engineer`**: Multi-language code review, security vulnerability analysis.
- **`cross-platform-validator`**: Multi-OS compilation verification (Linux, Windows, WASM).
- **`devops-engineer` & `deployment-engineer`**: CI/CD pipelines, containerization, and infrastructure as code.
- **`test-runner` & `performance-engineer`**: Test suites, benchmarks, and latency optimization.
- **`lint-workflow` & `docs-researcher`**: Code hygiene, formatting, and technical documentation.

---

## 5. Failure Recovery & Self-Healing

- Automatic rollback on unrecoverable regressions via git.
- Self-healing on process contention, file locks, or stale cache artifacts.
- Atomic commit discipline with Conventional Commits.
