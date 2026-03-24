-- EOS staged loader rejects schema (v1)
-- Purpose:
--   Persist explicit reject-first outcomes for strict EOS staged loaders.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_rejects_schema_v1.sql
--
-- Notes:
--   - One row per (loader_name, candidate_id) to keep loader reruns idempotent.
--   - reject_reasons stores machine-readable reason codes.
--   - reject_context stores optional JSON diagnostics for future QA/replay.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_stg_rejects (
  id BIGSERIAL PRIMARY KEY,
  loader_name TEXT NOT NULL,
  candidate_id TEXT NOT NULL,

  branch_code TEXT NULL,
  source_table_name TEXT NULL,
  source_family TEXT NULL,
  source_file TEXT NULL,
  source_sheet TEXT NULL,
  source_row_num INTEGER NULL,

  classification_status TEXT NULL,
  unresolved_reason TEXT NULL,
  reject_reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  reject_context JSONB NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_stg_rejects_loader_candidate_uk
    UNIQUE (loader_name, candidate_id),

  CONSTRAINT eos_stg_rejects_branch_code_chk
    CHECK (branch_code IS NULL OR branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM'))
);

CREATE INDEX IF NOT EXISTS ix_eos_stg_rejects_loader_name
  ON eos_stg_rejects(loader_name);

CREATE INDEX IF NOT EXISTS ix_eos_stg_rejects_source
  ON eos_stg_rejects(source_table_name, source_file, source_sheet, source_row_num);

CREATE INDEX IF NOT EXISTS ix_eos_stg_rejects_created_at
  ON eos_stg_rejects(created_at);

ALTER TABLE eos_stg_rejects OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_stg_rejects TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_stg_rejects_id_seq TO app_directus;

-- Note: updated_at is app-managed for now; add trigger-based stamping later if required.

COMMIT;
