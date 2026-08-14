//! `niers mode` — catalogue des **modes de jeu** : écrans, calques, objets, assets et scripts.
//!
//! ## Ce qu'est un « mode » ici
//!
//! Une entrée du menu principal (une tuile de `mode_base01_atl`, cf. `mainmenu90_01.g4tx`).
//! Le jeu ne stocke nulle part la liste en clair : le script `main_menu` désigne ses onglets par
//! un `TAB_TYPE` **entier**, et l'include ne porte aucune chaîne exploitable. La liste des modes
//! est donc **éditoriale** — [`MODES`] ci-dessous — mais chaque entrée est adossée à des écrans
//! `*_setting.cfg.bin` qui existent réellement dans le VFS ; l'agrégation, elle, est mécanique.
//!
//! Le cas `victory_road` montre pourquoi une liste curatée est nécessaire : ses assets vivent
//! sous **quatre** orthographes (`victory_road`, `victory_load`, `victory_lode`, `vroad`)
//! qu'aucune règle de préfixe ne relierait automatiquement.
//!
//! ## Agrégation
//!
//! Pour chaque mode : écrans (par préfixe) → calques (`MENU_LAYER_INFO`) → objbin → `g4pkm` /
//! `g4tx` référencés, plus les scripts Lua de même préfixe. Tout est écrit dans `mode`,
//! `mode_screen` et `mode_asset`.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};
use nie_formats::cfgbin::{self, CfgEntry, Value};
use nie_formats::vfs::Vfs;
use nie_formats::objbin;

/// Définition éditoriale d'un mode.
pub struct ModeDef {
    /// Identifiant stable, utilisable en URL (`victory-road`).
    pub slug: &'static str,
    /// Nom de repli, si le jeu ne fournit pas de libellé pour ce mode.
    pub label: &'static str,
    /// Préfixes de noms d'écran/script qui appartiennent à ce mode.
    pub prefixes: &'static [&'static str],
    /// Région de l'atlas `mode_base01_atl` qui porte l'icône, si identifiée.
    pub icon_region: Option<&'static str>,
    /// Hash `menu_text` du libellé officiel — le nom que le JEU affiche, résolu à l'indexation
    /// dans les trois locales plutôt que recopié ici.
    pub text_hash: Option<u32>,
    /// Vrai si le jeu énumère lui-même ce mode dans ses réglages audio (cf. [`MODES`]).
    pub official: bool,
    /// Ce que les fichiers permettent d'affirmer sur l'état du mode.
    pub note: &'static str,
}

/// Les modes, chacun adossé à des écrans réels du VFS.
///
/// **Les cinq modes marqués `official` ne sont pas un choix éditorial** : le jeu les énumère
/// lui-même dans `menu_text`, via trois familles de réglages concordantes — « BGM Volume (X) »,
/// « Character Voice Volume (X) » et « Power List Display (X) ». Cette liste a corrigé la
/// première version de ce fichier : `Competition Mode` y manquait, et le mode nommé
/// « Kizuna Station » y était confondu avec le lieu « Bond Town » (FR « Ville Kizuna »), qui est
/// un libellé distinct.
///
/// Les autres entrées sont des écrans utilitaires du menu principal — utiles à cataloguer, mais
/// que le jeu ne compte pas parmi ses modes.
///
/// `icon_region` n'est renseignée que pour les tuiles identifiées **visuellement** sur une
/// capture du menu ; les autres restent `None` plutôt que devinées.
pub const MODES: &[ModeDef] = &[
    ModeDef {
        slug: "victory-road",
        label: "Victory Road",
        prefixes: &[
            "victory_road",
            "victory_load",
            "victory_lode",
            "fake_vroad",
            "vroad_",
            "fade_menu_encount_victory_road",
        ],
        icon_region: Some("mode_base04"),
        text_hash: Some(0x80cd_176b),
        official: true,
        note: "Tournoi en ligne en trois phases (inscription, qualifications, classement final). \
               Les ecrans `fake_vroad_*` sont des MAQUETTES posees sous soccer99_*, sans texture \
               propre ; le mode lui-meme ne l'est pas : ses assets vivent sous \
               `menu/75_vroad/` (vroad01..vroad50) et ses 28 ecrans couvrent entree, tournoi \
               final, classement, recompenses, region, photo et notifications. \
               `VictoryRoad` est l'orthographe canonique cote code — `nie.exe` porte \
               BGMVolVictoryRoad / SEVolVictoryRoad / VoiceVolVictoryRoad et 152 symboles \
               *VictoryRoad* (machines a etats, menus, erreurs reseau `sysmes_vroad_err_*`) ; \
               `VictoryLoad` n'y figure PAS. `victory_load`, `victory_lode` et `vroad` ne sont \
               que des variantes cote assets.",
    },
    ModeDef {
        slug: "competition",
        label: "Mode Compétition",
        prefixes: &[],
        icon_region: None,
        text_hash: Some(0x6e14_cca7),
        official: true,
        note: "Nomme par `menu_text`, mais AUCUN ecran ne porte ce nom dans le VFS, et le \
               binaire n'a PAS de cle de reglage a son nom : `nie.exe` porte BGMVol/SEVol/\
               VoiceVol pour Chronicle, KizunaStation, Story et VictoryRoad — pas pour lui. \
               Comme les modes en ligne (`lobby`, `ranked`, `bot_match`, tous absents), son \
               contenu n'est pas dans les fichiers installes.",
    },
    ModeDef {
        slug: "story",
        label: "Histoire",
        prefixes: &["story_mode"],
        icon_region: None,
        text_hash: Some(0x76db_0fff),
        official: true,
        note: "Ecran story_mode_top_menu.",
    },
    ModeDef {
        slug: "chronicle",
        label: "Mode Chronique",
        prefixes: &["chronicle_mode"],
        icon_region: Some("mode_base07"),
        text_hash: Some(0xce37_875a),
        official: true,
        note: "Ecrans chronicle_mode_top_menu et chronicle_mode_soccer_vs_menu ; \
               images dediees sous 220_img/ev_chronicle_img (943 fichiers).",
    },
    ModeDef {
        slug: "kizuna-station",
        label: "Station Kizuna",
        prefixes: &["kizuna_town"],
        icon_region: None,
        text_hash: Some(0x126c_915e),
        official: true,
        note: "Le MODE s'appelle « Station Kizuna » ; le LIEU qu'il ouvre est « Ville Kizuna » \
               (EN Bond Town), un libelle distinct. Ses ecrans portent le prefixe kizuna_town.",
    },
    ModeDef {
        slug: "soccer",
        label: "Match",
        prefixes: &["soccer_top_menu", "soccer_game_mode"],
        icon_region: Some("mode_base03"),
        text_hash: Some(0x848d_75db),
        official: false,
        note: "Entree des matchs (crampons + ballon sur la tuile). Le jeu ne le compte pas \
               parmi les modes de ses reglages audio.",
    },
    ModeDef {
        slug: "bb-stadium",
        label: "BB Stadium",
        prefixes: &["bb_stadium"],
        icon_region: Some("mode_base10"),
        text_hash: None,
        official: false,
        note: "Tuile au logo `BB`.",
    },
    ModeDef {
        slug: "play-guide",
        label: "Guide de jeu",
        prefixes: &["play_guide"],
        icon_region: Some("mode_base05"),
        text_hash: None,
        official: false,
        note: "Tuile au livre marque d'un point d'exclamation.",
    },
    ModeDef {
        slug: "setting",
        label: "Paramètres",
        prefixes: &["setting_top_menu"],
        icon_region: Some("mode_base06"),
        text_hash: Some(0x82c9_a2b3),
        official: false,
        note: "Tuile a l'engrenage.",
    },
    ModeDef {
        slug: "information",
        label: "Informations",
        prefixes: &["information_top_menu", "information_"],
        icon_region: Some("mode_base09"),
        text_hash: Some(0x1796_88e8),
        official: false,
        note: "Tuile au `i`.",
    },
    ModeDef {
        slug: "team-dock",
        label: "Équipe",
        prefixes: &["team_dock"],
        icon_region: None,
        text_hash: Some(0x7aae_281e),
        official: false,
        note: "Ecran commun de gestion d'equipe.",
    },
];

/// Locales dont on résout le libellé officiel.
const LOCALES: [&str; 3] = ["fr", "en", "ja"];

/// Charge `menu_text` d'une locale : `hash` → libellé.
///
/// Le fichier porte `TEXT_INFO_BEGIN > TEXT_INFO [hash, 0, texte]`. Absence = locale non
/// installee, ce qui n'est pas une erreur : le catalogue retombe sur le libellé de repli.
fn charger_menu_text(vfs: &Vfs, locale: &str) -> BTreeMap<u32, String> {
    let mut out = BTreeMap::new();
    let path = format!("data/common/text/{locale}/menu_text.cfg.bin");
    let Ok(bytes) = vfs.read(&path) else { return out };
    let Ok(file) = cfgbin::parse_t2b(&bytes) else { return out };
    walk(&file.entries, &mut |e: &CfgEntry| {
        if !e.name.starts_with("TEXT_INFO") || e.name.contains("BEGIN") || e.name.contains("END") {
            return;
        }
        let hash = e.variables.iter().find_map(|v| match v {
            Value::Int(i) => Some(u32::from_ne_bytes(i.to_ne_bytes())),
            _ => None,
        });
        let texte = e.variables.iter().rev().find_map(|v| match v {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            _ => None,
        });
        if let (Some(h), Some(t)) = (hash, texte) {
            out.insert(h, t);
        }
    });
    out
}

/// Ce qui a été trouvé pour un mode.
#[derive(Default)]
pub struct ModeFacts {
    /// Écrans `*_setting.cfg.bin` (stem → chemin VFS).
    pub screens: BTreeMap<String, String>,
    /// Calques déclarés par ces écrans.
    pub layers: BTreeSet<String>,
    /// Objbin résolus depuis les calques.
    pub objbins: BTreeSet<String>,
    /// `g4pkm` référencés par ces objbin.
    pub g4pkm: BTreeSet<String>,
    /// `g4tx` référencés (SETUP ou paramètre de composant).
    pub g4tx: BTreeSet<String>,
    /// Types de composants rencontrés (noms de classes RTTI).
    pub components: BTreeSet<String>,
    /// Scripts Lua de même préfixe.
    pub lua: BTreeSet<String>,
    /// Nombre d'éléments focusables cumulés.
    pub focus: usize,
    /// Slots de texte des composants `MenuTextSetting` : `(objet, slot, hash)`.
    ///
    /// Le hash se résout dans `menu_text` ; beaucoup pointent des guides de boutons
    /// (`<CMD_BACK|10>`), ce qui est une donnée en soi — c'est l'UI de l'écran.
    pub text_slots: BTreeSet<(String, String, u32)>,
}

fn first_string(e: &CfgEntry) -> Option<&str> {
    e.variables.iter().find_map(|v| match v {
        Value::String(s) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    })
}

fn walk<'a>(entries: &'a [CfgEntry], f: &mut impl FnMut(&'a CfgEntry)) {
    for e in entries {
        f(e);
        walk(&e.children, f);
    }
}

/// Vrai si `stem` relève d'un des préfixes du mode.
fn matches(def: &ModeDef, stem: &str) -> bool {
    def.prefixes.iter().any(|p| stem.starts_with(p))
}

/// Récolte les faits d'un mode depuis le VFS.
pub fn collect(vfs: &Vfs, def: &ModeDef) -> ModeFacts {
    let mut facts = ModeFacts::default();

    // Index des chemins utiles, figé avant lecture (`iter` emprunte le VFS).
    let mut cfg_paths: Vec<String> = Vec::new();
    let mut obj_paths: BTreeMap<String, String> = BTreeMap::new();
    for (path, _) in vfs.iter() {
        if path.starts_with("data/common/gamedata/menu/cfg/") && path.ends_with("_setting.cfg.bin")
        {
            cfg_paths.push(path.to_string());
        } else if path.starts_with("data/common/gamedata/menu/obj/") && path.ends_with(".objbin") {
            if let Some(stem) = path.rsplit('/').next().and_then(|f| f.strip_suffix(".objbin")) {
                obj_paths.insert(stem.to_string(), path.to_string());
            }
        } else if path.contains("/script/lua/")
            && path.ends_with(".lua.bin")
            && let Some(stem) = path.rsplit('/').next().and_then(|f| f.strip_suffix(".lua.bin"))
        {
            // Les scripts portent parfois un suffixe de version (`_1.02.92.00`) : on teste le
            // nom complet ET sa racine, sinon `main_menu_1.02.92.00` échapperait au préfixe.
            let base = stem
                .split_once(char::is_numeric)
                .map_or(stem, |(a, _)| a.trim_end_matches('_'));
            if matches(def, stem) || matches(def, base) {
                facts.lua.insert(path.to_string());
            }
        }
    }

    for path in cfg_paths {
        let Some(stem) = path
            .rsplit('/')
            .next()
            .and_then(|f| f.strip_suffix("_setting.cfg.bin"))
        else {
            continue;
        };
        if !matches(def, stem) {
            continue;
        }
        let Ok(bytes) = vfs.read(&path) else { continue };
        let Ok(file) = cfgbin::parse_t2b(&bytes) else { continue };
        facts.screens.insert(stem.to_string(), path.clone());

        walk(&file.entries, &mut |e: &CfgEntry| {
            if e.name.contains("LIST_BEG") || e.name.contains("LIST_END") {
                return;
            }
            if e.name.starts_with("MENU_LAYER_INFO")
                && let Some(n) = first_string(e)
            {
                facts.layers.insert(n.to_string());
            } else if e.name.starts_with("MENU_FOCUS_BASE_INFO") {
                facts.focus += 1;
            }
        });
    }

    // Calques -> objbin -> assets. Un calque nomme son objbin (même stem).
    for layer in facts.layers.clone() {
        let Some(p) = obj_paths.get(&layer) else { continue };
        facts.objbins.insert(p.clone());
        let Ok(bytes) = vfs.read(p) else { continue };
        let Ok(obj) = objbin::parse(&bytes) else { continue };
        if let Some(g) = &obj.g4pkm_path {
            facts.g4pkm.insert(g.clone());
        }
        if let Some(t) = &obj.g4tx_path {
            facts.g4tx.insert(t.clone());
        }
        for c in &obj.components {
            facts.components.insert(component_type_name(c).to_string());
            match c {
                // Depuis le correctif de préservation typée, un composant non reconnu expose ses
                // chaînes : c'est là que vivent les chemins de texture (`m_texPath`).
                objbin::MenuComponent::Unknown(u) => {
                    for s in u.strings() {
                        if s.ends_with(".g4tx") {
                            facts.g4tx.insert(s.to_string());
                        }
                    }
                }
                // Le pont UI -> texte : chaque slot porte le CRC-32 de son libellé.
                objbin::MenuComponent::Text(t) => {
                    for e in &t.entries {
                        for h in &e.hashes {
                            if *h != 0 {
                                facts.text_slots.insert((obj.name.clone(), e.key.clone(), *h));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    facts
}

fn component_type_name(c: &objbin::MenuComponent) -> &str {
    use objbin::MenuComponent as M;
    match c {
        M::Render(x) => &x.type_name,
        M::Animation(x) => &x.type_name,
        M::Text(x) => &x.type_name,
        M::Primitive(x) => &x.type_name,
        M::AttachLocator(x) => &x.type_name,
        M::Collision(x) => &x.type_name,
        M::SoundCmd(x) => &x.type_name,
        M::MeshVisible(x) => &x.type_name,
        M::Unknown(x) => &x.type_name,
    }
}

/// Crée les tables du catalogue si elles manquent.
///
/// Volontairement hors de `schema.sql` (nie-index) : ce catalogue est un produit de l'outillage
/// UI, pas du socle RE, et le poser ici évite de toucher un fichier partagé par d'autres
/// chantiers.
pub fn ensure_schema(conn: &nie_index::rusqlite::Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mode (
            id          INTEGER PRIMARY KEY,
            slug        TEXT NOT NULL UNIQUE,
            label       TEXT NOT NULL,
            label_en    TEXT,
            label_ja    TEXT,
            text_hash   INTEGER,
            official    INTEGER NOT NULL DEFAULT 0,
            icon_atlas  TEXT,
            icon_region TEXT,
            screens     INTEGER NOT NULL DEFAULT 0,
            layers      INTEGER NOT NULL DEFAULT 0,
            focus       INTEGER NOT NULL DEFAULT 0,
            note        TEXT
        );
        CREATE TABLE IF NOT EXISTS mode_screen (
            id       INTEGER PRIMARY KEY,
            mode_id  INTEGER NOT NULL REFERENCES mode(id) ON DELETE CASCADE,
            screen   TEXT NOT NULL,
            cfg_path TEXT NOT NULL,
            UNIQUE(mode_id, screen)
        );
        CREATE TABLE IF NOT EXISTS mode_asset (
            id      INTEGER PRIMARY KEY,
            mode_id INTEGER NOT NULL REFERENCES mode(id) ON DELETE CASCADE,
            kind    TEXT NOT NULL,
            path    TEXT NOT NULL,
            UNIQUE(mode_id, kind, path)
        );
        CREATE INDEX IF NOT EXISTS idx_mode_asset ON mode_asset(mode_id, kind);
        CREATE TABLE IF NOT EXISTS mode_text (
            id      INTEGER PRIMARY KEY,
            mode_id INTEGER NOT NULL REFERENCES mode(id) ON DELETE CASCADE,
            obj     TEXT NOT NULL,
            slot    TEXT NOT NULL,
            hash    INTEGER NOT NULL,
            locale  TEXT NOT NULL,
            text    TEXT NOT NULL,
            UNIQUE(mode_id, obj, slot, hash, locale)
        );
        CREATE INDEX IF NOT EXISTS idx_mode_text ON mode_text(mode_id, locale);",
    )
    .context("création des tables du catalogue de modes")?;
    Ok(())
}

/// Indexe tous les modes et écrit le catalogue. Renvoie (modes, écrans, assets).
pub fn index(db: &nie_index::Db, vfs: &Vfs) -> Result<(usize, usize, usize, usize)> {
    let conn = db.conn();
    ensure_schema(conn)?;
    conn.execute_batch("BEGIN")?;

    // Libellés officiels : le nom que le JEU affiche, dans les trois locales.
    let textes: Vec<(&str, BTreeMap<u32, String>)> =
        LOCALES.iter().map(|lg| (*lg, charger_menu_text(vfs, lg))).collect();
    let libelle = |lg: &str, h: Option<u32>| -> Option<String> {
        let h = h?;
        textes.iter().find(|(l, _)| *l == lg)?.1.get(&h).cloned()
    };

    let (mut n_modes, mut n_screens, mut n_assets, mut n_texts) = (0usize, 0usize, 0usize, 0usize);
    for def in MODES {
        let f = collect(vfs, def);
        // Le libellé du jeu prime sur le nom de repli ; s'il manque, on garde le nôtre.
        let label_fr = libelle("fr", def.text_hash).unwrap_or_else(|| def.label.to_string());
        conn.execute(
            "INSERT INTO mode(slug, label, label_en, label_ja, text_hash, official,
                              icon_atlas, icon_region, screens, layers, focus, note)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(slug) DO UPDATE SET
                label=excluded.label, label_en=excluded.label_en, label_ja=excluded.label_ja,
                text_hash=excluded.text_hash, official=excluded.official,
                icon_atlas=excluded.icon_atlas,
                icon_region=excluded.icon_region, screens=excluded.screens,
                layers=excluded.layers, focus=excluded.focus, note=excluded.note",
            nie_index::rusqlite::params![
                def.slug,
                label_fr,
                libelle("en", def.text_hash),
                libelle("ja", def.text_hash),
                def.text_hash.map(i64::from),
                i64::from(def.official),
                def.icon_region.map(|_| "data/dx11/menu/100_mainmenu/mainmenu90/mainmenu90_01/mainmenu90_01.g4tx"),
                def.icon_region,
                f.screens.len() as i64,
                f.layers.len() as i64,
                f.focus as i64,
                def.note,
            ],
        )?;
        let mode_id: i64 =
            conn.query_row("SELECT id FROM mode WHERE slug=?1", [def.slug], |r| r.get(0))?;

        for (stem, path) in &f.screens {
            conn.execute(
                "INSERT OR IGNORE INTO mode_screen(mode_id, screen, cfg_path) VALUES(?1,?2,?3)",
                nie_index::rusqlite::params![mode_id, stem, path],
            )?;
            n_screens += 1;
        }
        for (kind, set) in [
            ("layer", &f.layers),
            ("objbin", &f.objbins),
            ("g4pkm", &f.g4pkm),
            ("g4tx", &f.g4tx),
            ("component", &f.components),
            ("lua", &f.lua),
        ] {
            for p in set {
                conn.execute(
                    "INSERT OR IGNORE INTO mode_asset(mode_id, kind, path) VALUES(?1,?2,?3)",
                    nie_index::rusqlite::params![mode_id, kind, p],
                )?;
                n_assets += 1;
            }
        }
        // Textes d'interface de l'écran, résolus dans chaque locale disponible. Un slot dont le
        // hash n'est pas dans `menu_text` n'est PAS inséré : mieux vaut un trou visible qu'une
        // ligne vide qui se ferait passer pour un libellé.
        for (obj, slot, hash) in &f.text_slots {
            for (lg, table) in &textes {
                if let Some(t) = table.get(hash) {
                    conn.execute(
                        "INSERT OR IGNORE INTO mode_text(mode_id, obj, slot, hash, locale, text)
                         VALUES(?1,?2,?3,?4,?5,?6)",
                        nie_index::rusqlite::params![mode_id, obj, slot, i64::from(*hash), lg, t],
                    )?;
                    n_texts += 1;
                }
            }
        }

        n_modes += 1;
        println!(
            "  {} {:<15} ecrans={:<3} calques={:<4} objbin={:<4} g4pkm={:<4} g4tx={:<4} lua={:<3} focus={}",
            if def.official { "*" } else { " " },
            def.slug,
            f.screens.len(),
            f.layers.len(),
            f.objbins.len(),
            f.g4pkm.len(),
            f.g4tx.len(),
            f.lua.len(),
            f.focus
        );
    }

    conn.execute_batch("COMMIT")?;
    Ok((n_modes, n_screens, n_assets, n_texts))
}

/// Exporte le catalogue en JSON (pour azalée).
pub fn export_json(db: &nie_index::Db) -> Result<serde_json::Value> {
    let conn = db.conn();
    let mut stmt = conn.prepare(
        "SELECT id, slug, label, icon_atlas, icon_region, screens, layers, focus, note,
                label_en, label_ja, official
         FROM mode ORDER BY official DESC, slug",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, i64>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, i64>(7)?,
            r.get::<_, Option<String>>(8)?,
            r.get::<_, Option<String>>(9)?,
            r.get::<_, Option<String>>(10)?,
            r.get::<_, i64>(11)?,
        ))
    })?;

    let mut modes = Vec::new();
    for row in rows {
        let (id, slug, label, atlas, region, screens, layers, focus, note, en, ja, official) = row?;
        let mut screens_v = Vec::new();
        let mut s = conn.prepare(
            "SELECT screen, cfg_path FROM mode_screen WHERE mode_id=?1 ORDER BY screen",
        )?;
        for r in s.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (screen, cfg) = r?;
            screens_v.push(serde_json::json!({ "screen": screen, "cfg": cfg }));
        }
        let mut assets = serde_json::Map::new();
        let mut a = conn
            .prepare("SELECT kind, path FROM mode_asset WHERE mode_id=?1 ORDER BY kind, path")?;
        for r in a.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (kind, path) = r?;
            assets
                .entry(kind)
                .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                .as_array_mut()
                .expect("tableau")
                .push(serde_json::Value::String(path));
        }
        // Textes d'interface, regroupés par locale.
        let mut textes = serde_json::Map::new();
        let mut t = conn.prepare(
            "SELECT locale, obj, slot, text FROM mode_text WHERE mode_id=?1
             ORDER BY locale, obj, slot",
        )?;
        for r in t.query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })? {
            let (locale, obj, slot, texte) = r?;
            textes
                .entry(locale)
                .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                .as_array_mut()
                .expect("tableau")
                .push(serde_json::json!({ "obj": obj, "slot": slot, "text": texte }));
        }

        modes.push(serde_json::json!({
            "texts": textes,
            "slug": slug,
            "label": label,
            "labelEn": en,
            "labelJa": ja,
            "official": official != 0,
            "icon": { "atlas": atlas, "region": region },
            "counts": { "screens": screens, "layers": layers, "focus": focus },
            "note": note,
            "screens": screens_v,
            "assets": assets,
        }));
    }
    Ok(serde_json::json!({ "modes": modes }))
}
