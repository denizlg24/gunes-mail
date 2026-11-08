use std::time::Duration;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};

const LOGIN_TIMEOUT: Duration = Duration::from_secs(180);

/// An OAuth provider the desktop signs in with. The server receives only the
/// refresh token and re-validates it against the same client.
pub struct OAuthProvider {
    auth_url: &'static str,
    token_url: &'static str,
    redirect_host: &'static str,
    scopes: &'static str,
    client_id: String,
    client_secret: Option<String>,
    extra: &'static [(&'static str, &'static str)],
}

fn configured(runtime: &str, compiled: Option<&'static str>) -> Option<String> {
    std::env::var(runtime)
        .ok()
        .or_else(|| compiled.map(str::to_string))
        .filter(|v| !v.is_empty())
}

pub fn google() -> Option<OAuthProvider> {
    Some(OAuthProvider {
        auth_url: "https://accounts.google.com/o/oauth2/v2/auth",
        token_url: "https://oauth2.googleapis.com/token",
        redirect_host: "127.0.0.1",
        scopes: "openid email profile https://mail.google.com/ https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly",
        client_id: configured("GOOGLE_CLIENT_ID", option_env!("GOOGLE_CLIENT_ID"))?,
        client_secret: configured("GOOGLE_CLIENT_SECRET", option_env!("GOOGLE_CLIENT_SECRET")),
        extra: &[
            ("access_type", "offline"),
            ("prompt", "consent select_account"),
        ],
    })
}

pub fn microsoft() -> Option<OAuthProvider> {
    Some(OAuthProvider {
        auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        redirect_host: "localhost",
        scopes: "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read https://graph.microsoft.com/Contacts.Read https://graph.microsoft.com/People.Read",
        client_id: configured("MICROSOFT_CLIENT_ID", option_env!("MICROSOFT_CLIENT_ID"))?,
        client_secret: None,
        extra: &[("prompt", "select_account")],
    })
}

#[derive(Deserialize)]
struct TokenResponse {
    refresh_token: Option<String>,
}

fn random_token(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Runs the installed-app flow (loopback redirect + PKCE) and returns the
/// refresh token, which is handed to the server and never stored locally.
pub async fn authorize(
    http: &reqwest::Client,
    provider: &OAuthProvider,
    cancel: tokio::sync::oneshot::Receiver<()>,
    open_browser: impl FnOnce(String) -> AppResult<()>,
) -> AppResult<String> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let redirect_uri = format!(
        "http://{}:{}",
        provider.redirect_host,
        listener.local_addr()?.port()
    );

    let verifier = random_token(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_token(16);

    let mut url = url::Url::parse(provider.auth_url).map_err(|e| AppError::Other(e.to_string()))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("client_id", &provider.client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", provider.scopes)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        for (k, v) in provider.extra {
            query.append_pair(k, v);
        }
    }
    open_browser(url.to_string())?;

    let code = tokio::select! {
        result = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(&listener, &state)) => {
            result.map_err(|_| AppError::AuthCancelled)??
        }
        _ = cancel => return Err(AppError::AuthCancelled),
    };

    let mut form = vec![
        ("code", code.as_str()),
        ("client_id", provider.client_id.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ];
    if let Some(secret) = provider.client_secret.as_deref() {
        form.push(("client_secret", secret));
    }
    let res = http.post(provider.token_url).form(&form).send().await?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        if body.contains("invalid_client") {
            return Err(AppError::Auth(
                "The OAuth client was rejected. Check the client ID and secret in .env.local."
                    .into(),
            ));
        }
        return Err(AppError::Auth(format!(
            "token endpoint returned {status}: {body}"
        )));
    }
    let token: TokenResponse = res.json().await?;
    token
        .refresh_token
        .ok_or_else(|| AppError::Auth("The provider did not return a refresh token".into()))
}

async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> AppResult<String> {
    loop {
        let (mut stream, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let Some(target) = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
        else {
            continue;
        };
        let Ok(parsed) = url::Url::parse(&format!("http://localhost{target}")) else {
            continue;
        };
        let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        if params.is_empty() {
            respond(&mut stream, 404, "Not found").await;
            continue;
        }

        if let Some(err) = params.get("error") {
            respond(
                &mut stream,
                400,
                "Sign-in was cancelled. You can close this tab.",
            )
            .await;
            return Err(AppError::Auth(err.clone()));
        }
        if params.get("state").map(String::as_str) != Some(expected_state) {
            respond(&mut stream, 400, "Invalid sign-in state.").await;
            return Err(AppError::Auth("state mismatch".into()));
        }
        let Some(code) = params.get("code") else {
            respond(&mut stream, 400, "Missing authorization code.").await;
            return Err(AppError::Auth("missing code".into()));
        };
        respond(
            &mut stream,
            200,
            "You're signed in. You can close this tab and return to Güneş Mail.",
        )
        .await;
        return Ok(code.clone());
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, status: u16, message: &str) {
    let body = format!(
        "<!doctype html><html><head><meta charset=utf-8><title>Güneş Mail</title></head>\
         <body style=\"font-family:-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f5f5f5;color:#242424\">\
         <div style=\"text-align:center\"><div style=\"font-size:20px;font-weight:600;margin-bottom:8px\">Güneş Mail</div><div>{message}</div></div></body></html>"
    );
    let reason = if status == 200 { "OK" } else { "Bad Request" };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn browser_hit(port: u16, target: &str) -> String {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        stream
            .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn captures_code_after_ignoring_stray_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = tokio::spawn(async move {
            let favicon = browser_hit(port, "/favicon.ico").await;
            let callback = browser_hit(port, "/?state=s1&code=4%2F0Abc&scope=email").await;
            (favicon, callback)
        });
        let code = wait_for_code(&listener, "s1").await.unwrap();
        let (favicon, callback) = client.await.unwrap();
        assert_eq!(code, "4/0Abc");
        assert!(favicon.starts_with("HTTP/1.1 404"));
        assert!(callback.starts_with("HTTP/1.1 200") && callback.contains("You're signed in"));
    }

    #[tokio::test]
    async fn rejects_state_mismatch() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = tokio::spawn(async move { browser_hit(port, "/?state=evil&code=x").await });
        let err = wait_for_code(&listener, "s1").await.unwrap_err();
        assert!(matches!(err, AppError::Auth(ref m) if m == "state mismatch"));
        assert!(client.await.unwrap().starts_with("HTTP/1.1 400"));
    }

    #[tokio::test]
    async fn surfaces_user_cancellation() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let client =
            tokio::spawn(async move { browser_hit(port, "/?error=access_denied&state=s1").await });
        let err = wait_for_code(&listener, "s1").await.unwrap_err();
        assert!(matches!(err, AppError::Auth(ref m) if m == "access_denied"));
        client.await.unwrap();
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }
}
