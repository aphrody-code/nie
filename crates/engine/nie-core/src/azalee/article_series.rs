//! Portable article-series identity and ordering rules.
//!
//! Storage queries and mutations remain in adapters. This layer only validates
//! keys and applies the shared editorial ordering rule.

/// Maximum series and article identifier length.
pub const SERIES_IDENTIFIER_MAX_LENGTH: usize = 512;
/// First valid series order value.
pub const SERIES_ORDER_MIN: i64 = 0;
/// Last valid series order value (historical storage `INT4`).
pub const SERIES_ORDER_MAX: i64 = i32::MAX as i64;

/// Minimal article used by the series navigator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeriesArticle {
    /// Article identity.
    pub id: String,
    /// Public title.
    pub title: String,
    /// Public slug.
    pub slug: String,
    /// Optional position in the series.
    pub series_order: Option<i32>,
}

/// Series and articles in editorial order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SeriesWithArticles {
    /// Public series identity.
    pub series_id: String,
    /// Ordered articles.
    pub articles: Vec<SeriesArticle>,
}

/// Series validation errors.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SeriesError {
    /// A key is empty, too long, or contains a NUL.
    #[error("invalid article series {field}")]
    InvalidIdentifier {
        /// Rejected key category.
        field: &'static str,
    },
    /// A position is outside the historical range.
    #[error("invalid article series order")]
    InvalidOrder,
}

fn normalize_identifier(value: &str, field: &'static str) -> Result<String, SeriesError> {
    let value = value.trim();
    if value.is_empty() || value.len() > SERIES_IDENTIFIER_MAX_LENGTH || value.contains('\0') {
        return Err(SeriesError::InvalidIdentifier { field });
    }
    Ok(value.to_owned())
}

/// Validates a series identity.
pub fn normalize_series_id(value: &str) -> Result<String, SeriesError> {
    normalize_identifier(value, "identifier")
}

/// Validates a public series slug without rewriting it.
pub fn normalize_series_slug(value: &str) -> Result<String, SeriesError> {
    normalize_identifier(value, "slug")
}

/// Validates an article identity belonging to a series.
pub fn normalize_series_article_id(value: &str) -> Result<String, SeriesError> {
    normalize_identifier(value, "article identifier")
}

/// Validates a position compatible with the historical SQL schema.
pub fn normalize_series_order(value: i64) -> Result<i32, SeriesError> {
    if !(SERIES_ORDER_MIN..=SERIES_ORDER_MAX).contains(&value) {
        return Err(SeriesError::InvalidOrder);
    }
    Ok(value as i32)
}

/// Returns a copy sorted by ascending position.
///
/// Missing positions are zero and ties preserve source order.
#[must_use]
pub fn order_series_articles(articles: &[SeriesArticle]) -> Vec<SeriesArticle> {
    let mut ordered = articles.to_vec();
    ordered.sort_by_key(|article| article.series_order.unwrap_or_default());
    ordered
}

/// Builds the public series view using the single ordering rule.
pub fn to_series_with_articles(
    series_id: &str,
    articles: &[SeriesArticle],
) -> Result<SeriesWithArticles, SeriesError> {
    Ok(SeriesWithArticles {
        series_id: normalize_series_id(series_id)?,
        articles: order_series_articles(articles),
    })
}

/// Returns an article position, or zero when the article is absent.
pub fn series_article_index(
    articles: &[SeriesArticle],
    article_id: &str,
) -> Result<usize, SeriesError> {
    let article_id = normalize_series_article_id(article_id)?;
    Ok(order_series_articles(articles)
        .iter()
        .position(|article| article.id == article_id)
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn article(id: &str, order: Option<i32>) -> SeriesArticle {
        SeriesArticle {
            id: id.to_owned(),
            title: id.to_owned(),
            slug: id.to_owned(),
            series_order: order,
        }
    }

    #[test]
    fn validates_series_keys_and_int32_order() {
        assert_eq!(normalize_series_id(" s1 ").unwrap(), "s1");
        assert_eq!(
            normalize_series_order(i64::from(i32::MAX)).unwrap(),
            i32::MAX
        );
        assert_eq!(normalize_series_order(-1), Err(SeriesError::InvalidOrder));
        assert_eq!(
            normalize_series_order(i64::from(i32::MAX) + 1),
            Err(SeriesError::InvalidOrder)
        );
        assert!(matches!(
            normalize_series_slug(""),
            Err(SeriesError::InvalidIdentifier { field: "slug" })
        ));
    }

    #[test]
    fn orders_missing_values_first_and_preserves_equal_order() {
        let articles = vec![
            article("third", Some(2)),
            article("missing", None),
            article("first", Some(1)),
            article("zero", Some(0)),
        ];
        let ordered = order_series_articles(&articles);
        assert_eq!(
            ordered
                .iter()
                .map(|article| article.id.as_str())
                .collect::<Vec<_>>(),
            ["missing", "zero", "first", "third"]
        );
        assert_eq!(series_article_index(&articles, "first").unwrap(), 2);
        assert_eq!(series_article_index(&articles, "unknown").unwrap(), 0);
    }

    #[test]
    fn builds_a_validated_series_view() {
        let view = to_series_with_articles("series-1", &[article("a", Some(1))]).unwrap();
        assert_eq!(view.series_id, "series-1");
        assert_eq!(view.articles[0].id, "a");
    }
}
