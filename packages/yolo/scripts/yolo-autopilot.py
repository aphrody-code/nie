#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
Universal YOLO+ Autonomous Polyglot Runner (Python 3.10+)
Dispatches sovereign autonomous execution across ANY language:
C#, C++, C, Assembly, Rust, TypeScript/Bun, Python/uv, Go, HTML/CSS, JSON, Markdown, and Pseudocode.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
try:
    from polyglot_detector import PolyglotDetector
except ImportError:
    try:
        from scripts.polyglot_detector import PolyglotDetector
    except ImportError:
        PolyglotDetector = None

def detect_polyglot_environment(root: Path) -> dict:
    files = list(root.glob("*"))
    names = [p.name for p in files]
    detected_languages = set()
    if PolyglotDetector:
        for p in files:
            d = PolyglotDetector.detect(str(p))
            if d.get("id") != "unknown":
                detected_languages.add(d.get("name", d.get("id")))

    env = {
        "rust": (root / "Cargo.toml").exists(),
        "bun_node": (root / "package.json").exists(),
        "python": (root / "pyproject.toml").exists() or (root / "requirements.txt").exists(),
        "csharp": any(n.endswith(".csproj") or n.endswith(".sln") for n in names),
        "cpp_c": (root / "CMakeLists.txt").exists() or (root / "Makefile").exists() or any(n.endswith(".cpp") or n.endswith(".c") for n in names),
        "assembly": any(n.endswith(".asm") or n.endswith(".s") or n.endswith(".nasm") for n in names),
        "go": (root / "go.mod").exists(),
        "web": (root / "index.html").exists() or any(n.endswith(".html") or n.endswith(".css") for n in names),
        "docs_schemas": (root / "schemas").exists() or (root / "docs").exists() or (root / "README.md").exists(),
        "detected_languages": list(detected_languages),
        "plan": None
    }
    candidates = ["docs/PLAN.md", "UNIFIED-PLAN.md", "PLAN.md", "TODO.md", "todo.md", "tasks.md"]
    for c in candidates:
        cand_path = root / c
        if cand_path.exists():
            env["plan"] = cand_path
            break
    return env

def compute_validation_command(env: dict) -> str:
    gates = []
    if env["rust"]:
        gates.append("cargo check --workspace --all-targets && cargo test")
    if env["csharp"]:
        gates.append("dotnet build && dotnet test")
    if env["bun_node"]:
        gates.append("bun test || npm test")
    if env["python"]:
        gates.append("pytest || python -m unittest")
    if env["go"]:
        gates.append("go test ./...")
    if env["cpp_c"]:
        gates.append("ctest || make test")
    if not gates:
        gates.append("git status")
    return " && ".join(gates)

def get_actionable_tasks(plan_path: Path) -> list:
    if not plan_path or not plan_path.exists():
        return []
    tasks = []
    with open(plan_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            stripped = line.strip()
            if (stripped.startswith("-") or stripped.startswith("*")) and any(m in stripped for m in ["⏳", "[ ]", "TODO:"]):
                task = stripped.replace("⏳", "").replace("- [ ]", "").replace("* [ ]", "").replace("TODO:", "").strip()
                tasks.append(task)
    return tasks

def run_cmd(cmd: list, cwd: Path, timeout: int = 600) -> tuple:
    try:
        res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return res.returncode, (res.stdout + res.stderr).strip()
    except Exception as e:
        return 1, str(e)

def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Universal YOLO+ Polyglot Autonomous Runner")
    parser.add_argument("--once", action="store_true", help="Execute exactly one tick and exit")
    parser.add_argument("--dry-run", action="store_true", help="Inspect and simulate tick without running LLM CLI")
    parser.add_argument("--interval", type=int, default=60, help="Interval in seconds between ticks")
    parser.add_argument("--max-ticks", type=int, default=0, help="Maximum ticks (0 = infinite)")
    parser.add_argument("--plan", type=str, default="", help="Custom path to plan/todo file")
    args = parser.parse_args()

    cwd = Path.cwd()
    env = detect_polyglot_environment(cwd)
    plan_file = Path(args.plan) if args.plan else env["plan"]
    verify_cmd = compute_validation_command(env)

    active_langs = env.get("detected_languages", [])
    detected_stacks = [k for k, v in env.items() if v and k not in ("plan", "detected_languages")]
    summary_stacks = active_langs if active_langs else detected_stacks

    print("=" * 66)
    print("⚡ YOLO+ Sovereign Autonomous Polyglot Runner (Universal Engine)")
    print(f"📁 Workspace: {cwd}")
    print(f"📋 Plan File: {plan_file if plan_file else 'None (Standalone / Direct Goal)'}")
    print(f"🛠️ Active Stacks: {', '.join(summary_stacks) if summary_stacks else 'Generic / Polyglot'}")
    print(f"🛡️ Validation Gate: {verify_cmd}")
    print("=" * 66)

    coord_dir = cwd / ".coord"
    heartbeat_file = coord_dir / "heartbeat.txt"
    log_file = cwd / "var" / "log" / "yolo_autopilot.jsonl"
    if not args.dry_run:
        coord_dir.mkdir(exist_ok=True)
        log_file.parent.mkdir(parents=True, exist_ok=True)

    tick = 0
    while True:
        tick += 1
        if args.max_ticks > 0 and tick > args.max_ticks:
            print(f"🏁 Reached maximum tick bound ({args.max_ticks}). Stopping.")
            break

        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        tasks = get_actionable_tasks(plan_file) if plan_file else []
        current_task = tasks[0] if tasks else "Perpetual codebase maintenance, typing, and verification"

        print(f"\n--- Tick {tick} | {timestamp} ---")
        print(f"🎯 Target Task: {current_task}")

        if not args.dry_run:
            with open(heartbeat_file, "w", encoding="utf-8") as hf:
                hf.write(f"{timestamp} - Tick {tick} - {current_task}\n")

        prompt = (
            f"You are a sovereign polyglot lead developer in full YOLO mode across all languages (C#, C++, C, Assembly, Rust, Bun/TS, Python/uv, Go, Web HTML/CSS, JSON, Markdown, Pseudocode). "
            f"Implement this target task end-to-end: '{current_task}'. "
            f"Ensure all code compiles and verification gates pass ('{verify_cmd}'). "
            f"Stage and create an atomic Conventional Commit. Zero confirmation pauses."
        )

        cli_cmd = None
        for candidate in ["agy", "claude", "gemini"]:
            path_found = shutil.which(candidate)
            if path_found:
                if candidate == "agy":
                    cli_cmd = [path_found, "-p", prompt, "--dangerously-skip-permissions", "--model", "gemini-3.8-flash-low"]
                elif candidate == "claude":
                    cli_cmd = [path_found, "-p", prompt, "--dangerously-skip-permissions"]
                elif candidate == "gemini":
                    cli_cmd = [path_found, "--prompt", prompt]
                break

        lead_output = ""
        if args.dry_run:
            print(f"🔍 Dry-run mode: Prompt prepared for {cli_cmd[0] if cli_cmd else 'agent'}. Skipping live dispatch.")
            lead_output = "Dry run completed successfully."
        elif cli_cmd:
            print(f"🚀 Dispatching Lead Agent via {cli_cmd[0]}...")
            code, out = run_cmd(cli_cmd, cwd, timeout=300)
            lead_output = out[:1000]
        else:
            print("⚠️ No autonomous CLI harness detected (claude/gemini/agy) on PATH.")
            lead_output = "No autonomous CLI harness available."

        log_entry = {
            "ts": timestamp,
            "tick": tick,
            "task": current_task,
            "verify_cmd": verify_cmd,
            "stacks": detected_stacks,
            "output_sample": lead_output
        }
        if not args.dry_run:
            with open(log_file, "a", encoding="utf-8") as lf:
                lf.write(json.dumps(log_entry) + "\n")

        if args.once:
            break

        time.sleep(args.interval)

if __name__ == "__main__":
    main()
