//! Filesystem and process binding for the current native scene editor CLI.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

static NEXT_IMPORT: AtomicU64 = AtomicU64::new(0);

fn supports_glb(help: &str) -> bool {
    help.lines()
        .any(|line| line.trim_start().starts_with("--glb "))
}

/// Reject stale legacy executables before assembling a potentially expensive game model.
pub fn verify_contract(executable: &Path) -> Result<(), String> {
    let output = Command::new(executable)
        .arg("--help")
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() && supports_glb(&String::from_utf8_lossy(&output.stdout)) {
        Ok(())
    } else {
        Err("Éditeur incompatible : reconstruisez nie-editor avec cargo build -p nie-editor --release.".into())
    }
}

/// Retain imports in application data so saved projects can still resolve their GLB assets.
pub fn stage_import(directory: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    loop {
        let sequence = NEXT_IMPORT.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("scene-{}-{sequence}.glb", std::process::id()));
        let mut file = match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        };
        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(error.to_string());
        }
        return Ok(path);
    }
}

/// `nie-editor` consumes a prepared GLB; legacy VFS flags belong to `nie-editor-legacy`.
pub fn editor_command(executable: &Path, glb: Option<&Path>) -> Command {
    let mut command = Command::new(executable);
    if let Some(path) = glb {
        command.arg("--glb").arg(path);
    }
    command
}

fn check_startup(child: &mut Child) -> Result<(), String> {
    match child.try_wait().map_err(|error| error.to_string())? {
        Some(status) => Err(format!("L'éditeur s'est arrêté au démarrage ({status}).")),
        None => Ok(()),
    }
}

/// Catch immediate argument/GPU failures before acknowledging a running process, then reap it.
pub fn launch(executable: &Path, glb: Option<&Path>) -> Result<(), String> {
    let mut child = editor_command(executable, glb)
        .spawn()
        .map_err(|error| error.to_string())?;
    std::thread::sleep(Duration::from_millis(150));
    check_startup(&mut child)?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_help_does_not_satisfy_the_current_editor_contract() {
        assert!(supports_glb(
            "Options:\n      --glb <GLB>  Model to import\n"
        ));
        assert!(!supports_glb(
            "Options:\n      --asset <ASSET>  VFS model\n"
        ));
        assert!(!supports_glb(
            "The description mentions --glb but no option is declared"
        ));
    }

    #[test]
    fn current_editor_receives_a_single_glb_argument_without_legacy_flags() {
        let command = editor_command(
            Path::new("nie-editor"),
            Some(Path::new("a folder/model.glb")),
        );
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, ["--glb", "a folder/model.glb"]);
        assert_eq!(
            editor_command(Path::new("nie-editor"), None)
                .get_args()
                .count(),
            0
        );
    }

    #[test]
    fn imports_do_not_overwrite_existing_scene_assets() {
        let directory =
            std::env::temp_dir().join(format!("nie-editor-import-test-{}", std::process::id()));
        let first = stage_import(&directory, b"first GLB").unwrap();
        let second = stage_import(&directory, b"second GLB").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), b"first GLB");
        assert_eq!(std::fs::read(&second).unwrap(), b"second GLB");
        std::fs::remove_file(first).unwrap();
        std::fs::remove_file(second).unwrap();
        let _ = std::fs::remove_dir(directory);
    }

    #[cfg(unix)]
    #[test]
    fn terminated_child_is_not_reported_as_an_open_editor() {
        let mut child = Command::new("sh").args(["-c", "exit 7"]).spawn().unwrap();
        child.wait().unwrap();
        assert!(check_startup(&mut child).unwrap_err().contains("7"));
    }
}
