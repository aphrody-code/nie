/**
 * CFG.BIN JSON structure schemas
 *
 * Based on actual dump data from:
 * - dump/data/common/gamedata/**\/*.cfg.bin.json
 * - dump/data/common/text/{locale}/*.cfg.bin.json
 *
 * Two formats exist in the dump:
 * 1. "Entries" format (tree structure) - team_config, item_config, all text files
 * 2. "version 100" format (typed lists) - skill_config, soccer_*, basara_*, formation_*
 */

// ============================================================================
// FORMAT 1: Entries (Tree Structure)
// Found in: text/*.cfg.bin.json, item_config, team_config, capsule_config, etc.
// ============================================================================

/**
 * Variable types in CFG.BIN exports
 */
export type CfgBinVariableType = "Int" | "Float" | "String";

/**
 * Lowercase variable format
 * Found in: chara_text, skill_text, chara_base, etc.
 */
export interface CfgBinVariable {
	type: CfgBinVariableType;
	value: string | number;
}

/**
 * PascalCase variable format (with Name field)
 * Found in: item_config, team_config, capsule_config, etc.
 */
export interface CfgBinNamedVariable {
	Name: string;
	Type: CfgBinVariableType;
	Value: string | number;
}

/**
 * Lowercase entry node (recursive tree)
 * Found in: chara_text.cfg.bin.json, skill_text.cfg.bin.json
 */
export interface CfgBinEntry {
	name: string;
	variables: CfgBinVariable[];
	children: CfgBinEntry[];
}

/**
 * PascalCase entry node (recursive tree with EndTerminator)
 * Found in: item_config, team_config, capsule_config
 */
export interface CfgBinNamedEntry {
	Name: string;
	EndTerminator: boolean;
	Variables: CfgBinNamedVariable[];
	Children?: CfgBinNamedEntry[];
}

/**
 * Root document - lowercase format
 * Example: chara_text.cfg.bin.json, chara_base_1.03.98.00.cfg.bin.json
 */
export interface CfgBinDocument {
	entries: CfgBinEntry[];
}

/**
 * Root document - PascalCase format
 * Example: item_config_1.03.65.00.json, team_config_1.04.06.00.json
 */
export interface CfgBinNamedDocument {
	Encoding?: string; // 'utf-8' | 'shift_jis'
	Entries: CfgBinNamedEntry[];
}

// ============================================================================
// FORMAT 2: Version 100 (Typed Lists)
// Found in: skill_config, soccer_chara_unique_rarity_config, basara_chara_config
// ============================================================================

/**
 * Generic typed list structure
 */
export interface TypedList<T = Record<string, unknown>> {
	name: string; // e.g. "m_skillInfoList", "m_soccerCharaUniqueRarityList"
	typeName: string; // e.g. "SKILL_INFO", "SOCCER_CHARA_UNIQUE_RARITY"
	values: T[];
}

/**
 * Root document - version 100 format
 * Example: skill_config_2.00.19.00.cfg.bin.json
 */
export interface TypedDocument<T = Record<string, unknown>> {
	version: number; // Always 100
	lists: TypedList<T>[];
}
