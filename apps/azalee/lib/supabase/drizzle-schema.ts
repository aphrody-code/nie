// GÉNÉRÉ par scripts/ops/gen-drizzle-schema.ts — NE PAS ÉDITER À LA MAIN.
// Introspection du miroir SQLite (tables inagle_* STATIQUES). Re-générer après un
// re-dump du jeu uniquement. Cf. docs/decision-archi-donnees-azalee.md (Phase 4).
import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";

export const inagle_activity_photos = sqliteTable("inagle_activity_photos", {
	id: text("id"),
	trophy_id_hex: text("trophy_id_hex"),
	reward: integer("reward"),
	image_path: text("image_path"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_auras = sqliteTable("inagle_auras", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_ja: text("description_ja"),
	element_id: integer("element_id"),
	sub_type: text("sub_type"),
	image_url: text("image_url"),
	asset_code: text("asset_code"),
	sheet_data: text("sheet_data"),
	updated_at: text("updated_at"),
});

export const inagle_awakenings = sqliteTable("inagle_awakenings", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	sheet_data: text("sheet_data"),
	asset_code: text("asset_code"),
	sub_type: text("sub_type"),
	element_id: integer("element_id"),
});

export const inagle_basara = sqliteTable("inagle_basara", {
	character_id: text("character_id"),
	name_romaji: text("name_romaji"),
	name_localised: text("name_localised"),
	gender: text("gender"),
	position: text("position"),
	alt_position: text("alt_position"),
	element: text("element"),
	moveset: text("moveset"),
	alt_moveset: text("alt_moveset"),
	passive: text("passive"),
	kick: integer("kick"),
	control: integer("control"),
	technique: integer("technique"),
	pressure: integer("pressure"),
	physical: integer("physical"),
	agility: integer("agility"),
	intelligence: integer("intelligence"),
});

export const inagle_boost_groups = sqliteTable("inagle_boost_groups", {
	id: text("id"),
	config_index: integer("config_index"),
	duration: integer("duration"),
	spirit_indices: text("spirit_indices"),
	resolved_spirit_ids: text("resolved_spirit_ids"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_capsules = sqliteTable("inagle_capsules", {
	id: text("id"),
	prize_data: text("prize_data"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_chara_menu_resource = sqliteTable("inagle_chara_menu_resource", {
	id: text("id"),
	is_template: integer("is_template"),
	paths: text("paths"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_characters = sqliteTable("inagle_characters", {
	id: text("id"),
	chara_id: text("chara_id"),
	internal_code: text("internal_code"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_ja: text("description_ja"),
	rarity: text("rarity"),
	rarity_code: integer("rarity_code"),
	rarity_label: text("rarity_label"),
	element_id: integer("element_id"),
	element: text("element"),
	position_id: integer("position_id"),
	position: text("position"),
	gender: text("gender"),
	image_url: text("image_url"),
	sheet_data: text("sheet_data"),
	stats: text("stats"),
	skills: text("skills"),
	teams: text("teams"),
	series: text("series"),
	slug: text("slug"),
	team_id: text("team_id"),
	stat_frappe: integer("stat_frappe"),
	stat_controle: integer("stat_controle"),
	stat_technique: integer("stat_technique"),
	stat_pression: integer("stat_pression"),
	stat_physique: integer("stat_physique"),
	stat_agilite: integer("stat_agilite"),
	stat_intelligence: integer("stat_intelligence"),
	stat_total: integer("stat_total"),
	constellation: text("constellation"),
	constellation_index: integer("constellation_index"),
	zukan_hash: text("zukan_hash"),
	created_at: text("created_at"),
	zukan_order: integer("zukan_order"),
	base_slug: text("base_slug"),
	control_type: text("control_type"),
	data: text("data"),
	is_controllable: integer("is_controllable"),
	description_en: text("description_en"),
	game_appearances: text("game_appearances"),
	model_id: text("model_id"),
	stat_lv1_frappe: integer("stat_lv1_frappe"),
	stat_lv1_controle: integer("stat_lv1_controle"),
	stat_lv1_technique: integer("stat_lv1_technique"),
	stat_lv1_pression: integer("stat_lv1_pression"),
	stat_lv1_physique: integer("stat_lv1_physique"),
	stat_lv1_agilite: integer("stat_lv1_agilite"),
	stat_lv1_intelligence: integer("stat_lv1_intelligence"),
	updated_at: text("updated_at"),
	hero_type: text("hero_type"),
	is_primary: integer("is_primary"),
	age_group: text("age_group"),
	school_year: text("school_year"),
	nickname: text("nickname"),
});

export const inagle_chat_emotes = sqliteTable("inagle_chat_emotes", {
	id: text("id"),
	emote_id: text("emote_id"),
	flag_idx: integer("flag_idx"),
	sort_id: integer("sort_id"),
	type: integer("type"),
	text_id: text("text_id"),
	stamp_idx: integer("stamp_idx"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_constellations = sqliteTable("inagle_constellations", {
	id: text("id"),
	idx: integer("idx"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	character_count: integer("character_count"),
	character_ids: text("character_ids"),
	texture_star: text("texture_star"),
	texture_star_after: text("texture_star_after"),
	texture_rare_star: text("texture_rare_star"),
	texture_layer: text("texture_layer"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_coordinators = sqliteTable("inagle_coordinators", {
	id: integer("id"),
	image: text("image"),
	name_kanji: text("name_kanji"),
	name_hiragana: text("name_hiragana"),
	name_romaji: text("name_romaji"),
	name_localised: text("name_localised"),
	gender: text("gender"),
	role: text("role"),
	game: text("game"),
	element: text("element"),
	playstyle: text("playstyle"),
	passive_slot: integer("passive_slot"),
	passive_no: integer("passive_no"),
	requirements: text("requirements"),
	stat: text("stat"),
	buff: text("buff"),
});

export const inagle_costumes = sqliteTable("inagle_costumes", {
	id: text("id"),
	costume_index: integer("costume_index"),
	type: integer("type"),
	model_ref: text("model_ref"),
	flag1: integer("flag1"),
	flag2: integer("flag2"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_custom_passives = sqliteTable("inagle_custom_passives", {
	id: integer("id"),
	requirements: text("requirements"),
	stat: text("stat"),
	buff: text("buff"),
});

export const inagle_drop_rates = sqliteTable("inagle_drop_rates", {
	id: text("id"),
	source: text("source"),
	source_id: text("source_id"),
	item_id: text("item_id"),
	rarity: integer("rarity"),
	drop_rarity: integer("drop_rarity"),
	weight: real("weight"),
	updated_at: text("updated_at"),
});

export const inagle_drops = sqliteTable("inagle_drops", {
	id: integer("id"),
	team: text("team"),
	game: text("game"),
	fixed_beans: text("fixed_beans"),
	passive_type: text("passive_type"),
	no: integer("no"),
	requirement: text("requirement"),
	stat: text("stat"),
	value: text("value"),
});

export const inagle_drops_battles = sqliteTable("inagle_drops_battles", {
	battle_group_id: integer("battle_group_id"),
	item_table_id: integer("item_table_id"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_drops_tables = sqliteTable("inagle_drops_tables", {
	table_id: text("table_id"),
	entries: text("entries"),
	updated_at: text("updated_at"),
});

export const inagle_drops_treasures = sqliteTable("inagle_drops_treasures", {
	id: text("id"),
	map_id: text("map_id"),
	pos: text("pos"),
	items: text("items"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_emblems = sqliteTable("inagle_emblems", {
	emblem_id: text("emblem_id"),
	emblem_name: text("emblem_name"),
	small_file_path: text("small_file_path"),
	small_tex_name: text("small_tex_name"),
	large_file_path: text("large_file_path"),
	large_tex_name: text("large_tex_name"),
	base_path: text("base_path"),
	is_template: integer("is_template"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_event_subtitles = sqliteTable("inagle_event_subtitles", {
	event_id: text("event_id"),
	episode: text("episode"),
	line_index: integer("line_index"),
	text_hash: integer("text_hash"),
	text_hash_u: text("text_hash_u"),
	show_start: real("show_start"),
	show_end: real("show_end"),
	t3: real("t3"),
	t4: real("t4"),
	subtitle_langs: text("subtitle_langs"),
	line_label: text("line_label"),
	lip_sync: text("lip_sync"),
	text_ja: text("text_ja"),
	text_en: text("text_en"),
	text_fr: text("text_fr"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_events = sqliteTable("inagle_events", {
	event_id: text("event_id"),
	episode: text("episode"),
	has_subtitle: integer("has_subtitle"),
	subtitle_langs: text("subtitle_langs"),
	dialogue_langs: text("dialogue_langs"),
	subtitle_rows: integer("subtitle_rows"),
	line_count: integer("line_count"),
	has_map: integer("has_map"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_exp_table = sqliteTable("inagle_exp_table", {
	level: integer("level"),
	need_exp: integer("need_exp"),
});

export const inagle_formations = sqliteTable("inagle_formations", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	emblem_url: text("emblem_url"),
});

export const inagle_gallery = sqliteTable("inagle_gallery", {
	id: text("id"),
	img_path: text("img_path"),
	thumb_path: text("thumb_path"),
	need_token_num: integer("need_token_num"),
	flg_no: integer("flg_no"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_game_assets = sqliteTable("inagle_game_assets", {
	path: text("path"),
	cpk: text("cpk"),
	kind: text("kind"),
	sha256: text("sha256"),
	size: integer("size"),
	buildid: integer("buildid"),
	updated_at: text("updated_at"),
	bucket: text("bucket"),
	exists: integer("exists"),
});

export const inagle_growth_tables = sqliteTable("inagle_growth_tables", {
	id: integer("id"),
	section: text("section"),
	main_position: integer("main_position"),
	sub_position: integer("sub_position"),
	play_style: integer("play_style"),
	growth_pattern: integer("growth_pattern"),
	chara_rank: integer("chara_rank"),
	data: text("data"),
});

export const inagle_heroes = sqliteTable("inagle_heroes", {
	character_id: text("character_id"),
	name_romaji: text("name_romaji"),
	name_localised: text("name_localised"),
	gender: text("gender"),
	position: text("position"),
	element: text("element"),
	playstyle: text("playstyle"),
	moveset: text("moveset"),
	kick: integer("kick"),
	control: integer("control"),
	technique: integer("technique"),
	pressure: integer("pressure"),
	physical: integer("physical"),
	agility: integer("agility"),
	intelligence: integer("intelligence"),
});

export const inagle_icon_inventory = sqliteTable("inagle_icon_inventory", {
	id: text("id"),
	folder: text("folder"),
	subfolder: text("subfolder"),
	filename: text("filename"),
	path: text("path"),
	size: integer("size"),
	mime: text("mime"),
	updated_at: text("updated_at"),
});

export const inagle_img_inventory = sqliteTable("inagle_img_inventory", {
	id: text("id"),
	folder: text("folder"),
	subfolder: text("subfolder"),
	filename: text("filename"),
	path: text("path"),
	size: integer("size"),
	mime: text("mime"),
	updated_at: text("updated_at"),
});

export const inagle_items = sqliteTable("inagle_items", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_ja: text("description_ja"),
	category: text("category"),
	rarity: integer("rarity"),
	image_url: text("image_url"),
	sheet_data: text("sheet_data"),
	price: integer("price"),
	internal_code: text("internal_code"),
	shops: text("shops"),
	created_at: text("created_at"),
	data: text("data"),
	description_en: text("description_en"),
	sell_price: integer("sell_price"),
	buy_price: integer("buy_price"),
	shop_names: text("shop_names"),
	stat_boost_1: text("stat_boost_1"),
	stat_boost_2: text("stat_boost_2"),
	updated_at: text("updated_at"),
	boost_type: text("boost_type"),
	effect_value: integer("effect_value"),
});

export const inagle_keshins = sqliteTable("inagle_keshins", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	sheet_data: text("sheet_data"),
	asset_code: text("asset_code"),
	element_id: integer("element_id"),
	sub_type: text("sub_type"),
	has_asset: integer("has_asset"),
});

export const inagle_kizuna_items = sqliteTable("inagle_kizuna_items", {
	name: text("name"),
	size: text("size"),
	power: integer("power"),
	shop: text("shop"),
	notes: text("notes"),
});

export const inagle_lua_scripts = sqliteTable("inagle_lua_scripts", {
	id: text("id"),
	name: text("name"),
	version: text("version"),
	category: text("category"),
	functions: text("functions"),
	calls: text("calls"),
	strings: text("strings"),
	crc32_numbers: text("crc32_numbers"),
	hash: text("hash"),
	updated_at: text("updated_at"),
});

export const inagle_manager_passives = sqliteTable("inagle_manager_passives", {
	id: integer("id"),
	playstyle: text("playstyle"),
	requirements: text("requirements"),
	stat: text("stat"),
	coord_common: text("coord_common"),
	coord_legendary: text("coord_legendary"),
	manager_common: text("manager_common"),
	manager_legendary: text("manager_legendary"),
});

export const inagle_media_assets = sqliteTable("inagle_media_assets", {
	id: text("id"),
	folder: text("folder"),
	category: text("category"),
	path: text("path"),
	is_template: integer("is_template"),
	sources: text("sources"),
	context: text("context"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_missions = sqliteTable("inagle_missions", {
	mission_id: text("mission_id"),
	code: text("code"),
	name_id: text("name_id"),
	name_en: text("name_en"),
	name_fr: text("name_fr"),
	name_ja: text("name_ja"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_miximax = sqliteTable("inagle_miximax", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	icon_code: text("icon_code"),
	asset_code: text("asset_code"),
	element_id: integer("element_id"),
	sub_type: text("sub_type"),
	sheet_data: text("sheet_data"),
	has_asset: integer("has_asset"),
});

export const inagle_mode_changes = sqliteTable("inagle_mode_changes", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	asset_code: text("asset_code"),
	sub_type: text("sub_type"),
	element_id: integer("element_id"),
	sheet_data: text("sheet_data"),
});

export const inagle_nameplates = sqliteTable("inagle_nameplates", {
	id: text("id"),
	name_text_id: text("name_text_id"),
	sort_no: integer("sort_no"),
	image_path: text("image_path"),
	font_style: text("font_style"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_opponent_teams = sqliteTable("inagle_opponent_teams", {
	id: text("id"),
	team_id: text("team_id"),
	type: integer("type"),
	game_id: text("game_id"),
	difficulty_type: integer("difficulty_type"),
	bg_texture: text("bg_texture"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_override_skills = sqliteTable("inagle_override_skills", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	element_id: integer("element_id"),
	category_id: integer("category_id"),
	power_min: integer("power_min"),
	power_max: integer("power_max"),
	conditions: text("conditions"),
	created_at: text("created_at"),
});

export const inagle_passive_generation = sqliteTable("inagle_passive_generation", {
	passive_id: text("passive_id"),
	no: integer("no"),
	requirement: text("requirement"),
	stat: text("stat"),
});

export const inagle_passive_scaling = sqliteTable("inagle_passive_scaling", {
	id: integer("id"),
	requirement: text("requirement"),
	stat_affected: text("stat_affected"),
	legendary_low: text("legendary_low"),
	legendary_high: text("legendary_high"),
	top_low: text("top_low"),
	top_high: text("top_high"),
	advanced_low: text("advanced_low"),
	advanced_high: text("advanced_high"),
	growing_low: text("growing_low"),
	growing_high: text("growing_high"),
	common_low: text("common_low"),
	common_high: text("common_high"),
});

export const inagle_passives = sqliteTable("inagle_passives", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	category: text("category"),
	boost_type: text("boost_type"),
	stat_boost: text("stat_boost"),
	effect_value: text("effect_value"),
});

export const inagle_performances = sqliteTable("inagle_performances", {
	id: text("id"),
	event_id: text("event_id"),
	event_name_text_id: text("event_name_text_id"),
	image_path: text("image_path"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_phase_titles = sqliteTable("inagle_phase_titles", {
	id: text("id"),
	texture_id: text("texture_id"),
	image_path: text("image_path"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_quests = sqliteTable("inagle_quests", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	display_text: text("display_text"),
	phase: text("phase"),
});

export const inagle_rag_chunks = sqliteTable("inagle_rag_chunks", {
	id: text("id"),
	source_id: text("source_id"),
	source_kind: text("source_kind"),
	title: text("title"),
	url: text("url"),
	lang: text("lang"),
	content: text("content"),
	content_tsv: text("content_tsv"),
	embedding: text("embedding"),
	meta: text("meta"),
	content_hash: text("content_hash"),
	buildid: integer("buildid"),
	created_at: text("created_at"),
});

export const inagle_scene_archives = sqliteTable("inagle_scene_archives", {
	id: text("id"),
	event_id: text("event_id"),
	category: integer("category"),
	title_text_id: text("title_text_id"),
	chapter_no: integer("chapter_no"),
	image_path: text("image_path"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_shops = sqliteTable("inagle_shops", {
	id: text("id"),
	shop_id: integer("shop_id"),
	name_hash: integer("name_hash"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	item_id: integer("item_id"),
	item_hex: text("item_hex"),
	item_name_fr: text("item_name_fr"),
	item_name_en: text("item_name_en"),
	item_name_ja: text("item_name_ja"),
	item_db_id: text("item_db_id"),
	slot_index: integer("slot_index"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_skill_technic = sqliteTable("inagle_skill_technic", {
	id: text("id"),
	win_sub_motion_name_crc: text("win_sub_motion_name_crc"),
	lose_sub_motion_name_crc: text("lose_sub_motion_name_crc"),
	lose_type: integer("lose_type"),
	formation_type: integer("formation_type"),
	formation_chara_len: integer("formation_chara_len"),
	shoot_curve_mid_rate: real("shoot_curve_mid_rate"),
	shoot_curve_height_rate: real("shoot_curve_height_rate"),
	shoot_curve_angle: real("shoot_curve_angle"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_skills = sqliteTable("inagle_skills", {
	id: text("id"),
	internal_code: text("internal_code"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_ja: text("description_ja"),
	category_id: integer("category_id"),
	element_id: integer("element_id"),
	power_min: integer("power_min"),
	power_max: integer("power_max"),
	tension_cost: integer("tension_cost"),
	image_url: text("image_url"),
	video_url: text("video_url"),
	poster_url: text("poster_url"),
	is_hyper: integer("is_hyper"),
	sheet_data: text("sheet_data"),
	created_at: text("created_at"),
	category: text("category"),
	data: text("data"),
	description_en: text("description_en"),
	element: text("element"),
	evolution_type: text("evolution_type"),
	foul_rate: integer("foul_rate"),
	growth_type: text("growth_type"),
	hash_id: text("hash_id"),
	is_eldorado: integer("is_eldorado"),
	partner_count: integer("partner_count"),
	recast_time: integer("recast_time"),
	tp_cost: integer("tp_cost"),
	skill_effect_bit_flag: integer("skill_effect_bit_flag"),
	tags: text("tags"),
	updated_at: text("updated_at"),
	has_telop: integer("has_telop"),
});

export const inagle_souls = sqliteTable("inagle_souls", {
	id: text("id"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	type: text("type"),
	image_url: text("image_url"),
	data: text("data"),
	updated_at: text("updated_at"),
	sheet_data: text("sheet_data"),
	asset_code: text("asset_code"),
	sub_type: text("sub_type"),
	element_id: integer("element_id"),
});

export const inagle_special_tactics = sqliteTable("inagle_special_tactics", {
	id: text("id"),
	internal_code: text("internal_code"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	power: integer("power"),
	recast_time: integer("recast_time"),
	element_id: integer("element_id"),
	element: text("element"),
	partner_count: integer("partner_count"),
	partner_ids: text("partner_ids"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_stadiums = sqliteTable("inagle_stadiums", {
	id: text("id"),
	field_index: integer("field_index"),
	image_path: text("image_path"),
	condition: text("condition"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_star_signs = sqliteTable("inagle_star_signs", {
	chara_param_id: text("chara_param_id"),
	chara_rarity: integer("chara_rarity"),
	rate_default: integer("rate_default"),
	rate_boost_a: integer("rate_boost_a"),
	rate_boost_b: integer("rate_boost_b"),
	rate_boost_c: integer("rate_boost_c"),
	rate_boost_d: integer("rate_boost_d"),
	is_remarkable: integer("is_remarkable"),
	enable_cond: text("enable_cond"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_super_tactics = sqliteTable("inagle_super_tactics", {
	id: text("id"),
	kind: text("kind"),
	idx: integer("idx"),
	crc_id: text("crc_id"),
	conditions: text("conditions"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_tactics = sqliteTable("inagle_tactics", {
	name: text("name"),
	effect1: text("effect1"),
	effect2: text("effect2"),
	effect3: text("effect3"),
	duration: integer("duration"),
	cooldown: integer("cooldown"),
	shop: text("shop"),
	id: text("id"),
	internal_code: text("internal_code"),
	name_fr: text("name_fr"),
	name_ja: text("name_ja"),
	description_fr: text("description_fr"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	element_id: integer("element_id"),
	element: text("element"),
	power: integer("power"),
	recast_time: integer("recast_time"),
	partner_count: integer("partner_count"),
	partner_ids: text("partner_ids"),
	image_url: text("image_url"),
});

export const inagle_team_build = sqliteTable("inagle_team_build", {
	id: text("id"),
	section: text("section"),
	idx: integer("idx"),
	effect_id: text("effect_id"),
	effect_ref_id: text("effect_ref_id"),
	type: integer("type"),
	threshold: integer("threshold"),
	value: integer("value"),
	multiplier: integer("multiplier"),
	build_type: integer("build_type"),
	build_level: integer("build_level"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_teams = sqliteTable("inagle_teams", {
	id: text("id"),
	internal_code: text("internal_code"),
	name_fr: text("name_fr"),
	name_en: text("name_en"),
	name_ja: text("name_ja"),
	emblems: text("emblems"),
	kits: text("kits"),
	members: text("members"),
	sheet_data: text("sheet_data"),
	created_at: text("created_at"),
	country_code: text("country_code"),
	data: text("data"),
	description_en: text("description_en"),
	description_ja: text("description_ja"),
	description_fr: text("description_fr"),
	emblem_url: text("emblem_url"),
	series: text("series"),
	region: text("region"),
	updated_at: text("updated_at"),
});

export const inagle_telop_waza = sqliteTable("inagle_telop_waza", {
	skill_id: text("skill_id"),
	blank_left_index: integer("blank_left_index"),
	blank_right_index: integer("blank_right_index"),
	eldorado_id: text("eldorado_id"),
	left_blanks: text("left_blanks"),
	right_blanks: text("right_blanks"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_tricks = sqliteTable("inagle_tricks", {
	id: text("id"),
	trick_id_name: text("trick_id_name"),
	event_id: text("event_id"),
	event_id_name: text("event_id_name"),
	fail_event_id: text("fail_event_id"),
	fail_event_id_name: text("fail_event_id_name"),
	name_ja: text("name_ja"),
	trick_category: integer("trick_category"),
	trick_category_name: text("trick_category_name"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_trophies = sqliteTable("inagle_trophies", {
	trophy_id: text("trophy_id"),
	code: text("code"),
	name_en: text("name_en"),
	name_fr: text("name_fr"),
	name_ja: text("name_ja"),
	desc_en: text("desc_en"),
	desc_fr: text("desc_fr"),
	desc_ja: text("desc_ja"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_uniforms = sqliteTable("inagle_uniforms", {
	name_id: text("name_id"),
	model_start: integer("model_start"),
	model_count: integer("model_count"),
	type_id: integer("type_id"),
	models: text("models"),
	data: text("data"),
	updated_at: text("updated_at"),
});

export const inagle_video_waza = sqliteTable("inagle_video_waza", {
	id: text("id"),
	event_id: text("event_id"),
	menu_id: text("menu_id"),
	caption_id: text("caption_id"),
	movie_path: text("movie_path"),
	bgm_name: text("bgm_name"),
	fede_in_time: integer("fede_in_time"),
	fede_out_time: integer("fede_out_time"),
	staffroll_data_name: text("staffroll_data_name"),
	caption_name: text("caption_name"),
	caption_start_frame: integer("caption_start_frame"),
	caption_end_frame: integer("caption_end_frame"),
	data: text("data"),
	updated_at: text("updated_at"),
});
