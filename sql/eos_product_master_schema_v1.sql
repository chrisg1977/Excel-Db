-- EOS product master schema (v1)
-- Purpose:
--   Central canonical product root shared across SELL/stock/supplier streams.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_master_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_master (
  id BIGSERIAL PRIMARY KEY,

  -- Optional stable business key (can be introduced gradually).
  product_key TEXT NULL,

  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_master_status_chk
    CHECK (lifecycle_status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),

  CONSTRAINT eos_product_master_product_key_norm_chk
    CHECK (
      product_key IS NULL
      OR product_key = upper(regexp_replace(product_key, '[^A-Za-z0-9]+', '_', 'g'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_master_product_key
  ON eos_product_master(product_key)
  WHERE product_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_eos_product_master_active
  ON eos_product_master(is_active)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_eos_product_master_status
  ON eos_product_master(lifecycle_status);

ALTER TABLE eos_product_master OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_master TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_master_id_seq TO app_directus;

COMMIT;
