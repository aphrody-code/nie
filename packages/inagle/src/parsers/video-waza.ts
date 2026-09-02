/**
 * @file video-waza.ts
 * @description Parser pour les vidéos d'événement (cinématiques / movies IEVR).
 *
 * Source de données : event/event_movie_config_*.cfg.bin.json
 *
 * Structure (format `lists`), 3 listes dans le même fichier :
 *  - m_EventMovieInfoList (EVENT_MOVIE_INFO) — liste principale, 1 entrée par
 *    cinématique : eventId, menuId, captionId, moviePath (.usm), bgmName,
 *    fedeInTime, fedeOutTime, staffrollDataName.
 *  - m_EventSubtitleMenuDataList (EVENT_SUBTITLE_MENU_DATA) — métadonnées de
 *    sous-titres (subtitleId + CRCs de menu/layer/textLocate/usedGroup).
 *  - m_EventSongCaptionDataList (EVENT_SONG_CAPTION_DATA) — légendes/telops de
 *    chanson (captionId, startFrame, endFrame, captionName).
 *
 * La ligne pivot est l'entrée movie (eventId stable). Les sous-titres et
 * légendes liés par captionId sont attachés à chaque movie ; les listes brutes
 * complètes restent disponibles dans `subtitles` / `captions` du résultat.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types — portés 1:1 du layout réel du config
// ============================================================================

/** Entrée de la liste m_EventMovieInfoList (EVENT_MOVIE_INFO). */
export interface EventMovieInfo {
	eventId: string;
	menuId: string;
	captionId: string;
	moviePath: string;
	bgmName: string;
	fedeInTime: number;
	fedeOutTime: number;
	staffrollDataName: string;
}

/** Entrée de la liste m_EventSubtitleMenuDataList (EVENT_SUBTITLE_MENU_DATA). */
export interface EventSubtitleMenuData {
	subtitleId: string;
	menuCrc: string;
	layerCrc: string;
	textLocateCrc: string;
	usedGroupCrc: string;
}

/** Entrée de la liste m_EventSongCaptionDataList (EVENT_SONG_CAPTION_DATA). */
export interface EventSongCaptionData {
	captionId: string;
	startFrame: number;
	endFrame: number;
	captionName: string;
}

/** Vidéo d'événement résolue (movie + caption liée éventuelle). */
export interface ParsedVideoWaza {
	/** Clé primaire stable = eventId (hex). */
	id: string;
	eventId: string;
	menuId: string;
	captionId: string;
	moviePath: string;
	bgmName: string;
	fedeInTime: number;
	fedeOutTime: number;
	staffrollDataName: string;
	/** Légende de chanson liée par captionId (si présente dans le config). */
	caption: EventSongCaptionData | null;
}

export interface VideoWazaDatabase {
	videos: ParsedVideoWaza[];
	subtitles: EventSubtitleMenuData[];
	captions: EventSongCaptionData[];
	byId: Map<string, ParsedVideoWaza>;
}

// ============================================================================
// Parser
// ============================================================================

function getList(content: any, name: string): any[] {
	if (!content?.lists) return [];
	const list = content.lists.find((l: any) => l.name === name);
	return Array.isArray(list?.values) ? list.values : [];
}

export function parseVideoWazaContent(content: any): VideoWazaDatabase {
	const movies = getList(content, "m_EventMovieInfoList") as EventMovieInfo[];
	const subtitles = getList(content, "m_EventSubtitleMenuDataList") as EventSubtitleMenuData[];
	const captions = getList(content, "m_EventSongCaptionDataList") as EventSongCaptionData[];

	const captionById = new Map<string, EventSongCaptionData>();
	for (const c of captions) captionById.set(c.captionId, c);

	const videos: ParsedVideoWaza[] = [];
	const byId = new Map<string, ParsedVideoWaza>();

	for (const m of movies) {
		const video: ParsedVideoWaza = {
			id: m.eventId,
			eventId: m.eventId,
			menuId: m.menuId,
			captionId: m.captionId,
			moviePath: m.moviePath,
			bgmName: m.bgmName,
			fedeInTime: m.fedeInTime,
			fedeOutTime: m.fedeOutTime,
			staffrollDataName: m.staffrollDataName,
			caption: m.captionId && m.captionId !== "0x00000000"
				? (captionById.get(m.captionId) ?? null)
				: null,
		};
		videos.push(video);
		byId.set(video.id, video);
	}

	return { videos, subtitles, captions, byId };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadVideoWazaConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<VideoWazaDatabase | null> {
	const filename = findConfigFile("event", "event_movie_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/event", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseVideoWazaContent(content) : null;
}

export async function buildVideoWazaDatabase(
	dataPath: string = DATA_ROOT
): Promise<VideoWazaDatabase> {
	const db = await loadVideoWazaConfigAsync(dataPath);
	return db ?? { videos: [], subtitles: [], captions: [], byId: new Map() };
}
