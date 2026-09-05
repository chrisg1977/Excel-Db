# Master Project TODO / Decision Log

Running log of cross-phase spec decisions and what's left, for tracks that
span more than one session. Append new entries below rather than editing
history away.

---

## Email Account Management — Foundation (Phase 1)

**Status**: Code merged in PR #3 on 2026-09-03. Phase 1 is not ready to feed
invoice import until the live deployment verification gate below is completed
once against the real Directus deployment and Gmail account.

**Branch**: `claude/email-account-management-byhart`  
**Merge commit**: `9ab54b547127ab6ae2805915472eec19353b21f3`

### Conventions reused (not duplicated)

- Directus extension bundle layout (`src/endpoints`, `src/panels`,
  `src/index.ts`, `package.json`'s `directus:extension.entries` — per
  `README.md`'s "Extension Source of Truth").
- `req.accountability?.user` for "must be logged in", matching every other
  endpoint in this repo.
- SQL migration style from `sql/payroll_subscriptions_schema.sql`
  (`BIGSERIAL` ids, `updated_at` trigger function, `vw_*` admin views).
- Scheduled-check + SMTP-alert pattern from
  `scripts/check-rate-sources.ps1` / `SCHEDULED_SOURCE_CHECKS.md` — reused
  verbatim in `scripts/check-email-accounts.ps1`, no new scheduler or
  notification mechanism introduced.

### Conventions newly introduced (flagged, since none existed)

- **Admin-only route gate** (`src/lib/require-admin.ts`,
  `req.accountability.admin`). No endpoint in this repo previously
  distinguished "logged in" from "admin" — email credentials warranted the
  stricter tier the spec asked for. Worth reusing for other sensitive config
  screens rather than each inventing its own check.
- **App-level field encryption** (`src/lib/crypto.ts`, AES-256-GCM, keyed by
  `EMAIL_ACCOUNTS_ENCRYPTION_KEY`). Directus's own `KEY`/`SECRET` only sign
  cookies/JWTs — there was no existing way to encrypt an arbitrary DB column
  at rest. Reuse this helper for the next credential a feature needs to
  store, rather than adding a second scheme.

### Deployment safety gate before invoice import

The production compose file must contain environment references only. Do not
commit concrete values for database passwords, Directus admin credentials,
Directus `KEY`/`SECRET`, OAuth client credentials, or email-account encryption
keys.

Before invoice import starts, complete these checks in LIVE and record the
result here or in the deployment log:

1. Confirm the `email_accounts_schema.sql` migration has been applied in LIVE
   and the `vw_email_accounts_admin` view exists.
2. Confirm LIVE has all required secret-bearing environment variables set:
   `POSTGRES_PASSWORD`, `DIRECTUS_DB_PASSWORD`, `DIRECTUS_ADMIN_EMAIL`,
   `DIRECTUS_ADMIN_PASSWORD`, `DIRECTUS_KEY`, `DIRECTUS_SECRET`,
   `EMAIL_ACCOUNTS_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI`.
3. Confirm `GOOGLE_OAUTH_REDIRECT_URI` exactly matches the authorized redirect
   URI in the Google Cloud OAuth client and uses the real Directus host:
   `/email-accounts/oauth/callback`.
4. Restart Directus from the sanitized deployment config and confirm it starts
   cleanly with the email-account extension loaded.
5. In the Directus admin panel, start **Email Accounts → Connect New Account**,
   sign in to `drchrisgauci@gmail.com`, grant the read-only Gmail consent, and
   confirm the callback page reports success.
6. Confirm the admin list shows the connected mailbox with
   `has_credentials = true`, no encrypted token value exposed, and the
   `invoice_import` feature flag still controlled from the UI.
7. Run **Check now** for the mailbox and confirm the row becomes or remains
   healthy (`active`, `needs_reauth = false`, zero transient failures after a
   successful check).
8. Run `scripts/check-email-accounts.ps1` against LIVE with an admin Directus
   login and confirm the scheduled health-check endpoint succeeds. If SMTP
   variables are configured, confirm an alert can be sent on a forced failure
   or at least that missing SMTP settings are reported clearly.
9. Confirm reconnect behavior on the same mailbox if the account already
   exists: it must update the existing `email_accounts.id` rather than create
   a duplicate row.

Only after those checks pass should the invoice-import phase start reading
from this mailbox foundation.

### Open questions before the invoice-import phase starts

1. Attachment blob storage location — Directus's existing
   `directus-uploads` volume, or a separate path? `email_attachments.storage_path`
   is schema-agnostic either way.
2. Whether `processed_by_features` needs a shared "claim this message"
   helper once a second feature reads the same mailbox, to avoid two
   features racing on the same `email_messages` row.
3. Gmail scope is `gmail.readonly`. Fine for reading messages/attachments;
   revisit (and re-consent every connected account) if a future feature
   needs to mutate mailbox state (labels, read/unread).

---

## Repository Safety Gate — Main Branch

**Status**: GitHub `main` was observed unprotected on 2026-09-05, with no
required status checks or workflow runs on current head
`727244572d2cb3fc5adfc9402f8bd0ed5fbf3114`.

Main must not accept direct commits for runtime, payroll, invoice-import, or
deployment changes. Keep the rule lightweight so normal Codex/Copilot/Claude
branch work can continue, but require one pull request and basic validation
before anything lands.

### GitHub enforcement to enable

Create a branch protection rule or ruleset targeting `main`:

1. Require a pull request before merging.
2. Require status checks to pass before merging.
3. Require the branch to be up to date before merging.
4. Require conversation resolution before merging.
5. Block force pushes.
6. Block branch deletion.
7. Do not allow bypasses for routine work; include administrators if GitHub
   exposes that option for this repository.

### Required check

After `.github/workflows/basic-ci.yml` has run once, select this required
status check:

- `Build and Guard`

### Basic CI scope

The required workflow should stay small and fast:

- Install and build the active Directus extension from the root package.
- Install and build `od-importer`.
- Install `dashboard` dependencies so broken package locks are caught.
- Verify `docker-compose.prod.yml` keeps secret-bearing production settings as
  environment references.
- Run a secret scan before merge.

### Runtime-sensitive paths

Changes under these paths should always go through the protected pull-request
path:

- `src/**`
- `od-importer/**`
- `dashboard/**`
- `sql/**`
- `scripts/**`
- `docker-compose*.yml`
- `docker/**`
- `package*.json`
- `.github/workflows/**`

Documentation-only changes can use the same rule; no extra workflow is needed
unless this becomes too slow or noisy in practice.
