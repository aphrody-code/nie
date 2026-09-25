//! Access gate for the raw game spaces `/f` (file bytes) and `/b` (VFS browsing).
//!
//! Those routes hand out the commercial game's own bytes, so they are never public: they are
//! closed (`404`) unless a token is configured (`NIE_RAW_VFS_TOKEN`), and then answer only to
//! `Authorization: Bearer <token>`. Decoded data (`/api/*`) is not affected, except the one
//! export that is not decoded at all — `format=raw`, gated in `routes::native_export`.
//!
//! The token, its minimum length and the constant-time comparison live in
//! [`nie_explore::raw_access`], shared with `nie-model-serve`, which closes its own `/raw/`,
//! `/depot/` and raw `/export/` routes with the same rule (its `/vfs/` listing is restricted by
//! nginx instead, and `routes::assets` refuses `vfs/` on its allowlist). This module is only
//! the axum binding.

use crate::state::EtatSite;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

pub use nie_explore::raw_access::{MIN_TOKEN_LEN, Token};

/// `Cache-Control` of an authorised raw response: the requester may keep it and revalidate
/// through its ETag, a shared cache (nginx, a CDN) must not store it and replay it to anyone.
pub const PRIVATE_CACHE: &str = "private, no-cache";

/// True for the paths this gate protects.
#[must_use]
pub fn is_raw_path(path: &str) -> bool {
    path == "/f" || path.starts_with("/f/") || path == "/b" || path.starts_with("/b/")
}

/// Decides access: `None` for a path outside the gate, `Some(allowed)` otherwise.
#[must_use]
pub fn allowed(path: &str, token: Option<&Token>, authorization: Option<&str>) -> Option<bool> {
    is_raw_path(path).then(|| nie_explore::raw_access::allows(token, authorization))
}

/// True when the request's `Authorization` header carries the configured bearer token.
#[must_use]
pub fn authorised(etat: &EtatSite, headers: &HeaderMap) -> bool {
    let authorization = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    nie_explore::raw_access::allows(etat.config.raw_vfs_token.as_ref(), authorization)
}

/// Middleware: `404` on the raw spaces unless the bearer token matches.
pub async fn gate(State(etat): State<EtatSite>, request: Request, next: Next) -> Response {
    let decision = is_raw_path(request.uri().path()).then(|| authorised(&etat, request.headers()));
    match decision {
        None => next.run(request).await,
        Some(true) => {
            let mut response = next.run(request).await;
            response.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static(PRIVATE_CACHE),
            );
            response
        }
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
        assert_eq!(MIN_TOKEN_LEN, 32);
        assert_eq!(format!("{:?}", token()), "Token(<redacted>)");
    }
}
