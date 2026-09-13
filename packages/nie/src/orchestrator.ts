/**
 * Orchestration unifiée du workspace niers via Bun FFI et @aphrody/yolo.
 *
 * Coordonne les flux et l'avancement entre :
 * - nie-core   (types fondamentaux, math, PRNG CRand, CRC32)
 * - nie-formats(décodage/sérialisation formats Level-5 & Criware : CPK, cfg.bin, G4TX, etc.)
 * - nie-data   (modèles sémantiques de jeu : menu_setting, waza, joueurs)
 * - nie-lua    (VM mlua 5.2, parsing bytecode .lua.bin, analyse statique)
 * - nie-wiki   (moteur de requêtes SQLite/miroir, données de jeu)
 * - nie-re     (reverse engineering binaire, indexation iced-x86, RTTI MSVC, .pdata)
 * - nie-forge  (assemblage du binaire nie.exe, mesures de reconstruction byte-exact)
 *
 * Intègre le moteur polyglotte @aphrody/yolo (v3.2.0) pour la détection universelle,
 * l'extraction structurelle AST (style tree-sitter) de code source (Rust, C/C++, Lua, ASM, TS, Python, Go)
 * et le pilotage des gates de validation multi-langages.
 */

import {
  PolyglotDetector,
  type LanguageDefinition,
  type ParseResult,
} from "@aphrody/yolo";

import {
  crc32,
  detectFormat,
  decode,
  decodeMenuSetting,
  wiki,
  vfsOpen,
  version,
  type FormatInfo,
  type VfsHandle,
  type WikiRequest,
} from "./index";

export type CrateName =
  | "nie-core"
  | "nie-formats"
  | "nie-data"
  | "nie-lua"
  | "nie-wiki"
  | "nie-re"
  | "nie-forge";

export interface PipelineProgressEvent {
  timestamp: number;
  crate: CrateName;
  stage: string;
  payload: Record<string, unknown>;
}

export interface CrateCapability {
  name: CrateName;
  status: "ready" | "in_progress" | "experimental";
  description: string;
  exportedFeatures: string[];
}

export class UnifiedPipelineOrchestrator {
  private events: PipelineProgressEvent[] = [];
  private activeVfs: VfsHandle | null = null;

  constructor() {}

  /**
   * Retourne l'inventaire des capacités des 7 crates orchestrées.
   */
  getCapabilities(): CrateCapability[] {
    return [
      {
        name: "nie-core",
        status: "ready",
        description: "Fondations : CRC32 IEEE 802.3, PRNG CRand MT19937, simulation déterministe.",
        exportedFeatures: ["crc32", "CRand", "simulate_match"],
      },
      {
        name: "nie-formats",
        status: "ready",
        description: "Décodage / détection multi-formats Level-5 & Criware (CPK, cfg.bin, G4TX, G4MD, LIP).",
        exportedFeatures: ["detectFormat", "decode", "decodeToPng", "vfs"],
      },
      {
        name: "nie-data",
        status: "ready",
        description: "Modèles métier de jeu (menu_setting, joueurs, waza, dictionnaires).",
        exportedFeatures: ["decodeMenuSetting", "MenuSetting"],
      },
      {
        name: "nie-lua",
        status: "ready",
        description: "VM Lua 5.2 (mlua), bytecode .lua.bin validator et parser, AST tree-sitter.",
        exportedFeatures: ["bytecode_parse", "lua52_vm", "static_analysis"],
      },
      {
        name: "nie-wiki",
        status: "ready",
        description: "Moteur SQL/SQLite miroir pour interrogations structurées (fiches, quêtes, auras, items).",
        exportedFeatures: ["wiki_query", "wiki_cards", "wiki_search"],
      },
      {
        name: "nie-re",
        status: "ready",
        description: "Analyse binaire x86_64, iced-x86, tables .pdata, RTTI MSVC, graphe de propagation.",
        exportedFeatures: ["pdata_parse", "rtti_dump", "label_propagation"],
      },
      {
        name: "nie-forge",
        status: "ready",
        description: "Moteur de forge et assemblage binaire de nie.exe, intégration nie-pe et nie-asm.",
        exportedFeatures: ["binary_forge", "byte_exact_metrics", "pe_emit"],
      },
    ];
  }

  /**
   * Enregistre un jalon ou une avancée d'un crate dans la pipeline.
   */
  recordProgress(crate: CrateName, stage: string, payload: Record<string, unknown> = {}): void {
    const event: PipelineProgressEvent = {
      timestamp: Date.now(),
      crate,
      stage,
      payload,
    };
    this.events.push(event);
  }

  /**
   * Récupère l'historique des événements de progression.
   */
  getEvents(): readonly PipelineProgressEvent[] {
    return this.events;
  }

  /**
   * Valide la liaison native globale via nie_version et le chargement FFI.
   */
  checkNativeHealth(): { healthy: boolean; version: string } {
    try {
      const v = version();
      return { healthy: v.length > 0, version: v };
    } catch {
      return { healthy: false, version: "unknown" };
    }
  }

  /**
   * Étape de pipeline : détection et décodage d'asset binaire via nie-formats + nie-data.
   */
  processBinaryAsset(buffer: Uint8Array): {
    format: FormatInfo;
    decoded: unknown | null;
    crc: number;
  } {
    const crc = crc32(buffer);
    const format = detectFormat(buffer);
    let decoded: unknown | null = null;

    if (format.name === "cfg.bin") {
      decoded = decodeMenuSetting(buffer) ?? decode(buffer);
    } else if (format.name !== "Unknown") {
      decoded = decode(buffer);
    }

    this.recordProgress("nie-formats", "asset_processed", {
      format: format.name,
      crc,
      size: buffer.byteLength,
    });

    return { format, decoded, crc };
  }

  /**
   * Étape de pipeline : interrogation wiki unifiée via le transport natif nie-wiki.
   */
  queryWiki<T = unknown>(request: WikiRequest): T {
    const result = wiki<T>(request);
    this.recordProgress("nie-wiki", "wiki_queried", {
      op: request.op,
    });
    return result;
  }

  /**
   * Étape de pipeline : ouverture ou association d'un VFS partagé.
   */
  mountVfs(dataDir: string): VfsHandle | null {
    if (this.activeVfs) {
      this.activeVfs.free();
      this.activeVfs = null;
    }
    this.activeVfs = vfsOpen(dataDir);
    if (this.activeVfs) {
      this.recordProgress("nie-formats", "vfs_mounted", {
        dataDir,
        entryCount: this.activeVfs.count(),
      });
    }
    return this.activeVfs;
  }

  // ─── Intégration @aphrody/yolo (Parsing, Détection, Compréhension AST) ─────

  /**
   * Détecte le langage et type de fichier via le moteur polyglotte YOLO.
   */
  detectSourceLanguage(filepath: string, content?: string): LanguageDefinition {
    return PolyglotDetector.detect(filepath, content);
  }

  /**
   * Parse et extrait la structure AST (fonctions, classes, interfaces, imports, métriques)
   * pour n'importe quel fichier de code source du dépôt (Rust, C/C++, Lua, ASM, TS, Python, Go)
   * avec l'analyseur inspiré de Tree-sitter de @aphrody/yolo.
   */
  parseSourceCode(filepath: string, content: string): ParseResult {
    const parsed = PolyglotDetector.parseCode(filepath, content);
    const crate = this.inferCrateFromPath(filepath);
    if (crate) {
      this.recordProgress(crate, "code_analyzed", {
        filepath,
        language: parsed.language,
        functionsCount: parsed.declarations.functions.length,
        classesCount: parsed.declarations.classes.length,
        codeLines: parsed.codeLines,
      });
    }
    return parsed;
  }

  /**
   * Déduit le crate concerné à partir du chemin du fichier.
   */
  private inferCrateFromPath(filepath: string): CrateName | null {
    const normalized = filepath.replace(/\\/g, "/");
    if (normalized.includes("crates/engine/nie-core")) return "nie-core";
    if (normalized.includes("crates/engine/nie-formats")) return "nie-formats";
    if (normalized.includes("crates/engine/nie-data")) return "nie-data";
    if (normalized.includes("crates/engine/nie-lua")) return "nie-lua";
    if (normalized.includes("crates/tools/nie-wiki")) return "nie-wiki";
    if (normalized.includes("crates/forge/nie-re")) return "nie-re";
    if (normalized.includes("crates/forge/nie-forge")) return "nie-forge";
    return null;
  }
}

export const orchestrator = new UnifiedPipelineOrchestrator();
