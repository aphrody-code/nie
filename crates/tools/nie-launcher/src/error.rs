//! Error types for nie-launcher.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum LauncherError {
    #[error("cryptographic error: {0}")]
    Crypto(String),

    #[error("package error: {0}")]
    Package(String),

    #[error("save container error: {0}")]
    Save(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("EAC patch error: {0}")]
    Eac(String),

    #[error("general error: {0}")]
    General(String),

    #[error("base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
}

pub type Result<T> = std::result::Result<T, LauncherError>;
