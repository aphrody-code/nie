import { describe, expect, test } from "bun:test";
import { UnifiedPipelineOrchestrator } from "./orchestrator";

describe("UnifiedPipelineOrchestrator", () => {
  test("instancie et liste les capacités des 7 crates", () => {
    const o = new UnifiedPipelineOrchestrator();
    const capabilities = o.getCapabilities();

    expect(capabilities.length).toBe(7);
    const names = capabilities.map((c) => c.name);
    expect(names).toContain("nie-core");
    expect(names).toContain("nie-formats");
    expect(names).toContain("nie-data");
    expect(names).toContain("nie-lua");
    expect(names).toContain("nie-wiki");
    expect(names).toContain("nie-re");
    expect(names).toContain("nie-forge");
  });

  test("enregistre et restitue les événements de progression inter-crates", () => {
    const o = new UnifiedPipelineOrchestrator();
    expect(o.getEvents().length).toBe(0);

    o.recordProgress("nie-core", "crand_seeded", { seed: 5489 });
    o.recordProgress("nie-formats", "format_detected", { kind: "G4TX" });
    o.recordProgress("nie-data", "menu_loaded", { layers: 12 });
    o.recordProgress("nie-forge", "coverage_updated", { coverage: "94.2%" });

    const events = o.getEvents();
    expect(events.length).toBe(4);
    expect(events[0]?.crate).toBe("nie-core");
    expect(events[0]?.stage).toBe("crand_seeded");
    expect(events[3]?.crate).toBe("nie-forge");
  });

  test("coordonne le pipeline binaire avec nie-core et nie-formats", () => {
    const o = new UnifiedPipelineOrchestrator();
    const dummyData = new Uint8Array([0x46, 0x6f, 0x63, 0x75, 0x73]); // "Focus"

    const res = o.processBinaryAsset(dummyData);
    expect(res.crc).toBe(0xA30165ED);
    expect(res.format.name).toBe("Unknown");

    const events = o.getEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.crate).toBe("nie-formats");
    expect(events[0]?.payload["crc"]).toBe(0xA30165ED);
  });
});

  test("utilise @aphrody/yolo pour la détection et l'analyse AST multi-langages", () => {
    const o = new UnifiedPipelineOrchestrator();

    // Détection
    const rustLang = o.detectSourceLanguage("crates/engine/nie-core/src/lib.rs");
    expect(rustLang.id).toBe("rust");
    expect(rustLang.name).toBe("Rust");

    const luaLang = o.detectSourceLanguage("data/common/script/lua/menu/test.lua");
    expect(luaLang.id).toBe("lua");

    // Analyse AST (fonctions, structs, imports)
    const sampleRust = `
use nie_core::crand::CRand;

pub struct MatchCoordinator {
    seed: u32,
}

impl MatchCoordinator {
    pub fn new(seed: u32) -> Self {
        Self { seed }
    }
}
`;
    const parsed = o.parseSourceCode("crates/engine/nie-core/src/coordinator.rs", sampleRust);
    expect(parsed.language).toBe("Rust");
    expect(parsed.declarations.classes).toContain("MatchCoordinator");
    expect(parsed.declarations.functions).toContain("new");
    expect(parsed.imports).toContain("nie_core::crand::CRand");

    const events = o.getEvents();
    const lastEvent = events[events.length - 1];
    expect(lastEvent?.crate).toBe("nie-core");
    expect(lastEvent?.stage).toBe("code_analyzed");
    expect(lastEvent?.payload["functionsCount"]).toBe(1);
  });
