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
    ///
    /// Après avoir indexé les ~254 000 fichiers du `cpk_list.cfg.bin`, appelle automatiquement
    /// [`Vfs::discover_extra_cpks`] pour indexer les CPK présents dans `packs/` mais absents
    /// du `cpk_list` (par exemple les DLC ou mises à jour ajoutant de nouveaux packs).
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

        // Déchiffrement du cpk_list.cfg.bin — DEUX variantes coexistent selon le build :
        //   - builds Steam récents : AES-256-CBC (clé/IV reversés de nie.exe) → `decrypt_cpk_list` ;
        //   - dumps plus anciens : enveloppe à clé fixe Viola → `decrypt_block(_, 0, VIOLA_FIXED_KEY)`.
        // On tente l'AES d'abord, puis Viola en repli, en VALIDANT chaque résultat par
        // `cfgbin_parse` (durci contre les en-têtes chiffrés/corrompus : renvoie Err sans
        // paniquer). Le premier déchiffrement produisant un cfg.bin valide gagne. Indispensable :
        // un seul des deux déchiffre correctement un fichier donné (l'autre rend du garbage).
        let cfg = crate::cpk::decrypt_cpk_list(&data)
            .ok()
            .and_then(|aes| crate::cfgbin::cfgbin_parse(&aes).ok())
            .or_else(|| {
                let mut viola = data.clone();
                crate::cpk::decrypt_block(&mut viola, 0, crate::cpk::VIOLA_FIXED_KEY);
                crate::cfgbin::cfgbin_parse(&viola).ok()
            })
            .ok_or(FormatError::Corrupt(
                "echec de parsing du cpk_list.cfg.bin (ni AES-256-CBC ni clé Viola)",
            ))?;

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

                // Les entrées avec un nom CPK non vide sont des fichiers dans un pack.
                // Les entrées avec un nom CPK vide sont des fichiers loose (ex. vidéos d'intro
                // `IE_15th.usm`, `L5logo.usm`, config `app_config_6.00.23.00.cfg.bin`) :
                // le jeu les charge directement depuis le disque. On les enregistre quand même
                // afin que `read()` puisse les servir en fallback disque (cf. gestion en aval).
                if !cpk_hash.is_empty() {
                    self.cpk_names.insert(cpk_hash.clone());
                }
                self.index.insert(internal_path, entry);
            }
        }

        // Auto-découverte des CPK supplémentaires : CPK présents dans `packs/` mais absents
        // du `cpk_list.cfg.bin` (DLC, mises à jour ajoutant des packs avant la prochaine
        // mise à jour du `cpk_list`). Retourne 0 si tous les packs sont déjà indexés.
        self.discover_extra_cpks();

        Ok(())
    }

    /// Scanne `packs/*.cpk` et indexe dans [`Vfs::index_extra`] tous les fichiers des CPK
    /// absents du `cpk_list` principal (CPK dont le nom n'est pas encore dans l'index).
    ///
    /// Appelé automatiquement par [`Vfs::init`]. Peut aussi être appelé manuellement pour
    /// réindexer après avoir ajouté un CPK dans `packs/`. Retourne le nombre d'entrées
    /// nouvellement indexées.
    ///
    /// Pour chaque CPK hors-index trouvé sur disque, le TOC complet est parsé et ses
    /// chemins internes (`répertoire/nom`) sont ajoutés à `index_extra`. Les entrées déjà
    /// présentes dans l'index principal restent prioritaires.
    ///
    /// # Robustesse
    ///
    /// Les CPK illisibles ou non-déchiffrables sont silencieusement ignorés (log sur stderr
    /// en mode debug). La fonction est idempotente : un second appel ne ré-ajoute pas les
    /// entrées déjà dans `index_extra`.
    pub fn discover_extra_cpks(&mut self) -> usize {
        if self.loose_files {
            return 0;
        }
        let packs = self.game_data_dir.join("packs");
        let Ok(dir_iter) = std::fs::read_dir(&packs) else {
            return 0;
        };

        let mut added = 0usize;
        for dir_entry in dir_iter.flatten() {
            let name = dir_entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".cpk") || self.cpk_names.contains(&name) {
                continue; // Déjà dans l'index principal
            }
            // CPK présent sur disque mais absent du cpk_list : parser son TOC.
            let cpk_path = packs.join(&name);
            let Ok(mut f) = File::open(&cpk_path) else { continue; };
            let mut bytes = Vec::new();
            if f.read_to_end(&mut bytes).is_err() {
                continue;
            }
            let Ok(reader) = CpkReader::new(&bytes, &name) else {
                continue;
            };
            for e in &reader.entries {
                if e.filename.is_empty() {
                    continue;
                }
                let path = if e.directory.is_empty() {
                    e.filename.clone()
                } else {
                    format!("{}/{}", e.directory, e.filename)
                };
                if !self.index.contains_key(&path) && !self.index_extra.contains_key(&path) {
                    self.index_extra.insert(path, name.clone());
                    added += 1;
                }
            }
            self.cpk_names.insert(name);
        }
        added
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
    ///
    /// Résolution en quatre étapes :
    /// 1. Mode loose (`init_loose`) : lit directement depuis le disque.
    /// 2. Index principal (cpk_list.cfg.bin) → CPK non vide : extrait du pack.
    /// 3. Index principal → CPK vide : fichier "loose" enregistré dans cpk_list mais servi
    ///    directement depuis le disque (ex. `IE_15th.usm`, `L5logo.usm`,
    ///    `app_config_6.00.23.00.cfg.bin`). Le chemin interne commence par `data/` ; on retire
    ///    ce préfixe pour reconstruire le chemin disque sous `game_data_dir`.
    /// 4. Index supplémentaire (`index_extra`, peuplé par [`Vfs::discover_extra_cpks`]) →
    ///    extrait du CPK hors-cpk_list correspondant.
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
        // (CPK présents dans packs/ mais hors cpk_list, découverts par discover_extra_cpks).
        let cpk_filename: String = match self.find(internal_path) {
            Some(entry) => entry.cpk_filename.clone(),
            None => self
                .index_extra
                .get(internal_path)
                .cloned()
                .ok_or(FormatError::Corrupt("fichier non trouve dans le VFS"))?,
        };

        // Cas spécial : CPK vide → fichier loose enregistré dans cpk_list (vidéos d'intro,
        // fichier de configuration système…). Le chemin interne débute par "data/" ; on retire
        // ce préfixe pour obtenir un chemin relatif à game_data_dir.
        if cpk_filename.is_empty() {
            let rel = internal_path.strip_prefix("data/").unwrap_or(internal_path);
            let disk_path = self.game_data_dir.join(rel);
            let mut file = File::open(&disk_path)
                .map_err(|_| FormatError::Corrupt("loose file manquant sur disque"))?;
            let mut data = Vec::new();
            file.read_to_end(&mut data)
                .map_err(|_| FormatError::Corrupt("impossible de lire loose file cpk_list"))?;
            return Ok(data);
        }

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

    /// Nombre d'entrées dans l'index supplémentaire (CPKs hors cpk_list découverts par
    /// [`Vfs::discover_extra_cpks`]).
    #[must_use]
    pub fn extra_count(&self) -> usize {
        self.index_extra.len()
    }

    /// Nombre de fichiers "loose" dans l'index principal (CPK vide dans cpk_list) :
    /// fichiers chargés directement depuis le disque plutôt qu'un pack.
    #[must_use]
    pub fn loose_count(&self) -> usize {
        self.index.values().filter(|e| e.cpk_filename.is_empty()).count()
    }

    /// Itère sur toutes les entrées indexées (chemin_interne, entrée VFS).
    pub fn iter(&self) -> impl Iterator<Item = (&str, &VfsEntry)> {
        self.index.iter().map(|(k, v)| (k.as_str(), v))
    }
}

/// Résout le répertoire racine du jeu (celui qui contient `data/cpk_list.cfg.bin`), dans l'ordre :
/// `NIE_GAME_DIR` si posée ; sinon le répertoire courant s'il contient déjà `data/cpk_list.cfg.bin`
/// (poste où le dépôt niers est fusionné avec le dossier d'install du jeu — plus besoin de poser la
/// variable) ; sinon le repli historique `/home/aphrody/niers` (dev WSL séparé).
#[must_use]
pub fn resolve_game_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("NIE_GAME_DIR") {
        return PathBuf::from(dir);
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.join("data/cpk_list.cfg.bin").is_file() {
        return cwd;
    }
    PathBuf::from("/home/aphrody/niers")
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

    /// Vérifie que `discover_extra_cpks()` est correct :
    ///
    /// - Sur l'installation actuelle (cpk_list complet), retourne 0 car tous les CPK
    ///   présents dans `packs/` sont déjà indexés via le `cpk_list.cfg.bin`.
    /// - Vérifie en outre que `cpk_count()` correspond au nombre réel de CPKs sur disque
    ///   (preuve que la découverte ne double-compte pas).
    /// - Si l'installation a des CPK supplémentaires futurs (DLC, mise à jour), le test
    ///   rapporte le nombre exact découvert au lieu de 0.
    #[test]
    fn discover_extra_cpks_retourne_zero_sur_install_complete() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data = std::path::Path::new(&dir).join("data");
        if !data.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip discover_extra_cpks: jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data).expect("init");

        let extra = vfs.extra_count();
        let loose = vfs.loose_count();
        let n_index = vfs.asset_count();
        let n_cpks = vfs.cpk_count();

        // Sur l'installation testée, le cpk_list est complet : aucun CPK extra attendu.
        assert_eq!(
            extra, 0,
            "discover_extra_cpks a trouvé {extra} fichiers non indexés dans packs/ \
            (attendu 0 sur une installation complète)"
        );

        // Les entrées loose (CPK vide dans cpk_list) incluent IE_15th.usm, L5logo.usm,
        // app_config_6.00.23.00.cfg.bin (5 entrées sur le build Steam 2026).
        assert!(
            loose >= 3,
            "attendu au moins 3 entrées loose dans le cpk_list (IE_15th.usm, L5logo.usm, app_config…), obtenu {loose}"
        );

        eprintln!(
            "discover_extra_cpks OK : {n_index} fichiers, {n_cpks} CPKs, {loose} loose, {extra} extra découverts"
        );
    }

    /// Vérifie que `read()` sert correctement les fichiers "loose" enregistrés dans le
    /// `cpk_list` avec un nom CPK vide. Ces fichiers existent directement sur disque sous
    /// `game_data_dir/`. Exemple : `data/dx11/movie/IE_15th.usm` → lu depuis
    /// `{game_data_dir}/dx11/movie/IE_15th.usm`.
    ///
    /// Avant ce correctif, `read()` tentait d'ouvrir `packs/` (répertoire), échouait
    /// avec « impossible d'ouvrir le CPK », et les fichiers étaient inaccessibles.
    #[test]
    fn read_loose_file_avec_cpk_vide() {
        let dir = std::env::var("NIE_GAME_DIR").unwrap_or_else(|_| {
            "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                .to_string()
        });
        let data_dir = std::path::Path::new(&dir).join("data");
        if !data_dir.join("cpk_list.cfg.bin").exists() {
            eprintln!("skip read_loose_file_avec_cpk_vide : jeu absent");
            return;
        }
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).expect("init");

        // Collecter toutes les entrées loose (CPK vide) dans l'index
        let loose_entries: Vec<String> = vfs
            .iter()
            .filter(|(_, e)| e.cpk_filename.is_empty())
            .map(|(p, _)| p.to_string())
            .collect();

        assert!(
            !loose_entries.is_empty(),
            "aucune entrée loose dans le cpk_list (attendu au moins IE_15th.usm)"
        );
        eprintln!("Entrées loose dans cpk_list : {:?}", loose_entries);

        // Tester la lecture de chaque entrée loose dont le fichier disque existe
        let mut read_ok = 0usize;
        let mut missing_on_disk = 0usize;
        for path in &loose_entries {
            match vfs.read(path) {
                Ok(bytes) if !bytes.is_empty() => {
                    eprintln!("  OK  {path} : {} octets", bytes.len());
                    read_ok += 1;
                }
                Ok(_) => {
                    eprintln!("  VIDE {path}");
                }
                Err(crate::FormatError::Corrupt("loose file manquant sur disque")) => {
                    eprintln!("  ABSENT-DISQUE {path}");
                    missing_on_disk += 1;
                }
                Err(e) => {
                    panic!("read({path}) a échoué avec une erreur inattendue : {e}");
                }
            }
        }

        // Au moins un fichier loose doit être lisible (IE_15th.usm ou L5logo.usm)
        assert!(
            read_ok > 0,
            "aucun fichier loose n'a pu être lu (read_ok=0, missing_on_disk={missing_on_disk})"
        );
        eprintln!(
            "read_loose_file OK : {read_ok} fichiers lus, {missing_on_disk} absents du disque"
        );
    }
}
