/**
 * Characters module - Public API exports
 *
 * For internal/tooling use (CFG.BIN parsing), import directly:
 * - import { ... } from '@rosegriffon/inagle/characters/mapper.js'
 * - import { ... } from '@rosegriffon/inagle/characters/mapper-v3.js'
 */

// Primary API - uses pre-extracted JSON entities
export * from "./api.js";
export * from "./comparison-engine.js";

// Types used by the API
export type { CharacterDatabase, UnifiedCharacter, UnifiedCharacterVariant } from "./types.js";
