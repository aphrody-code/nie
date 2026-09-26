//! Tauri build script.
//!
//! On Windows MSVC, tauri-build embeds the comctl32 v6 manifest through a resource that only
//! reaches the application binaries. The `--lib` test harness then links `comctl32` without it
//! and fails at launch with `STATUS_ENTRYPOINT_NOT_FOUND` (`TaskDialogIndirect` lives in v6
//! only). The manifest is therefore embedded by the linker for every artifact — binaries and
//! test harnesses alike — and tauri-build is told not to add its own copy.

const WINDOWS_MANIFEST_FILE: &str = "windows-app-manifest.xml";

fn main() {
    let msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");

    if !msvc {
        tauri_build::build();
        return;
    }

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
    )
    .expect("tauri-build failed");

    let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
        .join(WINDOWS_MANIFEST_FILE);
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
}
