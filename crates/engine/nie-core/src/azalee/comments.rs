//! Comment validation and tree composition.

use std::collections::HashMap;

/// Maximum comment length.
pub const COMMENT_MAX_LENGTH: usize = 2_000;
/// Maximum comment identifier length.
pub const COMMENT_IDENTIFIER_MAX_LENGTH: usize = 512;
/// Maximum product-level reply depth.
pub const COMMENT_MAX_REPLY_DEPTH: usize = 2;

/// Comment display order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommentSortOrder {
    /// Newest first.
    Newest,
    /// Oldest first.
    Oldest,
    /// Most liked first.
    Popular,
}

/// Public comment author.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentAuthor {
    /// Storage identity.
    pub id: String,
    /// Optional username.
    pub username: Option<String>,
    /// Optional full name.
    pub full_name: Option<String>,
    /// Optional avatar URL, without network validation.
    pub avatar_url: Option<String>,
}

/// Flat comment as supplied by an adapter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentRecord {
    /// Comment identity.
    pub id: String,
    /// Displayable body.
    pub content: String,
    /// Whether the comment was edited.
    pub is_edited: bool,
    /// Whether it is pinned.
    pub is_pinned: bool,
    /// Creation timestamp, kept as source-neutral text.
    pub created_at: String,
    /// Update timestamp.
    pub updated_at: String,
    /// Optional parent.
    pub parent_id: Option<String>,
    /// Author.
    pub author: CommentAuthor,
    /// Reply count supplied by the source.
    pub reply_count: u32,
    /// Like count supplied by the source.
    pub likes: u32,
    /// Whether the current user liked this comment.
    pub user_liked: bool,
}

/// Tree node produced from flat comments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentTreeNode {
    /// Comment data.
    pub comment: CommentRecord,
    /// Replies in source order.
    pub replies: Vec<Self>,
}

/// Comment validation errors.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CommentError {
    /// A value is not an acceptable identifier.
    #[error("invalid {kind} identifier")]
    InvalidIdentifier {
        /// Catégorie d’identifiant rejetée.
        kind: &'static str,
    },
    /// The body is empty or too long.
    #[error("comment must contain 1 to {COMMENT_MAX_LENGTH} characters")]
    InvalidContent,
}

impl CommentSortOrder {
    /// Parses a transport sort code.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "newest" => Some(Self::Newest),
            "oldest" => Some(Self::Oldest),
            "popular" => Some(Self::Popular),
            _ => None,
        }
    }
}

/// Validates and normalizes an identifier.
pub fn normalize_comment_identifier(
    value: &str,
    kind: &'static str,
) -> Result<String, CommentError> {
    let value = value.trim();
    if value.is_empty() || value.len() > COMMENT_IDENTIFIER_MAX_LENGTH || value.contains('\0') {
        return Err(CommentError::InvalidIdentifier { kind });
    }
    Ok(value.to_owned())
}

/// Validates and normalizes a comment body.
pub fn normalize_comment_content(value: &str) -> Result<String, CommentError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > COMMENT_MAX_LENGTH || value.contains('\0') {
        return Err(CommentError::InvalidContent);
    }
    Ok(value.to_owned())
}

/// Builds the article key used by comment reactions.
pub fn comment_reaction_article_id(comment_id: &str) -> Result<String, CommentError> {
    Ok(format!(
        "comment:{}",
        normalize_comment_identifier(comment_id, "comment")?
    ))
}

/// Counts direct replies for each known parent.
#[must_use]
pub fn count_replies_by_parent_id(comments: &[CommentRecord]) -> HashMap<String, u32> {
    let mut counts = HashMap::new();
    for comment in comments {
        if let Some(parent_id) = comment.parent_id.as_deref().filter(|id| !id.is_empty()) {
            *counts.entry(parent_id.to_owned()).or_default() += 1;
        }
    }
    counts
}

/// Sorts a copy without changing source order.
#[must_use]
pub fn sort_comments(
    comments: &[CommentRecord],
    sort_order: CommentSortOrder,
) -> Vec<CommentRecord> {
    let mut sorted = comments.to_vec();
    sorted.sort_by(|left, right| {
        right
            .is_pinned
            .cmp(&left.is_pinned)
            .then_with(|| match sort_order {
                CommentSortOrder::Popular => right.likes.cmp(&left.likes),
                CommentSortOrder::Oldest => left.created_at.cmp(&right.created_at),
                CommentSortOrder::Newest => right.created_at.cmp(&left.created_at),
            })
    });
    sorted
}

/// Builds a robust tree even when the source contains missing parents or
/// cycles. Ambiguous nodes become roots.
#[must_use]
pub fn build_comment_tree(comments: &[CommentRecord]) -> Vec<CommentTreeNode> {
    let mut nodes = Vec::with_capacity(comments.len());
    let mut indices = HashMap::with_capacity(comments.len());
    for comment in comments {
        let node = CommentTreeNode {
            comment: comment.clone(),
            replies: Vec::new(),
        };
        if let Some(index) = indices.get(&comment.id).copied() {
            nodes[index] = node;
        } else {
            indices.insert(comment.id.clone(), nodes.len());
            nodes.push(node);
        }
    }

    let mut children = vec![Vec::new(); nodes.len()];
    let mut roots = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        let Some(parent_id) = node.comment.parent_id.as_deref() else {
            roots.push(index);
            continue;
        };
        let Some(parent_index) = indices.get(parent_id).copied() else {
            roots.push(index);
            continue;
        };
        if parent_index == index || creates_cycle(index, parent_index, &nodes, &indices) {
            roots.push(index);
        } else {
            children[parent_index].push(index);
        }
    }

    roots
        .into_iter()
        .map(|index| materialize(index, &nodes, &children))
        .collect()
}

fn creates_cycle(
    node_index: usize,
    mut parent_index: usize,
    nodes: &[CommentTreeNode],
    indices: &HashMap<String, usize>,
) -> bool {
    let mut visited = Vec::new();
    loop {
        if parent_index == node_index || visited.contains(&parent_index) {
            return true;
        }
        visited.push(parent_index);
        let Some(parent_id) = nodes[parent_index].comment.parent_id.as_deref() else {
            return false;
        };
        let Some(next) = indices.get(parent_id).copied() else {
            return false;
        };
        parent_index = next;
    }
}

fn materialize(
    index: usize,
    nodes: &[CommentTreeNode],
    children: &[Vec<usize>],
) -> CommentTreeNode {
    CommentTreeNode {
        comment: nodes[index].comment.clone(),
        replies: children[index]
            .iter()
            .map(|child| materialize(*child, nodes, children))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comment(id: &str, parent_id: Option<&str>, created_at: &str) -> CommentRecord {
        CommentRecord {
            id: id.to_owned(),
            content: format!("content-{id}"),
            is_edited: false,
            is_pinned: false,
            created_at: created_at.to_owned(),
            updated_at: created_at.to_owned(),
            parent_id: parent_id.map(str::to_owned),
            author: CommentAuthor {
                id: "user".to_owned(),
                username: None,
                full_name: None,
                avatar_url: None,
            },
            reply_count: 0,
            likes: 0,
            user_liked: false,
        }
    }

    #[test]
    fn validates_content_and_reaction_identity() {
        assert_eq!(normalize_comment_content(" hello ").unwrap(), "hello");
        assert_eq!(comment_reaction_article_id(" c1 ").unwrap(), "comment:c1");
        assert_eq!(
            normalize_comment_content(" \0 "),
            Err(CommentError::InvalidContent)
        );
        assert!(matches!(
            normalize_comment_identifier("", "comment"),
            Err(CommentError::InvalidIdentifier { kind: "comment" })
        ));
    }

    #[test]
    fn sorts_pinned_then_by_requested_order_and_counts_replies() {
        let mut old = comment("old", None, "2026-01-01");
        old.likes = 1;
        let mut pinned = comment("pinned", None, "2026-01-03");
        pinned.is_pinned = true;
        let mut popular = comment("popular", None, "2026-01-02");
        popular.likes = 5;
        let reply = comment("reply", Some("old"), "2026-01-04");
        let comments = vec![old.clone(), pinned, popular, reply];

        assert_eq!(
            sort_comments(&comments, CommentSortOrder::Popular)[0].id,
            "pinned"
        );
        assert_eq!(
            sort_comments(&comments, CommentSortOrder::Popular)[1].id,
            "popular"
        );
        assert_eq!(count_replies_by_parent_id(&comments)["old"], 1);
    }

    #[test]
    fn builds_tree_and_breaks_cycles_into_roots() {
        let root = comment("root", None, "1");
        let child = comment("child", Some("root"), "2");
        let missing = comment("missing", Some("absent"), "3");
        let cycle_a = comment("a", Some("b"), "4");
        let cycle_b = comment("b", Some("a"), "5");
        let tree = build_comment_tree(&[root, child, missing, cycle_a, cycle_b]);

        assert_eq!(tree.len(), 4);
        assert_eq!(tree[0].comment.id, "root");
        assert_eq!(tree[0].replies[0].comment.id, "child");
        assert!(tree.iter().any(|node| node.comment.id == "a"));
        assert!(tree.iter().any(|node| node.comment.id == "b"));
    }
}
