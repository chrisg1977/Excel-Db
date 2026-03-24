-- EOS product attributes history schema (v1)
-- Purpose:
--   Historical, auditable product attributes. New versions are appended;
--   existing history must not be silently overwritten.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_attributes_history_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_attributes_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES eos_product_master(id) ON DELETE RESTRICT,

  effective_from DATE NOT NULL,
  effective_to DATE NULL,

  product_name TEXT NOT NULL,
  size_label TEXT NULL,
  product_type TEXT NULL,
  expires_flag BOOLEAN NULL,

  -- Sale/service destination from PRODUCTLIST O.
  destination_mode TEXT NOT NULL DEFAULT 'unknown',

  -- Keep supplier raw text until supplier canonical linkage is implemented.
  supplier_label_raw TEXT NULL,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_attributes_history_name_non_blank_chk
    CHECK (btrim(product_name) <> ''),

  CONSTRAINT eos_product_attributes_history_destination_chk
    CHECK (destination_mode IN ('sale', 'service', 'both', 'unknown')),

  CONSTRAINT eos_product_attributes_history_date_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_attributes_history_version
  ON eos_product_attributes_history(product_id, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_attributes_history_active
  ON eos_product_attributes_history(product_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS ix_eos_product_attributes_history_product
  ON eos_product_attributes_history(product_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS ix_eos_product_attributes_history_destination
  ON eos_product_attributes_history(destination_mode);

ALTER TABLE eos_product_attributes_history OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_attributes_history TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_attributes_history_id_seq TO app_directus;

COMMIT;
