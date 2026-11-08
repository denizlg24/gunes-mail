use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0} sign-in isn't configured in this build")]
    NotConfigured(&'static str),
    #[error("Not signed in")]
    SignedOut,
    #[error("Authorization was cancelled or timed out")]
    AuthCancelled,
    #[error("Authorization failed: {0}")]
    Auth(String),
    #[error("{message}")]
    Api { status: u16, message: String },
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
