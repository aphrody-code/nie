/**
 * @file uniform-config.ts
 * @description Parser for uniform/jersey model configuration
 *
 * Data source: character/uniform_config_1.03.52.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_UniformModelInfoList: Uniform model CRCs (760 entries)
 * - m_UniformInfoList: Uniform info
 * - m_UniformExModelInfoList: Extended uniform models
 * - m_UniformExInfoList: Extended uniform info
 * - m_CharaUniformExInfoList: Character-specific uniform extensions
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface UniformModelInfo {
	uniformFielderModelIdCrc: string;
	uniformKeeperModelIdCrc: string;
	uniformDirectorModelIdCrc: string;
	uniformManagerModelIdCrc: string;
	// Variantes de manches/coupe réellement présentes dans
	// character/uniform_config (ShoulderBaring, ShortSleeve, HalfSleeve…).
	uniformFielderShoulderBaringModelIdCrc: string;
	uniformKeeperShoulderBaringModelIdCrc: string;
	uniformFielderShortSleeveRollUpArmModelIdCrc: string;
	uniformKeeperShortSleeveRollUpArmModelIdCrc: string;
	uniformFielderShoulderBaringPatternedModelIdCrc: string;
	uniformKeeperShoulderBaringPatternedModelIdCrc: string;
	uniformFielderHalfSleeveModelIdCrc: string;
	uniformKeeperHalfSleeveModelIdCrc: string;
	uniformFielderLongSleeveRollUpArmModelIdCrc: string;
	uniformKeeperLongSleeveRollUpArmModelIdCrc: string;
	uniformFielderLongSleeveRollUpSleeveModelIdCrc: string;
	uniformKeeperLongSleeveRollUpSleeveModelIdCrc: string;
	uniformFielderNavelBaringModelIdCrc: string;
	uniformKeeperNavelBaringModelIdCrc: string;
	shoesFielderModelIdCrc: string;
	shoesKeeperModelIdCrc: string;
	shoesDirectorModelIdCrc: string;
	shoesManagerModelIdCrc: string;
	gloveModelIdCrc: string;
	typeId: number;
	shoesModelAttr: number;
	uniformNgModelAttr: number;
	shoesModelIdLocked: boolean;
}

/**
 * Une entrée nommée de m_UniformInfoList :
 * - nameId   : CRC du libellé de l'uniforme (clé stable).
 * - modelInfo: tuple [startIndex, count] qui découpe m_UniformModelInfoList.
 */
export interface UniformInfo {
	nameId: string;
	modelInfo: [number, number];
	[key: string]: any;
}

export interface UniformDatabase {
	models: UniformModelInfo[];
	uniforms: UniformInfo[];
	exModels: any[];
	exUniforms: any[];
	charaExUniforms: any[];
	byTypeId: Map<number, UniformModelInfo[]>;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const models: UniformModelInfo[] = [];
	const uniforms: UniformInfo[] = [];
	const exModels: any[] = [];
	const exUniforms: any[] = [];
	const charaExUniforms: any[] = [];

	if (!content?.lists) return { models, uniforms, exModels, exUniforms, charaExUniforms };

	for (const list of content.lists) {
		if (list.name === "m_UniformModelInfoList") {
			for (const val of list.values) {
				models.push({
					uniformFielderModelIdCrc: val.uniformFielderModelIdCrc,
					uniformKeeperModelIdCrc: val.uniformKeeperModelIdCrc,
					uniformDirectorModelIdCrc: val.uniformDirectorModelIdCrc,
					uniformManagerModelIdCrc: val.uniformManagerModelIdCrc,
					uniformFielderShoulderBaringModelIdCrc: val.uniformFielderShoulderBaringModelIdCrc,
					uniformKeeperShoulderBaringModelIdCrc: val.uniformKeeperShoulderBaringModelIdCrc,
					uniformFielderShortSleeveRollUpArmModelIdCrc:
						val.uniformFielderShortSleeveRollUpArmModelIdCrc,
					uniformKeeperShortSleeveRollUpArmModelIdCrc:
						val.uniformKeeperShortSleeveRollUpArmModelIdCrc,
					uniformFielderShoulderBaringPatternedModelIdCrc:
						val.uniformFielderShoulderBaringPatternedModelIdCrc,
					uniformKeeperShoulderBaringPatternedModelIdCrc:
						val.uniformKeeperShoulderBaringPatternedModelIdCrc,
					uniformFielderHalfSleeveModelIdCrc: val.uniformFielderHalfSleeveModelIdCrc,
					uniformKeeperHalfSleeveModelIdCrc: val.uniformKeeperHalfSleeveModelIdCrc,
					uniformFielderLongSleeveRollUpArmModelIdCrc:
						val.uniformFielderLongSleeveRollUpArmModelIdCrc,
					uniformKeeperLongSleeveRollUpArmModelIdCrc:
						val.uniformKeeperLongSleeveRollUpArmModelIdCrc,
					uniformFielderLongSleeveRollUpSleeveModelIdCrc:
						val.uniformFielderLongSleeveRollUpSleeveModelIdCrc,
					uniformKeeperLongSleeveRollUpSleeveModelIdCrc:
						val.uniformKeeperLongSleeveRollUpSleeveModelIdCrc,
					uniformFielderNavelBaringModelIdCrc: val.uniformFielderNavelBaringModelIdCrc,
					uniformKeeperNavelBaringModelIdCrc: val.uniformKeeperNavelBaringModelIdCrc,
					shoesFielderModelIdCrc: val.shoesFielderModelIdCrc,
					shoesKeeperModelIdCrc: val.shoesKeeperModelIdCrc,
					shoesDirectorModelIdCrc: val.shoesDirectorModelIdCrc,
					shoesManagerModelIdCrc: val.shoesManagerModelIdCrc,
					gloveModelIdCrc: val.gloveModelIdCrc,
					typeId: val.typeId,
					shoesModelAttr: val.shoesModelAttr,
					uniformNgModelAttr: val.uniformNgModelAttr,
					shoesModelIdLocked: val.shoesModelIdLocked,
				});
			}
		} else if (list.name === "m_UniformInfoList") {
			for (const val of list.values) uniforms.push(val);
		} else if (list.name === "m_UniformExModelInfoList") {
			for (const val of list.values) exModels.push(val);
		} else if (list.name === "m_UniformExInfoList") {
			for (const val of list.values) exUniforms.push(val);
		} else if (list.name === "m_CharaUniformExInfoList") {
			for (const val of list.values) charaExUniforms.push(val);
		}
	}
	return { models, uniforms, exModels, exUniforms, charaExUniforms };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadUniformConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("character", "uniform_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/character", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildUniformDatabase(dataPath: string = DATA_ROOT): Promise<UniformDatabase> {
	const result = await loadUniformConfigAsync(dataPath);
	const models = result?.models || [];
	const uniforms = result?.uniforms || [];
	const exModels = result?.exModels || [];
	const exUniforms = result?.exUniforms || [];
	const charaExUniforms = result?.charaExUniforms || [];

	const byTypeId = new Map<number, UniformModelInfo[]>();
	for (const m of models) {
		const arr = byTypeId.get(m.typeId) || [];
		arr.push(m);
		byTypeId.set(m.typeId, arr);
	}

	return { models, uniforms, exModels, exUniforms, charaExUniforms, byTypeId };
}

// ============================================================================
// Lignes plates (push-ready)
// ============================================================================

/**
 * Une ligne d'uniforme nommé, prête à être persistée.
 * - nameId       : CRC du libellé (clé primaire stable).
 * - modelStart   : index de départ dans m_UniformModelInfoList.
 * - modelCount   : nombre de modèles consécutifs rattachés à cet uniforme.
 * - typeId       : typeId du premier modèle de la tranche (0 = standard…).
 * - models       : les objets UniformModelInfo réels de la tranche.
 */
export interface UniformRow {
	nameId: string;
	modelStart: number;
	modelCount: number;
	typeId: number | null;
	models: UniformModelInfo[];
}

/**
 * Résout chaque entrée nommée de m_UniformInfoList en joignant sa tranche
 * `modelInfo = [start, count]` aux objets réels de m_UniformModelInfoList.
 * 100% dérivé du config — aucune valeur fabriquée.
 */
export function resolveUniformRows(db: UniformDatabase): UniformRow[] {
	const rows: UniformRow[] = [];
	for (const u of db.uniforms) {
		const mi = u.modelInfo;
		if (!Array.isArray(mi) || mi.length < 2) continue;
		const [start, count] = mi;
		const slice = db.models.slice(start, start + count);
		rows.push({
			nameId: u.nameId,
			modelStart: start,
			modelCount: count,
			typeId: slice[0]?.typeId ?? null,
			models: slice,
		});
	}
	return rows;
}
