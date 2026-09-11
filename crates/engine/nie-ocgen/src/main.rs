//! `nie-ocgen` — the original-character 3D generation pipeline, as a standalone command.
//!
//! Same code as `niers ocgen`: both are a `clap` parse and a call into [`nie_ocgen::cli::run`].

use clap::Parser;

/// Command-line entry point.
#[derive(Parser, Debug)]
#[command(name = "nie-ocgen", about = "Génération 3D d'un personnage original")]
struct Args {
    /// Sub-command to run.
    #[command(subcommand)]
    op: nie_ocgen::cli::OcgenCmd,
}

fn main() -> Result<(), nie_ocgen::Error> {
    nie_ocgen::cli::run(&Args::parse().op)
}
