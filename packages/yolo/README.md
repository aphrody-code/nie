<!-- SPDX-License-Identifier: Apache-2.0 -->
# YOLO+ — Sovereign Universal Autonomous Agent Engine (2026 Edition)

[![CI Gate](https://img.shields.io/badge/Bun%20Test-102%20Passed-brightgreen)](https://github.com/aphrody-code/YOLO)
[![Skills Count](https://img.shields.io/badge/Agent%20Skills-60%20Verified-blueviolet)](https://github.com/aphrody-code/YOLO)
[![Universal Skills Standard](https://img.shields.io/badge/skills.sh-Compatible-blue)](https://skills.sh)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Marketplace%20Ready-purple)](https://code.claude.com)
[![Google Antigravity](https://img.shields.io/badge/Antigravity%20agy-Native%20Plugin-teal)](https://github.com/aphrody-code/YOLO)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0%20Strict-blue)](https://github.com/aphrody-code/YOLO)
[![Python](https://img.shields.io/badge/Python-3.10%2B%20(uv)-teal)](https://github.com/aphrody-code/YOLO)
[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-orange)](https://github.com/aphrody-code/YOLO)
[![Autonomy](https://img.shields.io/badge/Mode-Full%20YOLO%20(Zero--Pause)-red)](https://github.com/aphrody-code/YOLO)

**YOLO+** is the sovereign, multi-agent, cross-platform autonomous execution engine, polyglot AST code analyzer, and agent skill marketplace built for next-generation AI coding agents (**Antigravity CLI / Gemini 3.8**, **Claude Code**, and **OpenAI Codex**).

It packages **60 production agent skills** adhering to the universal **Agent Skills Open Standard** (SKILL.md YAML frontmatter) and native marketplaces across Claude Code, Antigravity (gy), and the skills.sh / Vercel ecosystem.

---

## ⚡ Market Discovery & Universal 1-Click Installation

YOLO+ can be installed across any of the **77+ supported agent harnesses** (Claude Code, OpenAI Codex, Antigravity, Cursor, Windsurf, Devin, Vibe, OpenHands, etc.) via official package managers and agent CLI tools.

### 1. Universal Agent Skills CLI (skills.sh / Vercel)
Install YOLO or any of its 60 individual skills non-interactively across your installed agents:

``bash
# Install the core YOLO orchestrator into all detected agents
bunx skills add aphrody-code/YOLO -y

# Install with npm / npx
npx skills add aphrody-code/YOLO -y

# Install specific skills across select harnesses
bunx skills add aphrody-code/YOLO --skill yolo-grind,autopilot,a2a-duel-loop --agent claude-code,codex,antigravity,cursor -y

# Search skills catalog on skills.sh
bunx skills find yolo
``

### 2. Claude Code Native Marketplace
Register the YOLO marketplace repository or install it as a direct plugin:

``bash
# Register YOLO marketplace source
/plugin marketplace add aphrody-code/YOLO

# Install YOLO plugin directly into your Claude Code profile
claude plugin install yolo
``

### 3. Google Antigravity CLI (gy) Native Integration
Enable the YOLO plugin and its 60 skills within the Antigravity CLI environment:

``bash
# Install and enable plugin in ~/.gemini/config/
agy plugin install aphrody-code/YOLO
agy plugin enable yolo

# Launch with autonomous permissions
agy -p "grind open tasks" --dangerously-skip-permissions
``

---

## 📚 Complete Catalog of Verified Skills (60 Production Skills)

Every skill includes complete YAML metadata, structured progressive disclosure, trigger contracts, and zero-pause autonomous execution rules:


### Autonomous Loops & Multi-Agent Orchestration (9 skills)

| Skill Identifier | Folder | Capabilities & Primary Scope |
| :--- | :--- | :--- |
| `a2a-duel-loop` | `skills/a2a-duel-loop` | Continuous 2-Claude coordination duel over the A2A file-based protocol (ai.json + .coord JSONL mailbox + HTTP listener). Each iteration writes one envel... |
| `aphrody-agent-home` | `skills/aphrody-agent-home` | One-session autonomous build of the `aphrody-agent-home` crate (soul / identity / workspace). Dispatches the dedicated agent-home-builder subagent (Opus... |
| `aphrody-perfect-grind` | `skills/aphrody-perfect-grind` | Forced-loop coding mode. Wraps /loop 30s /aphrody-yolo-grind with an explicit perfection oracle — does NOT exit until the codebase meets all objective m... |
| `aphrody-yolo-grind` | `skills/aphrody-yolo-grind` | Continuous parallel-grind mode that dispatches parallel YOLO agents per tick to drive open plan/todo items to production-ready as fast as possible. Auto... |
| `autopilot` | `skills/autopilot` | Launch the universal autopilot loop — dual-agent autonomous background daemon (Lead Developer + Independent Auditor) piloting any repository infinitely ... |
| `start` | `skills/start` | Continuous autonomous execution mode that follows PLAN.md end-to-end, making decisions on every reversible choice without asking the user. Mission targe... |
| `unified-workflow` | `skills/unified-workflow` | Route Aphrody, WinClean, niers, Ghidra and Computer Use work through bounded runs with manifests, evidence and explicit proof levels. |
| `yolo-grind` | `skills/yolo-grind` | Continuous parallel-grind mode that dispatches parallel YOLO agents per tick to drive open plan/todo items to production-ready across any repository (Ru... |
| `yolo-perfect-grind` | `skills/yolo-perfect-grind` | Forced-loop coding mode. Wraps /loop 30s /yolo-grind with an explicit perfection oracle — does NOT exit until the codebase meets all objective metrics. ... |

### Rust 2026 Ecosystem & Systems Engineering (3 skills)

| Skill Identifier | Folder | Capabilities & Primary Scope |
| :--- | :--- | :--- |
| `best-stack-2026` | `skills/best-stack-2026` | Canonical Rust 2026 stack chooser — recommends the right crate (+ exact version + alternative rejected + reason) for any domain : HTTP servers, async ru... |
| `rust-best-practices-2026` | `skills/rust-best-practices-2026` | Rust 1.95 features + 1.96 WASM breakage + Cargo CVE-2026-33056 + Edition 2024 async closures / precise capturing / Tokio discipline. Use when writing ne... |
| `rust-target-check` | `skills/rust-target-check` | Runs `cargo check` on the 3 priority targets in parallel (Linux x86_64, Windows MSVC, wasm32-unknown-unknown). Use whenever the user asks to "verify cro... |

### Reverse Engineering, OS Internals & Security Forensics (14 skills)

| Skill Identifier | Folder | Capabilities & Primary Scope |
| :--- | :--- | :--- |
| `aphrody-cmd-ai-creative` | `skills/aphrody-cmd-ai-creative` | Contexte direct des commandes IA / génératif / créatif du CLI aphrody — chat, gemini, agy, agy-loop, antigravity, hermes, notebooklm, image, firefly, me... |
| `aphrody-cmd-re-forensics` | `skills/aphrody-cmd-re-forensics` | Contexte direct des commandes de reverse engineering, forensics et analyse repo du CLI aphrody — re (triage/strings/sections/auto), forensics, scan, chr... |
| `auto-re` | `skills/auto-re` | Orchestrates automated reverse engineering on a binary or directory. Use when you need a complete RE report on a PE/ELF binary without specifying indivi... |
| `cross-platform-cli-toolbelt` | `skills/cross-platform-cli-toolbelt` | Rust CLI replacements for slow GNU coreutils / busybox / PowerShell — same binary on Linux/Windows/macOS. Use whenever picking a shell command, writing ... |
| `deep-analysis` | `skills/deep-analysis` | Performs focused, depth-first investigation of specific reverse engineering questions through iterative analysis and database improvement. Answers quest... |
| `m3-correct` | `skills/m3-correct` | User-invoked fix skill. Auto-correct Material Design 3 violations in a codebase. Use when asked to "fix M3 violations", "auto-correct Material Design is... |
| `microsoft-code-reference` | `skills/microsoft-code-reference` | Find working code samples, verify API signatures, and fix Microsoft SDK errors using official docs. Use whenever the user is writing, debugging, or revi... |
| `protocol-reverse-engineering` | `skills/protocol-reverse-engineering` | Master network protocol reverse engineering including packet analysis, protocol dissection, and custom protocol documentation. Use when analyzing networ... |
| `remotion-best-practices` | `skills/remotion-best-practices` | Best practices for Remotion - Video creation in React |
| `responsive-adaptive` | `skills/responsive-adaptive` | Teaches Claude how to apply Material Design 3 adaptive layout: window size classes, navigation pattern swaps, canonical layouts, grid/margin values, and... |
| `skill-creator` | `skills/skill-creator` | Create agent skills for any technology (Microsoft / Rust crate / Azure / .NET / browser API / framework) by investigating it live through the MCP server... |
| `vps-commander` | `skills/vps-commander` | Operates the bidirectional SSH tunnel to the VPS — local port forwards (Chrome 9226, Postgres 5432, Bun 3001) and SOCKS5 (127.0.0.1:1080). |
| `winclean` | `skills/winclean` | WinClean ecosystem integration for the peer Windows 11 (24H2+) optimization repo — system scanning, debloating, native AOT C# workflows, and a bridge to... |
| `winclean-mcp-skills` | `skills/winclean-mcp-skills` | Wrapper namespace for 3 nested Microsoft-focused skills synced from the WinClean MCP ecosystem — microsoft-docs (Microsoft Learn API docs lookup), micro... |

### Material Design 3, Design Systems & Frontend (24 skills)

| Skill Identifier | Folder | Capabilities & Primary Scope |
| :--- | :--- | :--- |
| `color-expert` | `skills/color-expert` | Color science expert skill with 286K words of reference material covering OKLCH/OKLAB, palette generation, accessibility/contrast, color naming, pigment... |
| `design-google-ingest` | `skills/design-google-ingest` | Crawl design.google end-to-end via Edge headless (SPA-aware) — discover every /library article + site page, scrape post-hydration DOM via scripts/edge-m... |
| `google-design` | `skills/google-design` | Canonical Google / Material Design 3 design authority for aphrody. Use AGGRESSIVELY whenever the user asks anything about Material Design 3, M3 Expressi... |
| `m3-component` | `skills/m3-component` | Scaffold a self-contained Material Design 3 md-* web component and/or its React wrapper. Use when the user says: "create an M3 component", "scaffold a M... |
| `m3-design-compiler` | `skills/m3-design-compiler` | Turn a natural-language design brief into a Material Design 3 React scaffold with @aphrody-code/m3-design. Use when asked to "scaffold a screen from a d... |
| `m3-design-guide` | `skills/m3-design-guide` | Load this skill whenever the user wants to design or build UI that looks Material Design 3 / Material You / Google-style, including requests like "make ... |
| `m3-doc-ai` | `skills/m3-doc-ai` | Translate and generate documentation for the monorepo with the @aphrody-code/doc-ai CLI (Google Gemini backend, offline fallback). Use when asked to "tr... |
| `m3-docs` | `skills/m3-docs` | Answer Material Design 3 specification questions with attribution. Model-invocable and user-invocable. Use when asked "what does the M3 spec say about X... |
| `m3-dynamic-color` | `skills/m3-dynamic-color` | Generate and apply Material You dynamic color and M3 design tokens at runtime with @aphrody-code/m3-tokens. Use when asked to "theme from a seed color",... |
| `m3-lint` | `skills/m3-lint` | Set up and run @aphrody-code/eslint-plugin-m3 to lint a site that consumes material-web. Use when asked to "lint M3 usage", "set up the m3 eslint/oxlint... |
| `m3-motion` | `skills/m3-motion` | Apply Material Design 3 motion (transitions, easings, durations, springs) in React with @aphrody-code/m3-motion. Use when asked to "animate with M3 moti... |
| `m3-spec-check` | `skills/m3-spec-check` | Audit a file, component, or directory for Material Design 3 conformance. Use when the user says: "check this is M3-compliant", "audit Material Design co... |
| `m3-tailwind` | `skills/m3-tailwind` | Wire Material Design 3 tokens into Tailwind v4 and shadcn/ui with @aphrody-code/m3-theme and @aphrody-code/m3-tokens. Use when asked to "use M3 with Tai... |
| `m3-template` | `skills/m3-template` | Action skill: produces a complete, ready-to-use M3 page or screen scaffold. Invoke when the user says "scaffold an M3 page", "scaffold an M3 screen", "g... |
| `material` | `skills/material` | Google's Material Design with layered surfaces, dynamic theming, built-in motion, and responsive cross-platform patterns. |
| `material-3` | `skills/material-3` | Implement Google's Material Design 3 (Material You) UI system. Primary: Jetpack Compose Material3 (MaterialTheme, components, adaptive layout). Also Flu... |
| `material-design-3-components` | `skills/material-design-3-components` | Comprehensive guide to Material Design 3 components — from baseline Material You through M3 Expressive. Covers action, containment, communication, navig... |
| `material-design-3-guide` | `skills/material-design-3-guide` | Master guide for Material Design 3 — covering the full specification from Material You foundations through M3 Expressive. Explains when to use each Mate... |
| `nextjs-typescript-tailwindcss-supabase` | `skills/nextjs-typescript-tailwindcss-supabase` | Full-stack Next.js 14 development with TypeScript, TailwindCSS, and Supabase for building production-ready web applications. |
| `shadcn` | `skills/shadcn` | Manages shadcn components and projects — adding, searching, fixing, debugging, styling, and composing UI. Provides project context, component docs, and ... |
| `tailwindcss` | `skills/tailwindcss` | Expert in TailwindCSS utility-first styling with responsive design patterns |
| `tailwindcss-advanced-layouts` | `skills/tailwindcss-advanced-layouts` | Tailwind CSS advanced layout techniques including CSS Grid and Flexbox patterns. PROACTIVELY activate for: (1) building complex layouts with CSS Grid, (... |
| `tailwindcss-animations` | `skills/tailwindcss-animations` | Tailwind CSS animations and transitions including built-in utilities and custom keyframes. PROACTIVELY activate for: (1) animate-* utilities (spin, ping... |
| `tailwindcss-mobile-first` | `skills/tailwindcss-mobile-first` | Mobile-first responsive design patterns with Tailwind CSS v4 (2025-2026). PROACTIVELY activate for: (1) mobile-first design with Tailwind breakpoints (s... |

### Cloud, Documentation, Browser & Agent Tooling (10 skills)

| Skill Identifier | Folder | Capabilities & Primary Scope |
| :--- | :--- | :--- |
| `agent-browser` | `skills/agent-browser` | Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, ta... |
| `aphrody-cmd-system-net` | `skills/aphrody-cmd-system-net` | Contexte direct des commandes système, cycle de vie, réseau et intégration du CLI aphrody — auth, doctor, version, completions, self, oc-onboard/reset/u... |
| `bxc` | `skills/bxc` | Crawler and web scraping engine with advanced stealth, browser automation, and platform scrapers. |
| `context7-mcp` | `skills/context7-mcp` | Fetch current library documentation, API references, and code examples for any developer technology (React, tokio, wgpu, Prisma, Supabase, Express, Tail... |
| `deploy` | `skills/deploy` | Deploy application to production. TRIGGER when: user says 'deploy', 'ship', 'push to prod', 'release', 'mise en prod', or asks to restart a service. Han... |
| `developing-genkit-js` | `skills/developing-genkit-js` | Develop AI-powered applications using Genkit in Node.js/TypeScript. Use when the user asks about Genkit, AI agents, flows, or tools in JavaScript/TypeSc... |
| `docs-auto` | `skills/docs-auto` | MANDATORY first step whenever the user asks ANYTHING about a library, framework, SDK, CLI tool, cloud service, API, configuration syntax, runtime behavi... |
| `microsoft-docs` | `skills/microsoft-docs` | Understand Microsoft technologies by querying official documentation. Use whenever the user asks how something works, wants tutorials, needs configurati... |
| `migrate-mui` | `skills/migrate-mui` | Migrate a React + MUI (@mui/material@9 + @mui/icons-material + MUI X) codebase to material-web (@aphrody-code/m3-react + Material Symbols). Use when ask... |
| `n2b` | `skills/n2b` | Scan and migrate a Node.js codebase to Bun using n2b, including API mappings, Bun Shell ($), shebang updates, and package config. |


---

## ⚡ Unified Architecture & Core Components

``
yolo/
├── .claude-plugin/
│   ├── marketplace.json         # Claude Code Marketplace Manifest
│   └── plugin.json              # Claude Code Plugin Specification
├── plugin.json                  # Antigravity (agy) Native Plugin Manifest
├── package.json                 # Node/Bun Package & skills.sh keywords
├── yolo.json                    # YOLO Engine & Subagent Orchestration Schema
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
├── skills/                      # 60 Production Agent Skills (Universal Open Standard)
├── schemas/
│   └── yolo.schema.json         # Draft 2020-12 schema validating the YOLO engine manifest
└── tests/
    ├── polyglot.test.ts         # 25+ language detection & AST symbol extraction tests
    ├── yolo.test.ts             # Manifest, schema, script, and agent integrity tests
    └── skills.test.ts           # 60/60 skills YAML validation & verification suite
``

---

## 🌐 Universal Polyglot Support (Native Detector & AST Parser)

YOLO+ features an integrated, high-speed polyglot engine inspired by **GitHub Linguist**, **Google Magika**, and **Tree-sitter**:

| Category | Languages & Stacks | Validation & Test Gates |
| :--- | :--- | :--- |
| **Systems & Native** | C# (.NET 8/9), C++20/23, ISO C, Assembly (NASM/GAS), Rust (2024) | dotnet test, ctest, make test, cargo test, cargo check |
| **Modern Runtimes** | TypeScript, JavaScript, Bun, Node.js, Python (uv), Go | un test, 
pm test, pytest, go test ./... |
| **Web & Interface** | Semantic HTML5, CSS3, Tailwind CSS, Material Design 3 | Markup validation, responsive conformance |
| **Data & Schemas** | JSON, JSON Schema (draft 2020-12), YAML, TOML, Protocol Buffers | Schema validation, type generation |
| **Specifications** | Algorithmic Pseudocode, Markdown specifications | Invariant proofs, cross-reference verification |

### Multi-Stage Detection Pipeline
1. **Filename Match**: Instant resolution for canonical files (Cargo.toml, CMakeLists.txt, Dockerfile, go.mod, 	sconfig.json).
2. **Shebang Match**: Inspects execution preambles (#!/usr/bin/env bun, #!/usr/bin/env python3, etc.).
3. **Extension Mapping**: Identifies 60+ primary and secondary extensions (.cs, .rs, .cpp, .asm, .ts, .py, .go, .html, .json, etc.).
4. **Content Heuristics**: Distinguishes ambiguous extensions via Bayesian-style structural syntax patterns.
5. **AST Symbol Extraction**: Discovers functions, classes, interfaces, imports, line metrics, and comment ratios without external binaries.

---

## 🚀 Autonomous Execution Daemons

### 1. Bun / TypeScript Workspace Grind
Inspects active workspace stacks and dispatches autonomous multi-agent ticks:
``bash
bun run grind
# Inspect a project without writing coordination files or dispatching agents
bun run grind -- --dry-run
``

### 2. Python Autopilot Polyglot Runner
Autonomously detects stacks, reads actionable tasks from PLAN.md or TODO.md, and loops with zero confirmation:
``bash
# Single dry-run pass (inspect workspace and verify prompt)
python scripts/yolo-autopilot.py --once --dry-run

# Run continuous autonomous execution loop
python scripts/yolo-autopilot.py --interval 60
``

### 3. Background Duel Daemons (Lead + Auditor)
Runs Lead Developer and Independent Auditor in continuous duel:
``powershell
# Windows PowerShell 7+
pwsh scripts/autopilot.ps1 -Interval 60
# One read-only inspection
pwsh scripts/autopilot.ps1 -Once -DryRun
``
``bash
# Linux / macOS Bash
bash scripts/autopilot.sh --interval 60
# One read-only inspection
bash scripts/autopilot.sh --once --dry-run
``

---

## 🛠️ Programmatic TypeScript API

YOLO+ is packaged and exportable as a standard library (@aphrody/yolo):

``typescript
import { PolyglotDetector, LANGUAGE_REGISTRY } from "@aphrody/yolo";

// Detect file type & language
const lang = PolyglotDetector.detect("Program.cs");
console.log(lang.name); // "C#"
console.log(lang.buildGate); // "dotnet build"

// Parse structural AST symbols
const source = 
import { Worker } from "cluster";
export class Engine {
  execute() {}
}
;
const parsed = PolyglotDetector.parseCode("engine.ts", source);
console.log(parsed.declarations.classes); // ["Engine"]
console.log(parsed.imports); // ["cluster"]
``

---

## 🤖 Sovereign Persona & Operating Rules (/home)

YOLO operates under the sovereign agent contract defined in /home:
- **Full YOLO Autonomy (SOUL.md):** Zero human confirmation pauses for safe, reversible actions. Decide and act immediately.
- **Honest Delivery Tri-State:** Every deliverable must be classified:
  - **FAIT**: Delivered with concrete, verifiable passing artifacts (exit code 0).
  - **INCOMPLET**: Specific remaining requirements identified.
  - **NON_FAIT**: Concrete external blocker identified.
- **A2A Coordination (HEARTBEAT.md & .coord/):** ISO-8601 liveness pulse and JSONL fact envelopes preventing peer agent collisions.

---

## 🧪 Verification & Gate Validation

The YOLO test suite validates schemas, links, agents, and every single skill manifest:

``bash
# Run full verification suite (102 tests across manifest, agents, polyglot parser, and 60 skills)
bun test
bun run verify
``

---

## 📄 License & Standards

- **License:** Apache-2.0 / MIT Dual License.
- **Open Standards:** Agent Skills Open Standard (SKILL.md), Claude Code Marketplace Schema, Antigravity Plugin Schema.
- **A2A Protocol Version:** 3.2.0.
- **Author:** phrody-code (<noreply@aphrody-code.dev>).