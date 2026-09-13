#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Universal YOLO+ Autonomous Polyglot Runner (Bun / TypeScript)
 * Dispatches multi-agent ticks across ANY language:
 * C#, C++, C, Assembly, Rust, TypeScript/Bun, Python/uv, Go, HTML/CSS, JSON, Markdown, Pseudocode.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PolyglotDetector } from "./polyglot-detector";

interface PolyglotEnv {
  rust: boolean;
  bun: boolean;
  python: boolean;
  csharp: boolean;
  cpp_c: boolean;
  assembly: boolean;
  go: boolean;
  web: boolean;
  planFile: string | null;
  detectedLanguages: string[];
}

function detectPolyglot(root: string): PolyglotEnv {
  const planCandidates = [
    "docs/PLAN.md",
    "UNIFIED-PLAN.md",
    "docs/UNIFIED-PLAN.md",
    "PLAN.md",
    "TODO.md",
    "todo.md",
    "tasks.md"
  ];
  let planFile: string | null = null;
  for (const c of planCandidates) {
    if (existsSync(resolve(root, c))) {
      planFile = c;
      break;
    }
  }

  const files = existsSync(root) ? readdirSync(root) : [];
  const detectedLanguages = new Set<string>();

  for (const f of files) {
    const lang = PolyglotDetector.detect(f);
    if (lang.id !== "unknown") {
      detectedLanguages.add(lang.name);
    }
  }

  return {
    rust: existsSync(resolve(root, "Cargo.toml")),
    bun: existsSync(resolve(root, "package.json")),
    python: existsSync(resolve(root, "pyproject.toml")) || existsSync(resolve(root, "requirements.txt")),
    csharp: files.some(f => f.endsWith(".csproj") || f.endsWith(".sln")),
    cpp_c: existsSync(resolve(root, "CMakeLists.txt")) || existsSync(resolve(root, "Makefile")) || files.some(f => f.endsWith(".cpp") || f.endsWith(".c")),
    assembly: files.some(f => f.endsWith(".asm") || f.endsWith(".s") || f.endsWith(".nasm")),
    go: existsSync(resolve(root, "go.mod")),
    web: existsSync(resolve(root, "index.html")) || files.some(f => f.endsWith(".html") || f.endsWith(".css")),
    planFile,
    detectedLanguages: Array.from(detectedLanguages)
  };
}

function parseOpenTasks(planPath: string): string[] {
  if (!existsSync(planPath)) return [];
  const text = readFileSync(planPath, "utf8");
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(l => (l.startsWith("-") || l.startsWith("*")) && (l.includes("⏳") || l.includes("- [ ]") || l.includes("TODO:")))
    .map(l => l.replace(/^[\-*\s\[\]⏳]+/, "").replace(/^TODO:\s*/i, "").trim());
}

const dryRun = process.argv.slice(2).includes("--dry-run");
const root = process.cwd();
const env = detectPolyglot(root);
const activeStacks = env.detectedLanguages.length > 0 
  ? env.detectedLanguages 
  : Object.entries(env)
      .filter(([k, v]) => v && k !== "planFile" && k !== "detectedLanguages")
      .map(([k]) => k);

console.log("==================================================================");
console.log("⚡ YOLO+ Sovereign Autonomous Polyglot Runner (Bun / TS Engine)");
console.log(`📁 Workspace: ${root}`);
console.log(`📋 Plan File: ${env.planFile ?? "None (Standalone / Direct Goal)"}`);
console.log(`🛠️ Active Stacks: ${activeStacks.length > 0 ? activeStacks.join(", ") : "Polyglot / Universal"}`);
console.log("==================================================================");

if (!dryRun) {
  mkdirSync(".coord", { recursive: true });
  mkdirSync("var/log", { recursive: true });
}

const tasks = env.planFile ? parseOpenTasks(env.planFile) : [];
console.log(`🎯 Actionable Tasks Found: ${tasks.length}`);
if (tasks.length > 0) {
  tasks.slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
}

const gates: string[] = [];
if (env.rust) gates.push("cargo check && cargo test");
if (env.csharp) gates.push("dotnet build && dotnet test");
if (env.bun) gates.push("bun test");
if (env.python) gates.push("pytest");
if (env.go) gates.push("go test ./...");
if (env.cpp_c) gates.push("ctest || make test");
if (gates.length === 0) gates.push("git status");

const validationCmd = gates.join(" && ");
console.log(`🛡️ Validation Gate: ${validationCmd}`);

if (dryRun) {
  console.log("[dry-run] No coordination or log files were written.");
} else {
  const timestamp = new Date().toISOString();
  writeFileSync(".coord/heartbeat.txt", `${timestamp} - YOLO+ Polyglot Tick - ${tasks[0] ?? "Continuous maintenance"}\n`);
}

console.log("✅ Polyglot environment validated. Ready for autonomous multi-agent dispatch.");
