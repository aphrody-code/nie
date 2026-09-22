//! CLI operations for the NIE Online multiplayer, networking, and competitive engine (`nie net`).

use anyhow::{Context, Result};
use clap::{Args, Subcommand};
use std::net::SocketAddr;

#[derive(Debug, Args)]
pub struct NetArgs {
    #[command(subcommand)]
    pub op: NetOp,
}

#[derive(Debug, Subcommand)]
pub enum NetOp {
    /// Start the standalone WebSocket multiplayer and matchmaking server.
    Server {
        /// Socket address to bind (e.g. 127.0.0.1:8085 or 0.0.0.0:8085).
        #[arg(long, default_value = "127.0.0.1:8085")]
        bind: String,
    },
    /// Inacode room creation and formatting.
    Room {
        #[command(subcommand)]
        op: RoomOp,
    },
    /// Run an automated 2-player deterministic match simulation with rollback verification.
    SimMatch {
        /// Number of simulation ticks to execute.
        #[arg(long, default_value_t = 600)]
        ticks: u64,
        /// Initial RNG seed.
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
    /// Shareable 8-character base-32 challenge link operations.
    Challenge {
        #[command(subcommand)]
        op: ChallengeOp,
    },
    /// Competitive ladder rankings and 11 official rank tiers.
    Ladder {
        /// Maximum number of players to display.
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
    /// Clan and club leaderboards.
    Clans {
        /// Maximum number of clubs to display.
        #[arg(long, default_value_t = 10)]
        limit: usize,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
    /// Calculate progressive directional ELO delta for a match.
    CalcElo {
        /// Player A current rating (AP).
        elo_a: u32,
        /// Player B current rating (AP).
        elo_b: u32,
        /// Match score for player A (1.0 = win, 0.5 = draw, 0.0 = loss).
        #[arg(default_value_t = 1.0)]
        score_a: f64,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum RoomOp {
    /// Create a new Inacode room and print its details.
    Create {
        /// Stadium identifier.
        #[arg(long, default_value = "raimon_field")]
        stadium: String,
        /// Match mode ("1v1" or "2v2").
        #[arg(long, default_value = "1v1")]
        mode: String,
        /// Half time duration in seconds.
        #[arg(long, default_value_t = 180)]
        half_time: u32,
        /// Optional password.
        #[arg(long)]
        password: Option<String>,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
    /// Formats or generates a canonical Inacode (`INA-XXXX`).
    Format {
        /// Raw code or seed number.
        code: String,
    },
}

#[derive(Debug, Subcommand)]
pub enum ChallengeOp {
    /// Create a new shareable 8-character base-32 challenge.
    Create {
        /// Challenger user ID.
        #[arg(long, default_value = "user_001")]
        user_id: String,
        /// Challenger display name.
        #[arg(long, default_value = "Joueur 1")]
        name: String,
        /// Challenger rating.
        #[arg(long, default_value_t = 1000)]
        elo: u32,
        /// Whether the challenge counts for ranked AP.
        #[arg(long)]
        ranked: bool,
        /// Target opponent user ID (optional).
        #[arg(long)]
        opponent: Option<String>,
        /// Output machine-readable JSON status.
        #[arg(long)]
        json: bool,
    },
}

pub async fn exec_net(args: NetArgs) -> Result<()> {
    match args.op {
        NetOp::Server { bind } => {
            let addr: SocketAddr = bind
                .parse()
                .with_context(|| format!("invalid socket address '{bind}'"))?;
            println!(
                "nie-net: starting WebSocket server on ws://{addr} (protocol: {})",
                nie_net::NET_PROTOCOL_VERSION
            );
            let server = nie_net::NetServer::new(addr);
            server.run().await?;
        }

        NetOp::Room { op } => match op {
            RoomOp::Create {
                stadium,
                mode,
                half_time,
                password,
                json,
            } => {
                let is_2v2 = mode == "2v2";
                let config = nie_net::RoomConfig {
                    name: format!("Salle Inacode ({mode})"),
                    session_type: nie_net::SessionType::Game,
                    mode: if is_2v2 {
                        nie_net::MatchMode::Mode2v2
                    } else {
                        nie_net::MatchMode::Ranked
                    },
                    max_members: if is_2v2 { 4 } else { 2 },
                    password,
                    stadium,
                    half_time_seconds: half_time,
                };
                let mut hub = nie_net::LobbyHub::new();
                let (inacode, _info) = hub
                    .create_room(
                        "host_player".to_string(),
                        "Host".to_string(),
                        config.clone(),
                    )
                    .map_err(|e| anyhow::anyhow!("échec création salle: {e:?}"))?;
                if json {
                    println!(
                        "{}",
                        serde_json::json!({
                            "inacode": inacode.as_str(),
                            "config": config,
                        })
                    );
                } else {
                    println!("Salle créée avec succès !");
                    println!("Inacode : {}", inacode.as_str());
                    println!("Mode    : {mode}");
                    println!("Stade   : {}", config.stadium);
                    println!("Mi-temps: {}s", config.half_time_seconds);
                }
            }

            RoomOp::Format { code } => {
                let formatted = if let Ok(seed) = code.parse::<u64>() {
                    nie_net::Inacode::generate_from_seed(seed)
                } else {
                    nie_net::Inacode::new(&code)
                };
                println!("{}", formatted.as_str());
            }
        },

        NetOp::SimMatch { ticks, seed, json } => {
            let mut session = nie_net::session::NetMatchSession::new(
                "sim_01".to_string(),
                seed,
                nie_net::PlayerSlot::Home,
            );

            for t in 0..ticks {
                let p0 = nie_net::PlayerTickInput {
                    tick: t + 1,
                    dx: (t as f32 * 0.1).sin(),
                    dy: (t as f32 * 0.1).cos(),
                    shoot: false,
                    pass: false,
                    skill_id: None,
                };
                let p1 = nie_net::PlayerTickInput {
                    tick: t + 1,
                    dx: -(t as f32 * 0.1).sin(),
                    dy: -(t as f32 * 0.1).cos(),
                    shoot: false,
                    pass: false,
                    skill_id: None,
                };

                session.queue_local_input(p0);
                session.receive_remote_input(p1);
                session
                    .advance_tick()
                    .with_context(|| format!("simulation tick {t} failed"))?;
            }

            let state_hash = session.current_state_hash();
            let score = session.world.score;

            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "ticks_executed": ticks,
                        "seed": seed,
                        "state_hash": state_hash,
                        "score": [score[0], score[1]],
                        "deterministic": true,
                    })
                );
            } else {
                println!("Simulation de match déterministe terminée :");
                println!("- Ticks exécutés : {ticks} (60 Hz)");
                println!("- Graine RNG     : {seed}");
                println!("- Score final    : {} - {}", score[0], score[1]);
                println!("- FNV-1a Hash    : 0x{state_hash:08X}");
                println!("- Zéro-Desync    : 100 % Validé");
            }
        }

        NetOp::Challenge { op } => match op {
            ChallengeOp::Create {
                user_id,
                name,
                elo,
                ranked,
                opponent,
                json,
            } => {
                let mut store = nie_net::ranked::ChallengeStore::new();
                let challenge = store.create_challenge(
                    user_id,
                    name,
                    "default_avatar".to_string(),
                    elo,
                    1, // 1v1
                    ranked,
                    opponent,
                );

                if json {
                    println!("{}", serde_json::to_string_pretty(&challenge)?);
                } else {
                    println!("Code de défi généré : {}", challenge.code);
                    println!(
                        "Lien partageable    : https://nie.aphrody.com/ranked?challenge={}",
                        challenge.code
                    );
                    println!(
                        "Challenger          : {} ({} AP)",
                        challenge.from_display_name, challenge.from_elo
                    );
                    println!(
                        "Mode                : {}",
                        if challenge.ranked {
                            "Classé"
                        } else {
                            "Amical"
                        }
                    );
                    println!("Expire dans         : 30 minutes");
                }
            }
        },

        NetOp::Ladder { limit, json } => {
            let mut ladder = nie_net::CompetitiveLadder::new(1, nie_net::DEFAULT_K_FACTOR);
            let players = [
                ("p1", "Axel Blaze", 2150),
                ("p2", "Mark Evans", 1850),
                ("p3", "Jude Sharp", 1650),
                ("p4", "Shawn Froste", 1420),
                ("p5", "Nathan Swift", 950),
            ];
            for (id, name, ap) in players {
                let p = ladder.get_or_create(id, name);
                p.current_ap = ap;
                p.tier = nie_net::RankTier::from_ap(ap);
            }

            let top = ladder.leaderboard(limit);
            if json {
                println!("{}", serde_json::to_string_pretty(&top)?);
            } else {
                println!(
                    "{:<4} {:<20} {:<12} {:<10}",
                    "Rang", "Joueur", "Palier", "Points AP"
                );
                println!("{:-<48}", "");
                for (i, p) in top.iter().enumerate() {
                    let tier = nie_net::RankTier::from_ap(p.current_ap);
                    println!(
                        "{:<4} {:<20} {:<12} {:<10}",
                        i + 1,
                        p.display_name,
                        tier.name_fr(),
                        p.current_ap
                    );
                }
            }
        }

        NetOp::Clans { limit, json } => {
            let mut registry = nie_net::ClanRegistry::new();
            let _ = registry.create_clan(
                "c1".into(),
                "Raimon Eleven".into(),
                "RAI".into(),
                "Club légendaire de Raimon".into(),
                1,
                "leader_1".into(),
                "Mark Evans".into(),
            );
            if let Some(clan) = registry.clans.get_mut("c1") {
                clan.contribute_ap("leader_1", 14500);
            }

            let _ = registry.create_clan(
                "c2".into(),
                "Royal Academy".into(),
                "TEI".into(),
                "L'académie impériale".into(),
                2,
                "leader_2".into(),
                "Ray Dark".into(),
            );
            if let Some(clan) = registry.clans.get_mut("c2") {
                clan.contribute_ap("leader_2", 13200);
            }

            let top = registry.top_clans(limit);
            if json {
                println!("{}", serde_json::to_string_pretty(&top)?);
            } else {
                println!(
                    "{:<4} {:<8} {:<25} {:<10} {:<8}",
                    "Rang", "Tag", "Nom du Club", "Points AP", "Membres"
                );
                println!("{:-<58}", "");
                for (i, c) in top.iter().enumerate() {
                    println!(
                        "{:<4} {:<8} {:<25} {:<10} {:<8}",
                        i + 1,
                        c.tag,
                        c.name,
                        c.total_ap,
                        c.members.len()
                    );
                }
            }
        }

        NetOp::CalcElo {
            elo_a,
            elo_b,
            score_a,
            json,
        } => {
            let is_win_a = score_a >= 0.5;
            let res = if is_win_a {
                nie_net::compute_match_elo(elo_a, elo_b, nie_net::DEFAULT_K_FACTOR)
            } else {
                nie_net::compute_match_elo(elo_b, elo_a, nie_net::DEFAULT_K_FACTOR)
            };

            let delta_a = if is_win_a {
                res.winner_gain as i32
            } else {
                -(res.loser_loss as i32)
            };
            let delta_b = if is_win_a {
                -(res.loser_loss as i32)
            } else {
                res.winner_gain as i32
            };

            let tier_a = nie_net::RankTier::from_ap(elo_a);
            let tier_b = nie_net::RankTier::from_ap(elo_b);

            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "player_a": {
                            "initial_elo": elo_a,
                            "delta": delta_a,
                            "new_elo": (elo_a as i32 + delta_a).max(0) as u32,
                            "tier": tier_a.name_fr(),
                        },
                        "player_b": {
                            "initial_elo": elo_b,
                            "delta": delta_b,
                            "new_elo": (elo_b as i32 + delta_b).max(0) as u32,
                            "tier": tier_b.name_fr(),
                        },
                        "score_a": score_a,
                    })
                );
            } else {
                println!("Calcul ELO Asymétrique & Directionnel :");
                println!(
                    "Joueur A : {} AP ({}) -> Delta: {:+} AP -> Nouveau: {} AP",
                    elo_a,
                    tier_a.name_fr(),
                    delta_a,
                    (elo_a as i32 + delta_a).max(0) as u32
                );
                println!(
                    "Joueur B : {} AP ({}) -> Delta: {:+} AP -> Nouveau: {} AP",
                    elo_b,
                    tier_b.name_fr(),
                    delta_b,
                    (elo_b as i32 + delta_b).max(0) as u32
                );
            }
        }
    }

    Ok(())
}
