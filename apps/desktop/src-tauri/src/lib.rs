mod error;
mod oauth;
mod store;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

use error::{AppError, AppResult};
use store::{Store, StoreFile};

const DEFAULT_API_URL: &str = "https://gunes-mail-api.denizlg24.com";

const DEVICE_NAME: &str = if cfg!(target_os = "macos") {
    "Gunes Mail on macOS"
} else if cfg!(target_os = "windows") {
    "Gunes Mail on Windows"
} else {
    "Gunes Mail on Linux"
};

struct AppState {
    http: reqwest::Client,
    api_url: String,
    file: StoreFile,
    store: Mutex<Store>,
    sign_in_cancel: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

impl AppState {
    fn with_store<T>(&self, f: impl FnOnce(&mut Store) -> AppResult<T>) -> AppResult<T> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| AppError::Other("store lock poisoned".into()))?;
        f(&mut store)
    }

    fn persist(&self, f: impl FnOnce(&mut Store)) -> AppResult<()> {
        self.with_store(|store| {
            f(store);
            self.file.save(store)
        })
    }

    fn token(&self) -> AppResult<Option<String>> {
        self.with_store(|s| Ok(s.session_token.clone()))
    }

    /// Hands a provider refresh token to the server, which validates it and
    /// signs this device in (or links the mailbox to the current session).
    async fn connect(&self, provider: &str, refresh_token: &str) -> AppResult<String> {
        let mut req = self
            .http
            .post(format!("{}/v1/connect/{provider}", self.api_url))
            .header("x-device-name", DEVICE_NAME)
            .json(&json!({ "refreshToken": refresh_token }));
        if let Some(token) = self.token()? {
            req = req.bearer_auth(token);
        }
        let res = req.send().await?;
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let message = body["error"]
                .as_str()
                .unwrap_or("The server rejected the sign-in")
                .to_string();
            return Err(AppError::Api {
                status: status.as_u16(),
                message,
            });
        }
        if let Some(session) = body["session"].as_str() {
            let session = session.to_string();
            self.persist(|s| s.session_token = Some(session))?;
        }
        Ok(body["accountId"].as_str().unwrap_or_default().to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    api_url: String,
    token: Option<String>,
    google: bool,
    microsoft: bool,
    legacy_accounts: usize,
}

#[tauri::command]
fn session(state: State<'_, AppState>) -> AppResult<SessionInfo> {
    state.with_store(|s| {
        Ok(SessionInfo {
            api_url: state.api_url.clone(),
            token: s.session_token.clone(),
            google: oauth::google().is_some(),
            microsoft: oauth::microsoft().is_some(),
            legacy_accounts: s.accounts.len(),
        })
    })
}

#[tauri::command]
fn cancel_sign_in(state: State<'_, AppState>) {
    if let Ok(mut pending) = state.sign_in_cancel.lock()
        && let Some(cancel) = pending.take()
    {
        let _ = cancel.send(());
    }
}

#[tauri::command]
async fn connect_oauth(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<String> {
    let config = match provider.as_str() {
        "google" => oauth::google().ok_or(AppError::NotConfigured("Google"))?,
        "microsoft" => oauth::microsoft().ok_or(AppError::NotConfigured("Microsoft"))?,
        other => return Err(AppError::Other(format!("unknown provider {other}"))),
    };
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    if let Ok(mut pending) = state.sign_in_cancel.lock()
        && let Some(previous) = pending.replace(cancel_tx)
    {
        let _ = previous.send(());
    }
    let result = oauth::authorize(&state.http, &config, cancel_rx, |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| AppError::Other(e.to_string()))
    })
    .await;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
    state.connect(&provider, &result?).await
}

/// Moves Gmail accounts signed in by earlier versions onto the server.
#[tauri::command]
async fn migrate_legacy_accounts(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let legacy = state.with_store(|s| Ok(s.accounts.clone()))?;
    let mut migrated = Vec::new();
    for account in legacy {
        state.connect("google", &account.refresh_token).await?;
        state.persist(|s| s.accounts.retain(|a| a.email != account.email))?;
        migrated.push(account.email);
    }
    Ok(migrated)
}

/// Stores a session issued by a server call made from the webview (IMAP sign-in).
#[tauri::command]
fn store_session(state: State<'_, AppState>, token: String) -> AppResult<()> {
    state.persist(|s| s.session_token = Some(token))
}

#[tauri::command]
async fn sign_out(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(token) = state.token()? {
        let _ = state
            .http
            .post(format!("{}/v1/connect/sign-out", state.api_url))
            .bearer_auth(token)
            .send()
            .await;
    }
    state.persist(|s| s.session_token = None)
}

fn unique_path(dir: PathBuf, filename: &str) -> PathBuf {
    let safe: String = filename
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '\0') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = if safe.trim().is_empty() {
        "attachment".to_string()
    } else {
        safe
    };
    let candidate = dir.join(&safe);
    if !candidate.exists() {
        return candidate;
    }
    let (stem, ext) = match safe.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (safe.clone(), String::new()),
    };
    (1..)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or(candidate)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRequest {
    path: String,
    filename: String,
    open: bool,
}

#[tauri::command]
async fn save_attachment(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: AttachmentRequest,
) -> AppResult<String> {
    let token = state.token()?.ok_or(AppError::SignedOut)?;
    let res = state
        .http
        .get(format!("{}{}", state.api_url, request.path))
        .bearer_auth(token)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(AppError::Api {
            status: res.status().as_u16(),
            message: format!("Download failed ({})", res.status()),
        });
    }
    let bytes = res.bytes().await?;
    let path = unique_path(app.path().download_dir()?, &request.filename);
    std::fs::write(&path, &bytes)?;
    let opener = app.opener();
    let result = if request.open {
        opener.open_path(path.to_string_lossy(), None::<&str>)
    } else {
        opener.reveal_item_in_dir(&path)
    };
    result.map_err(|e| AppError::Other(e.to_string()))?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let file = StoreFile::new(&app.path().app_data_dir()?)?;
            let store = file.load();
            let api_url = std::env::var("GUNES_MAIL_API_URL")
                .ok()
                .or_else(|| option_env!("GUNES_MAIL_API_URL").map(str::to_string))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| DEFAULT_API_URL.to_string())
                .trim_end_matches('/')
                .to_string();
            app.manage(AppState {
                http: reqwest::Client::builder()
                    .user_agent("GunesMail/0.2")
                    .build()?,
                api_url,
                file,
                store: Mutex::new(store),
                sign_in_cancel: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            session,
            cancel_sign_in,
            connect_oauth,
            migrate_legacy_accounts,
            sign_out,
            store_session,
            save_attachment,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
