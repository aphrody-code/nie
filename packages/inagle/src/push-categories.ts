/**
 * @file push-categories.ts
 * @description Importers réutilisables pour les catégories câblées tardivement
 * (uniforms, shops, tricks, special_tactics, telop_waza, video_waza, emblems).
 *
 * Source de vérité UNIQUE : ces fonctions sont appelées par le flux principal
 * `cli-push.ts` (séquence de push) ET par les scripts standalone
 * `scripts/push-<cat>.ts` (qui ne font que créer l'adaptateur Supabase et lancer
 * l'importer). Vivent sous `src/` pour rester dans le `rootDir` du build TS.
 *
 * 100% dérivé des octets RÉELS du dump (/home/ubuntu/niers/data) via les parseurs
 * `src/parsers/*`. Aucune valeur fabriquée. Tous les upserts sont idempotents
 * (ON CONFLICT sur la clé primaire de chaque table).
 */

import { resolve } from "node:path";
import { toHex } from "./core/data-loader.js";
import { createInagleService } from "./index.js";
import { loadAbilityLearningConfig } from "./parsers/ability-learning.js";
import { buildActivityPhotoDatabase } from "./parsers/activity-photo-config.js";
import { buildBoostPlayerGroupDatabase } from "./parsers/boost-player-group-config.js";
import { buildCharaExpTableDatabase } from "./parsers/chara-exp-table.js";
import { buildCharaMenuResourceDatabase } from "./parsers/chara-menu-resource-config.js";
import { buildChatEmoteDatabase } from "./parsers/chat-emote-config.js";
import { getAllConstellations } from "./parsers/constellation.js";
import { loadAllDropRates } from "./parsers/drop-rates.js";
import { buildEmblemDatabase } from "./parsers/emblems.js";
import { buildEnjoyModeTeamDatabase } from "./parsers/enjoy-mode-team-config.js";
import { parseAllEventAggregates, parseAllEventSubtitles } from "./parsers/event-subtitles.js";
import { buildFormationDatabase } from "./parsers/formation-config.js";
import { buildMissionDatabase } from "./parsers/mission-config.js";
import { buildNameplateDatabase } from "./parsers/nameplate-config.js";
import { buildNfcLotteryDatabase } from "./parsers/nfc-lottery-config.js";
import { buildOverrideSkillDatabase } from "./parsers/override-skill-config.js";
import { buildPassiveSkillEffectDatabase } from "./parsers/passive-skill-effect-config.js";
import { buildPerformanceDatabase } from "./parsers/performance-config.js";
import { buildPhaseTitleDatabase } from "./parsers/phase-title-config.js";
import { buildSceneArchiveDatabase } from "./parsers/scene-archive-config.js";
import { loadShopConfig } from "./parsers/shop-config.js";
import { buildSkillTechnicDatabase } from "./parsers/skill-technic-config.js";
import { buildSpecialTacticsDatabase } from "./parsers/special-tactics-config.js";
import { buildStadiumDatabase } from "./parsers/stadium-config.js";
import { buildStarSignMap, type StarSignCharaInfo } from "./parsers/star-sign.js";
import { buildSuperTacticsBaseDatabase } from "./parsers/super-tactics-base-config.js";
import { buildTeamBuildDatabase } from "./parsers/team-build-config.js";
import { buildTelopWazaDatabase } from "./parsers/telop-waza.js";
import { loadTextFile } from "./parsers/text-parser.js";
import { buildTrickDatabase } from "./parsers/trick-config.js";
import { buildTrophyDatabase, type ParsedTrophy } from "./parsers/trophy-config.js";
import { buildUniformDatabase, resolveUniformRows } from "./parsers/uniform-config.js";
import { buildVideoWazaDatabase } from "./parsers/video-waza.js";
import { dedup, type DataAdapter } from "./push-adapter.js";

const DATA_PATH = process.env.DATA_PATH || "/home/ubuntu/niers/data";

/** Ligne prête à être poussée (colonnes SQL → valeurs sérialisables). */
type LignePoussee = Record<string, unknown>;

/**
 * Upsert par lots — factorise le découpage répété par chaque importer (Supabase
 * REST plafonne la taille des payloads, Postgres le nombre de paramètres).
 * Renvoie le nombre de lignes réellement écrites.
 */
async function pousserParLots(
	db: DataAdapter,
	table: string,
	lignes: LignePoussee[],
	onConflict: string,
	taille = 200
): Promise<number> {
	let pousse = 0;
	for (let i = 0; i < lignes.length; i += taille) {
		const lot = lignes.slice(i, i + taille);
		const { error } = await db.upsert(table, lot, onConflict);
		if (error) {
			const message = (error as { message?: string }).message ?? JSON.stringify(error);
			console.error(`❌ Erreur lot ${table} [${i}..${i + lot.length}] :`, message);
		} else {
			pousse += lot.length;
		}
	}
	return pousse;
}

/**
 * Garde-fou anti-fabrication commun : si le parseur ne rend rien, on n'écrit
 * RIEN (surtout pas une table vide qui ferait croire à une couverture réelle).
 */
function sourceVide(table: string, source: string): void {
	console.error(
		`❌ 0 entrée parsée pour ${table} — ${source} introuvable ou vide (DATA_PATH=${DATA_PATH}). Rien poussé.`
	);
}

// === uniforms → inagle_uniforms (ON CONFLICT name_id) ===

export async function importUniforms(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Uniforms...");
	const uniformDb = await buildUniformDatabase();
	const rows = resolveUniformRows(uniformDb);

	if (rows.length === 0) {
		console.error(
			"❌ 0 uniforme résolu — vérifier DATA_PATH et character/uniform_config (parse à vide)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records = rows.map((r) => ({
		name_id: r.nameId,
		model_start: r.modelStart,
		model_count: r.modelCount,
		type_id: r.typeId,
		models: r.models,
		data: r,
		updated_at: now,
	}));

	const BATCH_SIZE = 200;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_uniforms", batch, "name_id");
		if (error) console.error("❌ Error batch uniforms:", error.message || error);
		else pushed += batch.length;
	}
	console.log(`✅ Uniforms imported (${pushed}/${records.length}).`);
}

// === shops → inagle_shops (ON CONFLICT id = "<shopId>:<itemId>") ===

export async function importShops(service: any, db: DataAdapter) {
	console.log("🔄 Importing Shops...");

	const shops = loadShopConfig(DATA_PATH);
	if (shops.length === 0) {
		console.error(`❌ Aucun shop parsé depuis ${DATA_PATH} — shop_config introuvable ou vide.`);
		return;
	}

	// Noms de shop localisés (shop_text fr/en/ja), indexés par hash hex.
	const shopFr = loadTextFile("shop", "fr");
	const shopEn = loadTextFile("shop", "en");
	const shopJa = loadTextFile("shop", "ja");

	// Items résolus depuis le service inagle (table items réelle), indexés par hex.
	const svc = service ?? (await createInagleService());
	const itemsByHex = new Map<
		string,
		{ id: string; fr: string | null; en: string | null; ja: string | null }
	>();
	for (const it of svc.items.allItems() as any[]) {
		const id = it.itemId || it.id;
		if (!id) continue;
		itemsByHex.set(String(id).toLowerCase(), {
			id: String(id),
			fr: it.names?.fr ?? null,
			en: it.names?.en ?? null,
			ja: it.names?.ja ?? null,
		});
	}

	// Construction des lignes (1 par shop × item).
	const rows: Record<string, unknown>[] = [];
	const updatedAt = new Date().toISOString();
	let resolvedShops = 0;
	let resolvedItems = 0;

	for (const shop of shops) {
		const nameHex = toHex(shop.nameHash);
		const nameFr = shopFr.get(nameHex) ?? null;
		const nameEn = shopEn.get(nameHex) ?? null;
		const nameJa = shopJa.get(nameHex) ?? null;
		if (nameFr || nameEn || nameJa) resolvedShops++;

		let slot = 0;
		for (const itemId of shop.items) {
			const itemHex = toHex(itemId);
			const resolved = itemsByHex.get(itemHex.toLowerCase());
			if (resolved) resolvedItems++;

			rows.push({
				id: `${shop.shopId}:${itemId}`,
				shop_id: shop.shopId,
				name_hash: shop.nameHash,
				name_fr: nameFr,
				name_en: nameEn,
				name_ja: nameJa,
				item_id: itemId,
				item_hex: itemHex,
				item_name_fr: resolved?.fr ?? null,
				item_name_en: resolved?.en ?? null,
				item_name_ja: resolved?.ja ?? null,
				item_db_id: resolved?.id ?? null,
				slot_index: slot,
				data: { shopId: shop.shopId, nameHash: shop.nameHash, itemId, itemHex },
				updated_at: updatedAt,
			});
			slot++;
		}
	}

	console.log(
		`   ↳ ${shops.length} shops, ${rows.length} lignes (shop×item). ` +
			`Shops nommés: ${resolvedShops}/${shops.length}. ` +
			`Items résolus: ${resolvedItems}/${rows.length}.`
	);

	const BATCH_SIZE = 500;
	let pushed = 0;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_shops", batch, "id");
		if (error) console.error("❌ Error batch shops:", error.message || error);
		else pushed += batch.length;
	}

	console.log(`✅ Shops imported (${pushed}/${rows.length}).`);
}

// === tricks → inagle_tricks (ON CONFLICT id = trickID hex) ===

export async function importTricks(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Tricks...");
	const trickDb = await buildTrickDatabase();

	if (trickDb.tricks.length === 0) {
		console.error(
			"❌ 0 trick parsé — dump introuvable ? (DATA_PATH/DATA_ROOT doit pointer sur /home/ubuntu/niers/data)"
		);
		return;
	}

	const now = new Date().toISOString();
	const records = trickDb.tricks.map((t) => ({
		id: t.trickId,
		trick_id_name: t.trickIdName,
		event_id: t.eventId,
		event_id_name: t.eventIdName,
		fail_event_id: t.failEventId,
		fail_event_id_name: t.failEventIdName,
		name_ja: t.trickNameJa,
		trick_category: t.trickCategory,
		trick_category_name: t.trickCategoryName,
		data: t,
		updated_at: now,
	}));

	// Dédup par clé primaire (sécurité — le config en a 9 distincts).
	const byId = new Map<string, (typeof records)[number]>();
	for (const r of records) byId.set(r.id, r);
	const deduped = [...byId.values()];

	const { error } = await db.upsert("inagle_tricks", deduped, "id");
	if (error) console.error("❌ Error tricks:", error.message || error);
	else console.log(`✅ Tricks imported (${deduped.length}).`);
}

// === special_tactics → inagle_special_tactics (ON CONFLICT id = tacticsId hex) ===

export async function importSpecialTactics(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Special Tactics...");
	const dataPath = process.env.DATA_PATH ? resolve(process.env.DATA_PATH) : "/home/ubuntu/niers/data";

	const tacticsDb = await buildSpecialTacticsDatabase(dataPath);
	if (tacticsDb.tactics.length === 0) {
		console.error(
			"❌ Parseur a renvoyé 0 tactique — config introuvable ou vide. Abandon (anti-fabrication)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records = tacticsDb.tactics.map((t) => ({
		id: t.id, // tacticsId hex (clé primaire stable)
		internal_code: t.internalCode || null,
		name_fr: t.names.fr ?? null,
		name_en: t.names.en ?? null,
		name_ja: t.names.ja ?? null,
		description_fr: t.descriptions.fr ?? null,
		description_en: t.descriptions.en ?? null,
		description_ja: t.descriptions.ja ?? null,
		power: t.power,
		recast_time: t.recastTime,
		element_id: t.element,
		element: t.elementName,
		partner_count: t.partnerIds.length,
		partner_ids: t.partnerIds,
		data: {
			effectRef: t.effectRef ?? null,
			condRef: t.condRef ?? null,
			successCondRef: t.successCondRef ?? null,
		},
		updated_at: now,
	}));

	// Garde-fou unicité (la clé primaire est déjà unique côté DB).
	const byId = new Map<string, (typeof records)[number]>();
	for (const r of records) byId.set(r.id, r);
	const unique = Array.from(byId.values());

	const BATCH_SIZE = 100;
	let pushed = 0;
	for (let i = 0; i < unique.length; i += BATCH_SIZE) {
		const batch = unique.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_special_tactics", batch, "id");
		if (error) console.error("❌ Error batch special_tactics:", error.message || error);
		else pushed += batch.length;
	}

	console.log(
		`✅ Special Tactics imported (${pushed}/${unique.length}, parsées ${tacticsDb.tactics.length}).`
	);
}

// === telop_waza → inagle_telop_waza (ON CONFLICT skill_id) ===

export async function importTelopWaza(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Telop Waza...");
	const telopDb = await buildTelopWazaDatabase();
	console.log(`   ↳ Config parsé: ${telopDb.telops.length} télops de skill.`);

	if (telopDb.telops.length === 0) {
		console.error(
			"❌ Aucun télop parsé — vérifier DATA_PATH / skill_telop_info_config. Abandon (rien poussé)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records = telopDb.telops.map((t) => ({
		skill_id: t.skillId,
		blank_left_index: t.blankLeftIndex,
		blank_right_index: t.blankRightIndex,
		eldorado_id: t.eldoradoId,
		left_blanks: t.left,
		right_blanks: t.right,
		data: t,
		updated_at: now,
	}));

	const BATCH_SIZE = 100;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_telop_waza", batch, "skill_id");
		if (error) console.error("❌ Error batch telop_waza:", error.message || error);
		else pushed += batch.length;
	}

	console.log(`✅ Telop Waza imported (${pushed}/${records.length}).`);
}

// === video_waza → inagle_video_waza (ON CONFLICT id = eventId hex) ===

export async function importVideoWaza(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Video Waza...");
	const videoDb = await buildVideoWazaDatabase();
	console.log(
		`   ↳ Config parsé: ${videoDb.videos.length} vidéos, ${videoDb.subtitles.length} sous-titres, ${videoDb.captions.length} légendes.`
	);

	if (videoDb.videos.length === 0) {
		console.error(
			"❌ Aucune vidéo parsée — vérifier DATA_PATH / event_movie_config. Abandon (rien poussé)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records = videoDb.videos.map((v) => ({
		id: v.id,
		event_id: v.eventId,
		menu_id: v.menuId,
		caption_id: v.captionId,
		movie_path: v.moviePath,
		bgm_name: v.bgmName,
		fede_in_time: v.fedeInTime,
		fede_out_time: v.fedeOutTime,
		staffroll_data_name: v.staffrollDataName,
		caption_name: v.caption?.captionName ?? null,
		caption_start_frame: v.caption?.startFrame ?? null,
		caption_end_frame: v.caption?.endFrame ?? null,
		data: v,
		updated_at: now,
	}));

	const BATCH_SIZE = 100;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_video_waza", batch, "id");
		if (error) console.error("❌ Error batch video_waza:", error.message || error);
		else pushed += batch.length;
	}

	console.log(`✅ Video Waza imported (${pushed}/${records.length}).`);
}

// === emblems → inagle_emblems (ON CONFLICT emblem_id) ===

export async function importEmblems(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Emblems...");
	const emblemDb = await buildEmblemDatabase();

	if (emblemDb.emblems.length === 0) {
		console.error("❌ Aucun emblème parsé — config introuvable ou vide. Abandon.");
		return;
	}

	const now = new Date().toISOString();
	const records = emblemDb.emblems.map((e) => ({
		emblem_id: e.emblemId,
		emblem_name: e.emblemName,
		small_file_path: e.smallFilePath || null,
		small_tex_name: e.smallTexName || null,
		large_file_path: e.largeFilePath || null,
		large_tex_name: e.largeTexName || null,
		base_path: e.basePath || null,
		is_template: e.isTemplate,
		data: e,
		updated_at: now,
	}));

	console.log(
		`   ↳ ${records.length} emblèmes prêts (dont ${records.filter((r) => r.is_template).length} gabarit).`
	);

	const { error } = await db.upsert("inagle_emblems", records, "emblem_id");
	if (error) console.error("❌ Error emblems:", error.message || error);
	else console.log(`✅ Emblems imported (${records.length}).`);
}

// === super_tactics → inagle_super_tactics (ON CONFLICT id = "<kind>:<idx>") ===

export async function importSuperTactics(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Super Tactics...");
	const parsed = await buildSuperTacticsBaseDatabase(DATA_PATH);
	const effects = parsed.effects || [];
	const tactics = parsed.tactics || [];

	if (effects.length === 0 && tactics.length === 0) {
		console.error(
			`❌ Parser super_tactics n'a produit AUCUNE entrée (DATA_PATH=${DATA_PATH}). Source réelle introuvable ou vide — abandon (pas de table fabriquée).`
		);
		return;
	}

	const now = new Date().toISOString();
	const rows: any[] = [];

	effects.forEach((eff, idx) => {
		rows.push({
			id: `effect:${idx}`,
			kind: "effect",
			idx,
			crc_id: eff.effectId,
			conditions: eff.conditions ?? [],
			data: eff,
			updated_at: now,
		});
	});

	tactics.forEach((tac, idx) => {
		rows.push({
			id: `tactic:${idx}`,
			kind: "tactic",
			idx,
			crc_id: tac.id ?? "",
			conditions: null,
			data: tac,
			updated_at: now,
		});
	});

	const deduped = dedup(rows, "id");
	const { error } = await db.upsert("inagle_super_tactics", deduped, "id");
	if (error) console.error("❌ Error super_tactics:", error.message || error);
	else
		console.log(
			`✅ Super Tactics imported (${deduped.length} — ${effects.length} effects + ${tactics.length} tactics).`
		);
}

// === skill_technic → inagle_skill_technic (ON CONFLICT id = hash hex) ===

export async function importSkillTechnic(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Skill Technic...");
	const technicDb = await buildSkillTechnicDatabase(process.env.DATA_PATH);
	const technics = technicDb.technics;

	if (technics.length === 0) {
		console.error(
			"❌ 0 technic résolu — vérifier DATA_PATH et skill/skill_technic_config (parse à vide)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records = technics.map((t) => ({
		id: t.id,
		win_sub_motion_name_crc: t.winSubMotionNameCrc,
		lose_sub_motion_name_crc: t.loseSubMotionNameCrc,
		lose_type: t.loseType,
		formation_type: t.formationType,
		formation_chara_len: t.formationCharaLen,
		shoot_curve_mid_rate: t.shootCurveMidRate,
		shoot_curve_height_rate: t.shootCurveHeightRate,
		shoot_curve_angle: t.shootCurveAngle,
		data: t,
		updated_at: now,
	}));

	// Dédup défensif sur la PK (id hex), au cas où un dump dupliquerait une entrée.
	const deduped = dedup(records, "id");

	const BATCH_SIZE = 200;
	let pushed = 0;
	for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
		const batch = deduped.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_skill_technic", batch, "id");
		if (error) console.error("❌ Error batch skill_technic:", error.message || error);
		else pushed += batch.length;
	}
	console.log(`✅ Skill Technic imported (${pushed}/${deduped.length}).`);
}

// === team_build → inagle_team_build (ON CONFLICT id = "<section>:<index>") ===

export async function importTeamBuild(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Team Build...");
	const teamBuildDb = await buildTeamBuildDatabase(DATA_PATH);

	const total =
		teamBuildDb.effectData.length +
		teamBuildDb.effectInfos.length +
		teamBuildDb.upData.length +
		teamBuildDb.downData.length +
		teamBuildDb.buildInfos.length;

	if (total === 0) {
		console.error(
			"❌ 0 entrée team_build — vérifier DATA_PATH et skill/team_build_config_*.cfg.bin.json (parse à vide)."
		);
		return;
	}

	const now = new Date().toISOString();
	const records: Record<string, unknown>[] = [];

	teamBuildDb.effectData.forEach((r, i) => {
		records.push({
			id: `effect_data:${i}`,
			section: "effect_data",
			idx: i,
			effect_id: r.effectId,
			effect_ref_id: null,
			type: null,
			threshold: r.threshold,
			value: r.value,
			multiplier: null,
			build_type: null,
			build_level: null,
			data: r,
			updated_at: now,
		});
	});

	teamBuildDb.effectInfos.forEach((r, i) => {
		records.push({
			id: `effect_info:${i}`,
			section: "effect_info",
			idx: i,
			effect_id: null,
			effect_ref_id: null,
			type: null,
			threshold: null,
			value: null,
			multiplier: null,
			build_type: null,
			build_level: null,
			data: r,
			updated_at: now,
		});
	});

	teamBuildDb.upData.forEach((r, i) => {
		records.push({
			id: `up_data:${i}`,
			section: "up_data",
			idx: i,
			effect_id: null,
			effect_ref_id: r.effectRefId,
			type: r.type,
			threshold: r.threshold,
			value: null,
			multiplier: r.multiplier,
			build_type: null,
			build_level: null,
			data: r,
			updated_at: now,
		});
	});

	teamBuildDb.downData.forEach((r, i) => {
		records.push({
			id: `down_data:${i}`,
			section: "down_data",
			idx: i,
			effect_id: null,
			effect_ref_id: r.effectRefId,
			type: r.type,
			threshold: r.threshold,
			value: null,
			multiplier: r.multiplier,
			build_type: null,
			build_level: null,
			data: r,
			updated_at: now,
		});
	});

	teamBuildDb.buildInfos.forEach((r, i) => {
		records.push({
			id: `build_info:${i}`,
			section: "build_info",
			idx: i,
			effect_id: null,
			effect_ref_id: null,
			type: null,
			threshold: null,
			value: null,
			multiplier: null,
			build_type: r.buildType,
			build_level: r.buildLevel,
			data: r,
			updated_at: now,
		});
	});

	const BATCH_SIZE = 200;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_team_build", batch, "id");
		if (error) console.error("❌ Error batch team_build:", error.message || error);
		else pushed += batch.length;
	}
	console.log(`✅ Team Build imported (${pushed}/${records.length}).`);
}

// === boost_groups → inagle_boost_groups (ON CONFLICT id = "boost_grp_<index>") ===

export async function importBoostGroups(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Boost Groups...");
	const boostDb = await buildBoostPlayerGroupDatabase(DATA_PATH);

	if (boostDb.configs.length === 0) {
		console.error(
			`❌ Aucun groupe de config trouvé dans le dump (${DATA_PATH}). ` +
				"Source réelle absente ou vide — rien à pousser (aucune donnée fabriquée)."
		);
		return;
	}

	// Spirit table partagée (référence stable embarquée dans chaque ligne pour
	// traçabilité : index -> spiritId hash hex).
	const spiritById = boostDb.spiritTable;
	const idToSpirit = new Map(spiritById.map((s) => [s.index, s.spiritId]));

	const now = new Date().toISOString();
	const records = boostDb.configs.map((cfg, configIndex) => {
		const resolvedSpiritIds = cfg.spiritIndices.map((i) => idToSpirit.get(i) ?? null);
		return {
			id: `boost_grp_${configIndex}`,
			config_index: configIndex,
			duration: cfg.duration,
			spirit_indices: cfg.spiritIndices,
			resolved_spirit_ids: resolvedSpiritIds,
			data: {
				configIndex,
				duration: cfg.duration,
				spiritIndices: cfg.spiritIndices,
				resolvedSpiritIds,
				spiritTable: spiritById,
			},
			updated_at: now,
		};
	});

	const deduped = dedup(records, "id");
	const { error } = await db.upsert("inagle_boost_groups", deduped, "id");
	if (error) console.error("❌ Error boost_groups:", error.message || error);
	else
		console.log(
			`✅ Boost Groups imported (${deduped.length} — spiritTable: ${spiritById.length} entrées).`
		);
}

// === constellations → inagle_constellations (ON CONFLICT id = starNameHash hex) ===

export async function importConstellations(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Constellations...");
	const constellations = getAllConstellations();
	const records = constellations.map((c) => ({
		id: c.hashId, // PK stable (starNameHash hex)
		idx: c.index,
		name_fr: c.names.fr ?? null,
		name_en: c.names.en ?? null,
		name_ja: c.names.ja ?? null,
		character_count: c.characterCount,
		character_ids: c.characterIds,
		texture_star: c.textures.star ?? null,
		texture_star_after: c.textures.starAfter ?? null,
		texture_rare_star: c.textures.rareStar ?? null,
		texture_layer: c.textures.layer ?? null,
		data: c, // objet Constellation complet
		updated_at: new Date().toISOString(),
	}));

	const deduped = dedup(records, "id");
	if (deduped.length === 0) {
		console.error(
			"❌ Aucune constellation produite par le parseur " +
				"(source players_universe_config introuvable ou vide). Rien à pousser — table non peuplée à vide."
		);
		return;
	}

	const CHUNK = 500;
	let pushed = 0;
	for (let i = 0; i < deduped.length; i += CHUNK) {
		const chunk = deduped.slice(i, i + CHUNK);
		const { error } = await db.upsert("inagle_constellations", chunk, "id");
		if (error) console.error("❌ Error batch constellations:", error.message || error);
		else pushed += chunk.length;
	}
	console.log(`✅ Constellations imported (${pushed}/${deduped.length}).`);
}

// === star_signs → inagle_star_signs (ON CONFLICT chara_param_id) ===

export async function importStarSigns(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Star Signs...");
	const map = buildStarSignMap();
	const entries = [...map.values()];

	if (entries.length === 0) {
		console.error(
			"❌ Aucune entrée star-sign trouvée (source réelle absente). Abandon — pas de table fabriquée."
		);
		return;
	}

	const now = new Date().toISOString();
	const toRow = (e: StarSignCharaInfo) => ({
		chara_param_id: e.charaParamId,
		chara_rarity: e.charaRarity,
		rate_default: e.charaRateDefault,
		rate_boost_a: e.charaRateBoostA,
		rate_boost_b: e.charaRateBoostB,
		rate_boost_c: e.charaRateBoostC,
		rate_boost_d: e.charaRateBoostD,
		is_remarkable: e.isRemarkable,
		enable_cond: e.enableCond ?? "",
		// jsonb data complet = objet réel produit par le parseur (source de vérité)
		data: e,
		updated_at: now,
	});

	const rows = dedup(entries.map(toRow), "chara_param_id");

	const BATCH = 500;
	let pushed = 0;
	for (let i = 0; i < rows.length; i += BATCH) {
		const chunk = rows.slice(i, i + BATCH);
		const { error } = await db.upsert("inagle_star_signs", chunk, "chara_param_id");
		if (error) console.error("❌ Error batch star_signs:", error.message || error);
		else pushed += chunk.length;
	}
	console.log(`✅ Star Signs imported (${pushed}/${rows.length}).`);
}

// === trophies → inagle_trophies (ON CONFLICT trophy_id) ===

export async function importTrophies(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Trophies...");
	const { trophies } = buildTrophyDatabase(DATA_PATH);

	if (trophies.length === 0) {
		console.error(
			`❌ Aucune donnée trophée parsée depuis ${DATA_PATH} — rien à pousser (pas de fabrication).`
		);
		return;
	}

	const now = new Date().toISOString();
	const toRow = (t: ParsedTrophy) => ({
		trophy_id: t.trophyId,
		code: t.code,
		name_en: t.names.en ?? null,
		name_fr: t.names.fr ?? null,
		name_ja: t.names.ja ?? null,
		desc_en: t.descriptions.en ?? null,
		desc_fr: t.descriptions.fr ?? null,
		desc_ja: t.descriptions.ja ?? null,
		data: t,
		updated_at: now,
	});

	const rows = dedup(trophies.map(toRow), "trophy_id");

	const BATCH = 200;
	let pushed = 0;
	for (let i = 0; i < rows.length; i += BATCH) {
		const chunk = rows.slice(i, i + BATCH);
		const { error } = await db.upsert("inagle_trophies", chunk, "trophy_id");
		if (error) console.error("❌ Error batch trophies:", error.message || error);
		else pushed += chunk.length;
	}
	console.log(`✅ Trophies imported (${pushed}/${rows.length}).`);
}

// === missions → inagle_missions (ON CONFLICT mission_id) ===

export async function importMissions(_service: any, db: DataAdapter) {
	console.log("🔄 Importing Missions...");
	const { missions } = buildMissionDatabase(DATA_PATH);

	if (missions.length === 0) {
		console.error(
			`❌ 0 mission parsée depuis ${DATA_PATH} — mission_config introuvable ou vide. Rien poussé.`
		);
		return;
	}

	const now = new Date().toISOString();
	const records = missions.map((m) => ({
		mission_id: m.missionId,
		code: m.code,
		name_id: m.nameId,
		name_en: m.names.en ?? null,
		name_fr: m.names.fr ?? null,
		name_ja: m.names.ja ?? null,
		data: m,
		updated_at: now,
	}));

	const BATCH_SIZE = 200;
	let pushed = 0;
	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await db.upsert("inagle_missions", batch, "mission_id");
		if (error) console.error("❌ Error batch missions:", error.message || error);
		else pushed += batch.length;
	}
	console.log(`✅ Missions imported (${pushed}/${records.length}).`);
}

// ============================================================================
// Catégories câblées le 13/8/2026 — parseurs qui produisaient des données
// RÉELLES sans jamais atteindre la moindre table (audit du domaine inagle).
// Les tables ci-dessous existaient déjà en base : elles étaient peuplées par des
// scripts ponctuels disparus, donc figées depuis avril 2026. Elles rejoignent le
// flux `cli-push.ts` pour être reproductibles à chaque push.
// ============================================================================

// === activity_photos → inagle_activity_photos (ON CONFLICT id) ===

export async function importActivityPhotos(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Activity Photos...");
	const photoDb = await buildActivityPhotoDatabase(DATA_PATH);
	if (photoDb.rewards.length === 0) {
		sourceVide("inagle_activity_photos", "trophy/trophy_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = photoDb.rewards.map((r) => ({
		id: r.trophyIdHex,
		trophy_id_hex: r.trophyIdHex,
		reward: r.reward,
		// Chemin de base des visuels, tel que déclaré par TEXTURE_BASE_PATH_0.
		image_path: photoDb.basePath,
		data: r,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_activity_photos", dedup(lignes, "id"), "id");
	console.log(`✅ Activity Photos imported (${pousse}/${lignes.length}).`);
}

// === chara_menu_resource → inagle_chara_menu_resource (ON CONFLICT id) ===

export async function importCharaMenuResource(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Chara Menu Resource...");
	const resourceDb = await buildCharaMenuResourceDatabase(DATA_PATH);
	if (resourceDb.overrides.length === 0 && !resourceDb.template) {
		sourceVide("inagle_chara_menu_resource", "character/chara_menu_resource_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes: LignePoussee[] = resourceDb.overrides.map((o) => ({
		id: o.resourceId,
		is_template: o.isTemplate,
		paths: o.paths,
		data: o,
		updated_at: now,
	}));

	// Le gabarit (chemins avec le jeton <charaID>) est la clé de résolution de
	// TOUTES les icônes : sans lui, les overrides ne veulent rien dire.
	if (resourceDb.template) {
		lignes.push({
			id: "template",
			is_template: true,
			paths: resourceDb.template,
			data: { basePath: resourceDb.basePath, template: resourceDb.template },
			updated_at: now,
		});
	}

	const pousse = await pousserParLots(db, "inagle_chara_menu_resource", dedup(lignes, "id"), "id");
	console.log(`✅ Chara Menu Resource imported (${pousse}/${lignes.length}).`);
}

// === chat_emotes → inagle_chat_emotes (ON CONFLICT id) ===

export async function importChatEmotes(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Chat Emotes...");
	const emoteDb = await buildChatEmoteDatabase(DATA_PATH);
	if (emoteDb.emotes.length === 0) {
		sourceVide("inagle_chat_emotes", "chat/chat_emote_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = emoteDb.emotes.map((e) => ({
		id: e.emoteId,
		emote_id: e.emoteId,
		flag_idx: e.flagIdx,
		sort_id: e.sortId,
		type: e.type,
		text_id: e.textId,
		stamp_idx: e.stampIdx,
		data: e,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_chat_emotes", dedup(lignes, "id"), "id");
	console.log(`✅ Chat Emotes imported (${pousse}/${lignes.length}).`);
}

// === nameplates → inagle_nameplates (ON CONFLICT id) ===

export async function importNameplates(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Nameplates...");
	const nameplateDb = await buildNameplateDatabase(DATA_PATH);
	if (nameplateDb.nameplates.length === 0) {
		sourceVide("inagle_nameplates", "nameplate/nameplate_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = nameplateDb.nameplates.map((n) => ({
		id: n.nameplateId,
		name_text_id: n.nameTextId,
		sort_no: n.sortNo,
		image_path: n.imagePath,
		font_style: n.fontStyle,
		data: n,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_nameplates", dedup(lignes, "id"), "id");
	console.log(`✅ Nameplates imported (${pousse}/${lignes.length}).`);
}

// === performances → inagle_performances (ON CONFLICT id) ===

export async function importPerformances(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Performances...");
	const perfDb = await buildPerformanceDatabase(DATA_PATH);
	if (perfDb.performances.length === 0) {
		sourceVide("inagle_performances", "performance/performance_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = perfDb.performances.map((p) => ({
		id: p.performanceId,
		event_id: p.eventId,
		event_name_text_id: p.eventNameTextId,
		image_path: p.imagePath,
		data: p,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_performances", dedup(lignes, "id"), "id");
	console.log(`✅ Performances imported (${pousse}/${lignes.length}).`);
}

// === phase_titles → inagle_phase_titles (ON CONFLICT id) ===

export async function importPhaseTitles(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Phase Titles...");
	const titleDb = await buildPhaseTitleDatabase(DATA_PATH);
	if (titleDb.titles.length === 0) {
		sourceVide("inagle_phase_titles", "phase/phase_title_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = titleDb.titles.map((t) => ({
		id: t.phaseId,
		texture_id: t.textureId,
		image_path: t.imagePath,
		data: t,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_phase_titles", dedup(lignes, "id"), "id");
	console.log(`✅ Phase Titles imported (${pousse}/${lignes.length}).`);
}

// === scene_archives → inagle_scene_archives (ON CONFLICT id) ===

export async function importSceneArchives(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Scene Archives...");
	const sceneDb = await buildSceneArchiveDatabase(DATA_PATH);
	if (sceneDb.scenes.length === 0) {
		sourceVide("inagle_scene_archives", "scene/scene_archive_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = sceneDb.scenes.map((s) => ({
		id: s.sceneId,
		event_id: s.eventIdText,
		category: s.category,
		title_text_id: s.titleTextId,
		chapter_no: s.chapterNo,
		image_path: s.thumbnailPath,
		data: s,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_scene_archives", dedup(lignes, "id"), "id");
	console.log(`✅ Scene Archives imported (${pousse}/${lignes.length}).`);
}

// === stadiums → inagle_stadiums (ON CONFLICT id) ===

export async function importStadiums(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Stadiums...");
	const stadiumDb = await buildStadiumDatabase(DATA_PATH);
	if (stadiumDb.stadiums.length === 0) {
		sourceVide("inagle_stadiums", "stadium/stadium_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = stadiumDb.stadiums.map((s) => ({
		id: s.fieldId,
		field_index: s.index,
		image_path: s.imagePath,
		condition: s.condition,
		data: s,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_stadiums", dedup(lignes, "id"), "id");
	console.log(`✅ Stadiums imported (${pousse}/${lignes.length}).`);
}

// === drop_rates → inagle_drop_rates (ON CONFLICT id) ===

export async function importDropRates(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Drop Rates...");
	const taux = loadAllDropRates();
	if (taux.length === 0) {
		sourceVide(
			"inagle_drop_rates",
			"item_emission_rarity_table_config / soccer_drop_config / win_treasure_lot_table_config"
		);
		return;
	}

	const now = new Date().toISOString();
	const lignes = taux.map((r) => ({
		id: r.id,
		source: r.source,
		source_id: r.sourceId,
		item_id: r.itemId,
		rarity: r.rarity,
		drop_rarity: r.dropRarity,
		weight: r.weight,
		updated_at: now,
	}));

	const parSource = lignes.reduce<Record<string, number>>((acc, l) => {
		acc[l.source] = (acc[l.source] ?? 0) + 1;
		return acc;
	}, {});
	console.log(`   ↳ répartition : ${JSON.stringify(parSource)}`);

	const pousse = await pousserParLots(db, "inagle_drop_rates", dedup(lignes, "id"), "id", 500);
	console.log(`✅ Drop Rates imported (${pousse}/${lignes.length}).`);
}

// === override_skills → inagle_override_skills (ON CONFLICT id) ===

/** Vue minimale d'une technique telle que rendue par le service inagle. */
interface TechniqueResolue {
	skillID?: string;
	skillIDStr?: string;
	internalCode?: string;
	hashId?: string;
	element?: number;
	category?: number;
	powerMin?: number;
	powerMax?: number;
	powerRange?: string;
	name_FR?: string;
	name_EN?: string;
	name_JA?: string;
	names?: { fr?: string; en?: string; ja?: string };
}

/** Indexe une technique sous tous ses identifiants connus (hex, code, hash). */
function indexerTechniques(techniques: TechniqueResolue[]): Map<string, TechniqueResolue> {
	const index = new Map<string, TechniqueResolue>();
	for (const t of techniques) {
		for (const cle of [t.skillID, t.skillIDStr, t.internalCode, t.hashId]) {
			if (cle) index.set(cle, t);
		}
	}
	return index;
}

const nomTechnique = (t: TechniqueResolue | undefined, langue: "fr" | "en" | "ja") => {
	if (!t) return null;
	const direct = t.names?.[langue];
	if (direct) return direct;
	const brut = langue === "fr" ? t.name_FR : langue === "en" ? t.name_EN : t.name_JA;
	return brut ?? null;
};

/** `powerRange` du service est une chaîne « min-max » ; les champs typés priment. */
function bornesPuissance(t: TechniqueResolue | undefined): { min: number | null; max: number | null } {
	if (!t) return { min: null, max: null };
	if (typeof t.powerMin === "number" || typeof t.powerMax === "number") {
		return { min: t.powerMin ?? null, max: t.powerMax ?? null };
	}
	const bornes = (t.powerRange ?? "").split("-");
	const min = Number.parseInt(bornes[0] ?? "", 10);
	const max = Number.parseInt(bornes[1] ?? "", 10);
	return {
		min: Number.isFinite(min) ? min : null,
		max: Number.isFinite(max) ? max : null,
	};
}

export async function importOverrideSkills(service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Override Skills...");
	const overrideDb = await buildOverrideSkillDatabase(DATA_PATH);
	if (overrideDb.resolved.length === 0) {
		sourceVide("inagle_override_skills", "skill/override_skill_config");
		return;
	}

	// Résolution des noms/élément/catégorie/puissance depuis les techniques réelles.
	const svc = (service as { skills?: { all(): TechniqueResolue[] } })?.skills
		? (service as { skills: { all(): TechniqueResolue[] } })
		: await createInagleService();
	const index = indexerTechniques(
		(svc as { skills: { all(): TechniqueResolue[] } }).skills.all()
	);

	const lignes = overrideDb.resolved.map((o) => {
		const technique = index.get(o.overrideSkillId);
		const { min, max } = bornesPuissance(technique);
		return {
			id: o.overrideSkillId,
			name_fr: nomTechnique(technique, "fr"),
			name_en: nomTechnique(technique, "en"),
			name_ja: nomTechnique(technique, "ja"),
			element_id: technique?.element ?? null,
			category_id: technique?.category ?? null,
			power_min: min,
			power_max: max,
			conditions: o.conditions.map((c) => ({
				condition_type: c.conditionType,
				required_skills: c.requiredSkills.map((rs) => {
					const requise = index.get(rs.skillId);
					return {
						skill_id: rs.skillId,
						num: rs.num,
						name_fr: nomTechnique(requise, "fr"),
						name_en: nomTechnique(requise, "en"),
					};
				}),
			})),
		};
	});

	const resolus = lignes.filter((l) => l.name_en !== null).length;
	console.log(`   ↳ ${resolus}/${lignes.length} overrides nommés depuis skill_config.`);

	const pousse = await pousserParLots(db, "inagle_override_skills", dedup(lignes, "id"), "id");
	console.log(`✅ Override Skills imported (${pousse}/${lignes.length}).`);
}

// === events + event_subtitles → inagle_events / inagle_event_subtitles ===

export async function importEventSubtitles(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Event Subtitles...");
	const agregats = parseAllEventAggregates();
	const sousTitres = parseAllEventSubtitles();

	if (agregats.length === 0 && sousTitres.length === 0) {
		sourceVide("inagle_events / inagle_event_subtitles", "event/subtitle + common/text/event");
		return;
	}

	const now = new Date().toISOString();
	const lignesEvents = agregats.map((a) => ({
		event_id: a.event_id,
		episode: a.episode,
		has_subtitle: a.has_subtitle,
		subtitle_langs: a.subtitle_langs,
		dialogue_langs: a.dialogue_langs,
		subtitle_rows: a.subtitle_rows,
		line_count: a.line_count,
		has_map: a.has_map,
		updated_at: now,
	}));

	const lignesSousTitres = sousTitres.map((s) => ({
		event_id: s.event_id,
		episode: s.episode,
		line_index: s.line_index,
		text_hash: s.text_hash,
		text_hash_u: s.text_hash_u,
		show_start: s.show_start,
		show_end: s.show_end,
		t3: s.t3,
		t4: s.t4,
		subtitle_langs: s.subtitle_langs,
		line_label: s.line_label,
		lip_sync: s.lip_sync,
		text_ja: s.text_ja,
		text_en: s.text_en,
		text_fr: s.text_fr,
		updated_at: now,
	}));

	const pousseEvents = await pousserParLots(db, "inagle_events", lignesEvents, "event_id", 500);
	const pousseLignes = await pousserParLots(
		db,
		"inagle_event_subtitles",
		lignesSousTitres,
		"event_id,line_index",
		500
	);
	console.log(
		`✅ Event Subtitles imported (${pousseEvents}/${lignesEvents.length} events, ${pousseLignes}/${lignesSousTitres.length} lignes).`
	);
}

// === formations → inagle_formations (ON CONFLICT id) ===

export async function importFormations(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Formations...");
	const formationDb = buildFormationDatabase(DATA_PATH);
	if (formationDb.formations.length === 0) {
		sourceVide("inagle_formations", "formation/formation_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = formationDb.formations.map((f) => ({
		id: f.formationId,
		name_fr: f.names.fr ?? null,
		name_en: f.names.en ?? null,
		name_ja: f.names.ja ?? null,
		description_fr: f.descriptions.fr ?? null,
		description_en: f.descriptions.en ?? null,
		description_ja: f.descriptions.ja ?? null,
		power_offense: f.powerOffense,
		power_defense: f.powerDefense,
		// `data` porte les 11 placements et leurs coordonnées réelles.
		data: f,
		updated_at: now,
	}));

	const nommees = lignes.filter((l) => l.name_fr || l.name_en || l.name_ja).length;
	console.log(`   ↳ ${nommees}/${lignes.length} formations nommées (formation_text).`);

	const pousse = await pousserParLots(db, "inagle_formations", dedup(lignes, "id"), "id");
	console.log(`✅ Formations imported (${pousse}/${lignes.length}).`);
}

// ============================================================================
// Tables créées par la migration 20260813_inagle_couverture_parseurs.sql —
// données réelles qui n'avaient AUCUNE table de destination jusqu'ici.
// ============================================================================

// === exp_rarity_rates → inagle_exp_rarity_rates (ON CONFLICT rarity) ===

export async function importExpRarityRates(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Exp Rarity Rates...");
	const expDb = await buildCharaExpTableDatabase(DATA_PATH);
	if (expDb.rarityRates.length === 0) {
		sourceVide("inagle_exp_rarity_rates", "character/chara_exp_table_config (m_expRarityRateList)");
		return;
	}

	const now = new Date().toISOString();
	const lignes = expDb.rarityRates.map((r) => ({
		rarity: r.rarity,
		rate: r.rate,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_exp_rarity_rates", lignes, "rarity");
	console.log(`✅ Exp Rarity Rates imported (${pousse}/${lignes.length}).`);
}

// === ability_learning → inagle_ability_effects + inagle_ability_boards ===

export async function importAbilityLearning(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Ability Learning...");
	const config = await loadAbilityLearningConfig(DATA_PATH);
	if (!config || (config.effects.size === 0 && config.boards.size === 0)) {
		sourceVide("inagle_ability_effects / inagle_ability_boards", "skill/ability_learning_config");
		return;
	}

	const now = new Date().toISOString();
	const lignesEffets = [...config.effects.values()].map((e) => ({
		id: e.id,
		hash: e.hash,
		type: e.type,
		value: e.value,
		data: e,
		updated_at: now,
	}));

	const lignesPlateaux = [...config.boards.entries()].map(([boardId, effectIds]) => ({
		board_id: boardId,
		effect_ids: effectIds,
		effect_count: effectIds.length,
		updated_at: now,
	}));

	const pousseEffets = await pousserParLots(db, "inagle_ability_effects", lignesEffets, "id", 500);
	const poussePlateaux = await pousserParLots(
		db,
		"inagle_ability_boards",
		lignesPlateaux,
		"board_id",
		500
	);
	console.log(
		`✅ Ability Learning imported (${pousseEffets}/${lignesEffets.length} effets, ${poussePlateaux}/${lignesPlateaux.length} plateaux).`
	);
}

// === enjoy_mode_teams → inagle_enjoy_mode_teams (ON CONFLICT id) ===

export async function importEnjoyModeTeams(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Enjoy Mode Teams...");
	const enjoyDb = await buildEnjoyModeTeamDatabase(DATA_PATH);
	if (enjoyDb.teams.length === 0) {
		sourceVide("inagle_enjoy_mode_teams", "team/enjoy_mode_team_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = enjoyDb.teams.map((t) => ({
		id: t.teamId,
		sub_id: t.subId,
		color_crc: t.colorCrc,
		type: t.type,
		formation_crc: t.formationCrc,
		texture_path: t.texturePath,
		texture_name: t.textureName,
		data: t,
		updated_at: now,
	}));

	const pousse = await pousserParLots(db, "inagle_enjoy_mode_teams", dedup(lignes, "id"), "id");
	console.log(`✅ Enjoy Mode Teams imported (${pousse}/${lignes.length}).`);
}

// === nfc_lottery → inagle_nfc_lottery (ON CONFLICT id = "<lot>:<table>:<idx>") ===

export async function importNfcLottery(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing NFC Lottery...");
	const nfcDb = await buildNfcLotteryDatabase(DATA_PATH);
	if (nfcDb.lotteries.length === 0) {
		sourceVide("inagle_nfc_lottery", "nfc/nfc_lottery_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes: LignePoussee[] = [];
	for (const loterie of nfcDb.lotteries) {
		for (const table of loterie.tables) {
			table.items.forEach((item, index) => {
				lignes.push({
					// Clé déterministe : l'index positionnel préserve les doublons
					// légitimes (un même item peut apparaître plusieurs fois).
					id: `${loterie.lotteryId}:${table.tableId}:${index}`,
					lottery_id: loterie.lotteryId,
					table_id: table.tableId,
					item_id: item.itemId,
					item_index: index,
					type: item.type,
					weight: item.weight,
					updated_at: now,
				});
			});
		}
	}

	const pousse = await pousserParLots(db, "inagle_nfc_lottery", dedup(lignes, "id"), "id", 500);
	console.log(`✅ NFC Lottery imported (${pousse}/${lignes.length}).`);
}

// === passive_skill_effects → inagle_passive_skill_effects (ON CONFLICT effect_id) ===

export async function importPassiveSkillEffects(_service: unknown, db: DataAdapter) {
	console.log("🔄 Importing Passive Skill Effects...");
	const effectDb = await buildPassiveSkillEffectDatabase(DATA_PATH);
	if (effectDb.effects.length === 0) {
		sourceVide("inagle_passive_skill_effects", "skill/passive_skill_effect_config");
		return;
	}

	const now = new Date().toISOString();
	const lignes = effectDb.effects.map((e) => ({
		effect_id: e.effectId,
		params: e.params,
		data: e,
		updated_at: now,
	}));

	const pousse = await pousserParLots(
		db,
		"inagle_passive_skill_effects",
		dedup(lignes, "effect_id"),
		"effect_id"
	);
	console.log(`✅ Passive Skill Effects imported (${pousse}/${lignes.length}).`);
}
