//! VFS (Virtual File System) pour nie-formats.
//!
//! Reproduit fidèlement le comportement du VFS de nie.exe en chargeant
//! `cpk_list.cfg.bin` et en indexant et extrayant les fichiers des CPK du jeu.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use crate::cpk::CpkReader;
use crate::FormatError;

/// Budget mémoire du cache CPK (octets bruts cumulés), large pour garder un maximum de
/// CPK chauds en RAM (« tout chargé comme nie.exe »). Configurable via l'env
/// `NIE_CPK_CACHE_BUDGET_GIB` (défaut 16 Gio). L'éviction LRU n'intervient qu'au-delà :
/// borne de sécurité pour ne pas saturer l'hôte partagé (les 57 Go de CPK ne tiennent
/// pas dans les 45 Gio de la machine).
fn cpk_cache_budget() -> usize {
    let gib = std::env::var("NIE_CPK_CACHE_BUDGET_GIB")
        .ok()
        .and_then(|s| s.trim().parse::<usize>().ok())
        .filter(|&g| g > 0)
        .unwrap_or(16);
    gib.saturating_mul(1024 * 1024 * 1024)
}

/// Cache LRU borné des CPK chargés (nom CPK → lecteur + octets bruts). Évince le moins
/// récemment utilisé quand le total dépasse [`CPK_CACHE_BUDGET`]. Un `Arc` cloné par un
/// `read()` en cours garde sa donnée vivante même après éviction (extraction sûre).
struct CpkCache {
    map: HashMap<String, Arc<(CpkReader, Vec<u8>)>>,
    /// Ordre d'utilisation : avant = moins récent (candidat à l'éviction).
    order: VecDeque<String>,
    bytes: usize,
    budget: usize,
}

impl CpkCache {
    fn new(budget: usize) -> Self {
        Self { map: HashMap::new(), order: VecDeque::new(), bytes: 0, budget }
    }

    /// Récupère un CPK et le marque comme récemment utilisé.
    fn get(&mut self, key: &str) -> Option<Arc<(CpkReader, Vec<u8>)>> {
        let arc = self.map.get(key)?.clone();
        if let Some(pos) = self.order.iter().position(|k| k == key) {
            self.order.remove(pos);
        }
        self.order.push_back(key.to_string());
        Some(arc)
    }

    /// Insère un CPK et évince les moins récents tant que le budget est dépassé.
    fn insert(&mut self, key: String, arc: Arc<(CpkReader, Vec<u8>)>) {
        let size = arc.1.len();
        if let Some(old) = self.map.insert(key.clone(), arc) {
            self.bytes = self.bytes.saturating_sub(old.1.len());
            if let Some(pos) = self.order.iter().position(|k| k == &key) {
                self.order.remove(pos);
            }
        }
        self.bytes += size;
        self.order.push_back(key);
        while self.bytes > self.budget && self.order.len() > 1 {
            if let Some(old_key) = self.order.pop_front()
                && let Some(old) = self.map.remove(&old_key)
            {
                self.bytes = self.bytes.saturating_sub(old.1.len());
            }
        }
    }
}

/// Cache des CPK déjà chargés, borné LRU (cf. [`CpkCache`]).
type CpkCacheMap = Mutex<CpkCache>;

/// Entrée du VFS.
#[derive(Debug, Clone)]
pub struct VfsEntry {
    pub internal_path: String,
    pub cpk_filename: String,
    pub file_size: u32,
}

/// Système de fichiers virtuel transparent pour Inazuma Eleven: Victory Road.
pub struct Vfs {
    game_data_dir: PathBuf,
    loose_files: bool,
    index: HashMap<String, VfsEntry>,
    /// Index supplémentaire `chemin_interne → nom_cpk` pour les CPK ABSENTS de
    /// `cpk_list.cfg.bin` (films, sound_asset…) : alimenté depuis l'index global
    /// `path → cpk` (cf. [`Vfs::add_extra_index`]). `read()` y bascule sur miss.
    index_extra: HashMap<String, String>,
    cpk_names: HashSet<String>,
    cpk_cache: CpkCacheMap,
}

impl Default for Vfs {
    fn default() -> Self {
        Self::new()
    }
}

impl Vfs {
    /// Crée une nouvelle instance de VFS vide.
    #[must_use]
    pub fn new() -> Self {
        Self {
            game_data_dir: PathBuf::new(),
            loose_files: false,
            index: HashMap::new(),
            index_extra: HashMap::new(),
            cpk_names: HashSet::new(),
            cpk_cache: Mutex::new(CpkCache::new(cpk_cache_budget())),
        }
    }

    /// Ajoute des entrées `(chemin_interne, nom_cpk)` à l'index supplémentaire — pour les
    /// fichiers dont le CPK n'est pas listé dans `cpk_list.cfg.bin` (films, sound_asset…).
    /// Les entrées déjà présentes dans l'index principal restent prioritaires. Le CPK
    /// référencé doit exister dans `packs/`. Retourne le nombre d'entrées ajoutées.
    pub fn add_extra_index<I>(&mut self, entries: I) -> usize
    where
        I: IntoIterator<Item = (String, String)>,
    {
        let mut added = 0;
        for (path, cpk) in entries {
            if !self.index.contains_key(&path) {
                self.index_extra.insert(path, cpk);
                added += 1;
            }
        }
        added
    }

    /// Initialise le VFS à partir du répertoire du jeu (contenant `data/cpk_list.cfg.bin`).
    pub fn init<P: AsRef<Path>>(&mut self, game_data_dir: P) -> Result<(), FormatError> {
        let game_data_dir = game_data_dir.as_ref().to_path_buf();
        self.game_data_dir = game_data_dir;
        self.loose_files = false;

        let cpk_list_path = self.game_data_dir.join("cpk_list.cfg.bin");
        let mut file = File::open(&cpk_list_path)
            .map_err(|_| FormatError::Corrupt("impossible d'ouvrir cpk_list.cfg.bin"))?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|_| FormatError::Corrupt("impossible de lire cpk_list.cfg.bin"))?;

        // Déchiffrer le cpk_list.cfg.bin : AES-256-CBC (clé/IV embarqués dans nie.exe,
        // reversés — PAS l'enveloppe XOR position-based ni la clé fixe Viola, qui ne
        // déchiffrent pas ce fichier sur les builds Steam actuels). Cf.
        // `cpk::decrypt_cpk_list`.
        let data = crate::cpk::decrypt_cpk_list(&data)?;

        // Parser le cfg.bin
        let cfg = crate::cfgbin::cfgbin_parse(&data)
            .map_err(|_| FormatError::Corrupt("echec de parsing du cpk_list.cfg.bin"))?;

        // Parcourir les entrées et indexer les fichiers
        for root_entry in &cfg.entries {
            for child in &root_entry.children {
                if child.variables.len() < 5 {
                    continue;
                }
                let directory = match &child.variables[0] {
                    crate::cfgbin::Value::String(s) => s,
                    _ => continue,
                };
                let filename = match &child.variables[1] {
                    crate::cfgbin::Value::String(s) => s,
                    _ => continue,
                };
                let cpk_hash = match &child.variables[3] {
                    crate::cfgbin::Value::String(s) => s,
                    _ => continue,
                };
                let file_size = match &child.variables[4] {
                    crate::cfgbin::Value::Int(v) => *v as u32,
                    _ => 0,
                };

                let internal_path = format!("{}{}", directory, filename);

                let entry = VfsEntry {
                    internal_path: internal_path.clone(),
                    cpk_filename: cpk_hash.clone(),
                    file_size,
                };

                self.cpk_names.insert(cpk_hash.clone());
                self.index.insert(internal_path, entry);
            }
        }

        Ok(())
    }

    /// Initialise le VFS en mode loose files (sans CPK).
    pub fn init_loose<P: AsRef<Path>>(&mut self, extracted_data_dir: P) -> Result<(), FormatError> {
        let extracted_data_dir = extracted_data_dir.as_ref().to_path_buf();
        self.game_data_dir = extracted_data_dir;
        self.loose_files = true;
        self.index.clear();
        self.cpk_names.clear();

        fn walk_dir(dir: &Path, base: &Path, index: &mut HashMap<String, VfsEntry>) -> std::io::Result<()> {
            if dir.is_dir() {
                for entry in std::fs::read_dir(dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    if path.is_dir() {
                        walk_dir(&path, base, index)?;
                    } else {
                        let rel = path.strip_prefix(base).unwrap();
                        let internal_path = rel.to_string_lossy().replace('\\', "/");
                        let file_size = path.metadata()?.len() as u32;

                        index.insert(internal_path.clone(), VfsEntry {
                            internal_path,
                            cpk_filename: String::new(),
                            file_size,
                        });
                    }
                }
            }
            Ok(())
        }

        walk_dir(&self.game_data_dir, &self.game_data_dir, &mut self.index)
            .map_err(|_| FormatError::Corrupt("echec du parcours du repertoire loose"))?;

        Ok(())
    }

    /// Cherche une entrée par son chemin interne.
    #[must_use]
    pub fn find(&self, internal_path: &str) -> Option<&VfsEntry> {
        self.index.get(internal_path)
    }

    /// Lit un fichier complet du VFS.
    pub fn read(&self, internal_path: &str) -> Result<Vec<u8>, FormatError> {
        if self.loose_files {
            let disk_path = self.game_data_dir.join(internal_path);
            let mut file = File::open(&disk_path)
                .map_err(|_| FormatError::Corrupt("impossible d'ouvrir loose file"))?;
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .map_err(|_| FormatError::Corrupt("impossible de lire loose file"))?;
            return Ok(data);
        }

        // Résolution du CPK : index principal (cpk_list.cfg.bin) puis index supplémentaire
        // (films, sound_asset… : CPK présents dans packs/ mais hors cpk_list).
        let cpk_filename: String = match self.find(internal_path) {
            Some(entry) => entry.cpk_filename.clone(),
            None => self
                .index_extra
                .get(internal_path)
                .cloned()
                .ok_or(FormatError::Corrupt("fichier non trouve dans le VFS"))?,
        };
        let cpk_filename = &cpk_filename;
        let mut cache = self.cpk_cache.lock().unwrap();

        let reader_arc = if let Some(arc) = cache.get(cpk_filename) {
            arc
        } else {
            let cpk_path = self.game_data_dir.join("packs").join(cpk_filename);
            let mut file = File::open(&cpk_path)
                .map_err(|_| FormatError::Corrupt("impossible d'ouvrir le CPK"))?;
            let mut cpk_bytes = Vec::new();
            file.read_to_end(&mut cpk_bytes)
                .map_err(|_| FormatError::Corrupt("impossible de lire le CPK"))?;

            let reader = CpkReader::new(&cpk_bytes, cpk_filename)?;
            let arc = Arc::new((reader, cpk_bytes));
            cache.insert(cpk_filename.clone(), arc.clone());
            arc
        };

        let (reader, cpk_bytes) = &*reader_arc;
        
        // Trouver l'entrée CPK : on matche le CHEMIN COMPLET (`directory/filename`) en
        // priorité — sinon les fichiers de même nom de base dans des dossiers différents du
        // MÊME cpk (ex. `common/text/fr/skill_text.cfg.bin` vs `.../de/...`, `.../ja/...`)
        // collisionnent et on sert toujours le premier (bug de langue). Repli sur le basename
        // (exact puis insensible à la casse) pour l'index supplémentaire dont le scan azalee
        // abaisse la casse des chemins (TOC CPK : casse d'origine `Chronicle_Title_CN_01.usm`).
        let filename = internal_path.split('/').next_back().unwrap_or(internal_path);
        let full_path = |e: &crate::cpk::CpkEntry| format!("{}/{}", e.directory, e.filename);

        let cpk_entry = reader
            .entries
            .iter()
            .find(|e| full_path(e) == internal_path)
            .or_else(|| reader.entries.iter().find(|e| full_path(e).eq_ignore_ascii_case(internal_path)))
            .or_else(|| reader.entries.iter().find(|e| e.filename == filename))
            .or_else(|| reader.entries.iter().find(|e| e.filename.eq_ignore_ascii_case(filename)))
            .ok_or(FormatError::Corrupt("fichier non trouve dans le CPK"))?;

        reader.extract(cpk_bytes, cpk_entry)
    }

    /// Nombre de fichiers indexés.
    #[must_use]
    pub fn asset_count(&self) -> usize {
        self.index.len()
    }

    /// Nombre de packs CPK uniques indexés.
    #[must_use]
    pub fn cpk_count(&self) -> usize {
        self.cpk_names.len()
    }

    /// Itère sur toutes les entrées indexées (chemin_interne, entrée VFS).
    pub fn iter(&self) -> impl Iterator<Item = (&str, &VfsEntry)> {
        self.index.iter().map(|(k, v)| (k.as_str(), v))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Mount end-to-end du VRAI jeu Steam s'il est présent (sinon skip). Prouve que
    /// `Vfs::init()` — cassé tant que `cpk_list.cfg.bin` n'était pas déchiffré (AES-256-CBC
    /// reversé de nie.exe, cf. `cpk::decrypt_cpk_list`) — indexe désormais les ~250 800
    /// fichiers logiques sans panic ni repli.
    #[test]
    fn vfs_init_monte_le_vrai_jeu() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data = std::path::Path::new(&dir).join("data");
        if !data.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip vfs_init_monte_le_vrai_jeu : jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data).expect("Vfs::init via cpk_list AES");
        let n = vfs.asset_count();
        assert!(n > 250_000, "attendu > 250 000 fichiers indexés, obtenu {n}");
        // L'index logique contient de vrais chemins (au moins une texture g4tx).
        let has_g4tx = vfs
            .iter()
            .any(|(p, _)| p.to_ascii_lowercase().ends_with(".g4tx"));
        assert!(has_g4tx, "aucun .g4tx dans l'index VFS");
        eprintln!("VFS monté : {n} fichiers logiques indexés depuis cpk_list.cfg.bin");
    }

    /// Chaîne de LECTURE complète sur le vrai jeu : `init` → résoudre chemin→CPK →
    /// ouvrir le CPK → déchiffrer (clé dérivée du nom) → extraire le fichier. Lit un
    /// fichier dont le CPK conteneur est le plus PETIT sur disque (lecture bon marché),
    /// puis vérifie que les octets extraits sont non vides et cohérents.
    #[test]
    fn vfs_read_chaine_complete() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data = std::path::Path::new(&dir).join("data");
        if !data.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip vfs_read_chaine_complete : jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data).expect("init");

        // Dédupliquer par CPK (≈933 conteneurs, pas 254 k entrées) : un seul `stat` par
        // CPK — sinon 254 k stats sur /mnt/c prennent des minutes. On ignore les entrées
        // sans CPK (films/loose, résolus ailleurs) et on choisit le plus PETIT conteneur.
        let packs = data.join("packs");
        let mut first_path: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for (path, entry) in vfs.iter() {
            if entry.cpk_filename.is_empty() || entry.file_size == 0 {
                continue;
            }
            first_path
                .entry(entry.cpk_filename.clone())
                .or_insert_with(|| path.to_string());
        }
        let mut best: Option<(u64, String, String)> = None; // (taille_cpk, chemin, cpk)
        for (cpk, path) in &first_path {
            let Ok(meta) = std::fs::metadata(packs.join(cpk)) else {
                continue;
            };
            if meta.is_file() && meta.len() > 0 && best.as_ref().is_none_or(|(b, ..)| meta.len() < *b)
            {
                best = Some((meta.len(), path.clone(), cpk.clone()));
            }
        }
        let (cpk_sz, path, cpk) = best.expect("au moins un CPK lisible");
        eprintln!("lecture de {path} (CPK {cpk}, {cpk_sz} octets sur disque)");

        let bytes = vfs.read(&path).expect("vfs.read chaîne complète");
        assert!(!bytes.is_empty(), "fichier extrait vide");
        eprintln!("OK : {} octets extraits via le VFS", bytes.len());
    }
}
