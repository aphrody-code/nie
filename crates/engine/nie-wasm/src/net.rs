//! WebAssembly bindings for `nie-net` online multiplayer and Achillea competitive suite.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

/// Formats a raw string into canonical Inacode format (`INA-XXXX`).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_format_inacode(raw: &str) -> String {
    nie_net::Inacode::new(raw).as_str().to_string()
}

/// Generates a deterministic Inacode from a numeric seed.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_generate_inacode(seed: f64) -> String {
    nie_net::Inacode::generate_from_seed(seed as u64).as_str().to_string()
}

/// Returns rank tier details (index, name_fr, name_en, min_ap, win_k, loss_k) as JSON.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_rank_tier_info(ap: u32) -> String {
    let tier = nie_net::RankTier::from_ap(ap);
    let min_ap = tier.min_ap();
    let factors = nie_net::tier_elo_factors(tier);

    serde_json::json!({
        "tier_index": tier as usize,
        "name_fr": tier.name_fr(),
        "name_en": tier.name_en(),
        "current_ap": ap,
        "min_ap": min_ap,
        "win_k": factors.win_k,
        "loss_k": factors.loss_k,
    })
    .to_string()
}

/// Calculates progressive directional ELO rating changes for two players.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_compute_elo(rating_a: u32, rating_b: u32, score_a: f64) -> String {
    let is_win_a = score_a >= 0.5;
    let res = if is_win_a {
        nie_net::compute_match_elo(rating_a, rating_b, nie_net::DEFAULT_K_FACTOR)
    } else {
        nie_net::compute_match_elo(rating_b, rating_a, nie_net::DEFAULT_K_FACTOR)
    };

    let delta_a = if is_win_a { res.winner_gain as i32 } else { -(res.loser_loss as i32) };
    let delta_b = if is_win_a { -(res.loser_loss as i32) } else { res.winner_gain as i32 };

    let tier_a = nie_net::RankTier::from_ap(rating_a);
    let tier_b = nie_net::RankTier::from_ap(rating_b);

    serde_json::json!({
        "player_a": {
            "initial_ap": rating_a,
            "delta": delta_a,
            "new_ap": (rating_a as i32 + delta_a).max(0) as u32,
            "tier": tier_a.name_fr(),
        },
        "player_b": {
            "initial_ap": rating_b,
            "delta": delta_b,
            "new_ap": (rating_b as i32 + delta_b).max(0) as u32,
            "tier": tier_b.name_fr(),
        },
        "score_a": score_a,
    })
    .to_string()
}

/// Generates a pseudo-random 8-character base-32 challenge invitation code.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_generate_challenge_code(seed: f64) -> String {
    let mut store = nie_net::ranked::ChallengeStore::new();
    let c = store.create_challenge(
        "web_user".into(),
        "Web Player".into(),
        "avatar".into(),
        1000,
        1,
        true,
        None,
    );
    if seed > 0.0 {
        let alphabet = nie_net::ranked::CHALLENGE_CODE_ALPHABET;
        let mut s = seed as u64;
        let mut chars = [0u8; 8];
        for b in &mut chars {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            *b = alphabet[(s as usize) % alphabet.len()];
        }
        std::str::from_utf8(&chars).unwrap_or(&c.code).to_string()
    } else {
        c.code
    }
}

/// Verifies mutual score agreement between two players.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_verify_scores(home_a: u32, away_a: u32, home_b: u32, away_b: u32) -> String {
    let a = nie_net::ranked::ScoreInput {
        user_id: "player_home".into(),
        my_score: home_a as u8,
        opp_score: away_a as u8,
        submitted: true,
    };
    let b = nie_net::ranked::ScoreInput {
        user_id: "player_away".into(),
        my_score: away_b as u8,
        opp_score: home_b as u8,
        submitted: true,
    };

    let agrees = nie_net::ranked::scores_agree(&a, &b);
    let outcome = nie_net::ranked::resolve_scores(&a, &b, false);

    let (is_disputed, home_score, away_score) = match outcome {
        nie_net::ranked::ScoreOutcome::Agree { s1, s2 } => (false, s1 as u32, s2 as u32),
        nie_net::ranked::ScoreOutcome::Forfeit { s1, s2, .. } => (false, s1 as u32, s2 as u32),
        nie_net::ranked::ScoreOutcome::Dispute => (true, home_a, away_a),
        nie_net::ranked::ScoreOutcome::Wait => (false, 0, 0),
    };

    serde_json::json!({
        "agrees": agrees,
        "is_disputed": is_disputed,
        "home_score": home_score,
        "away_score": away_score,
    })
    .to_string()
}

/// Calculates official circuit points for a dense tournament rank given bracket size.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_tournament_circuit_points(dense_rank: usize, participants: usize) -> u32 {
    nie_net::tournament::circuit_points_for_rank(participants, dense_rank)
}

/// Validates whether a clan tag matches standard format `[TAG]` (2 to 5 alphanumeric chars).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_validate_clan_tag(tag: &str) -> bool {
    let clean = tag.trim();
    let inner = if clean.starts_with('[') && clean.ends_with(']') && clean.len() >= 4 {
        &clean[1..clean.len() - 1]
    } else {
        clean
    };
    (2..=5).contains(&inner.len()) && inner.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Computes FNV-1a 32-bit state hash for zero-desync verification.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn net_state_hash(ball_x: f32, ball_y: f32, ball_z: f32, score_home: u32, score_away: u32) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    let bytes = [
        ball_x.to_bits().to_le_bytes(),
        ball_y.to_bits().to_le_bytes(),
        ball_z.to_bits().to_le_bytes(),
        score_home.to_le_bytes(),
        score_away.to_le_bytes(),
    ];
    for b in bytes.iter().flatten() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wasm_net_bindings() {
        let code = net_format_inacode("7x29");
        assert_eq!(code, "INA-7X29");

        let tier_json = net_rank_tier_info(1650);
        assert!(tier_json.contains("Divin"));

        let elo_json = net_compute_elo(1000, 1000, 1.0);
        assert!(elo_json.contains("player_a"));

        let points = net_tournament_circuit_points(1, 32);
        assert_eq!(points, 100);
        let points_64 = net_tournament_circuit_points(1, 64);
        assert_eq!(points_64, 130);

        assert!(net_validate_clan_tag("[RAI]"));
        assert!(net_validate_clan_tag("RAI"));
        assert!(!net_validate_clan_tag("A"));
    }
}
