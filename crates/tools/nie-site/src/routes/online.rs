//! `/api/v1/online` — Endpoints du mode en ligne, matchmaking et ladder compétitif (`nie-net`).

use axum::Json;
use axum::extract::Query;
use serde::Deserialize;

use nie_net::{
    Clan, ClanRegistry, CompetitiveLadder, DEFAULT_K_FACTOR, LEVEL5_NET_VER_2_3_0,
    NET_PROTOCOL_VERSION, PlayerCompetitiveProfile, RankTier, TICK_RATE_HZ, compute_match_elo,
    tier_elo_factors,
};

/// Query parameters for ELO calculation.
#[derive(Debug, Deserialize)]
pub struct CalcEloQuery {
    /// Rating AP of player A.
    pub elo_a: Option<u32>,
    /// Rating AP of player B.
    pub elo_b: Option<u32>,
    /// Match score for player A (1.0 = win, 0.5 = draw, 0.0 = loss).
    pub score_a: Option<f64>,
}

/// Query parameters for leaderboard pagination.
#[derive(Debug, Deserialize)]
pub struct LadderQuery {
    /// Maximum number of records to return.
    pub limit: Option<usize>,
}

/// `GET /api/v1/online/status` — Status and capabilities of the multiplayer hub.
pub async fn status() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "protocol": NET_PROTOCOL_VERSION,
        "level5_compat": LEVEL5_NET_VER_2_3_0,
        "tick_rate_hz": TICK_RATE_HZ,
        "rollback_frames": 64,
        "modes": ["Casual", "Ranked", "Mode2v2", "Tournament"],
        "tiers_count": RankTier::COUNT,
        "status": "operational",
    }))
}

/// `GET /api/v1/online/tiers` — Official 11 competitive rank tiers and directional factors.
pub async fn tiers() -> Json<serde_json::Value> {
    let mut list = Vec::with_capacity(RankTier::COUNT);
    for idx in 0..RankTier::COUNT {
        let tier = RankTier::from_index(idx);
        let (min_ap, max_ap) = match tier {
            RankTier::Fer => (0, 199),
            RankTier::Bronze => (200, 399),
            RankTier::Argent => (400, 599),
            RankTier::Or => (600, 799),
            RankTier::Platine => (800, 999),
            RankTier::Diamant => (1000, 1199),
            RankTier::Emeraude => (1200, 1399),
            RankTier::Rubis => (1400, 1599),
            RankTier::Divin => (1600, 1799),
            RankTier::Supernova => (1800, 1999),
            RankTier::Legendaire => (2000, 9999),
        };
        let factors = tier_elo_factors(tier);
        list.push(serde_json::json!({
            "tier_index": idx,
            "name_fr": tier.name_fr(),
            "name_en": tier.name_en(),
            "min_ap": min_ap,
            "max_ap": max_ap,
            "win_k": factors.win_k,
            "loss_k": factors.loss_k,
        }));
    }
    Json(serde_json::json!({ "tiers": list }))
}

/// `GET /api/v1/online/ladder` — Ranked competitive leaderboard.
pub async fn ladder(Query(query): Query<LadderQuery>) -> Json<serde_json::Value> {
    let limit = query.limit.unwrap_or(20).min(100);
    let mut comp_ladder = CompetitiveLadder::new(1, DEFAULT_K_FACTOR);

    let seed_players = [
        ("p1", "Axel Blaze", 2150, 120, 15),
        ("p2", "Mark Evans", 1850, 98, 22),
        ("p3", "Jude Sharp", 1650, 85, 25),
        ("p4", "Shawn Froste", 1420, 70, 30),
        ("p5", "Nathan Swift", 950, 45, 35),
    ];

    for (id, name, ap, wins, losses) in seed_players {
        let p: &mut PlayerCompetitiveProfile = comp_ladder.get_or_create(id, name);
        p.current_ap = ap;
        p.tier = RankTier::from_ap(ap);
        p.wins = wins;
        p.losses = losses;
        p.matches_played = wins + losses;
    }

    let top = comp_ladder.leaderboard(limit);
    let entries: Vec<_> = top
        .iter()
        .map(|p| {
            let tier = RankTier::from_ap(p.current_ap);
            serde_json::json!({
                "user_id": p.user_id,
                "display_name": p.display_name,
                "current_ap": p.current_ap,
                "tier": tier.name_fr(),
                "tier_en": tier.name_en(),
                "wins": p.wins,
                "losses": p.losses,
                "matches_played": p.matches_played,
                "win_rate": p.win_rate(),
            })
        })
        .collect();

    Json(serde_json::json!({
        "season": 1,
        "leaderboard": entries,
    }))
}

/// `GET /api/v1/online/clans` — Clans and clubs leaderboard.
pub async fn clans(Query(query): Query<LadderQuery>) -> Json<serde_json::Value> {
    let limit = query.limit.unwrap_or(20).min(100);
    let mut registry = ClanRegistry::new();

    let mut c1 = Clan::new(
        "clan_raimon".into(),
        "Raimon Eleven".into(),
        "RAI".into(),
        "Club légendaire de Raimon".into(),
        1,
        "leader_1".into(),
        "Mark Evans".into(),
    );
    c1.contribute_ap("leader_1", 14500);
    let _ = registry.clans.insert(c1.clan_id.clone(), c1);

    let mut c2 = Clan::new(
        "clan_royal".into(),
        "Royal Academy".into(),
        "TEI".into(),
        "L'académie impériale".into(),
        2,
        "leader_2".into(),
        "Ray Dark".into(),
    );
    c2.contribute_ap("leader_2", 13200);
    let _ = registry.clans.insert(c2.clan_id.clone(), c2);

    let top = registry.top_clans(limit);
    let entries: Vec<_> = top
        .iter()
        .map(|c| {
            serde_json::json!({
                "clan_id": c.clan_id,
                "name": c.name,
                "tag": c.tag,
                "description": c.description,
                "level": c.level,
                "total_ap": c.total_ap,
                "members_count": c.members.len(),
            })
        })
        .collect();

    Json(serde_json::json!({ "clans": entries }))
}

/// `GET /api/v1/online/challenge` — Challenge contract documentation & generator.
pub async fn challenge() -> Json<serde_json::Value> {
    let mut store = nie_net::ranked::ChallengeStore::new();
    let sample = store.create_challenge(
        "sample_user".into(),
        "Exemple".into(),
        "avatar".into(),
        1000,
        1,
        true,
        None,
    );

    Json(serde_json::json!({
        "description": "Système de défis instantanés base-32 (8 caractères, TTL 30 minutes)",
        "alphabet": "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
        "sample_code": sample.code,
        "sample_url": format!("https://nie.aphrody.com/ranked?challenge={}", sample.code),
        "ttl_seconds": 1800,
    }))
}

/// `GET /api/v1/online/calc-elo` — Calculate progressive directional ELO changes.
pub async fn calc_elo(Query(query): Query<CalcEloQuery>) -> Json<serde_json::Value> {
    let elo_a = query.elo_a.unwrap_or(1000);
    let elo_b = query.elo_b.unwrap_or(1000);
    let score_a = query.score_a.unwrap_or(1.0);

    let is_win_a = score_a >= 0.5;
    let res = if is_win_a {
        compute_match_elo(elo_a, elo_b, DEFAULT_K_FACTOR)
    } else {
        compute_match_elo(elo_b, elo_a, DEFAULT_K_FACTOR)
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

    let tier_a = RankTier::from_ap(elo_a);
    let tier_b = RankTier::from_ap(elo_b);

    Json(serde_json::json!({
        "player_a": {
            "initial_ap": elo_a,
            "delta": delta_a,
            "new_ap": (elo_a as i32 + delta_a).max(0) as u32,
            "tier": tier_a.name_fr(),
        },
        "player_b": {
            "initial_ap": elo_b,
            "delta": delta_b,
            "new_ap": (elo_b as i32 + delta_b).max(0) as u32,
            "tier": tier_b.name_fr(),
        },
        "score_a": score_a,
    }))
}
