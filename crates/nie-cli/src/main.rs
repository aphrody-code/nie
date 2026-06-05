//! `niers` — pilote la boucle RE autonome (seed → propagate → coverage) et la frontière redis.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

mod menu_predecode;

use std::io::Write;
use std::path::PathBuf;

use anyhow::Context;
use clap::{Parser, Subcommand};
use sha2::{Digest, Sha256};

/// Image base de nie.exe (PE32+ Level-5).
const NIE_IMAGE_BASE: i64 = 0x1_4000_0000;

/// Parse une adresse décimale ou hexadécimale (`0x...`).
fn parse_addr(s: &str) -> Result<i64, String> {
    match s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        Some(hex) => u64::from_str_radix(hex, 16).map(|v| v as i64).map_err(|e| e.to_string()),
        None => s.parse::<i64>().map_err(|e| e.to_string()),
    }
}

#[derive(Parser)]
#[command(name = "niers", about = "Boucle RE + réimplémentation Rust d'Inazuma Eleven: Victory Road")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Importe le savoir fusionné (index Ghidra nie-index.json) dans la base de connaissance.
    Seed {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Fichier research/nie-index.json.
        #[arg(long)]
        json: PathBuf,
        /// Binaire nie.exe (pour calculer sha256/taille). Optionnel.
        #[arg(long)]
        exe: Option<PathBuf>,
    },
    /// Affiche la couverture (fonctions classifiées) du binaire indexé.
    Coverage {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
    },
    /// Opérations sur la frontière BFS redis.
    Queue {
        #[command(subcommand)]
        op: QueueOp,
        #[arg(long, env = "NIERS_REDIS", default_value = "redis://127.0.0.1/")]
        redis: String,
        #[arg(long, default_value = "nie")]
        tag: String,
    },
    /// Propage les labels sur le call-graph (auto-ML, ancrage strings + label-spreading).
    Propagate {
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
    /// Extrait les classes RTTI MSVC depuis nie_eacpatched.exe et les ingère dans la base.
    Rtti {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Chemin vers nie_eacpatched.exe (ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Triage PE/ELF via aphrody-re : sections + imports/exports ingérés dans la base.
    Index {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à indexer.
        #[arg(long)]
        exe: PathBuf,
    },
    /// Récupère les arêtes d'appel manquantes par désassemblage iced-x86 de `.text`.
    Disasm {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire à désassembler (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Découvre les fonctions AUTORITAIRES via `.pdata` et mesure le désalignement Ghidra.
    Pdata {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64 (nie_eacpatched.exe ou nie.exe).
        #[arg(long)]
        exe: PathBuf,
    },
    /// Refonde la carte sur `.pdata` (vrais débuts), ré-ancre Ghidra, disasm + propage. Couverture HONNÊTE.
    Rebuild {
        /// Base sqlite cible.
        #[arg(long, default_value = "var/niers.sqlite")]
        db: PathBuf,
        /// Binaire PE x64.
        #[arg(long)]
        exe: PathBuf,
        #[arg(long, default_value_t = 16)]
        rounds: usize,
    },
    /// Opérations sur les saves IEVR (Lives format) : decrypt/read/edit.
    Save {
        #[command(subcommand)]
        op: SaveOp,
    },
    /// Exploration game-data depuis le miroir SQLite (personnages, skills, items, équipes).
    Wiki {
        #[command(subcommand)]
        op: WikiOp,
    },
    /// Construit le manifeste CRC32->chemin pour tous les fichiers .g4md/.g4mg des CPK.
    /// Utilisé pour résoudre les ModelIdCrc des inagle_uniforms vers les chemins réels.
    UniformMap {
        /// Répertoire racine de l'installation du jeu (contenant data/cpk_list.cfg.bin).
        #[arg(long, default_value = "/home/ubuntu/.local/share/Steam/iecode/inazuma")]
        game_dir: PathBuf,
        /// Chemin du manifeste NDJSON de sortie (crc32->path).
        #[arg(long, default_value = "var/model-crc-manifest.ndjson")]
        out: PathBuf,
    },
    /// Scanne les fichiers .g4tx dans les CPK du jeu et produit un manifeste NDJSON d'en-têtes.
    Textures {
        /// Répertoire racine de l'installation du jeu (contenant data/cpk_list.cfg.bin).
        #[arg(long, default_value = "/home/ubuntu/.local/share/Steam/iecode/inazuma")]
        game_dir: PathBuf,
        /// Borne dure : nombre maximum de .g4tx à traiter (défaut 500).
        #[arg(long, default_value_t = 500)]
        limit: usize,
        /// Chemin du manifeste NDJSON de sortie.
        #[arg(long, default_value = "var/g4tx-manifest.ndjson")]
        manifest: PathBuf,
        /// Pousse aussi dans Redis db3 (iev:tex:*).
        #[arg(long)]
        redis: bool,
        /// URL Redis (db3).
        #[arg(long, default_value = "redis://127.0.0.1/3")]
        redis_url: String,
    },
    /// Pré-décode les sprites menu IEVR (g4tx→DDS→RGBA→PNG) dans le dump disque.
    ///
    /// Lit l'index Redis db3 (iev:file:index) pour localiser les g4tx dans les CPK,
    /// décode chacun via nie-formats + image_dds (BC1/BC3/BC7), et écrit le PNG
    /// à <game_dir>/data/dx11/menu/.../<nom>.png (idempotent : skip si non-vide).
    ///
    /// Priorité : sprites des 32 layouts azalee (<layouts_dir>/*.json) ; le reste si --all.
    MenuPredecode {
        /// Répertoire racine du jeu (contenant data/packs/).
        #[arg(long, default_value = "/home/ubuntu/.local/share/Steam/iecode/inazuma")]
        game_dir: PathBuf,
        /// Répertoire des layouts azalee (*.json).
        #[arg(long, default_value = "/home/ubuntu/rg/apps/azalee/app/menu/_layouts")]
        layouts_dir: PathBuf,
        /// URL Redis db3 (iev:file:index).
        #[arg(long, default_value = "redis://127.0.0.1/3")]
        redis_url: String,
        /// Traite aussi TOUS les g4tx menu fr+en+base (pas seulement les sprites des layouts).
        #[arg(long)]
        all: bool,
    },
}

#[derive(Subcommand)]
enum SaveOp {
    /// Déchiffre et affiche un résumé terse d'un fichier de sauvegarde Lives.
    Read {
        /// Chemin vers le fichier de sauvegarde (ex. `002AB8F4-SYSTEMLIVE`).
        #[arg(long)]
        file: std::path::PathBuf,
        /// Affiche aussi les N premiers octets du corps de chaque blob.
        #[arg(long, default_value_t = 0)]
        hexdump: usize,
    },
    /// Déchiffre un fichier de sauvegarde et écrit le plaintext.
    Decrypt {
        /// Chemin vers le fichier de sauvegarde chiffré.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Chemin de sortie pour le plaintext.
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Chiffre un fichier plaintext (issu de `decrypt`) et produit le fichier sauvegarde.
    Encrypt {
        /// Chemin vers le plaintext.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Nom de slot (ex. `002AB8F4-SYSTEMLIVE`) pour dériver la clé.
        #[arg(long)]
        slot: String,
        /// Chemin de sortie pour le fichier chiffré.
        #[arg(long)]
        out: std::path::PathBuf,
    },
    /// Édite un byte dans le corps d'un blob et rechiffre.
    Edit {
        /// Chemin vers le fichier de sauvegarde.
        #[arg(long)]
        file: std::path::PathBuf,
        /// Nom interne du blob (ex. `SYSTEM_data.bin`).
        #[arg(long)]
        blob: String,
        /// Offset dans le corps du blob (décimal ou `0x…`).
        #[arg(long, value_parser = parse_addr)]
        offset: i64,
        /// Nouvelle valeur du byte (décimal ou `0x…`).
        #[arg(long, value_parser = parse_addr)]
        value: i64,
        /// Fichier de sortie (défaut : écrase l'entrée).
        #[arg(long)]
        out: Option<std::path::PathBuf>,
    },
}

#[derive(Subcommand)]
enum QueueOp {
    /// Empile une adresse (décimale ou hex `0x...`).
    Push {
        #[arg(value_parser = parse_addr)]
        addr: i64,
    },
    /// Dépile la prochaine adresse.
    Pop,
    /// Taille de la frontière.
    Len,
    /// Vide la frontière.
    Reset,
}

#[derive(Subcommand)]
enum WikiOp {
    /// Profil complet d'un personnage (stats, techniques, auras).
    Chara {
        /// Nom, ID ou code interne du personnage (ex: "Mark", "0x99A1C150", "c01000010").
        query: String,
        /// Sortie JSON machine.
        #[arg(long, short = 'j')]
        json: bool,
        /// Chemin vers le miroir SQLite (override NIE_WIKI_DB / SQLITE_DB_PATH).
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'une technique / skill.
    Skill {
        /// Nom, ID ou code interne de la technique (ex: "Tempête du désert", "whd00580").
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'un item / objet.
    Item {
        /// Nom, ID ou code interne de l'objet.
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Profil d'une équipe.
    Team {
        /// Nom, ID ou code interne de l'équipe (ex: "Raimon", "0xF01BB293").
        query: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Compare deux personnages côte à côte (stats interpolées, moveset, diff).
    Compare {
        /// Premier personnage (nom / ID / code interne).
        chara1: String,
        /// Deuxième personnage.
        chara2: String,
        /// Niveau pour l'interpolation de stats (1–99).
        #[arg(long, short = 'l', default_value = "99")]
        level: u8,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Recherche multi-tables (characters / skills / items / teams / auras / keshins / souls).
    Search {
        /// Terme de recherche.
        query: String,
        /// Nombre maximum de résultats (défaut 20).
        #[arg(long, short = 'n', default_value = "20")]
        limit: usize,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Exécute une requête SQL read-only sur le miroir et affiche le résultat.
    ///
    /// Seuls SELECT, PRAGMA, EXPLAIN et WITH … SELECT sont autorisés.
    Db {
        /// Requête SQL (ex: "SELECT COUNT(*) FROM inagle_characters").
        sql: String,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Génère une équipe aléatoire depuis le miroir.
    ///
    /// Requiert un seed explicite — le RNG non seédé est interdit dans niers.
    RandomTeam {
        /// Seed entier pour le PRNG (déterministe).
        #[arg(long, short = 's')]
        seed: u64,
        /// Formation (ex: 4-4-2, 4-3-3, 3-5-2). Défaut: 4-4-2.
        #[arg(long, short = 'f', default_value = "4-4-2")]
        formation: String,
        /// Filtre élément (Feu/Vent/Forêt/Montagne/Néant). Optionnel.
        #[arg(long, short = 'e')]
        element: Option<String>,
        /// Filtre style de jeu. Optionnel.
        #[arg(long, short = 'p')]
        playstyle: Option<String>,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Gère les compositions d'équipes depuis le miroir (actions: list / show / calc).
    ///
    /// Note : list/add/delete dans PostgreSQL (user_teams) nécessitent DATABASE_URL.
    /// La partie miroir SQLite (inagle_team_build) est accessible sans réseau.
    TeamBuilder {
        /// Action : list | show <id> | calc <id>.
        action: String,
        /// Arguments de l'action (ex: ID pour show/calc).
        #[arg(trailing_var_arg = true)]
        args: Vec<String>,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Diagnostic du miroir SQLite + ping Redis db0/db3.
    Status {
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Commande Redis simple (get / set / del) sur db0 par défaut.
    Redis {
        /// Commande : get | set | del.
        cmd: String,
        /// Clé Redis.
        key: String,
        /// Valeur (requis pour set).
        val: Option<String>,
        /// URL Redis complète (ex: redis://127.0.0.1/3 pour db3).
        #[arg(long, default_value = "redis://127.0.0.1/0")]
        redis_url: String,
        #[arg(long, short = 'j')]
        json: bool,
    },
    /// Audite la cohérence du miroir (counts, nulls sur tables clés).
    Audit {
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
    /// Recherche dans les sous-titres / dialogues de `inagle_event_subtitles`.
    Dialogue {
        /// Texte à rechercher (FR / EN / JA).
        query: String,
        /// Nombre de résultats max (défaut 10).
        #[arg(long, short = 'n', default_value = "10")]
        limit: usize,
        #[arg(long, short = 'j')]
        json: bool,
        #[arg(long, env = "NIE_WIKI_DB")]
        db: Option<std::path::PathBuf>,
    },
}

fn wiki_cmd(op: WikiOp) -> anyhow::Result<()> {
    use nie_wiki::{mirror, query, render};

    match op {
        // ─── Commandes existantes ────────────────────────────────────────────
        WikiOp::Chara { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let matches = query::search_characters(&conn, &q)?;

            if matches.is_empty() {
                if json {
                    println!("[]");
                } else {
                    println!("Aucun personnage trouve pour : \"{}\"", q);
                }
                return Ok(());
            }

            if matches.len() > 1 && !json {
                // Vérifier si c'est une correspondance exacte sur un seul personnage logique
                let first_chara_id = &matches[0].chara_id;
                let all_same = matches.iter().all(|m| &m.chara_id == first_chara_id);
                if !all_same {
                    println!("Plusieurs personnages correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {} | Code: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                            m.internal_code.as_deref().unwrap_or("N/A"),
                        );
                    }
                    return Ok(());
                }
            }

            // Charger le profil complet du premier match
            let target_id = &matches[0].id;
            let profile = query::get_character(&conn, target_id)?
                .ok_or_else(|| anyhow::anyhow!("profil introuvable pour {}", target_id))?;

            if json {
                println!("{}", serde_json::to_string_pretty(&profile)?);
            } else {
                println!("{}", render::render_chara_profile(&profile, &conn));
            }
        }

        WikiOp::Skill { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            // Essai par ID exact d'abord
            let mut skill = query::get_skill(&conn, &q)?;

            if skill.is_none() {
                let matches = query::search_skills(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucune technique trouvee pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs techniques correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                skill = matches.into_iter().next();
            }

            let sk = skill.ok_or_else(|| anyhow::anyhow!("skill introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&sk)?);
            } else {
                println!("{}", render::render_skill_profile(&sk));
            }
        }

        WikiOp::Item { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            let mut item = query::get_item(&conn, &q)?;

            if item.is_none() {
                let matches = query::search_items(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucun item trouve pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs items correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                item = matches.into_iter().next();
            }

            let it = item.ok_or_else(|| anyhow::anyhow!("item introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&it)?);
            } else {
                println!("{}", render::render_item_profile(&it));
            }
        }

        WikiOp::Team { query: q, json, db } => {
            let conn = mirror::open(db.as_deref())?;

            let mut team = query::get_team(&conn, &q)?;

            if team.is_none() {
                let matches = query::search_teams(&conn, &q)?;
                if matches.is_empty() {
                    if json {
                        println!("[]");
                    } else {
                        println!("Aucune equipe trouvee pour : \"{}\"", q);
                    }
                    return Ok(());
                }
                if matches.len() > 1 && !json {
                    println!("Plusieurs equipes correspondent a \"{}\" :", q);
                    for m in &matches {
                        println!(
                            "  - {} / {} (ID: {})",
                            m.name_fr.as_deref().unwrap_or("N/A"),
                            m.name_en.as_deref().unwrap_or("N/A"),
                            m.id,
                        );
                    }
                    return Ok(());
                }
                team = matches.into_iter().next();
            }

            let t = team.ok_or_else(|| anyhow::anyhow!("equipe introuvable"))?;
            if json {
                println!("{}", serde_json::to_string_pretty(&t)?);
            } else {
                println!("{}", render::render_team_profile(&t));
            }
        }

        // ─── Nouvelles commandes ─────────────────────────────────────────────

        WikiOp::Compare { chara1, chara2, level, json, db } => {
            anyhow::ensure!(
                (1..=99).contains(&level),
                "le niveau doit être compris entre 1 et 99 (reçu: {})",
                level
            );
            let conn = mirror::open(db.as_deref())?;
            let result = query::compare_characters(&conn, &chara1, &chara2, level)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else {
                println!("{}", render::render_compare(&result));
            }
        }

        WikiOp::Search { query: q, limit, json, db } => {
            if q.trim().is_empty() {
                anyhow::bail!("terme de recherche vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let results = query::search_all(&conn, &q, limit)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&results)?);
            } else {
                println!("{}", render::render_search_results(&results));
            }
        }

        WikiOp::Db { sql, json, db } => {
            if sql.trim().is_empty() {
                anyhow::bail!("requête SQL vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let rows = query::exec_readonly_sql(&conn, &sql)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                println!("Resultats ({} lignes) :", rows.len());
                println!("{}", render::render_ascii_table(&rows));
            }
        }

        WikiOp::RandomTeam { seed, formation, element, playstyle, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let team = query::random_team(
                &conn,
                &formation,
                element.as_deref(),
                playstyle.as_deref(),
                seed,
            )?;
            if json {
                println!("{}", serde_json::to_string_pretty(&team)?);
            } else {
                println!("{}", render::render_random_team(&team));
            }
        }

        WikiOp::TeamBuilder { action, args, json, db } => {
            let conn = mirror::open(db.as_deref())?;
            match action.as_str() {
                "list" => {
                    let entries = query::team_build_list(&conn)?;
                    if json {
                        println!("{}", serde_json::to_string_pretty(&entries)?);
                    } else {
                        println!("{}", render::render_team_build_list(&entries));
                    }
                }
                "show" | "calc" => {
                    let id = args.first().ok_or_else(|| {
                        anyhow::anyhow!("Usage: niers wiki team-builder {} <id>", action)
                    })?;
                    let entry = query::team_build_calc(&conn, id)?;
                    match entry {
                        None => {
                            if json {
                                println!("null");
                            } else {
                                println!("Aucune entree trouvee pour : \"{}\"", id);
                            }
                        }
                        Some(e) => {
                            if json {
                                println!("{}", serde_json::to_string_pretty(&e)?);
                            } else {
                                println!("{}", render::render_team_build_entry(&e));
                            }
                        }
                    }
                }
                other => {
                    anyhow::bail!(
                        "action inconnue : '{}'. Actions supportées depuis le miroir : list / show <id> / calc <id>.\n\
                         Note : add/delete/save opèrent sur PostgreSQL (user_teams) et ne sont pas portés ici.",
                        other
                    );
                }
            }
        }

        WikiOp::Status { json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let report = query::status_report(&conn)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", render::render_status(&report));
            }
        }

        WikiOp::Redis { cmd, key, val, redis_url, json } => {
            let result = query::redis_cmd(&redis_url, &cmd, &key, val.as_deref())?;
            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "cmd": cmd,
                        "key": key,
                        "value": result,
                    }))?
                );
            } else {
                match &result {
                    None => println!("(nil)"),
                    Some(v) => println!("{}", v),
                }
            }
        }

        WikiOp::Audit { json, db } => {
            let conn = mirror::open(db.as_deref())?;
            let report = query::audit_mirror(&conn)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!("{}", render::render_audit(&report));
            }
        }

        WikiOp::Dialogue { query: q, limit, json, db } => {
            if q.trim().is_empty() {
                anyhow::bail!("terme de recherche vide");
            }
            let conn = mirror::open(db.as_deref())?;
            let matches = query::search_dialogues(&conn, &q, limit)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&matches)?);
            } else {
                println!("{}", render::render_dialogues(&matches, &q));
            }
        }
    }

    Ok(())
}

fn main() -> anyhow::Result<()> {
    // CLI interne (consommé par l'agent) : sortie minimale. `RUST_LOG=info` réactive les traces.
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env().add_directive(tracing::Level::WARN.into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Seed { db, json, exe } => seed(&db, &json, exe.as_deref()),
        Cmd::Coverage { db } => coverage(&db),
        Cmd::Queue { op, redis, tag } => queue(op, &redis, &tag),
        Cmd::Propagate { db, rounds } => propagate(&db, rounds),
        Cmd::Rtti { db, exe } => rtti(&db, &exe),
        Cmd::Index { db, exe } => index(&db, &exe),
        Cmd::Disasm { db, exe } => disasm(&db, &exe),
        Cmd::Pdata { db, exe } => pdata(&db, &exe),
        Cmd::Rebuild { db, exe, rounds } => rebuild(&db, &exe, rounds),
        Cmd::Save { op } => save_cmd(op),
        Cmd::Wiki { op } => wiki_cmd(op),
        Cmd::UniformMap { game_dir, out } => uniform_map(&game_dir, &out),
        Cmd::Textures { game_dir, limit, manifest, redis: use_redis, redis_url } => {
            textures(&game_dir, limit, &manifest, use_redis, &redis_url)
        }
        Cmd::MenuPredecode { game_dir, layouts_dir, redis_url, all } => {
            menu_predecode_cmd(&game_dir, &layouts_dir, &redis_url, all)
        }
    }
}

fn seed(db_path: &std::path::Path, json: &std::path::Path, exe: Option<&std::path::Path>) -> anyhow::Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;

    let (sha, size, path_str) = match exe {
        Some(p) => {
            let bytes = std::fs::read(p).with_context(|| format!("lecture {}", p.display()))?;
            let mut h = Sha256::new();
            h.update(&bytes);
            (hex::encode(h.finalize()), bytes.len() as i64, p.display().to_string())
        }
        None => ("unknown-nie-index".to_string(), 0, "nie.exe".to_string()),
    };
    let bin = db.upsert_binary(&path_str, &sha, "x86_64", 64, NIE_IMAGE_BASE, size, None, None)?;

    let stats = nie_seed::nie_index_json::ingest_file(&mut db, bin, json)?;
    let cov = db.snapshot_coverage(bin)?;
    println!(
        "seed fn={} call={} str={} const={} glob={} anchor={} cov={}/{} ({:.2}%)",
        stats.functions, stats.xrefs, stats.str_refs, stats.consts, stats.globals, stats.anchors,
        cov.classified, cov.total, cov.pct
    );
    Ok(())
}

fn coverage(db_path: &std::path::Path) -> anyhow::Result<()> {
    let db = nie_index::Db::open(db_path)?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;
    let cov = nie_index::query::coverage(db.conn(), bin)?;
    let by_sub = nie_index::query::by_subsystem(db.conn(), bin)?;
    let subs = by_sub.iter().map(|(ns, n)| format!("{ns}={n}")).collect::<Vec<_>>().join(" ");
    println!("cov {}/{} ({:.2}%) named={} | {}", cov.classified, cov.total, cov.pct, cov.named, subs);
    Ok(())
}

fn queue(op: QueueOp, redis: &str, tag: &str) -> anyhow::Result<()> {
    let mut f = nie_queue::Frontier::connect(redis, tag)?;
    match op {
        QueueOp::Push { addr } => {
            let added = f.push(addr)?;
            println!("{}", if added { "ajoutée" } else { "déjà vue" });
        }
        QueueOp::Pop => match f.pop()? {
            Some(a) => println!("0x{a:x}"),
            None => println!("(frontière vide)"),
        },
        QueueOp::Len => println!("frontière: {} | vues: {}", f.len()?, f.seen_count()?),
        QueueOp::Reset => {
            f.reset()?;
            println!("frontière réinitialisée");
        }
    }
    Ok(())
}

fn propagate(db_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::loop_db::propagate_db(&mut db, bin, rounds)
        .context("propagation")?;

    println!(
        "propagate rounds={} anchors(str/rtti/const)={}/{}/{} cov {:.2}%->{:.2}% (+{} fn)",
        stats.rounds, stats.anchored_str, stats.anchored_rtti, stats.anchored_const,
        stats.coverage_before, stats.coverage_after, stats.classified_after - stats.classified_before
    );
    Ok(())
}

fn rtti(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let bytes = std::fs::read(exe_path)
        .with_context(|| format!("lecture {}", exe_path.display()))?;

    let stats = nie_re::rtti::parse_and_ingest(&mut db, bin, &bytes)
        .context("parsing RTTI")?;

    println!(
        "rtti col={} td={} classes={} bases={}",
        stats.candidates, stats.valid_type_descs, stats.classes_ingested, stats.bases_ingested
    );
    Ok(())
}

fn index(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::indexer::triage_into(&mut db, bin, exe_path)
        .context("indexation PE")?;

    println!(
        "index fmt={} sections={} imports={} exports={}",
        stats.format, stats.sections, stats.imports, stats.exports
    );
    Ok(())
}

fn disasm(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::disasm::recover_call_edges(&mut db, bin, exe_path)
        .context("désassemblage des arêtes d'appel")?;

    println!(
        "disasm insn={} call={} jmp={} thunk={} miss={} cand={} new={}",
        stats.instructions_decoded, stats.call_near, stats.jmp_near, stats.thunk_resolved,
        stats.near_target_miss, stats.edges_candidates, stats.edges_new
    );
    Ok(())
}

fn pdata(db_path: &std::path::Path, exe_path: &std::path::Path) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    let stats = nie_re::pdata::discover_into(&mut db, bin, exe_path)
        .context("découverte .pdata")?;

    let pct_aligned = if stats.ghidra_total > 0 {
        100.0 * stats.overlap_ghidra as f64 / stats.ghidra_total as f64
    } else {
        0.0
    };
    println!(
        "pdata entries={} chained={} roots={} inserted={} | ghidra {}/{} aligned ({:.1}%) inside_body={}",
        stats.entries, stats.chained_fragments, stats.roots, stats.inserted,
        stats.overlap_ghidra, stats.ghidra_total, pct_aligned, stats.ghidra_inside_body
    );
    Ok(())
}

fn rebuild(db_path: &std::path::Path, exe_path: &std::path::Path, rounds: usize) -> anyhow::Result<()> {
    let mut db = nie_index::Db::open(db_path).context("ouverture base")?;
    let src_bin: i64 = db
        .conn()
        .query_row("SELECT id FROM binary ORDER BY id LIMIT 1", [], |r| r.get(0))
        .context("aucun binaire indexé — lancer `niers seed` d'abord")?;

    // Binaire cible distinct (vérité .pdata) : sha dérivé pour ne pas écraser la source.
    let (path_str, src_sha): (String, String) = db.conn().query_row(
        "SELECT path, sha256 FROM binary WHERE id=?1",
        [src_bin],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let dst_bin = db.upsert_binary(
        &format!("{path_str}#pdata"),
        &format!("{src_sha}-pdata"),
        "x86_64",
        64,
        NIE_IMAGE_BASE,
        0,
        None,
        None,
    )?;

    let rb = nie_re::pdata::rebuild_from_pdata(&mut db, src_bin, dst_bin, exe_path)?;
    let vt = nie_re::vtable::vtable_edges_into(&mut db, src_bin, dst_bin, exe_path)?;
    let dis = nie_re::disasm::recover_call_edges(&mut db, dst_bin, exe_path)?;
    let prop = nie_re::loop_db::propagate_db(&mut db, dst_bin, rounds)?;

    println!(
        "rebuild roots={} str={} ce={} rtti={} | vtable methods={} leaf+={} edges={} | disasm new={} | cov={}/{} ({:.2}%)",
        rb.roots, rb.str_refs_moved, rb.ce_edges_mapped, rb.rtti_copied,
        vt.methods, vt.new_leaf_funcs, vt.cohesion_edges,
        dis.edges_new, prop.classified_after, prop.total, prop.coverage_after
    );
    Ok(())
}

/// Entrée du manifeste NDJSON pour une texture G4TX.
#[derive(serde::Serialize)]
struct TexEntry<'a> {
    path: &'a str,
    cpk: &'a str,
    width: i32,
    height: i32,
    format: &'static str,
    mips: u8,
}

fn textures(
    game_dir: &std::path::Path,
    limit: usize,
    manifest_path: &std::path::Path,
    use_redis: bool,
    redis_url: &str,
) -> anyhow::Result<()> {
    use nie_formats::vfs::Vfs;
    use nie_formats::g4tx;

    let data_dir = game_dir.join("data");

    // Initialiser le VFS depuis cpk_list.cfg.bin
    let mut vfs = Vfs::new();
    vfs.init(&data_dir).context("init VFS depuis cpk_list.cfg.bin")?;

    // Collecter tous les chemins .g4tx indexés
    let all_g4tx: Vec<(String, String)> = {
        // Accès à l'index interne via itération : on utilise find() sur les clés connues,
        // mais l'API publique n'expose pas d'itérateur. On reconstruit la liste via
        // la méthode asset_count() pour vérifier, puis on scanne via une méthode d'itération
        // publique si disponible.
        // Comme l'API Vfs n'expose pas d'itérateur direct, on charge le cfg.bin nous-mêmes
        // pour collecter les chemins .g4tx.
        collect_g4tx_paths(&data_dir)?
    };

    let total_found = all_g4tx.len();
    let to_process = all_g4tx.len().min(limit);
    let dropped = total_found.saturating_sub(limit);

    tracing::info!(total_found, to_process, dropped, "fichiers .g4tx découverts");

    // Préparer le fichier manifeste
    if let Some(parent) = manifest_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut manifest_file = std::fs::File::create(manifest_path)
        .with_context(|| format!("création manifeste {}", manifest_path.display()))?;

    // Connexion Redis optionnelle
    let mut redis_conn: Option<redis::Connection> = if use_redis {
        match redis::Client::open(redis_url).and_then(|c| c.get_connection()) {
            Ok(conn) => {
                tracing::info!("Redis connecté : {redis_url}");
                Some(conn)
            }
            Err(e) => {
                tracing::warn!("Redis indisponible ({e}) — poursuite sans Redis");
                None
            }
        }
    } else {
        None
    };

    let mut parsed = 0usize;
    let mut failed = 0usize;

    for (internal_path, cpk_name) in all_g4tx.iter().take(limit) {
        let raw = match vfs.read(internal_path) {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("échec extraction {internal_path}: {e}");
                failed += 1;
                continue;
            }
        };

        let g = match g4tx::parse(&raw) {
            Ok(g) => g,
            Err(e) => {
                tracing::warn!("échec parse g4tx {internal_path}: {e}");
                failed += 1;
                continue;
            }
        };

        // Pour chaque texture dans le conteneur g4tx
        for tex in &g.textures {
            // Format : on déduit depuis is_dds ; mips : approximation depuis les dimensions
            // (le champ mips n'est pas dans le header G4TX public — on expose 0 comme sentinelle)
            let format_str: &'static str = if tex.is_dds { "DDS" } else { "NXTCH" };
            let mips: u8 = 0; // G4txHeader n'expose pas de champ mips explicite

            let entry = TexEntry {
                path: internal_path.as_str(),
                cpk: cpk_name.as_str(),
                width: tex.width,
                height: tex.height,
                format: format_str,
                mips,
            };

            let line = serde_json::to_string(&entry).context("sérialisation JSON")?;
            writeln!(manifest_file, "{line}").context("écriture manifeste")?;

            // Pousser dans Redis si activé
            if let Some(ref mut conn) = redis_conn {
                use redis::Commands;
                let redis_path_key = format!("iev:tex:{internal_path}");
                if let Err(e) = conn.sadd::<_, _, i64>("iev:tex:index", internal_path.as_str()) {
                    tracing::warn!("redis SADD échec: {e}");
                }
                if let Err(e) = conn.hset_multiple::<_, _, _, ()>(&redis_path_key, &[
                    ("width", tex.width.to_string()),
                    ("height", tex.height.to_string()),
                    ("format", format_str.to_string()),
                    ("mips", mips.to_string()),
                    ("cpk", cpk_name.clone()),
                ]) {
                    tracing::warn!("redis HSET échec: {e}");
                }
            }
        }

        parsed += 1;
    }

    // Écrire meta Redis
    if let Some(ref mut conn) = redis_conn {
        use redis::Commands;
        if let Err(e) = conn.hset_multiple::<_, _, _, ()>("iev:tex:meta", &[
            ("parsed", parsed.to_string()),
            ("failed", failed.to_string()),
            ("total_found", total_found.to_string()),
            ("limit", limit.to_string()),
            ("dropped", dropped.to_string()),
        ]) {
            tracing::warn!("redis meta HSET échec: {e}");
        }
    }

    // Comptage Redis pour sortie terse
    let redis_count: usize = if let Some(ref mut conn) = redis_conn {
        use redis::Commands;
        conn.scard::<_, usize>("iev:tex:index").unwrap_or(0)
    } else {
        0
    };

    // Sortie terse (convention niers : 1 ligne clé=val)
    if dropped > 0 {
        println!(
            "tex.parsed={parsed} tex.failed={failed} tex.total={total_found} tex.dropped={dropped} manifest={} redis_index={}",
            manifest_path.display(),
            redis_count
        );
    } else {
        println!(
            "tex.parsed={parsed} tex.failed={failed} tex.total={total_found} manifest={} redis_index={}",
            manifest_path.display(),
            redis_count
        );
    }

    Ok(())
}

fn save_cmd(op: SaveOp) -> anyhow::Result<()> {
    use nie_save::io::{edit_blob_byte, hexdump_blob_body, print_summary, read_save, write_save};

    match op {
        SaveOp::Read { file, hexdump } => {
            let container = read_save(&file)
                .map_err(|e| anyhow::anyhow!("lecture save : {e}"))?;
            print_summary(&container);
            if hexdump > 0 {
                for (i, blob) in container.blobs.iter().enumerate() {
                    println!("  hexdump blob[{i}]:");
                    hexdump_blob_body(blob, hexdump);
                }
            }
        }
        SaveOp::Decrypt { file, out } => {
            // XOR direct sur le fichier brut : le keystream est involutif, donc
            // decrypt = encrypt = XOR(données, keystream).
            // On n'utilise PAS serialize_plaintext() pour rester byte-identique à l'original.
            let raw = std::fs::read(&file)
                .with_context(|| format!("lecture {}", file.display()))?;
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .ok_or_else(|| anyhow::anyhow!("nom de fichier invalide : {}", file.display()))?;
            let key = nie_save::key_from_filename(filename);
            let mut plain = raw;
            nie_save::decrypt_block(&mut plain, 0, key);
            std::fs::write(&out, &plain)
                .with_context(|| format!("écriture plaintext {}", out.display()))?;
            println!("decrypt ok={} bytes={}", out.display(), plain.len());
        }
        SaveOp::Encrypt { file, slot, out } => {
            let plain = std::fs::read(&file)
                .with_context(|| format!("lecture {}", file.display()))?;
            // Chiffrer le plaintext avec la clé dérivée du nom de slot
            let key = nie_save::key_from_filename(&slot);
            let mut enc = plain;
            nie_save::decrypt_block(&mut enc, 0, key);
            std::fs::write(&out, &enc)
                .with_context(|| format!("écriture {}", out.display()))?;
            println!("encrypt slot={slot} key=0x{key:08X} out={} bytes={}", out.display(), enc.len());
        }
        SaveOp::Edit { file, blob: blob_name, offset, value, out } => {
            if !(0..=255).contains(&value) {
                anyhow::bail!("valeur {value} hors plage [0, 255]");
            }
            if offset < 0 {
                anyhow::bail!("offset {offset} négatif");
            }
            let mut container = read_save(&file)
                .map_err(|e| anyhow::anyhow!("lecture save : {e}"))?;
            let ok = edit_blob_byte(&mut container, &blob_name, offset as usize, value as u8);
            if !ok {
                anyhow::bail!("blob '{}' introuvable ou offset {} hors limites", blob_name, offset);
            }
            let out_path = out.as_deref().unwrap_or(&file);
            write_save(&container, out_path)
                .map_err(|e| anyhow::anyhow!("écriture save : {e}"))?;
            println!(
                "edit blob={blob_name} offset=0x{offset:X} value=0x{value:02X} out={}",
                out_path.display()
            );
        }
    }
    Ok(())
}

/// Construit un manifeste NDJSON CRC32->chemin pour tous les fichiers .g4md et .g4mg du VFS.
/// Chaque ligne JSON : `{"crc":3735928559,"path":"chr/c01000010.g4md","cpk":"abc123.cpk"}`
///
/// Le CRC32 est calculé avec l'algorithme du jeu (accumulteur sans inversion finale,
/// sur le nom de fichier complet sans extension, en minuscules, sans chemin).
fn uniform_map(game_dir: &std::path::Path, out: &std::path::Path) -> anyhow::Result<()> {
    use std::io::Write as IoWrite;
    use nie_formats::vfs::Vfs;

    let data_dir = game_dir.join("data");
    let mut vfs = Vfs::new();
    vfs.init(&data_dir).context("init VFS depuis cpk_list.cfg.bin")?;

    tracing::info!(
        asset_count = vfs.asset_count(),
        cpk_count = vfs.cpk_count(),
        "VFS initialisé"
    );

    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut f = std::fs::File::create(out)
        .with_context(|| format!("création manifeste {}", out.display()))?;

    let mut count = 0usize;
    for (path, entry) in vfs.iter() {
        let lower = path.to_lowercase();
        if !lower.ends_with(".g4md") && !lower.ends_with(".g4mg") {
            continue;
        }
        // Nom sans extension pour le CRC (selon l'usage dans g4.rs)
        let stem = path.rsplit('/').next().unwrap_or(path);
        let stem_no_ext = stem.rfind('.').map(|i| &stem[..i]).unwrap_or(stem);
        let crc = nie_formats::cpk::crc32_nie(stem_no_ext.as_bytes());
        let line = serde_json::json!({
            "crc": crc,
            "crc_hex": format!("0x{crc:08X}"),
            "path": path,
            "cpk": entry.cpk_filename,
        });
        writeln!(f, "{line}")?;
        count += 1;
    }

    eprintln!("uniform-map: {count} fichiers .g4md/.g4mg indexés → {}", out.display());
    Ok(())
}

/// Charge le cpk_list.cfg.bin et extrait tous les chemins internes se terminant par `.g4tx`.
/// Retourne (internal_path, cpk_filename).
fn collect_g4tx_paths(data_dir: &std::path::Path) -> anyhow::Result<Vec<(String, String)>> {
    use std::io::Read;

    let cpk_list_path = data_dir.join("cpk_list.cfg.bin");
    let mut file = std::fs::File::open(&cpk_list_path)
        .with_context(|| format!("ouverture {}", cpk_list_path.display()))?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).context("lecture cpk_list.cfg.bin")?;

    // Déchiffrer avec la clé fixe Viola
    nie_formats::cpk::decrypt_block(&mut data, 0, nie_formats::cpk::VIOLA_FIXED_KEY);

    let cfg = nie_formats::cfgbin::cfgbin_parse(&data)
        .map_err(|e| anyhow::anyhow!("parse cfg.bin: {e}"))?;

    let mut result = Vec::new();
    for root_entry in &cfg.entries {
        for child in &root_entry.children {
            if child.variables.len() < 5 {
                continue;
            }
            let directory = match &child.variables[0] {
                nie_formats::cfgbin::Value::String(s) => s.as_str(),
                _ => continue,
            };
            let filename = match &child.variables[1] {
                nie_formats::cfgbin::Value::String(s) => s.as_str(),
                _ => continue,
            };
            let cpk_hash = match &child.variables[3] {
                nie_formats::cfgbin::Value::String(s) => s.clone(),
                _ => continue,
            };

            if !filename.ends_with(".g4tx") {
                continue;
            }

            let internal_path = format!("{directory}{filename}");
            result.push((internal_path, cpk_hash));
        }
    }

    Ok(result)
}

// ---------------------------------------------------------------------------
// MenuPredecode
// ---------------------------------------------------------------------------

fn menu_predecode_cmd(
    game_dir: &std::path::Path,
    layouts_dir: &std::path::Path,
    redis_url: &str,
    all_menu: bool,
) -> anyhow::Result<()> {
    // dump_root = game_dir/data (les sprite logicalPaths commencent par "dx11/...")
    let dump_root = game_dir.join("data");
    let packs_dir = game_dir.join("data").join("packs");

    // Extraire les sprites des layouts azalee (champ sprite.logicalPath des JSON).
    let priority_paths = extract_layout_sprites(layouts_dir)?;
    eprintln!(
        "predecode layouts={} sprites_uniques={}",
        count_json_files(layouts_dir),
        priority_paths.len()
    );

    let stats = menu_predecode::run(
        &dump_root,
        &packs_dir,
        redis_url,
        &priority_paths,
        all_menu,
    )?;

    println!(
        "decoded={} skipped={} failed={}",
        stats.decoded, stats.skipped, stats.failed
    );
    Ok(())
}

/// Extrait les `sprite.logicalPath` (`.g4tx`) uniques depuis tous les *.json du dossier layouts.
fn extract_layout_sprites(layouts_dir: &std::path::Path) -> anyhow::Result<Vec<String>> {
    use std::collections::HashSet;

    let mut seen: HashSet<String> = HashSet::new();
    let mut result: Vec<String> = Vec::new();

    let entries = std::fs::read_dir(layouts_dir)
        .with_context(|| format!("lecture layouts {}", layouts_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("lecture {}", path.display()))?;
        let json: serde_json::Value = serde_json::from_str(&content)
            .with_context(|| format!("parse JSON {}", path.display()))?;

        if let Some(objects) = json.get("objects").and_then(|v| v.as_array()) {
            for obj in objects {
                if let Some(sprite) = obj.get("sprite") {
                    if let Some(logical_path) = sprite
                        .get("logicalPath")
                        .and_then(|v| v.as_str())
                    {
                        if logical_path.ends_with(".g4tx") && seen.insert(logical_path.to_string()) {
                            result.push(logical_path.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(result)
}

fn count_json_files(layouts_dir: &std::path::Path) -> usize {
    std::fs::read_dir(layouts_dir)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().extension().and_then(|x| x.to_str()) == Some("json")
                })
                .count()
        })
        .unwrap_or(0)
}
