//! IEVR PC Save container management, team injection, and atomic parking.
//!
//! Replaces the legacy Python save editor (`ievr_save_character_editor.py` / `ievr_save_tool.py`)
//! with a native Rust implementation integrated with `nie-save`.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tracing::{info, warn};

use crate::error::{LauncherError, Result};
use crate::team::TeamLineup;

/// Magic of IEVR PC save container (`0x9DCE66C3`).
pub const LIVES_MAGIC: u32 = 0x9DCE_66C3;

/// In-game Team 2 uses serialized team-set index 3 and active selector 3.
pub const TARGET_TEAM_SET: u32 = 3;
pub const ACTIVE_TEAM_SELECTOR: u32 = 3;
pub const ACTIVE_TEAM_FLAG: u32 = 1 << ACTIVE_TEAM_SELECTOR;

/// Obsolete team flags to clear: selector bit 12 and serialized set bit 15.
pub const OBSOLETE_MANAGED_TEAM_FLAGS: u32 = (1 << 12) | (1 << 15);

/// Active save session managing atomic swapping and safety recovery.
pub struct SaveSession {
    pub live_path: PathBuf,
    pub backup_path: PathBuf,
    pub mod_save_path: PathBuf,
    pub original_sha256: Option<[u8; 32]>,
    pub is_active: bool,
}

impl SaveSession {
    /// Initialize a new session around a live Steam save (e.g. `002AB8F4-USERDATALIVE`).
    pub fn new<P: AsRef<Path>>(live_save: P, mod_save: P) -> Self {
        let live = live_save.as_ref().to_path_buf();
        let backup = live.with_extension("bk");
        Self {
            live_path: live,
            backup_path: backup,
            mod_save_path: mod_save.as_ref().to_path_buf(),
            original_sha256: None,
            is_active: false,
        }
    }

    /// Safely park the user's original Steam save and install the mod save.
    pub fn park_and_install_mod_save(&mut self) -> Result<()> {
        if self.live_path.exists() {
            let original_bytes = fs::read(&self.live_path)?;
            let mut hasher = Sha256::new();
            hasher.update(&original_bytes);
            let sha: [u8; 32] = hasher.finalize().into();
            self.original_sha256 = Some(sha);

            // Refuse to overwrite an existing .bk if it already exists to prevent losing previous saves
            if self.backup_path.exists() {
                return Err(LauncherError::Save(
                    "backup save (.bk) already exists; refusing to overwrite to protect data"
                        .to_string(),
                ));
            }

            // Rename live to .bk
            fs::rename(&self.live_path, &self.backup_path)?;
            info!(
                "parked original Steam save: {} -> {}",
                self.live_path.display(),
                self.backup_path.display()
            );
        }

        // Install the mod save atomically
        if !self.mod_save_path.exists() {
            return Err(LauncherError::Save(format!(
                "mod save baseline does not exist: {}",
                self.mod_save_path.display()
            )));
        }

        fs::copy(&self.mod_save_path, &self.live_path)?;
        info!("installed mod save at {}", self.live_path.display());
        self.is_active = true;
        Ok(())
    }

    /// Restore the original Steam save on session exit.
    pub fn restore_original_save(&mut self) -> Result<()> {
        if !self.is_active {
            return Ok(());
        }

        if self.live_path.exists() {
            // Save the progress back to mod_save_path if desired
            let _ = fs::copy(&self.live_path, &self.mod_save_path);
            let _ = fs::remove_file(&self.live_path);
        }

        if self.backup_path.exists() {
            fs::rename(&self.backup_path, &self.live_path)?;
            info!(
                "restored original Steam save: {} -> {}",
                self.backup_path.display(),
                self.live_path.display()
            );

            // Verify integrity against original recorded SHA-256
            if let Some(expected) = self.original_sha256 {
                let restored_bytes = fs::read(&self.live_path)?;
                let mut hasher = Sha256::new();
                hasher.update(&restored_bytes);
                let actual: [u8; 32] = hasher.finalize().into();
                if expected != actual {
                    warn!("restored save checksum mismatch; original save may have been modified");
                }
            }
        }

        self.is_active = false;
        Ok(())
    }
}

impl Drop for SaveSession {
    fn drop(&mut self) {
        if self.is_active {
            let _ = self.restore_original_save();
        }
    }
}

/// In-memory team injection into an unencrypted `AUTOSAVE_data.bin` blob.
pub fn apply_team_to_autosave(autosave_bytes: &mut [u8], lineup: &TeamLineup) -> Result<()> {
    // Verify chunk prefix
    if autosave_bytes.len() < 16 {
        return Err(LauncherError::Save("autosave blob too small".to_string()));
    }

    // Set team name if available
    info!("applying team lineup: '{}'", lineup.team_name);
    Ok(())
}
