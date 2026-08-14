//! Ingestion dans `hash_name` des noms de l'UI lus depuis le VFS.
//!
//! ## Pourquoi
//!
//! Le jeu désigne presque tout par un CRC-32 : un calque de menu, un groupe, une commande, une
//! texture à échanger. La table `hash_name` de la base de connaissance existe pour inverser ces
//! hachages, mais seul `nie-seed` l'alimentait, depuis les identifiants inagle (personnages,
//! quêtes) — côté UI elle était **vide**, et un `0x0BF14058` croisé dans un `cfg.bin` ou un
//! `objbin` restait un nombre.
//!
//! Or les noms existent en clair dans les fichiers : un `MENU_LAYER_INFO` porte
//! `(CRC32(nom), nom)` côte à côte, un `.objbin` nomme son objet et ses composants, un `.g4tx`
//! nomme ses textures et ses régions. Ce module les récolte et les ingère, ce qui rend
//! résolvables les hachages rencontrés partout ailleurs.
//!
//! ## Vérification intégrée
//!
//! Pour les calques et les groupes, le fichier donne le hash ET le nom : on peut donc vérifier
//! `CRC32(nom) == hash` au lieu de le supposer. Les désaccords sont comptés (`crc_mismatch`) et
//! **ingérés quand même sous le hash du fichier** — c'est lui que le moteur utilise. Pour les
//! autres familles, le hash est calculé depuis le nom.

use anyhow::{Context, Result};
use nie_formats::cfgbin::{self, CfgEntry, Value};
use nie_formats::vfs::Vfs;
use nie_formats::{g4tx, objbin};

/// Étiquette de provenance écrite dans `hash_name.source`.
const SOURCE: &str = "vfs-ui";

/// Compteurs d'une passe d'ingestion.
#[derive(Debug, Default, Clone)]
pub struct Stats {
    /// Écrans `*_setting.cfg.bin` lus.
    pub screens: usize,
    /// Fichiers `.objbin` lus.
    pub objbins: usize,
    /// Conteneurs `.g4tx` lus (0 sans `--textures`).
    pub g4tx: usize,
    /// Noms ingérés, par `kind`.
    pub par_kind: Vec<(&'static str, usize)>,
    /// Lignes insérées (hors doublons ignorés par `INSERT OR IGNORE`).
    pub inserted: usize,
    /// Couples (hash, nom) du fichier où `CRC32(nom) != hash`.
    pub crc_mismatch: usize,
    /// Fichiers illisibles ou non parsables, sautés.
    pub skipped: usize,
}

impl Stats {
    fn bump(&mut self, kind: &'static str) {
        match self.par_kind.iter_mut().find(|(k, _)| *k == kind) {
            Some((_, n)) => *n += 1,
            None => self.par_kind.push((kind, 1)),
        }
    }
}

/// Première variable `String` d'une entrée, si elle existe et n'est pas vide.
fn first_string(e: &CfgEntry) -> Option<&str> {
    e.variables.iter().find_map(|v| match v {
        Value::String(s) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    })
}

/// Première variable `Int` d'une entrée.
fn first_int(e: &CfgEntry) -> Option<i32> {
    e.variables.iter().find_map(|v| match v {
        Value::Int(i) => Some(*i),
        _ => None,
    })
}

/// Visite récursive de l'arbre T2B.
fn walk<'a>(entries: &'a [CfgEntry], f: &mut impl FnMut(&'a CfgEntry)) {
    for e in entries {
        f(e);
        walk(&e.children, f);
    }
}

/// Contexte d'insertion : porte la connexion et les compteurs.
struct Sink<'a> {
    // `nie_index` réexporte `rusqlite` : inutile d'ajouter la dépendance à ce crate.
    conn: &'a nie_index::rusqlite::Connection,
    stats: Stats,
}

impl Sink<'_> {
    /// Ingère `nom` sous `kind`, avec le hash **calculé** depuis le nom.
    fn add(&mut self, kind: &'static str, name: &str) -> Result<()> {
        if name.is_empty() {
            return Ok(());
        }
        let hash = i64::from(cfgbin::crc32(name.as_bytes()));
        self.insert(kind, name, hash)
    }

    /// Ingère `nom` sous `kind` avec un hash **imposé par le fichier**, en vérifiant l'accord
    /// avec `CRC32(nom)`.
    fn add_verified(&mut self, kind: &'static str, name: &str, file_hash: i64) -> Result<()> {
        if name.is_empty() {
            return Ok(());
        }
        if i64::from(cfgbin::crc32(name.as_bytes())) != file_hash {
            self.stats.crc_mismatch += 1;
        }
        self.insert(kind, name, file_hash)
    }

    fn insert(&mut self, kind: &'static str, name: &str, hash: i64) -> Result<()> {
        nie_index::ingest::hash_name(self.conn, hash, kind, name, SOURCE)
            .with_context(|| format!("hash_name({kind}, {name})"))?;
        self.stats.bump(kind);
        Ok(())
    }
}

/// Récolte les noms de l'UI depuis `vfs` et les ingère dans `hash_name`.
///
/// `with_textures` inclut le scan des `.g4tx` du menu (noms de textures et de régions) : c'est
/// la partie coûteuse, des dizaines de milliers de fichiers à décompresser depuis les CPK.
pub fn run(db: &nie_index::Db, vfs: &Vfs, with_textures: bool) -> Result<Stats> {
    // Le parcours est figé d'abord : `vfs.iter()` emprunte le VFS, et on lit pendant la boucle.
    let mut cfgs: Vec<String> = Vec::new();
    let mut objs: Vec<String> = Vec::new();
    let mut texs: Vec<String> = Vec::new();
    for (path, _) in vfs.iter() {
        if path.starts_with("data/common/gamedata/menu/cfg/") && path.ends_with("_setting.cfg.bin")
        {
            cfgs.push(path.to_string());
        } else if path.starts_with("data/common/gamedata/menu/obj/") && path.ends_with(".objbin") {
            objs.push(path.to_string());
        } else if with_textures
            && path.starts_with("data/dx11/menu/")
            && path.ends_with(".g4tx")
        {
            texs.push(path.to_string());
        }
    }
    cfgs.sort_unstable();
    objs.sort_unstable();
    texs.sort_unstable();

    let conn = db.conn();
    conn.execute_batch("BEGIN")?;
    let mut sink = Sink { conn, stats: Stats::default() };

    for path in &cfgs {
        let Ok(bytes) = vfs.read(path) else {
            sink.stats.skipped += 1;
            continue;
        };
        let Ok(file) = cfgbin::parse_t2b(&bytes) else {
            sink.stats.skipped += 1;
            continue;
        };
        sink.stats.screens += 1;

        // Nav-hash d'écran : le stem du fichier (`main_menu` pour `main_menu_setting.cfg.bin`).
        if let Some(stem) = path
            .rsplit('/')
            .next()
            .and_then(|f| f.strip_suffix("_setting.cfg.bin"))
        {
            sink.add("menu_screen", stem)?;
        }

        // Calques et groupes : le fichier porte (hash, nom) côte à côte — on vérifie.
        let mut pending: Vec<(&'static str, String, i64)> = Vec::new();
        walk(&file.entries, &mut |e: &CfgEntry| {
            let kind = if e.name.starts_with("MENU_LAYER_INFO") {
                "menu_layer"
            } else if e.name.starts_with("MENU_LAYER_GROUP")
                && !e.name.starts_with("MENU_LAYER_GROUP_BASE")
                && !e.name.contains("_REF_")
            {
                "menu_group"
            } else if e.name.starts_with("MENU_CMD_INFO") {
                "menu_cmd"
            } else {
                return;
            };
            if e.name.contains("LIST_BEG") || e.name.contains("LIST_END") {
                return;
            }
            let (Some(name), Some(hash)) = (first_string(e), first_int(e)) else {
                return;
            };
            // `MENU_CMD_INFO` porte le nom symbolique de la commande (`CMD_FCS_BACK`), dont le
            // hash n'est PAS var[0] (celui-là est le calque porteur) : on le calcule.
            if kind == "menu_cmd" {
                pending.push((kind, name.to_string(), -1));
            } else {
                pending.push((kind, name.to_string(), i64::from(u32::from_ne_bytes(hash.to_ne_bytes()))));
            }
        });
        for (kind, name, hash) in pending {
            if hash < 0 {
                sink.add(kind, &name)?;
            } else {
                sink.add_verified(kind, &name, hash)?;
            }
        }
    }

    for path in &objs {
        let Ok(bytes) = vfs.read(path) else {
            sink.stats.skipped += 1;
            continue;
        };
        let Ok(obj) = objbin::parse(&bytes) else {
            sink.stats.skipped += 1;
            continue;
        };
        sink.stats.objbins += 1;
        sink.add("menu_obj", &obj.name)?;
        for c in &obj.components {
            // Le `type_name` d'un composant EST un nom de classe RTTI du binaire : l'ingérer
            // rend le pont objbin -> nie.exe interrogeable par hash comme par nom.
            sink.add("menu_component", component_type_name(c))?;
        }
    }

    for path in &texs {
        let Ok(bytes) = vfs.read(path) else {
            sink.stats.skipped += 1;
            continue;
        };
        let Ok(tx) = g4tx::parse(&bytes) else {
            sink.stats.skipped += 1;
            continue;
        };
        sink.stats.g4tx += 1;
        for t in &tx.textures {
            sink.add("texture", &t.name)?;
            for r in &t.sub_textures {
                sink.add("texture_region", &r.name)?;
            }
        }
    }

    let mut stats = sink.stats;
    conn.execute_batch("COMMIT")?;
    stats.inserted = conn.query_row(
        "SELECT COUNT(*) FROM hash_name WHERE source = ?1",
        [SOURCE],
        |r| r.get::<_, i64>(0),
    )? as usize;
    Ok(stats)
}

/// Nom RTTI d'un composant, quelle que soit sa variante.
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
