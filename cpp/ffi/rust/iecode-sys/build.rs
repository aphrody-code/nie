use std::env;
use std::path::PathBuf;

fn main() {
    // Determine target platform for cross-platform builds
    let target = env::var("TARGET").unwrap_or_default();
    let is_wasm = target.contains("wasm32");
    let is_windows = target.contains("windows");
    let is_linux = target.contains("linux") || target.contains("unix");

    // Resolve library directory with platform-aware defaults
    let lib_dir = env::var("IECODE_LIB_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let manifest_dir = env::var("CARGO_MANIFEST_DIR")
                .expect("Failed to get CARGO_MANIFEST_DIR");
            let base = PathBuf::from(manifest_dir);

            if is_wasm {
                // WASM builds use Emscripten output directory
                base.join("../../../../build/wasm")
            } else if is_windows {
                // Windows: debug or release subdirectory
                let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
                base.join("../../../../build").join(profile)
            } else if is_linux {
                // Linux: standard build directory
                let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".to_string());
                base.join("../../../../build").join(profile)
            } else {
                // Fallback for other platforms
                base.join("../../../../build/debug")
            }
        });

    // Verify library directory exists
    if !lib_dir.exists() {
        panic!(
            "IECODE library directory not found: {}\n\
             Set IECODE_LIB_DIR environment variable to override.",
            lib_dir.display()
        );
    }

    println!("cargo:rustc-link-search=native={}", lib_dir.display());

    // Platform-specific library linking
    if is_wasm {
        // WASM requires static linking with Emscripten
        println!("cargo:rustc-link-lib=static=iecode");

        // Emscripten linker flags for module compatibility
        println!("cargo:rustc-link-arg=-s");
        println!("cargo:rustc-link-arg=SIDE_MODULE");
        println!("cargo:rustc-link-arg=-s");
        println!("cargo:rustc-link-arg=EXPORT_ALL=1");
    } else if env::var("CARGO_FEATURE_STATIC_LINK").is_ok() {
        // Explicit static linking requested
        println!("cargo:rustc-link-lib=static=iecode_core");
    } else {
        // Dynamic linking by default
        let lib_name = if is_windows { "iecode" } else { "iecode" };
        println!("cargo:rustc-link-lib=dylib={}", lib_name);
    }

    // Platform-specific dependencies
    if is_linux {
        // Linux may need additional system libraries
        println!("cargo:rustc-link-lib=pthread");
        println!("cargo:rustc-link-lib=dl");
    }

    // Re-run build if environment changes
    println!("cargo:rerun-if-env-changed=IECODE_LIB_DIR");
    println!("cargo:rerun-if-env-changed=TARGET");
}
