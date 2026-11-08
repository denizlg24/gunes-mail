use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// Gmail tokens stored by earlier versions, before the server held credentials.
#[derive(Clone, Serialize, Deserialize)]
pub struct LegacyAccount {
    pub email: String,
    pub refresh_token: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Store {
    #[serde(default)]
    pub session_token: Option<String>,
    #[serde(default)]
    pub accounts: Vec<LegacyAccount>,
}

pub struct StoreFile {
    path: PathBuf,
}

impl StoreFile {
    pub fn new(dir: &Path) -> AppResult<Self> {
        std::fs::create_dir_all(dir)?;
        Ok(Self {
            path: dir.join("accounts.json"),
        })
    }

    pub fn load(&self) -> Store {
        std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, store: &Store) -> AppResult<()> {
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(store)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}
