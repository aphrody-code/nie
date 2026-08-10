-- ============================================================================
-- Migration « caméra » de la base de connaissance niers (schema_version 2).
--
-- Indexe TOUT ce que le projet sait de la caméra d'Inazuma Eleven: Victory Road :
--   1. la carte du reverse (classes RTTI, dispatchers Lua, symboles, paramètres,
--      commandes d'entrée, caméras nommées de la scène) ;
--   2. les fichiers de données caméra du VFS et leur état ;
--   3. `soccer_camera_config` — les 11 listes de caméras de match, typées ;
--   4. `camera_ctrl_property_info*` — les presets de contrôleur et leur héritage ;
--   5. les 1 215 animations `.g4cm` : fichiers, objets, canaux, et — au choix —
--      chaque échantillon de keyframe.
--
-- Toutes les tables sont préfixées `cam_`. Idempotent (CREATE ... IF NOT EXISTS) et
-- rejouable : le peuplement passe par `nie-cam index`, qui purge par source avant
-- de réinsérer. Voir `docs/game-data/camera.md` pour la provenance des faits.
--
-- Convention : les adresses (`*_va`) sont des entiers 64 bits (VA image base
-- 0x140000000) ; les hashes Level-5 sont stockés en entier non signé 32 bits.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Provenance
-- ---------------------------------------------------------------------------

-- Une passe d'indexation. Tout enregistrement caméra pointe la passe qui l'a produit,
-- ce qui permet de réindexer sans dupliquer et de comparer deux builds du jeu.
CREATE TABLE IF NOT EXISTS cam_source (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,            -- exe | vfs | anim | static
    label       TEXT NOT NULL,            -- ex. « nie.exe 33918464 » ou « VFS Steam »
    sha256      TEXT,                     -- du binaire / du fichier racine, si applicable
    size        INTEGER,
    indexed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    tool        TEXT NOT NULL DEFAULT 'nie-cam',
    UNIQUE(kind, label)
);

-- ---------------------------------------------------------------------------
-- 1. Carte du reverse
-- ---------------------------------------------------------------------------

-- Les contrôleurs de caméra natifs. `base` est le nom C++ de la classe parente : la
-- hiérarchie vient des symboles RTTI TAddPropertyCreator<Dérivée, Base>, elle est donc
-- prouvée et non inférée du nom.
CREATE TABLE IF NOT EXISTS cam_ctrl_class (
    id         INTEGER PRIMARY KEY,
    source_id  INTEGER REFERENCES cam_source(id) ON DELETE SET NULL,
    cpp_name   TEXT NOT NULL UNIQUE,      -- game::CCameraCtrlChaseSoccer
    short_name TEXT NOT NULL,             -- ChaseSoccer
    base       TEXT REFERENCES cam_ctrl_class(cpp_name) ON DELETE SET NULL,
    depth      INTEGER NOT NULL DEFAULT 0,-- distance à lives::CCameraCtrl
    ported     INTEGER NOT NULL DEFAULT 0,-- 1 si porté dans nie-camera::ctrl
    role       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cam_ctrl_base ON cam_ctrl_class(base);

-- Les 15 dispatchers funcLua*Command : leur table de commandes (en BSS, remplie au
-- runtime) et le nombre d'entrées.
CREATE TABLE IF NOT EXISTS cam_dispatcher (
    id        INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    table_va  INTEGER NOT NULL,
    cmd_count INTEGER NOT NULL,
    is_camera INTEGER NOT NULL DEFAULT 0,
    UNIQUE(source_id, name)
);

-- Adresses notables du reverse caméra (entrée du dispatcher, loader G4, table de magics,
-- réservoir funcLua…). `file_offset` est NULL quand la VA tombe en BSS.
CREATE TABLE IF NOT EXISTS cam_re_symbol (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    va          INTEGER NOT NULL,
    file_offset INTEGER,
    section     TEXT,
    kind        TEXT NOT NULL,            -- entry | routine | table | string | loader
    note        TEXT,
    UNIQUE(source_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cam_re_symbol_va ON cam_re_symbol(va);

-- Les ~250 noms de paramètres caméra trouvés dans .rdata, classés par domaine.
CREATE TABLE IF NOT EXISTS cam_param (
    id        INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    va        INTEGER,
    section   TEXT,
    domain    TEXT NOT NULL,              -- chase | shake | goal | fade | input | photo | hud | …
    UNIQUE(source_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cam_param_domain ON cam_param(domain);
CREATE INDEX IF NOT EXISTS idx_cam_param_name ON cam_param(name);

-- Commandes d'entrée CMD_CAMERA_* et caméras nommées de la scène.
CREATE TABLE IF NOT EXISTS cam_symbol_list (
    id        INTEGER PRIMARY KEY,
    source_id INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL,              -- input_command | scene_camera | lua_command
    name      TEXT NOT NULL,
    va        INTEGER,
    UNIQUE(source_id, kind, name)
);

-- ---------------------------------------------------------------------------
-- 2. Fichiers de données caméra
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cam_asset (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,            -- chemin VFS interne (sans « data/ »)
    role        TEXT,
    present     INTEGER NOT NULL DEFAULT 0,
    size        INTEGER,
    sha256      TEXT,
    format      TEXT,                     -- RDBN | T2B | G4CM | LUA
    UNIQUE(source_id, path)
);
CREATE INDEX IF NOT EXISTS idx_cam_asset_present ON cam_asset(present);

-- ---------------------------------------------------------------------------
-- 3. soccer_camera_config — caméras de match
-- ---------------------------------------------------------------------------

-- SOCCER_CAMERA_INFO_DATA : le jeu de paramètres complet (138 lignes).
CREATE TABLE IF NOT EXISTS cam_soccer_data (
    id                   INTEGER PRIMARY KEY,
    asset_id             INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx              INTEGER NOT NULL,
    no                   INTEGER NOT NULL,
    length               REAL NOT NULL,
    length_min           REAL NOT NULL,
    length_max           REAL NOT NULL,
    rot_x                REAL NOT NULL,
    rot_x_min            REAL NOT NULL,
    rot_x_max            REAL NOT NULL,
    rot_y                REAL NOT NULL,
    rot_y_min            REAL NOT NULL,
    rot_y_max            REAL NOT NULL,
    offence_offset_rot_y REAL NOT NULL,
    defence_offset_rot_y REAL NOT NULL,
    fov                  REAL NOT NULL,
    ref_offset_x         REAL NOT NULL,
    ref_offset_y         REAL NOT NULL,
    ref_offset_z         REAL NOT NULL,
    off_ref_offset_x     REAL NOT NULL,
    off_ref_offset_y     REAL NOT NULL,
    off_ref_offset_z     REAL NOT NULL,
    def_ref_offset_x     REAL NOT NULL,
    def_ref_offset_y     REAL NOT NULL,
    def_ref_offset_z     REAL NOT NULL,
    ref_offset_length    REAL NOT NULL,
    move_interp_rate     REAL NOT NULL,
    rot_interp_rate      REAL NOT NULL,
    zoom_interp_rate     REAL NOT NULL,
    UNIQUE(asset_id, row_idx)
);

-- SOCCER_CAMERA_INFO / FIX_POS_CAMERA_INFO / CINEMATIC_CAMERA_INFO : un hash et la
-- tranche [offset, count] qu'il désigne dans la table de données correspondante.
CREATE TABLE IF NOT EXISTS cam_soccer_ref (
    id           INTEGER PRIMARY KEY,
    asset_id     INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    list_name    TEXT NOT NULL,           -- m_soccerCameraInfoList | m_soccerFixPosCameraInfoList | …
    row_idx      INTEGER NOT NULL,
    cam_id       INTEGER NOT NULL,        -- hash u32
    slice_offset INTEGER NOT NULL,
    slice_count  INTEGER NOT NULL,
    UNIQUE(asset_id, list_name, row_idx)
);
CREATE INDEX IF NOT EXISTS idx_cam_soccer_ref_id ON cam_soccer_ref(cam_id);

CREATE TABLE IF NOT EXISTS cam_goalnet (
    id                        INTEGER PRIMARY KEY,
    asset_id                  INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx                   INTEGER NOT NULL,
    cam_id                    INTEGER NOT NULL,
    pos_x REAL NOT NULL, pos_y REAL NOT NULL, pos_z REAL NOT NULL,
    ref_offset_x REAL NOT NULL, ref_offset_y REAL NOT NULL, ref_offset_z REAL NOT NULL,
    fov                       REAL NOT NULL,
    chase_max_speed           REAL NOT NULL,
    not_follow_after_bouncing INTEGER NOT NULL,
    fixed_ref_x INTEGER NOT NULL, fixed_ref_y INTEGER NOT NULL, fixed_ref_z INTEGER NOT NULL,
    init_ref_goal_line        INTEGER NOT NULL,
    UNIQUE(asset_id, row_idx)
);

CREATE TABLE IF NOT EXISTS cam_aerial (
    id           INTEGER PRIMARY KEY,
    asset_id     INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx      INTEGER NOT NULL,
    cam_id       INTEGER NOT NULL,
    cam_length   REAL NOT NULL,
    pos_x REAL NOT NULL, pos_y REAL NOT NULL, pos_z REAL NOT NULL,
    rot_x_start REAL NOT NULL, rot_x_end REAL NOT NULL,
    rot_y_start REAL NOT NULL, rot_y_end REAL NOT NULL,
    UNIQUE(asset_id, row_idx)
);

-- Association stade → vue aérienne (110 lignes).
CREATE TABLE IF NOT EXISTS cam_aerial_map (
    id                 INTEGER PRIMARY KEY,
    asset_id           INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx            INTEGER NOT NULL,
    map_id             INTEGER NOT NULL,
    aerial_cam_info_id INTEGER NOT NULL,
    light_overwrite_id INTEGER NOT NULL,
    UNIQUE(asset_id, row_idx)
);
CREATE INDEX IF NOT EXISTS idx_cam_aerial_map_id ON cam_aerial_map(map_id);

CREATE TABLE IF NOT EXISTS cam_dir (
    id          INTEGER PRIMARY KEY,
    asset_id    INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx     INTEGER NOT NULL,
    dir_cam_id  INTEGER NOT NULL,
    hor_cam_id  INTEGER NOT NULL,
    vert_cam_id INTEGER NOT NULL,
    UNIQUE(asset_id, row_idx)
);

CREATE TABLE IF NOT EXISTS cam_fixpos_data (
    id                    INTEGER PRIMARY KEY,
    asset_id              INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx               INTEGER NOT NULL,
    cam_id                INTEGER NOT NULL,
    ref_offset_x REAL NOT NULL, ref_offset_y REAL NOT NULL, ref_offset_z REAL NOT NULL,
    cam_pos_offset_x REAL NOT NULL, cam_pos_offset_y REAL NOT NULL, cam_pos_offset_z REAL NOT NULL,
    move_vec_offset_x REAL NOT NULL, move_vec_offset_y REAL NOT NULL, move_vec_offset_z REAL NOT NULL,
    cam_roll              REAL NOT NULL,
    fov                   REAL NOT NULL,
    offset_length         REAL NOT NULL,
    offset_time           REAL NOT NULL,
    condition_area_radius REAL NOT NULL,
    enable_interp         INTEGER NOT NULL,
    move_ref_pos_only     INTEGER NOT NULL,
    move_type             INTEGER NOT NULL,
    curvature             REAL NOT NULL,
    UNIQUE(asset_id, row_idx)
);

CREATE TABLE IF NOT EXISTS cam_cinematic_data (
    id              INTEGER PRIMARY KEY,
    asset_id        INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx         INTEGER NOT NULL,
    weight          INTEGER NOT NULL,
    change_recast   REAL NOT NULL,
    chase_camera_id INTEGER NOT NULL,
    fix_camera_id   INTEGER NOT NULL,
    UNIQUE(asset_id, row_idx)
);

CREATE TABLE IF NOT EXISTS cam_cinematic_situation (
    id             INTEGER PRIMARY KEY,
    asset_id       INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    row_idx        INTEGER NOT NULL,
    situation_type INTEGER NOT NULL,
    slice_offset   INTEGER NOT NULL,
    slice_count    INTEGER NOT NULL,
    UNIQUE(asset_id, row_idx)
);

-- ---------------------------------------------------------------------------
-- 4. Presets de contrôleur (camera_ctrl_property_info*, *_property)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cam_preset (
    id       INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES cam_asset(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,               -- CCameraCtrlChase_Soccer
    parent   TEXT,                        -- CCameraCtrlChase
    context  TEXT NOT NULL,               -- default | photo | rpg_battle | craft_edit | screenshot | soccer
    UNIQUE(asset_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cam_preset_name ON cam_preset(name);

-- Un paramètre de preset. `inherited = 1` quand la valeur vient d'un ancêtre : la table
-- porte donc l'état DÉCLARÉ (inherited = 0) et l'état EFFECTIF (les deux) — la vue
-- `v_cam_preset_effective` ne rend que l'effectif.
CREATE TABLE IF NOT EXISTS cam_preset_param (
    id        INTEGER PRIMARY KEY,
    preset_id INTEGER NOT NULL REFERENCES cam_preset(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    ty        TEXT NOT NULL,              -- int | float | vec3 | text
    v_int     INTEGER,
    v_f0      REAL,
    v_f1      REAL,
    v_f2      REAL,
    v_text    TEXT,
    inherited INTEGER NOT NULL DEFAULT 0,
    from_preset TEXT,                     -- preset d'origine quand inherited = 1
    UNIQUE(preset_id, name, inherited)
);
CREATE INDEX IF NOT EXISTS idx_cam_preset_param_name ON cam_preset_param(name);

-- ---------------------------------------------------------------------------
-- 5. Animations .g4cm
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cam_anim (
    id            INTEGER PRIMARY KEY,
    source_id     INTEGER REFERENCES cam_source(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,          -- chemin VFS interne
    event_id      TEXT,                   -- ev74_01170, extrait du chemin
    size          INTEGER NOT NULL,
    sha256        TEXT,
    version       INTEGER NOT NULL,       -- champ 0x06 (0x68)
    align         INTEGER NOT NULL,
    n_objects     INTEGER NOT NULL,
    n_channels    INTEGER NOT NULL,
    n_times       INTEGER NOT NULL,
    frame_min     INTEGER,
    frame_max     INTEGER,
    n_samples     INTEGER NOT NULL DEFAULT 0,
    decoded_ratio REAL NOT NULL DEFAULT 0.0,  -- part d'échantillons en f32 (donc décodés)
    roundtrip_ok  INTEGER NOT NULL DEFAULT 0, -- 1 si decode→encode rend le fichier à l'octet près
    UNIQUE(source_id, path)
);
CREATE INDEX IF NOT EXISTS idx_cam_anim_event ON cam_anim(event_id);
CREATE INDEX IF NOT EXISTS idx_cam_anim_ratio ON cam_anim(decoded_ratio);

CREATE TABLE IF NOT EXISTS cam_anim_object (
    id            INTEGER PRIMARY KEY,
    anim_id       INTEGER NOT NULL REFERENCES cam_anim(id) ON DELETE CASCADE,
    obj_idx       INTEGER NOT NULL,
    name          TEXT NOT NULL,          -- c0010, c0100 …
    first_channel INTEGER NOT NULL,
    channel_count INTEGER NOT NULL,
    clip_start    INTEGER,
    clip_end      INTEGER,
    clip_flags    INTEGER,
    UNIQUE(anim_id, obj_idx)
);
CREATE INDEX IF NOT EXISTS idx_cam_anim_object_name ON cam_anim_object(name);

-- Un canal d'animation. `encoding` vaut f32 (décodé), raw16 ou raw8 (encodage non résolu,
-- octets conservés). `v_min`/`v_max` ne sont renseignés que pour f32.
CREATE TABLE IF NOT EXISTS cam_anim_channel (
    id           INTEGER PRIMARY KEY,
    anim_id      INTEGER NOT NULL REFERENCES cam_anim(id) ON DELETE CASCADE,
    object_id    INTEGER REFERENCES cam_anim_object(id) ON DELETE CASCADE,
    chan_idx     INTEGER NOT NULL,        -- index global dans le fichier
    kind_code    INTEGER NOT NULL,        -- 0x16 … 0x1F
    kind         TEXT NOT NULL,           -- posX | posY | posZ | refX | refY | refZ | fov | roll
    mode         INTEGER NOT NULL,        -- octet 1, interpolation présumée
    encoding     TEXT NOT NULL,           -- f32 | raw16 | raw8
    elem_size    INTEGER NOT NULL,
    sample_count INTEGER NOT NULL,
    time_index   INTEGER NOT NULL,
    value_offset INTEGER NOT NULL,
    frame_first  INTEGER,
    frame_last   INTEGER,
    v_min        REAL,
    v_max        REAL,
    UNIQUE(anim_id, chan_idx)
);
CREATE INDEX IF NOT EXISTS idx_cam_anim_channel_kind ON cam_anim_channel(kind);
CREATE INDEX IF NOT EXISTS idx_cam_anim_channel_enc ON cam_anim_channel(encoding);

-- Les échantillons, un par keyframe. Volumineux (millions de lignes sur le corpus
-- complet) : peuplé seulement sur demande (`nie-cam index --samples`).
-- `v_f32` porte la valeur quand le canal est décodé ; `v_raw` l'entier brut sinon.
CREATE TABLE IF NOT EXISTS cam_anim_sample (
    channel_id INTEGER NOT NULL REFERENCES cam_anim_channel(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    frame      INTEGER,
    v_f32      REAL,
    v_raw      INTEGER,
    PRIMARY KEY (channel_id, idx)
) WITHOUT ROWID;

-- ---------------------------------------------------------------------------
-- 6. Vues
-- ---------------------------------------------------------------------------

-- Hiérarchie des contrôleurs, à plat, avec le chemin d'héritage complet.
CREATE VIEW IF NOT EXISTS v_cam_ctrl_hierarchy AS
WITH RECURSIVE chain(cpp_name, short_name, ported, root, path, depth) AS (
    SELECT cpp_name, short_name, ported, cpp_name, cpp_name, 0
      FROM cam_ctrl_class WHERE base IS NULL
    UNION ALL
    SELECT c.cpp_name, c.short_name, c.ported, ch.root, ch.path || ' > ' || c.cpp_name, ch.depth + 1
      FROM cam_ctrl_class c JOIN chain ch ON c.base = ch.cpp_name
)
SELECT cpp_name, short_name, ported, depth, path FROM chain;

-- Paramètres effectifs d'un preset (déclarés + hérités), un par nom.
CREATE VIEW IF NOT EXISTS v_cam_preset_effective AS
SELECT p.id           AS preset_id,
       p.name         AS preset,
       p.context      AS context,
       pp.name        AS param,
       pp.ty          AS ty,
       pp.v_int       AS v_int,
       pp.v_f0        AS v_f0,
       pp.v_f1        AS v_f1,
       pp.v_f2        AS v_f2,
       pp.v_text      AS v_text,
       pp.inherited   AS inherited,
       pp.from_preset AS from_preset
  FROM cam_preset p
  JOIN cam_preset_param pp ON pp.preset_id = p.id;

-- Une ligne par caméra logique de match, avec ses paramètres résolus par la tranche.
CREATE VIEW IF NOT EXISTS v_cam_soccer_resolved AS
SELECT r.cam_id       AS cam_id,
       r.list_name    AS list_name,
       r.row_idx      AS ref_row,
       d.row_idx      AS data_row,
       d.length, d.length_min, d.length_max,
       d.rot_x, d.rot_y, d.fov,
       d.move_interp_rate, d.rot_interp_rate, d.zoom_interp_rate
  FROM cam_soccer_ref r
  JOIN cam_soccer_data d
    ON d.asset_id = r.asset_id
   AND d.row_idx >= r.slice_offset
   AND d.row_idx <  r.slice_offset + r.slice_count;

-- Bilan par type de canal : combien de canaux, combien d'échantillons, quelle part décodée.
CREATE VIEW IF NOT EXISTS v_cam_channel_stats AS
SELECT kind,
       encoding,
       COUNT(*)            AS n_channels,
       SUM(sample_count)   AS n_samples,
       MIN(v_min)          AS v_min,
       MAX(v_max)          AS v_max
  FROM cam_anim_channel
 GROUP BY kind, encoding;

-- Couverture globale de l'indexation caméra — la question « où en est-on ? » en une ligne.
CREATE VIEW IF NOT EXISTS v_cam_coverage AS
SELECT (SELECT COUNT(*) FROM cam_anim)                                   AS anims,
       (SELECT COUNT(*) FROM cam_anim WHERE roundtrip_ok = 1)            AS anims_roundtrip_ok,
       (SELECT COUNT(*) FROM cam_anim_channel)                           AS channels,
       (SELECT COUNT(*) FROM cam_anim_channel WHERE encoding = 'f32')    AS channels_decoded,
       (SELECT COALESCE(SUM(sample_count), 0) FROM cam_anim_channel)     AS samples_total,
       (SELECT COALESCE(SUM(sample_count), 0) FROM cam_anim_channel
         WHERE encoding = 'f32')                                         AS samples_decoded,
       (SELECT COUNT(*) FROM cam_ctrl_class)                             AS ctrl_classes,
       (SELECT COUNT(*) FROM cam_ctrl_class WHERE ported = 1)            AS ctrl_ported,
       (SELECT COUNT(*) FROM cam_param)                                  AS params,
       (SELECT COUNT(*) FROM cam_preset)                                 AS presets,
       (SELECT COUNT(*) FROM cam_asset WHERE present = 1)                AS assets_present,
       (SELECT COUNT(*) FROM cam_asset)                                  AS assets_known;
