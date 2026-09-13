// SPDX-License-Identifier: Apache-2.0
/**
 * Structural integrity gate for the YOLO manifest, schema, agent roster and
 * skill library. Keeps `bun test` a meaningful pass/fail signal instead of
 * an empty no-op.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const readJson = (relPath: string) => JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8"));

describe("package.json", () => {
  const pkg = readJson("package.json");

  test("declares the bun test gate", () => {
    expect(pkg.scripts.test).toBe("bun test");
  });

  test("every npm script referencing a scripts/ file points at a real file", () => {
    for (const [, cmd] of Object.entries(pkg.scripts) as [string, string][]) {
      const match = cmd.match(/scripts\/[\w.-]+/);
      if (match) {
        expect(existsSync(resolve(ROOT, match[0]))).toBe(true);
      }
    }
  });
});

describe("yolo.json manifest", () => {
  const manifest = readJson("yolo.json");
  const schema = readJson("schemas/yolo.schema.json");

  test("is valid JSON with a $schema pointer to the local schema file", () => {
    expect(manifest.$schema).toBe("./schemas/yolo.schema.json");
  });

  test("satisfies every top-level field the schema marks required", () => {
    for (const field of schema.required as string[]) {
      expect(manifest).toHaveProperty(field);
    }
  });

  test("kind is one of the schema's enumerated values", () => {
    expect(schema.properties.kind.enum).toContain(manifest.kind);
  });

  test("spec is one of the schema's enumerated values", () => {
    expect(schema.properties.spec.enum).toContain(manifest.spec);
  });

  test("declares at least one gate type used by the autopilot runners", () => {
    expect(Array.isArray(manifest.engine.gate_types)).toBe(true);
    expect(manifest.engine.gate_types.length).toBeGreaterThan(0);
    const hasBunGate = manifest.engine.gate_types.includes("bun_node_test") || manifest.engine.gate_types.includes("bun_test");
    expect(hasBunGate).toBe(true);
  });
});

describe("agents/", () => {
  const dir = resolve(ROOT, "agents");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));

  test("has at least one agent definition", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${file} has well-formed frontmatter with name + description`, () => {
      const text = readFileSync(resolve(dir, file), "utf8");
      const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      expect(frontmatter).not.toBeNull();
      const body = frontmatter![1];
      expect(body).toMatch(/^name:\s*\S+/m);
      expect(body).toMatch(/^description:\s*\S+/m);
    });
  }
});

describe("skills/", () => {
  const dir = resolve(ROOT, "skills");
  const entries = readdirSync(dir).filter((f) => statSync(resolve(dir, f)).isDirectory());

  test("has at least one skill", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const skill of entries) {
    test(`${skill} contains a SKILL.md`, () => {
      expect(existsSync(resolve(dir, skill, "SKILL.md"))).toBe(true);
    });
  }
});
