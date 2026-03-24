-- EOS supplier identity schema (v1)
-- Purpose:
--   Historical supplier identities/aliases with deterministic exact-match keys.
--   Supports raw labels, normalized labels, VAT, and registration identities.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_supplier_identity_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_supplier_identity (
  id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES eos_supplier_master(id) ON DELETE RESTRICT,

  identity_type TEXT NOT NULL,
  identity_value TEXT NOT NULL,
  identity_value_norm TEXT NOT NULL,

  effective_from DATE NOT NULL,
  effective_to DATE NULL,

  is_primary BOOLEAN NOT NULL DEFAULT FALSE,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_supplier_identity_type_chk
    CHECK (
      identity_type IN (
        'raw_label',
        'normalized_label',
        'vat_number',
        'registration_no',
        'legacy_code',
        'supplier_code'
      )
    ),

  CONSTRAINT eos_supplier_identity_value_nonblank_chk
    CHECK (length(btrim(identity_value)) > 0),

  CONSTRAINT eos_supplier_identity_norm_nonblank_chk
    CHECK (length(btrim(identity_value_norm)) > 0),

  CONSTRAINT eos_supplier_identity_date_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  CONSTRAINT eos_supplier_identity_vat_norm_chk
    CHECK (
      identity_type <> 'vat_number'
      OR identity_value_norm ~ '^[A-Za-z0-9_-]+$'
    ),

  CONSTRAINT eos_supplier_identity_reg_norm_chk
    CHECK (
      identity_type <> 'registration_no'
      OR identity_value_norm ~ '^[A-Za-z0-9_-]+$'
    )
);

-- One active exact identity key globally, ensuring deterministic supplier resolution.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_supplier_identity_active_exact
  ON eos_supplier_identity(identity_type, identity_value_norm)
  WHERE effective_to IS NULL;

-- Identity versioning by supplier + identity + effective date.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_supplier_identity_version
  ON eos_supplier_identity(supplier_id, identity_type, identity_value_norm, effective_from);

-- At most one active primary identity per supplier.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_supplier_identity_primary_active
  ON eos_supplier_identity(supplier_id)
  WHERE effective_to IS NULL AND is_primary = TRUE;

CREATE INDEX IF NOT EXISTS ix_eos_supplier_identity_supplier
  ON eos_supplier_identity(supplier_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS ix_eos_supplier_identity_type_norm
  ON eos_supplier_identity(identity_type, identity_value_norm);

ALTER TABLE eos_supplier_identity OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_supplier_identity TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_supplier_identity_id_seq TO app_directus;

COMMIT;
