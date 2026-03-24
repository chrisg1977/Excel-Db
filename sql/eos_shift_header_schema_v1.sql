-- EOS shift header source-contract schema (v1)
-- Purpose:
--   Canonical operational shift header source for PAY SUMMARY derivation.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_shift_header_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_shift_header (
  id BIGSERIAL PRIMARY KEY,
  branch_code TEXT NOT NULL,
  business_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_shift_header_branch_code_chk
    CHECK (branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM'))
);

CREATE INDEX IF NOT EXISTS ix_eos_shift_header_branch_business_date
  ON eos_shift_header(branch_code, business_date);

ALTER TABLE eos_shift_header OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_shift_header TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_shift_header_id_seq TO app_directus;

-- Note: updated_at is app-managed for now; add trigger-based stamping later if required.

COMMIT;
