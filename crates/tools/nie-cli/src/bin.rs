//! Thin executable binding for the reusable `nie_cli` library.

fn main() -> anyhow::Result<()> {
    nie_cli::main_entry()
}
