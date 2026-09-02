-- Email account management foundation (Phase 1)
--
-- Generic mailbox-connection layer used by any future email-parsing feature
-- (invoice/bill import is the first consumer, added in a later phase).
-- Not invoice-specific: no invoice/supplier columns live here.
--
-- Apply with:
--   psql -h localhost -p 55432 -U schema_admin -d exceldb -f sql/email_accounts_schema.sql

-- One row per connected mailbox. Provider is a plain TEXT (not an enum) on
-- purpose: today every account is Gmail, but adding a non-Gmail provider
-- later must not require a schema migration.
CREATE TABLE IF NOT EXISTS email_accounts (
  id BIGSERIAL PRIMARY KEY,
  email_address TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'gmail',

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  needs_reauth BOOLEAN NOT NULL DEFAULT FALSE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,

  -- Encrypted at the application layer (AES-256-GCM, see src/lib/crypto.ts).
  -- Never stores a plaintext refresh token / client secret.
  oauth_refresh_token_encrypted TEXT,
  oauth_token_scope TEXT,

  -- Which import/parsing features may read this mailbox. Starts with
  -- 'invoice_import' as the only consumer; the column is a free-form
  -- TEXT[] so a future feature is just "add a value", not a migration.
  feature_flags TEXT[] NOT NULL DEFAULT '{}',

  connected_by UUID REFERENCES directus_users(id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_feature_flags ON email_accounts USING GIN (feature_flags);

CREATE OR REPLACE FUNCTION fn_update_email_accounts_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_email_accounts_updated ON email_accounts;
CREATE TRIGGER tr_email_accounts_updated
BEFORE UPDATE ON email_accounts
FOR EACH ROW
EXECUTE FUNCTION fn_update_email_accounts_timestamp();

-- Short-lived CSRF state for the OAuth connect/reconnect redirect. Stored in
-- the DB (rather than in-memory) so it survives an extension reload between
-- the admin starting the flow and Google redirecting back.
CREATE TABLE IF NOT EXISTS email_oauth_states (
  state TEXT PRIMARY KEY,
  requested_by UUID REFERENCES directus_users(id) ON DELETE SET NULL,
  reconnect_account_id BIGINT REFERENCES email_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE INDEX IF NOT EXISTS idx_email_oauth_states_expires ON email_oauth_states(expires_at);

-- Generic message index for a connected mailbox. Any future parsing feature
-- reads from here rather than re-fetching from the provider.
CREATE TABLE IF NOT EXISTS email_messages (
  id BIGSERIAL PRIMARY KEY,
  email_account_id BIGINT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT,
  received_at TIMESTAMPTZ,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  snippet TEXT,

  -- Which features have already handled this message, so invoice_import and
  -- a later feature can both process the same mailbox independently.
  processed_by_features TEXT[] NOT NULL DEFAULT '{}',

  raw_status TEXT NOT NULL DEFAULT 'fetched'
    CHECK (raw_status IN ('fetched', 'error')),

  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (email_account_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_email_messages_account ON email_messages(email_account_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_received ON email_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_processed_by ON email_messages USING GIN (processed_by_features);

-- Kept generic so any future feature (not just invoices) can pull
-- attachments for a message without a new table.
CREATE TABLE IF NOT EXISTS email_attachments (
  id BIGSERIAL PRIMARY KEY,
  email_message_id BIGINT NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  storage_path TEXT,
  extracted_text_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extracted_text_status IN ('pending', 'extracted', 'failed', 'not_applicable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_message ON email_attachments(email_message_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_extract_status ON email_attachments(extracted_text_status);

-- Admin list view: never selects the encrypted token column.
CREATE OR REPLACE VIEW vw_email_accounts_admin AS
SELECT
  ea.id,
  ea.email_address,
  ea.provider,
  ea.status,
  ea.needs_reauth,
  ea.consecutive_failures,
  ea.feature_flags,
  ea.connected_by,
  du.email AS connected_by_email,
  ea.connected_at,
  ea.last_checked_at,
  ea.last_success_at,
  ea.last_error,
  ea.last_error_at,
  (ea.oauth_refresh_token_encrypted IS NOT NULL) AS has_credentials,
  ea.created_at,
  ea.updated_at
FROM email_accounts ea
LEFT JOIN directus_users du ON du.id = ea.connected_by
ORDER BY ea.email_address;
