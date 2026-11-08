# Güneş Mail

All your inboxes in one calm desktop app. Güneş Mail is an Outlook-style mail client for Gmail, Microsoft 365/Outlook.com and any IMAP account, with rules, scheduled send, undo send and sync across your devices.

[Website](https://gunes-mail.denizlg24.com) · [Download](https://github.com/denizlg24/gunes-mail/releases/latest) · [Privacy](https://gunes-mail.denizlg24.com/privacy/) · [Terms](https://gunes-mail.denizlg24.com/terms/)

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | Tauri 2 desktop app (Rust shell + Next.js 16 static UI, shadcn/ui) |
| `apps/server` | Sync service: Bun + Hono + Postgres (Drizzle). Gmail, Microsoft Graph and IMAP sync, rules, outbox, accounts |
| `apps/web` | Marketing site, privacy policy, terms, web account page (static Next.js served by Caddy) |
| `packages/shared` | API contract types shared by all three |

```
Desktop (Tauri) ──HTTPS + SSE──▶ Server (Hono) ──▶ Postgres
   │ OAuth (PKCE, loopback)          │
   └─ hands refresh token to ───────▶├─ Gmail history sync / Graph delta / IMAP UIDs
                                     ├─ Rules engine, outbox (undo / scheduled / delayed send)
Website ──────HTTPS────────────────▶ └─ Accounts, devices, synced settings
```

The desktop only signs in. Mailbox credentials are encrypted at rest on the server, which does all syncing, so mail keeps flowing and scheduled messages still go out while your computer is off.

**Accounts and devices.** Connecting a mailbox creates a Güneş account automatically. Add a sign-in email and password under Settings → Güneş account to open the same mailboxes on another computer, where your rules, signature and appearance settings follow you. Signing in again with any connected Google or Microsoft mailbox also restores everything.

## Development

Requirements: [Bun](https://bun.sh) 1.3+, Rust (stable), Docker (for Postgres).

```sh
bun install

docker run -d --name gunes-mail-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=gunes_mail -p 55432:5432 postgres:17-alpine
cp apps/server/.env.example apps/server/.env      # DATABASE_URL, ENCRYPTION_KEY, OAuth clients
cp apps/desktop/.env.example apps/desktop/.env.local

bun run dev            # server :3100, desktop UI :3000 (demo data in a browser), website :3001
bun run dev:desktop    # Tauri window against your local server

bun run typecheck && bun run lint && bun run test
```

`apps/desktop/.env.local` is compiled into the desktop binary by `src-tauri/build.rs` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `GUNES_MAIL_API_URL`).

## OAuth clients

**Google.** In Google Cloud Console, enable the Gmail API and the People API, then create a **Desktop app** OAuth client. Configure the consent screen:

- App name *Güneş Mail*
- Home page `https://gunes-mail.denizlg24.com`
- Privacy policy `/privacy/` and terms `/terms/`
- Authorized domain `denizlg24.com`
- Scopes `https://mail.google.com/`, `contacts.readonly`, `contacts.other.readonly`, `openid`, `email`, `profile`

The desktop app and the server use the same client.

**Microsoft (optional).** Create an Entra ID app registration:

- Supported account types: any organization plus personal accounts
- A **Mobile and desktop** redirect `http://localhost`, with public client flows enabled
- Delegated permissions `Mail.ReadWrite Mail.Send User.Read Contacts.Read People.Read offline_access`

## Deployment (Forge)

Both services build from this repository on push to `main`. Create two deploy targets in the Forge dashboard:

| | `gunes-mail-api` | `gunes-mail` |
| --- | --- | --- |
| Builder | `dockerfile` | `dockerfile` |
| Root directory | `.` | `.` |
| Dockerfile | `apps/server/Dockerfile` | `apps/web/Dockerfile` |
| Health path | `/health` | `/` |
| Domain | `gunes-mail-api.denizlg24.com` | `gunes-mail.denizlg24.com` |
| Resources | Postgres → `DATABASE_URL` | — |

Clear any build or start command overrides on both targets. Migrations run automatically when the server boots.

**Server env:**

- `ENCRYPTION_KEY`: `openssl rand -base64 32`. Never rotate it without re-encrypting.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and optionally `MICROSOFT_CLIENT_ID`.
- `CORS_ORIGINS=tauri://localhost,http://tauri.localhost,https://gunes-mail.denizlg24.com`

**Website build args:**

- `NEXT_PUBLIC_CONTACT_EMAIL`: required for Google verification.
- `NEXT_PUBLIC_OPERATOR_NAME`: the name shown on your consent screen.

## Releases

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and `apps/desktop/package.json`, `Cargo.toml`) and push to `main`. The `Release desktop app` workflow tags `vX.Y.Z`, builds macOS (Apple silicon and Intel), Windows and Linux bundles, signs and notarizes the macOS apps, and publishes the release with the `latest.json` the in-app updater reads. Installed copies pick the update up within a few hours, or immediately from Settings → About & updates. The website's download buttons read the latest published release from `GET /v1/releases/latest`, so they never point at a build that is still in progress.

Repository secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Secrets in the `desktop-release` environment, for Developer ID signing and notarization:

- `APPLE_DEVELOPER_ID_P12` (base64), `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_DEVELOPER_ID_IDENTITY`
- `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY` (App Store Connect API key used by `notarytool`)

Without them the macOS build is signed ad hoc, which macOS reports as "damaged" after download.

## License

[MIT](LICENSE)
