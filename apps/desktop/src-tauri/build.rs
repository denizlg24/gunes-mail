use std::path::Path;

const ENV_KEYS: [&str; 4] = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "MICROSOFT_CLIENT_ID",
    "GUNES_MAIL_API_URL",
];

/// Bakes the Google OAuth client from `../.env.local` into the binary so end
/// users never see the client-setup screen. Real environment variables win.
fn embed_oauth_client() {
    let path = Path::new("../.env.local");
    println!("cargo:rerun-if-changed={}", path.display());
    for key in ENV_KEYS {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };
    for line in contents.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if ENV_KEYS.contains(&key) && !value.is_empty() && std::env::var(key).is_err() {
            println!("cargo:rustc-env={key}={value}");
        }
    }
}

fn main() {
    embed_oauth_client();
    tauri_build::build()
}
