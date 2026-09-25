//! Bearer-token access to the game's own bytes and to the live VFS listing.
//!
//! The raw bytes of a CPK entry, the folder view of the mounted VFS and the untouched `raw`
//! export are the commercial game itself, not data decoded from it. Every HTTP surface that can
//! hand them out (`nie-site` `/f`, `/b` and `/api/v1/export/file?format=raw`; `nie-model-serve`
//! `/raw/`, `/depot/` and `/export/?format=raw`) closes them unless a token is configured
//! through [`TOKEN_ENV`], and then opens them only to `Authorization: Bearer <token>`.
//! (`nie-model-serve`'s `/vfs/` listing is restricted by nginx instead; see its
//! `private_route`.)
//!
//! This module is transport-neutral: it knows the token, how to compare it and which export
//! formats are raw. Each binary keeps its own wiring (an axum middleware, a hand-routed TCP
//! handler) and answers `404` on refusal, so the origin never advertises that a private space
//! exists.

/// Environment variable carrying the token, read by every binary that serves raw game bytes.
pub const TOKEN_ENV: &str = "NIE_RAW_VFS_TOKEN";

/// Shortest accepted token; anything shorter leaves the raw spaces closed.
pub const MIN_TOKEN_LEN: usize = 32;

/// Bearer token opening the raw spaces.
///
/// `Debug` never prints the value, and there is deliberately no `PartialEq`: the only
/// comparison offered is [`Token::accepts`], which runs in constant time.
#[derive(Clone)]
pub struct Token(String);

/// A configured token was refused because it is shorter than [`MIN_TOKEN_LEN`].
///
/// The value itself is never kept, so neither `Debug` nor `Display` can leak it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenTooShort {
    /// Length of the refused value, in bytes, after trimming.
    pub len: usize,
}

impl std::fmt::Display for TokenTooShort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{TOKEN_ENV} is {} bytes long, at least {MIN_TOKEN_LEN} are required; raw spaces stay closed",
            self.len
        )
    }
}

impl std::error::Error for TokenTooShort {}

impl Token {
    /// Accepts a token of at least [`MIN_TOKEN_LEN`] bytes, surrounding whitespace trimmed.
    #[must_use]
    pub fn new(value: &str) -> Option<Self> {
        let value = value.trim();
        (value.len() >= MIN_TOKEN_LEN).then(|| Self(value.to_string()))
    }

    /// Reads [`TOKEN_ENV`] from the process environment.
    ///
    /// `Ok(None)` when the variable is unset or blank: the raw spaces stay closed, which is
    /// the default. `Err` when it is set but too short, so the caller can say why the spaces
    /// it expected to open are still closed — without ever printing the value.
    ///
    /// # Errors
    ///
    /// [`TokenTooShort`] when the variable holds fewer than [`MIN_TOKEN_LEN`] bytes.
    pub fn from_env() -> Result<Option<Self>, TokenTooShort> {
        let Ok(value) = std::env::var(TOKEN_ENV) else {
            return Ok(None);
        };
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        Self::new(trimmed)
            .map(Some)
            .ok_or(TokenTooShort { len: trimmed.len() })
    }

    /// True when `authorization` (the raw `Authorization` header value) carries this token
    /// under the `Bearer` scheme. The scheme name is case-insensitive (RFC 9110 §11.1); the
    /// credential is compared in constant time.
    #[must_use]
    pub fn accepts(&self, authorization: Option<&str>) -> bool {
        authorization
            .and_then(bearer_credential)
            .is_some_and(|presented| same(presented.as_bytes(), self.0.as_bytes()))
    }
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Token(<redacted>)")
    }
}

/// True when a request presenting `authorization` may read the raw spaces: a token must be
/// configured AND presented. No token configured means closed for everyone.
#[must_use]
pub fn allows(token: Option<&Token>, authorization: Option<&str>) -> bool {
    token.is_some_and(|token| token.accepts(authorization))
}

/// The credential of a `Bearer` authorization value, `None` for any other scheme.
fn bearer_credential(value: &str) -> Option<&str> {
    let value = value.trim();
    let (scheme, credential) = value.split_once(' ')?;
    scheme
        .eq_ignore_ascii_case("bearer")
        .then(|| credential.trim())
        .filter(|credential| !credential.is_empty())
}

/// Constant-time comparison, so response timing does not leak the token prefix. Only the
/// length is observable, and the length of a token is not a secret.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// True when exporting `path` as `format` hands back the game's bytes unchanged.
///
/// Read from the shared export table ([`crate::export::formats_pour`]) rather than from a
/// literal `"raw"`: a second untouched format added there is gated here without a second edit.
/// A format unknown for `path` is not raw — the export route refuses it on its own.
#[must_use]
pub fn is_raw_export(path: &str, format: &str) -> bool {
    crate::export::formats_pour(path)
        .iter()
        .any(|candidate| candidate.brut && candidate.id == format)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALUE: &str = "0123456789abcdef0123456789abcdef";

    fn token() -> Token {
        Token::new(VALUE).expect("32-byte token")
    }

    #[test]
    fn nothing_is_open_without_a_configured_token() {
        assert!(!allows(None, None));
        assert!(!allows(None, Some(&format!("Bearer {VALUE}"))));
    }

    #[test]
    fn only_the_exact_bearer_token_opens() {
        let t = token();
        assert!(allows(Some(&t), Some(&format!("Bearer {VALUE}"))));
        assert!(allows(Some(&t), Some(&format!("bearer {VALUE}"))));
        assert!(allows(Some(&t), Some(&format!("  BEARER   {VALUE}  "))));
        assert!(!allows(Some(&t), None));
        assert!(!allows(Some(&t), Some("Bearer wrong")));
        assert!(!allows(Some(&t), Some(VALUE)), "no scheme");
        assert!(!allows(Some(&t), Some(&format!("Basic {VALUE}"))));
        assert!(!allows(Some(&t), Some("Bearer ")));
        assert!(!allows(Some(&t), Some(&format!("Bearer {VALUE}x"))));
        assert!(!allows(Some(&t), Some(&format!("Bearer {}", &VALUE[1..]))));
    }

    #[test]
    fn short_tokens_are_refused_and_never_printed() {
        assert!(Token::new("short").is_none());
        assert!(Token::new(&VALUE[1..]).is_none(), "31 bytes");
        assert_eq!(format!("{:?}", token()), "Token(<redacted>)");
        let err = TokenTooShort { len: 5 };
        assert!(!format!("{err} {err:?}").contains("short"));
    }

    #[test]
    fn raw_export_follows_the_shared_table() {
        assert!(is_raw_export("data/dx11/a.g4tx", "raw"));
        assert!(is_raw_export("data/x/y.zzz", "raw"));
        assert!(!is_raw_export("data/dx11/a.g4tx", "png"));
        assert!(!is_raw_export("data/common/a.cfg.bin", "json"));
        assert!(!is_raw_export("data/common/movie/a.usm", "mp4"));
        assert!(!is_raw_export("data/dx11/a.g4tx", "nope"));
    }
}
