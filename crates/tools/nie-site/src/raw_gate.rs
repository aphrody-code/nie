//! Access gate for the raw game spaces `/f` (file bytes) and `/b` (VFS browsing).
//!
//! Those routes hand out the commercial game's own bytes, so they are never public: they are
//! closed (`404`) unless a token is configured (`NIE_RAW_VFS_TOKEN`), and then answer only to
//! `Authorization: Bearer <token>`. Decoded data (`/api/*`) is not affected.

use crate::state::EtatSite;
use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Shortest accepted token; anything shorter leaves the spaces closed.
pub const MIN_TOKEN_LEN: usize = 32;

/// Bearer token for the raw spaces. `Debug` never prints the value.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    /// Accepts a token of at least [`MIN_TOKEN_LEN`] characters, surrounding spaces trimmed.
    #[must_use]
    pub fn new(value: &str) -> Option<Self> {
        let value = value.trim();
        (value.len() >= MIN_TOKEN_LEN).then(|| Self(value.to_owned()))
    }
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

/// True for the paths this gate protects.
#[must_use]
pub fn is_raw_path(path: &str) -> bool {
    path == "/f" || path.starts_with("/f/") || path == "/b" || path.starts_with("/b/")
}

/// Constant-time comparison, so response timing does not leak the token prefix.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Decides access: `None` for a path outside the gate, `Some(allowed)` otherwise.
#[must_use]
pub fn allowed(path: &str, token: Option<&Token>, authorization: Option<&str>) -> Option<bool> {
    if !is_raw_path(path) {
        return None;
    }
    let (Some(token), Some(value)) = (token, authorization) else {
        return Some(false);
    };
    let presented = value.strip_prefix("Bearer ").unwrap_or_default();
    Some(same(presented.as_bytes(), token.0.as_bytes()))
}

/// Middleware: `404` on the raw spaces unless the bearer token matches.
pub async fn gate(State(etat): State<EtatSite>, request: Request, next: Next) -> Response {
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let decision = allowed(
        request.uri().path(),
        etat.config.raw_vfs_token.as_ref(),
        authorization,
    );
    match decision {
        None | Some(true) => next.run(request).await,
        // 404 rather than 401: the origin does not advertise that a private space exists.
        Some(false) => StatusCode::NOT_FOUND.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn token() -> Token {
        Token::new("0123456789abcdef0123456789abcdef").unwrap()
    }

    #[test]
    fn public_routes_are_untouched() {
        assert_eq!(allowed("/api/v1/health", None, None), None);
        assert_eq!(allowed("/feed.atom", Some(&token()), None), None);
        assert_eq!(allowed("/bundle.js", None, None), None);
        assert_eq!(allowed("/fonts/x.woff2", None, None), None);
    }

    #[test]
    fn raw_spaces_are_closed_without_a_configured_token() {
        assert_eq!(
            allowed("/f/data/common/x.g4tx", None, Some("Bearer anything")),
            Some(false)
        );
        assert_eq!(allowed("/b", None, None), Some(false));
    }

    #[test]
    fn raw_spaces_need_the_exact_bearer_token() {
        let bearer = "Bearer 0123456789abcdef0123456789abcdef";
        assert_eq!(allowed("/b/data", Some(&token()), Some(bearer)), Some(true));
        assert_eq!(
            allowed("/f/x", Some(&token()), Some("Bearer wrong")),
            Some(false)
        );
        assert_eq!(
            allowed("/f/x", Some(&token()), Some(&bearer[7..])),
            Some(false)
        );
        assert_eq!(allowed("/f/x", Some(&token()), None), Some(false));
    }

    #[test]
    fn short_tokens_are_refused_and_never_printed() {
        assert!(Token::new("short").is_none());
        assert_eq!(format!("{:?}", token()), "Token(<redacted>)");
    }
}
