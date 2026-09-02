# Master Project TODO / Decision Log

Running log of cross-phase spec decisions and what's left, for tracks that
span more than one session. Append new entries below rather than editing
history away.

---

## Email Account Management — Foundation (Phase 1)

**Status**: Done — schema, admin panel, OAuth connect flow, health check,
and scheduled alerting built. See `EMAIL_ACCOUNTS.md` for the full writeup.

**Branch**: `claude/email-account-management-byhart`

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
4. **Live OAuth verification against `drchrisgauci@gmail.com` was not done
   in the sandbox this was built in** — no Google OAuth client credentials
   and no browser were available there. The code path was verified as far
   as possible without them (migration applied and exercised against a real
   Postgres instance, extension build succeeds, encryption round-trips
   correctly, and the transient-vs-needs-reauth classification logic has
   unit tests). Someone with access to the real deployment needs to set the
   `GOOGLE_OAUTH_*` / `EMAIL_ACCOUNTS_ENCRYPTION_KEY` env vars and click
   through the actual consent screen once before this is considered fully
   verified end-to-end.
