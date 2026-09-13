#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""
Universal Polyglot Language & File Type Detector & Parser (Python 3.10+)
Directly inspired by GitHub Linguist, Google Magika heuristics, and Tree-sitter AST conventions.
"""

import os
import re
import json
from pathlib import Path

REGISTRY = {
    "rust": {
        "name": "Rust",
        "category": "programming",
        "extensions": [".rs"],
        "filenames": ["Cargo.toml"],
        "test_gate": "cargo test",
        "build_gate": "cargo check --workspace --all-targets"
    },
    "typescript": {
        "name": "TypeScript",
        "category": "programming",
        "extensions": [".ts", ".tsx", ".mts", ".cts"],
        "filenames": ["tsconfig.json"],
        "shebangs": ["bun", "deno", "ts-node"],
        "test_gate": "bun test",
        "build_gate": "tsc --noEmit"
    },
    "javascript": {
        "name": "JavaScript",
        "category": "programming",
        "extensions": [".js", ".jsx", ".mjs", ".cjs"],
        "filenames": ["package.json"],
        "shebangs": ["node", "bun"],
        "test_gate": "bun test || npm test",
        "build_gate": "node --check"
    },
    "python": {
        "name": "Python",
        "category": "programming",
        "extensions": [".py", ".pyw", ".pyi"],
        "filenames": ["pyproject.toml", "requirements.txt"],
        "shebangs": ["python", "python3", "uv run"],
        "test_gate": "pytest || python -m unittest",
        "build_gate": "python -m py_compile"
    },
    "csharp": {
        "name": "C#",
        "category": "programming",
        "extensions": [".cs", ".csx"],
        "test_gate": "dotnet test",
        "build_gate": "dotnet build"
    },
    "cpp": {
        "name": "C++",
        "category": "programming",
        "extensions": [".cpp", ".cxx", ".cc", ".hpp", ".hxx"],
        "filenames": ["CMakeLists.txt"],
        "test_gate": "ctest || make test",
        "build_gate": "cmake --build ."
    },
    "c": {
        "name": "C",
        "category": "programming",
        "extensions": [".c", ".h"],
        "filenames": ["Makefile"],
        "test_gate": "make test",
        "build_gate": "make"
    },
    "assembly": {
        "name": "Assembly",
        "category": "programming",
        "extensions": [".asm", ".s", ".nasm"],
        "build_gate": "nasm -f elf64 || as"
    },
    "go": {
        "name": "Go",
        "category": "programming",
        "extensions": [".go"],
        "filenames": ["go.mod"],
        "test_gate": "go test ./...",
        "build_gate": "go build ./..."
    },
    "json": {
        "name": "JSON",
        "category": "data",
        "extensions": [".json", ".jsonc", ".jsonl"]
    },
    "markdown": {
        "name": "Markdown",
        "category": "prose",
        "extensions": [".md", ".markdown"]
    }
}

class PolyglotDetector:
    @staticmethod
    def detect(filepath: str, content: str = "") -> dict:
        p = Path(filepath)
        filename = p.name.lower()
        ext = p.suffix.lower()

        for lang_id, data in REGISTRY.items():
            if "filenames" in data and any(fn.lower() == filename for fn in data["filenames"]):
                return {"id": lang_id, **data}

        if content and content.startswith("#!"):
            first_line = content.splitlines()[0].lower()
            for lang_id, data in REGISTRY.items():
                if "shebangs" in data and any(sh in first_line for sh in data["shebangs"]):
                    return {"id": lang_id, **data}

        for lang_id, data in REGISTRY.items():
            if ext in data.get("extensions", []):
                return {"id": lang_id, **data}

        return {
            "id": "unknown",
            "name": "Plain Text / Generic",
            "category": "prose",
            "extensions": [ext]
        }

    @staticmethod
    def parse_symbols(filepath: str, content: str) -> dict:
        info = PolyglotDetector.detect(filepath, content)
        lang_id = info["id"]
        classes = []
        functions = []
        imports = []

        lines = content.splitlines()
        for line in lines:
            s = line.strip()
            if lang_id == "python":
                if s.startswith("def "):
                    m = re.match(r"^def\s+([a-zA-Z0-9_]+)", s)
                    if m: functions.append(m.group(1))
                elif s.startswith("class "):
                    m = re.match(r"^class\s+([a-zA-Z0-9_]+)", s)
                    if m: classes.append(m.group(1))
                elif s.startswith("import ") or s.startswith("from "):
                    imports.append(s)
            elif lang_id == "rust":
                if "fn " in s:
                    m = re.search(r"\bfn\s+([a-zA-Z0-9_]+)", s)
                    if m: functions.append(m.group(1))
                elif "struct " in s:
                    m = re.search(r"\bstruct\s+([a-zA-Z0-9_]+)", s)
                    if m: classes.append(m.group(1))
                elif s.startswith("use "):
                    imports.append(s)
            elif lang_id in ("typescript", "javascript"):
                if "function " in s:
                    m = re.search(r"\bfunction\s+([a-zA-Z0-9_]+)", s)
                    if m: functions.append(m.group(1))
                elif "class " in s:
                    m = re.search(r"\bclass\s+([a-zA-Z0-9_]+)", s)
                    if m: classes.append(m.group(1))
                elif s.startswith("import "):
                    imports.append(s)

        return {
            "language": info["name"],
            "category": info["category"],
            "classes": classes,
            "functions": functions,
            "imports": imports,
            "total_lines": len(lines)
        }

if __name__ == "__main__":
    import sys
    target = sys.argv[1] if len(sys.argv) > 1 else "scripts/polyglot-detector.ts"
    cnt = Path(target).read_text(encoding="utf-8", errors="ignore") if Path(target).exists() else ""
    res = PolyglotDetector.parse_symbols(target, cnt)
    print(json.dumps(res, indent=2))