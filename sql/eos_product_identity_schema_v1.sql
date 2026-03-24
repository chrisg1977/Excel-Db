-- EOS product identity schema (v1)
-- Purpose:
--   Product identity layer supporting barcodes and future alternate identities.
--   Includes historical validity windows for identity changes.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_identity_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_identity (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES eos_product_master(id) ON DELETE RESTRICT,

  identity_type TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  identity_value_norm TEXT NOT NULL,

  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_identity_type_chk
    CHECK (identity_type IN ('barcode', 'legacy_barcode', 'sku', 'eco_code', 'external_code', 'distributor_barcode', 'special_identity')),

  CONSTRAINT eos_product_identity_value_non_blank_chk
    CHECK (btrim(identity_value) <> ''),

  CONSTRAINT eos_product_identity_norm_non_blank_chk
    CHECK (btrim(identity_value_norm) <> ''),

  CONSTRAINT eos_product_identity_norm_rule_chk
    CHECK (identity_value_norm = lower(regexp_replace(identity_value, '\\s+', '', 'g'))),

  CONSTRAINT eos_product_identity_barcode_digits_chk
    CHECK (
      identity_type NOT IN ('barcode', 'legacy_barcode', 'eco_code')
      OR identity_value ~ '^[0-9]+$'
    ),

  CONSTRAINT eos_product_identity_date_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

ALTER TABLE eos_product_identity
  DROP CONSTRAINT IF EXISTS eos_product_identity_type_chk;

ALTER TABLE eos_product_identity
  ADD CONSTRAINT eos_product_identity_type_chk
  CHECK (identity_type IN ('barcode', 'legacy_barcode', 'sku', 'eco_code', 'external_code', 'distributor_barcode', 'special_identity'));

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_identity_version
  ON eos_product_identity(product_id, identity_type, identity_value_norm, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_identity_active_value
  ON eos_product_identity(identity_type, identity_value_norm)
  WHERE effective_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_identity_primary_active
  ON eos_product_identity(product_id)
  WHERE is_primary = TRUE AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS ix_eos_product_identity_product
  ON eos_product_identity(product_id);

CREATE INDEX IF NOT EXISTS ix_eos_product_identity_active
  ON eos_product_identity(identity_type, identity_value_norm)
  WHERE effective_to IS NULL;

ALTER TABLE eos_product_identity OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_identity TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_identity_id_seq TO app_directus;

COMMIT;
