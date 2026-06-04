//! VFS (Virtual File System) pour nie-formats.
//!
//! Reproduit fidèlement le comportement du VFS de nie.exe en chargeant
//! `cpk_list.cfg.bin` et en indexant et extrayant les fichiers des CPK du jeu.

#![cfg(not(target_arch = "wasm32"))]

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use crate::cpk::CpkReader;
use crate::FormatError;

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
    cpk_names: HashSet<String>,
    cpk_cache: Mutex<HashMap<String, Arc<(CpkReader, Vec<u8>)>>>,
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
            cpk_names: HashSet::new(),
            cpk_cache: Mutex::new(HashMap::new()),
        }
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

        // Déchiffrer avec la clé fixe Viola
        crate::cpk::decrypt_block(&mut data, 0, crate::cpk::VIOLA_FIXED_KEY);

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

        let entry = self.find(internal_path)
            .ok_or_else(|| FormatError::Corrupt("fichier non trouve dans le VFS"))?;
        
        let cpk_filename = &entry.cpk_filename;
        let mut cache = self.cpk_cache.lock().unwrap();

        let reader_arc = if let Some(arc) = cache.get(cpk_filename) {
            arc.clone()
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
        
        // Trouver l'entrée CPK par nom de fichier (ends_with ou match exact)
        let filename = internal_path.split('/').last().unwrap_or(internal_path);
        
        let cpk_entry = reader.entries.iter().find(|e| e.filename == filename)
            .ok_or_else(|| FormatError::Corrupt("fichier non trouve dans le CPK"))?;

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
}
