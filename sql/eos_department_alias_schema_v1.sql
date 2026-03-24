-- EOS department alias schema (v1)
-- Purpose:
--   Canonical alias map from normalized PAY SUMMARY/operational labels to departments.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_department_alias_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS department_alias (
  id BIGSERIAL PRIMARY KEY,

  -- Canonical target department.
  department_id BIGINT NOT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,

  -- Human/source form and normalized key used by resolution logic.
  alias_raw TEXT NOT NULL,
  alias_norm TEXT NOT NULL,

  -- Source/audit metadata.
  source_system TEXT NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Keep normalized key format aligned with EOS resolution logic.
  CONSTRAINT department_alias_alias_norm_chk
    CHECK (alias_norm = upper(regexp_replace(alias_norm, '[^A-Za-z0-9]+', '_', 'g')))
);

-- Required by eos_department_alias_seed_pay_summary_v1.sql ON CONFLICT(alias_norm)
CREATE UNIQUE INDEX IF NOT EXISTS ux_department_alias_alias_norm
  ON department_alias(alias_norm);

CREATE UNIQUE INDEX IF NOT EXISTS ux_department_alias_dept_alias_raw_source
  ON department_alias(department_id, alias_raw, source_system);

CREATE INDEX IF NOT EXISTS ix_department_alias_department_id
  ON department_alias(department_id);

CREATE INDEX IF NOT EXISTS ix_department_alias_active
  ON department_alias(is_active)
  WHERE is_active = TRUE;

ALTER TABLE department_alias OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON department_alias TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE department_alias_id_seq TO app_directus;

-- Note: updated_at is app-managed for now; add a trigger later if DB-enforced update stamping is required.

COMMIT;
