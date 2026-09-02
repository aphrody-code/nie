import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

export interface AbilityBoardEffect {
	id: number;
	hash: string;
	type: number;
	value: number;
	skillId?: string;
	passiveId?: string;
}

export interface AbilityBoardNode {
	boardId: string;
	effectId: number;
}

export async function loadAbilityLearningConfig(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("skill", "ability_learning_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = JSON.parse(readFileSync(path, "utf-8")) as { entries?: ConfigNode[] };

	const effects = new Map<number, AbilityBoardEffect>();
	const boards = new Map<string, number[]>();

	if (content.entries) {
		for (const entry of content.entries) {
			// Parse Effects
			if (entry.name === "ABILITY_LEARNING_BOARD_EFFECT_LIST_BEG_0") {
				for (const child of entry.children || []) {
					const id = parseInt(child.name.replace("ABILITY_LEARNING_BOARD_EFFECT_", ""), 10);
					const vars = child.variables;
					effects.set(id, {
						id,
						hash: toHex(parseInt(vars[0]?.value || "0", 10)),
						type: parseInt(vars[2]?.value || "0", 10),
						value: parseInt(vars[3]?.value || "0", 10),
					});
				}
			}

			// Parse Board Info (Links boards to effects)
			if (entry.name === "ABILITY_LEARNING_BOARD_INFO_LIST_BEG_0") {
				for (const child of entry.children || []) {
					if (child.name.startsWith("ABILITY_LEARNING_BOARD_INFO_REF_EFFECT_")) {
						const id = parseInt(
							child.name.replace("ABILITY_LEARNING_BOARD_INFO_REF_EFFECT_", ""),
							10
						);
						const vars = child.variables;
						// Find the corresponding BOARD_INFO (it has the same index)
						const boardNode = (entry.children || []).find(
							(c) => c.name === `ABILITY_LEARNING_BOARD_INFO_${id}`
						);
						if (boardNode) {
							const boardId = toHex(parseInt(boardNode.variables[0]?.value || "0", 10));
							if (!boards.has(boardId)) boards.set(boardId, []);
							boards.get(boardId)!.push(parseInt(vars[0]?.value || "0", 10));
						}
					}
				}
			}
		}
	}

	return { effects, boards };
}
