/**
 * @file dictionary-config.ts
 * @description Parser for in-game dictionary/collection data
 *
 * Data source: dictionary/dictionary_config_0.00.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_HabitatList: Habitats/locations (43 entries)
 * - m_ObservationDataList: Observation data (280 entries)
 * - m_ParamList: Param data (280 entries)
 * - m_ObservationActionIdList: Action IDs (178 entries)
 * - m_ObservationActionPlayList: Action play data (94 entries)
 * - m_ObservationActionDataList: Action data (28 entries)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface DictionaryHabitat {
	habitatId: string;
	mapId: string;
	mapNameId: string;
	fileName: string;
	textureNameCrc: string;
	isShowAreaTexture: boolean;
}

export interface DictionaryObservation {
	[key: string]: any;
}

export interface DictionaryDatabase {
	habitats: DictionaryHabitat[];
	observations: DictionaryObservation[];
	params: any[];
	actionIds: any[];
	actionPlays: any[];
	actionData: any[];
	byHabitatId: Map<string, DictionaryHabitat>;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const habitats: DictionaryHabitat[] = [];
	const observations: DictionaryObservation[] = [];
	const params: any[] = [];
	const actionIds: any[] = [];
	const actionPlays: any[] = [];
	const actionData: any[] = [];

	if (!content?.lists)
		return { habitats, observations, params, actionIds, actionPlays, actionData };

	for (const list of content.lists) {
		if (list.name === "m_HabitatList") {
			for (const val of list.values || []) {
				habitats.push({
					habitatId: val.habitatID,
					mapId: val.mapID,
					mapNameId: val.mapNameID,
					fileName: val.fileName,
					textureNameCrc: val.textureNameCrc,
					isShowAreaTexture: val.isShowAreaTexture,
				});
			}
		} else if (list.name === "m_ObservationDataList") {
			for (const val of list.values || []) observations.push(val);
		} else if (list.name === "m_ParamList") {
			for (const val of list.values || []) params.push(val);
		} else if (list.name === "m_ObservationActionIdList") {
			for (const val of list.values || []) actionIds.push(val);
		} else if (list.name === "m_ObservationActionPlayList") {
			for (const val of list.values || []) actionPlays.push(val);
		} else if (list.name === "m_ObservationActionDataList") {
			for (const val of list.values || []) actionData.push(val);
		}
	}
	return { habitats, observations, params, actionIds, actionPlays, actionData };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadDictionaryConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("dictionary", "dictionary_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/dictionary", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildDictionaryDatabase(
	dataPath: string = DATA_ROOT
): Promise<DictionaryDatabase> {
	const result = await loadDictionaryConfigAsync(dataPath);
	const habitats = result?.habitats || [];
	const observations = result?.observations || [];
	const params = result?.params || [];
	const actionIds = result?.actionIds || [];
	const actionPlays = result?.actionPlays || [];
	const actionData = result?.actionData || [];

	const byHabitatId = new Map<string, DictionaryHabitat>();
	for (const h of habitats) byHabitatId.set(h.habitatId, h);

	return { habitats, observations, params, actionIds, actionPlays, actionData, byHabitatId };
}
