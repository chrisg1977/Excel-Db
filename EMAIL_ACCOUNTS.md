# Email Account Management (Phase 1: Foundation)

Generic mailbox-connection layer so Excel-Db can read email content and
attachments for automated workflows. Invoice/paid-bill import is the first
consumer; this layer itself is not invoice-specific — any future
email-parsing feature reads from the same `email_accounts` /
`email_messages` / `email_attachments` tables.

This phase stops at: an admin can connect, monitor, and disconnect a
mailbox, and the system knows when a connection is broken. It does **not**
parse invoices, match suppliers, or do anything import-specific — that's a
separate follow-up spec.

## What was built

- **Schema**: `sql/email_accounts_schema.sql` — `email_accounts`,
  `email_oauth_states` (CSRF state for the OAuth redirect), `email_messages`,
  `email_attachments`, plus `vw_email_accounts_admin` (a list view that never
  selects the encrypted token column).
- **Admin panel**: "Email Accounts" panel (`src/panels/email-accounts.*`) —
  list, connect via Google OAuth, reconnect, per-account feature-flag
  toggles, deactivate/activate, on-demand health check.
- **Endpoint**: `src/endpoints/email-accounts.ts`, mounted at
  `/email-accounts/*`. Every route except the OAuth redirect target
  (`GET /oauth/callback`, which Google calls directly with no Directus
  session) requires Directus admin access
  (`req.accountability.admin`) — see `src/lib/require-admin.ts`.
- **Provider abstraction**: `src/lib/email-providers/` — `EmailProviderAdapter`
  interface with a single `gmail` implementation today. A second provider is
  a new file implementing the interface plus one registry line; no schema or
  endpoint change needed.
- **Encryption at rest**: `src/lib/crypto.ts` — AES-256-GCM, keyed by the
  `EMAIL_ACCOUNTS_ENCRYPTION_KEY` env var. **This is a new secrets pattern**:
  nothing in this repo previously encrypted an application-level field
  (Directus's own `KEY`/`SECRET` only sign its cookies/JWTs). Reuse this
  helper for the next feature that needs to store a credential at rest
  rather than introducing another scheme.
- **Health check**: `POST /email-accounts/health-check` (bulk, for the
  scheduled job) and `POST /email-accounts/accounts/:id/health-check`
  (single, "Check now" in the UI). Classification logic lives in
  `src/lib/email-health.ts` and is unit-testable without a running database.
- **Scheduled job + alerting**: `scripts/check-email-accounts.ps1`, which
  reuses the exact pattern already established by
  `scripts/check-rate-sources.ps1` (log in to Directus, call an endpoint,
  send an SMTP alert on failure via `SMTP_*` env vars) rather than
  introducing a new scheduler or notification mechanism.

## Data model

```
email_accounts        -- one row per connected mailbox
  id, email_address, provider, status, needs_reauth, consecutive_failures,
  oauth_refresh_token_encrypted, oauth_token_scope, feature_flags[],
  connected_by, connected_at, last_checked_at, last_success_at,
  last_error, last_error_at

email_messages         -- generic message index, any feature can read it
  id, email_account_id (FK), provider_message_id, received_at, sender,
  subject, processed_by_features[], raw_status

email_attachments       -- generic attachment index
  id, email_message_id (FK), filename, mime_type, storage_path,
  extracted_text_status
```

`feature_flags` on `email_accounts` and `processed_by_features` on
`email_messages` are plain `TEXT[]` columns, not enums — the only value in
use today is `invoice_import`, and adding a second feature is "add a
string", not a migration.

## Status values and what they mean

- `pending` — connected, no successful health check yet (or just
  reconnected/reactivated).
- `active` — last health check succeeded.
- `error` — either `needs_reauth = true` (the grant was revoked/expired —
  **only a human reconnecting fixes this**, so the scheduled job alerts
  immediately and stays actionable rather than retrying forever), or 3+
  consecutive transient failures (network blips, provider 5xx) — treated as
  "probably fine, but stop pretending it's healthy."
- `disabled` — admin deactivated it. Polling stops; `email_messages` and
  `email_attachments` rows tied to it are untouched.

A single bad poll never changes status — only `needs_reauth` errors and a
run of `TRANSIENT_FAILURE_THRESHOLD` (3) consecutive failures do.

## Required environment variables

None of these existed before this feature — set them wherever the rest of
Directus's env vars live (`docker-compose.prod.yml` / the deployment's env
file):

| Variable | Purpose |
|---|---|
| `EMAIL_ACCOUNTS_ENCRYPTION_KEY` | 32-byte key, base64-encoded (`openssl rand -base64 32`). Encrypts refresh tokens at rest. Losing/rotating this without a migration plan orphans every connected account (they'll show as `error` / undecryptable and need reconnecting). |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | From a Google Cloud OAuth 2.0 Client ID (type: Web application). |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must exactly match an authorized redirect URI on that OAuth client, e.g. `https://<directus-host>/email-accounts/oauth/callback`. |

The scheduled job additionally reuses the existing SMTP alert variables from
`SCHEDULED_SOURCE_CHECKS.md` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SSL`,
`SMTP_USER`, `SMTP_PASS`), plus two new ones scoped to this job:
`EMAIL_ACCOUNTS_ALERT_FROM`, `EMAIL_ACCOUNTS_ALERT_TO`.

## Connecting an account (one-time Google Cloud setup)

1. In Google Cloud Console, create (or reuse) a project, enable the Gmail
   API, and configure the OAuth consent screen.
2. Create an OAuth 2.0 Client ID (Web application) with an authorized
   redirect URI matching `GOOGLE_OAUTH_REDIRECT_URI` above.
3. Set the three `GOOGLE_OAUTH_*` env vars and `EMAIL_ACCOUNTS_ENCRYPTION_KEY`
   on the Directus deployment, and restart it.
4. In the Directus admin, open the **Email Accounts** panel → **Connect New
   Account** → sign in as `drchrisgauci@gmail.com` and grant read-only Gmail
   access. The panel polls back and shows the account once connected.

Reconnecting an existing account (expired token, revoked grant, changed
password) uses the same flow via each row's **Reconnect** button — it
updates the same `email_accounts.id` in place, so nothing tied to that
account (import history, feature flags) is lost.

## Scheduled health check

Mirrors `SCHEDULED_SOURCE_CHECKS.md`'s existing pattern exactly — same
script shape, same SMTP alerting, just a different endpoint:

```powershell
$env:DIRECTUS_BASE_URL = "http://localhost:8055"
$env:DIRECTUS_EMAIL = "admin@example.com"
$env:DIRECTUS_PASSWORD = "your-admin-password"
.\scripts\check-email-accounts.ps1
```

Schedule it the same way as the rate-source check (Windows Task Scheduler),
just more frequently — hourly or daily rather than monthly, since a revoked
grant should surface quickly rather than at next month's run.

## What this phase deliberately does not do

- No invoice/bill parsing, no supplier matching, no approval UI.
- No message/attachment fetching implementation yet — `email_messages` and
  `email_attachments` exist as the target schema for that, but populating
  them is the invoice-import feature's job, not this layer's.
- No support for a non-Gmail provider yet, though the interface is designed
  so adding one doesn't touch this endpoint or the schema.

## Open questions for the invoice-import phase

- Where should fetched attachment blobs actually live —
  `directus-uploads` (reusing Directus's existing file storage) or a
  separate path? `email_attachments.storage_path` is a plain TEXT column
  so either works; picking one is out of scope here.
- Should `processed_by_features` be written by each feature directly, or
  should there be a shared "claim this message" helper to avoid two
  features racing on the same row? Worth deciding before a second consumer
  exists.
- The Gmail scope requested is `gmail.readonly`. Confirm that's sufficient
  for invoice import (it is, for reading messages/attachments) before any
  future feature needs to modify labels or mark messages read/processed,
  which would need a broader scope and a re-consent from every connected
  account.
