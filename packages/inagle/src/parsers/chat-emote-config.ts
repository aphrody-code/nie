/**
 * @file chat-emote-config.ts
 * @description Parser for chat emote/stamp configuration
 *
 * Data source: chat_emote/chat_emote_config_*.cfg.bin.json
 *
 * Structure (lists format):
 * - m_ChatEmoteInfoList: Emote entries
 *   Fields: id, flag_idx, sort_id, type, texFilePath, texName, text_id,
 *           stamp_idx, motion_id, motion_loop, se_id, se_sub_id, enable_cond
 *
 * Note: texFilePath contains a sentinel value (CHAT_EMOTE_CONFIG).
 * Actual stamp images are referenced in menu setting configs with pattern:
 * #/menu/220_img/stamp_img/<LG>/emote_img{category}_{index}.g4tx
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedChatEmote extends ExportableEntity {
	emoteId: string;
	flagIdx: number;
	sortId: number;
	type: number;
	textId: string;
	stampIdx: number;
	motionId: string;
	motionLoop: boolean;
	enableCond: string;
}

export interface ChatEmoteDatabase {
	emotes: ParsedChatEmote[];
	byId: Map<string, ParsedChatEmote>;
	byType: Map<number, ParsedChatEmote[]>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedChatEmote[] {
	const emotes: ParsedChatEmote[] = [];
	if (!content?.lists) return emotes;

	for (const list of content.lists) {
		if (list.name === "m_ChatEmoteInfoList") {
			for (const val of list.values) {
				emotes.push({
					id: val.id,
					name: val.id,
					emoteId: val.id,
					flagIdx: val.flag_idx ?? 0,
					sortId: val.sort_id ?? 0,
					type: val.type ?? 0,
					textId: val.text_id || "0x00000000",
					stampIdx: val.stamp_idx ?? 0,
					motionId: val.motion_id || "0x00000000",
					motionLoop: val.motion_loop ?? false,
					enableCond: val.enable_cond || "",
					attributes: {
						Type: val.type,
						SortId: val.sort_id,
						StampIdx: val.stamp_idx,
					},
				});
			}
		}
	}
	return emotes;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadChatEmoteConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedChatEmote[] | null> {
	const filename = findConfigFile("chat_emote", "chat_emote_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/chat_emote", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildChatEmoteDatabase(
	dataPath: string = DATA_ROOT
): Promise<ChatEmoteDatabase> {
	const emotes = (await loadChatEmoteConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedChatEmote>();
	const byType = new Map<number, ParsedChatEmote[]>();

	for (const e of emotes) {
		byId.set(e.emoteId, e);
		const t = byType.get(e.type) || [];
		t.push(e);
		byType.set(e.type, t);
	}

	return {
		emotes,
		byId,
		byType,
		toMarkdown: (id: string) => {
			const e = byId.get(id);
			return e ? EntityExporters.toMarkdown(e, "Emote") : null;
		},
		toReact: (id: string) => {
			const e = byId.get(id);
			return e ? EntityExporters.toReact(e) : null;
		},
	};
}
