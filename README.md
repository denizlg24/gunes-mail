# Güneş Mail

All your inboxes in one calm desktop app. Güneş Mail is an Outlook-style mail client for Gmail, Microsoft 365/Outlook.com and any IMAP account, with rules, scheduled send, undo send and sync across your devices.

[Website](https://gunes-mail.denizlg24.com) · [Download](https://github.com/denizlg24/gunes-mail/releases/latest) · [Privacy](https://gunes-mail.denizlg24.com/privacy/) · [Terms](https://gunes-mail.denizlg24.com/terms/)

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop` | Tauri 2 desktop app (Rust shell + Next.js 16 static UI, shadcn/ui) |
| `apps/server` | Sync service: Bun + Hono + Postgres (Drizzle). Gmail, Microsoft Graph and IMAP sync, rules, outbox, accounts |
| `apps/web` | Marketing site, privacy policy, terms, web account page (static Next.js served by Caddy) |
| `apps/admin` | Operations dashboard: health, traffic, errors by reference, mailbox sync status, logs (Bun + Hono) |
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

## AI features (optional)

Both are opt-in per user (Settings → AI features) and hide themselves when the server isn't configured.

- **Smart categories.** Set `EMAIL_CLASSIFIER_URL` (the full `/api/classify` endpoint of `apps/email-classifier` in the denizlg24.com repo) and `EMAIL_CLASSIFIER_API_TOKEN`. A background worker classifies Inbox mail from the last `CLASSIFY_DAYS` (30) days for users who turned the feature on, and backs off for five minutes when the service is unreachable.
- **Summaries and drafting.** Set `AI_GATEWAY_API_KEY` (Vercel AI Gateway). `AI_MODEL` defaults to `anthropic/claude-haiku-5.5`. Requests are limited to 20 per user per minute.

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

## Support references and the admin dashboard

Every failed request, sync run or scheduled send gets a reference such as `GM-7K3QX9P2`. The API returns it with the error, the desktop app shows it next to error messages (click to copy), and it is stored with the stack trace in `error_events`. The server also writes per-minute request metrics (`request_stats`) and its warnings and errors (`log_entries`); old rows are pruned automatically (30 days for errors, 14 for the rest).

`apps/admin` reads those tables, read-only, and serves a dashboard at `gunes-mail-admin.denizlg24.com`: service health, request volume and latency, errors by kind, top routes, a reference lookup with the full stack, per-mailbox sync progress and a live log tail. It is a separate Forge target (`apps/admin/Dockerfile`, health path `/health`) bound to the same Postgres resource, with:

- `ADMIN_PASSWORD_HASH`: an Argon2id hash of the password, from `bun -e 'console.log(await Bun.password.hash(process.argv[1]))' "<password>"`. Locally, a plain `ADMIN_PASSWORD` works instead. Sessions last 12 hours and logins are limited to 5 attempts per 15 minutes per address.
- `ADMIN_SESSION_SECRET` (optional): signs session cookies. Without it a random secret is generated at start, so a redeploy signs you out.

## Releases

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json` (and `apps/desktop/package.json`, `Cargo.toml`) and push to `main`. The `Release desktop app` workflow tags `vX.Y.Z`, builds macOS (Apple silicon and Intel), Windows and Linux bundles, signs and notarizes the macOS apps, and publishes the release with the `latest.json` the in-app updater reads. Installed copies pick the update up within a few hours, or immediately from Settings → About & updates. The website's download buttons read the latest published release from `GET /v1/releases/latest`, so they never point at a build that is still in progress.

Repository secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Secrets in the `desktop-release` environment, for Developer ID signing and notarization:

- `APPLE_DEVELOPER_ID_P12` (base64), `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_DEVELOPER_ID_IDENTITY`
- `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`, `APPLE_ASC_PRIVATE_KEY` (App Store Connect API key used by `notarytool`)

Without them the macOS build is signed ad hoc, which macOS reports as "damaged" after download.

## License

[MIT](LICENSE)
