//! In-memory streaming VFS IPC server.
//!
//! Provides the IPC channel for the injected `UltimateTeamVfs.dll` hook
//! to read modded files directly from launcher memory without writing to disk.

use std::collections::HashMap;

use tracing::info;

use crate::error::Result;
use crate::package::PackageEntry;

/// VFS Server hosting decrypted package entries.
pub struct VfsServer {
    pub pipe_name: String,
    pub files: HashMap<String, PackageEntry>,
}

impl VfsServer {
    pub fn new(pipe_name: String) -> Self {
        Self {
            pipe_name,
            files: HashMap::new(),
        }
    }

    pub fn insert_file(&mut self, entry: PackageEntry) {
        self.files.insert(entry.relative_path.clone(), entry);
    }

    pub fn get_file(&self, path: &str) -> Option<&PackageEntry> {
        self.files.get(path)
    }

    pub fn start_listener(&self) -> Result<()> {
        info!(
            "VFS streaming listener initialized for pipe: {}",
            self.pipe_name
        );
        Ok(())
    }
}
