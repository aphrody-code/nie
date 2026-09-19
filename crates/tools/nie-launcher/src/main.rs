//! nie-launcher CLI entrypoint.

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use nie_launcher::{
    decrypt_team_envelope, inspect_package_header, SaveSession, TeamExportEnvelope,
    DEFAULT_PASSPHRASE,
};

#[derive(Parser)]
#[command(name = "nie-launcher")]
#[command(about = "Native Rust launcher, save editor, and mod package manager for IEVR")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Team lineup export management
    Team {
        #[command(subcommand)]
        cmd: TeamCommands,
    },
    /// Mod package (.utmod) inspection
    Package {
        #[command(subcommand)]
        cmd: PackageCommands,
    },
    /// Save session operations
    Save {
        #[command(subcommand)]
        cmd: SaveCommands,
    },
    /// Easy Anti-Cheat scan and patch operations
    Eac {
        #[command(subcommand)]
        cmd: EacCommands,
    },
    /// Spirit cards (142) and special moves (1,299) roster
    Spirit {
        #[command(subcommand)]
        cmd: SpiritCommands,
    },
}

#[derive(Subcommand)]
enum TeamCommands {
    /// Decrypt an exported team JSON from the web platform
    Decrypt {
        /// Path to encrypted team JSON file
        file: PathBuf,
        /// Custom passphrase if different from canonical
        #[arg(long, default_value = DEFAULT_PASSPHRASE)]
        passphrase: String,
    },
}

#[derive(Subcommand)]
enum PackageCommands {
    /// Inspect a .utmod package header
    Info {
        /// Path to .utmod file
        file: PathBuf,
    },
}

#[derive(Subcommand)]
enum SaveCommands {
    /// Safely park the live Steam save to .bk and install a mod save
    Park {
        /// Live save path (e.g. 002AB8F4-USERDATALIVE)
        live_save: PathBuf,
        /// Mod save path
        mod_save: PathBuf,
    },
    /// Restore the parked .bk save
    Restore {
        /// Live save path
        live_save: PathBuf,
        /// Mod save path
        mod_save: PathBuf,
    },
}

#[derive(Subcommand)]
enum EacCommands {
    /// Scan binary for EAC conditional check sites
    Scan {
        /// Path to executable
        file: PathBuf,
        /// Output formatted JSON
        #[arg(long)]
        json: bool,
    },
    /// Patch EAC checks in-place or to a new destination file
    Patch {
        /// Source executable
        file: PathBuf,
        /// Destination path (defaults to <name>_eacpatched.exe)
        #[arg(long, short = 'o')]
        out: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum SpiritCommands {
    /// Search or list 142 spirit cards
    Cards {
        /// Optional query filter
        #[arg(long, short = 'q')]
        query: Option<String>,
        /// Output JSON
        #[arg(long)]
        json: bool,
    },
    /// Search or list 1,299 special moves
    Moves {
        /// Optional query filter
        #[arg(long, short = 'q')]
        query: Option<String>,
        /// Category filter (Shot, Catch, Dribble, Block)
        #[arg(long, short = 'c')]
        category: Option<String>,
        /// Output JSON
        #[arg(long)]
        json: bool,
    },
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();

    match cli.command {
        Commands::Team { cmd } => match cmd {
            TeamCommands::Decrypt { file, passphrase } => {
                let content = std::fs::read_to_string(&file)?;
                let envelope: TeamExportEnvelope = serde_json::from_str(&content)?;
                let lineup = decrypt_team_envelope(&envelope, &passphrase)?;
                println!("{}", serde_json::to_string_pretty(&lineup)?);
            }
        },
        Commands::Package { cmd } => match cmd {
            PackageCommands::Info { file } => {
                let data = std::fs::read(&file)?;
                let header = inspect_package_header(&data)?;
                println!(
                    "Package GUID: {}\nFile size: {} bytes\nPayload offset: 0x{:X}",
                    header.package_id, header.file_size, header.payload_offset
                );
            }
        },
        Commands::Save { cmd } => match cmd {
            SaveCommands::Park { live_save, mod_save } => {
                let mut session = SaveSession::new(live_save, mod_save);
                session.park_and_install_mod_save()?;
                // Forget drop so session stays active
                std::mem::forget(session);
                println!("Mod save installed and original save parked successfully.");
            }
            SaveCommands::Restore { live_save, mod_save } => {
                let mut session = SaveSession::new(live_save, mod_save);
                session.is_active = true;
                session.restore_original_save()?;
                println!("Original save restored successfully.");
            }
        },
        Commands::Eac { cmd } => match cmd {
            EacCommands::Scan { file, json } => {
                let bytes = std::fs::read(&file)?;
                let report = nie_launcher::scan_eac_sites(&bytes)
                    .map_err(|e| anyhow::anyhow!("EAC scan error: {e}"))?;
                if json {
                    println!("{}", serde_json::to_string_pretty(&report)?);
                } else {
                    println!(
                        "EAC scan {}: {} sites found ({} unpatched, {} patched)",
                        file.display(),
                        report.total_sites_found,
                        report.unpatched_count,
                        report.patched_count
                    );
                }
            }
            EacCommands::Patch { file, out } => {
                let target = out.unwrap_or_else(|| {
                    if let Some(stem) = file.file_stem().and_then(|s| s.to_str()) {
                        let ext = file.extension().and_then(|s| s.to_str()).unwrap_or("exe");
                        file.with_file_name(format!("{stem}_eacpatched.{ext}"))
                    } else {
                        file.with_extension("eacpatched.exe")
                    }
                });
                let report = nie_launcher::patch_eac_file(&file, &target)
                    .map_err(|e| anyhow::anyhow!("EAC patch error: {e}"))?;
                println!(
                    "EAC patch {} -> {}: {} sites processed ({} patched)",
                    file.display(),
                    target.display(),
                    report.total_sites_found,
                    report.patched_count
                );
            }
        },
        Commands::Spirit { cmd } => match cmd {
            SpiritCommands::Cards { query, json } => {
                let cards: Vec<&nie_launcher::SpiritCard> = if let Some(q) = query {
                    nie_launcher::search_spirit_cards(&q)
                } else {
                    nie_launcher::all_spirit_cards().iter().collect()
                };
                if json {
                    println!("{}", serde_json::to_string_pretty(&cards)?);
                } else {
                    println!("Spirit Cards ({}) :", cards.len());
                    for c in cards {
                        println!("  0x{} | {:<30} | {}", c.hex_id, c.name, c.variant);
                    }
                }
            }
            SpiritCommands::Moves { query, category, json } => {
                let mut moves: Vec<&nie_launcher::SpecialMove> = if let Some(q) = query {
                    nie_launcher::search_special_moves(&q)
                } else {
                    nie_launcher::all_special_moves().iter().collect()
                };
                if let Some(cat) = category {
                    moves.retain(|m| m.category.eq_ignore_ascii_case(&cat));
                }
                if json {
                    println!("{}", serde_json::to_string_pretty(&moves)?);
                } else {
                    println!("Special Moves ({}) :", moves.len());
                    for m in moves {
                        println!("  0x{} | {:<35} | {}", m.hex_id, m.name, m.category);
                    }
                }
            }
        },
    }

    Ok(())
}
