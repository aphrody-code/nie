/**
 * @file config-parser.ts
 * @description Parser for cfg.bin.json files extracted from game
 *
 * Game config files use a nested structure with:
 * - Nodes with name, variables, children
 * - Variables with type (Int, Float, String, List) and value
 */

export interface ConfigVariable {
	type: "Int" | "Float" | "String" | "List";
	value: string;
	items?: string[];
}

export interface ConfigNode {
	name: string;
	variables: ConfigVariable[];
	children?: ConfigNode[];
}

export interface ConfigFile {
	name: string;
	variables: ConfigVariable[];
	children: ConfigNode[];
}

/**
 * Parse an integer variable (handles negative hex values)
 */
export function parseIntVar(variable: ConfigVariable): number {
	if (variable.type !== "Int") {
		throw new Error(`Expected Int, got ${variable.type}`);
	}
	// Handle hex string or regular integer
	const val = variable.value;
	if (val.startsWith("-")) {
		return Number.parseInt(val, 10);
	}
	return Number.parseInt(val, 10);
}

/**
 * Parse a float variable
 * Handles French locale format with comma as decimal separator (0,5 -> 0.5)
 */
export function parseFloatVar(variable: ConfigVariable): number {
	if (variable.type !== "Float") {
		throw new Error(`Expected Float, got ${variable.type}`);
	}
	// Replace French comma with period for proper parsing
	const normalizedValue = variable.value.replace(",", ".");
	return Number.parseFloat(normalizedValue);
}

/**
 * Parse a string variable
 */
export function parseStringVar(variable: ConfigVariable): string {
	if (variable.type !== "String") {
		throw new Error(`Expected String, got ${variable.type}`);
	}
	return variable.value;
}

/**
 * Parse a list variable
 */
export function parseListVar(variable: ConfigVariable): string[] {
	if (variable.type !== "List") {
		throw new Error(`Expected List, got ${variable.type}`);
	}
	return variable.items ?? [];
}

/**
 * Get all nodes of a specific type from a config file
 */
export function getNodesByName(config: ConfigFile, name: string): ConfigNode[] {
	const results: ConfigNode[] = [];

	function traverse(node: ConfigNode) {
		if (node.name.startsWith(name)) {
			results.push(node);
		}
		if (node.children) {
			for (const child of node.children) {
				traverse(child);
			}
		}
	}

	for (const child of config.children) {
		traverse(child);
	}

	return results;
}

/**
 * Extract all variables from a node as an array of typed values
 */
export function extractVariables(node: ConfigNode): (string | number)[] {
	return node.variables.map((v) => {
		switch (v.type) {
			case "Int":
				return parseIntVar(v);
			case "Float":
				return parseFloatVar(v);
			case "String":
				return v.value;
			case "List":
				return v.items?.join(",") ?? "";
			default:
				return v.value;
		}
	});
}

/**
 * Convert a CHARA_PARAM_INFO node to structured character param data
 *
 * Based on analysis of chara_param config:
 * [0] charaBaseId (hash)
 * [1] unknown hash
 * [2] mainPosition (0-3)
 * [3] subPosition (0-3)
 * [4] element (0-3)
 * [5] gender (0-1)
 * [6] rarity/charaRank (1-5)
 * [7] growthPattern
 * [8] body type
 * ... more params
 */
export interface CharaParamData {
	charaBaseId: number;
	mainPosition: number;
	subPosition: number;
	element: number;
	gender: number;
	charaRank: number;
	growthPattern: number;
	bodyType: number;
	raw: number[];
}

export function parseCharaParamNode(node: ConfigNode): CharaParamData | null {
	const vars = extractVariables(node);
	if (vars.length < 10) return null;

	return {
		charaBaseId: vars[0] as number,
		mainPosition: vars[2] as number,
		subPosition: vars[3] as number,
		element: vars[4] as number,
		gender: vars[5] as number,
		charaRank: vars[6] as number,
		growthPattern: vars[7] as number,
		bodyType: vars[8] as number,
		raw: vars.filter((v): v is number => typeof v === "number"),
	};
}

/**
 * Convert a CHARA_BASE_INFO node to structured character base data
 *
 * [0] charaId (hash)
 * [1] faceId
 * ... more
 */
export interface CharaBaseData {
	charaId: number;
	faceId: number;
	raw: number[];
}

export function parseCharaBaseNode(node: ConfigNode): CharaBaseData | null {
	const vars = extractVariables(node);
	if (vars.length < 2) return null;

	return {
		charaId: vars[0] as number,
		faceId: vars[1] as number,
		raw: vars.filter((v): v is number => typeof v === "number"),
	};
}
