//! Pure article reaction rules.

use std::collections::BTreeMap;

/// Maximum article identifier size in bytes.
pub const MAX_ARTICLE_ID_LENGTH: usize = 512;

/// Reactions currently published by Azalee.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReactionType {
    /// Like.
    Like,
    /// Fire.
    Fire,
    /// Clap.
    Clap,
    /// Mind blown.
    MindBlown,
    /// Sad.
    Sad,
}

impl ReactionType {
    /// All reactions in stable public order.
    pub const ALL: [Self; 5] = [
        Self::Like,
        Self::Fire,
        Self::Clap,
        Self::MindBlown,
        Self::Sad,
    ];

    /// Returns the historical transport code.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Like => "like",
            Self::Fire => "fire",
            Self::Clap => "clap",
            Self::MindBlown => "mind_blown",
            Self::Sad => "sad",
        }
    }

    /// Returns the associated emoji.
    #[must_use]
    pub const fn emoji(self) -> &'static str {
        match self {
            Self::Like => "❤️",
            Self::Fire => "🔥",
            Self::Clap => "👏",
            Self::MindBlown => "🤯",
            Self::Sad => "😢",
        }
    }

    /// Parses a reaction code without depending on a JSON format.
    pub fn parse(value: &str) -> Result<Self, ReactionError> {
        match value {
            "like" => Ok(Self::Like),
            "fire" => Ok(Self::Fire),
            "clap" => Ok(Self::Clap),
            "mind_blown" => Ok(Self::MindBlown),
            "sad" => Ok(Self::Sad),
            _ => Err(ReactionError::UnsupportedType(value.to_owned())),
        }
    }
}

/// Aggregated state for one reaction.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReactionState {
    /// Total reaction count.
    pub count: u32,
    /// Whether the current user reacted.
    pub user_reacted: bool,
}

/// Deterministic collection of reaction states.
pub type ReactionStates = BTreeMap<ReactionType, ReactionState>;

/// Validated request before it reaches a storage adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionRequest {
    /// Article identifier.
    pub article_id: String,
    /// Reaction type.
    pub reaction_type: ReactionType,
}

/// Minimal row that an adapter can convert into an aggregate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReactionRow<'a> {
    /// Reaction code from storage.
    pub reaction_type: &'a str,
    /// Reaction author's identifier.
    pub user_id: &'a str,
}

/// Reaction validation errors.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ReactionError {
    /// The identifier violates the storage contract.
    #[error("invalid reaction article identifier")]
    InvalidArticleId,
    /// The code is not a known reaction.
    #[error("unsupported reaction type: {0}")]
    UnsupportedType(String),
}

/// Creates an initial state containing every reaction at zero.
#[must_use]
pub fn create_reaction_states() -> ReactionStates {
    ReactionType::ALL
        .into_iter()
        .map(|reaction| (reaction, ReactionState::default()))
        .collect()
}

/// Validates and normalizes an article identifier.
pub fn normalize_article_id(value: &str) -> Result<String, ReactionError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_ARTICLE_ID_LENGTH || value.contains('\0') {
        return Err(ReactionError::InvalidArticleId);
    }
    Ok(value.to_owned())
}

/// Parses a reaction request with `like` as the default.
pub fn parse_reaction_request(
    article_id: &str,
    reaction_type: Option<&str>,
) -> Result<ReactionRequest, ReactionError> {
    Ok(ReactionRequest {
        article_id: normalize_article_id(article_id)?,
        reaction_type: ReactionType::parse(reaction_type.unwrap_or("like"))?,
    })
}

/// Aggregates valid rows and marks reactions from the current user.
#[must_use]
pub fn accumulate_reaction_states<'a>(
    rows: impl IntoIterator<Item = ReactionRow<'a>>,
    current_user_id: Option<&str>,
) -> ReactionStates {
    let mut states = create_reaction_states();
    for row in rows {
        let Ok(reaction) = ReactionType::parse(row.reaction_type) else {
            continue;
        };
        let state = states.entry(reaction).or_default();
        state.count = state.count.saturating_add(1);
        if current_user_id.is_some_and(|user_id| user_id == row.user_id) {
            state.user_reacted = true;
        }
    }
    states
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_validates_requests() {
        let request = parse_reaction_request(" article-42 ", None).unwrap();
        assert_eq!(request.article_id, "article-42");
        assert_eq!(request.reaction_type, ReactionType::Like);
        assert_eq!(ReactionType::MindBlown.as_str(), "mind_blown");
        assert_eq!(ReactionType::Fire.emoji(), "🔥");
        assert_eq!(
            parse_reaction_request("\0", Some("like")),
            Err(ReactionError::InvalidArticleId)
        );
        assert!(matches!(
            parse_reaction_request("article", Some("wow")),
            Err(ReactionError::UnsupportedType(_))
        ));
    }

    #[test]
    fn creates_all_states_and_aggregates_unknown_rows_safely() {
        let rows = [
            ReactionRow {
                reaction_type: "like",
                user_id: "u1",
            },
            ReactionRow {
                reaction_type: "like",
                user_id: "u2",
            },
            ReactionRow {
                reaction_type: "fire",
                user_id: "u1",
            },
            ReactionRow {
                reaction_type: "unknown",
                user_id: "u1",
            },
        ];
        let states = accumulate_reaction_states(rows, Some("u1"));
        assert_eq!(states.len(), 5);
        assert_eq!(
            states[&ReactionType::Like],
            ReactionState {
                count: 2,
                user_reacted: true
            }
        );
        assert_eq!(
            states[&ReactionType::Fire],
            ReactionState {
                count: 1,
                user_reacted: true
            }
        );
        assert_eq!(states[&ReactionType::Sad], ReactionState::default());
    }
}
