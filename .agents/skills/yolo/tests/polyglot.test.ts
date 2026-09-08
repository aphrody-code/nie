// SPDX-License-Identifier: Apache-2.0
/**
 * Test suite for the Native Polyglot Detector & Parser in YOLO+
 */
import { describe, expect, test } from "bun:test";
import { PolyglotDetector, LANGUAGE_REGISTRY } from "../scripts/polyglot-detector";

describe("Polyglot Language Detector", () => {
  test("registry has 20+ comprehensive languages", () => {
    expect(LANGUAGE_REGISTRY.length).toBeGreaterThanOrEqual(20);
  });

  test("detects Rust by extension and Cargo.toml", () => {
    expect(PolyglotDetector.detect("main.rs").name).toBe("Rust");
    expect(PolyglotDetector.detect("Cargo.toml").name).toBe("Rust");
  });

  test("detects TypeScript, TSX, Bun shebang", () => {
    expect(PolyglotDetector.detect("server.ts").name).toBe("TypeScript");
    expect(PolyglotDetector.detect("component.tsx").name).toBe("TypeScript");
    expect(PolyglotDetector.detect("run", "#!/usr/bin/env bun").name).toBe("TypeScript");
  });

  test("detects C#, C++, C, Assembly", () => {
    expect(PolyglotDetector.detect("Program.cs").name).toBe("C#");
    expect(PolyglotDetector.detect("main.cpp").name).toBe("C++");
    expect(PolyglotDetector.detect("CMakeLists.txt").name).toBe("C++");
    expect(PolyglotDetector.detect("driver.c").name).toBe("C");
    expect(PolyglotDetector.detect("boot.asm").name).toBe("Assembly");
  });

  test("detects Go, Python, HTML, Markdown, JSON, Pseudocode", () => {
    expect(PolyglotDetector.detect("main.go").name).toBe("Go");
    expect(PolyglotDetector.detect("script.py").name).toBe("Python");
    expect(PolyglotDetector.detect("index.html").name).toBe("HTML");
    expect(PolyglotDetector.detect("README.md").name).toBe("Markdown");
    expect(PolyglotDetector.detect("data.json").name).toBe("JSON");
    expect(PolyglotDetector.detect("algo.pseudo").name).toBe("Pseudocode");
  });
});

describe("Polyglot Structural Code Parser", () => {
  test("parses Rust functions, structs, and use imports", () => {
    const code = [
      "// A rust module",
      "use std::collections::HashMap;",
      "use anyhow::Result;",
      "",
      "pub struct Orchestrator {",
      "    id: String,",
      "}",
      "",
      "pub async fn run_loop() -> Result<()> {",
      "    Ok(())",
      "}"
    ].join("\n");
    const res = PolyglotDetector.parseCode("src/lib.rs", code);
    expect(res.language).toBe("Rust");
    expect(res.declarations.classes).toContain("Orchestrator");
    expect(res.declarations.functions).toContain("run_loop");
    expect(res.imports).toContain("std::collections::HashMap");
    expect(res.commentLines).toBe(1);
    expect(res.validationGate).toBe("cargo check --workspace --all-targets && cargo test");
  });

  test("parses TypeScript functions, classes, interfaces, and imports", () => {
    const code = [
      'import { describe, expect } from "bun:test";',
      "",
      "export interface AgentConfig {",
      "  name: string;",
      "}",
      "",
      "export class AutonomousWorker {",
      "  execute() {}",
      "}",
      "",
      "export function dispatchTick() {",
      "  return true;",
      "}"
    ].join("\n");
    const res = PolyglotDetector.parseCode("agent.ts", code);
    expect(res.language).toBe("TypeScript");
    expect(res.declarations.classes).toContain("AutonomousWorker");
    expect(res.declarations.interfaces).toContain("AgentConfig");
    expect(res.declarations.functions).toContain("dispatchTick");
    expect(res.imports).toContain("bun:test");
  });

  test("parses Python defs, classes, and imports", () => {
    const code = [
      "# Python module",
      "from pathlib import Path",
      "import json",
      "",
      "class PolyglotRunner:",
      "    def __init__(self):",
      "        pass",
      "",
      "def execute_tick():",
      "    return 42"
    ].join("\n");
    const res = PolyglotDetector.parseCode("script.py", code);
    expect(res.language).toBe("Python");
    expect(res.declarations.classes).toContain("PolyglotRunner");
    expect(res.declarations.functions).toContain("execute_tick");
    expect(res.imports).toContain("pathlib");
    expect(res.imports).toContain("json");
  });

  test("parses C# classes and interfaces", () => {
    const code = [
      "using System;",
      "using System.Threading.Tasks;",
      "",
      "public interface IAgent {",
      "    Task RunAsync();",
      "}",
      "",
      "public class AgentHost : IAgent {",
      "}"
    ].join("\n");
    const res = PolyglotDetector.parseCode("Agent.cs", code);
    expect(res.language).toBe("C#");
    expect(res.declarations.interfaces).toContain("IAgent");
    expect(res.declarations.classes).toContain("AgentHost");
    expect(res.imports).toContain("System");
  });

  test("keeps C and C++ preprocessor directives out of comment metrics", () => {
    const res = PolyglotDetector.parseCode("main.c", [
      "#include <stdio.h>",
      "/* an inline block comment */ int main() {",
      "  return 0; // trailing comment",
      "}"
    ].join("\n"));

    expect(res.imports).toContain("stdio.h");
    expect(res.declarations.functions).toContain("main");
    expect(res.codeLines).toBe(4);
    expect(res.commentLines).toBe(0);
    expect(res.blankLines).toBe(0);
  });

  test("does not swallow code after a multi-line comment", () => {
    const res = PolyglotDetector.parseCode("values.ts", [
      "/* start",
      " * details",
      " */ export const answer = 42;"
    ].join("\n"));

    expect(res.declarations.constants).toContain("answer");
    expect(res.codeLines).toBe(1);
    expect(res.commentLines).toBe(2);
  });

  test("handles single-quoted Python docstrings across lines", () => {
    const res = PolyglotDetector.parseCode("runner.py", [
      "''' module documentation",
      "continues here",
      "'''",
      "def run():",
      "    return True"
    ].join("\n"));

    expect(res.declarations.functions).toContain("run");
    expect(res.codeLines).toBe(2);
    expect(res.commentLines).toBe(3);
  });
});
