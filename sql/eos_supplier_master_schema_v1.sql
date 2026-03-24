-- EOS supplier master schema (v1)
-- Purpose:
--   Canonical supplier root model for product/supplier normalization and linkage.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_supplier_master_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_supplier_master (
  id BIGSERIAL PRIMARY KEY,

  supplier_key TEXT NULL,
  display_name TEXT NOT NULL,
  legal_name TEXT NULL,

  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_supplier_master_status_chk
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),

  CONSTRAINT eos_supplier_master_display_name_nonblank_chk
    CHECK (length(btrim(display_name)) > 0),

  CONSTRAINT eos_supplier_master_legal_name_nonblank_chk
    CHECK (legal_name IS NULL OR length(btrim(legal_name)) > 0),

  CONSTRAINT eos_supplier_master_supplier_key_norm_chk
    CHECK (
      supplier_key IS NULL
      OR supplier_key = upper(regexp_replace(supplier_key, '[^A-Za-z0-9]+', '_', 'g'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_supplier_master_supplier_key
  ON eos_supplier_master(supplier_key)
  WHERE supplier_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_eos_supplier_master_display_name
  ON eos_supplier_master(display_name);

CREATE INDEX IF NOT EXISTS ix_eos_supplier_master_active
  ON eos_supplier_master(is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_eos_supplier_master_status
  ON eos_supplier_master(lifecycle_status);

ALTER TABLE eos_supplier_master OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_supplier_master TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_supplier_master_id_seq TO app_directus;

COMMIT;
