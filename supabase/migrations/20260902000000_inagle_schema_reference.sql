-- Schema de reference des tables `inagle_*` — les donnees d'Inazuma Eleven extraites du jeu.
--
-- Ces 66 tables existaient en base sans jamais avoir ete decrites par une migration : elles
-- avaient ete creees par le pipeline de push (`packages/inagle`), au fil des familles portees.
-- Une base neuve n'etait donc pas reconstructible, et rien ne disait quel schema le code attend.
--
-- Ce fichier comble ce trou. Il est genere depuis la base reelle
-- (`pg_dump --schema-only` sur `inagle_*`), rendu idempotent (`IF NOT EXISTS`), et il est la
-- reference : ce qui n'y figure pas n'existe pas pour le code.
--
-- Le contenu, lui, ne vient pas d'ici — il est pousse par `packages/inagle`, depuis les
-- `.cfg.bin` du jeu. Une migration cree la forme ; le jeu reste la source.
--
-- 66 tables · 39 index · 68 contraintes

--
--






--
-- Name: inagle_activity_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_activity_photos (
    id text NOT NULL,
    trophy_id_hex text,
    reward integer,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_auras; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_auras (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    element_id integer,
    sub_type text,
    image_url text,
    asset_code text,
    sheet_data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_awakenings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_awakenings (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    sub_type text,
    element_id integer
);


--
-- Name: inagle_awakenings_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.inagle_awakenings_clean WITH (security_invoker='true') AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data
   FROM public.inagle_awakenings
  ORDER BY name_fr, id;


--
-- Name: inagle_basara; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_basara (
    character_id character varying(50) NOT NULL,
    name_romaji character varying(255),
    name_localised character varying(255),
    gender character varying(50),
    "position" character varying(50),
    alt_position character varying(50),
    element character varying(50),
    moveset text,
    alt_moveset text,
    passive text,
    kick integer,
    control integer,
    technique integer,
    pressure integer,
    physical integer,
    agility integer,
    intelligence integer
);


--
-- Name: inagle_boost_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_boost_groups (
    id text NOT NULL,
    config_index integer NOT NULL,
    duration integer,
    spirit_indices jsonb,
    resolved_spirit_ids jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_capsules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_capsules (
    id text NOT NULL,
    prize_data jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_chara_menu_resource; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_chara_menu_resource (
    id text NOT NULL,
    is_template boolean DEFAULT false,
    paths jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_characters (
    id text NOT NULL,
    chara_id text,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    rarity text,
    rarity_code integer,
    rarity_label text,
    element_id integer,
    element text,
    position_id integer,
    "position" text,
    gender text,
    image_url text,
    sheet_data jsonb,
    stats jsonb,
    skills jsonb,
    teams jsonb,
    series text,
    slug text,
    team_id text,
    stat_frappe integer DEFAULT 0,
    stat_controle integer DEFAULT 0,
    stat_technique integer DEFAULT 0,
    stat_pression integer DEFAULT 0,
    stat_physique integer DEFAULT 0,
    stat_agilite integer DEFAULT 0,
    stat_intelligence integer DEFAULT 0,
    stat_total integer DEFAULT 0,
    constellation text,
    constellation_index integer,
    zukan_hash text,
    created_at timestamp with time zone DEFAULT now(),
    zukan_order integer,
    base_slug text,
    control_type text,
    data jsonb,
    is_controllable boolean DEFAULT false,
    description_en text,
    game_appearances text[],
    model_id text,
    stat_lv1_frappe integer DEFAULT 0,
    stat_lv1_controle integer DEFAULT 0,
    stat_lv1_technique integer DEFAULT 0,
    stat_lv1_pression integer DEFAULT 0,
    stat_lv1_physique integer DEFAULT 0,
    stat_lv1_agilite integer DEFAULT 0,
    stat_lv1_intelligence integer DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now(),
    hero_type text,
    is_primary boolean DEFAULT false,
    age_group text,
    school_year text,
    nickname text
);


--
-- Name: inagle_chat_emotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_chat_emotes (
    id text NOT NULL,
    emote_id text,
    flag_idx integer,
    sort_id integer,
    type integer,
    text_id text,
    stamp_idx integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_constellations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_constellations (
    id text NOT NULL,
    idx integer NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    character_count integer DEFAULT 0 NOT NULL,
    character_ids text[] DEFAULT '{}'::text[] NOT NULL,
    texture_star text,
    texture_star_after text,
    texture_rare_star text,
    texture_layer text,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_coordinators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_coordinators (
    id integer NOT NULL,
    image text,
    name_kanji character varying(255),
    name_hiragana character varying(255),
    name_romaji character varying(255),
    name_localised character varying(255),
    gender text,
    role character varying(100),
    game character varying(255),
    element text,
    playstyle character varying(255),
    passive_slot integer,
    passive_no integer,
    requirements text,
    stat character varying(100),
    buff character varying(100)
);


--
-- Name: inagle_coordinators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.inagle_coordinators_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_coordinators_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_coordinators_id_seq OWNED BY public.inagle_coordinators.id;


--
-- Name: inagle_costumes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_costumes (
    id text NOT NULL,
    costume_index integer,
    type integer,
    model_ref text,
    flag1 integer,
    flag2 integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_custom_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_custom_passives (
    id integer NOT NULL,
    requirements text,
    stat text,
    buff text
);


--
-- Name: inagle_drop_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_drop_rates (
    id text NOT NULL,
    source text NOT NULL,
    source_id text NOT NULL,
    item_id text,
    rarity integer,
    drop_rarity integer,
    weight double precision NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_drops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_drops (
    id integer NOT NULL,
    team text,
    game text,
    fixed_beans text,
    passive_type text,
    no integer,
    requirement text,
    stat text,
    value text
);


--
-- Name: inagle_drops_battles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_drops_battles (
    battle_group_id bigint NOT NULL,
    item_table_id bigint,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_drops_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.inagle_drops_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_drops_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_drops_id_seq OWNED BY public.inagle_drops.id;


--
-- Name: inagle_drops_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_drops_tables (
    table_id text NOT NULL,
    entries jsonb DEFAULT '[]'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_drops_treasures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_drops_treasures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    map_id text,
    pos jsonb,
    items jsonb DEFAULT '[]'::jsonb,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_emblems; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_emblems (
    emblem_id text NOT NULL,
    emblem_name text NOT NULL,
    small_file_path text,
    small_tex_name text,
    large_file_path text,
    large_tex_name text,
    base_path text,
    is_template boolean DEFAULT false NOT NULL,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_event_subtitles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_event_subtitles (
    event_id text NOT NULL,
    episode text NOT NULL,
    line_index integer NOT NULL,
    text_hash bigint NOT NULL,
    text_hash_u text NOT NULL,
    show_start double precision NOT NULL,
    show_end double precision NOT NULL,
    t3 double precision NOT NULL,
    t4 double precision NOT NULL,
    subtitle_langs text[] DEFAULT '{}'::text[] NOT NULL,
    line_label text,
    lip_sync text,
    text_ja text,
    text_en text,
    text_fr text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_events (
    event_id text NOT NULL,
    episode text NOT NULL,
    has_subtitle boolean DEFAULT false NOT NULL,
    subtitle_langs text[] DEFAULT '{}'::text[] NOT NULL,
    dialogue_langs text[] DEFAULT '{}'::text[] NOT NULL,
    subtitle_rows integer DEFAULT 0 NOT NULL,
    line_count integer DEFAULT 0 NOT NULL,
    has_map boolean DEFAULT false NOT NULL,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_exp_table; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_exp_table (
    level integer NOT NULL,
    need_exp integer NOT NULL
);


--
-- Name: inagle_formations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_formations (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    emblem_url text,
    power_offense integer,
    power_defense integer
);


--
-- Name: inagle_gallery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_gallery (
    id text NOT NULL,
    img_path text,
    thumb_path text,
    need_token_num integer,
    flg_no integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_game_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_game_assets (
    path text NOT NULL,
    cpk text,
    kind text,
    sha256 text,
    size bigint,
    buildid bigint,
    updated_at timestamp with time zone DEFAULT now(),
    bucket text,
    "exists" boolean DEFAULT true NOT NULL
);


--
-- Name: inagle_growth_tables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_growth_tables (
    id integer NOT NULL,
    section text NOT NULL,
    main_position integer,
    sub_position integer,
    play_style integer,
    growth_pattern integer,
    chara_rank integer,
    data jsonb NOT NULL
);


--
-- Name: inagle_growth_tables_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE IF NOT EXISTS public.inagle_growth_tables_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inagle_growth_tables_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inagle_growth_tables_id_seq OWNED BY public.inagle_growth_tables.id;


--
-- Name: inagle_heroes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_heroes (
    character_id character varying(50) NOT NULL,
    name_romaji character varying(255),
    name_localised character varying(255),
    gender character varying(50),
    "position" character varying(50),
    element character varying(50),
    playstyle character varying(255) NOT NULL,
    moveset text,
    kick integer,
    control integer,
    technique integer,
    pressure integer,
    physical integer,
    agility integer,
    intelligence integer
);


--
-- Name: inagle_icon_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_icon_inventory (
    id text NOT NULL,
    folder text NOT NULL,
    subfolder text DEFAULT ''::text,
    filename text NOT NULL,
    path text NOT NULL,
    size integer DEFAULT 0,
    mime text DEFAULT 'image/webp'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_img_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_img_inventory (
    id text NOT NULL,
    folder text NOT NULL,
    subfolder text DEFAULT ''::text,
    filename text NOT NULL,
    path text NOT NULL,
    size integer DEFAULT 0,
    mime text DEFAULT 'image/webp'::text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_items (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    category text,
    rarity integer,
    image_url text,
    sheet_data jsonb,
    price integer,
    internal_code text,
    shops jsonb,
    created_at timestamp with time zone DEFAULT now(),
    data jsonb,
    description_en text,
    sell_price integer,
    buy_price integer,
    shop_names text[],
    stat_boost_1 text,
    stat_boost_2 text,
    updated_at timestamp with time zone DEFAULT now(),
    boost_type text,
    effect_value integer DEFAULT 0
);


--
-- Name: inagle_keshins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_keshins (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    element_id integer,
    sub_type text,
    has_asset boolean
);


--
-- Name: inagle_keshins_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.inagle_keshins_clean WITH (security_invoker='true') AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data,
    asset_code,
    element_id,
    sub_type
   FROM public.inagle_keshins
  ORDER BY name_fr, id;


--
-- Name: inagle_kizuna_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_kizuna_items (
    name text NOT NULL,
    size text,
    power integer,
    shop text,
    notes text
);


--
-- Name: inagle_lua_scripts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_lua_scripts (
    id text NOT NULL,
    name text NOT NULL,
    version text,
    category text,
    functions jsonb DEFAULT '[]'::jsonb,
    calls jsonb DEFAULT '{}'::jsonb,
    strings jsonb DEFAULT '[]'::jsonb,
    crc32_numbers jsonb DEFAULT '[]'::jsonb,
    hash text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);


--
-- Name: inagle_manager_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_manager_passives (
    id integer NOT NULL,
    playstyle character varying(100),
    requirements text,
    stat text,
    coord_common character varying(20),
    coord_legendary character varying(20),
    manager_common character varying(20),
    manager_legendary character varying(20)
);


--
-- Name: inagle_media_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_media_assets (
    id text NOT NULL,
    folder text NOT NULL,
    category text NOT NULL,
    path text NOT NULL,
    is_template boolean DEFAULT false,
    sources jsonb,
    context jsonb,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_missions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_missions (
    mission_id text NOT NULL,
    code text NOT NULL,
    name_id text,
    name_en text,
    name_fr text,
    name_ja text,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_miximax; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_miximax (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    icon_code text,
    asset_code text,
    element_id integer,
    sub_type text,
    sheet_data jsonb,
    has_asset boolean
);


--
-- Name: inagle_miximax_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.inagle_miximax_clean WITH (security_invoker='true') AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    icon_code,
    asset_code,
    element_id,
    sub_type,
    sheet_data
   FROM public.inagle_miximax
  ORDER BY name_fr, id;


--
-- Name: inagle_mode_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_mode_changes (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    asset_code text,
    sub_type text,
    element_id integer,
    sheet_data jsonb
);


--
-- Name: inagle_mode_changes_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.inagle_mode_changes_clean WITH (security_invoker='true') AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at
   FROM public.inagle_mode_changes
  ORDER BY name_fr, id;


--
-- Name: inagle_nameplates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_nameplates (
    id text NOT NULL,
    name_text_id text,
    sort_no integer,
    image_path text,
    font_style text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_opponent_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_opponent_teams (
    id text NOT NULL,
    team_id text,
    type integer,
    game_id text,
    difficulty_type integer,
    bg_texture text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_override_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_override_skills (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    element_id integer DEFAULT 0,
    category_id integer DEFAULT 0,
    power_min integer DEFAULT 0,
    power_max integer DEFAULT 0,
    conditions jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_passive_generation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_passive_generation (
    passive_id character varying(50) NOT NULL,
    no integer NOT NULL,
    requirement text,
    stat text
);


--
-- Name: inagle_passive_scaling; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_passive_scaling (
    id integer NOT NULL,
    requirement text,
    stat_affected text,
    legendary_low character varying(20),
    legendary_high character varying(20),
    top_low character varying(20),
    top_high character varying(20),
    advanced_low character varying(20),
    advanced_high character varying(20),
    growing_low character varying(20),
    growing_high character varying(20),
    common_low character varying(20),
    common_high character varying(20)
);


--
-- Name: inagle_passives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_passives (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    category text,
    boost_type text,
    stat_boost text,
    effect_value text
);


--
-- Name: inagle_performances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_performances (
    id text NOT NULL,
    event_id text,
    event_name_text_id text,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_phase_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_phase_titles (
    id text NOT NULL,
    texture_id text,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_quests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_quests (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    display_text text,
    phase text
);


--
-- Name: inagle_rag_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_rag_edges (
    src text NOT NULL,
    dst text NOT NULL,
    relation text NOT NULL,
    weight real DEFAULT 1 NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_scene_archives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_scene_archives (
    id text NOT NULL,
    event_id text,
    category integer,
    title_text_id text,
    chapter_no integer,
    image_path text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_shops (
    id text NOT NULL,
    shop_id bigint NOT NULL,
    name_hash bigint NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    item_id bigint NOT NULL,
    item_hex text NOT NULL,
    item_name_fr text,
    item_name_en text,
    item_name_ja text,
    item_db_id text,
    slot_index integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_skill_technic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_skill_technic (
    id text NOT NULL,
    win_sub_motion_name_crc text NOT NULL,
    lose_sub_motion_name_crc text NOT NULL,
    lose_type integer NOT NULL,
    formation_type integer NOT NULL,
    formation_chara_len integer NOT NULL,
    shoot_curve_mid_rate real NOT NULL,
    shoot_curve_height_rate real NOT NULL,
    shoot_curve_angle real NOT NULL,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_skill_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_skill_videos (
    skill_id text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    label text NOT NULL,
    video_url text NOT NULL,
    poster_url text,
    source text DEFAULT 'zukan'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inagle_skill_videos_source_check CHECK ((source = ANY (ARRAY['zukan'::text, 'dreamscape'::text])))
);


--
-- Name: inagle_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_skills (
    id text NOT NULL,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_ja text,
    category_id integer,
    element_id integer,
    power_min integer,
    power_max integer,
    tension_cost integer,
    image_url text,
    video_url text,
    poster_url text,
    is_hyper boolean DEFAULT false,
    sheet_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    category text,
    data jsonb,
    description_en text,
    element text,
    evolution_type text,
    foul_rate integer DEFAULT 0,
    growth_type text,
    hash_id text,
    is_eldorado boolean DEFAULT false,
    partner_count integer DEFAULT 0,
    recast_time integer DEFAULT 0,
    tp_cost integer DEFAULT 0,
    skill_effect_bit_flag integer DEFAULT 0,
    tags text[],
    updated_at timestamp with time zone DEFAULT now(),
    has_telop boolean DEFAULT true NOT NULL,
    thumbnail_url text
);


--
-- Name: inagle_souls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_souls (
    id text NOT NULL,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    type text,
    image_url text,
    data jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    sheet_data jsonb,
    asset_code text,
    sub_type text,
    element_id integer
);


--
-- Name: inagle_souls_clean; Type: VIEW; Schema: public; Owner: -
--

CREATE OR REPLACE VIEW public.inagle_souls_clean WITH (security_invoker='true') AS
 SELECT DISTINCT ON (name_fr) id,
    name_fr,
    name_en,
    name_ja,
    description_fr,
    description_en,
    description_ja,
    type,
    image_url,
    data,
    updated_at,
    sheet_data
   FROM public.inagle_souls
  ORDER BY name_fr, id;


--
-- Name: inagle_special_tactics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_special_tactics (
    id text NOT NULL,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    power integer DEFAULT 0 NOT NULL,
    recast_time integer DEFAULT 0 NOT NULL,
    element_id integer DEFAULT 0 NOT NULL,
    element text,
    partner_count integer DEFAULT 0 NOT NULL,
    partner_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_stadiums; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_stadiums (
    id text NOT NULL,
    field_index integer,
    image_path text,
    condition text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_star_signs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_star_signs (
    chara_param_id text NOT NULL,
    chara_rarity integer NOT NULL,
    rate_default integer DEFAULT 0 NOT NULL,
    rate_boost_a integer DEFAULT 0 NOT NULL,
    rate_boost_b integer DEFAULT 0 NOT NULL,
    rate_boost_c integer DEFAULT 0 NOT NULL,
    rate_boost_d integer DEFAULT 0 NOT NULL,
    is_remarkable boolean DEFAULT false NOT NULL,
    enable_cond text DEFAULT ''::text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_super_tactics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_super_tactics (
    id text NOT NULL,
    kind text NOT NULL,
    idx integer NOT NULL,
    crc_id text NOT NULL,
    conditions jsonb,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_tactics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_tactics (
    name text NOT NULL,
    effect1 text,
    effect2 text,
    effect3 text,
    duration integer,
    cooldown integer,
    shop text,
    id text,
    internal_code text,
    name_fr text,
    name_ja text,
    description_fr text,
    description_en text,
    description_ja text,
    element_id integer DEFAULT 0,
    element text DEFAULT 'Néant'::text,
    power integer DEFAULT 0,
    recast_time integer DEFAULT 0,
    partner_count integer DEFAULT 0,
    partner_ids jsonb,
    image_url text
);


--
-- Name: inagle_team_build; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_team_build (
    id text NOT NULL,
    section text NOT NULL,
    idx integer NOT NULL,
    effect_id text,
    effect_ref_id text,
    type integer,
    threshold integer,
    value integer,
    multiplier integer,
    build_type integer,
    build_level integer,
    data jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_teams (
    id text NOT NULL,
    internal_code text,
    name_fr text,
    name_en text,
    name_ja text,
    emblems jsonb,
    kits jsonb,
    members jsonb,
    sheet_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    country_code text,
    data jsonb,
    description_en text,
    description_ja text,
    description_fr text,
    emblem_url text,
    series text,
    region text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_telop_waza; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_telop_waza (
    skill_id text NOT NULL,
    blank_left_index integer NOT NULL,
    blank_right_index integer NOT NULL,
    eldorado_id text,
    left_blanks jsonb DEFAULT '{}'::jsonb NOT NULL,
    right_blanks jsonb DEFAULT '{}'::jsonb NOT NULL,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_tricks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_tricks (
    id text NOT NULL,
    trick_id_name text,
    event_id text,
    event_id_name text,
    fail_event_id text,
    fail_event_id_name text,
    name_ja text,
    trick_category integer,
    trick_category_name text,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_trophies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_trophies (
    trophy_id text NOT NULL,
    code text NOT NULL,
    name_en text,
    name_fr text,
    name_ja text,
    desc_en text,
    desc_fr text,
    desc_ja text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_uniforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_uniforms (
    name_id text NOT NULL,
    model_start integer NOT NULL,
    model_count integer NOT NULL,
    type_id integer,
    models jsonb DEFAULT '[]'::jsonb NOT NULL,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inagle_video_waza; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inagle_video_waza (
    id text NOT NULL,
    event_id text NOT NULL,
    menu_id text,
    caption_id text,
    movie_path text,
    bgm_name text,
    fede_in_time integer,
    fede_out_time integer,
    staffroll_data_name text,
    caption_name text,
    caption_start_frame integer,
    caption_end_frame integer,
    data jsonb,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: inagle_coordinators id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_coordinators ALTER COLUMN id SET DEFAULT nextval('public.inagle_coordinators_id_seq'::regclass);


--
-- Name: inagle_drops id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_drops ALTER COLUMN id SET DEFAULT nextval('public.inagle_drops_id_seq'::regclass);


--
-- Name: inagle_growth_tables id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inagle_growth_tables ALTER COLUMN id SET DEFAULT nextval('public.inagle_growth_tables_id_seq'::regclass);


--
-- Name: inagle_activity_photos inagle_activity_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_activity_photos_pkey') THEN
		ALTER TABLE ONLY public.inagle_activity_photos
		    ADD CONSTRAINT inagle_activity_photos_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_auras inagle_auras_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_auras_pkey') THEN
		ALTER TABLE ONLY public.inagle_auras
		    ADD CONSTRAINT inagle_auras_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_awakenings inagle_awakenings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_awakenings_pkey') THEN
		ALTER TABLE ONLY public.inagle_awakenings
		    ADD CONSTRAINT inagle_awakenings_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_basara inagle_basara_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_basara_pkey') THEN
		ALTER TABLE ONLY public.inagle_basara
		    ADD CONSTRAINT inagle_basara_pkey PRIMARY KEY (character_id);
	END IF;
END $$;


--
-- Name: inagle_boost_groups inagle_boost_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_boost_groups_pkey') THEN
		ALTER TABLE ONLY public.inagle_boost_groups
		    ADD CONSTRAINT inagle_boost_groups_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_capsules inagle_capsules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_capsules_pkey') THEN
		ALTER TABLE ONLY public.inagle_capsules
		    ADD CONSTRAINT inagle_capsules_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_chara_menu_resource inagle_chara_menu_resource_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_chara_menu_resource_pkey') THEN
		ALTER TABLE ONLY public.inagle_chara_menu_resource
		    ADD CONSTRAINT inagle_chara_menu_resource_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_characters inagle_characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_characters_pkey') THEN
		ALTER TABLE ONLY public.inagle_characters
		    ADD CONSTRAINT inagle_characters_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_chat_emotes inagle_chat_emotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_chat_emotes_pkey') THEN
		ALTER TABLE ONLY public.inagle_chat_emotes
		    ADD CONSTRAINT inagle_chat_emotes_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_constellations inagle_constellations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_constellations_pkey') THEN
		ALTER TABLE ONLY public.inagle_constellations
		    ADD CONSTRAINT inagle_constellations_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_coordinators inagle_coordinators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_coordinators_pkey') THEN
		ALTER TABLE ONLY public.inagle_coordinators
		    ADD CONSTRAINT inagle_coordinators_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_costumes inagle_costumes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_costumes_pkey') THEN
		ALTER TABLE ONLY public.inagle_costumes
		    ADD CONSTRAINT inagle_costumes_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_custom_passives inagle_custom_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_custom_passives_pkey') THEN
		ALTER TABLE ONLY public.inagle_custom_passives
		    ADD CONSTRAINT inagle_custom_passives_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_drop_rates inagle_drop_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_drop_rates_pkey') THEN
		ALTER TABLE ONLY public.inagle_drop_rates
		    ADD CONSTRAINT inagle_drop_rates_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_drops_battles inagle_drops_battles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_drops_battles_pkey') THEN
		ALTER TABLE ONLY public.inagle_drops_battles
		    ADD CONSTRAINT inagle_drops_battles_pkey PRIMARY KEY (battle_group_id);
	END IF;
END $$;


--
-- Name: inagle_drops inagle_drops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_drops_pkey') THEN
		ALTER TABLE ONLY public.inagle_drops
		    ADD CONSTRAINT inagle_drops_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_drops_tables inagle_drops_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_drops_tables_pkey') THEN
		ALTER TABLE ONLY public.inagle_drops_tables
		    ADD CONSTRAINT inagle_drops_tables_pkey PRIMARY KEY (table_id);
	END IF;
END $$;


--
-- Name: inagle_drops_treasures inagle_drops_treasures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_drops_treasures_pkey') THEN
		ALTER TABLE ONLY public.inagle_drops_treasures
		    ADD CONSTRAINT inagle_drops_treasures_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_emblems inagle_emblems_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_emblems_pkey') THEN
		ALTER TABLE ONLY public.inagle_emblems
		    ADD CONSTRAINT inagle_emblems_pkey PRIMARY KEY (emblem_id);
	END IF;
END $$;


--
-- Name: inagle_event_subtitles inagle_event_subtitles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_event_subtitles_pkey') THEN
		ALTER TABLE ONLY public.inagle_event_subtitles
		    ADD CONSTRAINT inagle_event_subtitles_pkey PRIMARY KEY (event_id, line_index);
	END IF;
END $$;


--
-- Name: inagle_events inagle_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_events_pkey') THEN
		ALTER TABLE ONLY public.inagle_events
		    ADD CONSTRAINT inagle_events_pkey PRIMARY KEY (event_id);
	END IF;
END $$;


--
-- Name: inagle_exp_table inagle_exp_table_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_exp_table_pkey') THEN
		ALTER TABLE ONLY public.inagle_exp_table
		    ADD CONSTRAINT inagle_exp_table_pkey PRIMARY KEY (level);
	END IF;
END $$;


--
-- Name: inagle_formations inagle_formations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_formations_pkey') THEN
		ALTER TABLE ONLY public.inagle_formations
		    ADD CONSTRAINT inagle_formations_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_gallery inagle_gallery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_gallery_pkey') THEN
		ALTER TABLE ONLY public.inagle_gallery
		    ADD CONSTRAINT inagle_gallery_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_game_assets inagle_game_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_game_assets_pkey') THEN
		ALTER TABLE ONLY public.inagle_game_assets
		    ADD CONSTRAINT inagle_game_assets_pkey PRIMARY KEY (path);
	END IF;
END $$;


--
-- Name: inagle_growth_tables inagle_growth_tables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_growth_tables_pkey') THEN
		ALTER TABLE ONLY public.inagle_growth_tables
		    ADD CONSTRAINT inagle_growth_tables_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_heroes inagle_heroes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_heroes_pkey') THEN
		ALTER TABLE ONLY public.inagle_heroes
		    ADD CONSTRAINT inagle_heroes_pkey PRIMARY KEY (character_id, playstyle);
	END IF;
END $$;


--
-- Name: inagle_icon_inventory inagle_icon_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_icon_inventory_pkey') THEN
		ALTER TABLE ONLY public.inagle_icon_inventory
		    ADD CONSTRAINT inagle_icon_inventory_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_img_inventory inagle_img_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_img_inventory_pkey') THEN
		ALTER TABLE ONLY public.inagle_img_inventory
		    ADD CONSTRAINT inagle_img_inventory_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_items inagle_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_items_pkey') THEN
		ALTER TABLE ONLY public.inagle_items
		    ADD CONSTRAINT inagle_items_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_keshins inagle_keshins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_keshins_pkey') THEN
		ALTER TABLE ONLY public.inagle_keshins
		    ADD CONSTRAINT inagle_keshins_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_kizuna_items inagle_kizuna_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_kizuna_items_pkey') THEN
		ALTER TABLE ONLY public.inagle_kizuna_items
		    ADD CONSTRAINT inagle_kizuna_items_pkey PRIMARY KEY (name);
	END IF;
END $$;


--
-- Name: inagle_lua_scripts inagle_lua_scripts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_lua_scripts_pkey') THEN
		ALTER TABLE ONLY public.inagle_lua_scripts
		    ADD CONSTRAINT inagle_lua_scripts_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_manager_passives inagle_manager_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_manager_passives_pkey') THEN
		ALTER TABLE ONLY public.inagle_manager_passives
		    ADD CONSTRAINT inagle_manager_passives_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_media_assets inagle_media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_media_assets_pkey') THEN
		ALTER TABLE ONLY public.inagle_media_assets
		    ADD CONSTRAINT inagle_media_assets_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_missions inagle_missions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_missions_pkey') THEN
		ALTER TABLE ONLY public.inagle_missions
		    ADD CONSTRAINT inagle_missions_pkey PRIMARY KEY (mission_id);
	END IF;
END $$;


--
-- Name: inagle_miximax inagle_miximax_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_miximax_pkey') THEN
		ALTER TABLE ONLY public.inagle_miximax
		    ADD CONSTRAINT inagle_miximax_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_mode_changes inagle_mode_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_mode_changes_pkey') THEN
		ALTER TABLE ONLY public.inagle_mode_changes
		    ADD CONSTRAINT inagle_mode_changes_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_nameplates inagle_nameplates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_nameplates_pkey') THEN
		ALTER TABLE ONLY public.inagle_nameplates
		    ADD CONSTRAINT inagle_nameplates_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_opponent_teams inagle_opponent_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_opponent_teams_pkey') THEN
		ALTER TABLE ONLY public.inagle_opponent_teams
		    ADD CONSTRAINT inagle_opponent_teams_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_override_skills inagle_override_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_override_skills_pkey') THEN
		ALTER TABLE ONLY public.inagle_override_skills
		    ADD CONSTRAINT inagle_override_skills_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_passive_generation inagle_passive_generation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_passive_generation_pkey') THEN
		ALTER TABLE ONLY public.inagle_passive_generation
		    ADD CONSTRAINT inagle_passive_generation_pkey PRIMARY KEY (passive_id, no);
	END IF;
END $$;


--
-- Name: inagle_passive_scaling inagle_passive_scaling_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_passive_scaling_pkey') THEN
		ALTER TABLE ONLY public.inagle_passive_scaling
		    ADD CONSTRAINT inagle_passive_scaling_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_passives inagle_passives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_passives_pkey') THEN
		ALTER TABLE ONLY public.inagle_passives
		    ADD CONSTRAINT inagle_passives_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_performances inagle_performances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_performances_pkey') THEN
		ALTER TABLE ONLY public.inagle_performances
		    ADD CONSTRAINT inagle_performances_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_phase_titles inagle_phase_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_phase_titles_pkey') THEN
		ALTER TABLE ONLY public.inagle_phase_titles
		    ADD CONSTRAINT inagle_phase_titles_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_quests inagle_quests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_quests_pkey') THEN
		ALTER TABLE ONLY public.inagle_quests
		    ADD CONSTRAINT inagle_quests_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_rag_edges inagle_rag_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_rag_edges_pkey') THEN
		ALTER TABLE ONLY public.inagle_rag_edges
		    ADD CONSTRAINT inagle_rag_edges_pkey PRIMARY KEY (src, dst, relation);
	END IF;
END $$;


--
-- Name: inagle_scene_archives inagle_scene_archives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_scene_archives_pkey') THEN
		ALTER TABLE ONLY public.inagle_scene_archives
		    ADD CONSTRAINT inagle_scene_archives_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_shops inagle_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_shops_pkey') THEN
		ALTER TABLE ONLY public.inagle_shops
		    ADD CONSTRAINT inagle_shops_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_skill_technic inagle_skill_technic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_skill_technic_pkey') THEN
		ALTER TABLE ONLY public.inagle_skill_technic
		    ADD CONSTRAINT inagle_skill_technic_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_skill_videos inagle_skill_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_skill_videos_pkey') THEN
		ALTER TABLE ONLY public.inagle_skill_videos
		    ADD CONSTRAINT inagle_skill_videos_pkey PRIMARY KEY (skill_id, "position");
	END IF;
END $$;


--
-- Name: inagle_skills inagle_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_skills_pkey') THEN
		ALTER TABLE ONLY public.inagle_skills
		    ADD CONSTRAINT inagle_skills_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_souls inagle_souls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_souls_pkey') THEN
		ALTER TABLE ONLY public.inagle_souls
		    ADD CONSTRAINT inagle_souls_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_special_tactics inagle_special_tactics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_special_tactics_pkey') THEN
		ALTER TABLE ONLY public.inagle_special_tactics
		    ADD CONSTRAINT inagle_special_tactics_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_stadiums inagle_stadiums_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_stadiums_pkey') THEN
		ALTER TABLE ONLY public.inagle_stadiums
		    ADD CONSTRAINT inagle_stadiums_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_star_signs inagle_star_signs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_star_signs_pkey') THEN
		ALTER TABLE ONLY public.inagle_star_signs
		    ADD CONSTRAINT inagle_star_signs_pkey PRIMARY KEY (chara_param_id);
	END IF;
END $$;


--
-- Name: inagle_super_tactics inagle_super_tactics_kind_idx_key; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_super_tactics_kind_idx_key') THEN
		ALTER TABLE ONLY public.inagle_super_tactics
		    ADD CONSTRAINT inagle_super_tactics_kind_idx_key UNIQUE (kind, idx);
	END IF;
END $$;


--
-- Name: inagle_super_tactics inagle_super_tactics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_super_tactics_pkey') THEN
		ALTER TABLE ONLY public.inagle_super_tactics
		    ADD CONSTRAINT inagle_super_tactics_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_tactics inagle_tactics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_tactics_pkey') THEN
		ALTER TABLE ONLY public.inagle_tactics
		    ADD CONSTRAINT inagle_tactics_pkey PRIMARY KEY (name);
	END IF;
END $$;


--
-- Name: inagle_team_build inagle_team_build_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_team_build_pkey') THEN
		ALTER TABLE ONLY public.inagle_team_build
		    ADD CONSTRAINT inagle_team_build_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_teams inagle_teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_teams_pkey') THEN
		ALTER TABLE ONLY public.inagle_teams
		    ADD CONSTRAINT inagle_teams_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_telop_waza inagle_telop_waza_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_telop_waza_pkey') THEN
		ALTER TABLE ONLY public.inagle_telop_waza
		    ADD CONSTRAINT inagle_telop_waza_pkey PRIMARY KEY (skill_id);
	END IF;
END $$;


--
-- Name: inagle_tricks inagle_tricks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_tricks_pkey') THEN
		ALTER TABLE ONLY public.inagle_tricks
		    ADD CONSTRAINT inagle_tricks_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: inagle_trophies inagle_trophies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_trophies_pkey') THEN
		ALTER TABLE ONLY public.inagle_trophies
		    ADD CONSTRAINT inagle_trophies_pkey PRIMARY KEY (trophy_id);
	END IF;
END $$;


--
-- Name: inagle_uniforms inagle_uniforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_uniforms_pkey') THEN
		ALTER TABLE ONLY public.inagle_uniforms
		    ADD CONSTRAINT inagle_uniforms_pkey PRIMARY KEY (name_id);
	END IF;
END $$;


--
-- Name: inagle_video_waza inagle_video_waza_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_video_waza_pkey') THEN
		ALTER TABLE ONLY public.inagle_video_waza
		    ADD CONSTRAINT inagle_video_waza_pkey PRIMARY KEY (id);
	END IF;
END $$;


--
-- Name: idx_characters_element; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_element ON public.inagle_characters USING btree (element);


--
-- Name: idx_characters_gender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_gender ON public.inagle_characters USING btree (gender);


--
-- Name: idx_characters_is_controllable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_is_controllable ON public.inagle_characters USING btree (is_controllable);


--
-- Name: idx_characters_playstyle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_playstyle ON public.inagle_characters USING btree (((sheet_data ->> 'playstyle'::text)));


--
-- Name: idx_characters_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_position ON public.inagle_characters USING btree ("position");


--
-- Name: idx_characters_rarity_label; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_rarity_label ON public.inagle_characters USING btree (rarity_label);


--
-- Name: idx_characters_series; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_series ON public.inagle_characters USING btree (series);


--
-- Name: idx_characters_zukan_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_characters_zukan_order ON public.inagle_characters USING btree (zukan_order);


--
-- Name: idx_coordinators_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_coordinators_role ON public.inagle_coordinators USING btree (role);


--
-- Name: idx_growth_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_position ON public.inagle_growth_tables USING btree (main_position, sub_position);


--
-- Name: idx_growth_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_growth_section ON public.inagle_growth_tables USING btree (section);


--
-- Name: idx_icon_inventory_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_icon_inventory_folder ON public.inagle_icon_inventory USING btree (folder);


--
-- Name: idx_img_inventory_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_img_inventory_folder ON public.inagle_img_inventory USING btree (folder);


--
-- Name: idx_inagle_characters_internal_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_characters_internal_code ON public.inagle_characters USING btree (internal_code);


--
-- Name: idx_inagle_lua_scripts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_lua_scripts_category ON public.inagle_lua_scripts USING btree (category);


--
-- Name: idx_inagle_lua_scripts_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_lua_scripts_name ON public.inagle_lua_scripts USING btree (name);


--
-- Name: idx_inagle_shops_item_db_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_shops_item_db_id ON public.inagle_shops USING btree (item_db_id);


--
-- Name: idx_inagle_shops_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_shops_item_id ON public.inagle_shops USING btree (item_id);


--
-- Name: idx_inagle_shops_shop_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_shops_shop_id ON public.inagle_shops USING btree (shop_id);


--
-- Name: idx_inagle_telop_waza_eldorado_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_inagle_telop_waza_eldorado_id ON public.inagle_telop_waza USING btree (eldorado_id) WHERE (eldorado_id IS NOT NULL);


--
-- Name: inagle_constellations_idx_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_constellations_idx_idx ON public.inagle_constellations USING btree (idx);


--
-- Name: inagle_drop_rates_item_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_drop_rates_item_id_idx ON public.inagle_drop_rates USING btree (item_id);


--
-- Name: inagle_drop_rates_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_drop_rates_source_id_idx ON public.inagle_drop_rates USING btree (source_id);


--
-- Name: inagle_drop_rates_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_drop_rates_source_idx ON public.inagle_drop_rates USING btree (source);


--
-- Name: inagle_event_subtitles_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_event_subtitles_episode_idx ON public.inagle_event_subtitles USING btree (episode);


--
-- Name: inagle_event_subtitles_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_event_subtitles_event_idx ON public.inagle_event_subtitles USING btree (event_id);


--
-- Name: inagle_event_subtitles_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_event_subtitles_hash_idx ON public.inagle_event_subtitles USING btree (text_hash);


--
-- Name: inagle_event_subtitles_hash_u_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_event_subtitles_hash_u_idx ON public.inagle_event_subtitles USING btree (text_hash_u);


--
-- Name: inagle_events_episode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_events_episode_idx ON public.inagle_events USING btree (episode);


--
-- Name: inagle_events_has_subtitle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_events_has_subtitle_idx ON public.inagle_events USING btree (has_subtitle);


--
-- Name: inagle_game_assets_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_game_assets_bucket_idx ON public.inagle_game_assets USING btree (bucket);


--
-- Name: inagle_game_assets_exists_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_game_assets_exists_idx ON public.inagle_game_assets USING btree ("exists");


--
-- Name: inagle_growth_tables_unique_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS inagle_growth_tables_unique_key ON public.inagle_growth_tables USING btree (section, main_position, sub_position, play_style, growth_pattern, chara_rank) NULLS NOT DISTINCT;


--
-- Name: inagle_rag_edges_dst_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_rag_edges_dst_idx ON public.inagle_rag_edges USING btree (dst);


--
-- Name: inagle_rag_edges_meta_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_rag_edges_meta_idx ON public.inagle_rag_edges USING gin (meta jsonb_path_ops);


--
-- Name: inagle_rag_edges_relation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_rag_edges_relation_idx ON public.inagle_rag_edges USING btree (relation);


--
-- Name: inagle_rag_edges_src_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_rag_edges_src_idx ON public.inagle_rag_edges USING btree (src);


--
-- Name: inagle_skill_videos_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_skill_videos_skill_idx ON public.inagle_skill_videos USING btree (skill_id, "position");


--
-- Name: inagle_team_build_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS inagle_team_build_section_idx ON public.inagle_team_build USING btree (section);


--
-- Name: inagle_skill_videos inagle_skill_videos_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inagle_skill_videos_skill_id_fkey') THEN
		ALTER TABLE ONLY public.inagle_skill_videos
		    ADD CONSTRAINT inagle_skill_videos_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.inagle_skills(id) ON DELETE CASCADE;
	END IF;
END $$;


--
-- Name: inagle_awakenings Admin Write Awakenings; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_formations Admin Write Formations; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_keshins Admin Write Keshins; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_miximax Admin Write Miximax; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_mode_changes Admin Write ModeChanges; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_passives Admin Write Passives; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_quests Admin Write Quests; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_souls Admin Write Souls; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_awakenings Admin manage inagle_awakenings; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_formations Admin manage inagle_formations; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_keshins Admin manage inagle_keshins; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_lua_scripts Admin manage inagle_lua_scripts; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_miximax Admin manage inagle_miximax; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_mode_changes Admin manage inagle_mode_changes; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_souls Admin manage inagle_souls; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_boost_groups Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_characters Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_constellations Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_drop_rates Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_emblems Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_event_subtitles Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_events Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_items Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_missions Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_override_skills Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_shops Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_skill_technic Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_skill_videos Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_skills Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_special_tactics Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_star_signs Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_super_tactics Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_team_build Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_teams Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_telop_waza Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_tricks Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_trophies Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_uniforms Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_video_waza Public Read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_awakenings Public Read Awakenings; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_formations Public Read Formations; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_keshins Public Read Keshins; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_miximax Public Read Miximax; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_mode_changes Public Read ModeChanges; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_passives Public Read Passives; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_quests Public Read Quests; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_souls Public Read Souls; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_exp_table Public read exp_table; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_growth_tables Public read growth_tables; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_activity_photos anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_chara_menu_resource anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_chat_emotes anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_icon_inventory anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_img_inventory anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_nameplates anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_performances anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_phase_titles anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_scene_archives anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_stadiums anon_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_game_assets anon_read_inagle_game_assets; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_activity_photos; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_auras; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_awakenings; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_basara; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_basara inagle_basara_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_boost_groups; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_capsules; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_capsules inagle_capsules_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_chara_menu_resource; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_characters; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_chat_emotes; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_constellations; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_coordinators; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_coordinators inagle_coordinators_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_costumes; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_costumes inagle_costumes_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_custom_passives; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_custom_passives inagle_custom_passives_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_drop_rates; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_drops; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_drops_battles; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_drops_battles inagle_drops_battles_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_drops inagle_drops_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_drops_tables; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_drops_tables inagle_drops_tables_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_drops_treasures; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_drops_treasures inagle_drops_treasures_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_emblems; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_event_subtitles; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_events; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_exp_table; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_formations; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_gallery; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_gallery inagle_gallery_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_game_assets; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_growth_tables; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_heroes; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_heroes inagle_heroes_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_icon_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_img_inventory; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_items; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_keshins; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_kizuna_items; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_kizuna_items inagle_kizuna_items_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_lua_scripts; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_lua_scripts inagle_lua_scripts_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_manager_passives; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_manager_passives inagle_manager_passives_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_media_assets; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_media_assets inagle_media_assets_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_missions; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_miximax; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_mode_changes; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_nameplates; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_opponent_teams; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_opponent_teams inagle_opponent_teams_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_override_skills; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_passive_generation; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_passive_generation inagle_passive_generation_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_passive_scaling; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_passive_scaling inagle_passive_scaling_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_passives; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_performances; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_phase_titles; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_quests; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_rag_edges; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_scene_archives; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_shops; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_skill_technic; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_skill_videos; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_skills; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_souls; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_special_tactics; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_stadiums; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_star_signs; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_super_tactics; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_tactics; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_tactics inagle_tactics_public_read; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_team_build; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_teams; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_telop_waza; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_tricks; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_trophies; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_uniforms; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_video_waza; Type: ROW SECURITY; Schema: public; Owner: -
--
-- Name: inagle_rag_edges lecture publique; Type: POLICY; Schema: public; Owner: -
--
-- Name: inagle_auras pub_read; Type: POLICY; Schema: public; Owner: -
--
--
