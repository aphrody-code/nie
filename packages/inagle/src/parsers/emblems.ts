/**
 * @file emblems.ts
 * @description Parseur des emblèmes (écussons d'équipe) IEVR.
 *
 * Source de données : menu/emblem_resource_*.cfg.bin.json
 *
 * Structure réelle (format `lists`, vérifiée octet pour octet contre le .bin) :
 * - m_EmblemResourceInfoList (typeName EMBLEM_RESOURCE_INFO) : 1 entrée par emblème
 *   Champs : emblemId, emblemName, s_filePath, s_texName, l_filePath, l_texName
 * - m_EmblemResourceBasePathList (typeName EMBLEM_RESOURCE_BASE_PATH) : chemin de base commun
 *   Champ : basePath  (ex. "#/menu/")
 *
 * Le champ `<resourceID>` présent dans l'entrée "default" est un gabarit (template) :
 * les autres entrées substituent emblemName à <resourceID> dans les chemins de texture.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedEmblem extends ExportableEntity {
	emblemId: string;
	emblemName: string;
	/** Chemin de la petite texture (relatif au basePath). */
	smallFilePath: string;
	/** Nom de la petite texture g4tx. */
	smallTexName: string;
	/** Chemin de la grande texture (relatif au basePath). */
	largeFilePath: string;
	/** Nom de la grande texture g4tx. */
	largeTexName: string;
	/** Chemin de base commun à toutes les ressources d'emblème. */
	basePath: string;
	/** true pour l'entrée gabarit "default" (chemins avec <resourceID>). */
	isTemplate: boolean;
}

export interface EmblemDatabase {
	emblems: ParsedEmblem[];
	byId: Map<string, ParsedEmblem>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedEmblem[] {
	const emblems: ParsedEmblem[] = [];
	if (!content?.lists) return emblems;

	// Récupère le chemin de base (liste séparée, 1 entrée).
	let basePath = "";
	for (const list of content.lists) {
		if (list.name === "m_EmblemResourceBasePathList") {
			basePath = list.values?.[0]?.basePath || "";
		}
	}

	for (const list of content.lists) {
		if (list.name !== "m_EmblemResourceInfoList") continue;
		for (const val of list.values) {
			const emblemName: string = val.emblemName || "";
			const smallFilePath: string = val.s_filePath || "";
			const isTemplate = smallFilePath.includes("<resourceID>") || emblemName === "default";

			emblems.push({
				id: val.emblemId,
				name: emblemName || val.emblemId,
				emblemId: val.emblemId,
				emblemName,
				smallFilePath,
				smallTexName: val.s_texName || "",
				largeFilePath: val.l_filePath || "",
				largeTexName: val.l_texName || "",
				basePath,
				isTemplate,
				attributes: {
					EmblemName: emblemName,
					BasePath: basePath,
					Image: val.l_filePath || "",
				},
			});
		}
	}
	return emblems;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadEmblemConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedEmblem[] | null> {
	const filename = findConfigFile("menu", "emblem_resource");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/menu", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildEmblemDatabase(dataPath: string = DATA_ROOT): Promise<EmblemDatabase> {
	const emblems = (await loadEmblemConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedEmblem>();
	for (const e of emblems) byId.set(e.emblemId, e);

	return {
		emblems,
		byId,
		toMarkdown: (id: string) => {
			const e = byId.get(id);
			return e ? EntityExporters.toMarkdown(e, "Emblème") : null;
		},
		toReact: (id: string) => {
			const e = byId.get(id);
			return e ? EntityExporters.toReact(e) : null;
		},
	};
}
