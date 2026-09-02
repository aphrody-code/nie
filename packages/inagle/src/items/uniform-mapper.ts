import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../core/paths.js";
import { loadFashionItemMappingAsync } from "../parsers/item-config.js";

export interface ZukanUniform {
	item_id: string;
	model_id_crc: string;
	fielder_model_id: string;
	keeper_model_id: string;
	glove_model_id: string;
	shoes_model_id: string;
}

interface RawUniformInfo {
	nameId: string; // Hex string
	modelInfo: [number, number]; // [index, count]
}

interface RawUniformModelInfo {
	uniformFielderModelIdCrc: string;
	uniformKeeperModelIdCrc: string;
	gloveModelIdCrc: string;
	shoesFielderModelIdCrc: string;
	// ... other fields
}

export async function loadUniformsAsync(): Promise<ZukanUniform[]> {
	const uniformPath = join(PATHS.allGamedata, "UniformInfo.json");
	const modelPath = join(PATHS.allGamedata, "UniformModelInfo.json");

	if (!existsSync(uniformPath) || !existsSync(modelPath)) {
		console.warn("[Uniforms] Files not found");
		return [];
	}

	const uniformInfo: { data: RawUniformInfo[] } = JSON.parse(readFileSync(uniformPath, "utf-8"));
	const modelInfo: { data: RawUniformModelInfo[] } = JSON.parse(readFileSync(modelPath, "utf-8"));

	// Load mapping ItemID -> UniformID
	const itemToUniformMap = await loadFashionItemMappingAsync(PATHS.root);
	// Invert map to search by UniformID
	const uniformToItemMap = new Map<number, number>();
	for (const [itemId, uniformId] of itemToUniformMap.entries()) {
		uniformToItemMap.set(uniformId, itemId);
	}

	const result: ZukanUniform[] = [];

	for (const info of uniformInfo.data) {
		const uniformIdInt = Number.parseInt(info.nameId, 16) >>> 0;
		const itemIdInt = uniformToItemMap.get(uniformIdInt);

		if (itemIdInt) {
			const itemIdHex = `0x${itemIdInt.toString(16).toUpperCase()}`;
			const modelIndex = info.modelInfo[0];
			const model = modelInfo.data[modelIndex];

			if (model) {
				result.push({
					item_id: itemIdHex,
					model_id_crc: info.nameId,
					fielder_model_id: model.uniformFielderModelIdCrc,
					keeper_model_id: model.uniformKeeperModelIdCrc,
					glove_model_id: model.gloveModelIdCrc,
					shoes_model_id: model.shoesFielderModelIdCrc, // Defaulting to fielder shoes
				});
			}
		}
	}

	console.log(
		`[Uniforms] Mapped ${result.length} uniforms from ${uniformInfo.data.length} entries.`
	);
	return result;
}

export function loadUniforms(): ZukanUniform[] {
	throw new Error("loadUniforms is deprecated. Use loadUniformsAsync.");
}
