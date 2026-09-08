//! Generate desktop frontend bindings from Rust without opening a window.
//!
//! `cargo run -p inacord --bin export-bindings --features dev-bindings` from the repository root.
//!
//! Reflection is development tooling. Release builds keep this binary callable
//! only to report that generation requires a debug build.

#[cfg(debug_assertions)]
fn main() {
    match inacord_lib::export_bindings() {
        Ok(()) => println!("Generated apps/nie-web/src/desktop/lib/bindings.ts"),
        Err(error) => {
            eprintln!("Binding export failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(debug_assertions))]
fn main() {
    eprintln!("export-bindings requires a debug build; rerun without --release.");
    std::process::exit(1);
}
